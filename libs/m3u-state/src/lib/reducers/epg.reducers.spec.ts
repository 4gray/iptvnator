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
        };

        const nextState = reducer(state, EpgActions.resetActiveEpgProgram());

        expect(nextState).not.toBe(state);
        expect(nextState.active?.epgParams).toBe('');
    });
});
