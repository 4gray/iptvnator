import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import type {
    HistoryScope,
    HistoryState,
    HistoryOperation,
    HistoryResult,
} from '@iptvnator/shared/interfaces/history-sync';
const source = {
    _id: 'source',
    title: 'Synthetic source',
    type: 'xtream',
    serverUrl: 'https://provider.invalid',
    username: 'synthetic-user',
    password: 'synthetic-secret',
    recentlyViewed: [{ id: 42, title: 'Synthetic archived item' }],
};
describe('history HTTP boundary', () => {
    it('requires consented transport identity, isolates source incarnations and retains idempotent removals', () =>
        withTempStorage(async (storage) => {
            storage.playlists.upsert(source, { keepPayload: false });
            const app = createWebBackendApp({
                clientOrigins: ['http://localhost:4200'],
                httpClient: new StubHttpClient(),
                resolveHostname: resolvePublicHost,
                storage,
                accessToken: 'synthetic-token',
            });
            await withServer(app, async (url) => {
                const headers = {
                    authorization: 'Bearer synthetic-token',
                    'content-type': 'application/json',
                    'x-iptvnator-instance-id': storage.database.instanceId,
                };
                const path = `${url}/v1/history/sources/source`;
                expect((await fetch(path)).status).toBe(401);
                expect(
                    (
                        await fetch(path, {
                            headers: {
                                ...headers,
                                'x-iptvnator-instance-id': 'wrong',
                            },
                        })
                    ).status
                ).toBe(409);
                const info = (await (
                    await fetch(`${url}/v1/instance`)
                ).json()) as { capabilities: string[] };
                expect(info.capabilities).toContain('history-v1');
                const initial = (await (
                    await fetch(path, { headers })
                ).json()) as { scope: HistoryScope; state: HistoryState };
                expect(initial.state.items).toEqual([]);
                const apply = async (
                    operation: HistoryOperation,
                    scope = initial.scope
                ) =>
                    fetch(`${url}/v1/history/operations`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ scope, operation }),
                    });
                const touch: HistoryOperation = {
                    operationId: 'confirmed-watch',
                    deviceId: 'desktop',
                    kind: 'touch',
                    baseRevision: 0,
                    reference: { provider: 'xtream', kind: 'movie', id: '42' },
                    viewedAt: 100,
                };
                const first = (await (
                    await apply(touch)
                ).json()) as HistoryResult;
                expect(first.applied).toBe(true);
                expect(await (await apply(touch)).json()).toEqual(first);
                expect((await apply({ ...touch, kind: 'remove' })).status).toBe(
                    409
                );
                expect(
                    (
                        await apply({
                            ...touch,
                            operationId: 'unsafe',
                            snapshot: { title: 'x'.repeat(513) },
                        })
                    ).status
                ).toBe(400);
                expect(
                    (
                        await apply({
                            ...touch,
                            operationId: 'wrong-provider',
                            reference: {
                                provider: 'm3u',
                                version: 1,
                                urlHash: '0'.repeat(64),
                            },
                        })
                    ).status
                ).toBe(409);
                const cleared = (await (
                    await apply({
                        kind: 'clear',
                        operationId: 'clear',
                        deviceId: 'desktop',
                        baseRevision: 1,
                        viewedAt: 100,
                    })
                ).json()) as HistoryResult;
                expect(cleared.state.cleared).toBe(2);
                const stale = (await (
                    await apply({
                        ...touch,
                        operationId: 'late-watch',
                        deviceId: 'offline-browser',
                    })
                ).json()) as HistoryResult;
                expect(stale.applied).toBe(false);
                const previous = storage.playlists.get('source')!;
                storage.playlists.upsert(
                    { ...previous, username: 'synthetic-other-user' },
                    { keepPayload: false }
                );
                expect(
                    (await apply({ ...touch, operationId: 'old-scope' })).status
                ).toBe(409);
                const replacement = (await (
                    await fetch(path, { headers })
                ).json()) as { scope: HistoryScope; state: HistoryState };
                expect(replacement.scope.sourceIncarnation).not.toBe(
                    initial.scope.sourceIncarnation
                );
                expect(replacement.state.items).toEqual([]);
                expect(storage.playlists.get('source')?.recentlyViewed).toEqual(
                    source.recentlyViewed
                );
            });
        }));
});
