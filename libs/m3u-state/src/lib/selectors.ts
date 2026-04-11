import { createFeatureSelector, createSelector } from '@ngrx/store';
import { Playlist } from 'shared-interfaces';
import * as fromPlaylistMetaState from './playlists.state';
import * as fromPlaylistState from './reducers';
import { PlaylistState } from './state';

export const selectPlaylistState =
    createFeatureSelector<PlaylistState>('playlistState');

export const selectIsEpgAvailable = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectIsEpgAvailableReducer
);

export const selectActive = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectActiveReducer
);

export const selectActivePlaybackUrl = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectActivePlaybackUrlReducer
);

export const selectCurrentEpgProgram = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectCurrentEpgProgramReducer
);

export const selectChannelsLoading = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectChannelsLoadingReducer
);

export const selectChannels = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectChannelsReducer
);

export const selectPlaylistsLoadingFlag = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectPlaylistsLoadingFlagReducer
);

/** Playlist entity store selectors */
export const selectPlaylistsMetaState = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectPlaylists
);

export const selectAllPlaylistsMeta = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getAllPlaylistsMeta
);

export const selectActiveTypeFilters = createSelector(
    selectPlaylistsMetaState,
    (state) => state.selectedFilters
);

export const selectPlaylistEntity = (id: string) =>
    createSelector(selectPlaylistEntities, (entities) => entities[id]);

export const selectActivePlaylistId = createSelector(
    selectPlaylistsMetaState,
    (state) => state.selectedId
);

export const selectPlaylistEntities = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getPlaylistMetaEntities
);

export const selectActivePlaylist = createSelector(
    selectPlaylistEntities,
    selectActivePlaylistId,
    (entities, activePlaylistId) => {
        if (!entities || !activePlaylistId) {
            return null;
        }

        return entities[activePlaylistId] ?? null;
    }
);

export const selectPlaylistTitle = createSelector(
    selectActivePlaylist,
    (playlist) => playlist?.title || playlist?.filename || 'Untitled playlist'
);

export const selectPlaylistById = (id: string) =>
    createSelector(selectPlaylistEntities, (entities) => {
        if (entities) {
            return entities[id] as Playlist;
        }
        return null;
    });

export const selectFavorites = createSelector(
    selectActivePlaylist,
    (playlist) =>
        (playlist?.favorites || []).filter(
            (favorite): favorite is string => typeof favorite === 'string'
        )
);
