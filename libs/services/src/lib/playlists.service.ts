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
    of,
    switchMap,
} from 'rxjs';
import {
    Channel,
    DbStores,
    Playlist,
    PlaylistMeta,
    PlaylistUpdateState,
    XtreamItem,
    XtreamSerieItem,
} from 'shared-interfaces';

const SQLITE_PLAYLIST_MIGRATION_FLAG =
    'm3u-playlists-indexeddb-to-sqlite-v1';

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
        return {
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
                        ...rest,
                    })
                );
            });
        }

        return this.dbService.getAll<Playlist>(DbStores.Playlists).pipe(
            map((data) =>
                data.map(({ playlist, items, header, ...rest }) => ({
                    ...rest,
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

    deletePlaylist(playlistId: string) {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(() =>
                window.electron.dbDeletePlaylist(playlistId)
            );
        }

        return this.dbService.delete(DbStores.Playlists, playlistId);
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
                    : (undefined as any);
            });
        }

        return this.dbService.getByID<Playlist>(DbStores.Playlists, id);
    }

    updatePlaylistMeta(updatedPlaylist: PlaylistMeta) {
        return this.getPlaylistById(updatedPlaylist._id).pipe(
            switchMap((playlist) => {
                const nextPlaylist: Playlist = {
                    ...playlist,
                    title: updatedPlaylist.title,
                    autoRefresh: updatedPlaylist.autoRefresh,
                    userAgent: updatedPlaylist.userAgent,
                    ...(updatedPlaylist.serverUrl !== null
                        ? { serverUrl: updatedPlaylist.serverUrl }
                        : {}),
                    ...(updatedPlaylist.portalUrl !== null
                        ? { portalUrl: updatedPlaylist.portalUrl }
                        : {}),
                    ...(updatedPlaylist.macAddress !== null
                        ? { macAddress: updatedPlaylist.macAddress }
                        : {}),
                    ...(updatedPlaylist.username !== null
                        ? { username: updatedPlaylist.username }
                        : {}),
                    ...(updatedPlaylist.password !== null
                        ? { password: updatedPlaylist.password }
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
                return item.favorites as Partial<XtreamItem>[];
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
                return (item.favorites as Partial<XtreamItem>[]).filter(
                    (itm) =>
                        itm && itm.stream_type && itm.stream_type === 'live'
                );
            })
        );
    }

    addPortalFavorite(portalId: string, item: any) {
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
                        const streamId = String(
                            (i as Partial<XtreamItem>).stream_id ?? ''
                        );
                        const seriesId = String(
                            (i as Partial<XtreamSerieItem>).series_id ?? ''
                        );
                        const movieId = String(
                            (i as Partial<{ movie_id: string }>).movie_id ?? ''
                        );
                        const itemId = String((i as any).id ?? '');

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
                    positionUpdates.map((item) => [item.id, item.changes.position])
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
                        .map((item: any) => item.raw)
                        .join('\n')
                );
            })
        );
    }

    getAllData() {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(
                async () => (await window.electron.dbGetAppPlaylists()) as Playlist[]
            );
        }

        return this.dbService.getAll<Playlist>(DbStores.Playlists);
    }

    removeAll() {
        if (this.isElectronStorageAvailable) {
            return this.runOnSqlite(() => window.electron.dbDeleteAllPlaylists());
        }

        return this.dbService.clear(DbStores.Playlists);
    }

    getPortalRecentlyViewed(portalId: string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.getPlaylistById(portalId).pipe(
            map((item) => {
                if (!item || !item.recentlyViewed) return [];
                return item.recentlyViewed as Partial<XtreamItem>[];
            }),
            map((items) =>
                items.sort(
                    (a, b) =>
                        new Date(b.added_at ?? '').getTime() -
                        new Date(a.added_at ?? '').getTime()
                )
            )
        );
    }

    addPortalRecentlyViewed(
        portalId: string,
        item: { id: string; title: string }
    ) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const nowIso = new Date().toISOString();
                const recentItems = portal.recentlyViewed ?? [];
                const existingIndex = recentItems.findIndex(
                    (i: any) => String(i?.id) === String(item.id)
                );

                if (existingIndex >= 0) {
                    const updatedRecentItems = [...recentItems];
                    updatedRecentItems[existingIndex] = {
                        ...updatedRecentItems[existingIndex],
                        ...item,
                        added_at: nowIso,
                    };

                    const nextPlaylist: Playlist = {
                        ...portal,
                        recentlyViewed: updatedRecentItems,
                    };

                    if (this.isElectronStorageAvailable) {
                        return this.upsertSqlitePlaylist(nextPlaylist);
                    }

                    return this.dbService.update(
                        DbStores.Playlists,
                        nextPlaylist
                    );
                }

                const nextPlaylist: Playlist = {
                    ...portal,
                    recentlyViewed: [
                        ...recentItems,
                        {
                            ...item,
                            added_at: (item as any).added_at ?? nowIso,
                        },
                    ],
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }

    removeFromPortalRecentlyViewed(portalId: string, id: string | number) {
        const normalizePortalItemId = (value: unknown): string => {
            const raw = String(value ?? '').trim();
            if (!raw) return '';
            return raw.includes(':') ? raw.split(':')[0] : raw;
        };

        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const expectedId = String(id);
                const expectedNormalized = normalizePortalItemId(id);

                const nextPlaylist: Playlist = {
                    ...portal,
                    recentlyViewed: portal.recentlyViewed?.filter((i: any) => {
                        const itemId = String(i?.id ?? '');
                        const itemNormalized = normalizePortalItemId(itemId);
                        return (
                            itemId !== expectedId &&
                            itemNormalized !== expectedNormalized
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

    clearPortalRecentlyViewed(portalId: string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const nextPlaylist: Playlist = {
                    ...portal,
                    recentlyViewed: [],
                };

                if (this.isElectronStorageAvailable) {
                    return this.upsertSqlitePlaylist(nextPlaylist);
                }

                return this.dbService.update(DbStores.Playlists, nextPlaylist);
            })
        );
    }
}
