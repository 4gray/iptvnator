/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatestWith, map } from 'rxjs/operators';
import {
    CHANNEL_SET_USER_AGENT,
    EPG_GET_PROGRAM,
    PLAYLIST_UPDATE_FAVORITES,
} from '../../../shared/ipc-commands';
import { DataService } from '../services/data.service';
import * as PlaylistActions from './actions';
import {
    selectActive,
    selectFavorites,
    selectIsEpgAvailable,
    selectPlaylistId,
} from './selectors';

@Injectable({ providedIn: 'any' })
export class PlaylistEffects {
    updateFavorites$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.updateFavorites),
                combineLatestWith(
                    this.store.select(selectFavorites),
                    this.store.select(selectPlaylistId)
                ),
                map(([action, favorites, playlistId]) => {
                    this.dataService.sendIpcEvent(PLAYLIST_UPDATE_FAVORITES, {
                        id: playlistId,
                        favorites,
                    });
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
                return PlaylistActions.setActiveChannelSuccess({
                    channel: action.channel,
                });
            })
        );
    });

    setEpgAvailableFlag$ = createEffect(
        () => {
            return this.actions$.pipe(
                ofType(PlaylistActions.setEpgAvailableFlag),
                combineLatestWith(this.store.select(selectActive)),
                map(([action, activeChannel]) => {
                    if (activeChannel && activeChannel.name) {
                        this.dataService.sendIpcEvent(EPG_GET_PROGRAM, {
                            channelName: activeChannel.name,
                        });
                    }
                })
            );
        },
        { dispatch: false }
    );

    constructor(
        private actions$: Actions,
        private dataService: DataService,
        private store: Store
    ) {}
}
