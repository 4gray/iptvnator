import { on } from '@ngrx/store';
import { Channel } from 'shared-interfaces';
import { ChannelActions } from '../actions';
import { PlaylistState } from '../state';

export const channelReducers = [
    on(
        ChannelActions.setActiveChannelSuccess,
        (state, action): PlaylistState => {
            const { channel } = action;
            return {
                ...state,
                active: { ...channel, epgParams: '' } as Channel,
            };
        }
    ),
    on(ChannelActions.resetActiveChannel, (state): PlaylistState => {
        return {
            ...state,
            active: undefined,
        };
    }),
    on(ChannelActions.setChannels, (state, action): PlaylistState => {
        return {
            ...state,
            channels: action.channels,
        };
    }),
];
