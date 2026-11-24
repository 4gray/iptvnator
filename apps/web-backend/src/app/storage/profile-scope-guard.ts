import type { Request } from 'express';
import {
    DEFAULT_PERSONAL_SCOPE,
    parsePersonalScope,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

/**
 * A personal scope must name an existing profile; `'shared'` always does.
 * While profiles are off for the household only `'shared'` is accepted, so
 * a device that has not caught up cannot write into a profile.
 */
export function requireProfileScope(
    storage: ServerStorage,
    scope: PersonalScope | undefined
): void {
    const personal = scope ?? DEFAULT_PERSONAL_SCOPE;
    if (
        personal !== DEFAULT_PERSONAL_SCOPE &&
        !storage.profiles.household.enabled()
    ) {
        throw new StorageRequestError(
            409,
            'profiles_disabled',
            'Profiles are turned off for this household.'
        );
    }
    if (!storage.profiles.hasScope(personal)) {
        throw new StorageRequestError(
            409,
            'profile_missing',
            'The profile no longer exists.'
        );
    }
}

/**
 * The `?scope=` of a list or read request: whose entries to return. Absent
 * means the Default profile, as older clients send.
 */
export function scopeQuery(
    storage: ServerStorage,
    req: Request
): PersonalScope {
    const value = req.query['scope'];
    if (value === undefined) return DEFAULT_PERSONAL_SCOPE;
    let scope: PersonalScope;
    try {
        // `?scope=a&scope=b` arrives as an array; only one scope is valid.
        if (typeof value !== 'string') throw new Error('Not a single scope');
        scope = parsePersonalScope(value);
    } catch {
        throw new StorageRequestError(
            400,
            'invalid_scope',
            'Invalid profile scope.'
        );
    }
    requireProfileScope(storage, scope);
    return scope;
}
