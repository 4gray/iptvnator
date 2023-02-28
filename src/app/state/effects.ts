/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatestWith, map, switchMap, tap } from 'rxjs/operators';
import {
    CHANNEL_SET_USER_AGENT,
    EPG_GET_PROGRAM,
} from '../../../shared/ipc-commands';
import { DataService } from '../services/data.service';
import { PlaylistsService } from '../services/playlists.service';
import * as PlaylistActions from './actions';
import {
    selectActivePlaylistId,
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
                switchMap(([action, favorites, playlistId]) =>
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
                    this.router.navigate(['/playlists/', playlist._id]);
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

    constructor(
        private actions$: Actions,
        private playlistsService: PlaylistsService,
        private dataService: DataService,
        private store: Store,
        private router: Router
    ) {}
}
