import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type {
    ActivitySourceContext,
    ActivityListResponse,
    ActivityApplyResult,
} from '@iptvnator/shared/interfaces/activity-sync';
import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import { ServerActivityService } from './activity-service';
import type { ServerStorage } from './server-storage';

const source = {
    _id: 'source',
    title: 'Provider',
    type: 'xtream',
    serverUrl: 'https://provider.test',
    username: 'user',
    password: 'private',
    favorites: ['local-favorite'],
};
const app = (storage: ServerStorage) =>
    createWebBackendApp({
        clientOrigins: ['http://localhost:4200'],
        httpClient: new StubHttpClient(),
        resolveHostname: resolvePublicHost,
        storage,
        accessToken: 'test-token',
    });
const headers = (instanceId: string) => ({
    authorization: 'Bearer test-token',
    'content-type': 'application/json',
    'x-iptvnator-instance-id': instanceId,
});

describe('activity HTTP API', () => {
    it('requires authentication and a verified instance without importing legacy activity', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            await withServer(app(storage), async (url) => {
                expect(
                    (await fetch(`${url}/v1/activity/sources/source`)).status
                ).toBe(401);
                expect(
                    (
                        await fetch(`${url}/v1/activity/sources/source`, {
                            headers: headers('wrong'),
                        })
                    ).status
                ).toBe(409);
                const instance = (await (
                    await fetch(`${url}/v1/instance`)
                ).json()) as ServerInstanceInfo;
                expect(instance.capabilities).toContain('activity-v1');
                const list = (await (
                    await fetch(`${url}/v1/activity/sources/source/items`, {
                        headers: headers(storage.database.instanceId),
                    })
                ).json()) as ActivityListResponse;
                expect(list.entries).toEqual([]);
                expect(storage.playlists.get('source')?.['favorites']).toEqual([
                    'local-favorite',
                ]);
            });
        }));

    it('persists checkpoints, retry receipts and reset barriers through the real HTTP path', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            await withServer(app(storage), async (url) => {
                const id = storage.database.instanceId;
                const context = (await (
                    await fetch(`${url}/v1/activity/sources/source`, {
                        headers: headers(id),
                    })
                ).json()) as ActivitySourceContext;
                const address = {
                    instanceId: id,
                    scope: 'shared',
                    sourceId: 'source',
                    sourceIncarnation: context.sourceIncarnation,
                    content: { provider: 'xtream', kind: 'vod', id: '42' },
                };
                const send = async (operation: unknown) => {
                    const response = await fetch(
                        `${url}/v1/activity/operations`,
                        {
                            method: 'POST',
                            headers: headers(id),
                            body: JSON.stringify({ address, operation }),
                        }
                    );
                    return {
                        status: response.status,
                        body: (await response.json()) as ActivityApplyResult,
                    };
                };
                const begin = {
                    kind: 'begin',
                    operationId: 'begin',
                    deviceId: 'desktop',
                    expectedRevision: 0,
                    sessionId: 'playing',
                };
                const first = await send(begin);
                expect(first.body.state.generation).toBe(1);
                const tick = {
                    kind: 'checkpoint',
                    operationId: 'tick',
                    deviceId: 'desktop',
                    sessionId: 'playing',
                    generation: 1,
                    sequence: 1,
                    resume: { positionSeconds: 95, durationSeconds: 100 },
                    positionMetadata: { contentXtreamId: 42, title: 'A movie' },
                };
                expect((await send(tick)).body.state.watched).toBe(true);
                expect(await send(begin)).toEqual(first);
                expect(
                    (
                        await send({
                            kind: 'reset',
                            operationId: 'reset',
                            deviceId: 'phone',
                            expectedRevision: 2,
                        })
                    ).body.state.resume
                ).toBeNull();
                expect(
                    (await send({ ...tick, operationId: 'late', sequence: 2 }))
                        .body.status
                ).toBe('conflict');
                const entries = (await (
                    await fetch(`${url}/v1/activity/sources/source/items`, {
                        headers: headers(id),
                    })
                ).json()) as ActivityListResponse;
                expect(entries.entries[0].state).toMatchObject({
                    revision: 3,
                    watched: false,
                    resume: null,
                });
                expect(
                    (await send({ ...begin, sessionId: 'changed' })).status
                ).toBe(409);
                expect(
                    (
                        await send({
                            ...tick,
                            operationId: 'bad',
                            resume: { positionSeconds: -1 },
                        })
                    ).status
                ).toBe(400);
            });
        }));

    it('retains activity through canonical URL, password and metadata-only edits', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            const service = new ServerActivityService(storage);
            const old = service.context('source');
            storage.playlists.upsert(
                {
                    ...source,
                    serverUrl: 'HTTPS://PROVIDER.TEST/',
                    password: 'synthetic-rotated-secret',
                    title: 'Synthetic renamed source',
                },
                { keepPayload: false }
            );
            expect(service.context('source').sourceIncarnation).toBe(
                old.sourceIncarnation
            );
        }));

    it.each(['account', 'endpoint', 'mac'] as const)(
        'retires an unobserved %s round-trip inside the source update transaction',
        (change) =>
            withTempStorage(async (storage) => {
                const original =
                    change === 'mac'
                        ? {
                              ...source,
                              type: 'stalker',
                              serverUrl: undefined,
                              portalUrl: 'https://synthetic.invalid',
                              macAddress: '00:11:22:33:44:55',
                          }
                        : source;
                storage.playlists.upsert(original, { keepPayload: false });
                const service = new ServerActivityService(storage);
                const old = service.context('source');
                const changed =
                    change === 'account'
                        ? { ...original, username: 'synthetic-other-account' }
                        : change === 'endpoint'
                          ? {
                                ...original,
                                serverUrl: 'https://synthetic-other.invalid',
                            }
                          : { ...original, macAddress: '00:11:22:33:44:66' };
                expect(() =>
                    storage.database.transaction(() => {
                        storage.playlists.upsert(changed, {
                            keepPayload: false,
                        });
                        throw new Error('Synthetic rollback');
                    })
                ).toThrow('Synthetic rollback');
                expect(service.context('source').sourceIncarnation).toBe(
                    old.sourceIncarnation
                );
                storage.playlists.upsert(changed, { keepPayload: false });
                storage.playlists.upsert(original, { keepPayload: false });
                expect(service.context('source').sourceIncarnation).not.toBe(
                    old.sourceIncarnation
                );
                expect(() =>
                    service.states.apply(
                        {
                            instanceId: storage.database.instanceId,
                            scope: 'shared',
                            sourceId: 'source',
                            sourceIncarnation: old.sourceIncarnation,
                            content: {
                                provider:
                                    change === 'mac' ? 'stalker' : 'xtream',
                                kind: 'vod',
                                id: '42',
                            },
                        },
                        {
                            kind: 'reset',
                            operationId: 'synthetic-stale-reset',
                            deviceId: 'synthetic-device',
                            expectedRevision: 0,
                        }
                    )
                ).toThrow('Source identity changed');
            })
    );

    it('rejects queued activity after source deletion/recreation and retains history separately', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            const service = new ServerActivityService(storage);
            const old = service.context('source');
            storage.playlists.upsert(
                { ...source, password: 'new-secret' },
                { keepPayload: false }
            );
            expect(service.context('source').sourceIncarnation).toBe(
                old.sourceIncarnation
            );
            storage.playlists.delete('source');
            storage.playlists.upsert(source, { keepPayload: false });
            expect(service.context('source').sourceIncarnation).not.toBe(
                old.sourceIncarnation
            );
            expect(() =>
                service.states.apply(
                    {
                        instanceId: storage.database.instanceId,
                        scope: 'shared',
                        sourceId: 'source',
                        sourceIncarnation: old.sourceIncarnation,
                        content: { provider: 'xtream', kind: 'vod', id: '42' },
                    },
                    {
                        kind: 'reset',
                        operationId: 'old-reset',
                        deviceId: 'desktop',
                        expectedRevision: 0,
                    }
                )
            ).toThrow('Source identity changed');
        }));
});
