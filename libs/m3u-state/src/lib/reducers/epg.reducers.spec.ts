import { createReducer } from '@ngrx/store';
import { EpgActions } from '../actions';
import { initialState } from '../state';
import { epgReducers } from './epg.reducers';

const reducer = createReducer(initialState, ...epgReducers);

describe('epgReducers', () => {
    it('does not recreate the active channel when epg params are already empty', () => {
        const state = {
            ...initialState,
            active: {
                id: 'channel-1',
                name: 'ARD-alpha',
                url: 'https://example.com/live.m3u8',
                tvg: {
                    id: '',
                    name: 'ARD-alpha',
                    url: '',
                    logo: '',
                    rec: '',
                },
                group: { title: '' },
                http: {
                    referrer: '',
                    'user-agent': '',
                    origin: '',
                },
                radio: 'false',
                epgParams: '',
            },
            activePlaybackUrl: null,
        };

        const nextState = reducer(state, EpgActions.resetActiveEpgProgram());

        expect(nextState).toBe(state);
    });

    it('clears epg params when they are present', () => {
        const state = {
            ...initialState,
            active: {
                id: 'channel-1',
                name: 'ARD-alpha',
                url: 'https://example.com/live.m3u8',
                tvg: {
                    id: '',
                    name: 'ARD-alpha',
                    url: '',
                    logo: '',
                    rec: '',
                },
                group: { title: '' },
                http: {
                    referrer: '',
                    'user-agent': '',
                    origin: '',
                },
                radio: 'false',
                epgParams: '?utc=123&lutc=456',
            },
            activePlaybackUrl: 'https://archive.example.com/catchup.m3u8',
        };

        const nextState = reducer(state, EpgActions.resetActiveEpgProgram());

        expect(nextState).not.toBe(state);
        expect(nextState.active?.epgParams).toBe('');
        expect(nextState.activePlaybackUrl).toBeNull();
    });

    it('stores the resolved playback url without mutating the active channel', () => {
        const state = {
            ...initialState,
            active: {
                id: 'channel-1',
                name: 'ARD-alpha',
                url: 'https://example.com/live.m3u8',
                tvg: {
                    id: '',
                    name: 'ARD-alpha',
                    url: '',
                    logo: '',
                    rec: '',
                },
                group: { title: '' },
                http: {
                    referrer: '',
                    'user-agent': '',
                    origin: '',
                },
                radio: 'false',
                epgParams: '',
            },
            activePlaybackUrl: null,
        };

        const nextState = reducer(
            state,
            EpgActions.setActivePlaybackUrl({
                playbackUrl: 'https://archive.example.com/catchup.m3u8',
            })
        );

        expect(nextState.activePlaybackUrl).toBe(
            'https://archive.example.com/catchup.m3u8'
        );
        expect(nextState.active?.url).toBe('https://example.com/live.m3u8');
    });
});
