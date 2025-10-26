import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateService } from '@ngx-translate/core';
import {
    combineLatestWith,
    firstValueFrom,
    map,
    switchMap,
    tap,
    withLatestFrom,
} from 'rxjs';
import { DataService, EpgService, PlaylistsService } from 'services';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    Playlist,
    STORE_KEY,
    VideoPlayer,
} from 'shared-interfaces';
import * as PlaylistActions from './actions';
import {
    selectActive,
    selectActivePlaylistId,
    selectChannels,
    selectFavorites,
} from './selectors';

@Injectable({ providedIn: 'any' })
export class PlaylistEffects {
    private actions$ = inject(Actions);
    private playlistsService = inject(PlaylistsService);
    private dataService = inject(DataService);
    private epgService = inject(EpgService);
    private router = inject(Router);
    private snackBar = inject(MatSnackBar);
    private storage = inject(StorageMap);
    private store = inject(Store);
    private translate = inject(TranslateService);

    updateFavorites$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.updateFavorites),
                combineLatestWith(
                    this.store.select(selectFavorites),
                    this.store.select(selectActivePlaylistId)
                ),
                switchMap(([, favorites, playlistId]) =>
                    this.playlistsService.updateFavorites(playlistId, favorites)
                ),
                tap(() => {
                    this.snackBar.open(
                        this.translate.instant('CHANNELS.FAVORITES_UPDATED'),
                        undefined,
                        { duration: 2000 }
                    );
                })
            );
        },
        { dispatch: false }
    );

    setFavorites$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.setFavorites),
                combineLatestWith(this.store.select(selectActivePlaylistId)),
                switchMap(([action, playlistId]) =>
                    this.playlistsService.setFavorites(
                        playlistId,
                        action.channelIds
                    )
                )
            );
        },
        {
            dispatch: false,
        }
    );

    setActiveEpgProgram$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.setActiveEpgProgram),
                combineLatestWith(this.store.select(selectActive)),
                map(([, activeChannel]) => {
                    firstValueFrom(this.storage.get(STORE_KEY.Settings)).then(
                        (settings: any) => {
                            if (
                                settings &&
                                Object.keys(settings).length > 0 &&
                                settings.player === VideoPlayer.MPV
                            )
                                this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                                    url:
                                        activeChannel?.url +
                                        (activeChannel?.epgParams ?? ''),
                                    mpvPlayerPath: settings?.mpvPlayerPath,
                                });
                            else if (
                                settings &&
                                Object.keys(settings).length > 0 &&
                                settings.player === VideoPlayer.VLC
                            )
                                this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                                    url:
                                        activeChannel?.url +
                                        (activeChannel?.epgParams ?? ''),
                                    vlcPlayerPath: settings?.vlcPlayerPath,
                                });
                        }
                    );
                })
            );
        },
        { dispatch: false }
    );

    setActiveChannel$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(PlaylistActions.setActiveChannel),
            map((action) => {
                const { channel } = action;

                // Use modern EPG service to get channel programs
                const channelId = channel.tvg?.id || channel.name;
                if (channelId) {
                    this.epgService.getChannelPrograms(channelId);
                }

                // Set user agent if specified on channel
                if (channel.http['user-agent']) {
                    window.electron?.setUserAgent(
                        channel.http['user-agent'],
                        channel.http.referrer
                    );
                }

                firstValueFrom(this.storage.get(STORE_KEY.Settings)).then(
                    (settings: any) => {
                        if (
                            settings &&
                            Object.keys(settings).length > 0 &&
                            settings.player === VideoPlayer.MPV &&
                            channel.radio !== 'true'
                        ) {
                            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                                url: channel.url,
                                mpvPlayerPath: settings?.mpvPlayerPath,
                                referer: channel.http.referrer,
                                userAgent: channel.http['user-agent'],
                                origin: channel.http.origin,
                            });
                        } else if (
                            settings &&
                            Object.keys(settings).length > 0 &&
                            settings.player === VideoPlayer.VLC &&
                            channel.radio !== 'true'
                        )
                            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                                url: channel.url,
                                vlcPlayerPath: settings?.vlcPlayerPath,
                            });
                    }
                );

                return PlaylistActions.setActiveChannelSuccess({
                    channel: action.channel,
                });
            })
        );
    });

    loadPlaylists$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(PlaylistActions.loadPlaylists),
            switchMap(() =>
                this.playlistsService.getAllPlaylists().pipe(
                    map((playlists) =>
                        PlaylistActions.loadPlaylistsSuccess({
                            playlists,
                        })
                    )
                )
            )
        );
    });

    removePlaylist$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.removePlaylist),
                switchMap((action) =>
                    this.playlistsService.deletePlaylist(action.playlistId)
                )
            );
        },
        { dispatch: false }
    );

    updatePlaylist$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.updatePlaylist),
                switchMap((action) =>
                    this.playlistsService.updatePlaylist(action.playlistId, {
                        ...action.playlist,
                        _id: action.playlistId,
                    })
                )
            );
        },
        { dispatch: false }
    );

    parsePlaylist$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(PlaylistActions.parsePlaylist),
            map((action) =>
                this.playlistsService.handlePlaylistParsing(
                    action.uploadType,
                    action.playlist,
                    action.title,
                    action.path
                )
            ),
            map((playlist) =>
                PlaylistActions.addPlaylist({
                    playlist,
                })
            )
        );
    });

    addPlaylist$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.addPlaylist),
                switchMap((action) =>
                    this.playlistsService.addPlaylist(action.playlist)
                ),
                map((playlist: Playlist) => {
                    if (playlist.serverUrl && !this.dataService.isElectron) {
                        this.router.navigate(['/xtreams/', playlist._id]);
                    } else if (playlist.macAddress) {
                        this.router.navigate(['stalker', playlist._id]);
                    } else {
                        this.router.navigate(['/playlists/', playlist._id]);
                    }
                    return playlist;
                }),
                map(async (playlist) => {
                    if (playlist.serverUrl && this.dataService.isElectron) {
                        // Use Electron database API
                        await window.electron.dbCreatePlaylist({
                            id: playlist._id.toString(),
                            name: playlist.title || '',
                            serverUrl: playlist.serverUrl || '',
                            username: playlist.username || '',
                            password: playlist.password || '',
                            type: 'xtream',
                        });
                        console.log('Playlist created in database');
                        this.router.navigate(['/xtreams/', playlist._id]);
                    }
                })
            );
        },
        { dispatch: false }
    );

    updatePlaylistMeta$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.updatePlaylistMeta),
                switchMap((action) => {
                    // TODO update playlist in sqlite db

                    return this.playlistsService.updatePlaylistMeta(
                        action.playlist
                    );
                })
            );
        },
        { dispatch: false }
    );

    updatePlaylistPositions$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.updatePlaylistPositions),
                switchMap((action) =>
                    this.playlistsService.updatePlaylistPositions(
                        action.positionUpdates
                    )
                )
            );
        },
        { dispatch: false }
    );

    addManyPlaylists$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.addManyPlaylists),
                switchMap((action) =>
                    this.playlistsService.addManyPlaylists(action.playlists)
                )
            );
        },
        { dispatch: false }
    );

    updateManyPlaylists$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.updateManyPlaylists),
                switchMap((action) =>
                    this.playlistsService.updateManyPlaylists(action.playlists)
                )
            );
        },
        { dispatch: false }
    );

    removeAll$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.removeAllPlaylists),
                switchMap(() => this.playlistsService.removeAll()),
                tap(() => {
                    this.snackBar.open(
                        this.translate.instant('SETTINGS.PLAYLISTS_REMOVED'),
                        undefined,
                        {
                            duration: 2000,
                        }
                    );
                })
            );
        },
        { dispatch: false }
    );

    setAdjacentChannelAsActive$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(PlaylistActions.setAdjacentChannelAsActive),
            withLatestFrom(
                this.store.select(selectChannels),
                this.store.select(selectActive)
            ),
            map(([action, channels, activeChannel]) => {
                let adjacentChannel;
                const index = channels.findIndex(
                    (channel) => channel.id === activeChannel?.id
                );
                if (action.direction === 'next') {
                    if (index === channels.length - 1)
                        adjacentChannel = activeChannel;
                    adjacentChannel = channels[index + 1];
                } else if (action.direction === 'previous') {
                    if (index === -1 || index === 0)
                        adjacentChannel = activeChannel;
                    adjacentChannel = channels[index - 1];
                }
                return PlaylistActions.setActiveChannelSuccess({
                    channel: adjacentChannel!,
                });
            })
        );
    });
}
