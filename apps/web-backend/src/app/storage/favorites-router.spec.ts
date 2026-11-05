import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import { ServerFavoriteService } from './favorites-service';
import type {
    FavoriteResult,
    FavoriteList,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { ServerStorage } from './server-storage';
import type {
    FavoriteAddress,
    FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
async function body<T>(response: Response): Promise<T> {
    return response.json() as Promise<T>;
}
const source = {
    _id: 'source',
    title: 'Synthetic source',
    type: 'xtream',
    serverUrl: 'https://provider.invalid',
    username: 'synthetic-user',
    password: 'synthetic-secret',
    favorites: ['legacy-local'],
};
const app = (storage: ServerStorage) =>
    createWebBackendApp({
        clientOrigins: ['http://localhost:4200'],
        httpClient: new StubHttpClient(),
        resolveHostname: resolvePublicHost,
        storage,
        accessToken: 'synthetic-token',
    });
const headers = (instanceId: string) => ({
    authorization: 'Bearer synthetic-token',
    'content-type': 'application/json',
    'x-iptvnator-instance-id': instanceId,
});
describe('favorites HTTP API', () => {
    it('requires authentication and instance verification; never imports whole-document favorites', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            await withServer(app(storage), async (url) => {
                expect(
                    (await fetch(`${url}/v1/favorites/sources/source`)).status
                ).toBe(401);
                expect(
                    (
                        await fetch(`${url}/v1/favorites/sources/source`, {
                            headers: headers('wrong'),
                        })
                    ).status
                ).toBe(409);
                expect(
                    (
                        (await (await fetch(`${url}/v1/instance`)).json()) as {
                            capabilities: string[];
                        }
                    ).capabilities
                ).toContain('favorites-v1');
                const response = await fetch(
                    `${url}/v1/favorites/sources/source/items`,
                    { headers: headers(storage.database.instanceId) }
                );
                expect(response.headers.get('cache-control')).toBe('no-store');
                expect(await response.json()).toEqual({ entries: [] });
                expect(storage.playlists.get('source')?.favorites).toEqual([
                    'legacy-local',
                ]);
            });
        }));
    it('persists independent memberships, stable removal barriers and idempotent receipts', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            await withServer(app(storage), async (url) => {
                const auth = headers(storage.database.instanceId);
                const context = (await (
                    await fetch(`${url}/v1/favorites/sources/source`, {
                        headers: auth,
                    })
                ).json()) as FavoriteSourceContext;
                const address: FavoriteAddress = {
                    instanceId: storage.database.instanceId,
                    scope: 'shared',
                    sourceId: 'source',
                    sourceIncarnation: context.sourceIncarnation,
                    content: { provider: 'xtream', kind: 'movie', id: '42' },
                };
                const post = async (
                    id: string,
                    member: boolean,
                    expectedRevision: number,
                    target = address
                ) =>
                    fetch(`${url}/v1/favorites/operations`, {
                        method: 'POST',
                        headers: auth,
                        body: JSON.stringify({
                            address: target,
                            operation: {
                                operationId: id,
                                deviceId: 'device',
                                member,
                                expectedRevision,
                                snapshot: {
                                    title: 'Synthetic item',
                                    cmd: 'synthetic-command',
                                    token: 'synthetic-token',
                                },
                            },
                        }),
                    });
                const first = await body<FavoriteResult>(
                    await post('add', true, 0)
                );
                expect(first.status).toBe('applied');
                expect(first.state.snapshot).toEqual({
                    title: 'Synthetic item',
                });
                await post('other', true, 0, {
                    ...address,
                    content: { provider: 'xtream', kind: 'live', id: '42' },
                });
                expect(
                    (await body<FavoriteResult>(await post('remove', false, 1)))
                        .state
                ).toMatchObject({ member: false, revision: 2 });
                expect(await (await post('add', true, 0)).json()).toEqual(
                    first
                );
                expect((await post('add', false, 0)).status).toBe(409);
                expect(
                    (await body<FavoriteResult>(await post('stale', true, 0)))
                        .status
                ).toBe('conflict');
                const list = (await (
                    await fetch(`${url}/v1/favorites/sources/source/items`, {
                        headers: auth,
                    })
                ).json()) as FavoriteList;
                expect(list.entries).toHaveLength(2);
                expect(
                    list.entries.filter(
                        (entry: { state: { member: boolean } }) =>
                            entry.state.member
                    )
                ).toHaveLength(1);
                storage.playlists.upsert(
                    { ...source, favorites: [] },
                    { keepPayload: false }
                );
                expect(
                    new ServerFavoriteService(storage).states.read(address)
                        .member
                ).toBe(false);
                expect(
                    (
                        await fetch(
                            `${url}/v1/favorites/sources/source/items?cursor=first&cursor=second`,
                            { headers: auth }
                        )
                    ).status
                ).toBe(400);
                expect(
                    (
                        await fetch(`${url}/v1/favorites/operations`, {
                            method: 'POST',
                            headers: auth,
                            body: JSON.stringify({
                                address,
                                operation: { member: 'yes' },
                            }),
                        })
                    ).status
                ).toBe(400);
            });
        }));
    it.each(['xtream', 'stalker', 'm3u-url', 'm3u-text'])(
        'fences %s replacement and deletion/recreation without retiring password or title edits',
        (kind) =>
            withTempStorage(async (storage) => {
                const document =
                    kind === 'xtream'
                        ? source
                        : kind === 'stalker'
                          ? {
                                _id: 'source',
                                title: 'Synthetic source',
                                macAddress: '00:11:22:33:44:55',
                                portalUrl: 'https://provider.invalid',
                            }
                          : kind === 'm3u-url'
                            ? {
                                  _id: 'source',
                                  title: 'Synthetic source',
                                  url: 'https://fixture.invalid/list.m3u',
                              }
                            : {
                                  _id: 'source',
                                  title: 'Synthetic source',
                                  sourceRawM3u:
                                      '#EXTM3U\n#EXTINF:-1,Synthetic channel\nhttps://fixture.invalid/stream',
                              };
                storage.playlists.upsert(document, { keepPayload: false });
                const service = new ServerFavoriteService(storage);
                const initial = service.context('source');
                expect(initial.provider).toBe(
                    kind.startsWith('m3u') ? 'm3u' : kind
                );
                storage.playlists.upsert(
                    {
                        ...document,
                        title: 'Renamed synthetic source',
                        password: 'rotated-synthetic-secret',
                    },
                    { keepPayload: false }
                );
                expect(service.context('source').sourceIncarnation).toBe(
                    initial.sourceIncarnation
                );
                const changed =
                    kind === 'xtream'
                        ? { ...document, username: 'other-synthetic-user' }
                        : kind === 'stalker'
                          ? { ...document, macAddress: '00:11:22:33:44:66' }
                          : kind === 'm3u-url'
                            ? {
                                  ...document,
                                  url: 'https://fixture.invalid/other.m3u',
                              }
                            : {
                                  ...document,
                                  sourceRawM3u:
                                      '#EXTM3U\n#EXTINF:-1,Synthetic second channel\nhttps://fixture.invalid/second',
                              };
                storage.playlists.upsert(changed, { keepPayload: false });
                storage.playlists.upsert(document, { keepPayload: false });
                expect(service.context('source').sourceIncarnation).not.toBe(
                    initial.sourceIncarnation
                );
                const current = service.context('source');
                storage.playlists.delete('source');
                storage.playlists.upsert(document, { keepPayload: false });
                expect(service.context('source').sourceIncarnation).not.toBe(
                    current.sourceIncarnation
                );
            })
    );
});
