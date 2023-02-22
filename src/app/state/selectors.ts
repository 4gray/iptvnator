import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as fromPlaylistMetaState from './playlists.state';
import * as fromPlaylistState from './reducers';
import { PlaylistState } from './state';

export const selectPlaylistState =
    createFeatureSelector<PlaylistState>('playlistState');

export const selectIsEpgAvailable = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectIsEpgAvailable
);

export const selectActive = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectActive
);

export const selectCurrentEpgProgram = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectCurrentEpgProgram
);

export const selectChannels = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectChannels
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

export const selectPlaylistEntity = (id: string) =>
    createSelector(
        selectPlaylistsMetaState,
        fromPlaylistMetaState.getPlaylistMetaEntities,
        (data) => {
            return data.entities[id];
        }
    );

export const selectActivePlaylistId = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getPlaylistMetaEntities,
    (data) => data.selectedId
);

export const selectPlaylistTitle = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getPlaylistMetaEntities,
    fromPlaylistState.selectPlaylistId,
    (data) => {
        if (
            data.entities &&
            data.selectedId &&
            data.entities[data.selectedId]
        ) {
            return (
                data.entities[data.selectedId].title ||
                data.entities[data.selectedId].filename
            );
        } else return 'Untitled playlist';
    }
);

export const selectPlaylistEntities = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getPlaylistMetaEntities
);

export const selectFavorites = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getPlaylistMetaEntities,
    fromPlaylistState.selectPlaylistId,
    (data) => {
        if (
            data.entities &&
            data.selectedId &&
            data.entities[data.selectedId]
        ) {
            return data.entities[data.selectedId].favorites || [];
        } else return [];
    }
);