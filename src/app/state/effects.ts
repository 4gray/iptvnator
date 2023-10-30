import { Injectable } from '@angular/core';
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
import {
    CHANNEL_SET_USER_AGENT,
    EPG_GET_PROGRAM,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
} from '../../../shared/ipc-commands';
import { DataService } from '../services/data.service';
import { PlaylistsService } from '../services/playlists.service';
import { Settings, VideoPlayer } from '../settings/settings.interface';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import * as PlaylistActions from './actions';
import {
    selectActive,
    selectActivePlaylistId,
    selectChannels,
    selectFavorites,
    selectIsEpgAvailable,
} from './selectors';

@Injectable({ providedIn: 'any' })
export class PlaylistEffects {
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
                )
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
                        (settings: Settings) => {
                            if (
                                settings &&
                                Object.keys(settings).length > 0 &&
                                settings.player === VideoPlayer.MPV
                            )
                                this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                                    url:
                                        activeChannel.url +
                                            activeChannel.epgParams ?? '',
                                });
                            else if (
                                settings &&
                                Object.keys(settings).length > 0 &&
                                settings.player === VideoPlayer.VLC
                            )
                                this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                                    url:
                                        activeChannel.url +
                                            activeChannel.epgParams ?? '',
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
            combineLatestWith(this.store.select(selectIsEpgAvailable)),
            map(([action, isEpgAvailable]) => {
                const { channel } = action;
                if (isEpgAvailable) {
                    this.dataService.sendIpcEvent(EPG_GET_PROGRAM, {
                        channel,
                    });
                }
                if (channel.http['user-agent']) {
                    this.dataService.sendIpcEvent(CHANNEL_SET_USER_AGENT, {
                        referer: channel.http.referrer,
                        userAgent: channel.http['user-agent'],
                    });
                }

                firstValueFrom(this.storage.get(STORE_KEY.Settings)).then(
                    (settings: Settings) => {
                        if (
                            settings &&
                            Object.keys(settings).length > 0 &&
                            settings.player === VideoPlayer.MPV &&
                            channel.radio !== 'true'
                        ) {
                            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                                url: channel.url,
                            });
                        } else if (
                            settings &&
                            Object.keys(settings).length > 0 &&
                            settings.player === VideoPlayer.VLC
                        )
                            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                                url: channel.url,
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
                tap((playlist) => {
                    if (playlist.serverUrl) {
                        this.router.navigate(['/xtreams/', playlist._id]);
                    } else if (playlist.macAddress) {
                        this.router.navigate(['portals', playlist._id]);
                    } else {
                        this.router.navigate(['/playlists/', playlist._id]);
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
                switchMap((action) =>
                    this.playlistsService.updatePlaylistMeta(action.playlist)
                )
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
                        null,
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
                    (channel) => channel.id === activeChannel.id
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
                    channel: adjacentChannel,
                });
            })
        );
    });

    constructor(
        private actions$: Actions,
        private playlistsService: PlaylistsService,
        private dataService: DataService,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private store: Store,
        private translate: TranslateService
    ) {}
}
