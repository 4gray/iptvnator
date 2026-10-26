import { verifySourceInstance } from './source-authorization';
import { saveBrowserSourceConnection } from './source-browser-settings';
import {
    computed,
    DestroyRef,
    inject,
    Injectable,
    signal,
} from '@angular/core';
import { LazySnackBar } from '../lazy-snack-bar/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { Subject } from 'rxjs';
import {
    type SourceDefinition,
    type SourceInventory,
    type SourceServerRequest,
    type SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { DataService } from '../data.service';
import { PLAYLIST_DELETE_CLEANUP } from '../playlist-delete-cleanup.token';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { indexedDbDocumentStore } from './indexeddb-document-store';
import { requestSourceServer } from './source-api';
import {
    assertSourceInstance,
    invalidateSourceVerification,
    sourceVerificationEpoch,
    sourceConnection,
    sourceConnectionReadFailed,
    sourceProfileName,
    tokenKey,
} from './source-connection';
import { SyncedPlaylistStore } from './synced-playlist-store';
import { materializeSource } from './source-materializer';
import { migrateLegacyPlaylistActivity } from './legacy-playlist-activity';
import { recoverPendingStatelessBackend } from './pending-source-discovery';
import { SourceCleanupQueue } from './source-cleanup-queue';

@Injectable({ providedIn: 'root' })
export class SourceSyncService {
    private readonly backend = inject(PlaylistStorageBackend);
    private readonly db = inject(NgxIndexedDBService);
    private readonly data = inject(DataService);
    private readonly snackBar = inject(LazySnackBar);
    private readonly translate = inject(TranslateService);
    private readonly destroy = inject(DestroyRef);
    private readonly cleanups =
        inject(PLAYLIST_DELETE_CLEANUP, { optional: true }) ?? [];
    readonly connection = sourceConnection();
    readonly connectionReadFailed = sourceConnectionReadFailed();
    readonly state = signal<
        'local' | 'connecting' | 'connected' | 'offline' | 'locked' | 'conflict'
    >('local');
    readonly stateKey = computed(
        () =>
            ({
                local: 'SOURCE_SYNC.STATE_local',
                connecting: 'SOURCE_SYNC.STATE_connecting',
                connected: 'SOURCE_SYNC.STATE_connected',
                offline: 'SOURCE_SYNC.STATE_offline',
                locked: 'SOURCE_SYNC.STATE_locked',
                conflict: 'SOURCE_SYNC.STATE_conflict',
            })[this.state()]
    );
    readonly lastSync = signal<number | null>(null);
    readonly errorKey = signal<string | null>(null);
    readonly sourceIds = signal<ReadonlySet<string>>(new Set());
    readonly changes = new Subject<void>();
    private store?: SyncedPlaylistStore;
    private refreshing?: Promise<void>;
    private failures = 0;
    private nextPollAt = 0;
    private browserProfile = false;
    private metadataDirty = false;
    private cleanupQueue?: SourceCleanupQueue;

    async initialize(): Promise<void> {
        if (!this.connection) {
            if (this.connectionReadFailed) {
                this.state.set('offline');
                this.backend.finishServerInitialization();
            }
            return;
        }
        const native = this.backend.localDocumentStore();
        this.browserProfile = !native;
        const local = native
            ? { ...native }
            : indexedDbDocumentStore(this.db, sourceProfileName());
        this.cleanupQueue = new SourceCleanupQueue(local, this.cleanups);
        local.dbDeletePlaylist = this.cleanupQueue.remove;
        local.dbDeleteAllPlaylists = this.cleanupQueue.clear;
        this.store = new SyncedPlaylistStore(
            local,
            (request) => this.request(request),
            (source, current) => materializeSource(source, current, this.data),
            this.connection.instanceId
        );
        this.backend.installServerStore(this.store);
        let initialRefresh: Promise<void> | undefined;
        try {
            this.store.ready =
                (await local.dbGetAppState('source-sync-initialized')) === '1';
            this.state.set('connecting');
            const refresh = this.refresh();
            void refresh.catch(() => this.state.set('offline'));
            if (!this.store.ready) initialRefresh = refresh;
        } catch {
            this.state.set('offline');
        } finally {
            const finish = () => this.backend.finishServerInitialization();
            if (initialRefresh) void initialRefresh.then(finish, finish);
            else finish();
        }
        const resume = () => {
            if (!document.hidden) void this.refresh();
        };
        const timer = setInterval(() => {
            if (Date.now() >= this.nextPollAt && this.state() !== 'locked')
                resume();
        }, 15000);
        window.addEventListener('online', resume);
        window.addEventListener('focus', resume);
        document.addEventListener('visibilitychange', resume);
        const stopResume = window.electron?.onSourceSyncResume?.(resume);
        this.destroy.onDestroy(() => {
            clearInterval(timer);
            window.removeEventListener('online', resume);
            window.removeEventListener('focus', resume);
            document.removeEventListener('visibilitychange', resume);
            stopResume?.();
        });
    }

    refresh(): Promise<void> {
        if (!this.store) return Promise.resolve();
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.store
            .exclusive(async () => {
                try {
                    const wasReady = this.store!.ready;
                    this.errorKey.set(null);
                    if (!this.store!.ready) this.state.set('connecting');
                    // Finish previous deletions before a reused ID can be projected.
                    await this.cleanupQueue!.retry();
                    const epoch = sourceVerificationEpoch();
                    const probe = await this.request({ operation: 'instance' });
                    if (
                        this.browserProfile &&
                        recoverPendingStatelessBackend(
                            this.connection!,
                            probe.body
                        )
                    )
                        return;
                    assertSourceInstance(probe.body);
                    if (probe.body.instanceId !== this.connection!.instanceId) {
                        if (
                            this.connection!.instanceId.startsWith(
                                'pending:'
                            ) &&
                            !window.electron?.sourceSyncConnection
                        ) {
                            saveBrowserSourceConnection(
                                {
                                    ...this.connection!,
                                    instanceId: probe.body.instanceId!,
                                },
                                sessionStorage.getItem(
                                    tokenKey(this.connection!)
                                ) ?? '',
                                this.connection!
                            );
                            location.reload();
                            return;
                        }
                        throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
                    }
                    verifySourceInstance(probe.body, this.connection, epoch);
                    const response = await this.request({
                        operation: 'list',
                        revision: this.store!.pendingSources.size
                            ? undefined
                            : this.store!.collectionRevision,
                    });
                    if (response.status === 304) {
                        this.failures = 0;
                        this.nextPollAt = 0;
                        this.state.set('connected');
                        this.lastSync.set(Date.now());
                        if (this.metadataDirty) {
                            this.metadataDirty = false;
                            this.changes.next();
                        }
                        return;
                    }
                    const entries = (response.body as SourceInventory).entries;
                    if (!wasReady && this.browserProfile)
                        await migrateLegacyPlaylistActivity(
                            this.store!.local,
                            this.connection!,
                            new Set(entries.map((entry) => entry.source.id))
                        );
                    let changed =
                        this.metadataDirty ||
                        response.etag !== this.store!.collectionRevision;
                    for (const entry of entries) {
                        const current =
                            await this.store!.local.dbGetAppPlaylist(
                                entry.source.id
                            );
                        if (
                            current?.sourceSyncRevision === entry.revision &&
                            !current.sourceSyncPending
                        )
                            continue;
                        let source = entry.source;
                        if (source.kind === 'm3u-text')
                            source = (
                                await this.request({
                                    operation: 'get',
                                    id: source.id,
                                })
                            ).body as SourceDefinition;
                        await this.store!.project(source, entry.revision);
                        changed = true;
                    }
                    const ids = new Set(
                        entries.map((entry) => entry.source.id)
                    );
                    this.sourceIds.set(ids);
                    const local = this.store!.local;
                    for (const row of await (local.dbGetAppPlaylistMetas?.() ??
                        local.dbGetAppPlaylists())) {
                        if (!ids.has(row._id)) {
                            await this.store!.local.dbDeletePlaylist(row._id);
                            this.store!.pendingSources.delete(row._id);
                            changed = true;
                        }
                    }
                    this.store!.collectionRevision = response.etag;
                    await this.store!.local.dbSetAppState(
                        'source-sync-initialized',
                        '1'
                    );
                    this.store!.ready = true;
                    this.failures = 0;
                    this.nextPollAt = 0;
                    this.state.set('connected');
                    this.lastSync.set(Date.now());
                    this.metadataDirty = false;
                    if (changed || !wasReady) this.changes.next();
                } catch (error) {
                    invalidateSourceVerification();
                    if (
                        error instanceof Error &&
                        error.message === 'SOURCE_SYNC.LOCKED'
                    )
                        this.state.set('locked');
                    this.nextPollAt =
                        Date.now() +
                        Math.min(120000, 15000 * 2 ** this.failures++);
                    if (
                        error instanceof Error &&
                        error.message.startsWith('SOURCE_SYNC.')
                    )
                        this.errorKey.set(error.message);
                    if (
                        this.state() !== 'locked' &&
                        this.state() !== 'conflict'
                    )
                        this.state.set('offline');
                    if (
                        error instanceof Error &&
                        error.message === 'SOURCE_SYNC.INSTANCE_CHANGED'
                    ) {
                        this.snackBar.open(
                            this.translate.instant(error.message),
                            this.translate.instant('CLOSE')
                        );
                    }
                }
            })
            .finally(() => {
                this.refreshing = undefined;
            });
        return this.refreshing;
    }

    private async request(
        request: SourceServerRequest
    ): Promise<SourceServerResponse> {
        try {
            const mutation = !['instance', 'list', 'get'].includes(
                request.operation
            );
            if (mutation && this.state() !== 'connected') {
                throw new Error(
                    this.state() === 'locked'
                        ? 'SOURCE_SYNC.LOCKED'
                        : (this.errorKey() ?? 'SOURCE_SYNC.OFFLINE')
                );
            }
            if (mutation) await this.cleanupQueue!.retry();
            const response = await requestSourceServer(request);
            if (response.status >= 400) {
                const key =
                    response.status === 409 &&
                    (response.body as { code?: string })?.code ===
                        'instance_changed'
                        ? 'INSTANCE_CHANGED'
                        : response.status === 401
                          ? 'LOCKED'
                          : response.status === 412
                            ? 'CONFLICT'
                            : 'REQUEST_FAILED';
                this.state.set(
                    response.status === 401
                        ? 'locked'
                        : response.status === 412
                          ? 'conflict'
                          : 'offline'
                );
                throw new Error(`SOURCE_SYNC.${key}`);
            }
            if (!['instance', 'list', 'get'].includes(request.operation)) {
                this.metadataDirty = true;
                queueMicrotask(() => void this.refresh());
            }
            return response;
        } catch (error) {
            const key =
                error instanceof Error
                    ? error.message.match(/SOURCE_SYNC\.[A-Z_]+/)?.[0]
                    : undefined;
            if (key === 'SOURCE_SYNC.INSTANCE_CHANGED') {
                invalidateSourceVerification();
                this.errorKey.set(key);
            }
            if (key === 'SOURCE_SYNC.LOCKED') this.state.set('locked');
            if (!['locked', 'conflict'].includes(this.state()))
                this.state.set('offline');
            if (!['list', 'instance', 'get'].includes(request.operation)) {
                const message =
                    error instanceof Error &&
                    error.message.startsWith('SOURCE_SYNC.')
                        ? error.message
                        : 'SOURCE_SYNC.REQUEST_FAILED';
                this.snackBar.open(
                    this.translate.instant(message),
                    this.translate.instant('CLOSE'),
                    { duration: 7000 }
                );
            }
            throw new Error(key ?? 'SOURCE_SYNC.OFFLINE');
        }
    }
}
