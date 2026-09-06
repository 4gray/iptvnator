import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
    aggregateFavoriteChannels,
    createFavoritesPlaylist,
    createPlaylistObject,
    resolvePlaylistEpgSourceState,
} from '@iptvnator/shared/m3u-utils';
import { DBMode, NgxIndexedDBService } from 'ngx-indexed-db';
import {
    combineLatest,
    defer,
    firstValueFrom,
    from,
    map,
    Observable,
    of,
    switchMap,
} from 'rxjs';
import {
    Channel,
    DbStores,
    extractStalkerItemId,
    isFullStalkerPortalUrl,
    isM3uRecentlyViewedItem,
    M3uFavoriteChannel,
    M3uRecentlyViewedItem,
    Playlist,
    PlaylistMetaUpdate,
    PlaylistRecentlyViewedItem,
    PlaylistUpdateState,
    StalkerPortalItem,
    normalizeStalkerDate,
} from '@iptvnator/shared/interfaces';
import { PLAYLIST_DELETE_CLEANUP } from './playlist-delete-cleanup.token';
import {
    runWithPlaylistAuthorityMutation,
    runWithPlaylistAuthorityReset,
} from './playlist-cross-context-lock';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

const SQLITE_PLAYLIST_MIGRATION_FLAG = 'm3u-playlists-indexeddb-to-sqlite-v1';
const STALKER_PLAYLIST_METADATA_MIGRATION_FLAG =
    'm3u-playlists-stalker-metadata-v1';

type PortalFavoriteItem = StalkerPortalItem & {
    category_id?: string;
    raw?: string;
    [key: string]: unknown;
};

type PlaylistRawItem = {
    raw?: string;
};

type PlaylistStorageElectronApi = {
    dbDeleteAllPlaylists: () => Promise<unknown>;
    dbDeletePlaylist: (playlistId: string) => Promise<unknown>;
    dbGetAppPlaylist: (
        playlistId: string,
        operationId?: string
    ) => Promise<Playlist | null>;
    dbGetAppPlaylistFavoriteChannels?: (
        playlistId: string
    ) => Promise<M3uFavoriteChannel[]>;
    dbGetAppPlaylistMetas?: () => Promise<Playlist[]>;
    dbGetAppPlaylists: () => Promise<Playlist[]>;
    dbGetAppState: (key: string) => Promise<string | null>;
    dbSetAppState: (key: string, value: string) => Promise<unknown>;
    dbUpsertAppPlaylist: (
        playlist: Playlist,
        operationId?: string
    ) => Promise<unknown>;
    dbMigrateAppPlaylists: (playlists: Playlist[]) => Promise<unknown>;
    dbRecoverLegacyPlaylists?: () => Promise<void>;
    dbUpsertAppPlaylists: (playlists: Playlist[]) => Promise<unknown>;
};

type PlaylistStorageWindow = Window & {
    electron?: PlaylistStorageElectronApi;
};

type AddManyPlaylistsResult = Playlist[] | IDBValidKey[];

type PlaylistParserModule = Partial<typeof import('iptv-playlist-parser')> & {
    default?: Partial<typeof import('iptv-playlist-parser')>;
};

export function resolvePlaylistParser(parserModule: PlaylistParserModule) {
    const parse = parserModule.parse ?? parserModule.default?.parse;

    if (!parse) {
        throw new Error('iptv-playlist-parser parse export was not found');
    }

    return parse;
}

