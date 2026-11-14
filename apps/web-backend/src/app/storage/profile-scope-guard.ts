import type { Request } from 'express';
import {
    DEFAULT_PERSONAL_SCOPE,
    parsePersonalScope,
    type PersonalScope,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

/** A personal scope must name an existing profile; `'shared'` always does. */
export function requireProfileScope(
    storage: ServerStorage,
    scope: PersonalScope | undefined
): void {
    if (!storage.profiles.hasScope(scope ?? DEFAULT_PERSONAL_SCOPE)) {
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
