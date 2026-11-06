import { webcrypto } from 'node:crypto';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import {
    m3uFavoriteReference,
    type FavoriteEntry,
    type FavoriteLocalStore,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import { FavoritesLocalOrder } from './favorites-local-order';
import { FavoriteSupersededError } from '@iptvnator/services/favorites-sync';

beforeAll(() =>
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    })
);
afterEach(() => jest.restoreAllMocks());

describe('M3U favorite URL index', () => {
    it('shares unchanged and overlapping reads, invalidates versions and incarnations, and resolves changed URLs', async () => {
        const items = Array.from({ length: 20 }, (_, n) => ({
            url: `https://fixture.invalid/${n}`,
            name: `Synthetic ${n}`,
        }));
        const source = {
            _id: 'source',
            title: 'Synthetic source',
            favorites: [],
            items,
            count: items.length,
            sourceSyncRevision: '1',
        } as unknown as Playlist;
        const ref = await m3uFavoriteReference(items[0].url);
        const entry = {
            address: { sourceIncarnation: 'first', content: ref },
            record: { state: { member: true } },
        } as FavoriteEntry;
        const client = {
            entries: async () => [entry],
        } as unknown as FavoritesSyncClient;
        const adapter = new FavoritesPlaylistAdapter(client, () => true);
        const digest = jest.spyOn(webcrypto.subtle, 'digest');
        expect((await adapter.project(source)).favorites).toEqual([
            items[0].url,
        ]);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        await Promise.all([
            adapter.project({
                ...source,
                items: items.map((item) => ({ ...item })),
            }),
            adapter.project({
                ...source,
                items: items.map((item) => ({ ...item })),
            }),
        ]);
        expect(digest).not.toHaveBeenCalled();
        source.sourceSyncRevision = '2';
        await Promise.all([adapter.project(source), adapter.project(source)]);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        entry.address.sourceIncarnation = 'second';
        await adapter.project(source);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        source.updateDate = 1;
        await adapter.project(source);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        source.count = 21;
        await adapter.project(source);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        const changed = {
            ...source,
            updateDate: 2,
            items: [{ ...items[0], url: 'https://fixture.invalid/changed' }],
        };
        expect((await adapter.project(changed)).favorites).toEqual([]);
        expect(digest).toHaveBeenCalledTimes(1);
    });

    it('retries a failed index build instead of caching a rejected promise', async () => {
        const url = 'https://fixture.invalid/one';
        const source = {
            _id: 'source',
            items: [{ url }],
            favorites: [],
        } as unknown as Playlist;
        const content = await m3uFavoriteReference(url);
        const client = {
            entries: async () => [
                {
                    address: { sourceIncarnation: 'first', content },
                    record: { state: { member: true } },
                },
            ],
        } as unknown as FavoritesSyncClient;
        const adapter = new FavoritesPlaylistAdapter(client, () => true);
        const digest = jest
            .spyOn(webcrypto.subtle, 'digest')
            .mockRejectedValueOnce(new Error('Synthetic digest failure'));
        await expect(adapter.project(source)).rejects.toThrow(
            'Synthetic digest failure'
        );
        expect((await adapter.project(source)).favorites).toEqual([url]);
        expect(digest).toHaveBeenCalledTimes(2);
        expect(
            (
                await adapter.project({
                    ...source,
                    items: [{ url: 'https://fixture.invalid/replacement' }],
                })
            ).favorites
        ).toEqual([]);
        expect(digest).toHaveBeenCalledTimes(3);
    });
});

