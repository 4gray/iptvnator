import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { EpgService } from '@iptvnator/epg/data-access';
import { resolveM3uCatchupUrl } from '@iptvnator/shared/m3u-utils';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateService } from '@ngx-translate/core';
import {
    EMPTY,
    filter,
    firstValueFrom,
    from,
    map,
    mergeMap,
    switchMap,
    tap,
    withLatestFrom,
} from 'rxjs';
import { DataService, PlaylistsService } from '@iptvnator/services';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    Channel,
    Playlist,
    STORE_KEY,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    ChannelActions,
    EpgActions,
    FavoritesActions,
    PlaylistActions,
} from './actions';
import {
    selectActive,
    selectActivePlaylistId,
    selectChannels,
    selectFavorites,
} from './selectors';
import { resolveChannelEpgLookupKey } from './channel-epg-lookup.util';
import { buildExternalPlayerPayload } from './external-player-payload.util';

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
                ofType(FavoritesActions.updateFavorites),
                withLatestFrom(
                    this.store.select(selectFavorites),
                    this.store.select(selectActivePlaylistId)
                ),
                filter(([, , playlistId]) => !!playlistId),
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
                ofType(FavoritesActions.setFavorites),
                withLatestFrom(this.store.select(selectActivePlaylistId)),
                filter(([, playlistId]) => !!playlistId),
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

    resolveActiveEpgProgram$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(EpgActions.setActiveEpgProgram),
            withLatestFrom(this.store.select(selectActive)),
            map(([action, activeChannel]) => {
                const playbackUrl = activeChannel
                    ? resolveM3uCatchupUrl(activeChannel, action.program)
                    : null;

                return playbackUrl
                    ? EpgActions.setActivePlaybackUrl({ playbackUrl })
                    : EpgActions.resetActiveEpgProgram();
            })
        );
    });

    openArchivedPlayback$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(EpgActions.setActivePlaybackUrl),
                withLatestFrom(this.store.select(selectActive)),
                tap(([action, activeChannel]) => {
                    void this.openWithConfiguredExternalPlayer(
                        action.playbackUrl,
                        activeChannel
                    );
                })
            );
        },
        { dispatch: false }
    );

    returnToLivePlayback$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(EpgActions.returnToLivePlayback),
                withLatestFrom(this.store.select(selectActive)),
                filter(([, activeChannel]) => Boolean(activeChannel?.url)),
                tap(([, activeChannel]) => {
                    void this.openWithConfiguredExternalPlayer(
                        activeChannel?.url ?? '',
                        activeChannel
                    );
                })
            );
        },
        { dispatch: false }
    );

    setActiveChannel$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(ChannelActions.setActiveChannel),
            // Skip the effect entirely when channel is falsy
            filter((action) => !!action.channel),
            map((action) => {
                const { channel } = action;

                // Use modern EPG service to get channel programs
                const channelId = resolveChannelEpgLookupKey(channel);
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
                        const shouldOpenExternalPlayer =
                            !settings?.openStreamOnDoubleClick ||
                            action.startPlayback === true;

                        if (
                            settings &&
                            Object.keys(settings).length > 0 &&
                            shouldOpenExternalPlayer &&
                            settings.player === VideoPlayer.MPV &&
                            channel.radio !== 'true'
                        ) {
                            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                                url: channel.url,
                                title: channel.name ?? '',
                                'user-agent': channel.http['user-agent'],
                                referer: channel.http.referrer,
                                origin: channel.http.origin,
                            });
                        } else if (
                            settings &&
                            Object.keys(settings).length > 0 &&
                            shouldOpenExternalPlayer &&
                            settings.player === VideoPlayer.VLC &&
                            channel.radio !== 'true'
                        )
                            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                                url: channel.url,
                                title: channel.name ?? '',
                                'user-agent': channel.http['user-agent'],
                                referer: channel.http.referrer,
                                origin: channel.http.origin,
                            });
                    }
                );

                return ChannelActions.setActiveChannelSuccess({
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

    private async openWithConfiguredExternalPlayer(
        playbackUrl: string,
        activeChannel: Channel | undefined | null
    ): Promise<void> {
        const payload = buildExternalPlayerPayload(activeChannel, playbackUrl);
        if (!payload) {
            return;
        }

        const settings: any = await firstValueFrom(
            this.storage.get(STORE_KEY.Settings)
        );
        if (!settings || Object.keys(settings).length === 0) {
            return;
        }

        if (settings.player === VideoPlayer.MPV) {
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, payload);
            return;
        }

        if (settings.player === VideoPlayer.VLC) {
            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, payload);
        }
    }

    removePlaylist$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.removePlaylist),
                switchMap(async (action) => {
                    await firstValueFrom(
                        this.playlistsService.deletePlaylist(action.playlistId)
                    );
                })
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
            mergeMap((action) =>
                from(
                    this.playlistsService.handlePlaylistParsing(
                        action.uploadType,
                        action.playlist,
                        action.title,
                        action.path
                    )
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
                ofType(
                    PlaylistActions.addPlaylist,
                    PlaylistActions.handleAddingPlaylistByUrl
                ),
                tap((action) => {
                    if ('isTemporary' in action && action.isTemporary) {
                        return;
                    }

                    this.navigateToPlaylist(action.playlist);
                }),
                switchMap((action) => {
                    if ('isTemporary' in action && action.isTemporary) {
                        return EMPTY;
                    }
                    return this.playlistsService.addPlaylist(action.playlist);
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

    setAdjacentChannelAsActive$ = createEffect(() => {
        return this.actions$.pipe(
            ofType(ChannelActions.setAdjacentChannelAsActive),
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
                return ChannelActions.setActiveChannelSuccess({
                    channel: adjacentChannel!,
                });
            })
        );
    });

    private navigateToPlaylist(playlist: Playlist): void {
        if (playlist.serverUrl) {
            void this.router.navigate(['/workspace', 'xtreams', playlist._id]);
            return;
        }

        if (playlist.macAddress) {
            void this.router.navigate(['/workspace', 'stalker', playlist._id]);
            return;
        }

        void this.router.navigate(['/workspace', 'playlists', playlist._id]);
    }
}