@Injectable({
    providedIn: 'root',
})
export class PlaylistsService {
    private readonly dbService = inject(NgxIndexedDBService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly playlistDeleteCleanups =
        inject(PLAYLIST_DELETE_CLEANUP, { optional: true }) ?? [];
    private electronMigrationPromise: Promise<void> | null = null;
    private indexedDbMigrationPromise: Promise<void> | null = null;
    private readonly playlistWriteQueues = new Map<string, Promise<unknown>>();

    private get electronApi(): PlaylistStorageElectronApi | null {
        if (typeof window === 'undefined') {
            return null;
        }

        return (window as PlaylistStorageWindow).electron ?? null;
    }

    private get isElectronStorageAvailable(): boolean {
        return this.runtime.supportsSqlite;
    }

    private runOnSqlite<T>(operation: () => Promise<T>) {
        return from(
            this.ensureElectronPlaylistMigrations().then(() => operation())
        );
    }

    private runOnIndexedDb<T>(operation: () => Promise<T>) {
        return from(
            this.ensureIndexedDbPlaylistMigrations().then(() => operation())
        );
    }

    private async ensureElectronPlaylistMigrations(): Promise<void> {
        if (!this.isElectronStorageAvailable) {
            return;
        }

        if (!this.electronMigrationPromise) {
            this.electronMigrationPromise = (async () => {
                await this.migrateIndexedDbPlaylistsToSqlite();
                await this.electronApi?.dbRecoverLegacyPlaylists?.();
                await this.migrateStalkerPlaylistMetadataInSqlite();
            })().catch((error) => {
                this.electronMigrationPromise = null;
                throw error;
            });
        }

        return this.electronMigrationPromise;
    }

    private async ensureIndexedDbPlaylistMigrations(): Promise<void> {
        if (this.isElectronStorageAvailable) {
            return;
        }

        if (!this.indexedDbMigrationPromise) {
            this.indexedDbMigrationPromise =
                this.migrateStalkerPlaylistMetadataInIndexedDb();
        }

        return this.indexedDbMigrationPromise;
    }

    private toPlaylistMeta(playlist: Playlist): Playlist {
        const playlistMeta = { ...playlist };
        delete playlistMeta.playlist;
        delete playlistMeta.items;
        delete playlistMeta.header;
        return playlistMeta;
    }

    private toAutoUpdatePlaylistMeta(playlist: Playlist): Playlist {
        const playlistMeta = this.toPlaylistMeta(playlist);
        delete playlistMeta.favorites;
        return playlistMeta;
    }

    private async migrateIndexedDbPlaylistsToSqlite(): Promise<void> {
        const electron = this.electronApi;
        if (!electron) return;
        if (
            (await electron.dbGetAppState(SQLITE_PLAYLIST_MIGRATION_FLAG)) ===
            '1'
        )
            return;
        const playlists = await firstValueFrom(
            this.dbService.getAll<Playlist>(DbStores.Playlists)
        );
        if (playlists.length) {
            // The worker commits rows and the receipt atomically. Keep the
            // original IndexedDB as a recovery source, even after success.
            await electron.dbMigrateAppPlaylists(playlists);
        } else {
            await electron.dbSetAppState(SQLITE_PLAYLIST_MIGRATION_FLAG, '1');
        }
    }

    private createSqliteFallbackPlaylist(
        playlist: Partial<Playlist> & { _id?: string; id?: string }
    ): Playlist {
        const id = String(playlist._id ?? playlist.id ?? '');
        return {
            ...playlist,
            _id: id,
            title: playlist.title ?? '',
            count: Number(playlist.count ?? 0),
            importDate: playlist.importDate ?? new Date().toISOString(),
            lastUsage: playlist.lastUsage ?? new Date().toISOString(),
            favorites: playlist.favorites ?? [],
            recentlyViewed: playlist.recentlyViewed ?? [],
            autoRefresh: Boolean(playlist.autoRefresh),
            playlist: playlist.playlist,
            url: playlist.url,
            filePath: playlist.filePath,
            epgUrls: playlist.epgUrls ?? [],
            detectedEpgUrls: playlist.detectedEpgUrls ?? playlist.epgUrls ?? [],
            manualEpgUrls: playlist.manualEpgUrls ?? [],
            disabledEpgUrls: playlist.disabledEpgUrls ?? [],
            userAgent: playlist.userAgent,
            referrer: playlist.referrer,
            origin: playlist.origin,
            updateDate: playlist.updateDate,
            updateState: playlist.updateState,
            position: playlist.position,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            macAddress: playlist.macAddress,
            portalUrl: playlist.portalUrl,
            stalkerSerialNumber: playlist.stalkerSerialNumber,
            stalkerDeviceId1: playlist.stalkerDeviceId1,
            stalkerDeviceId2: playlist.stalkerDeviceId2,
            stalkerSignature1: playlist.stalkerSignature1,
            stalkerSignature2: playlist.stalkerSignature2,
            isFullStalkerPortal: playlist.isFullStalkerPortal,
            stalkerToken: playlist.stalkerToken,
            // Without these the Electron cold read loses the persisted
            // cadence AND the identity the token was negotiated for, so the
            // mismatch check cannot run and the watchdog falls back to the
            // default.
            stalkerSessionIdentity: playlist.stalkerSessionIdentity,
            stalkerWatchdogTimeout: playlist.stalkerWatchdogTimeout,
            stalkerTimeslot: playlist.stalkerTimeslot,
            stalkerAccountInfo: playlist.stalkerAccountInfo,
        } as Playlist;
    }

    private withExplicitLegacyStalkerPortalFlag(playlist: Playlist): Playlist {
        if (
            !playlist?.macAddress ||
            playlist.isFullStalkerPortal !== undefined
        ) {
            return playlist;
        }

        const portalUrl = playlist.portalUrl ?? playlist.url ?? '';

        return {
            ...playlist,
            isFullStalkerPortal: isFullStalkerPortalUrl(portalUrl),
        };
    }

    private collectStalkerMetadataMigrationUpdates(
        playlists: Playlist[]
    ): Playlist[] {
        return playlists.reduce<Playlist[]>((updates, playlist) => {
            const migratedPlaylist =
                this.withExplicitLegacyStalkerPortalFlag(playlist);

            if (migratedPlaylist !== playlist) {
                updates.push(migratedPlaylist);
            }

            return updates;
        }, []);
    }

    private readIndexedDbMigrationFlag(key: string): string | null {
        try {
            const value = localStorage.getItem(key);
            return value && value.trim().length > 0 ? value : null;
        } catch {
            return null;
        }
    }

    private writeIndexedDbMigrationFlag(key: string): void {
        try {
            localStorage.setItem(key, '1');
        } catch {
            // Ignore storage write failures.
        }
    }

    private async migrateStalkerPlaylistMetadataInSqlite(): Promise<void> {
        try {
            const electron = this.electronApi;
            if (!electron) {
                return;
            }

            const alreadyMigrated = await electron.dbGetAppState(
                STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
            );
            if (alreadyMigrated === '1') {
                return;
            }

            const storedPlaylists =
                (await electron.dbGetAppPlaylists()) as Playlist[];
            const updates =
                this.collectStalkerMetadataMigrationUpdates(storedPlaylists);

            if (updates.length > 0) {
                await electron.dbUpsertAppPlaylists(updates);
            }

            await electron.dbSetAppState(
                STALKER_PLAYLIST_METADATA_MIGRATION_FLAG,
                '1'
            );
        } catch (error) {
            console.error(
                'Failed to migrate Stalker playlist metadata in SQLite:',
                error
            );
        }
    }

    private async migrateStalkerPlaylistMetadataInIndexedDb(): Promise<void> {
        try {
            if (
                this.readIndexedDbMigrationFlag(
                    STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                ) === '1'
            ) {
                return;
            }

            await new Promise<void>((resolve, reject) => {
                this.dbService
                    .openCursor<Playlist>({
                        storeName: DbStores.Playlists,
                        mode: DBMode.readwrite,
                    })
                    .subscribe({
                        next: (cursor) => {
                            try {
                                const migratedPlaylist =
                                    this.withExplicitLegacyStalkerPortalFlag(
                                        cursor.value
                                    );
                                if (migratedPlaylist !== cursor.value) {
                                    cursor.update(migratedPlaylist);
                                }
                                cursor.continue();
                            } catch (error) {
                                cursor.request.transaction?.abort();
                                reject(error);
                            }
                        },
                        error: reject,
                        complete: resolve,
                    });
            });

            this.writeIndexedDbMigrationFlag(
                STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
            );
        } catch (error) {
            console.error(
                'Failed to migrate Stalker playlist metadata in IndexedDB:',
                error
            );
        }
    }

    private upsertSqlitePlaylist(playlist: Playlist, operationId?: string) {
        return this.runOnSqlite(async () => {
            const electron = this.electronApi;
            if (!electron) {
                return playlist;
            }

            if (operationId === undefined) {
                await electron.dbUpsertAppPlaylist(playlist);
            } else {
                await electron.dbUpsertAppPlaylist(playlist, operationId);
            }
            return playlist;
        });
    }

    private upsertManySqlitePlaylists(playlists: Playlist[]) {
        return this.runOnSqlite(async () => {
            const electron = this.electronApi;
            if (!electron) {
                return playlists;
            }

            await electron.dbUpsertAppPlaylists(playlists);
            return playlists;
        });
    }

    // Every playlist mutation reads the row, patches it in memory, and writes
    // the whole row back. Overlapping mutations on the same playlist would be
    // last-write-wins, so all of them are chained per playlist id here.
    private serializePlaylistWrite<T>(
        playlistId: string,
        operation: () => Promise<T>
    ): Observable<T> {
        return defer(() => {
            const previous =
                this.playlistWriteQueues.get(playlistId) ?? Promise.resolve();
            const next = previous.then(() => operation());
            const tail = next.then(
                () => undefined,
                () => undefined
            );
            this.playlistWriteQueues.set(playlistId, tail);
            void tail.then(() => {
                if (this.playlistWriteQueues.get(playlistId) === tail) {
                    this.playlistWriteQueues.delete(playlistId);
                }
            });
            return next;
        });
    }

    private persistPlaylistMutation(
        nextPlaylist: Playlist,
        operationId?: string
    ) {
        if (this.isElectronStorageAvailable) {
            return firstValueFrom(
                this.upsertSqlitePlaylist(nextPlaylist, operationId)
            );
        }

        return firstValueFrom(
            this.dbService.update(DbStores.Playlists, nextPlaylist)
        );
    }

    private transformIndexedDbPlaylistMeta(
        playlistId: string,
        transform: (current: Playlist) => Playlist | null
    ): Promise<Playlist | null> {
        return new Promise((resolve, reject) => {
            let nextPlaylist: Playlist | null = null;
            this.dbService
                .openCursor<Playlist>({
                    storeName: DbStores.Playlists,
                    query: playlistId,
                    mode: DBMode.readwrite,
                })
                .subscribe({
                    next: (cursor) => {
                        try {
                            nextPlaylist = transform(cursor.value);
                            if (nextPlaylist !== null) {
                                cursor.update(nextPlaylist);
                            }
                        } catch (error) {
                            cursor.request.transaction?.abort();
                            reject(error);
                        }
                    },
                    error: reject,
                    complete: () => resolve(nextPlaylist),
                });
        });
    }

    getAllPlaylists() {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(async () => {
                const electron = this.electronApi;
                const playlists = electron
                    ? await (electron.dbGetAppPlaylistMetas?.() ??
                          electron.dbGetAppPlaylists())
                    : [];
                return (playlists as Playlist[]).map((playlist) =>
                    this.toPlaylistMeta(playlist)
                );
            });
        }

        return this.runOnIndexedDb(() =>
            firstValueFrom(this.dbService.getAll<Playlist>(DbStores.Playlists))
        ).pipe(
            map((data) => data.map((playlist) => this.toPlaylistMeta(playlist)))
        );
    }

