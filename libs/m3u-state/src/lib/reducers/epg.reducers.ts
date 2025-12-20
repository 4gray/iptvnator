import { on } from '@ngrx/store';
import moment from 'moment';
import { Channel } from 'shared-interfaces';
import { EpgActions } from '../actions';
import { PlaylistState } from '../state';

export const epgReducers = [
    on(EpgActions.setActiveEpgProgram, (state, action): PlaylistState => {
        const { program } = action;
        const from = moment(program.start, 'YYYYMMDDHHmm ZZ').unix();
        const now = moment(Date.now()).unix();
        const epgParams = `?utc=${from}&lutc=${now}`;
        return {
            ...state,
            active: { ...state.active, epgParams } as Channel,
        };
    }),
    on(
        EpgActions.resetActiveEpgProgram,
        (state): PlaylistState => ({
            ...state,
            active: { ...state.active, epgParams: '' } as Channel,
        })
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
