import type { SourceServerResponse } from '@iptvnator/shared/interfaces';

export type ProfilesErrorCode =
    | 'pin_required'
    | 'wrong_pin'
    | 'pin_locked'
    | 'pin_rate_limited'
    | 'profiles_disabled'
    | 'profile_missing'
    | 'profile_name_taken'
    | 'profile_limit'
    | 'profile_order_mismatch'
    | 'kids_profile_pin'
    | 'default_profile'
    | 'default_profile_kids'
    | 'pin_changed'
    | 'invalid_profile_name'
    | 'invalid_profile_colour'
    | 'invalid_profile_emoji'
    | 'invalid_pin'
    | 'invalid_profile_order'
    | 'invalid_profiles_setting'
    | 'invalid_profile_id'
    | 'invalid_body'
    | 'invalid_response'
    | 'unavailable'
    | 'offline';

export type ProfilesError =
    | {
          readonly code: 'pin_locked' | 'pin_rate_limited';
          readonly retryAfter: number | null;
      }
    | {
          readonly code: Exclude<
              ProfilesErrorCode,
              'pin_locked' | 'pin_rate_limited'
          >;
      };

export type ProfilesResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: ProfilesError };

const SERVER_CODES = new Set<ProfilesErrorCode>([
    'pin_required',
    'wrong_pin',
    'pin_locked',
    'pin_rate_limited',
    'profiles_disabled',
    'profile_missing',
    'profile_name_taken',
    'profile_limit',
    'profile_order_mismatch',
    'kids_profile_pin',
    'default_profile',
    'default_profile_kids',
    'pin_changed',
    'invalid_profile_name',
    'invalid_profile_colour',
    'invalid_profile_emoji',
    'invalid_pin',
    'invalid_profile_order',
    'invalid_profiles_setting',
    'invalid_body',
]);

/** Maps a failed profiles response without exposing its body or message. */
export function profilesErrorOf(response: SourceServerResponse): ProfilesError {
    if (response.status >= 500) return profilesOfflineError();
    if (response.status < 400 || response.status === 401) {
        return { code: 'unavailable' };
    }
    const code = errorCode(response.body);
    if (code === 'invalid_json' || code === 'too_large') {
        return { code: 'invalid_body' };
    }
    if (!code || !SERVER_CODES.has(code as ProfilesErrorCode)) {
        return { code: 'unavailable' };
    }
    if (code === 'pin_locked' || code === 'pin_rate_limited') {
        return { code, retryAfter: retryAfterOf(response.retryAfter) };
    }
    return {
        code: code as Exclude<
            ProfilesErrorCode,
            'pin_locked' | 'pin_rate_limited'
        >,
    };
}

/** A request failure deliberately has no diagnostic payload for callers. */
export function profilesOfflineError(): ProfilesError {
    return { code: 'offline' };
}

function errorCode(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const code = (value as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
}

function retryAfterOf(value: unknown): number | null {
    return typeof value === 'number' &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= 0
        ? value
        : null;
}
