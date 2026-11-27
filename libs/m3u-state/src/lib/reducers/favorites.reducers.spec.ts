import { createReducer } from '@ngrx/store';
import { Channel, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { FavoritesActions } from '../actions';
import { playlistsAdapter } from '../playlists.state';
import { initialState } from '../state';
import { favoritesReducers } from './favorites.reducers';

const reducer = createReducer(initialState, ...favoritesReducers);

describe('favoritesReducers', () => {
    it('removes a favorite stored under both legacy keys and appends the URL on re-add', () => {
        const channel = {
            id: 'legacy-a',
            url: 'https://streams.example/live-a',
        } as Channel;
        const remaining = ['legacy-b', 'https://streams.example/live-c'];
        const playlist = {
            _id: 'playlist-1',
            title: 'Synthetic playlist',
            favorites: [remaining[0], channel.url, channel.id, remaining[1]],
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(playlist, {
                ...initialState.playlists,
                selectedId: playlist._id,
            }),
        };
        const toggle = FavoritesActions.updateFavorites({ channel });

        const withoutChannel = reducer(state, toggle);
        expect(
            withoutChannel.playlists.entities[playlist._id]?.favorites
        ).toEqual(remaining);
        const restored = reducer(withoutChannel, toggle);
        expect(restored.playlists.entities[playlist._id]?.favorites).toEqual([
            ...remaining,
            channel.url,
        ]);
    });

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
