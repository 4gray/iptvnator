import { computed, signal } from '@angular/core';
import type {
    ProfilesError,
    ProfilesResult,
} from '@iptvnator/services/profiles';
import {
    DEFAULT_PROFILE_ID,
    type PersonalScope,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';

export const ADULT_ID = '11111111-1111-4111-8111-111111111111';
export const KIDS_ID = '22222222-2222-4222-8222-222222222222';
export const PIN_ID = '33333333-3333-4333-8333-333333333333';

export function syntheticProfile(
    id: string,
    sortOrder: number,
    over: Partial<ServerProfile> = {}
): ServerProfile {
    return {
        id,
        scope: id === DEFAULT_PROFILE_ID ? 'shared' : `profile:${id}`,
        name: `Synthetic ${sortOrder}`,
        colour: '#3b82f6',
        hasPin: false,
        kids: false,
        sortOrder,
        ...over,
    };
}

export const ok = <T>(value: T): ProfilesResult<T> => ({ ok: true, value });
export const fail = (error: ProfilesError): ProfilesResult<never> => ({
    ok: false,
    error,
});

/** A runtime stand-in with the same public surface the UI uses. */
export function fakeRuntime(
    profiles: ServerProfile[] = [
        syntheticProfile(DEFAULT_PROFILE_ID, 0),
        syntheticProfile(ADULT_ID, 1),
        syntheticProfile(KIDS_ID, 2, { kids: true }),
        syntheticProfile(PIN_ID, 3, { hasPin: true }),
    ]
) {
    const list = signal<ServerProfileList | null>({
        enabled: true,
        revision: 1,
        profiles,
    });
    const state = signal<
        'idle' | 'checking' | 'ready' | 'unsupported' | 'offline'
    >('ready');
    const activeId = signal(DEFAULT_PROFILE_ID);
    const client = {
        list: jest.fn(),
        setEnabled: jest.fn(),
        reorder: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        unlock: jest.fn(),
    };
    const runtime = {
        list,
        state,
        activeId,
        capable: signal(true),
        scope: signal<PersonalScope>('shared'),
        enabled: computed(() => list()?.enabled ?? false),
        active: computed(
            () =>
                list()?.profiles.find((profile) => profile.id === activeId()) ??
                null
        ),
        refresh: jest.fn(async () => undefined),
        holdDefault: jest.fn(() => undefined),
        recheck: jest.fn(async () => undefined),
        select: jest.fn((_id: string) => true),
        handleProfileError: jest.fn((_code: string, _id?: string) => undefined),
        client: () => client,
    };
    return { runtime, client, list, state, activeId };
}
