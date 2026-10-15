import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { m3uDocument, withTempStorage } from './server-storage.spec-helpers';
import type {
    ServerInstanceInfo,
    ServerStorageStatusResponse,
    ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';

function app(
    storage: ServerStorage | null,
    extra: { accessToken?: string; maxDocumentBytes?: number } = {}
) {
    return createWebBackendApp({
        clientOrigins: ['http://localhost:4200'],
        httpClient: new StubHttpClient(),
        resolveHostname: resolvePublicHost,
        storage,
        ...extra,
    });
}

const json = (body: unknown, init: RequestInit = {}): RequestInit => ({
    ...init,
    body: JSON.stringify(body),
    headers: {
        'content-type': 'application/json',
        ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
});

describe('server storage routes', () => {
    it('reports no storage when it is disabled', () =>
        withServer(app(null), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/v1/instance`);
            await expect(response.json()).resolves.toEqual({
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: null,
                storage: 'none',
                auth: 'none',
            });
            expect((await fetch(`${baseUrl}/v1/playlists`)).status).toBe(404);
        }));

    it('reports server storage and its status', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const instance = await (
                    await fetch(`${baseUrl}/v1/instance`)
                ).json();
                expect(instance).toMatchObject({
                    storage: 'server',
                    instanceId: storage.database.instanceId,
                });
                const status = (await (
                    await fetch(`${baseUrl}/v1/instance/status`)
                ).json()) as ServerStorageStatusResponse;
                expect(status).toMatchObject({ playlists: 0 });
                expect(status.databaseBytes).toBeGreaterThan(0);
            })
        ));

    it('stores a document, serves it with an ETag and answers 304', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const put = await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                expect(put.status).toBe(200);
                const etag = put.headers.get('etag');
                expect(etag).toBeTruthy();

                const get = await fetch(`${baseUrl}/v1/playlists/p1`);
                expect(get.headers.get('etag')).toBe(etag);
                await expect(get.json()).resolves.toMatchObject({ _id: 'p1' });

                const cached = await fetch(`${baseUrl}/v1/playlists/p1`, {
                    headers: { 'if-none-match': etag ?? '' },
                });
                expect(cached.status).toBe(304);

                // nginx weakens the ETag of a gzipped response.
                const weakened = await fetch(`${baseUrl}/v1/playlists/p1`, {
                    headers: { 'if-none-match': `W/${etag}` },
                });
                expect(weakened.status).toBe(304);

                // A write names the version it replaced.
                const next = await fetch(
                    `${baseUrl}/v1/playlists/p1?keepPayload=1`,
                    json({ _id: 'p1', title: 'Renamed' }, { method: 'PUT' })
                );
                expect(next.headers.get('x-replaced-etag')).toBe(etag);
                expect(next.headers.get('etag')).not.toBe(etag);
                expect(
                    next.headers.get('access-control-expose-headers')
                ).toContain('X-Replaced-ETag');
            })
        ));

    it('answers 404, not 304, for a missing playlist', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const wildcard = await fetch(`${baseUrl}/v1/playlists/nope`, {
                    headers: { 'if-none-match': '*' },
                });
                const guessed = await fetch(`${baseUrl}/v1/playlists/nope`, {
                    headers: {
                        'if-none-match': storage.revisions.etag('nope'),
                    },
                });

                expect(wildcard.status).toBe(404);
                expect(guessed.status).toBe(404);
            })
        ));

    it('keeps the payload on keepPayload and refuses it for unknown ids', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                const meta: Record<string, unknown> = { ...m3uDocument('p1') };
                delete meta['playlist'];

                const keep = await fetch(
                    `${baseUrl}/v1/playlists/p1?keepPayload=1`,
                    json({ ...meta, title: 'Renamed' }, { method: 'PUT' })
                );
                const missing = await fetch(
                    `${baseUrl}/v1/playlists/zz?keepPayload=1`,
                    json({ title: 'x' }, { method: 'PUT' })
                );

                expect(keep.status).toBe(200);
                await expect(
                    (await fetch(`${baseUrl}/v1/playlists/p1`)).json()
                ).resolves.toMatchObject({
                    title: 'Renamed',
                    playlist: m3uDocument('p1').playlist,
                });
                expect(missing.status).toBe(409);
                await expect(missing.json()).resolves.toMatchObject({
                    code: 'payload_missing',
                });
            })
        ));

    it('lists metadata and deletes documents with their user state', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                await fetch(
                    `${baseUrl}/v1/user-state/xtream-favorites/p1`,
                    json({ value: ['live:1'] }, { method: 'PUT' })
                );

                const metas = (await (
                    await fetch(`${baseUrl}/v1/playlists?view=meta`)
                ).json()) as Record<string, unknown>[];
                expect(metas[0]['playlist']).toBeUndefined();

                await fetch(`${baseUrl}/v1/playlists/p1`, {
                    method: 'DELETE',
                });

                expect((await fetch(`${baseUrl}/v1/playlists/p1`)).status).toBe(
                    404
                );
                const state = (await (
                    await fetch(`${baseUrl}/v1/user-state`)
                ).json()) as ServerUserStateResponse;
                expect(state.entries['xtream-favorites']).toEqual({});
            })
        ));

    it('validates user-state namespaces and stores app state', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const bad = await fetch(
                    `${baseUrl}/v1/user-state/settings/p1`,
                    json({ value: 1 }, { method: 'PUT' })
                );
                expect(bad.status).toBe(400);

                await fetch(
                    `${baseUrl}/v1/app-state/flag`,
                    json({ value: '1' }, { method: 'PUT' })
                );
                const read = await fetch(`${baseUrl}/v1/app-state/flag`);
                expect(read.headers.get('cache-control')).toBe('no-store');
                await expect(read.json()).resolves.toEqual({ value: '1' });
            })
        ));

    it('refuses user state for a playlist it does not have', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const entry = `${baseUrl}/v1/user-state/xtream-favorites/gone`;
                const put = await fetch(
                    entry,
                    json({ value: ['live:1'] }, { method: 'PUT' })
                );
                expect(put.status).toBe(404);
                await expect(put.json()).resolves.toMatchObject({
                    code: 'playlist_missing',
                });
                // Removing what is not there stays harmless.
                expect((await fetch(entry, { method: 'DELETE' })).status).toBe(
                    200
                );
            })
        ));

    it('refuses a playlist write built on a replaced version', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const first = await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                const read = first.headers.get('etag') ?? '';
                const edit = (ifMatch: string) =>
                    fetch(
                        `${baseUrl}/v1/playlists/p1?keepPayload=1`,
                        json(
                            { _id: 'p1', title: 'Renamed' },
                            { method: 'PUT', headers: { 'if-match': ifMatch } }
                        )
                    );

                expect((await edit(read)).status).toBe(200);
                // Another device wrote since `read`.
                const stale = await edit(read);
                expect(stale.status).toBe(412);
                await expect(stale.json()).resolves.toMatchObject({
                    code: 'conflict',
                });
            })
        ));

    it('creates a playlist create-only, refused once it exists', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const create = (title: string) =>
                    fetch(
                        `${baseUrl}/v1/playlists/p1`,
                        json(
                            { ...m3uDocument('p1'), title },
                            {
                                method: 'PUT',
                                headers: { 'if-none-match': '*' },
                            }
                        )
                    );

                expect((await create('First')).status).toBe(200);
                // Another tab or device moved the same playlist first.
                const second = await create('Second');
                expect(second.status).toBe(412);
                await expect(second.json()).resolves.toMatchObject({
                    code: 'conflict',
                });
                const stored = await fetch(`${baseUrl}/v1/playlists/p1`);
                await expect(stored.json()).resolves.toMatchObject({
                    title: 'First',
                });
            })
        ));

    it('writes user state only on the tag it was read at', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                const entry = `${baseUrl}/v1/user-state/xtream-favorites/p1`;
                // Created only while absent.
                const created = await fetch(
                    entry,
                    json(
                        { value: ['live:1'] },
                        { method: 'PUT', headers: { 'if-none-match': '*' } }
                    )
                );
                const { tag } = (await created.json()) as { tag: string };
                expect(tag).toMatch(/^[0-9a-f]{16}$/);
                const again = await fetch(
                    entry,
                    json(
                        { value: ['live:2'] },
                        { method: 'PUT', headers: { 'if-none-match': '*' } }
                    )
                );
                expect(again.status).toBe(412);
                await expect(again.json()).resolves.toMatchObject({
                    code: 'conflict',
                    current: { value: ['live:1'], tag },
                });

                const read = (await (
                    await fetch(`${baseUrl}/v1/user-state`)
                ).json()) as ServerUserStateResponse;
                expect(read.tags?.['xtream-favorites']['p1']).toBe(tag);

                // Another device wrote meanwhile: a stale tag is refused.
                const next = await fetch(
                    entry,
                    json(
                        { value: ['live:1', 'live:9'] },
                        { method: 'PUT', headers: { 'if-match': `"${tag}"` } }
                    )
                );
                const nextTag = ((await next.json()) as { tag: string }).tag;
                const stale = await fetch(
                    entry,
                    json(
                        { value: ['live:1', 'live:5'] },
                        { method: 'PUT', headers: { 'if-match': `"${tag}"` } }
                    )
                );
                expect(stale.status).toBe(412);
                await expect(stale.json()).resolves.toMatchObject({
                    current: { value: ['live:1', 'live:9'], tag: nextTag },
                });

                const removed = await fetch(entry, {
                    method: 'DELETE',
                    headers: { 'if-match': `"${nextTag}"` },
                });
                await expect(removed.json()).resolves.toMatchObject({
                    tag: null,
                });
                // Unconditional writes keep working for older clients.
                const plain = await fetch(
                    entry,
                    json({ value: ['x'] }, { method: 'PUT' })
                );
                expect(plain.status).toBe(200);
            })
        ));

    it('keeps browser app state away from server-owned keys', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/app-state/server:instance-id`,
                    json({ value: '' }, { method: 'PUT' })
                );

                expect(
                    storage.playlists.getAppState('server:instance-id')
                ).toBe(storage.database.instanceId);
                await expect(
                    (
                        await fetch(
                            `${baseUrl}/v1/app-state/server:instance-id`
                        )
                    ).json()
                ).resolves.toEqual({ value: '' });
            })
        ));

    it('keeps the playlist when its user-state cleanup fails', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                const etag = storage.revisions.etag('p1');
                jest.spyOn(
                    storage.userState,
                    'deleteForPlaylist'
                ).mockImplementationOnce(() => {
                    throw new Error('disk full');
                });

                const response = await fetch(`${baseUrl}/v1/playlists/p1`, {
                    method: 'DELETE',
                });

                expect(response.status).toBe(500);
                expect(storage.playlists.exists('p1')).toBe(true);
                expect(storage.revisions.etag('p1')).toBe(etag);
            })
        ));

    it('rejects playlist ids with surrounding whitespace', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const put = await fetch(
                    `${baseUrl}/v1/playlists/%20p1%20`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                const get = await fetch(`${baseUrl}/v1/playlists/%20p1%20`);

                expect(put.status).toBe(400);
                await expect(put.json()).resolves.toMatchObject({
                    code: 'invalid_id',
                });
                expect(get.status).toBe(400);
                expect(storage.playlists.count()).toBe(0);
            })
        ));

    it('answers 413 above the document limit', () =>
        withTempStorage((storage) =>
            withServer(
                app(storage, { maxDocumentBytes: 512 }),
                async (baseUrl) => {
                    const response = await fetch(
                        `${baseUrl}/v1/playlists/p1`,
                        json(
                            { ...m3uDocument('p1'), padding: 'x'.repeat(2048) },
                            { method: 'PUT' }
                        )
                    );
                    expect(response.status).toBe(413);
                }
            )
        ));

    it('requires the token for storage and proxy routes when one is set', () =>
        withTempStorage((storage) =>
            withServer(
                app(storage, { accessToken: 's3cret' }),
                async (baseUrl) => {
                    const instance = (await (
                        await fetch(`${baseUrl}/v1/instance`)
                    ).json()) as ServerInstanceInfo;
                    expect(instance.auth).toBe('token');

                    expect(
                        (await fetch(`${baseUrl}/v1/playlists`)).status
                    ).toBe(401);
                    expect(
                        (
                            await fetch(
                                `${baseUrl}/provider-targets`,
                                json(
                                    { url: 'http://example.test' },
                                    { method: 'POST' }
                                )
                            )
                        ).status
                    ).toBe(401);
                    expect(
                        (
                            await fetch(`${baseUrl}/v1/playlists`, {
                                headers: { authorization: 'Bearer s3cret' },
                            })
                        ).status
                    ).toBe(200);
                }
            )
        ));
});
