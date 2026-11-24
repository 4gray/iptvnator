import {
    DEFAULT_PROFILE_ID,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';

export interface ProfilesStartInput {
    readonly uiEnabled: boolean;
    readonly connected: boolean;
    readonly capable: boolean;
    readonly enabled: boolean;
    readonly startPref: 'ask' | 'last';
    readonly lastId: string | null;
    readonly profiles: readonly Pick<ServerProfile, 'id' | 'hasPin'>[];
}

export function needsPicker(input: ProfilesStartInput): boolean {
    if (
        !input.uiEnabled ||
        !input.connected ||
        !input.capable ||
        !input.enabled ||
        input.profiles.length <= 1
    )
        return false;
    if (input.startPref === 'ask') return true;
    const last = input.profiles.find((profile) => profile.id === input.lastId);
    return !last || last.hasPin;
}

export function resolveActiveProfileId(
    list: ServerProfileList | null,
    storedId: string | null
): string {
    if (
        !list?.enabled ||
        !storedId ||
        !list.profiles.some((profile) => profile.id === storedId)
    )
        return DEFAULT_PROFILE_ID;
    return storedId;
}
