import {
    projectHistoryBackup,
    createHistoryBackupRestorer,
} from './history-backup';
import {
    previewLocalHistory,
    importLocalHistory,
    type HistoryPreview,
} from './history-sync-settings';
export type { HistoryPreview } from './history-sync-settings';
import {
    DestroyRef,
    Injectable,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    ParentalLockService,
} from '@iptvnator/services';
import {
    requestSourceServer,
    SourceSyncService,
} from '@iptvnator/services/source-sync';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    HistorySyncClient,
    IndexedDbHistoryStore,
    ElectronHistoryStore,
} from '@iptvnator/services/history-sync';
import {
    createRandomId,
    type Playlist,
    type PlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    captureHistoryOwner,
    type HistoryPlaylistAction,
} from '@iptvnator/services/history-events';
import {
    HISTORY_SYNC_CAPABILITY,
    type HistoryScope,
} from '@iptvnator/shared/interfaces/history-sync';
import { favoriteSourceRetirementKey } from '@iptvnator/services/favorites-sync';
import { prepareFavoriteHash } from '@iptvnator/shared/interfaces/favorites-sync';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
    type IXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import {
    historyEnabled,
    historyConsentKey,
    readHistoryConsent,
} from './history-consent';
import { HistoryPlaylistAdapter } from './history-playlist-adapter';
import { HistoryXtreamAdapter } from './history-xtream-adapter';
import { FavoritesM3uCatalog } from './favorites-m3u-catalog';
@Injectable({ providedIn: 'root' })
export class HistorySyncRuntime {
    private readonly capabilities = inject(RuntimeCapabilitiesService);
    private readonly playlists = inject(PlaylistsService);
    private readonly locks = inject(ParentalLockService);
    private readonly sources = inject(SourceSyncService);
    private readonly store = inject(Store);
    private readonly raw: IXtreamDataSource = this.capabilities
        .supportsXtreamSqliteDataSource
        ? inject(ElectronXtreamDataSource)
        : inject(PwaXtreamDataSource);
    private client?: HistorySyncClient;
    private adapter?: HistoryPlaylistAdapter;
    private xtream?: HistoryXtreamAdapter;
    private refreshing?: Promise<void>;
    private changing?: Promise<void>;
    readonly enabled = signal(historyEnabled());
    readonly busy = signal(false);
    readonly state = signal('disabled');
    readonly stateKey = computed(() => `HISTORY_SYNC.STATE_${this.state()}`);
    readonly pending = signal(0);
    readonly parkedCount = signal(0);
    readonly localCount = signal(0);
    readonly error = signal(false);
    constructor() {
        const refresh = () => {
            this.enabled.set(historyEnabled());
            if (this.enabled()) void this.refresh();
            else this.state.set('disabled');
        };
        for (const event of ['online', 'focus', 'storage'])
            window.addEventListener(event, refresh);
        const timer = setInterval(() => {
            if (!document.hidden && historyEnabled()) void this.refresh();
        }, 5000);
        inject(DestroyRef).onDestroy(() => {
            clearInterval(timer);
            for (const event of ['online', 'focus', 'storage'])
                window.removeEventListener(event, refresh);
        });
        if (this.enabled()) queueMicrotask(refresh);
    }
    private ensure(): HistorySyncClient {
        if (this.client && this.client.options.active()) return this.client;
        const instanceId = sourceConnection()?.instanceId;
        const consent = readHistoryConsent();
        if (
            !instanceId ||
            !consent ||
            !this.capabilities.supportsHistoryStorage
        )
            throw new Error('History profile unavailable');
        const key = `iptvnator-server:${instanceId}:history-contexts-v1`;
        const retirementKey = favoriteSourceRetirementKey(instanceId);
        const epoch = localStorage.getItem(retirementKey);
        const saved = JSON.parse(
            localStorage.getItem(key) ?? '[]'
        ) as HistoryScope[];
        const owners = new Map<string, () => boolean>();
        const rememberOwners = (contexts: HistoryScope[]) => {
            for (const scope of contexts)
                if (!owners.has(scope.sourceId))
                    owners.set(
                        scope.sourceId,
                        captureHistoryOwner(
                            instanceId,
                            scope.sourceId,
                            () => sourceConnection()?.instanceId
                        )
                    );
        };
        rememberOwners(saved);
        // Retirement renews the context cache; verified writes retain their own source fence.
        const active = (scope?: HistoryScope) =>
            sourceConnection()?.instanceId === instanceId &&
            (scope
                ? (owners.get(scope.sourceId)?.() ?? false)
                : localStorage.getItem(retirementKey) === epoch);
        this.client = new HistorySyncClient(
            this.capabilities.isElectron
                ? new ElectronHistoryStore((request) =>
                      window.electron!.historyLocalRequest!(request)
                  )
                : new IndexedDbHistoryStore(instanceId),
            {
                instanceId,
                deviceId: consent.deviceId,
                contexts: saved,
                active,
                consent: () =>
                    sourceConnection()?.instanceId === instanceId &&
                    historyEnabled()
                        ? readHistoryConsent()!.generation
                        : null,
                request: requestSourceServer,
                remember: (contexts) => {
                    if (!active()) throw new Error('History profile changed');
                    rememberOwners(contexts);
                    localStorage.setItem(key, JSON.stringify(contexts));
                },
                changed: () =>
                    window.dispatchEvent(
                        new Event('iptvnator-history-changed')
                    ),
            }
        );
        const catalogs = new FavoritesM3uCatalog(
            (id) => firstValueFrom(this.playlists.getPlaylistById(id)),
            (id) => this.client?.contexts.get(id)?.sourceIncarnation
        );
        this.adapter = new HistoryPlaylistAdapter(this.client, (source) =>
            catalogs.resolve(source)
        );
        this.xtream = new HistoryXtreamAdapter(
            this.client,
            this.capabilities.supportsXtreamSqliteDataSource,
            this.locks
        );
        return this.client;
    }
    private async rows(): Promise<Playlist[]> {
        return firstValueFrom(this.playlists.getAllPlaylists());
    }
    async project<T extends Playlist>(playlist: T): Promise<T> {
        if (!playlist) return playlist;
        await prepareFavoriteHash();
        this.ensure();
        return this.adapter!.project(playlist);
    }
    async mutate(playlist: Playlist, action: HistoryPlaylistAction) {
        const client = this.ensure();
        const scope = client.contexts.get(playlist._id);
        try {
            const result = await this.adapter!.mutate(playlist, action);
            await this.summary();
            client.current(scope);
            return result;
        } catch {
            this.error.set(true);
            throw new Error('History storage failed');
        }
    }
    async invoke(raw: IXtreamDataSource, method: string, args: unknown[]) {
        const client = this.ensure();
        const id = String(
            args[
                [
                    'getRecentItems',
                    'clearRecentItems',
                    'supportsPortableHistory',
                ].includes(method)
                    ? 0
                    : 1
            ]
        );
        const scope = client.contexts.get(id);
        try {
            const result = await this.xtream!.invoke(raw, method, args);
            await this.summary();
            client.current(scope);
            return result;
        } catch {
            this.error.set(true);
            throw new Error('History storage failed');
        }
    }
    async setEnabled(enabled: boolean): Promise<void> {
        if (this.changing) {
            await this.changing;
            if (historyEnabled() !== enabled) return this.setEnabled(enabled);
            return;
        }
        this.changing = this.change(enabled).finally(
            () => (this.changing = undefined)
        );
        return this.changing;
    }
    private async change(enabled: boolean): Promise<void> {
        this.busy.set(true);
        this.error.set(false);
        try {
            const key = historyConsentKey();
            const previous = readHistoryConsent();
            if (!key || !this.capabilities.supportsHistoryStorage)
                throw new Error('History profile unavailable');
            if (enabled) {
                await prepareFavoriteHash();
                const result = await requestSourceServer({
                    operation: 'instance',
                });
                const info = result.body as {
                    instanceId?: string;
                    capabilities?: string[];
                };
                if (
                    result.status !== 200 ||
                    info.instanceId !== sourceConnection()?.instanceId
                )
                    throw new Error('History server changed');
                if (!info.capabilities?.includes(HISTORY_SYNC_CAPABILITY)) {
                    this.state.set('incompatible');
                    return;
                }
            }
            if (
                key !== historyConsentKey() ||
                JSON.stringify(previous) !==
                    JSON.stringify(readHistoryConsent())
            )
                return;
            localStorage.setItem(
                key,
                JSON.stringify({
                    enabled,
                    generation: createRandomId(),
                    deviceId: previous?.deviceId ?? createRandomId(),
                })
            );
            this.enabled.set(enabled);
            this.state.set(enabled ? 'initializing' : 'disabled');
            this.ensure();
            if (enabled) await this.refresh();
            else {
                await this.summary();
                await this.publish();
            }
        } catch {
            this.error.set(true);
            throw new Error('History consent failed');
        } finally {
            this.busy.set(false);
        }
    }
    refresh(): Promise<void> {
        if (!historyEnabled()) return Promise.resolve();
        return (this.refreshing ??= this.refreshNow().finally(
            () => (this.refreshing = undefined)
        ));
    }
    private async refreshNow(): Promise<void> {
        try {
            await this.sources.refresh();
            const client = this.ensure();
            for (const source of await this.rows()) {
                if (!historyEnabled()) return;
                await client.refresh(source._id);
                await client.flush(source._id);
            }
            await this.summary();
            this.state.set(
                historyEnabled()
                    ? this.pending()
                        ? 'pending'
                        : 'ready'
                    : 'disabled'
            );
            this.error.set(false);
            await this.publish();
        } catch {
            if (historyEnabled()) {
                this.state.set('offline');
                this.error.set(true);
            }
        }
    }
    private async summary(): Promise<void> {
        const client = this.ensure();
        let pending = 0,
            parked = 0,
            local = 0;
        for (const scope of client.contexts.values()) {
            const record = await client.store.read(scope);
            for (const intent of record?.pending ?? []) {
                pending++;
                if (intent.consent !== client.options.consent()) parked++;
            }
            local += record?.local.length ?? 0;
        }
        this.pending.set(pending);
        this.parkedCount.set(parked);
        this.localCount.set(local);
    }
    private async publish(): Promise<void> {
        this.store.dispatch(PlaylistActions.loadSharedPlaylists());
        window.dispatchEvent(new Event('iptvnator-history-changed'));
    }
    async parked(send: boolean): Promise<void> {
        const client = this.ensure();
        for (const scope of client.contexts.values())
            await client.parked(scope.sourceId, send);
        await this.summary();
        await this.publish();
    }
    exportHistory(playlist: Playlist, entry: PlaylistBackupEntry) {
        return projectHistoryBackup(
            this.ensure(),
            this.adapter!,
            playlist,
            entry
        );
    }
    backupRestorer() {
        this.ensure();
        return createHistoryBackupRestorer(
            () => this.ensure(),
            this.adapter!,
            (id) => firstValueFrom(this.playlists.getPlaylistById(id))
        );
    }
    async previewImport(): Promise<HistoryPreview> {
        return previewLocalHistory(
            this.ensure(),
            (id) =>
                this.capabilities.supportsXtreamSqliteDataSource
                    ? this.raw.getRecentItems(id, { all: true })
                    : this.raw.getRecentItems(id),
            this.adapter!,
            await this.rows(),
            (id) => firstValueFrom(this.playlists.getPlaylistById(id))
        );
    }
    async importHistory(preview: HistoryPreview): Promise<void> {
        await importLocalHistory(this.ensure(), preview);
        await this.summary();
        await this.publish();
    }
}
