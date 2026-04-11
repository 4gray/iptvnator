import { on } from '@ngrx/store';
import { Channel } from 'shared-interfaces';
import { EpgActions } from '../actions';
import { PlaylistState } from '../state';

export const epgReducers = [
    on(EpgActions.setActivePlaybackUrl, (state, action): PlaylistState => ({
        ...state,
        activePlaybackUrl: action.playbackUrl,
    })),
    on(
        EpgActions.resetActiveEpgProgram,
        EpgActions.returnToLivePlayback,
        (state): PlaylistState => {
            if (!state.active && !state.activePlaybackUrl) {
                return state;
            }

            if (!state.activePlaybackUrl && !state.active?.epgParams) {
                return state;
            }

            return {
                ...state,
                activePlaybackUrl: null,
                active: state.active
                    ? ({ ...state.active, epgParams: '' } as Channel)
                    : undefined,
            };
        }
    ),
    on(
        EpgActions.setCurrentEpgProgram,
        (state, action): PlaylistState => ({
            ...state,
            currentEpgProgram: action.program,
        })
    ),
    on(
        EpgActions.setEpgAvailableFlag,
        (state, action): PlaylistState => ({
            ...state,
            epgAvailable: action.value,
        })
    ),
];
