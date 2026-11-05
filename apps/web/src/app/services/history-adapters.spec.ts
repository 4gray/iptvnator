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
});
