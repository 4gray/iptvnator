import { THEME_ACCENTS } from '../theme-accent';
import type { PersonalScope } from './profile-scope';

/** `/v1/instance` capability of a server that serves `/v1/profiles`. */
export const PROFILES_CAPABILITY = 'profiles-v1';

/** Id of the household's Default profile, whose personal scope is `'shared'`. */
export const DEFAULT_PROFILE_ID = 'default';

export const PROFILE_NAME_MAX_LENGTH = 32;
export const PROFILE_LIMIT = 12;

/**
 * The colours a profile can pick, and the ones the server hands out in turn
 * to new profiles. The theme accents come first, then five more so that
 * every one of up to `PROFILE_LIMIT` profiles can have its own. The ids name
 * the translation of each colour (`THEMES.ACCENT_<ID>`).
 */
export const PROFILE_COLOURS = [
    ...THEME_ACCENTS,
    { id: 'red', hex: '#dc2626' },
    { id: 'cyan', hex: '#06b6d4' },
    { id: 'lime', hex: '#84cc16' },
    { id: 'slate', hex: '#64748b' },
    { id: 'brown', hex: '#92400e' },
] as const;

/**
 * A person in the household. The PIN is a light lock: the server checks it
 * before the PIN is changed or removed and before the profile is deleted,
 * but anyone with the access token can read and write every scope, so a
 * profile is only as private as the client keeps it. The access token stays
 * the security boundary.
 */
export interface ServerProfile {
    readonly id: string;
    /** The scope this profile's activity, favorites and history are stored under. */
    readonly scope: PersonalScope;
    readonly name: string;
    /** `#rrggbb`. */
    readonly colour: string;
    /** One emoji shown with the colour instead of a letter; absent if none. */
    readonly emoji?: string;
    readonly hasPin: boolean;
    /**
     * A kids profile. Clients keep the app's parental lock always on while
     * it is active, and leaving it asks for the parental PIN. A kids profile
     * cannot also have a profile PIN, so there is one lock to explain; the
     * optional PIN is for adult profiles. The Default profile is never a
     * kids profile: it holds the shared data older clients show.
     */
    readonly kids: boolean;
    readonly sortOrder: number;
}

export interface ServerProfileList {
    /**
     * Whether profiles are on for the household, one switch for every
     * device. Off by default; while off the server accepts only the
     * `'shared'` scope, and turning it off deletes nothing.
     */
    readonly enabled: boolean;
    /**
     * Moves on every change to the profiles or to `enabled`. Also sent as
     * the `ETag`; a matching `If-None-Match` is answered with `304`.
     */
    readonly revision: number;
    /** The Default profile first, then the others in `sortOrder`. */
    readonly profiles: ServerProfile[];
}

/** `PATCH /v1/profiles`: turns profiles on or off for the household. */
export interface UpdateServerProfilesRequest {
    readonly enabled: boolean;
}

/** `kids` and `pin` exclude each other. */
export interface CreateServerProfileRequest {
    readonly name: string;
    readonly colour?: string;
    readonly emoji?: string;
    readonly pin?: string;
    readonly kids?: boolean;
}

/**
 * `pin: null` removes the PIN; an absent field is left unchanged. Setting or
 * removing the PIN of a profile that has one takes `currentPin`; a wrong one
 * counts towards the profile's lock like a wrong unlock.
 */
export interface UpdateServerProfileRequest {
    readonly name?: string;
    readonly colour?: string;
    /** `null` removes the emoji. */
    readonly emoji?: string | null;
    readonly pin?: string | null;
    readonly currentPin?: string;
    /** Turning a profile into a kids profile needs its PIN removed first or in the same request. */
    readonly kids?: boolean;
}

/** Body of `DELETE /v1/profiles/:id`; a PIN-protected profile takes its PIN. */
export interface DeleteServerProfileRequest {
    readonly currentPin?: string;
}

/**
 * `PUT /v1/profiles/order`: every profile id once, in the new order. The
 * Default profile stays first; it may lead the list or be left out.
 */
export interface ReorderServerProfilesRequest {
    readonly ids: readonly string[];
}

export interface UnlockServerProfileRequest {
    readonly pin: string;
}
