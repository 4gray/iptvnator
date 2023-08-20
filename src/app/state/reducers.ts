import { createReducer, on } from '@ngrx/store';
import moment from 'moment';
import * as PlaylistActions from './actions';
import { playlistsAdapter } from './playlists.state';
import { PlaylistState, initialState } from './state';

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
    on(PlaylistActions.resetActiveChannel, (state): PlaylistState => {
        return {
            ...state,
            active: undefined,
        };
    }),
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
    on(PlaylistActions.setFavorites, (state, action): PlaylistState => {
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
    on(PlaylistActions.loadPlaylistsSuccess, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.addMany(action.playlists, {
                ...state.playlists,
                allPlaylistsLoaded: true,
            }),
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
                    changes: {
                        ...action.playlist,
                        _id: action.playlistId,
                        updateDate: Date.now(),
                        favorites: [],
                        count: action.playlist.playlist.items.length,
                        userAgent: action.playlist.userAgent,
                    },
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
                        userAgent: action.playlist.userAgent,
                        ...(action.playlist.serverUrl !== null
                            ? { serverUrl: action.playlist.serverUrl }
                            : {}),
                        ...(action.playlist.username !== null
                            ? { username: action.playlist.username }
                            : {}),
                        ...(action.playlist.password !== null
                            ? { password: action.playlist.password }
                            : {}),
                        ...(action.playlist.macAddress !== null
                            ? { macAddress: action.playlist.macAddress }
                            : {}),
                        ...(action.playlist.portalUrl !== null
                            ? { portalUrl: action.playlist.portalUrl }
                            : {}),
                    },
                },
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.setChannels, (state, action): PlaylistState => {
        return {
            ...state,
            channels: action.channels,
        };
    }),
    on(PlaylistActions.updateManyPlaylists, (state, action): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.updateMany(
                action.playlists.map((updatedPlaylist) => ({
                    id: updatedPlaylist._id,
                    changes: {
                        ...updatedPlaylist,
                        updateDate: Date.now(),
                    },
                })),
                state.playlists
            ),
        };
    }),
    on(PlaylistActions.removeAllPlaylists, (state): PlaylistState => {
        return {
            ...state,
            playlists: playlistsAdapter.removeAll(state.playlists),
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
export const selectPlaylistsLoadingFlag = (state: PlaylistState) =>
    state.playlists?.allPlaylistsLoaded;
