/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { parse } from 'iptv-playlist-parser';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { combineLatest, map, switchMap } from 'rxjs';
import { Channel } from '../../../shared/channel.interface';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from '../../../shared/constants';
import {
    Playlist,
    PlaylistUpdateState,
} from '../../../shared/playlist.interface';
import {
    aggregateFavoriteChannels,
    createFavoritesPlaylist,
    createPlaylistObject,
} from '../../../shared/playlist.utils';
import { XtreamItem } from '../../../shared/xtream-item.interface';
import { XtreamSerieItem } from '../../../shared/xtream-serie-item.interface';
import { DbStores } from '../indexed-db.config';
import { PWAExternalService } from './pwa-external.service';
import { PlaylistMeta } from '../shared/playlist-meta.type';
import { ConfigService } from './config.service';

@Injectable({
    providedIn: 'root',
})
export class PlaylistsService {
    constructor(
        private dbService: NgxIndexedDBService,
        private snackBar: MatSnackBar,
        private translateService: TranslateService,
        private pwaExternalService: PWAExternalService,
        private configService: ConfigService
    ) {}

    private useExternalDB(): boolean {
        return this.configService.isExternalDBEnabled();
    }
    
    getAllPlaylists() {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getAllPlaylists().pipe(
                map((data) =>
                    Array.isArray(data)
                        ? data.map(({ playlist, items, header, ...rest }) => ({
                              ...rest,
                          }))
                        : []
                ),
                map((playlists) =>
                    playlists.sort((a, b) => a.position - b.position)
                )
            );
        } else {
            return this.dbService.getAll<Playlist>(DbStores.Playlists).pipe(
                map((data) =>
                    data.map(({ playlist, items, header, ...rest }) => ({
                        ...rest,
                    }))
                ),
                map((playlists) =>
                    playlists.sort((a, b) => a.position - b.position)
                )
            );
        }
    }

    addPlaylist(playlist) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.insertPlaylist(playlist);
        } else {
            return this.dbService.add(DbStores.Playlists, playlist);
        }
    }

    getPlaylist(id: string) {
        if (id === GLOBAL_FAVORITES_PLAYLIST_ID) {
            return this.getPlaylistWithGlobalFavorites();
        } else {
            if (this.useExternalDB()) {
                return this.pwaExternalService.getPlaylistById(id);
            }
            else {
                return this.dbService.getByID<Playlist>(DbStores.Playlists, id);
            }
        }
    }

    deletePlaylist(playlistId: string){
        if (this.useExternalDB()) {
            return this.pwaExternalService.deletePlaylist(playlistId);
        } else {
            return this.dbService.delete(DbStores.Playlists, playlistId);
        }
    }

    updatePlaylist(playlistId: string, updatedPlaylist: Playlist){
        if (this.useExternalDB()) {
            return this.pwaExternalService.updatePlaylist(playlistId, updatedPlaylist);
        } else {
            return this.getPlaylistById(playlistId).pipe(
                switchMap((currentPlaylist: Playlist) =>
                    this.dbService.update(DbStores.Playlists, {
                        ...currentPlaylist,
                        ...updatedPlaylist,
                        count: updatedPlaylist.playlist.items.length,
                        updateDate: Date.now(),
                        updateState: PlaylistUpdateState.UPDATED,
                    })
                )
            );
        }
    }

    getPlaylistById(id: string) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getPlaylistById(id);
        }
        else {
            return this.dbService.getByID<Playlist>(DbStores.Playlists, id);
        }
    }

    updatePlaylistMeta(updatedPlaylist: PlaylistMeta) {
        if (this.useExternalDB()) {
            const updatedData: Partial<Playlist> = {
                ...(updatedPlaylist.title ? { title: updatedPlaylist.title } : {}),
                ...(updatedPlaylist.autoRefresh !== undefined && updatedPlaylist.autoRefresh !== null ? { autoRefresh: updatedPlaylist.autoRefresh } : {}),
                ...(updatedPlaylist.userAgent && updatedPlaylist.userAgent.trim() !== '' ? { userAgent: updatedPlaylist.userAgent } : {}),
                ...(updatedPlaylist.serverUrl && updatedPlaylist.serverUrl.trim() !== '' ? { serverUrl: updatedPlaylist.serverUrl } : {}),
                ...(updatedPlaylist.portalUrl && updatedPlaylist.portalUrl.trim() !== '' ? { portalUrl: updatedPlaylist.portalUrl } : {}),
                ...(updatedPlaylist.macAddress && updatedPlaylist.macAddress.trim() !== '' ? { macAddress: updatedPlaylist.macAddress } : {}),
                ...(updatedPlaylist.username && updatedPlaylist.username.trim() !== '' ? { username: updatedPlaylist.username } : {}),
                ...(updatedPlaylist.password && updatedPlaylist.password.trim() !== '' ? { password: updatedPlaylist.password } : {}),
            };
            return this.pwaExternalService.updatePlaylist(updatedPlaylist._id, updatedData);
        } else {
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
                    })
                )
            );
        }
    }

    updateFavorites(id: string, favorites: string[]) {
        return this.getPlaylistById(id).pipe(
            switchMap((playlist: Playlist) => {
                if (this.useExternalDB()) {
                    return this.pwaExternalService.updatePlaylist(id, { favorites });
                } else {
                    return this.dbService.update(DbStores.Playlists, {
                        ...playlist,
                        favorites,
                    });
                }
            })
        );
    }

    updateManyPlaylists(playlists: Playlist[]) {
        return combineLatest(
            playlists.map((playlist) => {
                const updatedPlaylist = {
                    ...playlist,
                    updateDate: Date.now(),
                    autoRefresh: true,
                };

                if (this.useExternalDB()) {
                    return this.pwaExternalService.updatePlaylist(playlist._id, updatedPlaylist);
                } else {
                    return this.dbService.update(DbStores.Playlists, updatedPlaylist);
                }
            })
        );
    }

    getFavoriteChannels(playlistId: string) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getPlaylistById(playlistId).pipe(
                map((data) =>
                    data.playlist.items.filter((channel) =>
                        data.favorites.includes((channel as Channel).id)
                    )
                )
            );
        } else {
            return this.dbService
                .getByID<Playlist>(DbStores.Playlists, playlistId)
                .pipe(
                    map((data) =>
                        data.playlist.items.filter((channel) =>
                            data.favorites.includes((channel as Channel).id)
                        )
                    )
                );
        }
    }

    getPortalFavorites(portalId: string) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getPlaylistById(portalId).pipe(
                map((playlist: Playlist) => 
                    (playlist.favorites as Partial<XtreamItem>[]).filter(itm => itm && itm.stream_type && itm.stream_type !== 'live') ?? []
                )
            );
        } else {
            return this.dbService
                .getByID<{ favorites: Partial<XtreamItem>[] }>(
                    DbStores.Playlists,
                    portalId
                )
                .pipe(map((item) => item.favorites.filter(itm => itm && itm.stream_type && itm.stream_type !== 'live') ?? []));
        }
    }

    getPortalLiveStreamFavorites(portalId: string) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getPlaylistById(portalId).pipe(
                map((data) =>
                    (data.favorites as Partial<XtreamItem>[]).filter(itm => itm && itm.stream_type && itm.stream_type === 'live') ?? []
                )
            );
        } else {
            return this.dbService
                .getByID<{ favorites: Partial<XtreamItem>[] }>(
                    DbStores.Playlists,
                    portalId
                )
                .pipe(
                    map((item) =>
                        item.favorites.filter(itm => itm && itm.stream_type && itm.stream_type === 'live') ?? []
                    )
                );
        }
    }

    addPortalFavorite(portalId: string, item: any) {
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const updatedFavorites = [...(portal.favorites ?? []), item];
                if (this.useExternalDB()) {
                    return this.pwaExternalService.updatePlaylist(portalId, { favorites: updatedFavorites });
                } else {
                    return this.dbService.update(DbStores.Playlists, {
                        ...portal,
                        favorites: updatedFavorites,
                    });
                }
            })
        );
    }

    removeFromPortalFavorites(portalId: string, favoriteId: number | string) {
        return this.getPlaylistById(portalId).pipe(
            switchMap((portal) => {
                const updatedFavorites = portal.favorites.filter(
                    (i) =>
                        (i as Partial<XtreamItem>).stream_id !== favoriteId &&
                        (i as Partial<XtreamSerieItem>).series_id !== favoriteId &&
                        (i as Partial<{ movie_id: string }>).movie_id !== favoriteId
                );

                if (this.useExternalDB()) {
                    return this.pwaExternalService.updatePlaylist(portalId, { favorites: updatedFavorites });
                } else {
                    return this.dbService.update(DbStores.Playlists, {
                        ...portal,
                        favorites: updatedFavorites,
                    });
                }
            })
        );
    }

    updatePlaylistPositions(
        positionUpdates: {
            id: string;
            changes: { position: number };
        }[]
    ) {
        const updatePosition = (id: string, position: number) => {
            if (this.useExternalDB()) {
                return this.pwaExternalService.getPlaylistById(id).pipe(
                    switchMap((playlist: Playlist) =>
                        this.pwaExternalService.updatePlaylist(id, {
                            ...playlist,
                            position: position,
                        })
                    )
                );
            } else {
                return this.dbService.getByID(DbStores.Playlists, id).pipe(
                    switchMap((playlist: Playlist) =>
                        this.dbService.update(DbStores.Playlists, {
                            ...playlist,
                            position: position,
                        })
                    )
                );
            }
        };
    
        return combineLatest(
            positionUpdates.map((item) => updatePosition(item.id, item.changes.position))
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
                null,
                { duration: 2000 }
            ); // TODO: translate
            throw new Error(`Parsing failed, not a valid playlist: ${error}`);
        }
    }

    getPlaylistWithGlobalFavorites() {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getAllPlaylists().pipe(
                map((playlists: Playlist[]) => {
                    const favoriteChannels = aggregateFavoriteChannels(playlists);
                    const favPlaylist = createFavoritesPlaylist(favoriteChannels);
                    return favPlaylist;
                })
            );
        } else {
            return this.dbService.getAll(DbStores.Playlists).pipe(
                map((playlists: Playlist[]) => {
                    const favoriteChannels = aggregateFavoriteChannels(playlists);
                    const favPlaylist = createFavoritesPlaylist(favoriteChannels);
                    return favPlaylist;
                })
            );
        }
    }

    addManyPlaylists(playlists: Playlist[]) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.addManyPlaylists(playlists);
        } else {
            return this.dbService.bulkAdd(DbStores.Playlists, playlists as any);
        }
    }

    getPlaylistsForAutoUpdate() {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getAllPlaylists().pipe(
                map((playlists: Playlist[]) => {
                    return playlists
                        .filter((item) => item.autoRefresh)
                        .map(
                            ({ playlist, header, items, favorites, ...rest }) => rest
                        );
                })
            );
        } else {
            return this.dbService.getAll(DbStores.Playlists).pipe(
                map((playlists: Playlist[]) => {
                    return playlists
                        .filter((item) => item.autoRefresh)
                        .map(
                            ({ playlist, header, items, favorites, ...rest }) => rest
                        );
                })
            );
        }
    }

    setFavorites(playlistId: string, favorites: string[]) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.updatePlaylist(playlistId, { favorites });
        } else {
            return this.getPlaylistById(playlistId).pipe(
                switchMap((playlist) =>
                    this.dbService.update(DbStores.Playlists, {
                        ...playlist,
                        favorites,
                    })
                )
            );
        }
    }

    getRawPlaylistById(id: string) {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getPlaylistById(id).pipe(
                map((playlist) => {
                    return (
                        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                        playlist.playlist.header.raw +
                        '\n' +
                        playlist.playlist.items.map((item) => item.raw).join('\n')
                    );
                })
            );
        } else {
            return this.dbService.getByID<Playlist>(DbStores.Playlists, id).pipe(
                map((playlist) => {
                    return (
                        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                        playlist.playlist.header.raw +
                        '\n' +
                        playlist.playlist.items.map((item) => item.raw).join('\n')
                    );
                })
            );
        }
    }
    
    getAllData() {
        if (this.useExternalDB()) {
            return this.pwaExternalService.getAllPlaylists();
        } else {
            return this.dbService.getAll<Playlist>(DbStores.Playlists);
        }
    }
    
    removeAll() {
        if (this.useExternalDB()) {
            return this.pwaExternalService.deleteAllPlaylists();
        } else {
            return this.dbService.clear(DbStores.Playlists);
        }
    }
}
