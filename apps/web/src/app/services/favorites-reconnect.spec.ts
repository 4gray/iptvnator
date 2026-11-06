import { signal } from '@angular/core';
import { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type {
    FavoriteEntry,
    FavoriteLocalStore,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';
import { readFavoriteSummary } from './favorites-runtime-summary';

afterEach(async () => {
    localStorage.clear();
    await prepareSourceConnection();
});

it('refreshes every source before delivering a shared outbox with retired offline intents', async () => {
    localStorage.setItem(
        'iptvnator:source-server',
        JSON.stringify({
            apiUrl: 'https://synthetic.test/api',
            instanceId: 'synthetic-instance',
        })
    );
    await prepareSourceConnection();
    localStorage.setItem(
        'iptvnator-server:synthetic-instance:favorites-consent-v1',
        JSON.stringify({
            enabled: true,
            generation: 'g',
            deviceId: 'synthetic-device',
        })
    );
    const rows: FavoriteEntry[] = ['a', 'b'].map((sourceId) => {
        const address: FavoriteEntry['address'] = {
            instanceId: 'synthetic-instance',
            scope: 'shared',
            sourceId,
            sourceIncarnation: 'old',
            content: { provider: 'xtream', kind: 'movie', id: '42' },
        };
        return {
            address,
            record: {
                base: { revision: 0, member: false },
                state: { revision: 1, member: true },
                pending: [
                    {
                        address,
                        consentGeneration: 'g',
                        operation: {
                            operationId: `synthetic-${sourceId}`,
                            deviceId: 'synthetic-device',
                            expectedRevision: 0,
                            member: true,
                        },
                    },
                ],
            },
        };
    });
    const store: FavoriteLocalStore = {
        read: async (address) =>
            rows.find((row) => row.address.sourceId === address.sourceId)
                ?.record ?? null,
        entries: async (id) =>
            rows.filter((row) => row.address.sourceId === id),
        pending: async () => rows.flatMap((row) => row.record.pending),
        mutate: async (address, change) => {
            const row = rows.find(
                (row) => row.address.sourceId === address.sourceId
            )!;
            return (row.record = change(row.record));
        },
    };
    const applied: string[] = [];
    const client = new FavoritesSyncClient(store, {
        instanceId: 'synthetic-instance',
        deviceId: 'synthetic-device',
        consent: () => 'g',
        contexts: ['a', 'b'].map((sourceId) => ({
            sourceId,
            sourceIncarnation: 'old',
            provider: 'xtream',
        })),
        remember: jest.fn(),
        changed: jest.fn(),
        request: async (request) => {
            if (request.operation === 'favorites-context')
                return {
                    status: 200,
                    body: {
                        sourceId: request.id,
                        sourceIncarnation: request.id === 'b' ? 'new' : 'old',
                        provider: 'xtream',
                    },
                };
            if (request.operation === 'favorites-list')
                return { status: 200, body: { entries: [] } };
            if (request.operation !== 'favorites-apply' || !request.favorite)
                throw new Error('Unexpected synthetic request');
            const id = request.favorite.address.sourceId;
            applied.push(id);
            return id === 'b'
                ? { status: 409, body: { code: 'source_changed' } }
                : {
                      status: 200,
                      body: {
                          status: 'applied',
                          state: { revision: 1, member: true },
                      },
                  };
        },
    });
    const runtime = Object.create(
        FavoritesSyncRuntime.prototype
    ) as FavoritesSyncRuntime;
    Object.assign(runtime, {
        ensureClient: () => client,
        sources: { refresh: async () => undefined, state: () => 'connected' },
        sourceRows: async () => [{ _id: 'a' }, { _id: 'b' }],
        summary: () => readFavoriteSummary(client, 'g'),
        publish: jest.fn(),
        error: signal(false),
        state: signal('offline'),
        lastSync: signal(null),
    });
    await runtime.refresh();
    await runtime.refresh();
    expect(client.contexts.get('b')?.sourceIncarnation).toBe('new');
    expect(runtime.state()).toBe('ready');
    expect(applied).toEqual(['a']);
    expect(rows[0].record.pending).toHaveLength(0);
    expect(rows[1].record.pending).toHaveLength(1);
});
