import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type {
    ServerProfile,
    ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import type { ServerStorage } from './server-storage';
import { requireProfileScope } from './profile-scope-guard';

function app(storage: ServerStorage) {
    return createWebBackendApp({
        clientOrigins: ['http://localhost:4200'],
        httpClient: new StubHttpClient(),
        resolveHostname: resolvePublicHost,
        storage,
    });
}

/** fetch with the instance header the sync routes require. */
function client(baseUrl: string, storage: ServerStorage) {
    return (path: string, init: { method?: string; body?: unknown } = {}) =>
        fetch(`${baseUrl}/v1${path}`, {
            method: init.method ?? 'GET',
            headers: {
                'content-type': 'application/json',
                'x-iptvnator-instance-id': storage.database.instanceId,
            },
            ...(init.body === undefined
                ? {}
                : { body: JSON.stringify(init.body) }),
        });
}

/** The error code of a failed storage request. */
const codeOf = async (response: Response) =>
    ((await response.json()) as { code: string }).code;

const profilesIn = async (response: Response) =>
    ((await response.json()) as ServerProfileList).profiles;

describe('profiles routes', () => {
    it('advertises the capability and starts with only the Default profile', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const instance = (await (
                    await fetch(`${baseUrl}/v1/instance`)
                ).json()) as ServerInstanceInfo;
                expect(instance.capabilities).toContain('profiles-v1');

                const list = (await (
                    await call('/profiles')
                ).json()) as ServerProfileList;
                expect(list.enabled).toBe(false);
                expect(list.revision).toBe(0);
                const profiles = list.profiles;
                expect(profiles).toEqual([
                    {
                        id: 'default',
                        scope: 'shared',
                        name: 'Default',
                        colour: '#3b82f6',
                        hasPin: false,
                        sortOrder: -1,
                    },
                ]);
            })
        ));

    it('turns profiles on and off for the household without deleting any', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const listOf = async (response: Response) =>
                    (await response.json()) as ServerProfileList;
                const kid = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Kid' },
                    })
                ).json()) as ServerProfile;
                const history = `/history/sources/source?scope=${kid.scope}`;

                // Off by default: a profile scope is refused, 'shared' is not.
                const off = await call(history);
                expect(off.status).toBe(409);
                expect(await codeOf(off)).toBe('profiles_disabled');
                expect(() => requireProfileScope(storage, kid.scope)).toThrow(
                    'Profiles are turned off'
                );
                expect(() =>
                    requireProfileScope(storage, 'shared')
                ).not.toThrow();

                const on = await listOf(
                    await call('/profiles', {
                        method: 'PATCH',
                        body: { enabled: true },
                    })
                );
                expect(on.enabled).toBe(true);
                expect(on.profiles).toHaveLength(2);
                // Past the scope check, to the missing source.
                expect((await call(history)).status).toBe(404);
                expect(() =>
                    requireProfileScope(storage, kid.scope)
                ).not.toThrow();

                const again = await listOf(
                    await call('/profiles', {
                        method: 'PATCH',
                        body: { enabled: false },
                    })
                );
                expect(again.enabled).toBe(false);
                expect(again.profiles.map((p) => p.id)).toEqual([
                    'default',
                    kid.id,
                ]);
                expect(again.revision).toBeGreaterThan(on.revision);
                expect((await call(history)).status).toBe(409);

                for (const body of [{}, { enabled: 'yes' }, [true]]) {
                    const bad = await call('/profiles', {
                        method: 'PATCH',
                        body,
                    });
                    expect(bad.status).toBe(400);
                }
            })
        ));

    it('moves the revision on every change to the list', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const revision = async () =>
                    (
                        (await (
                            await call('/profiles')
                        ).json()) as ServerProfileList
                    ).revision;
                const seen = [await revision()];
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Kid' },
                    })
                ).json()) as ServerProfile;
                seen.push(await revision());
                await call(`/profiles/${id}`, {
                    method: 'PATCH',
                    body: { name: 'Robin' },
                });
                seen.push(await revision());
                await call(`/profiles/${id}`, { method: 'DELETE' });
                seen.push(await revision());
                // Setting the switch to what it already is changes nothing.
                await call('/profiles', {
                    method: 'PATCH',
                    body: { enabled: false },
                });
                seen.push(await revision());
                expect(seen).toEqual([0, 1, 2, 3, 3]);
            })
        ));

    it('requires the verified instance id', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const response = await fetch(`${baseUrl}/v1/profiles`);
                expect(response.status).toBe(409);
                expect(await codeOf(response)).toBe('instance_changed');
            })
        ));

    it('creates profiles with their own scope, rejecting duplicates and bad input', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const created = await call('/profiles', {
                    method: 'POST',
                    body: { name: '  Robin ', colour: '#AA00CC' },
                });
                expect(created.status).toBe(201);
                const robin = (await created.json()) as ServerProfile;
                expect(robin).toMatchObject({
                    name: 'Robin',
                    colour: '#aa00cc',
                    hasPin: false,
                    scope: `profile:${robin.id}`,
                });

                const cases: [unknown, string][] = [
                    [{ name: 'robin' }, 'profile_name_taken'],
                    [{ name: '' }, 'invalid_profile_name'],
                    [{ name: 'x'.repeat(33) }, 'invalid_profile_name'],
                    [{ name: 'Sam', colour: 'blue' }, 'invalid_profile_colour'],
                    [{ name: 'Sam', pin: '12' }, 'invalid_pin'],
                    [['Sam'], 'invalid_body'],
                ];
                for (const [body, code] of cases) {
                    const response = await call('/profiles', {
                        method: 'POST',
                        body,
                    });
                    expect(await codeOf(response)).toBe(code);
                }
                expect(await profilesIn(await call('/profiles'))).toHaveLength(
                    2
                );
            })
        ));

    it('stops at the profile limit', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                for (let i = 1; i < 12; i++) {
                    const response = await call('/profiles', {
                        method: 'POST',
                        body: { name: `Person ${i}` },
                    });
                    expect(response.status).toBe(201);
                }
                const over = await call('/profiles', {
                    method: 'POST',
                    body: { name: 'One more' },
                });
                expect(over.status).toBe(409);
                expect(await codeOf(over)).toBe('profile_limit');
            })
        ));

    it('renames the Default profile and sets, checks and clears a PIN without returning it', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const renamed = await call('/profiles/default', {
                    method: 'PATCH',
                    body: { name: 'Household', pin: '2468' },
                });
                const body = await renamed.json();
                expect(body).toMatchObject({
                    id: 'default',
                    scope: 'shared',
                    name: 'Household',
                    hasPin: true,
                });
                expect(JSON.stringify(body)).not.toContain('scrypt');

                const wrong = await call('/profiles/default/unlock', {
                    method: 'POST',
                    body: { pin: '1111' },
                });
                expect(wrong.status).toBe(403);
                const right = await call('/profiles/default/unlock', {
                    method: 'POST',
                    body: { pin: '2468' },
                });
                expect(await right.json()).toEqual({ unlocked: true });

                await call('/profiles/default', {
                    method: 'PATCH',
                    body: { pin: null },
                });
                const cleared = await profilesIn(await call('/profiles'));
                expect(cleared[0]).toMatchObject({
                    name: 'Household',
                    hasPin: false,
                });
            })
        ));

    it('locks a profile for a while after five wrong PINs', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Kid', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                for (let i = 0; i < 5; i++) {
                    const response = await call(`/profiles/${id}/unlock`, {
                        method: 'POST',
                        body: { pin: '0000' },
                    });
                    expect(response.status).toBe(403);
                }
                const locked = await call(`/profiles/${id}/unlock`, {
                    method: 'POST',
                    body: { pin: '1234' },
                });
                expect(locked.status).toBe(429);
                expect(
                    Number(locked.headers.get('retry-after'))
                ).toBeGreaterThan(0);
            })
        ));

    it('caps PIN attempts per client across profiles', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const unlock = () =>
                    call('/profiles/default/unlock', {
                        method: 'POST',
                        body: { pin: '0000' },
                    });
                for (let i = 0; i < 30; i++)
                    expect((await unlock()).status).toBe(200);
                const limited = await unlock();
                expect(limited.status).toBe(429);
                expect(await codeOf(limited)).toBe('pin_rate_limited');
            })
        ));

    it('rejects a repeated ?scope= instead of reading either one', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const path = '/history/sources/source';
                // One scope passes the check and reaches the source lookup,
                // which has no such source here.
                expect((await call(`${path}?scope=shared`)).status).toBe(404);
                const repeated = await call(
                    `${path}?scope=shared&scope=shared`
                );
                expect(repeated.status).toBe(400);
                expect(await codeOf(repeated)).toBe('invalid_scope');
            })
        ));

    it('refuses to delete the Default profile and reports unknown ones', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                expect(
                    await codeOf(
                        await call('/profiles/default', { method: 'DELETE' })
                    )
                ).toBe('default_profile');
                const unknown = await call(
                    '/profiles/0b6f3c1e-2d4a-4e8b-9c7d-1a2b3c4d5e6f',
                    { method: 'DELETE' }
                );
                expect(unknown.status).toBe(404);
                const notUuid = await call('/profiles/not-a-uuid', {
                    method: 'PATCH',
                    body: { name: 'X' },
                });
                expect(notUuid.status).toBe(404);
            })
        ));

    it('lets only one of two overlapping creates take a name', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                // The PIN makes each request wait for its hash before writing.
                const results = await Promise.all(
                    [0, 1, 2].map(() =>
                        call('/profiles', {
                            method: 'POST',
                            body: { name: 'Twin', pin: '4321' },
                        })
                    )
                );
                expect(results.map((r) => r.status).sort()).toEqual([
                    201, 409, 409,
                ]);
                expect(await profilesIn(await call('/profiles'))).toHaveLength(
                    2
                );
            })
        ));

    it('counts overlapping wrong guesses towards the lock', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Kid', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                const guesses = await Promise.all(
                    Array.from({ length: 7 }, () =>
                        call(`/profiles/${id}/unlock`, {
                            method: 'POST',
                            body: { pin: '0000' },
                        })
                    )
                );
                expect(
                    guesses.every((r) => r.status === 403 || r.status === 429)
                ).toBe(true);
                const right = await call(`/profiles/${id}/unlock`, {
                    method: 'POST',
                    body: { pin: '1234' },
                });
                expect(right.status).toBe(429);
            })
        ));

    it('keeps a lockout through edits that do not change the PIN', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Kid', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                for (let i = 0; i < 5; i++) {
                    await call(`/profiles/${id}/unlock`, {
                        method: 'POST',
                        body: { pin: '0000' },
                    });
                }
                await call(`/profiles/${id}`, { method: 'PATCH', body: {} });
                await call(`/profiles/${id}`, {
                    method: 'PATCH',
                    body: { colour: '#123456' },
                });
                const locked = await call(`/profiles/${id}/unlock`, {
                    method: 'POST',
                    body: { pin: '1234' },
                });
                expect(locked.status).toBe(429);

                await call(`/profiles/${id}`, {
                    method: 'PATCH',
                    body: { pin: '5678' },
                });
                const reset = await call(`/profiles/${id}/unlock`, {
                    method: 'POST',
                    body: { pin: '5678' },
                });
                expect(reset.status).toBe(200);
            })
        ));
});
