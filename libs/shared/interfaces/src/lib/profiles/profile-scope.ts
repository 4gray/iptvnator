/**
 * Whose personal state a sync address belongs to. `'shared'` is the household's
 * Default profile: every record written before profiles existed carries it, so
 * those records keep their storage keys unchanged. Any other profile is
 * `profile:<id>`, with the id a lowercase UUID issued by the server.
 */
export type PersonalScope = 'shared' | `profile:${string}`;

export const DEFAULT_PERSONAL_SCOPE = 'shared' satisfies PersonalScope;

const PROFILE_PREFIX = 'profile:';
const PROFILE_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isProfileId(value: unknown): value is string {
    return typeof value === 'string' && PROFILE_ID.test(value);
}

/** Throws on anything but `'shared'` or `profile:<uuid>`. */
export function parsePersonalScope(value: unknown): PersonalScope {
    if (value === DEFAULT_PERSONAL_SCOPE) return value;
    if (
        typeof value === 'string' &&
        value.startsWith(PROFILE_PREFIX) &&
        isProfileId(value.slice(PROFILE_PREFIX.length))
    ) {
        return value as PersonalScope;
    }
    throw new Error('Invalid personal scope');
}

export function profileScope(profileId: string): PersonalScope {
    if (!isProfileId(profileId)) throw new Error('Invalid profile id');
    return `${PROFILE_PREFIX}${profileId}`;
}

/** The profile id of a scope, or null for the Default profile. */
export function profileIdOfScope(scope: PersonalScope): string | null {
    return scope === DEFAULT_PERSONAL_SCOPE
        ? null
        : parsePersonalScope(scope).slice(PROFILE_PREFIX.length);
}
