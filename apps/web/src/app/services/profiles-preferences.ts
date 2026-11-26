import {
    DEFAULT_PROFILE_ID,
    isProfileId,
} from '@iptvnator/shared/interfaces/profiles';

export type ProfilesStartPreference = 'ask' | 'last';

export function profilesStartKey(instanceId: string | null | undefined) {
    return instanceId
        ? `iptvnator-server:${instanceId}:profiles-start-v1`
        : null;
}

export function activeProfileKey(instanceId: string | null | undefined) {
    return instanceId
        ? `iptvnator-server:${instanceId}:active-profile-v1`
        : null;
}

export function readProfilesStart(
    instanceId: string | null | undefined
): ProfilesStartPreference {
    return read(profilesStartKey(instanceId)) === 'last' ? 'last' : 'ask';
}

export function writeProfilesStart(
    instanceId: string | null | undefined,
    value: ProfilesStartPreference
): boolean {
    return write(profilesStartKey(instanceId), value);
}

export function readActiveProfileId(
    instanceId: string | null | undefined
): string | null {
    const id = read(activeProfileKey(instanceId));
    return id === DEFAULT_PROFILE_ID || isProfileId(id) ? id : null;
}

export function writeActiveProfileId(
    instanceId: string | null | undefined,
    id: string
): boolean {
    if (id !== DEFAULT_PROFILE_ID && !isProfileId(id)) return false;
    return write(activeProfileKey(instanceId), id);
}

export function clearActiveProfileId(
    instanceId: string | null | undefined
): void {
    const key = activeProfileKey(instanceId);
    if (!key) return;
    try {
        localStorage.removeItem(key);
    } catch {
        // Storage can be unavailable in private or restricted contexts.
    }
}

function read(key: string | null): string | null {
    if (!key) return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key: string | null, value: string): boolean {
    if (!key) return false;
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}
