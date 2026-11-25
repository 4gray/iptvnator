import {
    DEFAULT_PERSONAL_SCOPE,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';

let active: PersonalScope = DEFAULT_PERSONAL_SCOPE;

/** Whose personal state this device reads and writes; `'shared'` until a profile is chosen. */
export const activePersonalScope = (): PersonalScope => active;
export const setActivePersonalScope = (scope: PersonalScope): void => {
    active = scope;
};
