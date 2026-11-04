import { webcrypto } from 'node:crypto';
import { FavoritesSyncClient } from './favorites-sync-client';
import { requestSourceServer } from '../source-sync/source-api';
import { prepareSourceConnection } from '../source-sync/source-connection';
import {
    sourceAuthorization,
    verifySourceInstance,
} from '../source-sync/source-authorization';
import { saveBrowserSourceConnection } from '../source-sync/source-browser-settings';
import type {
    FavoriteLocalRecord,
    FavoriteLocalStore,
} from '@iptvnator/shared/interfaces/favorites-sync';

const source = {
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream' as const,
};
const ref = { provider: 'xtream' as const, kind: 'movie' as const, id: '42' };
const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    storage: 'server',
    instanceId: 'nas',
    capabilities: ['sources-v1'],
};
const originalFetch = globalThis.fetch;
const originalElectron = window.electron;
function fixture() {
    let record: FavoriteLocalRecord | null = null;
    const store: FavoriteLocalStore = {
        read: async () => record,
        entries: async () => [],
        pending: async () => record?.pending ?? [],
        mutate: async (_address, change) => (record = change(record)),
    };
    return {
        store,
        client: new FavoritesSyncClient(store, {
            instanceId: 'nas',
            deviceId: 'synthetic-device',
            consent: () => 'generation',
            contexts: [source],
            request: requestSourceServer,
            remember: () => undefined,
            changed: () => undefined,
        }),
    };
}
beforeEach(async () => {
    Reflect.deleteProperty(window, 'electron');
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    });
    saveBrowserSourceConnection(
        { apiUrl: 'https://synthetic.invalid/api', instanceId: 'nas' },
        'synthetic-token'
    );
    await prepareSourceConnection();
    verifySourceInstance(instance);
});
afterEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await prepareSourceConnection();
    window.electron = originalElectron;
    globalThis.fetch = originalFetch;
});
describe('favorites through the real browser source transport', () => {
    it('does not revoke a new profile when the old connection returns a late access rejection', async () => {
        let finish!: (response: Response) => void;
        globalThis.fetch = jest.fn(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        ) as typeof fetch;
        const pending = requestSourceServer({
            operation: 'favorites-context',
            id: 'source',
        });
        saveBrowserSourceConnection(
            {
                apiUrl: 'https://synthetic-other.invalid/api',
                instanceId: 'other',
            },
            'synthetic-other-token'
        );
        await prepareSourceConnection();
        verifySourceInstance({ ...instance, instanceId: 'other' });
        finish({
            status: 401,
            headers: new Headers(),
            json: async () => ({ code: 'locked' }),
        } as Response);
        await pending;
        expect(
            sourceAuthorization('https://synthetic-other.invalid/api/stalker')
        ).toHaveProperty('Authorization', 'Bearer synthetic-other-token');
    });
    it('blocks edits after failed instance verification until the selected instance is verified', async () => {
        const f = fixture();
        globalThis.fetch = jest.fn();
        expect(() =>
            verifySourceInstance({
                ...instance,
                instanceId: 'synthetic-other-instance',
            })
        ).toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
        await expect(f.client.set('source', ref, true)).rejects.toThrow();
        expect(await f.store.pending()).toHaveLength(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        verifySourceInstance(instance);
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            headers: new Headers(),
            json: async () => source,
        });
        expect(await f.client.context('source')).toEqual(source);
    });
    it.each([
        { status: 401 },
        { status: 403 },
        { status: 409 },
        { status: 401, invalidBody: true },
    ])(
        'does not turn known access or identity refusal into offline intent (%j)',
        async ({ status, invalidBody }) => {
            const f = fixture();
            const fetch = jest.fn().mockResolvedValue({
                status,
                headers: new Headers(),
                json: async () => {
                    if (invalidBody)
                        throw new SyntaxError('Synthetic invalid response');
                    return { code: 'instance_changed' };
                },
            });
            globalThis.fetch = fetch;
            for (let i = 0; i < 2; i++)
                await expect(
                    f.client.set('source', ref, true)
                ).rejects.toThrow();
            expect(await f.store.pending()).toHaveLength(0);
            expect(fetch).toHaveBeenCalledTimes(1);
            verifySourceInstance(instance);
            fetch.mockResolvedValue({
                status: 200,
                headers: new Headers(),
                json: async () => source,
            });
            expect(await f.client.context('source')).toEqual(source);
        }
    );
    it('still queues repeated edits during an ordinary network outage', async () => {
        const f = fixture();
        globalThis.fetch = jest
            .fn()
            .mockRejectedValue(new TypeError('Synthetic network outage'));
        await f.client.set('source', ref, true);
        await f.client.set('source', ref, false);
        expect(await f.store.pending()).toHaveLength(2);
    });
});
