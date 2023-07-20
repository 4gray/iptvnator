import { createFeatureSelector, createSelector } from '@ngrx/store';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from '../../../shared/constants';
import * as fromPlaylistMetaState from './playlists.state';
import * as fromPlaylistState from './reducers';
import { selectRouteParam } from './router.selectors';
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

export const selectPlaylistsLoadingFlag = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectPlaylistsLoadingFlag
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
        if (data.selectedId === GLOBAL_FAVORITES_PLAYLIST_ID) {
            return 'Global favorites';
        } else if (
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

export const selectCurrentPlaylist = createSelector(
    selectPlaylistEntities,
    selectRouteParam('id'),
    (entities, id) => {
        if (entities) {
            return entities[id];
        }
        return null;
    }
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
