import { on } from '@ngrx/store';
import { FavoritesActions } from '../actions';
import { PlaylistState } from '../state';

export const favoritesReducers = [
    on(FavoritesActions.updateFavorites, (state, action): PlaylistState => {
        let favorites;
        const { channel } = action;
        const playlistFavorites =
            state.playlists.entities[state.playlists.selectedId]?.favorites;
        if (playlistFavorites?.includes(channel.url)) {
            favorites = [
                ...(playlistFavorites ?? []).filter(
                    (url: string) => url !== channel.url
                ),
            ];
        } else {
            favorites = [...(playlistFavorites ?? []), channel.url];
        }
        return {
            ...state,
            playlists: {
                ...state.playlists,
                entities: {
                    ...state.playlists.entities,
                    [state.playlists.selectedId]: {
                        ...state.playlists.entities[state.playlists.selectedId],
                        favorites,
                    },
                },
            },
        };
    }),
    on(FavoritesActions.setFavorites, (state, action): PlaylistState => {
        const { channelIds } = action;
        return {
            ...state,
            playlists: {
                ...state.playlists,
                entities: {
                    ...state.playlists.entities,
                    [state.playlists.selectedId]: {
                        ...state.playlists.entities[state.playlists.selectedId],
                        favorites: channelIds,
                    },
                },
            },
        };
    }),
];
