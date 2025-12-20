import { on } from '@ngrx/store';
import { FilterActions } from '../actions';
import { PlaylistState } from '../state';

export const filterReducers = [
    on(
        FilterActions.setSelectedFilters,
        (state, { selectedFilters }): PlaylistState => {
            return {
                ...state,
                playlists: {
                    ...state.playlists,
                    selectedFilters,
                },
            };
        }
    ),
];
