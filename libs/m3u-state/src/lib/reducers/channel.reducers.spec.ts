import { createReducer } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import { ChannelActions } from '../actions';
import { initialState } from '../state';
import { channelReducers } from './channel.reducers';

const reducer = createReducer(initialState, ...channelReducers);

describe('channelReducers', () => {
    const sampleChannel = {
        epgParams: '',
        http: {
            origin: '',
            referrer: '',
            'user-agent': '',
        },
        id: 'channel-1',
        name: 'Sample TV',
        radio: 'false',
        tvg: {
            id: 'sample-tvg-id',
            logo: '',
            name: 'Sample TV',
            rec: '',
            url: '',
        },
        url: 'https://example.com/live.m3u8',
    } as Channel;

    it('tracks explicit channel loading state', () => {
        const nextState = reducer(
            initialState,
            ChannelActions.setChannelsLoading({ loading: true })
        );

        expect(nextState.channelsLoading).toBe(true);
    });

    it('stores channels and clears the loading flag when channel data arrives', () => {
        const loadingState = reducer(
            initialState,
            ChannelActions.setChannelsLoading({ loading: true })
        );

        const nextState = reducer(
            loadingState,
            ChannelActions.setChannels({ channels: [sampleChannel] })
        );

        expect(nextState.channels).toEqual([sampleChannel]);
        expect(nextState.channelsLoading).toBe(false);
    });
});
