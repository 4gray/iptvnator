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
import { combineLatest, EMPTY, map, switchMap } from 'rxjs';
import {
    Channel,
    DbStores,
    GLOBAL_FAVORITES_PLAYLIST_ID,
    Playlist,
    PlaylistMeta,
    PlaylistUpdateState,
    XtreamItem,
    XtreamSerieItem,
} from 'shared-interfaces';

@Injectable({
    providedIn: 'root',
})
export class PlaylistsService {
    private dbService = inject(NgxIndexedDBService);
    private snackBar = inject(MatSnackBar);
    private translateService = inject(TranslateService);

    getAllPlaylists() {
        return this.dbService.getAll<Playlist>(DbStores.Playlists).pipe(
            map((data) =>
                data.map(({ playlist, items, header, ...rest }) => ({
                    ...rest,
                }))
            )
        );
    }

    addPlaylist(playlist: Playlist) {
        return this.dbService.add(DbStores.Playlists, playlist);
    }

    getPlaylist(id: string) {
        if (id === GLOBAL_FAVORITES_PLAYLIST_ID) {
            return this.getPlaylistWithGlobalFavorites();
        } else {
            return this.dbService.getByID<Playlist>(DbStores.Playlists, id);
        }
    }

    deletePlaylist(playlistId: string) {
        return this.dbService.delete(DbStores.Playlists, playlistId);
    }

    updatePlaylist(playlistId: string, updatedPlaylist: Playlist) {
        return this.getPlaylistById(playlistId).pipe(
            switchMap((currentPlaylist: Playlist) =>
                this.dbService.update(DbStores.Playlists, {
                    ...currentPlaylist,
                    ...updatedPlaylist,
                    count: updatedPlaylist.playlist.items.length,
                    updateDate: Date.now(),
                    updateState: PlaylistUpdateState.UPDATED,
                    favorites: currentPlaylist.favorites,
                })
            )
        );
    }

    getPlaylistById(id: string) {
        return this.dbService.getByID<Playlist>(DbStores.Playlists, id);
    }

    updatePlaylistMeta(updatedPlaylist: PlaylistMeta) {
        return this.getPlaylistById(updatedPlaylist._id).pipe(
            switchMap((playlist) =>
                this.dbService.update(DbStores.Playlists, {
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
                })
            )
        );
    }

    updateFavorites(id: string, favorites: string[]) {
        return this.getPlaylistById(id).pipe(
            switchMap((playlist) =>
                this.dbService.update(DbStores.Playlists, {
                    ...playlist,
                    favorites,
                })
            )
        );
    }

    updateManyPlaylists(playlists: Playlist[]) {
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
        return this.dbService
            .getByID<Playlist>(DbStores.Playlists, playlistId)
            .pipe(
                map((data) =>
                    data.playlist.items.filter((channel: Channel) =>
                        data.favorites?.includes((channel as Channel).id)
                    )
                )
            );
    }

    getPortalFavorites(portalId: string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.dbService
            .getByID<{
                favorites: Partial<XtreamItem>[];
            }>(DbStores.Playlists, portalId)
            .pipe(
                map((item) => {
                    if (!item || !item.favorites) return [];
                    return item.favorites; /* .filter(
                        (itm) =>
                            itm && itm.stream_type && itm.stream_type !== 'live'
                    ); */
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
        return this.dbService
            .getByID<{
                favorites: Partial<XtreamItem>[];
            }>(DbStores.Playlists, portalId)
            .pipe(
                map((item) => {
                    if (!item || !item.favorites) return [];
                    return item.favorites.filter(
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
            switchMap((portal) =>
                this.dbService.update(DbStores.Playlists, {
                    ...portal,
                    favorites: [...(portal.favorites ?? []), item],
                })
            )
        );
    }

    removeFromPortalFavorites(portalId: string, favoriteId: number | string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) =>
                this.dbService.update(DbStores.Playlists, {
                    ...portal,
                    favorites: portal.favorites?.filter(
                        (i) =>
                            (i as Partial<XtreamItem>).stream_id !==
                                favoriteId &&
                            (i as Partial<XtreamSerieItem>).series_id !==
                                favoriteId &&
                            (i as Partial<{ movie_id: string }>).movie_id !==
                                favoriteId
                    ),
                })
            )
        );
    }

    updatePlaylistPositions(
        positionUpdates: {
            id: string;
            changes: { position: number };
        }[]
    ) {
        return combineLatest(
            positionUpdates.map((item, index) => {
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
            ); // TODO: translate
            throw new Error(`Parsing failed, not a valid playlist: ${error}`);
        }
    }

    getPlaylistWithGlobalFavorites() {
        return this.dbService.getAll(DbStores.Playlists).pipe(
            map((playlists: unknown[]) => {
                const favoriteChannels = aggregateFavoriteChannels(
                    playlists as Playlist[]
                );
                const favPlaylist = createFavoritesPlaylist(favoriteChannels);
                return favPlaylist;
            })
        );
    }

    addManyPlaylists(playlists: Playlist[]) {
        return this.dbService.bulkAdd(
            DbStores.Playlists,
            playlists as unknown as Playlist[]
        );
    }

    getPlaylistsForAutoUpdate() {
        return this.dbService.getAll(DbStores.Playlists).pipe(
            map((playlists: unknown[]) => {
                return playlists
                    .filter((item: any) => item.autoRefresh)
                    .map(
                        ({
                            playlist,
                            header,
                            items,
                            favorites,
                            ...rest
                        }: any) => rest
                    );
            })
        );
    }

    setFavorites(playlistId: string, favorites: string[]) {
        return this.getPlaylistById(playlistId).pipe(
            switchMap((playlist) =>
                this.dbService.update(DbStores.Playlists, {
                    ...playlist,
                    favorites,
                })
            )
        );
    }

    getRawPlaylistById(id: string) {
        return this.dbService.getByID<Playlist>(DbStores.Playlists, id).pipe(
            map((playlist) => {
                return (
                    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                    playlist.playlist.header.raw +
                    '\n' +
                    playlist.playlist.items
                        .map((item: any) => item.raw)
                        .join('\n')
                );
            })
        );
    }

    getAllData() {
        return this.dbService.getAll<Playlist>(DbStores.Playlists);
    }

    removeAll() {
        return this.dbService.clear(DbStores.Playlists);
    }

    getPortalRecentlyViewed(portalId: string) {
        if (!portalId) {
            throw new Error('Portal ID is required');
        }
        return this.dbService
            .getByID<{
                recentlyViewed: Partial<XtreamItem>[];
            }>(DbStores.Playlists, portalId)
            .pipe(
                map((item) => {
                    if (!item || !item.recentlyViewed) return [];
                    return item.recentlyViewed;
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
                // Check if item already exists in recently viewed
                if (portal.recentlyViewed?.some((i: any) => i.id === item.id)) {
                    return EMPTY;
                }

                return this.dbService.update(DbStores.Playlists, {
                    ...portal,
                    recentlyViewed: [...(portal.recentlyViewed ?? []), item],
                });
            })
        );
    }

    removeFromPortalRecentlyViewed(portalId: string, id: string | number) {
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) =>
                this.dbService.update(DbStores.Playlists, {
                    ...portal,
                    recentlyViewed: portal.recentlyViewed?.filter(
                        (i) => i.id !== id
                    ),
                })
            )
        );
    }
}
