import { createReducer } from '@ngrx/store';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { FavoritesActions } from '../actions';
import { playlistsAdapter } from '../playlists.state';
import { initialState } from '../state';
import { favoritesReducers } from './favorites.reducers';

const reducer = createReducer(initialState, ...favoritesReducers);

describe('favoritesReducers', () => {
    it('hydrates persisted favorites into state without using the persistence action', () => {
        const playlist = {
            _id: 'playlist-1',
            title: 'Synthetic playlist',
            favorites: ['stale-channel'],
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(playlist, {
                ...initialState.playlists,
                selectedId: playlist._id,
            }),
        };

        const nextState = reducer(
            state,
            FavoritesActions.hydrateFavorites({
                channelIds: ['persisted-channel'],
            })
        );

        expect(nextState.playlists.entities[playlist._id]?.favorites).toEqual([
            'persisted-channel',
        ]);
    });
});
