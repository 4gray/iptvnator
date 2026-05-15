import { on } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import { PlaylistActions } from '../actions';
import { playlistsAdapter } from '../playlists.state';
import { PlaylistState } from '../state';

export const playlistReducers = [
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
        const playlists = playlistsAdapter.removeOne(
            action.playlistId,
            state.playlists
        );
        return {
            ...state,
            playlists: {
                ...playlists,
                selectedId:
                    state.playlists.selectedId === action.playlistId
                        ? ''
                        : playlists.selectedId,
            },
        };
    }),
    on(PlaylistActions.updatePlaylist, (state, action): PlaylistState => {
        const isActivePlaylist =
            state.playlists.selectedId === action.playlistId;
        const currentPlaylist = state.playlists.entities[action.playlistId];
        return {
            ...state,
            channels: isActivePlaylist
                ? (action.playlist.playlist.items as Channel[])
                : state.channels,
            channelsLoading: isActivePlaylist ? false : state.channelsLoading,
            playlists: playlistsAdapter.updateOne(
                {
                    id: action.playlistId,
                    changes: {
                        ...action.playlist,
                        _id: action.playlistId,
                        updateDate: Date.now(),
                        count: action.playlist.playlist.items.length,
                        userAgent: action.playlist.userAgent,
                        favorites:
                            currentPlaylist?.favorites ?? [],
                        autoRefresh:
                            currentPlaylist?.autoRefresh ??
                            action.playlist.autoRefresh,
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
        const p = action.playlist;
        return {
            ...state,
            playlists: playlistsAdapter.updateOne(
                {
                    id: p._id,
                    changes: {
                        ...(p.title != null ? { title: p.title } : {}),
                        ...(p.autoRefresh != null
                            ? { autoRefresh: p.autoRefresh }
                            : {}),
                        ...(p.userAgent != null
                            ? { userAgent: p.userAgent }
                            : {}),
                        ...(p.referrer !== undefined
                            ? { referrer: p.referrer }
                            : {}),
                        ...(p.origin !== undefined ? { origin: p.origin } : {}),
                        ...(p.serverUrl != null
                            ? { serverUrl: p.serverUrl }
                            : {}),
                        ...(p.username != null ? { username: p.username } : {}),
                        ...(p.password != null ? { password: p.password } : {}),
                        ...(p.macAddress != null
                            ? { macAddress: p.macAddress }
                            : {}),
                        ...(p.portalUrl != null
                            ? { portalUrl: p.portalUrl }
                            : {}),
                        ...(p.isFullStalkerPortal !== undefined
                            ? {
                                  isFullStalkerPortal: p.isFullStalkerPortal,
                              }
                            : {}),
                        ...(p.favorites != null
                            ? { favorites: p.favorites }
                            : {}),
                        ...(p.recentlyViewed != null
                            ? { recentlyViewed: p.recentlyViewed }
                            : {}),
                        ...(p.hiddenGroupTitles != null
                            ? { hiddenGroupTitles: p.hiddenGroupTitles }
                            : {}),
                        ...(p.updateDate !== undefined
                            ? { updateDate: p.updateDate }
                            : {}),
                    },
                },
                state.playlists
            ),
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
        const playlists = playlistsAdapter.removeAll(state.playlists);
        return {
            ...state,
            playlists: {
                ...playlists,
                selectedId: '',
            },
        };
    }),
    on(
        PlaylistActions.handleAddingPlaylistByUrl,
        (state, action): PlaylistState => {
            if (action.isTemporary) {
                return {
                    ...state,
                    channelsLoading: false,
                    channels: action.playlist.playlist.items as Channel[],
                };
            } else {
                return {
                    ...state,
                    playlists: playlistsAdapter.addOne(
                        action.playlist,
                        state.playlists
                    ),
                };
            }
        }
    ),
];
