import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import {
    PROFILE_COLOURS,
    PROFILE_LIMIT,
} from '@iptvnator/shared/interfaces/profiles';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type {
    ServerProfile,
    ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import type { ServerStorage } from './server-storage';
import { requireProfileScope } from './profile-scope-guard';
import * as profilePin from './profile-pin';

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
                        kids: false,
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

    it('keeps kids profiles free of a profile PIN', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const created = await call('/profiles', {
                    method: 'POST',
                    body: { name: 'Kid', kids: true },
                });
                const kid = (await created.json()) as ServerProfile;
                expect(kid).toMatchObject({ kids: true, hasPin: false });
                expect(
                    (await profilesIn(await call('/profiles'))).map(
                        (p) => p.kids
                    )
                ).toEqual([false, true]);

                const both = await call('/profiles', {
                    method: 'POST',
                    body: { name: 'Sam', kids: true, pin: '1234' },
                });
                expect(both.status).toBe(400);
                expect(await codeOf(both)).toBe('kids_profile_pin');
                const notBoolean = await call('/profiles', {
                    method: 'POST',
                    body: { name: 'Sam', kids: 'yes' },
                });
                expect(await codeOf(notBoolean)).toBe('invalid_body');

                const pinOnKid = await call(`/profiles/${kid.id}`, {
                    method: 'PATCH',
                    body: { pin: '1234' },
                });
                expect(await codeOf(pinOnKid)).toBe('kids_profile_pin');

                const adult = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Robin', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                const kidWithPin = await call(`/profiles/${adult.id}`, {
                    method: 'PATCH',
                    body: { kids: true },
                });
                expect(await codeOf(kidWithPin)).toBe('kids_profile_pin');
                const switched = await call(`/profiles/${adult.id}`, {
                    method: 'PATCH',
                    body: { kids: true, pin: null, currentPin: '1234' },
                });
                expect(await switched.json()).toMatchObject({
                    kids: true,
                    hasPin: false,
                });
                const back = await call(`/profiles/${adult.id}`, {
                    method: 'PATCH',
                    body: { kids: false, pin: '4321' },
                });
                expect(await back.json()).toMatchObject({
                    kids: false,
                    hasPin: true,
                });
            })
        ));

    it('takes one optional emoji per profile', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const create = (name: string, emoji: unknown) =>
                    call('/profiles', {
                        method: 'POST',
                        body: { name, emoji },
                    });
                const good = ['🦊', '👩‍👩‍👧', '🇳🇱', '👍🏽', '1️⃣', '❤️'];
                for (const [i, emoji] of good.entries()) {
                    const created = await create(`Person ${i}`, emoji);
                    expect(created.status).toBe(201);
                    expect(
                        ((await created.json()) as ServerProfile).emoji
                    ).toBe(emoji);
                }
                const bad = ['', 'A', 'ab', '🦊🦊', 'é', 7];
                for (const emoji of bad) {
                    const response = await create('Sam', emoji);
                    expect(response.status).toBe(400);
                    expect(await codeOf(response)).toBe(
                        'invalid_profile_emoji'
                    );
                }

                const plain = (await (
                    await create('Robin', undefined)
                ).json()) as ServerProfile;
                expect(plain).not.toHaveProperty('emoji');
                const set = await call(`/profiles/${plain.id}`, {
                    method: 'PATCH',
                    body: { emoji: '🐢' },
                });
                expect(((await set.json()) as ServerProfile).emoji).toBe('🐢');
                const renamed = await call(`/profiles/${plain.id}`, {
                    method: 'PATCH',
                    body: { name: 'Robin B' },
                });
                expect(((await renamed.json()) as ServerProfile).emoji).toBe(
                    '🐢'
                );
                const cleared = await call(`/profiles/${plain.id}`, {
                    method: 'PATCH',
                    body: { emoji: null },
                });
                expect(await cleared.json()).not.toHaveProperty('emoji');
            })
        ));

    it('sends the revision as an ETag and answers a match with 304', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const get = (etag?: string) =>
                    fetch(`${baseUrl}/v1/profiles`, {
                        headers: {
                            'x-iptvnator-instance-id':
                                storage.database.instanceId,
                            ...(etag ? { 'if-none-match': etag } : {}),
                        },
                    });
                const first = await get();
                const etag = first.headers.get('etag') as string;
                expect(etag).toBe('"profiles-0"');
                expect(first.headers.get('cache-control')).toBe('no-cache');
                expect((await get(etag)).status).toBe(304);
                expect((await get(`W/${etag}`)).status).toBe(304);

                await client(baseUrl, storage)('/profiles', {
                    method: 'POST',
                    body: { name: 'Kid' },
                });
                const changed = await get(etag);
                expect(changed.status).toBe(200);
                expect(changed.headers.get('etag')).toBe('"profiles-1"');
            })
        ));

    it('reorders profiles from the full list of ids', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const ids: string[] = [];
                for (const name of ['A', 'B', 'C']) {
                    const created = await call('/profiles', {
                        method: 'POST',
                        body: { name },
                    });
                    ids.push(((await created.json()) as ServerProfile).id);
                }
                const [a, b, c] = ids;
                const order = (body: unknown) =>
                    call('/profiles/order', { method: 'PUT', body });
                const names = async (response: Response) =>
                    (await profilesIn(response)).map((p) => p.name);

                expect(await names(await order({ ids: [c, a, b] }))).toEqual([
                    'Default',
                    'C',
                    'A',
                    'B',
                ]);
                expect(
                    await names(await order({ ids: ['default', b, c, a] }))
                ).toEqual(['Default', 'B', 'C', 'A']);
                expect(await names(await call('/profiles'))).toEqual([
                    'Default',
                    'B',
                    'C',
                    'A',
                ]);

                for (const stale of [
                    [a, b],
                    [a, b, b],
                    [a, b, c, 'x'],
                    [b, 'default', c, a],
                ]) {
                    const response = await order({ ids: stale });
                    expect(response.status).toBe(409);
                    expect(await codeOf(response)).toBe(
                        'profile_order_mismatch'
                    );
                }
                for (const body of [{}, { ids: 'a' }, { ids: [1] }]) {
                    expect(await codeOf(await order(body))).toBe(
                        'invalid_profile_order'
                    );
                }
            })
        ));

    it('places a new profile last with a colour no one uses', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const create = async (name: string) =>
                    (await (
                        await call('/profiles', {
                            method: 'POST',
                            body: { name },
                        })
                    ).json()) as ServerProfile;
                await create('A');
                const b = await create('B');
                await create('C');
                await call(`/profiles/${b.id}`, { method: 'DELETE' });
                const d = await create('D');

                const list = await profilesIn(await call('/profiles'));
                const others = list.filter((p) => p.id !== d.id);
                expect(list.at(-1)?.id).toBe(d.id);
                expect(others.map((p) => p.sortOrder)).not.toContain(
                    d.sortOrder
                );
                expect(others.map((p) => p.colour)).not.toContain(d.colour);
                expect(d.colour).toBe(b.colour);
            })
        ));

    it('gives every profile up to the limit its own colour', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                for (let i = 1; i < PROFILE_LIMIT; i++) {
                    const response = await call('/profiles', {
                        method: 'POST',
                        body: { name: `P${i}` },
                    });
                    expect(response.status).toBe(201);
                }
                const list = await profilesIn(await call('/profiles'));
                expect(list).toHaveLength(PROFILE_LIMIT);
                const colours = list.map((p) => p.colour);
                expect(new Set(colours).size).toBe(PROFILE_LIMIT);
                for (const colour of colours)
                    expect(PROFILE_COLOURS.map((c) => c.hex)).toContain(colour);
            })
        ));

    it('refuses a create over the limit or with a taken name before hashing its PIN', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const hash = jest.spyOn(profilePin, 'hashProfilePin');
                try {
                    const taken = await call('/profiles', {
                        method: 'POST',
                        body: { name: 'default', pin: '1234' },
                    });
                    expect(await codeOf(taken)).toBe('profile_name_taken');
                    for (let i = 1; i < 12; i++) {
                        await call('/profiles', {
                            method: 'POST',
                            body: { name: `Person ${i}` },
                        });
                    }
                    const full = await call('/profiles', {
                        method: 'POST',
                        body: { name: 'One more', pin: '1234' },
                    });
                    expect(await codeOf(full)).toBe('profile_limit');
                    expect(hash).not.toHaveBeenCalled();
                } finally {
                    hash.mockRestore();
                }
            })
        ));

    it('counts creates that carry a PIN against the PIN rate limit', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                // A taken name: each request is refused, but still counts.
                for (let i = 0; i < 30; i++) {
                    const refused = await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Default', pin: '1234' },
                    });
                    expect(refused.status).toBe(409);
                }
                const limited = await call('/profiles', {
                    method: 'POST',
                    body: { name: 'Default', pin: '1234' },
                });
                expect(limited.status).toBe(429);
                expect(await codeOf(limited)).toBe('pin_rate_limited');
                // Creates without a PIN are not held back.
                const plain = await call('/profiles', {
                    method: 'POST',
                    body: { name: 'Sam' },
                });
                expect(plain.status).toBe(201);
            })
        ));

    it('does not make the Default profile a kids profile', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const refused = await call('/profiles/default', {
                    method: 'PATCH',
                    body: { kids: true },
                });
                expect(refused.status).toBe(400);
                expect(await codeOf(refused)).toBe('default_profile_kids');
                expect(storage.profiles.get('default')?.kids).toBe(false);
                const allowed = await call('/profiles/default', {
                    method: 'PATCH',
                    body: { kids: false, name: 'Home' },
                });
                expect(allowed.status).toBe(200);
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
                    body: { pin: null, currentPin: '2468' },
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
                // Another origin's browser can read the countdown.
                expect(
                    locked.headers.get('access-control-expose-headers')
                ).toContain('Retry-After');
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

                // The lock also holds back a PIN change, even with the
                // right PIN.
                const change = await call(`/profiles/${id}`, {
                    method: 'PATCH',
                    body: { pin: '5678', currentPin: '1234' },
                });
                expect(change.status).toBe(429);
                expect(await codeOf(change)).toBe('pin_locked');
            })
        ));

    it('takes the current PIN to change or remove a PIN', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Robin', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                const patch = (body: unknown) =>
                    call(`/profiles/${id}`, { method: 'PATCH', body });

                const none = await patch({ pin: null });
                expect(none.status).toBe(403);
                expect(await codeOf(none)).toBe('pin_required');
                const wrong = await patch({ pin: '5678', currentPin: '0000' });
                expect(wrong.status).toBe(403);
                expect(await codeOf(wrong)).toBe('wrong_pin');
                expect(storage.profiles.get(id)?.hasPin).toBe(true);

                // A name or colour change needs no PIN.
                expect((await patch({ colour: '#123456' })).status).toBe(200);

                const changed = await patch({
                    pin: '5678',
                    currentPin: '1234',
                });
                expect(changed.status).toBe(200);
                const unlock = await call(`/profiles/${id}/unlock`, {
                    method: 'POST',
                    body: { pin: '5678' },
                });
                expect(unlock.status).toBe(200);
                const removed = await patch({ pin: null, currentPin: '5678' });
                expect(((await removed.json()) as ServerProfile).hasPin).toBe(
                    false
                );
                // Without a PIN there is nothing to check.
                expect((await patch({ pin: '2222' })).status).toBe(200);
            })
        ));

    it('takes the PIN to delete a PIN-protected profile', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Robin', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                const remove = (body?: unknown) =>
                    call(`/profiles/${id}`, { method: 'DELETE', body });

                expect(await codeOf(await remove())).toBe('pin_required');
                expect(await codeOf(await remove({ currentPin: '0000' }))).toBe(
                    'wrong_pin'
                );
                expect(storage.profiles.get(id)).not.toBeNull();
                expect((await remove({ currentPin: '1234' })).status).toBe(204);
                expect(storage.profiles.get(id)).toBeNull();
            })
        ));

    it('counts a wrong current PIN towards the lock', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const call = client(baseUrl, storage);
                const { id } = (await (
                    await call('/profiles', {
                        method: 'POST',
                        body: { name: 'Robin', pin: '1234' },
                    })
                ).json()) as ServerProfile;
                for (let i = 0; i < 3; i++) {
                    await call(`/profiles/${id}`, {
                        method: 'PATCH',
                        body: { pin: null, currentPin: '0000' },
                    });
                }
                for (let i = 0; i < 2; i++) {
                    await call(`/profiles/${id}`, {
                        method: 'DELETE',
                        body: { currentPin: '0000' },
                    });
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
});
