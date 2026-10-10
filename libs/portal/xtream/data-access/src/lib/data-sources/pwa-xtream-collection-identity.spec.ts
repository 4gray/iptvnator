import { TestBed } from '@angular/core/testing';
import { PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';

const credentials = {
    serverUrl: 'http://localhost:3211',
    username: 'demo',
    password: 'test',
};
const types = ['live', 'movie', 'series'] as const;

describe('PWA Xtream collection identity', () => {
    let source: PwaXtreamDataSource;
    const api = { getStreams: jest.fn() };
    const playlists = { getPlaylistById: jest.fn() };
    const reload = () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: XtreamApiService, useValue: api },
                { provide: PlaylistsService, useValue: playlists },
            ],
        });
        source = TestBed.inject(PwaXtreamDataSource);
    };
    const loadAll = () =>
        Promise.all(
            types.map((type) => source.getContent('p1', credentials, type))
        );
    const read = (key: string) => JSON.parse(localStorage.getItem(key) ?? '{}');
    const seedLegacyCollection = (otherIds: number[] = []) => {
        const ids = [42, ...otherIds];
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: ids }));
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                p1: ids.map((id) => ({
                    id,
                    viewedAt: '2026-10-01T00:00:00.000Z',
                })),
            })
        );
        const snapshots: Record<string, unknown> = {};
        for (const id of ids.filter((id) => id !== 77)) {
            snapshots[id] = {
                id,
                xtream_id: id,
                type: id === 42 ? 'movie' : 'series',
                title: 'Saved item '.repeat(100),
            };
        }
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({ p1: snapshots })
        );
    };
    const limitStorageGrowth = (extraCharacters: number) => {
        const storedSize = () =>
            Object.keys(localStorage).reduce(
                (size, key) =>
                    size +
                    key.length +
                    (localStorage.getItem(key)?.length ?? 0),
                0
            );
        const quota = storedSize() + extraCharacters;
        const setItem = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(
            function (key, value) {
                const oldValue = this.getItem(key);
                const growth =
                    value.length -
                    (oldValue?.length ?? 0) +
                    (oldValue === null ? key.length : 0);
                if (storedSize() + growth > quota)
                    throw new DOMException(
                        'Storage full',
                        'QuotaExceededError'
                    );
                setItem.call(this, key, value);
            }
        );
    };

    beforeEach(() => {
        localStorage.clear();
        api.getStreams.mockReset().mockImplementation((_credentials, type) =>
            Promise.resolve([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: `${type} 42`,
                    category_id: '1',
                },
            ])
        );
        playlists.getPlaylistById.mockReturnValue(
            of({ _id: 'p1', title: 'Test', ...credentials })
        );
        reload();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it.each([0, 512])(
        'keeps legacy collection reads and status usable with only %i characters of storage headroom',
        async (headroom) => {
            seedLegacyCollection();
            limitStorageGrowth(headroom);
            for (let attempt = 0; attempt < 2; attempt++) {
                expect(await source.getFavorites('p1')).toEqual([
                    expect.objectContaining({ xtream_id: 42, type: 'movie' }),
                ]);
                expect(await source.getRecentItems('p1')).toEqual([
                    expect.objectContaining({ xtream_id: 42, type: 'movie' }),
                ]);
                expect(
                    await source.isFavorite({ id: 42, type: 'movie' }, 'p1')
                ).toBe(true);
                expect(
                    await source.isFavorite({ id: 42, type: 'live' }, 'p1')
                ).toBe(false);
                reload();
            }
            expect(read('xtream-collection-items').p1[42].type).toBe('movie');
            expect(api.getStreams).not.toHaveBeenCalled();
        }
    );

    it.each([
        ['removeFavorite', 0],
        ['removeFavorite', 512],
        ['removeRecentItem', 0],
        ['removeRecentItem', 512],
    ] as const)(
        '%s persists deletion with only %i characters of storage headroom',
        async (operation, headroom) => {
            seedLegacyCollection([
                77,
                ...Array.from({ length: 12 }, (_, index) => 100 + index),
            ]);
            limitStorageGrowth(headroom);
            await source[operation]({ id: 42, type: 'movie' }, 'p1');
            expect(api.getStreams).not.toHaveBeenCalled();
            const key =
                operation === 'removeFavorite'
                    ? 'xtream-favorites'
                    : 'xtream-recent-items';
            const storedIds =
                operation === 'removeFavorite'
                    ? read(key).p1
                    : read(key).p1.map((entry: { id: unknown }) => entry.id);
            expect(storedIds).not.toContain(42);
            expect(storedIds).not.toContain('movie:42');
            expect(storedIds).toContain(77);
            expect(read('xtream-collection-items').p1[42].type).toBe('movie');
            reload();
            const favorites = await source.getFavorites('p1');
            const recent = await source.getRecentItems('p1');
            expect(favorites.some((item) => item.xtream_id === 42)).toBe(
                operation !== 'removeFavorite'
            );
            expect(recent.some((item) => item.xtream_id === 42)).toBe(
                operation !== 'removeRecentItem'
            );
        }
    );

    it.each(['addFavorite', 'addRecentItem'] as const)(
        '%s reports an authoritative write that cannot fit',
        async (operation) => {
            seedLegacyCollection();
            limitStorageGrowth(0);
            await expect(
                source[operation]({ id: 99, type: 'series' }, 'p1')
            ).rejects.toMatchObject({ name: 'QuotaExceededError' });
            expect(read('xtream-favorites').p1).toEqual([42]);
            expect(
                read('xtream-recent-items').p1.map(
                    (entry: { id: unknown }) => entry.id
                )
            ).toEqual([42]);
        }
    );

    it.each(['addFavorite', 'addRecentItem'] as const)(
        '%s succeeds when the reference fits but its optional snapshot does not',
        async (operation) => {
            seedLegacyCollection();
            api.getStreams.mockResolvedValue([
                { series_id: 99, name: 'New series '.repeat(100) },
            ]);
            await source.getContent('p1', credentials, 'series');
            limitStorageGrowth(512);
            await source[operation]({ id: 99, type: 'series' }, 'p1');
            const storedIds =
                operation === 'addFavorite'
                    ? read('xtream-favorites').p1
                    : read('xtream-recent-items').p1.map(
                          (entry: { id: unknown }) => entry.id
                      );
            expect(storedIds).toContain('series:99');
            expect(
                read('xtream-collection-items').p1['series:99']
            ).toBeUndefined();
            reload();
            const items =
                operation === 'addFavorite'
                    ? await source.getFavorites('p1')
                    : await source.getRecentItems('p1');
            expect(items).toContainEqual(
                expect.objectContaining({ xtream_id: 99, type: 'series' })
            );
        }
    );

    it.each(['addFavorite', 'addRecentItem', 'statusThenAddFavorite'] as const)(
        '%s saves the requested reference before optional copies consume its space',
        async (operation) => {
            seedLegacyCollection();
            const snapshots = read('xtream-collection-items');
            const copyGrowth =
                JSON.stringify({
                    p1: { ...snapshots.p1, 'movie:42': snapshots.p1[42] },
                }).length - JSON.stringify(snapshots).length;
            const keyGrowth =
                JSON.stringify({ p1: ['movie:42'] }).length -
                JSON.stringify({ p1: [42] }).length;
            // Both optional writes fit exactly, but then leave no room for an addition.
            limitStorageGrowth(copyGrowth + keyGrowth);
            const target = { id: 99, type: 'series' } as const;
            if (operation === 'statusThenAddFavorite') {
                expect(await source.isFavorite(target, 'p1')).toBe(false);
                expect(
                    await source.isFavorite({ id: 42, type: 'movie' }, 'p1')
                ).toBe(true);
                expect(Storage.prototype.setItem).not.toHaveBeenCalled();
            }
            const mutation =
                operation === 'addRecentItem' ? operation : 'addFavorite';
            await expect(
                source[mutation](target, 'p1')
            ).resolves.toBeUndefined();
            const storedIds =
                mutation === 'addFavorite'
                    ? read('xtream-favorites').p1
                    : read('xtream-recent-items').p1.map(
                          (entry: { id: unknown }) => entry.id
                      );
            expect(storedIds).toContain('series:99');
            expect(read('xtream-collection-items').p1[42]).toEqual(
                snapshots.p1[42]
            );
            expect(api.getStreams).not.toHaveBeenCalled();
        }
    );

    it.each([42, 'movie:42'])(
        'deduplicates before the 50-item limit while preserving the newer %s key until the save',
        async (newerKey) => {
            seedLegacyCollection();
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p1: [
                        {
                            id: newerKey === 42 ? 'movie:42' : 42,
                            viewedAt: '2026-09-30T00:00:00.000Z',
                        },
                        { id: newerKey, viewedAt: '2026-10-02T00:00:00.000Z' },
                        ...Array.from({ length: 48 }, (_, index) => ({
                            id: `series:${100 + index}`,
                            viewedAt: '2026-10-01T00:00:00.000Z',
                        })),
                    ],
                })
            );
            const writes = jest.spyOn(Storage.prototype, 'setItem');
            await source.addRecentItem({ id: 99, type: 'series' }, 'p1');
            expect(writes.mock.calls[0][0]).toBe('xtream-recent-items');
            expect(JSON.parse(writes.mock.calls[0][1]).p1).toContainEqual({
                id: newerKey,
                viewedAt: '2026-10-02T00:00:00.000Z',
            });
            const recent = read('xtream-recent-items').p1;
            expect(recent).toHaveLength(50);
            expect(recent).toContainEqual({
                id: 'series:147',
                viewedAt: '2026-10-01T00:00:00.000Z',
            });
            expect(recent).toContainEqual({
                id: 'movie:42',
                viewedAt: '2026-10-02T00:00:00.000Z',
            });
            expect(recent[0].id).toBe('series:99');
            expect(api.getStreams).not.toHaveBeenCalled();
        }
    );

    it('preserves restored colliding types through hydration and clear/restore', async () => {
        await source.restoreUserData('p1', {
            hiddenCategories: [],
            playbackPositions: [],
            favorites: types.map((contentType) => ({
                contentType,
                xtreamId: 42,
            })),
            recentlyViewed: types.map((contentType, i) => ({
                contentType,
                xtreamId: 42,
                viewedAt: `2026-10-0${i + 1}T12:00:00.000Z`,
            })),
        });
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
        expect(
            (await source.getRecentItems('p1')).map((item) => item.type)
        ).toEqual(['series', 'movie', 'live']);
        const backup = await source.clearPlaylistContent('p1');
        expect(backup.favorites).toEqual(
            types.map((contentType) => ({ contentType, xtreamId: 42 }))
        );
        expect(backup.recentlyViewed.map((item) => item.contentType)).toEqual(
            types
        );
        reload();
        await source.restoreUserData('p1', backup);
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
    });

    it('preserves ambiguous numeric legacy entries without selecting the last matching type', async () => {
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['42'] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                p1: [{ id: 42, viewedAt: '2026-10-01T12:00:00.000Z' }],
            })
        );
        await loadAll();
        expect(await source.getFavorites('p1')).toEqual([]);
        expect(await source.getRecentItems('p1')).toEqual([]);
        expect(read('xtream-favorites').p1).toEqual(['42']);
        expect(read('xtream-recent-items').p1[0].id).toBe(42);
    });
    it('does not infer a legacy type from a partially loaded catalog', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: [42] }));
        await source.getContent('p1', credentials, 'movie');
        expect(await source.getFavorites('p1')).toEqual([]);
        expect(api.getStreams).toHaveBeenCalledWith(credentials, 'live');
        expect(api.getStreams).toHaveBeenCalledWith(credentials, 'series');
    });

    it('migrates a numeric reference using its stored typed snapshot offline', async () => {
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['42'] })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                p1: {
                    42: {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Saved Movie',
                    },
                },
            })
        );
        expect(
            (await source.getFavorites('p1')).map((item) => item.title)
        ).toEqual(['Saved Movie']);
        expect(read('xtream-favorites').p1).toEqual(['movie:42']);
        expect(read('xtream-collection-items').p1['movie:42'].title).toBe(
            'Saved Movie'
        );
        expect(api.getStreams).not.toHaveBeenCalled();
    });

    it('keeps additions, status, removal and snapshot backdrops isolated after reload', async () => {
        await loadAll();
        for (const type of types) {
            await source.addFavorite({ id: 42, type }, 'p1');
            await source.addRecentItem({ id: 42, type }, 'p1');
        }
        await source.setContentBackdropIfMissing(
            { id: 42, type: 'movie' },
            'p1',
            'movie.jpg'
        );
        expect(
            (await source.getFavorites('p1')).map((item) => [
                item.type,
                item.backdrop_url,
            ])
        ).toEqual([
            ['live', undefined],
            ['movie', 'movie.jpg'],
            ['series', undefined],
        ]);
        reload();
        api.getStreams.mockClear();
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
        expect(
            (await source.getRecentItems('p1')).map((item) => item.type)
        ).toEqual(['series', 'movie', 'live']);
        await source.removeFavorite({ id: 42, type: 'movie' }, 'p1');
        await source.removeRecentItem({ id: 42, type: 'series' }, 'p1');
        expect(await source.isFavorite({ id: 42, type: 'movie' }, 'p1')).toBe(
            false
        );
        expect(await source.isFavorite({ id: 42, type: 'series' }, 'p1')).toBe(
            true
        );
        expect(
            (await source.getRecentItems('p1')).map((item) => item.type)
        ).toEqual(['movie', 'live']);
        expect(api.getStreams).not.toHaveBeenCalled();
    });

    it('hydrates only the exact typed category for a cold typed favorite', async () => {
        await source.addFavorite({ id: 42, type: 'movie' }, 'p1');
        reload();
        api.getStreams.mockClear();
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(['movie']);
        expect(api.getStreams.mock.calls.map((call) => call[1])).toEqual([
            'movie',
        ]);
    });

    it.each([
        'addFavorite',
        'removeFavorite',
        'isFavorite',
        'addRecentItem',
        'removeRecentItem',
    ] as const)(
        '%s completes locally while unrelated catalog hydration is pending',
        async (operation) => {
            const savedIds = [42, 77, 'series:99'];
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p1: savedIds })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p1: savedIds.map((id) => ({
                        id,
                        viewedAt: '2026-10-01T00:00:00.000Z',
                    })),
                })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    p1: {
                        42: {
                            id: 42,
                            xtream_id: 42,
                            type: 'movie',
                            title: 'Saved Movie',
                        },
                    },
                })
            );
            let releaseCatalog!: (items: unknown[]) => void;
            const catalog = new Promise((resolve) => {
                releaseCatalog = resolve;
            });
            api.getStreams.mockReturnValue(catalog);
            const loading = Promise.all([
                source.getFavorites('p1'),
                source.getRecentItems('p1'),
            ]);
            for (let i = 0; i < 20; i++) await Promise.resolve();
            const requestsBeforeAction = api.getStreams.mock.calls.length;
            expect(requestsBeforeAction).toBeGreaterThan(0);
            const adding =
                operation === 'addFavorite' || operation === 'addRecentItem';
            let settled = false;
            let result: boolean | void;
            const action = source[operation](
                { id: 42, type: adding ? 'live' : 'movie' },
                'p1'
            ).then((value) => {
                result = value;
                settled = true;
            });
            try {
                for (let i = 0; i < 20; i++) await Promise.resolve();
                expect(settled).toBe(true);
                expect(api.getStreams).toHaveBeenCalledTimes(
                    requestsBeforeAction
                );
                if (operation === 'isFavorite') expect(result).toBe(true);
                const storedIds = operation.includes('Recent')
                    ? read('xtream-recent-items').p1.map(
                          (entry: { id: unknown }) => entry.id
                      )
                    : read('xtream-favorites').p1;
                const expectedIds = operation.startsWith('remove')
                    ? [77, 'series:99']
                    : adding
                      ? ['movie:42', 77, 'series:99', 'live:42']
                      : [42, 77, 'series:99'];
                expect([...storedIds].sort()).toEqual(expectedIds.sort());
            } finally {
                releaseCatalog([]);
                await Promise.all([loading, action]);
            }
        }
    );

    it('preserves newer storage changes while legacy hydration is pending', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: [42] }));
        let resolveMovie!: (items: unknown[]) => void;
        api.getStreams.mockImplementation((_credentials, type) =>
            type === 'movie'
                ? new Promise((resolve) => {
                      resolveMovie = resolve;
                  })
                : Promise.resolve([])
        );
        const pending = source.getFavorites('p1');
        for (let i = 0; i < 10 && !resolveMovie; i++) await Promise.resolve();
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['series:99'], other: ['live:77'] })
        );
        resolveMovie([{ stream_id: 42, name: 'Movie' }]);
        await pending;
        expect(read('xtream-favorites')).toEqual({
            p1: ['series:99'],
            other: ['live:77'],
        });
    });

    it('deduplicates migrated recents using the most recent timestamp', async () => {
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                p1: [
                    { id: 42, viewedAt: '2026-10-01T00:00:00.000Z' },
                    { id: 'movie:42', viewedAt: '2026-10-02T00:00:00.000Z' },
                ],
            })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                p1: {
                    42: {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Saved Movie',
                    },
                },
            })
        );
        expect(await source.getRecentItems('p1')).toEqual([
            expect.objectContaining({
                type: 'movie',
                viewed_at: '2026-10-02T00:00:00.000Z',
            }),
        ]);
        expect(read('xtream-recent-items').p1).toEqual([
            { id: 'movie:42', viewedAt: '2026-10-02T00:00:00.000Z' },
        ]);
    });
    it('resolves a unique legacy type even when that catalog repeats its provider row', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: [42] }));
        api.getStreams.mockImplementation((_credentials, type) =>
            Promise.resolve(
                type === 'movie'
                    ? [
                          { stream_id: 42, name: 'Movie' },
                          { stream_id: 42, name: 'Movie' },
                      ]
                    : []
            )
        );
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(['movie']);
        expect(read('xtream-favorites').p1).toEqual(['movie:42']);
    });
});
