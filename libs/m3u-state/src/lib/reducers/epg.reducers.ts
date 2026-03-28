import { on } from '@ngrx/store';
import { Channel } from 'shared-interfaces';
import { EpgActions } from '../actions';
import { PlaylistState } from '../state';

function toUnixTimestamp(value: string): number {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
        return Math.floor(parsed / 1000);
    }

    const match = value.match(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{2})(\d{2})$/
    );
    if (!match) {
        return Math.floor(Date.now() / 1000);
    }

    const [, year, month, day, hour, minute, offsetHours, offsetMinutes] =
        match;
    const utcMillis = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute)
    );
    const offsetTotalMinutes =
        Number(offsetHours) * 60 +
        Math.sign(Number(offsetHours)) * Number(offsetMinutes);

    return Math.floor(
        (utcMillis - offsetTotalMinutes * 60_000) / 1000
    );
}

export const epgReducers = [
    on(EpgActions.setActiveEpgProgram, (state, action): PlaylistState => {
        const { program } = action;
        const from = toUnixTimestamp(program.start);
        const now = Math.floor(Date.now() / 1000);
        const epgParams = `?utc=${from}&lutc=${now}`;
        return {
            ...state,
            active: state.active
                ? ({ ...state.active, epgParams } as Channel)
                : undefined,
        };
    }),
    on(
        EpgActions.resetActiveEpgProgram,
        (state): PlaylistState => {
            if (!state.active) {
                return state;
            }

            if (!state.active.epgParams) {
                return state;
            }

            return {
                ...state,
                active: { ...state.active, epgParams: '' } as Channel,
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