    addPlaylist(playlist: Playlist) {
        return this.serializePlaylistWrite(playlist._id, () =>
            runWithPlaylistAuthorityMutation([playlist._id], async () => {
                if (this.isElectronStorageAvailable) {
                    return firstValueFrom(this.upsertSqlitePlaylist(playlist));
                }

                await firstValueFrom(
                    this.dbService.add(DbStores.Playlists, playlist)
                );
                return playlist;
            })
        );
    }

    getPlaylist(id: string) {
        if (id === 'global-favorites') {
            return this.getPlaylistWithGlobalFavorites();
        }
        return this.getPlaylistById(id);
    }

    deletePlaylist(playlistId: string): Observable<{ success: boolean }> {
        // Deletion goes through the SAME per-playlist queue as every write:
        // a queued mutation (e.g. the Stalker portal repair's conditional
        // transform) landing after an unserialized delete would upsert the
        // row back and resurrect the playlist.
        const delete$: Observable<unknown> = this.serializePlaylistWrite(
            playlistId,
            () =>
                runWithPlaylistAuthorityMutation([playlistId], async () => {
                    if (this.isElectronStorageAvailable) {
                        await this.ensureElectronPlaylistMigrations();
                        const electron = this.electronApi;
                        if (electron) {
                            await electron.dbDeletePlaylist(playlistId);
                        }
                        return undefined;
                    }

                    return firstValueFrom(
                        this.dbService.delete(DbStores.Playlists, playlistId)
                    );
                })
        );

        return delete$.pipe(
            switchMap(() => from(this.runPlaylistDeleteCleanups(playlistId))),
            map(() => ({ success: true }))
        );
    }

