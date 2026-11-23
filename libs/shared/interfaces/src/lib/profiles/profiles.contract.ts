import type { PersonalScope } from './profile-scope';

/** `/v1/instance` capability of a server that serves `/v1/profiles`. */
export const PROFILES_CAPABILITY = 'profiles-v1';

/** Id of the household's Default profile, whose personal scope is `'shared'`. */
export const DEFAULT_PROFILE_ID = 'default';

export const PROFILE_NAME_MAX_LENGTH = 32;
export const PROFILE_LIMIT = 12;

/**
 * A person in the household. The PIN is only a light lock against picking
 * someone else's profile by accident; the server access token stays the
 * security boundary.
 */
export interface ServerProfile {
    readonly id: string;
    /** The scope this profile's activity, favorites and history are stored under. */
    readonly scope: PersonalScope;
    readonly name: string;
    /** `#rrggbb`. */
    readonly colour: string;
    readonly hasPin: boolean;
    readonly sortOrder: number;
}

export interface ServerProfileList {
    /**
     * Whether profiles are on for the household, one switch for every
     * device. Off by default; while off the server accepts only the
     * `'shared'` scope, and turning it off deletes nothing.
     */
    readonly enabled: boolean;
    /** Moves on every change to the profiles or to `enabled`. */
    readonly revision: number;
    /** The Default profile first, then the others in `sortOrder`. */
    readonly profiles: ServerProfile[];
}

/** `PATCH /v1/profiles`: turns profiles on or off for the household. */
export interface UpdateServerProfilesRequest {
    readonly enabled: boolean;
}

export interface CreateServerProfileRequest {
    readonly name: string;
    readonly colour?: string;
    readonly pin?: string;
}

/** `pin: null` removes the PIN; an absent field is left unchanged. */
export interface UpdateServerProfileRequest {
    readonly name?: string;
    readonly colour?: string;
    readonly pin?: string | null;
}

export interface UnlockServerProfileRequest {
    readonly pin: string;
}
