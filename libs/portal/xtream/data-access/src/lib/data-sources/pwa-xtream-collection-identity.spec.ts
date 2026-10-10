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
    afterEach(() => localStorage.clear());

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
                      : ['movie:42', 77, 'series:99'];
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