    private async runPlaylistDeleteCleanups(playlistId: string): Promise<void> {
        if (this.playlistDeleteCleanups.length === 0) {
            return;
        }

        const failures = (
            await Promise.all(
                this.playlistDeleteCleanups.map(async (cleanup) => {
                    try {
                        await cleanup(playlistId);
                        return null;
                    } catch (error) {
                        return error;
                    }
                })
            )
        ).filter((error) => error !== null);

        for (const failure of failures) {
            console.warn(
                'Playlist cleanup failed after playlist deletion:',
                failure
            );
        }
    }

    /**
     * Canonical refresh merge shared by the single-playlist update flow and
     * the auto-refresh batch. The refreshed payload only contributes
     * refresh-owned data (parsed content, count, EPG detection); user-owned
     * state on the freshly read row — favorites, recently viewed, ordering,
     * hidden groups, curated EPG sources — must survive the refresh write.
     */
    private mergeRefreshedPlaylist(
        currentPlaylist: Playlist | undefined,
        updatedPlaylist: Playlist,
        playlistId: string
    ): Playlist {
        const epgSourceState = resolvePlaylistEpgSourceState({
            detectedEpgUrls:
                updatedPlaylist.detectedEpgUrls ??
                currentPlaylist?.detectedEpgUrls,
            enabledEpgUrls: updatedPlaylist.epgUrls ?? currentPlaylist?.epgUrls,
            manualEpgUrls:
                updatedPlaylist.manualEpgUrls ?? currentPlaylist?.manualEpgUrls,
            disabledEpgUrls:
                updatedPlaylist.disabledEpgUrls ??
                currentPlaylist?.disabledEpgUrls,
        });

        return {
            ...currentPlaylist,
            ...updatedPlaylist,
            _id: playlistId,
            count:
                updatedPlaylist.playlist?.items?.length ??
                currentPlaylist?.count ??
                updatedPlaylist.count,
            updateDate: Date.now(),
            updateState: PlaylistUpdateState.UPDATED,
            ...(currentPlaylist
                ? {
                      favorites: currentPlaylist.favorites,
                      recentlyViewed: currentPlaylist.recentlyViewed,
                      position: currentPlaylist.position,
                  }
                : {}),
            epgUrls: epgSourceState.epgUrls,
            detectedEpgUrls: epgSourceState.detectedEpgUrls,
            manualEpgUrls: epgSourceState.manualEpgUrls,
            disabledEpgUrls: epgSourceState.disabledEpgUrls,
            autoRefresh:
                currentPlaylist?.autoRefresh ?? updatedPlaylist.autoRefresh,
        };
    }

    updatePlaylist(
        playlistId: string,
        updatedPlaylist: Playlist,
        operationId?: string
    ) {
        return this.serializePlaylistWrite(playlistId, async () => {
            const currentPlaylist = await firstValueFrom(
                this.getPlaylistById(playlistId, operationId)
            );
            const mergedPlaylist = this.mergeRefreshedPlaylist(
                currentPlaylist,
                updatedPlaylist,
                playlistId
            );

            return this.persistPlaylistMutation(mergedPlaylist, operationId);
        });
    }

    getPlaylistById(id: string, operationId?: string) {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(async () => {
                const electron = this.electronApi;
                let playlist: Playlist | null = null;
                if (electron) {
                    playlist =
                        operationId === undefined
                            ? await electron.dbGetAppPlaylist(id)
                            : await electron.dbGetAppPlaylist(id, operationId);
                }
                return playlist
                    ? this.createSqliteFallbackPlaylist(playlist as Playlist)
                    : (undefined as unknown as Playlist);
            });
        }

