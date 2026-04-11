import { on } from '@ngrx/store';
import { Channel } from 'shared-interfaces';
import { ChannelActions } from '../actions';
import { PlaylistState } from '../state';

export const channelReducers = [
    on(ChannelActions.setChannelsLoading, (state, action): PlaylistState => {
        return {
            ...state,
            channelsLoading: action.loading,
        };
    }),
    on(
        ChannelActions.setActiveChannelSuccess,
        (state, action): PlaylistState => {
            const { channel } = action;
            return {
                ...state,
                active: { ...channel, epgParams: '' } as Channel,
                activePlaybackUrl: null,
            };
        }
    ),
    on(ChannelActions.resetActiveChannel, (state): PlaylistState => {
        return {
            ...state,
            active: undefined,
            activePlaybackUrl: null,
        };
    }),
    on(ChannelActions.setChannels, (state, action): PlaylistState => {
        return {
            ...state,
            channelsLoading: false,
            channels: action.channels,
        };
    }),
];
