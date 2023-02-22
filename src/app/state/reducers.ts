import { createReducer, on } from '@ngrx/store';
import * as moment from 'moment';
import * as PlaylistActions from './actions';
import { playlistsAdapter } from './playlists.state';
import { initialState, PlaylistState } from './state';

export const playlistReducer = createReducer(
    initialState,
    on(PlaylistActions.setActiveEpgProgram, (state, action): PlaylistState => {
        const { program } = action;
        const from = moment(program.start, 'YYYYMMDDHHmm ZZ').unix();
        const now = moment(Date.now()).unix();
        const epgParams = `?utc=${from}&lutc=${now}`;
        return {
            ...state,
            active: { ...state.active, epgParams },
        };
    }),
    on(
        PlaylistActions.resetActiveEpgProgram,
        (state): PlaylistState => ({
            ...state,
            active: { ...state.active, epgParams: '' },
        })
    ),
    on(
        PlaylistActions.setActiveChannelSuccess,
        (state, action): PlaylistState => {
            const { channel } = action;
            return {
                ...state,
                active: { ...channel, epgParams: '' },
            };
        }
    ),
    on(
        PlaylistActions.setCurrentEpgProgram,
        (state, action): PlaylistState => ({
            ...state,
            currentEpgProgram: action.program,
        })
    ),
    on(
        PlaylistActions.setEpgAvailableFlag,
        (state, action): PlaylistState => ({
            ...state,
            epgAvailable: action.value,
        })
    ),

    /* on(PlaylistActions.setPlaylist, (state, action): PlaylistState => {
        const { playlist } = action;
        return {
            ...state,
            channels: playlist?.playlist.items.map((element) =>
                createChannel(element)
            ),
            active: undefined,
        };
    }), */
    on(PlaylistActions.updateFavorites, (state, action): PlaylistState => {
        let favorites;
        const { channel } = action;
        const playlistFavorites =
            state.playlists.entities[state.playlists.selectedId].favorites;
        if (playlistFavorites.includes(channel.id)) {
            favorites = [
                ...playlistFavorites.filter((id) => id !== channel.id),
            ];
        } else {
            favorites = [...playlistFavorites, channel.id];
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
    on(PlaylistActions.loadPlaylistsSuccess, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.upsertMany(
                action.playlists,
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.removePlaylist, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.removeOne(
                action.playlistId,
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.updatePlaylist, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.updateOne(
                {
                    id: action.playlistId,
                    changes: { ...action.playlist, _id: action.playlistId },
                },
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.addPlaylist, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.addOne(
                action.playlist,
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.addManyPlaylists, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.addMany(
                action.playlists,
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.setActivePlaylist, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: {
                ...state.playlists,
                selectedId: action.playlistId,
            },
        };
    }),
    on(
        PlaylistActions.updatePlaylistPositions,
        (state, action): PlaylistState => {
            return {
                ...state,
                playlists: playlistsAdapter.updateMany(
                    action.positionUpdates,
                    state.playlists
                ),
            };
        }
    ),
    on(PlaylistActions.updatePlaylistMeta, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.updateOne(
                {
                    id: action.playlist._id,
                    changes: {
                        title: action.playlist.title,
                        autoRefresh: action.playlist.autoRefresh || false,
                    },
                },
                state.playlists
            ),
        };
    })
);

export const selectIsEpgAvailable = (state: PlaylistState) =>
    state.epgAvailable;
export const selectActive = (state: PlaylistState) => state.active;
export const selectCurrentEpgProgram = (state: PlaylistState) =>
    state.currentEpgProgram;
export const selectChannels = (state: PlaylistState) => state.channels;
export const selectPlaylists = (state: PlaylistState) => state.playlists;
export const selectPlaylistId = (state: PlaylistState) =>
    state.playlists?.selectedId;