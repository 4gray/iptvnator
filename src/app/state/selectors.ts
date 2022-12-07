import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as fromPlaylistState from './reducers';
import { PlaylistState } from './state';

export const selectPlaylistState =
    createFeatureSelector<PlaylistState>('playlistState');

export const selectFavorites = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectFavorites
);

export const selectPlaylistId = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectPlaylistId
);

export const selectIsEpgAvailable = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectIsEpgAvailable
);

export const selectPlaylistFilename = createSelector(
    selectPlaylistState,
    fromPlaylistState.selectPlaylistFilename
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