describe('playlist favorite action ownership', () => {
    it('finishes the first online favorite for a source without a cached context', async () => {
        const url = 'https://synthetic.test/first';
        const source = {
            _id: 'source',
            favorites: [],
            items: [{ url, name: 'Synthetic first channel' }],
        } as unknown as Playlist;
        const rows: FavoriteEntry[] = [];
        const store: FavoriteLocalStore = {
            read: async () => rows[0]?.record ?? null,
            entries: async () => rows,
            pending: async () => rows.flatMap((row) => row.record.pending),
            mutate: async (address, update) => {
                const record = update(rows[0]?.record ?? null);
                rows.splice(0, rows.length, { address, record });
                return record;
            },
        };
        const client = new FavoritesSyncClient(store, {
            instanceId: 'synthetic-instance',
            deviceId: 'synthetic-device',
            consent: () => 'first-consent',
            request: async (input) =>
                input.operation === 'favorites-context'
                    ? {
                          status: 200,
                          body: {
                              sourceId: 'source',
                              sourceIncarnation: 'first',
                              provider: 'm3u',
                          },
                      }
                    : { status: 503, body: {} },
            remember: jest.fn(),
            changed: jest.fn(),
        });
        const adapter = new FavoritesPlaylistAdapter(client, () => true);
        await expect(
            adapter.mutate(source, () => [url])
        ).resolves.toMatchObject({ favorites: [url] });
        expect(rows).toHaveLength(1);
        expect(rows[0].record.state.member).toBe(true);
        expect(rows[0].record.pending).toHaveLength(1);
    });
    function fixture(enabled = true) {
        let consent: string | null = enabled ? 'first-consent' : null;
        let active = true;
        const context = { sourceIncarnation: 'first' };
        const client = {
            options: { consent: () => consent, profileActive: () => active },
            contexts: new Map([['source', context]]),
            entries: async () => [],
            set: jest.fn(async () => undefined),
            setLocal: jest.fn(async () => undefined),
        } as unknown as FavoritesSyncClient;
        const order = {
            read: () => ['synthetic-order'],
            write: jest.fn(),
        } as unknown as FavoritesLocalOrder;
        const source = {
            _id: 'source',
            favorites: [],
        } as unknown as Playlist;
        return {
            client,
            order,
            source,
            replace: () => {
                context.sourceIncarnation = 'second';
            },
            retire: () => {
                active = false;
            },
            consent: () => {
                consent = consent ? null : 'second-consent';
            },
        };
    }
    it.each(['replace', 'retire', 'consent'] as const)(
        'rejects a delayed playlist action after %s without saving membership, archive or order',
        async (change) => {
            const f = fixture(change !== 'consent');
            let finish!: () => void;
            const wait = new Promise<void>((resolve) => (finish = resolve));
            const catalog = jest.fn(async (source: Playlist) => {
                await wait;
                return source;
            });
            const persist = jest.fn();
            const adapter = new FavoritesPlaylistAdapter(
                f.client,
                () => f.client.options.consent() !== null,
                catalog,
                f.order
            );
            const action = adapter.mutate(
                f.source,
                () => ['https://synthetic.test/one', 'unresolved'],
                persist
            );
            await Promise.resolve();
            expect(catalog).toHaveBeenCalledTimes(1);
            f[change]();
            finish();
            await expect(action).rejects.toBeInstanceOf(
                FavoriteSupersededError
            );
            expect(f.client.set).not.toHaveBeenCalled();
            expect(f.client.setLocal).not.toHaveBeenCalled();
            expect(persist).not.toHaveBeenCalled();
            expect(f.order.write).not.toHaveBeenCalled();
        }
    );
    it('stops the remaining writes and local publication when a source changes during the first save', async () => {
        const f = fixture();
        jest.mocked(f.client.set).mockImplementationOnce(async () =>
            f.replace()
        );
        const persist = jest.fn();
        const adapter = new FavoritesPlaylistAdapter(
            f.client,
            () => true,
            undefined,
            f.order
        );
        await expect(
            adapter.mutate(
                f.source,
                () => [
                    'https://synthetic.test/one',
                    'https://synthetic.test/two',
                    'unresolved',
                ],
                persist
            )
        ).rejects.toBeInstanceOf(FavoriteSupersededError);
        expect(f.client.set).toHaveBeenCalledTimes(1);
        expect(persist).not.toHaveBeenCalled();
        expect(f.order.write).not.toHaveBeenCalled();
    });
});
