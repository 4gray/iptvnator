/* eslint-disable @typescript-eslint/no-unused-vars */
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { parse } from 'iptv-playlist-parser';
import {
    aggregateFavoriteChannels,
    createFavoritesPlaylist,
    createPlaylistObject,
} from 'm3u-utils';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import {
    combineLatest,
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
    isM3uRecentlyViewedItem,
    M3uRecentlyViewedItem,
    Playlist,
    PlaylistMeta,
    PlaylistRecentlyViewedItem,
    PlaylistUpdateState,
    StalkerPortalItem,
    normalizeStalkerDate,
} from 'shared-interfaces';

const SQLITE_PLAYLIST_MIGRATION_FLAG = 'm3u-playlists-indexeddb-to-sqlite-v1';

type PortalFavoriteItem = StalkerPortalItem & {
    category_id?: string;
    raw?: string;
    [key: string]: unknown;
};

type PlaylistRawItem = {
    raw?: string;
};

@Injectable({
    providedIn: 'root',
})
export class PlaylistsService {
    private readonly dbService = inject(NgxIndexedDBService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private migrationPromise: Promise<void> | null = null;

    private get isElectronStorageAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            !!window.electron &&
            typeof window.electron.dbGetAppPlaylists === 'function' &&
            typeof window.electron.dbUpsertAppPlaylist === 'function' &&
            typeof window.electron.dbGetAppState === 'function' &&
            typeof window.electron.dbSetAppState === 'function'
        );
    }

    private runOnSqlite<T>(operation: () => Promise<T>) {
        return from(
            this.ensureSqlitePlaylistMigration().then(() => operation())
        );
    }

    private async ensureSqlitePlaylistMigration(): Promise<void> {
        if (!this.isElectronStorageAvailable) {
            return;
        }

        if (!this.migrationPromise) {
            this.migrationPromise = this.migrateIndexedDbPlaylistsToSqlite();
        }

        return this.migrationPromise;
    }

    private async migrateIndexedDbPlaylistsToSqlite(): Promise<void> {
        try {
            const alreadyMigrated = await window.electron.dbGetAppState(
                SQLITE_PLAYLIST_MIGRATION_FLAG
            );
            if (alreadyMigrated === '1') {
                return;
            }

            const indexedDbPlaylists = await firstValueFrom(
                this.dbService.getAll<Playlist>(DbStores.Playlists)
            );

            if (indexedDbPlaylists.length > 0) {
                await window.electron.dbUpsertAppPlaylists(indexedDbPlaylists);
                await firstValueFrom(this.dbService.clear(DbStores.Playlists));
            }

            await window.electron.dbSetAppState(
                SQLITE_PLAYLIST_MIGRATION_FLAG,
                '1'
            );
        } catch (error) {
            console.error(
                'Failed to migrate IndexedDB playlists to SQLite:',
                error
            );
        }
    }

    private createSqliteFallbackPlaylist(
        playlist: Partial<Playlist> & { _id?: string; id?: string }
    ): Playlist {
        const id = String(playlist._id ?? playlist.id ?? '');
        return this.normalizeStalkerPortalFlags({
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
            isCustomPortal: playlist.isCustomPortal,
            customPortalKey: playlist.customPortalKey,
            customPortalOriginalUrl: playlist.customPortalOriginalUrl,
            stalkerToken: playlist.stalkerToken,
            stalkerAccountInfo: playlist.stalkerAccountInfo,
        } as Playlist);
    }

    /**
     * Full Stalker portals (e.g. Ministra) require handshake/token auth.
     * Infer the mode from URL when legacy records are missing explicit flag.
     */
    private normalizeStalkerPortalFlags(playlist: Playlist): Playlist {
        if (
            !playlist?.macAddress ||
            playlist.isFullStalkerPortal !== undefined
        ) {
            return playlist;
        }

        const portalUrl = playlist.portalUrl ?? playlist.url ?? '';
        const isFullPortal =
            portalUrl.includes('/stalker_portal') ||
            portalUrl.includes('/server/load.php');

        return {
            ...playlist,
            isFullStalkerPortal: isFullPortal,
        };
    }

    private upsertSqlitePlaylist(playlist: Playlist) {
        return this.runOnSqlite(async () => {
            await window.electron.dbUpsertAppPlaylist(playlist);
            return playlist;
        });
    }

    private upsertManySqlitePlaylists(playlists: Playlist[]) {
        return this.runOnSqlite(async () => {
            await window.electron.dbUpsertAppPlaylists(playlists);
            return playlists;
        });
    }

    getAllPlaylists() {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(async () => {
                const playlists = await window.electron.dbGetAppPlaylists();
                return (playlists as Playlist[]).map(
                    ({ playlist, items, header, ...rest }) => ({
                        ...this.normalizeStalkerPortalFlags(rest as Playlist),
                    })
                );
            });
        }

        return this.dbService.getAll<Playlist>(DbStores.Playlists).pipe(
            map((data) =>
                data.map(({ playlist, items, header, ...rest }) => ({
                    ...this.normalizeStalkerPortalFlags(rest as Playlist),
                }))
            )
        );
    }

    addPlaylist(playlist: Playlist) {
        if (this.isElectronStorageAvailable) {
            return this.upsertSqlitePlaylist(playlist);
        }

        return this.dbService.add(DbStores.Playlists, playlist);
    }

    getPlaylist(id: string) {
        if (id === 'global-favorites') {
            return this.getPlaylistWithGlobalFavorites();
        }
        return this.getPlaylistById(id);
    }

    deletePlaylist(playlistId: string): Observable<{ success: boolean }> {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(() =>
                window.electron.dbDeletePlaylist(playlistId)
            ).pipe(map(() => ({ success: true })));
        }

        return this.dbService
            .delete(DbStores.Playlists, playlistId)
            .pipe(map(() => ({ success: true })));
    }

    updatePlaylist(playlistId: string, updatedPlaylist: Playlist) {
        return this.getPlaylistById(playlistId).pipe(
            switchMap((currentPlaylist: Playlist) => {
                const mergedPlaylist: Playlist = {
                    ...currentPlaylist,
                    ...updatedPlaylist,
                    _id: playlistId,
                    count:
                        updatedPlaylist.playlist?.items?.length ??
                        currentPlaylist.count,
                    updateDate: Date.now(),
                    updateState: PlaylistUpdateState.UPDATED,
                    favorites: currentPlaylist.favorites,
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(mergedPlaylist);
                }

                return this.dbService.update(
                    DbStores.Playlists,
                    mergedPlaylist
                );
            })
        );
    }

    getPlaylistById(id: string) {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(async () => {
                const playlist = await window.electron.dbGetAppPlaylist(id);
                return playlist
                    ? this.createSqliteFallbackPlaylist(playlist as Playlist)
                    : (undefined as unknown as Playlist);
            });
        }

        return this.dbService.getByID<Playlist>(DbStores.Playlists, id);
    }

    updatePlaylistMeta(updatedPlaylist: PlaylistMeta) {
        return this.getPlaylistById(updatedPlaylist._id).pipe(
            switchMap((playlist) => {
                const nextPlaylist: Playlist = {
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
                    ...(updatedPlaylist.serverUrl != null
                        ? { serverUrl: updatedPlaylist.serverUrl }
                        : {}),
                    ...(updatedPlaylist.portalUrl != null
                        ? { portalUrl: updatedPlaylist.portalUrl }
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
                    ...(updatedPlaylist.updateDate !== undefined
                        ? { updateDate: updatedPlaylist.updateDate }
                        : {}),
                    ...(updatedPlaylist.stalkerSerialNumber !== undefined
                        ? {
                            stalkerSerialNumber:
                                updatedPlaylist.stalkerSerialNumber,
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
                            stalkerSignature1:
                                updatedPlaylist.stalkerSignature1,
                        }
                        : {}),
                    ...(updatedPlaylist.stalkerSignature2 !== undefined
                        ? {
                            stalkerSignature2:
                                updatedPlaylist.stalkerSignature2,
                        }
                        : {}),
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }

    updateFavorites(id: string, favorites: string[]) {
        return this.getPlaylistById(id).pipe(
            switchMap((playlist) => {
                const nextPlaylist: Playlist = {
                    ...playlist,
                    favorites,
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }

    updateManyPlaylists(playlists: Playlist[]) {
        if (playlists.length === 0) {
            return of([]);
        }

        if (this.isElectronStorageAvailable) {
            const updatedPlaylists = playlists.map((playlist) => ({
                ...playlist,
                updateDate: Date.now(),
                autoRefresh: true,
            }));
            return this.upsertManySqlitePlaylists(updatedPlaylists);
        }

        return combineLatest(
            playlists.map((playlist) => {
                return this.dbService.update(DbStores.Playlists, {
                    ...playlist,
                    updateDate: Date.now(),
                    autoRefresh: true,
                });
            })
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
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const nextPlaylist: Playlist = {
                    ...portal,
                    favorites: [...(portal.favorites ?? []), item],
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }

    removeFromPortalFavorites(portalId: string, favoriteId: number | string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const nextPlaylist: Playlist = {
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
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
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

        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(async () => {
                const playlists =
                    (await window.electron.dbGetAppPlaylists()) as Playlist[];
                const positionsById = new Map(
                    positionUpdates.map((item) => [
                        item.id,
                        item.changes.position,
                    ])
                );

                const updatedPlaylists = playlists
                    .filter((playlist) => positionsById.has(playlist._id))
                    .map((playlist) => ({
                        ...playlist,
                        position: positionsById.get(playlist._id),
                    }));

                await window.electron.dbUpsertAppPlaylists(updatedPlaylists);
                return updatedPlaylists;
            });
        }

        return combineLatest(
            positionUpdates.map((item) => {
                return this.dbService
                    .getByID<Playlist>(DbStores.Playlists, item.id)
                    .pipe(
                        switchMap((playlist: Playlist) =>
                            this.dbService.update(DbStores.Playlists, {
                                ...playlist,
                                position: item.changes.position,
                            })
                        )
                    );
            })
        );
    }

    handlePlaylistParsing(
        uploadType: 'FILE' | 'URL' | 'TEXT',
        playlist: string,
        title: string,
        path?: string
    ) {
        try {
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

    addManyPlaylists(playlists: Playlist[]) {
        if (this.isElectronStorageAvailable) {
            return this.upsertManySqlitePlaylists(playlists);
        }

        return this.dbService.bulkAdd(
            DbStores.Playlists,
            playlists as unknown as Playlist[]
        );
    }

    getPlaylistsForAutoUpdate() {
        return this.getAllData().pipe(
            map((playlists: Playlist[]) => {
                return playlists
                    .filter((item) => item.autoRefresh)
                    .map(
                        ({
                            playlist,
                            header,
                            items,
                            favorites,
                            ...rest
                        }: Playlist) => rest
                    );
            })
        );
    }

    setFavorites(playlistId: string, favorites: string[]) {
        return this.getPlaylistById(playlistId).pipe(
            switchMap((playlist) => {
                const nextPlaylist: Playlist = {
                    ...playlist,
                    favorites,
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
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
            return this.runOnSqlite(async () =>
                ((await window.electron.dbGetAppPlaylists()) as Playlist[]).map(
                    (playlist) => this.normalizeStalkerPortalFlags(playlist)
                )
            );
        }

        return this.dbService.getAll<Playlist>(DbStores.Playlists);
    }

    removeAll(): Observable<void> {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(() =>
                window.electron.dbDeleteAllPlaylists()
            ).pipe(map(() => undefined));
        }

        return this.dbService
            .clear(DbStores.Playlists)
            .pipe(map(() => undefined));
    }

    private normalizePortalRecentIdentity(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) {
            return '';
        }
        return raw.includes(':') ? raw.split(':')[0] : raw;
    }

    private getPlaylistRecentIdentity(item: PlaylistRecentlyViewedItem): string {
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

        return this.getPlaylistById(playlistId).pipe(
            switchMap((playlist) => {
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
                const nextPlaylist: Playlist = {
                    ...playlist,
                    recentlyViewed: [nextItem, ...remainingItems],
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }

    removeFromPlaylistRecentlyViewed(
        playlistId: string,
        identity: string | number
    ) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.getPlaylistById(playlistId).pipe(
            switchMap((playlist) => {
                const nextPlaylist: Playlist = {
                    ...playlist,
                    recentlyViewed: (
                        playlist.recentlyViewed as PlaylistRecentlyViewedItem[]
                    )?.filter(
                        (item) =>
                            !this.matchesPlaylistRecentIdentity(
                                item,
                                identity
                            )
                    ),
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }

    clearPlaylistRecentlyViewed(playlistId: string) {
        if (!playlistId) {
            throw new Error('Playlist ID is required');
        }

        return this.getPlaylistById(playlistId).pipe(
            switchMap((playlist) => {
                const nextPlaylist: Playlist = {
                    ...playlist,
                    recentlyViewed: [],
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
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