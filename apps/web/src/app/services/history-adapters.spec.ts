import { HistoryPlaylistAdapter } from './history-playlist-adapter';
import { HistoryXtreamAdapter } from './history-xtream-adapter';
import { HistorySyncClient } from '@iptvnator/services/history-sync';
import {
    emptyHistoryRecord,
    emptyHistoryState,
    applyHistoryOperation,
    type HistoryRecord,
    type HistoryScope,
} from '@iptvnator/shared/interfaces/history-sync';
import { m3uFavoriteReference } from '@iptvnator/shared/interfaces/favorites-sync';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
function fixture(provider: HistoryScope['provider']) {
    const scope: HistoryScope = {
        instanceId: 'nas',
        sourceId: 'source',
        sourceIncarnation: 'first',
        provider,
    };
    let record: HistoryRecord = emptyHistoryRecord();
    const store = {
        read: async () => JSON.parse(JSON.stringify(record)),
        mutate: async (
            _s: HistoryScope,
            update: (r: HistoryRecord) => HistoryRecord
        ) => {
            record = update(JSON.parse(JSON.stringify(record)));
            return record;
        },
    };
    const client = new HistorySyncClient(store, {
        instanceId: 'nas',
        deviceId: 'device',
        active: () => true,
        consent: () => null,
        contexts: [scope],
        request: async () => {
            throw new Error('offline');
        },
        remember: () => undefined,
        changed: () => undefined,
    });
    return {
        client,
        record: (value: HistoryRecord) => (record = value),
        read: () => record,
    };
}
const locks = {
    active: () => false,
    withholdsEverything: () => false,
    version: () => 0,
};
const playlist = {
    _id: 'source',
    title: 'Synthetic source',
    count: 0,
    importDate: '',
    autoRefresh: false,
} as Playlist;
describe('history provider projections', () => {
    it('matches duplicate M3U URLs exactly without publishing addresses in metadata', async () => {
        const f = fixture('m3u');
        const url = 'https://synthetic.invalid/play?token=synthetic';
        const source = {
            ...playlist,
            playlist: {
                items: [
                    { id: 'local-one', url, name: 'Synthetic channel' },
                    { id: 'local-two', url, name: 'Synthetic duplicate' },
                ],
            },
        } as Playlist;
        const reference = await m3uFavoriteReference(url);
        f.record({
            ...emptyHistoryRecord(),
            base: applyHistoryOperation(emptyHistoryState(), {
                kind: 'touch',
                reference,
                baseRevision: 0,
                operationId: 'remote',
                deviceId: 'remote',
                viewedAt: 1,
            }).state,
        });
        const adapter = new HistoryPlaylistAdapter(
            f.client,
            async () => source
        );
        const projected = await adapter.project(source);
        expect(projected.recentlyViewed).toHaveLength(1);
        expect(projected.recentlyViewed?.[0]).toMatchObject({ url });
        await adapter.mutate(source, { kind: 'remove', identities: [url] });
        expect((await adapter.project(source)).recentlyViewed).toEqual([]);
        expect(JSON.stringify(f.read())).not.toContain(url);
    });
    it('retains pre-enable local-only history when the server has an earlier clear', async () => {
        const f = fixture('m3u');
        const source = {
            ...playlist,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'local',
                    url: 'https://synthetic.invalid/local',
                    title: 'Synthetic local',
                    category_id: 'live',
                    added_at: 1,
                },
            ],
        } as Playlist;
        f.record({
            ...emptyHistoryRecord(),
            base: { revision: 10, cleared: 10, items: [] },
        });
        const adapter = new HistoryPlaylistAdapter(f.client, async (p) => p);
        expect((await adapter.project(source)).recentlyViewed).toHaveLength(1);
        await adapter.mutate(source, { kind: 'clear' });
        expect((await adapter.project(source)).recentlyViewed).toHaveLength(0);
    });
    it.each(['regular', 'embedded', 'lazy'] as const)(
        'reconstructs received Stalker %s series without stream commands',
        async (mode) => {
            const f = fixture('stalker');
            const reference = {
                provider: 'stalker' as const,
                kind: 'series' as const,
                id: '42',
                mode,
            };
            f.record({
                ...emptyHistoryRecord(),
                base: applyHistoryOperation(emptyHistoryState(), {
                    kind: 'touch',
                    reference,
                    snapshot: {
                        title: 'Synthetic series',
                        ...(mode === 'embedded' ? { episodes: [1, 2] } : {}),
                    },
                    baseRevision: 0,
                    operationId: 'remote',
                    deviceId: 'remote',
                    viewedAt: 1,
                }).state,
            });
            const adapter = new HistoryPlaylistAdapter(
                f.client,
                async (p) => p
            );
            const projected = await adapter.project({
                ...playlist,
                macAddress: '00:1a:79:00:00:01',
            });
            const row = projected.recentlyViewed![0];
            expect(row).toMatchObject({
                id: '42',
                favoriteContentType: mode === 'regular' ? 'series' : 'vod',
            });
            expect(JSON.stringify(row)).not.toContain('cmd');
            if (mode === 'embedded')
                expect(row).toHaveProperty('series', [1, 2]);
            if (mode === 'lazy') expect(row).toHaveProperty('is_series', true);
        }
    );
    it('does not attach a received Xtream item to a catalog identity conflict or locked missing content', async () => {
        const f = fixture('xtream');
        const reference = {
            provider: 'xtream' as const,
            kind: 'movie' as const,
            id: '42',
        };
        f.record({
            ...emptyHistoryRecord(),
            base: applyHistoryOperation(emptyHistoryState(), {
                kind: 'touch',
                reference,
                snapshot: { title: 'Synthetic old item', tmdbId: '100' },
                baseRevision: 0,
                operationId: 'remote',
                deviceId: 'remote',
                viewedAt: 1,
            }).state,
        });
        const raw = {
            getRecentItems: jest.fn().mockResolvedValue([]),
            getAllCategories: jest.fn().mockResolvedValue([]),
            getContentByXtreamId: jest.fn().mockResolvedValue({
                id: 99,
                type: 'movie',
                xtream_id: 42,
                tmdb_id: 200,
            }),
        } as never;
        const adapter = new HistoryXtreamAdapter(f.client, true, locks);
        expect(await adapter.project(raw, 'source')).toEqual([]);
        (
            raw as { getContentByXtreamId: jest.Mock }
        ).getContentByXtreamId.mockResolvedValue({
            id: 99,
            xtream_id: 42,
            type: 'movie',
        });
        expect(
            await new HistoryXtreamAdapter(f.client, true, {
                ...locks,
                active: () => true,
            }).project(raw, 'source')
        ).toEqual([]);
        (
            raw as { getContentByXtreamId: jest.Mock }
        ).getContentByXtreamId.mockResolvedValue(null);
        expect(
            await new HistoryXtreamAdapter(f.client, true, {
                ...locks,
                active: () => true,
            }).project(raw, 'source')
        ).toEqual([]);
    });
    it.each(['project', 'touch'] as const)(
        'discards a retired Xtream source during %s lookup',
        async (action) => {
            const f = fixture('xtream');
            const old = f.client.contexts.get('source')!;
            f.record({
                ...emptyHistoryRecord(),
                base: applyHistoryOperation(emptyHistoryState(), {
                    kind: 'touch',
                    reference: { provider: 'xtream', kind: 'movie', id: '42' },
                    operationId: 'remote',
                    deviceId: 'remote',
                    baseRevision: 0,
                    viewedAt: 1,
                }).state,
            });
            const raw = {
                getRecentItems: jest.fn().mockResolvedValue([]),
                getContentByXtreamId: jest.fn(async () => {
                    f.client.contexts.set('source', {
                        ...old,
                        sourceIncarnation: 'replacement',
                    });
                    return {
                        id: 9,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Synthetic item',
                    };
                }),
            } as never;
            const adapter = new HistoryXtreamAdapter(f.client, true, locks);
            await expect(
                action === 'project'
                    ? adapter.project(raw, 'source')
                    : adapter.invoke(raw, 'addRecentItem', [
                          { id: 9, type: 'movie', providerId: 42 },
                          'source',
                      ])
            ).rejects.toThrow('superseded');
            expect(f.read().pending).toEqual([]);
            expect(f.read().local).toEqual([]);
        }
    );
    it('withholds a projection if the parental lock changes while reading', async () => {
        const f = fixture('xtream');
        let version = 0;
        const raw = {
            getRecentItems: jest.fn(async () => {
                version++;
                return [
                    {
                        id: 9,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Synthetic item',
                    },
                ];
            }),
        } as never;
        const adapter = new HistoryXtreamAdapter(f.client, true, {
            ...locks,
            version: () => version,
        });
        expect(await adapter.project(raw, 'source')).toEqual([]);
        expect(
            await new HistoryXtreamAdapter(f.client, true, {
                ...locks,
                withholdsEverything: () => true,
            }).project(raw, 'source')
        ).toEqual([]);
        expect(
            (raw as { getRecentItems: jest.Mock }).getRecentItems
        ).toHaveBeenCalledTimes(1);
    });
    it('keeps a delayed write local after consent changes', async () => {
        const f = fixture('xtream');
        f.client.options.consent = () => 'first';
        const raw = {
            getContentByXtreamId: jest.fn(async () => {
                f.client.options.consent = () => 'replacement';
                return {
                    id: 9,
                    xtream_id: 42,
                    type: 'movie',
                    title: 'Synthetic item',
                };
            }),
        } as never;
        await new HistoryXtreamAdapter(f.client, true, locks).invoke(
            raw,
            'addRecentItem',
            [{ id: 9, type: 'movie', providerId: 42 }, 'source']
        );
        expect(f.read().pending).toEqual([]);
        expect(f.read().local).toHaveLength(1);
    });
    it('removes only the selected Stalker kind and series mode when provider IDs collide', async () => {
        const f = fixture('stalker');
        const references = [
            { provider: 'stalker', kind: 'movie', id: '42' },
            { provider: 'stalker', kind: 'live', id: '42' },
            { provider: 'stalker', kind: 'series', id: '42', mode: 'regular' },
            { provider: 'stalker', kind: 'series', id: '42', mode: 'lazy' },
        ] as const;
        for (const reference of references)
            f.read().base = applyHistoryOperation(f.read().base, {
                kind: 'touch',
                reference,
                baseRevision: 0,
                viewedAt: 1,
                operationId: 'remote',
                deviceId: 'remote',
            }).state;
        const source = { ...playlist, macAddress: '00:1a:79:00:00:01' };
        const adapter = new HistoryPlaylistAdapter(f.client, async (p) => p);
        const rows = (await adapter.project(source))
            .recentlyViewed! as StalkerPortalItem[];
        await expect(
            adapter.mutate(source, { kind: 'remove', identities: ['42'] })
        ).rejects.toThrow('ambiguous');
        const movie = rows.find(
            (item) => item.favoriteContentType === 'vod' && !item.is_series
        )!;
        await adapter.mutate(source, { kind: 'remove', identities: [movie] });
        expect((await adapter.project(source)).recentlyViewed).toHaveLength(3);
        const lazy = rows.find((item) => item.is_series)!;
        await adapter.mutate(source, { kind: 'remove', identities: [lazy] });
        expect((await adapter.project(source)).recentlyViewed).toHaveLength(2);
    });
    it('hydrates only the missing typed PWA catalog and discards history removed during hydration', async () => {
        const f = fixture('xtream');
        const reference = {
            provider: 'xtream',
            kind: 'movie',
            id: '42',
        } as const;
        f.read().base = applyHistoryOperation(f.read().base, {
            kind: 'touch',
            reference,
            snapshot: { title: 'Synthetic remote' },
            operationId: 'remote',
            deviceId: 'remote',
            baseRevision: 0,
            viewedAt: 1,
        }).state;
        let warm = false;
        const row = {
            id: 42,
            xtream_id: 42,
            type: 'movie',
            title: 'Synthetic remote',
            catalog_status: 'present',
        };
        const raw = {
            getRecentItems: jest.fn().mockResolvedValue([]),
            getContentByXtreamId: jest.fn(async () => (warm ? row : null)),
            getPlaylist: jest.fn().mockResolvedValue({
                serverUrl: 'https://synthetic.invalid',
                username: 'synthetic',
                password: 'synthetic',
            }),
            getContent: jest.fn(async () => {
                warm = true;
                return [row];
            }),
        };
        const adapter = new HistoryXtreamAdapter(f.client, false, locks);
        expect(await adapter.project(raw as never, 'source')).toEqual([
            expect.objectContaining({
                xtream_id: 42,
                catalog_status: 'present',
            }),
        ]);
        expect(raw.getContent.mock.calls).toHaveLength(1);
        await adapter.project(raw as never, 'source');
        expect(raw.getContent.mock.calls).toHaveLength(1);
        warm = false;
        raw.getContent.mockImplementation(async () => {
            warm = true;
            f.read().base = applyHistoryOperation(f.read().base, {
                kind: 'remove',
                reference,
                operationId: 'remove',
                deviceId: 'other',
                baseRevision: 1,
                viewedAt: 2,
            }).state;
            return [row];
        });
        expect(await adapter.project(raw as never, 'source')).toEqual([]);
    });
    it('advertises portable native history only for a verified source', async () => {
        const f = fixture('xtream');
        const adapter = new HistoryXtreamAdapter(f.client, true, locks);
        expect(
            await adapter.invoke({} as never, 'supportsPortableHistory', [
                'source',
            ])
        ).toBe(true);
        expect(
            await adapter.invoke({} as never, 'supportsPortableHistory', [
                'unverified',
            ])
        ).toBe(false);
    });
    it('retains saved identity and presentation until a sparse catalog row confirms them', async () => {
        const f = fixture('xtream');
        const reference = {
            provider: 'xtream',
            kind: 'movie',
            id: '42',
        } as const;
        f.read().base = applyHistoryOperation(f.read().base, {
            kind: 'touch',
            reference,
            snapshot: {
                title: 'Synthetic saved',
                tmdbId: '100',
                releaseYear: '2024',
            },
            operationId: 'remote',
            deviceId: 'remote',
            baseRevision: 0,
            viewedAt: 1,
        }).state;
        const raw = {
            getRecentItems: jest.fn().mockResolvedValue([]),
            getContentByXtreamId: jest.fn().mockResolvedValue({
                id: 9,
                xtream_id: 42,
                type: 'movie',
                category_id: 7,
                title: 'Synthetic unconfirmed',
                poster_url: 'https://synthetic.invalid/new.jpg',
            }),
        };
        const adapter = new HistoryXtreamAdapter(f.client, true, locks);
        expect(await adapter.project(raw as never, 'source')).toEqual([
            expect.objectContaining({
                title: 'Synthetic saved',
                tmdb_id: 100,
                release_year: 2024,
                poster_url: '',
            }),
        ]);
        raw.getRecentItems.mockResolvedValue([
            {
                id: 9,
                xtream_id: 42,
                type: 'movie',
                category_id: 7,
                title: 'Synthetic unconfirmed archive',
                poster_url: 'https://synthetic.invalid/new.jpg',
            },
        ]);
        expect(await adapter.project(raw as never, 'source')).toEqual([
            expect.objectContaining({
                title: 'Synthetic saved',
                tmdb_id: 100,
                release_year: 2024,
                poster_url: '',
            }),
        ]);
        raw.getRecentItems.mockResolvedValue([]);
        raw.getContentByXtreamId.mockResolvedValue({
            id: 9,
            xtream_id: 42,
            type: 'movie',
            category_id: 7,
            title: 'Synthetic confirmed',
            poster_url: 'https://synthetic.invalid/new.jpg',
            tmdb_id: 100,
            release_year: 2024,
        } as never);
        expect(await adapter.project(raw as never, 'source')).toEqual([
            expect.objectContaining({
                title: 'Synthetic confirmed',
                poster_url: 'https://synthetic.invalid/new.jpg',
                tmdb_id: 100,
                release_year: 2024,
            }),
        ]);
    });
    it('applies sidecar removals before the native 100-row browsing cap', async () => {
        const f = fixture('xtream');
        const rows = Array.from({ length: 101 }, (_, index) => ({
            id: index + 1,
            xtream_id: index + 1,
            type: 'movie',
            title: 'Synthetic archive',
            viewed_at: new Date(1000 - index).toISOString(),
        }));
        for (let id = 1; id <= 100; id++)
            f.read().base = applyHistoryOperation(f.read().base, {
                kind: 'remove',
                reference: {
                    provider: 'xtream',
                    kind: 'movie',
                    id: String(id),
                },
                operationId: String(id),
                deviceId: 'other',
                baseRevision: 0,
                viewedAt: 2000,
            }).state;
        const raw = {
            getRecentItems: jest.fn(
                async (_id: string, options?: { all: true }) =>
                    options?.all ? rows : rows.slice(0, 100)
            ),
        };
        const result = await new HistoryXtreamAdapter(
            f.client,
            true,
            locks
        ).project(raw as never, 'source');
        expect(result).toEqual([expect.objectContaining({ xtream_id: 101 })]);
        expect(raw.getRecentItems).toHaveBeenCalledWith('source', {
            all: true,
        });
    });
    it('retains hidden unlocked archives while withholding locked or unknown categories', async () => {
        const f = fixture('xtream');
        const rows = [7, 8, 9, 10].map((category_id) => ({
            id: category_id,
            xtream_id: category_id,
            type: 'movie',
            title: 'Synthetic archive',
            category_id,
        }));
        const raw = {
            getRecentItems: jest.fn().mockResolvedValue(rows),
            getAllCategories: jest.fn().mockResolvedValue([
                { id: 7, hidden: false, locked: false },
                { id: 8, hidden: true, locked: false },
                { id: 9, hidden: false, locked: true },
            ]),
        };
        let withholding = false;
        const adapter = new HistoryXtreamAdapter(f.client, true, {
            ...locks,
            active: () => true,
            withholdsEverything: () => withholding,
        });
        expect(await adapter.project(raw as never, 'source')).toEqual([
            rows[0],
            rows[1],
        ]);
        expect(raw.getAllCategories.mock.calls).toEqual([
            ['source', 'live'],
            ['source', 'movies'],
            ['source', 'series'],
        ]);
        withholding = true;
        expect(await adapter.project(raw as never, 'source')).toEqual([]);
    });
    it.each([true, false])(
        'finds unlocked shared entries beyond the first 100 with sqlite=%s',
        async (sqlite) => {
            const f = fixture('xtream');
            for (let id = 1; id <= 101; id++)
                f.read().base = applyHistoryOperation(f.read().base, {
                    kind: 'touch',
                    reference: {
                        provider: 'xtream',
                        kind: id === 1 ? 'series' : 'movie',
                        id: String(id),
                    },
                    operationId: String(id),
                    deviceId: 'other',
                    baseRevision: 0,
                    viewedAt: id,
                }).state;
            let seriesWarm = sqlite;
            const row = (id: number) => ({
                id,
                xtream_id: id,
                type: id === 1 ? 'series' : 'movie',
                title: 'Synthetic history item',
                category_id: id === 1 ? 7 : 8,
            });
            const raw = {
                getRecentItems: jest.fn().mockResolvedValue([]),
                getAllCategories: jest.fn().mockResolvedValue([
                    { id: 7, locked: false },
                    { id: 8, locked: true },
                ]),
                getContentByXtreamId: jest.fn(
                    async (
                        id: number,
                        _source: string,
                        _kind: string,
                        _hints: unknown,
                        _session: unknown,
                        excludeLocked: boolean
                    ) =>
                        id === 1
                            ? seriesWarm
                                ? row(id)
                                : null
                            : excludeLocked
                              ? null
                              : row(id)
                ),
                getPlaylist: jest.fn().mockResolvedValue({
                    serverUrl: 'https://history.example',
                    username: 'synthetic',
                    password: 'synthetic',
                }),
                getContent: jest.fn(
                    async (
                        _source: string,
                        _credentials: unknown,
                        kind: string
                    ) => {
                        expect(kind).toBe('series');
                        seriesWarm = true;
                        return [row(1)];
                    }
                ),
            };
            const result = await new HistoryXtreamAdapter(f.client, sqlite, {
                ...locks,
                active: () => true,
            }).project(raw as never, 'source');
            expect(result).toEqual([
                expect.objectContaining({ xtream_id: 1, type: 'series' }),
            ]);
            expect(raw.getContent).toHaveBeenCalledTimes(sqlite ? 0 : 1);
        }
    );
    it('stops after 100 eligible entries while overlaying all known archive keys', async () => {
        const f = fixture('xtream');
        for (let id = 1; id <= 200; id++)
            f.read().base = applyHistoryOperation(f.read().base, {
                kind: 'touch',
                reference: {
                    provider: 'xtream',
                    kind: 'movie',
                    id: String(id),
                },
                operationId: String(id),
                deviceId: 'other',
                baseRevision: 0,
                viewedAt: id,
            }).state;
        f.read().base = applyHistoryOperation(f.read().base, {
            kind: 'remove',
            reference: { provider: 'xtream', kind: 'movie', id: '999' },
            operationId: 'remove',
            deviceId: 'other',
            baseRevision: 0,
            viewedAt: 201,
        }).state;
        const raw = {
            getRecentItems: jest.fn().mockResolvedValue([
                {
                    id: 999,
                    xtream_id: 999,
                    type: 'movie',
                    title: 'Synthetic removed archive',
                    viewed_at: new Date(1000).toISOString(),
                },
            ]),
            getContentByXtreamId: jest.fn(async (id: number) => ({
                id,
                xtream_id: id,
                type: 'movie',
                title: 'Synthetic history item',
            })),
        };
        const result = await new HistoryXtreamAdapter(
            f.client,
            true,
            locks
        ).project(raw as never, 'source');
        expect(result.map((item) => item.xtream_id)).toEqual(
            Array.from({ length: 100 }, (_, index) => 200 - index)
        );
        expect(raw.getContentByXtreamId).toHaveBeenCalledTimes(100);
    });
    it('normalizes SQLite UTC archive times before the merged browsing cap', async () => {
        const f = fixture('xtream');
        for (let id = 1; id <= 100; id++)
            f.read().base = applyHistoryOperation(f.read().base, {
                kind: 'touch',
                reference: {
                    provider: 'xtream',
                    kind: 'movie',
                    id: String(id),
                },
                operationId: String(id),
                deviceId: 'other',
                baseRevision: 0,
                viewedAt: Date.parse('2026-11-05T11:30:00Z') + id,
            }).state;
        const raw = {
            getRecentItems: jest
                .fn()
                .mockResolvedValue([
                    {
                        id: 999,
                        xtream_id: 999,
                        type: 'movie',
                        title: 'Synthetic UTC archive',
                        viewed_at: '2026-11-05 12:00:00',
                    },
                ]),
            getContentByXtreamId: jest.fn(async (id: number) => ({
                id,
                xtream_id: id,
                type: 'movie',
                title: 'Synthetic shared item',
            })),
        };
        const result = await new HistoryXtreamAdapter(
            f.client,
            true,
            locks
        ).project(raw as never, 'source');
        expect(result).toHaveLength(100);
        expect(result[0]).toMatchObject({
            xtream_id: 999,
            viewed_at: '2026-11-05T12:00:00.000Z',
        });
    });
    it('normalizes legacy Stalker archive times for projection and import', async () => {
        const f = fixture('stalker');
        const source = {
            ...playlist,
            macAddress: '00:1a:79:00:00:01',
            recentlyViewed: [
                {
                    id: '41',
                    title: 'Synthetic UTC archive',
                    favoriteContentType: 'vod',
                    added_at: '2026-11-05 12:00:00',
                },
            ],
        } as Playlist;
        f.read().base = applyHistoryOperation(f.read().base, {
            kind: 'touch',
            reference: { provider: 'stalker', kind: 'movie', id: '42' },
            snapshot: { title: 'Synthetic shared item' },
            operationId: 'shared',
            deviceId: 'other',
            baseRevision: 0,
            viewedAt: Date.parse('2026-11-05T11:30:00Z'),
        }).state;
        const adapter = new HistoryPlaylistAdapter(f.client, async (p) => p);
        expect((await adapter.local(source)).items[0].viewedAt).toBe(
            Date.parse('2026-11-05T12:00:00Z')
        );
        expect(
            (await adapter.project(source)).recentlyViewed?.[0]
        ).toMatchObject({ id: '41' });
    });
});
