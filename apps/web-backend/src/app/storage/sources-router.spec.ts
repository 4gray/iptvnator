import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { m3uDocument, withTempStorage } from './server-storage.spec-helpers';

const source = (id: string) => ({
    id,
    title: id,
    kind: 'xtream',
    serverUrl: 'https://panel.test',
    username: id,
    password: 'synthetic-secret',
});
const body = (method: string, value: unknown, headers = {}): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
});

describe('source synchronization API', () => {
    it('creates, deduplicates and conditionally edits sources without overwriting user data', () =>
        withTempStorage((storage) =>
            withServer(
                createWebBackendApp({
                    storage,
                    clientOrigins: ['http://localhost:4200'],
                    resolveHostname: resolvePublicHost,
                    httpClient: new StubHttpClient(),
                }),
                async (base) => {
                    const url = `${base}/v1/sources`;
                    expect(
                        (
                            await fetch(
                                `${url}/wrong-instance`,
                                body('PUT', source('wrong-instance'), {
                                    'If-None-Match': '*',
                                    'X-IPTVnator-Instance-Id': 'another-nas',
                                })
                            )
                        ).status
                    ).toBe(409);
                    expect(storage.playlists.get('wrong-instance')).toBeNull();
                    expect(
                        (await fetch(`${url}/x`, body('PUT', source('x'))))
                            .status
                    ).toBe(428);
                    const created = await fetch(
                        `${url}/x`,
                        body('PUT', source('x'), { 'If-None-Match': '*' })
                    );
                    expect(created.status).toBe(201);
                    const revision = created.headers.get('etag')!;
                    const duplicate = await fetch(
                        `${url}/other`,
                        body(
                            'PUT',
                            { ...source('x'), id: 'other' },
                            { 'If-None-Match': '*' }
                        )
                    );
                    expect((await duplicate.json()).id).toBe('x');
                    storage.playlists.upsert(
                        {
                            ...storage.playlists.get('x'),
                            favorites: ['keep-me'],
                            stalkerToken: 'local-session',
                        },
                        { keepPayload: false }
                    );
                    const changed = await fetch(
                        `${url}/x`,
                        body(
                            'PATCH',
                            { ...source('x'), title: 'Shared' },
                            { 'If-Match': revision }
                        )
                    );
                    expect(changed.status).toBe(200);
                    expect(storage.playlists.get('x')).toMatchObject({
                        favorites: ['keep-me'],
                        stalkerToken: 'local-session',
                    });
                    expect(
                        (
                            await fetch(
                                `${url}/x`,
                                body('PATCH', source('x'), {
                                    'If-Match': revision,
                                })
                            )
                        ).status
                    ).toBe(412);
                    const inventory = await fetch(url);
                    const list = await inventory.json();
                    expect(list.entries).toHaveLength(1);
                    expect(JSON.stringify(list)).not.toContain('keep-me');
                    expect(JSON.stringify(list)).not.toContain('local-session');
                    expect(
                        (
                            await fetch(url, {
                                headers: {
                                    'If-None-Match':
                                        inventory.headers.get('etag')!,
                                },
                            })
                        ).status
                    ).toBe(304);
                    expect(
                        (
                            await fetch(`${url}/x`, {
                                method: 'DELETE',
                                headers: {
                                    'If-Match': changed.headers.get('etag')!,
                                },
                            })
                        ).status
                    ).toBe(200);
                    expect(
                        (
                            await fetch(
                                `${url}/x`,
                                body('PATCH', source('x'), {
                                    'If-Match': revision,
                                })
                            )
                        ).status
                    ).toBe(404);
                }
            )
        ));

    it('keeps uploaded M3U out of inventory and invalidates tags after legacy mutations', () =>
        withTempStorage((storage) =>
            withServer(
                createWebBackendApp({
                    storage,
                    clientOrigins: ['http://localhost:4200'],
                    resolveHostname: resolvePublicHost,
                    httpClient: new StubHttpClient(),
                }),
                async (base) => {
                    const rawM3u =
                        '#EXTM3U\n#EXTINF:-1,One\nhttps://media.test/one';
                    const created = await fetch(
                        `${base}/v1/sources/file`,
                        body(
                            'PUT',
                            {
                                id: 'file',
                                title: 'Upload',
                                kind: 'm3u-text',
                                rawM3u,
                            },
                            { 'If-None-Match': '*' }
                        )
                    );
                    expect(created.status).toBe(201);
                    const first = await fetch(`${base}/v1/sources`);
                    expect(JSON.stringify(await first.json())).not.toContain(
                        rawM3u
                    );
                    expect(
                        await (await fetch(`${base}/v1/sources/file`)).json()
                    ).toMatchObject({ rawM3u });
                    await fetch(
                        `${base}/v1/playlists/legacy`,
                        body('PUT', m3uDocument('legacy'))
                    );
                    const second = await fetch(`${base}/v1/sources`, {
                        headers: {
                            'If-None-Match': first.headers.get('etag')!,
                        },
                    });
                    expect(second.status).toBe(200);
                    expect(
                        (
                            await fetch(`${base}/v1/sources`, {
                                method: 'DELETE',
                                headers: {
                                    'If-Match': first.headers.get('etag')!,
                                },
                            })
                        ).status
                    ).toBe(412);
                    expect(
                        (
                            await fetch(`${base}/v1/sources`, {
                                method: 'DELETE',
                                headers: {
                                    'If-Match': second.headers.get('etag')!,
                                },
                            })
                        ).status
                    ).toBe(200);
                }
            )
        ));

    it('rejects runtime fields and protects source endpoints with the instance token', () =>
        withTempStorage((storage) =>
            withServer(
                createWebBackendApp({
                    storage,
                    accessToken: 'server-secret',
                    clientOrigins: [],
                    resolveHostname: resolvePublicHost,
                    httpClient: new StubHttpClient(),
                }),
                async (base) => {
                    expect((await fetch(`${base}/v1/sources`)).status).toBe(
                        401
                    );
                    expect(
                        (
                            await fetch(
                                `${base}/v1/sources/x`,
                                body(
                                    'PUT',
                                    { ...source('x'), favorites: [] },
                                    {
                                        Authorization: 'Bearer server-secret',
                                        'If-None-Match': '*',
                                    }
                                )
                            )
                        ).status
                    ).toBe(400);
                }
            )
        ));
});
