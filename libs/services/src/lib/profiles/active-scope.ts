import {
    DEFAULT_PERSONAL_SCOPE,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';

let active: PersonalScope = DEFAULT_PERSONAL_SCOPE;

/** A profile's state has nowhere to live without its sync; it never falls back to the household's document. */
export class ProfileStateUnavailableError extends Error {
    constructor() {
        super('Profile state needs its sync turned on');
    }
}

/** Whose personal state this device reads and writes; `'shared'` until a profile is chosen. */
export const activePersonalScope = (): PersonalScope => active;
export const setActivePersonalScope = (scope: PersonalScope): void => {
    active = scope;
};
