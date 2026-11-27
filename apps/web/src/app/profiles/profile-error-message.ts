import type {
    ProfilesError,
    ProfilesErrorCode,
} from '@iptvnator/services/profiles';
import { PROFILE_LIMIT } from '@iptvnator/shared/interfaces/profiles';

export interface ProfileErrorMessage {
    readonly key: string;
    readonly params?: Readonly<Record<string, number>>;
}

const GENERIC = 'PROFILES.ERRORS.GENERIC';

const KEYS: Readonly<Record<ProfilesErrorCode, string>> = {
    pin_required: 'PROFILES.ERRORS.PIN_REQUIRED',
    wrong_pin: 'PROFILES.ERRORS.WRONG_PIN',
    pin_locked: 'PROFILES.ERRORS.PIN_LOCKED',
    pin_rate_limited: 'PROFILES.ERRORS.RATE_LIMITED',
    profiles_disabled: 'PROFILES.ERRORS.DISABLED',
    profile_missing: 'PROFILES.ERRORS.MISSING',
    profile_name_taken: 'PROFILES.ERRORS.NAME_TAKEN',
    profile_limit: 'PROFILES.ERRORS.LIMIT',
    profile_order_mismatch: 'PROFILES.ERRORS.CHANGED',
    kids_profile_pin: 'PROFILES.ERRORS.KIDS_PIN',
    default_profile: 'PROFILES.ERRORS.DEFAULT_PROFILE',
    default_profile_kids: 'PROFILES.ERRORS.DEFAULT_KIDS',
    pin_changed: 'PROFILES.ERRORS.CHANGED',
    invalid_profile_name: 'PROFILES.ERRORS.INVALID_NAME',
    invalid_profile_colour: 'PROFILES.ERRORS.INVALID_COLOUR',
    invalid_profile_emoji: 'PROFILES.ERRORS.INVALID_EMOJI',
    invalid_pin: 'PROFILES.ERRORS.INVALID_PIN',
    invalid_profile_order: GENERIC,
    invalid_profiles_setting: GENERIC,
    invalid_profile_id: GENERIC,
    invalid_body: GENERIC,
    invalid_response: GENERIC,
    unavailable: 'PROFILES.ERRORS.UNAVAILABLE',
    offline: 'PROFILES.ERRORS.OFFLINE',
};

/**
 * The translated message for a failed profiles call. It names the failure
 * only: never the PIN, never the server's own text.
 */
export function profileErrorMessage(error: ProfilesError): ProfileErrorMessage {
    if (error.code === 'pin_locked' || error.code === 'pin_rate_limited') {
        return !error.retryAfter
            ? { key: `${KEYS[error.code]}_NOW` }
            : { key: KEYS[error.code], params: { seconds: error.retryAfter } };
    }
    if (error.code === 'profile_limit') {
        return { key: KEYS[error.code], params: { max: PROFILE_LIMIT } };
    }
    return { key: KEYS[error.code] ?? GENERIC };
}

/** Seconds to wait before another PIN try, when the error is a lock. */
export function retryAfterSeconds(error: ProfilesError): number | null {
    return (error.code === 'pin_locked' || error.code === 'pin_rate_limited') &&
        !!error.retryAfter
        ? error.retryAfter
        : null;
}
