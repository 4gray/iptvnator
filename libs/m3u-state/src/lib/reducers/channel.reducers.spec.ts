import { createReducer } from '@ngrx/store';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
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

    const archivedProgram: EpgProgram = {
        channel: 'sample-tvg-id',
        start: '2026-06-28T09:00:00.000Z',
        stop: '2026-06-28T10:00:00.000Z',
        title: 'Archived Show',
        desc: null,
        category: null,
        startTimestamp: 1782637200,
        stopTimestamp: 1782640800,
    };

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

    it('clears archive playback state when a new channel becomes active', () => {
        const nextState = reducer(
            {
                ...initialState,
                activePlaybackUrl: 'https://archive.example.com/catchup.m3u8',
                activeEpgProgram: archivedProgram,
            },
            ChannelActions.setActiveChannelSuccess({ channel: sampleChannel })
        );

        expect(nextState.activePlaybackUrl).toBeNull();
        expect(nextState.activeEpgProgram).toBeUndefined();
    });
});
