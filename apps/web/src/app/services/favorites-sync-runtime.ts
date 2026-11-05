import {
    readFavoriteSummary,
    favoriteFailureState,
} from './favorites-runtime-summary';
import { createRandomId } from '@iptvnator/shared/interfaces';
import { refreshFavoriteViews } from './favorites-view-refresh';
import { projectFavoriteBackup } from './favorites-backup-projection';
import { createFavoriteBackupRestorer } from './favorites-backup-restore';
import { prepareFavoriteHash } from '@iptvnator/shared/interfaces/favorites-sync';
import {
    previewLocalFavorites,
    importFavoritePreview,
    type FavoritesImportPreview,
} from './favorites-sync-settings';
export type { FavoritesImportPreview } from './favorites-sync-settings';
import { createFavoritesRuntimeClient } from './favorites-runtime-client';
import { readFavoritesConsent } from './favorites-consent-state';
import { Router } from '@angular/router';
import {
    DestroyRef,
    Injectable,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
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
    FavoritesSyncClient,
    FavoriteSupersededError,
    refreshFavoriteSources,
    observeFavoriteSourceRetirement,
} from '@iptvnator/services/favorites-sync';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
    type IXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import {
    FAVORITES_SYNC_CAPABILITY,
    type FavoriteAddress,
    type FavoriteEntry,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    Playlist,
    PlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { favoritesEnabled, favoritesConsentKey } from './favorites-consent';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import type { FavoritesXtreamAdapter } from './favorites-xtream-adapter';
@Injectable({ providedIn: 'root' })
export class FavoritesSyncRuntime {
    private readonly locks = inject(ParentalLockService);
    private readonly capabilities = inject(RuntimeCapabilitiesService);
    private readonly playlists = inject(PlaylistsService);
    private readonly sources = inject(SourceSyncService);
    private readonly store = inject(Store);
    private readonly router = inject(Router);
    private readonly raw = this.capabilities.supportsXtreamSqliteDataSource
        ? inject(ElectronXtreamDataSource)
        : inject(PwaXtreamDataSource);
    private client?: FavoritesSyncClient;
    private playlistAdapter?: FavoritesPlaylistAdapter;
    private xtreamAdapter?: FavoritesXtreamAdapter;
    private timer?: ReturnType<typeof setInterval>;
    private refreshing?: Promise<void>;
    private changing?: Promise<void>;
    readonly enabled = signal(favoritesEnabled());
    readonly busy = signal(false);
    readonly error = signal(false);
    readonly state = signal('disabled');
    readonly stateKey = computed(() => `FAVORITES_SYNC.STATE_${this.state()}`);
    readonly pending = signal(0);
    readonly parkedCount = signal(0);
    readonly conflicts = signal<FavoriteEntry[]>([]);
    readonly lastSync = signal<Date | null>(null);
    constructor() {
        const stopRetiring = observeFavoriteSourceRetirement(() => this.client);
        const refresh = () => {
            this.enabled.set(favoritesEnabled());
            if (this.enabled()) void this.refresh();
            else this.state.set('disabled');
        };
        for (const event of ['online', 'focus', 'storage'])
            window.addEventListener(event, refresh);
        this.timer = setInterval(() => {
            if (!document.hidden && favoritesEnabled()) void this.refresh();
        }, 5000);
        inject(DestroyRef).onDestroy(() => {
            stopRetiring();
            clearInterval(this.timer);
            for (const event of ['online', 'focus', 'storage'])
                window.removeEventListener(event, refresh);
        });
        if (this.enabled()) queueMicrotask(() => void this.refresh());
    }
    private ensureClient(): FavoritesSyncClient {
        if (
            this.client?.options.instanceId !==
                sourceConnection()?.instanceId ||
            this.client?.options.profileActive?.() === false
        ) {
            this.sourceNames.clear();
            const created = createFavoritesRuntimeClient(
                this.capabilities,
                (id) => firstValueFrom(this.playlists.getPlaylistById(id)),
                () =>
                    window.dispatchEvent(
                        new Event('iptvnator-favorites-changed')
                    ),
                this.locks
            );
            this.client = created.client;
            this.playlistAdapter = created.playlistAdapter;
            this.xtreamAdapter = created.xtreamAdapter;
        }
        if (!this.client) throw new Error('Favorite profile unavailable');
        return this.client;
    }
    async setEnabled(enabled: boolean): Promise<void> {
        if (this.changing) {
            await this.changing;
            if (favoritesEnabled() !== enabled) return this.setEnabled(enabled);
            return;
        }
        this.changing = this.changeConsent(enabled).finally(
            () => (this.changing = undefined)
        );
        return this.changing;
    }
    private async changeConsent(enabled: boolean) {
        this.busy.set(true);
        this.error.set(false);
        try {
            const key = favoritesConsentKey();
            if (!key || !this.capabilities.supportsFavoritesStorage)
                throw new Error('Favorite profile unavailable');
            const previous = readFavoritesConsent();
            if (enabled) {
                await prepareFavoriteHash();
                const response = await requestSourceServer({
                    operation: 'instance',
                });
                if (
                    response.status !== 200 ||
                    (response.body as { instanceId?: string })?.instanceId !==
                        sourceConnection()?.instanceId
                )
                    throw new Error('Favorite server changed');
                if (
                    !(
                        response.body as { capabilities?: string[] }
                    )?.capabilities?.includes(FAVORITES_SYNC_CAPABILITY)
                ) {
                    this.state.set('incompatible');
                    return;
                }
            }
            if (
                favoritesConsentKey() !== key ||
                JSON.stringify(previous) !==
                    JSON.stringify(readFavoritesConsent())
            )
                return;
            // Projection/outbox already live atomically in local storage. Opt-out needs no lossy raw-map mirror.
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
            this.ensureClient();
            if (enabled) await this.refresh();
            else {
                const client = this.ensureClient();
                for (const sourceId of client.contexts.keys())
                    for (const { address } of await client.entries(sourceId))
                        await client.store.mutate(address, (current) => {
                            if (
                                favoritesConsentKey() !== key ||
                                favoritesEnabled() ||
                                !current
                            )
                                throw new Error('Favorite consent changed');
                            return {
                                ...current,
                                local:
                                    current.localOnly && current.local
                                        ? current.local
                                        : current.state,
                            };
                        });
                await this.publish();
            }
        } catch {
            this.error.set(true);
            throw new Error('Favorite consent failed');
        } finally {
            this.busy.set(false);
        }
    }
    refresh(): Promise<void> {
        if (!favoritesEnabled()) return Promise.resolve();
        return (this.refreshing ??= this.pull().finally(
            () => (this.refreshing = undefined)
        ));
    }
    private async pull() {
        const generation = readFavoritesConsent()?.generation;
        this.error.set(false);
        try {
            const client = this.ensureClient();
            await this.sources.refresh();
            const sources = await this.sourceRows();
            await refreshFavoriteSources(
                client,
                sources.map((source) => source._id)
            );
            const summary = await this.summary();
            if (!summary) return;
            this.lastSync.set(new Date());
            this.state.set(summary.state);
            await this.publish();
        } catch (error) {
            if (
                favoritesEnabled() &&
                generation === readFavoritesConsent()?.generation
            )
                this.reportFailure(error);
        }
    }
    private reportFailure(error: unknown): void {
        if (error instanceof FavoriteSupersededError) return;
        this.state.set(
            favoriteFailureState(error, this.sources.state() === 'locked')
        );
        this.error.set(true);
    }
    async project<T extends Playlist>(playlist: T): Promise<T> {
        if (!playlist) return playlist;
        await prepareFavoriteHash();
        this.ensureClient();
        return this.playlistAdapter!.project(playlist);
    }
    async mutate(
        playlist: Playlist,
        transform: (
            current: NonNullable<Playlist['favorites']>
        ) => NonNullable<Playlist['favorites']>,
        persistLocal?: (
            favorites: NonNullable<Playlist['favorites']>
        ) => Promise<void>
    ) {
        this.error.set(false);
        const client = this.ensureClient();
        if (!favoritesEnabled() && !client.contexts.has(playlist._id))
            return null;
        try {
            const result = await this.playlistAdapter!.mutate(
                playlist,
                transform,
                persistLocal
            );
            await this.summary();
            return result;
        } catch (error) {
            this.reportFailure(error);
            throw error;
        }
    }
    async invoke(raw: IXtreamDataSource, method: string, args: unknown[]) {
        this.error.set(false);
        const client = this.ensureClient();
        if (method === 'supportsPortableFavorites')
            return favoritesEnabled() || client.contexts.has(String(args[0]));
        const sourceId = String(args[method === 'getFavorites' ? 0 : 1]);
        if (!favoritesEnabled() && !client.contexts.has(sourceId))
            return Reflect.apply(Reflect.get(raw, method), raw, args);
        try {
            const result = await this.xtreamAdapter!.invoke(raw, method, args);
            await this.summary();
            return result;
        } catch (error) {
            this.reportFailure(error);
            throw error;
        }
    }
    exportFavorites(
        playlist: Playlist,
        entry: PlaylistBackupEntry
    ): Promise<PlaylistBackupEntry> {
        const client = this.ensureClient();
        return projectFavoriteBackup(
            client,
            this.playlistAdapter!,
            playlist,
            entry
        );
    }
    backupRestorer() {
        return createFavoriteBackupRestorer(
            this.ensureClient(),
            this.playlistAdapter!,
            (id) => firstValueFrom(this.playlists.getPlaylistById(id))
        );
    }
    async previewImport(): Promise<FavoritesImportPreview> {
        const client = this.ensureClient();
        const generation = client.options.consent();
        if (!generation) throw new Error('Favorite consent disabled');
        return previewLocalFavorites(
            client,
            this.raw,
            this.playlistAdapter!,
            await this.sourceRows(),
            (id) => firstValueFrom(this.playlists.getPlaylistById(id)),
            generation
        );
    }
    async importFavorites(preview: FavoritesImportPreview): Promise<number> {
        const unresolved = await importFavoritePreview(
            this.ensureClient(),
            preview
        );
        await this.summary();
        return unresolved;
    }
    async resolve(address: FavoriteAddress, local: boolean) {
        await this.ensureClient().resolve(address, local);
        await this.summary();
        await this.publish();
    }
    async parked(send: boolean) {
        const client = this.ensureClient();
        for (const source of await this.sourceRows())
            await client.parked(source._id, send);
        await this.summary();
        await this.publish();
    }
    private readonly sourceNames = new Map<string, string>();
    sourceTitle = (id: string): string => this.sourceNames.get(id) ?? id;
    private async sourceRows() {
        const instance = sourceConnection()?.instanceId;
        const rows = await firstValueFrom(this.playlists.getAllPlaylists());
        if (sourceConnection()?.instanceId !== instance) return rows;
        for (const row of rows)
            this.sourceNames.set(row._id, row.title || row.filename || row._id);
        return rows;
    }
    private async summary() {
        if (!this.client) return;
        const generation = readFavoritesConsent()?.generation;
        const client = this.client;
        const summary = await readFavoriteSummary(client, generation);
        if (
            this.client !== client ||
            sourceConnection()?.instanceId !== client.options.instanceId ||
            readFavoritesConsent()?.generation !== generation
        )
            return;
        this.pending.set(summary.pending);
        this.parkedCount.set(summary.parked);
        this.conflicts.set(summary.conflicts);
        if (
            favoritesEnabled() &&
            !['offline', 'locked', 'incompatible', 'storage-error'].includes(
                this.state()
            )
        )
            this.state.set(summary.state);
        return summary;
    }
    private publish() {
        return refreshFavoriteViews(
            this.playlists,
            (playlist) => this.project(playlist),
            this.router,
            this.store
        );
    }
}
