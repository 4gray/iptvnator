import {
    DEFAULT_PERSONAL_SCOPE,
    DEFAULT_PROFILE_ID,
    PROFILE_NAME_MAX_LENGTH,
    isProfileId,
    parsePersonalScope,
    profileScope,
    type PersonalScope,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';

const COLOUR = /^#[0-9a-f]{6}$/i;
const EMOJI_MAX_LENGTH = 32;

export function parseServerProfile(value: unknown): ServerProfile | null {
    const record = objectRecord(value);
    if (!record) return null;
    const id = record['id'];
    if (id !== DEFAULT_PROFILE_ID && !isProfileId(id)) return null;
    const scope = personalScopeOf(record['scope']);
    if (
        !scope ||
        scope !==
            (id === DEFAULT_PROFILE_ID
                ? DEFAULT_PERSONAL_SCOPE
                : profileScope(id))
    ) {
        return null;
    }
    const name = record['name'];
    const colour = record['colour'];
    const emoji = record['emoji'];
    if (
        typeof name !== 'string' ||
        !name ||
        name.length > PROFILE_NAME_MAX_LENGTH * 2 ||
        typeof colour !== 'string' ||
        !COLOUR.test(colour) ||
        (emoji !== undefined &&
            (typeof emoji !== 'string' ||
                !emoji ||
                emoji.length > EMOJI_MAX_LENGTH)) ||
        typeof record['hasPin'] !== 'boolean' ||
        typeof record['kids'] !== 'boolean' ||
        typeof record['sortOrder'] !== 'number' ||
        !Number.isFinite(record['sortOrder'])
    ) {
        return null;
    }
    return {
        id,
        scope,
        name,
        colour: colour.toLowerCase(),
        ...(emoji === undefined ? {} : { emoji }),
        hasPin: record['hasPin'],
        kids: record['kids'],
        sortOrder: record['sortOrder'],
    };
}

export function parseServerProfileList(
    value: unknown
): ServerProfileList | null {
    const record = objectRecord(value);
    if (
        !record ||
        typeof record['enabled'] !== 'boolean' ||
        typeof record['revision'] !== 'number' ||
        !Number.isSafeInteger(record['revision']) ||
        record['revision'] < 0 ||
        !Array.isArray(record['profiles'])
    ) {
        return null;
    }
    const rawProfiles: unknown[] = record['profiles'];
    const profiles = rawProfiles.map(parseServerProfile);
    if (profiles.some((profile) => !profile)) return null;
    const parsed = profiles as ServerProfile[];
    const ids = new Set(parsed.map((profile) => profile.id));
    if (
        ids.size !== parsed.length ||
        parsed.filter((profile) => profile.id === DEFAULT_PROFILE_ID).length !==
            1
    ) {
        return null;
    }
    return {
        enabled: record['enabled'],
        revision: record['revision'],
        profiles: parsed,
    };
}

export function parseUnlockResponse(value: unknown): true | null {
    return objectRecord(value)?.['unlocked'] === true ? true : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function personalScopeOf(value: unknown): PersonalScope | null {
    try {
        return parsePersonalScope(value);
    } catch {
        return null;
    }
}