        return this.runOnIndexedDb(() =>
            firstValueFrom(
                this.dbService.getByID<Playlist>(DbStores.Playlists, id)
            )
        );
    }

    updatePlaylistMeta(updatedPlaylist: PlaylistMetaUpdate) {
        return this.updatePlaylistMetaInQueue(updatedPlaylist);
    }

    /** Applies a meta update only while the storage-current row still matches. */
    updatePlaylistMetaIfCurrent(
        updatedPlaylist: PlaylistMetaUpdate,
        isCurrent: (playlist: Playlist) => boolean
    ) {
        return this.updatePlaylistMetaInQueue(updatedPlaylist, isCurrent);
    }

    private updatePlaylistMetaInQueue(
        updatedPlaylist: PlaylistMetaUpdate
    ): Observable<Playlist>;
    private updatePlaylistMetaInQueue(
        updatedPlaylist: PlaylistMetaUpdate,
        isCurrent: (playlist: Playlist) => boolean
    ): Observable<Playlist | null>;
    private updatePlaylistMetaInQueue(
        updatedPlaylist: PlaylistMetaUpdate,
        isCurrent?: (playlist: Playlist) => boolean
    ): Observable<Playlist | null> {
        return this.serializePlaylistWrite(updatedPlaylist._id, async () => {
            if (isCurrent && !this.isElectronStorageAvailable) {
                await this.ensureIndexedDbPlaylistMigrations();
                return this.transformIndexedDbPlaylistMeta(
                    updatedPlaylist._id,
                    (current) =>
                        isCurrent(current)
                            ? this.mergePlaylistMeta(current, updatedPlaylist)
                            : null
                );
            }

            const playlist = await firstValueFrom(
                this.getPlaylistById(updatedPlaylist._id)
            );
            if (isCurrent && !isCurrent(playlist)) {
                return null;
            }
            return this.persistPlaylistMutation(
                this.mergePlaylistMeta(playlist, updatedPlaylist)
            );
        });
    }

    private mergePlaylistMeta(
        playlist: Playlist,
        updatedPlaylist: PlaylistMetaUpdate
    ): Playlist {
        const epgSourceState = resolvePlaylistEpgSourceState({
            detectedEpgUrls:
                updatedPlaylist.detectedEpgUrls ?? playlist.detectedEpgUrls,
            enabledEpgUrls: updatedPlaylist.epgUrls ?? playlist.epgUrls,
            manualEpgUrls:
                updatedPlaylist.manualEpgUrls ?? playlist.manualEpgUrls,
            disabledEpgUrls:
                updatedPlaylist.disabledEpgUrls ?? playlist.disabledEpgUrls,
        });
        return {
            ...playlist,
            ...(updatedPlaylist.title != null
                ? { title: updatedPlaylist.title }
                : {}),
            ...(updatedPlaylist.autoRefresh != null
                ? { autoRefresh: updatedPlaylist.autoRefresh }
                : {}),
            ...(updatedPlaylist.userAgent != null
                ? { userAgent: updatedPlaylist.userAgent }
                : {}),
            ...(updatedPlaylist.referrer !== undefined
                ? { referrer: updatedPlaylist.referrer }
                : {}),
            ...(updatedPlaylist.origin !== undefined
                ? { origin: updatedPlaylist.origin }
                : {}),
            ...(updatedPlaylist.serverUrl != null
                ? { serverUrl: updatedPlaylist.serverUrl }
                : {}),
            ...(updatedPlaylist.portalUrl != null
                ? { portalUrl: updatedPlaylist.portalUrl }
                : {}),
            ...(updatedPlaylist.serverTimezone != null
                ? { serverTimezone: updatedPlaylist.serverTimezone }
                : {}),
            ...(updatedPlaylist.isFullStalkerPortal !== undefined
                ? {
                      isFullStalkerPortal: updatedPlaylist.isFullStalkerPortal,
                  }
                : {}),
            ...(updatedPlaylist.macAddress != null
                ? { macAddress: updatedPlaylist.macAddress }
                : {}),
            ...(updatedPlaylist.username != null
                ? { username: updatedPlaylist.username }
                : {}),
            ...(updatedPlaylist.password != null
                ? { password: updatedPlaylist.password }
                : {}),
            ...(updatedPlaylist.favorites != null
                ? { favorites: updatedPlaylist.favorites }
                : {}),
            ...(updatedPlaylist.recentlyViewed != null
                ? { recentlyViewed: updatedPlaylist.recentlyViewed }
                : {}),
            ...(updatedPlaylist.hiddenGroupTitles != null
                ? {
                      hiddenGroupTitles: updatedPlaylist.hiddenGroupTitles,
                  }
                : {}),
            ...(updatedPlaylist.detectedEpgUrls !== undefined
                ? { detectedEpgUrls: epgSourceState.detectedEpgUrls }
                : {}),
            ...(updatedPlaylist.manualEpgUrls !== undefined
                ? { manualEpgUrls: epgSourceState.manualEpgUrls }
                : {}),
            ...(updatedPlaylist.disabledEpgUrls !== undefined
                ? { disabledEpgUrls: epgSourceState.disabledEpgUrls }
                : {}),
            ...(updatedPlaylist.epgUrls !== undefined ||
            updatedPlaylist.detectedEpgUrls !== undefined ||
            updatedPlaylist.manualEpgUrls !== undefined ||
            updatedPlaylist.disabledEpgUrls !== undefined
                ? { epgUrls: epgSourceState.epgUrls }
                : {}),
            ...(updatedPlaylist.updateDate !== undefined
                ? { updateDate: updatedPlaylist.updateDate }
                : {}),
            ...(updatedPlaylist.stalkerSerialNumber !== undefined
                ? {
                      stalkerSerialNumber: updatedPlaylist.stalkerSerialNumber,
                  }
                : {}),
            ...(updatedPlaylist.stalkerDeviceId1 !== undefined
                ? { stalkerDeviceId1: updatedPlaylist.stalkerDeviceId1 }
                : {}),
            ...(updatedPlaylist.stalkerDeviceId2 !== undefined
                ? { stalkerDeviceId2: updatedPlaylist.stalkerDeviceId2 }
                : {}),
            ...(updatedPlaylist.stalkerSignature1 !== undefined
                ? {
                      stalkerSignature1: updatedPlaylist.stalkerSignature1,
                  }
                : {}),
            ...(updatedPlaylist.stalkerSignature2 !== undefined
                ? {
                      stalkerSignature2: updatedPlaylist.stalkerSignature2,
                  }
                : {}),
            ...(updatedPlaylist.stalkerSessionPatch !== undefined
                ? {
                      stalkerToken:
                          updatedPlaylist.stalkerSessionPatch?.stalkerToken,
                      stalkerSessionIdentity:
                          updatedPlaylist.stalkerSessionPatch
                              ?.stalkerSessionIdentity,
                      stalkerWatchdogTimeout:
                          updatedPlaylist.stalkerSessionPatch
                              ?.stalkerWatchdogTimeout,
                      stalkerTimeslot:
                          updatedPlaylist.stalkerSessionPatch?.stalkerTimeslot,
                      stalkerAccountInfo:
                          updatedPlaylist.stalkerSessionPatch
                              ?.stalkerAccountInfo,
                  }
                : {}),
        };
    }

    /**
     * Persists a freshly negotiated Stalker session on the playlist so the
     * next app start can re-present the token (the portal handshake is
     * idempotent) and keep the portal's own watchdog cadence — reusing a
     * token skips the `get_profile` that carries the cadence, so it has to
     * survive with the token. No-ops when the playlist row does not exist
     * yet: the import flow saves both with the playlist itself.
     */
    updateStalkerSession(
        playlistId: string,
        session: {
            stalkerToken: string;
            stalkerSessionIdentity?: string;
            stalkerWatchdogTimeout?: number;
            stalkerTimeslot?: number;
        }
    ) {
        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );
            if (!playlist) {
                return null;
            }

            // The cadence is written unconditionally, including as
            // `undefined`: a portal that stops advertising one must not leave
            // a stale value behind for the next restart to re-apply, since
            // reusing the token skips the profile that would correct it.
            return this.persistPlaylistMutation({
                ...playlist,
                stalkerToken: session.stalkerToken,
                stalkerSessionIdentity: session.stalkerSessionIdentity,
                stalkerWatchdogTimeout: session.stalkerWatchdogTimeout,
                stalkerTimeslot: session.stalkerTimeslot,
            });
        });
    }

    updateFavorites(id: string, favorites: string[]) {
        return this.serializePlaylistWrite(id, async () => {
            const playlist = await firstValueFrom(this.getPlaylistById(id));

            return this.persistPlaylistMutation({
                ...playlist,
                favorites,
            });
        });
    }

    /**
     * Applies an atomic favorites update: the current favorites are read
     * inside the per-playlist write queue, so overlapping calls cannot work
     * from stale snapshots. Callers should pass a pure transform instead of
     * precomputing the next favorites array from an earlier read.
     */
    transformPlaylistFavorites(
        playlistId: string,
        transform: (
            currentFavorites: NonNullable<Playlist['favorites']>
        ) => NonNullable<Playlist['favorites']>
    ): Observable<Playlist> {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );
            if (!playlist) {
                throw new Error(`Playlist not found: ${playlistId}`);
            }

            const currentFavorites = Array.isArray(playlist.favorites)
                ? playlist.favorites
                : [];
            const nextPlaylist: Playlist = {
                ...playlist,
                favorites: transform(currentFavorites),
            };

            await this.persistPlaylistMutation(nextPlaylist);
            return nextPlaylist;
        });
    }

    /**
     * Applies an atomic, conditional meta mutation. Electron uses the
     * per-playlist write queue; IndexedDB additionally performs the read,
     * predicate, and cursor update in one readwrite transaction so another
     * browser context cannot interleave a replacement. The transform may
     * return null to abort without writing.
     */
    transformPlaylistMeta(
        playlistId: string,
        transform: (current: Playlist) => Playlist | null
    ): Observable<Playlist | null> {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.serializePlaylistWrite(playlistId, async () => {
            if (!this.isElectronStorageAvailable) {
                await this.ensureIndexedDbPlaylistMigrations();
                return this.transformIndexedDbPlaylistMeta(
                    playlistId,
                    transform
                );
            }

            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );
            if (!playlist) {
                return null;
            }

            const nextPlaylist = transform(playlist);
            if (nextPlaylist === null) {
                return null;
            }

            await this.persistPlaylistMutation(nextPlaylist);
            return nextPlaylist;
        });
    }

    updateManyPlaylists(playlists: Playlist[]) {
        if (playlists.length === 0) {
            return of([]);
        }

        // Auto-refresh payloads are snapshots taken before the refresh ran,
        // so each row goes through the same per-playlist queue and canonical
        // refresh merge as the single-playlist update flow: a batch write
        // cannot clobber a concurrent collection or metadata mutation.
        return combineLatest(
            playlists.map((playlist) =>
                this.serializePlaylistWrite(playlist._id, async () => {
                    const current = await firstValueFrom(
                        this.getPlaylistById(playlist._id)
                    );
                    // The merge takes autoRefresh from the current row first,
                    // so disabling auto-refresh while a refresh is in flight
                    // is not reverted by the completing batch write.
                    const nextPlaylist = this.mergeRefreshedPlaylist(
                        current,
                        playlist,
                        playlist._id
                    );

                    await this.persistPlaylistMutation(nextPlaylist);
                    return nextPlaylist;
                })
            )
        );
    }

    getFavoriteChannels(playlistId: string) {
        return this.getPlaylistById(playlistId).pipe(
            map((data) =>
                (data.playlist?.items ?? []).filter((channel: Channel) =>
                    data.favorites?.includes(channel.id)
                )
            )
        );
    }

    getM3uFavoriteChannels(
        playlistId: string
    ): Observable<M3uFavoriteChannel[] | null> {
        const electron = this.electronApi;
        const getFavoriteChannels = electron?.dbGetAppPlaylistFavoriteChannels;
        if (
            !electron ||
            !this.isElectronStorageAvailable ||
            typeof getFavoriteChannels !== 'function'
        ) {
            return of(null);
        }

        return from(
            (async () => {
                const alreadyMigrated = await electron.dbGetAppState(
                    SQLITE_PLAYLIST_MIGRATION_FLAG
                );
                if (alreadyMigrated !== '1') {
                    return null;
                }

                return getFavoriteChannels(playlistId);
            })()
        );
    }

    getPortalFavorites(portalId: string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }

        return this.getPlaylistById(portalId).pipe(
            map((item) => {
                if (!item || !item.favorites) return [];
                return item.favorites as PortalFavoriteItem[];
            }),
            map((favorites) =>
                favorites.sort(
                    (a, b) =>
                        new Date(b.added_at ?? '').getTime() -
                        new Date(a.added_at ?? '').getTime()
                )
            )
        );
    }

    getPortalLiveStreamFavorites(portalId: string) {
        return this.getPlaylistById(portalId).pipe(
            map((item) => {
                if (!item || !item.favorites) return [];
                return (item.favorites as PortalFavoriteItem[]).filter(
                    (itm) =>
                        itm && itm.stream_type && itm.stream_type === 'live'
                );
            })
        );
    }

    addPortalFavorite(portalId: string, item: PortalFavoriteItem) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.serializePlaylistWrite(portalId, async () => {
            const portal = await firstValueFrom(this.getPlaylistById(portalId));

            return this.persistPlaylistMutation({
                ...portal,
                favorites: [...(portal.favorites ?? []), item],
            });
        });
    }

    setPortalFavorites(portalId: string, favorites: StalkerPortalItem[]) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }

        return this.serializePlaylistWrite(portalId, async () => {
            const portal = await firstValueFrom(this.getPlaylistById(portalId));

            return this.persistPlaylistMutation({
                ...portal,
                favorites,
            });
        });
    }

    removeFromPortalFavorites(portalId: string, favoriteId: number | string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.serializePlaylistWrite(portalId, async () => {
            const portal = await firstValueFrom(this.getPlaylistById(portalId));

            return this.persistPlaylistMutation({
                ...portal,
                favorites: portal.favorites?.filter((i) => {
                    const expectedId = String(favoriteId);
                    const favorite = i as PortalFavoriteItem;
                    const streamId = String(favorite.stream_id ?? '');
                    const seriesId = String(favorite.series_id ?? '');
                    const movieId = String(favorite.movie_id ?? '');
                    const itemId = String(favorite.id ?? '');

                    return (
                        streamId !== expectedId &&
                        seriesId !== expectedId &&
                        movieId !== expectedId &&
                        itemId !== expectedId
                    );
                }),
            });
        });
    }

    updatePlaylistPositions(
        positionUpdates: {
            id: string;
            changes: { position: number };
        }[]
    ) {
        if (positionUpdates.length === 0) {
            return of([]);
        }

        return combineLatest(
            positionUpdates.map((item) =>
                this.serializePlaylistWrite(item.id, async () => {
                    const playlist = await firstValueFrom(
                        this.getPlaylistById(item.id)
                    );
                    if (!playlist) {
                        return null;
                    }

                    const nextPlaylist: Playlist = {
                        ...playlist,
                        position: item.changes.position,
                    };

                    await this.persistPlaylistMutation(nextPlaylist);
                    return nextPlaylist;
                })
            )
        );
    }

    async handlePlaylistParsing(
        uploadType: 'FILE' | 'URL' | 'TEXT',
        playlist: string,
        title: string,
        path?: string
    ) {
        try {
            // Dynamic import keeps the parser out of the eager bundle;
            // parse() only runs on user-triggered imports.
            const parserModule = await import('iptv-playlist-parser');
            const parse = resolvePlaylistParser(parserModule);
            const parsedPlaylist = parse(playlist);
            return createPlaylistObject(
                title,
                parsedPlaylist,
                path,
                uploadType
            );
        } catch (error) {
            this.snackBar.open(
                this.translateService.instant('HOME.PARSING_ERROR'),
                undefined,
                { duration: 2000 }
            );
            throw new Error(`Parsing failed, not a valid playlist: ${error}`);
        }
    }

    getPlaylistWithGlobalFavorites() {
        return this.getAllData().pipe(
            map((playlists: Playlist[]) => {
                const favoriteChannels = aggregateFavoriteChannels(playlists);
                const favPlaylist = createFavoritesPlaylist(favoriteChannels);
                return favPlaylist;
            })
        );
    }

    addManyPlaylists(
        playlists: Playlist[]
    ): Observable<AddManyPlaylistsResult> {
        return defer(() =>
            runWithPlaylistAuthorityMutation(
                playlists.map((playlist) => playlist._id),
                async () => {
                    if (this.isElectronStorageAvailable) {
                        return firstValueFrom(
                            this.upsertManySqlitePlaylists(playlists)
                        );
                    }

                    return firstValueFrom(
                        this.dbService.bulkAdd(
                            DbStores.Playlists,
                            playlists as unknown as Playlist[]
                        )
                    );
                }
            )
        );
    }

    getPlaylistsForAutoUpdate() {
        return this.getAllData().pipe(
            map((playlists: Playlist[]) => {
                return playlists
                    .filter((item) => item.autoRefresh)
                    .map((playlist) => this.toAutoUpdatePlaylistMeta(playlist));
            })
        );
    }

    setFavorites(playlistId: string, favorites: string[]) {
        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );

            return this.persistPlaylistMutation({
                ...playlist,
                favorites,
            });
        });
    }

    getRawPlaylistById(id: string) {
        return this.getPlaylistById(id).pipe(
            map((playlist) => {
                return (
                    `${playlist.playlist?.header?.raw ?? ''}` +
                    '\n' +
                    (playlist.playlist?.items ?? [])
                        .map((item: PlaylistRawItem) => item.raw)
                        .join('\n')
                );
            })
        );
    }

    getAllData() {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(async () => {
                const electron = this.electronApi;
                return electron
                    ? ((await electron.dbGetAppPlaylists()) as Playlist[])
                    : [];
            });
        }

        return this.runOnIndexedDb(() =>
            firstValueFrom(this.dbService.getAll<Playlist>(DbStores.Playlists))
        );
    }

    removeAll(): Observable<void> {
        return defer(() =>
            runWithPlaylistAuthorityReset(async () => {
                if (this.isElectronStorageAvailable) {
                    await this.ensureElectronPlaylistMigrations();
                    const electron = this.electronApi;
                    if (electron) {
                        await electron.dbDeleteAllPlaylists();
                    }
                    return undefined;
                }

                await firstValueFrom(this.dbService.clear(DbStores.Playlists));
                return undefined;
            })
        );
    }

    private normalizePortalRecentIdentity(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) {
            return '';
        }
        return raw.includes(':') ? raw.split(':')[0] : raw;
    }

    private getPlaylistRecentIdentity(
        item: PlaylistRecentlyViewedItem
    ): string {
        if (isM3uRecentlyViewedItem(item)) {
            return String(item.url ?? item.id ?? '').trim();
        }

        return this.normalizePortalRecentIdentity(
            extractStalkerItemId(item ?? {})
        );
    }

    private matchesPlaylistRecentIdentity(
        item: PlaylistRecentlyViewedItem,
        expectedIdentity: string | number
    ): boolean {
        const expectedRaw = String(expectedIdentity ?? '').trim();
        if (!expectedRaw) {
            return false;
        }

        if (isM3uRecentlyViewedItem(item)) {
            return this.getPlaylistRecentIdentity(item) === expectedRaw;
        }

        return (
            this.getPlaylistRecentIdentity(item) ===
            this.normalizePortalRecentIdentity(expectedRaw)
        );
    }

    private sortPlaylistRecentItems(
        items: PlaylistRecentlyViewedItem[]
    ): PlaylistRecentlyViewedItem[] {
        return [...items].sort(
            (a, b) =>
                new Date(normalizeStalkerDate(b.added_at ?? '')).getTime() -
                new Date(normalizeStalkerDate(a.added_at ?? '')).getTime()
        );
    }

    getPlaylistRecentlyViewed(playlistId: string) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.getPlaylistById(playlistId).pipe(
            map((item) => {
                if (!item || !Array.isArray(item.recentlyViewed)) {
                    return [];
                }
                return item.recentlyViewed as PlaylistRecentlyViewedItem[];
            }),
            map((items) => this.sortPlaylistRecentItems(items))
        );
    }

    addPlaylistRecentlyViewed(
        playlistId: string,
        item: PlaylistRecentlyViewedItem
    ) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );
            const nowIso = new Date().toISOString();
            const recentItems = Array.isArray(playlist.recentlyViewed)
                ? (playlist.recentlyViewed as PlaylistRecentlyViewedItem[])
                : [];
            const existingIndex = recentItems.findIndex((recentItem) =>
                this.matchesPlaylistRecentIdentity(
                    recentItem,
                    this.getPlaylistRecentIdentity(item)
                )
            );
            const existingItem =
                existingIndex >= 0 ? recentItems[existingIndex] : null;
            const nextItem: PlaylistRecentlyViewedItem = {
                ...(existingItem ?? {}),
                ...item,
                added_at: nowIso,
            };
            const remainingItems = recentItems.filter(
                (_, index) => index !== existingIndex
            );

            return this.persistPlaylistMutation({
                ...playlist,
                recentlyViewed: [nextItem, ...remainingItems],
            });
        });
    }

    removeFromPlaylistRecentlyViewed(
        playlistId: string,
        identity: string | number
    ) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );

            return this.persistPlaylistMutation({
                ...playlist,
                recentlyViewed: (
                    playlist.recentlyViewed as PlaylistRecentlyViewedItem[]
                )?.filter(
                    (item) =>
                        !this.matchesPlaylistRecentIdentity(item, identity)
                ),
            });
        });
    }

    removeFromPlaylistRecentlyViewedBatch(
        playlistId: string,
        identities: ReadonlyArray<string | number>
    ) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        if (identities.length === 0) {
            return this.getPlaylistById(playlistId);
        }

        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );

            return this.persistPlaylistMutation({
                ...playlist,
                recentlyViewed: (
                    playlist.recentlyViewed as PlaylistRecentlyViewedItem[]
                )?.filter(
                    (item) =>
                        !identities.some((identity) =>
                            this.matchesPlaylistRecentIdentity(item, identity)
                        )
                ),
            });
        });
    }

    clearPlaylistRecentlyViewed(playlistId: string) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.serializePlaylistWrite(playlistId, async () => {
            const playlist = await firstValueFrom(
                this.getPlaylistById(playlistId)
            );

            return this.persistPlaylistMutation({
                ...playlist,
                recentlyViewed: [],
            });
        });
    }

    getPortalRecentlyViewed(portalId: string) {
        return this.getPlaylistRecentlyViewed(portalId).pipe(
            map((items) =>
                items.filter(
                    (item): item is StalkerPortalItem =>
                        !isM3uRecentlyViewedItem(item)
                )
            )
        );
    }

    addPortalRecentlyViewed(
        portalId: string,
        item: StalkerPortalItem & { id: string | number; title: string }
    ) {
        return this.addPlaylistRecentlyViewed(portalId, item);
    }

    addM3uRecentlyViewed(playlistId: string, item: M3uRecentlyViewedItem) {
        return this.addPlaylistRecentlyViewed(playlistId, item);
    }

    removeFromPortalRecentlyViewed(portalId: string, id: string | number) {
        return this.removeFromPlaylistRecentlyViewed(portalId, id);
    }

    removeFromM3uRecentlyViewed(playlistId: string, channelUrl: string) {
        return this.removeFromPlaylistRecentlyViewed(playlistId, channelUrl);
    }

    clearPortalRecentlyViewed(portalId: string) {
        return this.clearPlaylistRecentlyViewed(portalId);
    }

    clearM3uRecentlyViewed(playlistId: string) {
        return this.clearPlaylistRecentlyViewed(playlistId);
    }
}
