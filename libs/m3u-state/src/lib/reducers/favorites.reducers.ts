import { on } from '@ngrx/store';
import { FavoritesActions } from '../actions';
import { PlaylistState } from '../state';

export const favoritesReducers = [
    on(FavoritesActions.updateFavorites, (state, action): PlaylistState => {
        const selectedId = state.playlists.selectedId;
        const playlist = state.playlists.entities[selectedId];
        if (!selectedId || !playlist) {
            return state;
        }

        const { channel } = action;
        const playlistFavorites = (playlist.favorites ?? []).filter(
            (favorite): favorite is string => typeof favorite === 'string'
        );
        const favorites = playlistFavorites.includes(channel.url)
            ? playlistFavorites.filter((url) => url !== channel.url)
            : [...playlistFavorites, channel.url];

        return {
            ...state,
            playlists: {
                ...state.playlists,
                entities: {
                    ...state.playlists.entities,
                    [selectedId]: {
                        ...playlist,
                        favorites,
                    },
                },
            },
        };
    }),
    on(FavoritesActions.setFavorites, (state, action): PlaylistState => {
        const selectedId = state.playlists.selectedId;
        const playlist = state.playlists.entities[selectedId];
        if (!selectedId || !playlist) {
            return state;
        }

        const { channelIds } = action;
        return {
            ...state,
            playlists: {
                ...state.playlists,
                entities: {
                    ...state.playlists.entities,
                    [selectedId]: {
                        ...playlist,
                        favorites: channelIds,
                    },
                },
            },
        };
    }),
];
