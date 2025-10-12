import { EntityState } from '@ngrx/entity';
import { createFeatureSelector, createSelector, Selector } from '@ngrx/store';
import {
    GLOBAL_FAVORITES_PLAYLIST_ID,
    Playlist,
    PlaylistMeta,
} from 'shared-interfaces';
import * as fromPlaylistMetaState from './playlists.state';
import * as fromPlaylistState from './reducers';
import { selectRouteParam } from './router.selectors';
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

export const selectCurrentEpgProgram = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectCurrentEpgProgramReducer
);

export const selectCurrentPlaylistId = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectCurrentPlaylistIdReducer
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
    fromPlaylistMetaState.getPlaylistMetaEntities,
    (state) => state.selectedFilters
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
    selectCurrentPlaylistId,
    (data) => {
        if (data.selectedId === GLOBAL_FAVORITES_PLAYLIST_ID) {
            return 'Global favorites';
        } else if (
            data.entities &&
            data.selectedId &&
            data.entities[data.selectedId]
        ) {
            return (
                data.entities[data.selectedId]?.title ||
                data.entities[data.selectedId]?.filename
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
    selectCurrentPlaylistId,
    (entities, id, currentPlaylistId) => {
        if (entities) {
            return entities[id!] || entities[currentPlaylistId!];
        }
        return null;
    }
);

export const selectPlaylistById = (id: string) =>
    createSelector(selectPlaylistEntities, (entities) => {
        if (entities) {
            return entities[id] as Playlist;
        }
        return null;
    });

export const selectActivePlaylist = createSelector(
    selectPlaylistsMetaState,
    (state) => {
        if (state.entities && state.selectedId !== '') {
            return state.entities[state.selectedId] as Playlist;
        }
        return null;
    }
);

export const selectFavorites = createSelector(
    selectPlaylistsMetaState,
    fromPlaylistMetaState.getPlaylistMetaEntities,
    fromPlaylistState.selectPlaylistId as unknown as Selector<
        EntityState<PlaylistMeta>,
        string
    >,
    (data) => {
        if (
            data.entities &&
            data.selectedId &&
            data.entities[data.selectedId]
        ) {
            return data.entities[data.selectedId]?.favorites || [];
        } else return [];
    }
);
