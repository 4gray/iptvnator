import { on } from '@ngrx/store';
import { Channel } from 'shared-interfaces';
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
                        count: action.playlist.playlist.items.length,
                        userAgent: action.playlist.userAgent,
                        favorites:
                            state.playlists.entities[action.playlistId]
                                ?.favorites ?? [],
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
                        ...(p.isCustomPortal != null
                            ? { isCustomPortal: p.isCustomPortal }
                            : {}),
                        ...(p.customPortalKey != null
                            ? { customPortalKey: p.customPortalKey }
                            : {}),
                        ...(p.customPortalOriginalUrl != null
                            ? {
                                customPortalOriginalUrl:
                                    p.customPortalOriginalUrl,
                            }
                            : {}),
                        ...(p.favorites != null
                            ? { favorites: p.favorites }
                            : {}),
                        ...(p.recentlyViewed != null
                            ? { recentlyViewed: p.recentlyViewed }
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
        return {
            ...state,
            playlists: playlistsAdapter.removeAll(state.playlists),
        };
    }),
    on(
        PlaylistActions.setCurrentPlaylistId,
        (state, { playlistId }): PlaylistState => {
            return {
                ...state,
                currentPlaylistId: playlistId,
            };
        }
    ),
    on(
        PlaylistActions.handleAddingPlaylistByUrl,
        (state, action): PlaylistState => {
            if (action.isTemporary) {
                return {
                    ...state,
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