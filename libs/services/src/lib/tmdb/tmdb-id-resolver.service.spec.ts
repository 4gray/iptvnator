import { Injector, runInInjectionContext } from '@angular/core';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbIdResolverService } from './tmdb-id-resolver.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSearchResult } from './tmdb.types';

/**
 * Regression coverage for the search wire format. The comparison key folds
 * diacritics — Cyrillic "й" becomes "и" — and that key used to be sent as
 * the TMDB query, which matched nothing for any title carrying "й"/"ё" and
 * cached the miss for a week. The titles below are illustrative stand-ins
 * that fold the same way, not the ones the failures were observed on.
 */
describe('TmdbIdResolverService.resolveBySearch', () => {
    const series2026: TmdbSearchResult = {
        id: 101101,
        name: 'Лейка',
        original_name: 'Лейка',
        first_air_date: '2026-07-16',
        vote_count: 3,
    };
    const series2024: TmdbSearchResult = {
        id: 101102,
        name: 'Лейка',
        original_name: 'Лейка',
        first_air_date: '2024-12-05',
        vote_count: 0,
    };

    let searchTv: jest.Mock;
    let searchMovie: jest.Mock;
    let cacheGet: jest.Mock;
    let cacheSet: jest.Mock;

    // The services Jest target has no @angular/core/testing — build the
    // service in a plain injection context instead of TestBed.
    function createService(): TmdbIdResolverService {
        const injector = Injector.create({
            providers: [
                {
                    provide: TmdbRuntimeService,
                    useValue: {
                        apiKey: () => 'key',
                        appLanguage: () => 'en',
                    },
                },
                {
                    provide: TmdbApiService,
                    useValue: { searchTv, searchMovie },
                },
                {
                    provide: TmdbCacheService,
                    useValue: {
                        get: cacheGet,
                        set: cacheSet,
                        isFresh: () => false,
                    },
                },
            ],
        });
        return runInInjectionContext(
            injector,
            () => new TmdbIdResolverService()
        );
    }

    beforeEach(() => {
        searchTv = jest.fn(async (query: string) =>
            // TMDB does not fold Cyrillic: only the provider spelling hits
            query === 'Лейка' ? [series2026, series2024] : []
        );
        searchMovie = jest.fn().mockResolvedValue([]);
        cacheGet = jest.fn().mockResolvedValue(null);
        cacheSet = jest.fn().mockResolvedValue(undefined);
    });

    it('sends the provider spelling to TMDB and matches on the folded key', async () => {
        const service = createService();

        const id = await service.resolveBySearch('tv', {
            title: 'Лейка (10 серий)',
            year: 2026,
        });

        expect(id).toBe(101101);
        expect(searchTv).toHaveBeenCalledTimes(1);
        expect(searchTv).toHaveBeenCalledWith('Лейка', null, 'ru-RU', 'key');
        expect(cacheSet).toHaveBeenCalledWith({
            mediaType: 'tv',
            lookupKey: 'title:лейка|year:2026|v4',
            language: 'ru-RU',
            tmdbId: 101101,
            payload: null,
        });
    });

    it('caches the miss under the current key, not the folded one', async () => {
        searchTv.mockResolvedValue([]);
        const service = createService();

        const id = await service.resolveBySearch('tv', {
            title: 'Пробный Выпуск',
            year: 2026,
        });

        expect(id).toBeNull();
        expect(searchTv).toHaveBeenCalledWith(
            'Пробный Выпуск',
            null,
            'ru-RU',
            'key'
        );
        expect(cacheSet).toHaveBeenCalledWith(
            expect.objectContaining({
                lookupKey: 'title:пробный выпуск|year:2026|v4',
                tmdbId: null,
            })
        );
    });

    it('reads the cache before searching', async () => {
        cacheGet.mockResolvedValue({ tmdbId: 101101 });
        const service = createService();
        const cacheService = (service as unknown as { cache: TmdbCacheService })
            .cache;
        jest.spyOn(cacheService, 'isFresh').mockReturnValue(true);

        const id = await service.resolveBySearch('tv', {
            title: 'Лейка (10 серий)',
            year: 2026,
        });

        expect(id).toBe(101101);
        expect(cacheGet).toHaveBeenCalledWith(
            'tv',
            'title:лейка|year:2026|v4',
            'ru-RU'
        );
        expect(searchTv).not.toHaveBeenCalled();
    });

    it('searches a display spelling that a misspelled original title folds onto', async () => {
        const service = createService();

        const id = await service.resolveBySearch('tv', {
            title: 'Лейка',
            originalTitle: 'Леика',
            year: 2026,
        });

        expect(id).toBe(101101);
        expect(searchTv.mock.calls.map(([query]) => query)).toEqual([
            'Леика',
            'Лейка',
        ]);
        // Each attempted variant records its own verdict
        expect(
            cacheSet.mock.calls.map(([row]) => [row.lookupKey, row.tmdbId])
        ).toEqual([
            ['title:леика|year:2026|v4', null],
            ['title:лейка|year:2026|v4', 101101],
        ]);
    });

    it("does not let one variant's cached verdict answer for another", async () => {
        // Item A (original "Леика", display "Леика") cached a miss under
        // "леика". Item B shares the original title but displays "Лейка":
        // the cached miss must not suppress B's own second variant.
        cacheGet.mockImplementation(async (_type: string, key: string) =>
            key === 'title:леика|year:2026|v4' ? { tmdbId: null } : null
        );
        const service = createService();
        const cacheService = (service as unknown as { cache: TmdbCacheService })
            .cache;
        jest.spyOn(cacheService, 'isFresh').mockImplementation(
            (row) => row !== null && row !== undefined
        );

        const id = await service.resolveBySearch('tv', {
            title: 'Лейка',
            originalTitle: 'Леика',
            year: 2026,
        });

        expect(id).toBe(101101);
        expect(searchTv).toHaveBeenCalledTimes(1);
        expect(searchTv).toHaveBeenCalledWith('Лейка', null, 'ru-RU', 'key');
        expect(cacheGet.mock.calls.map(([, key]) => key)).toEqual([
            'title:леика|year:2026|v4',
            'title:лейка|year:2026|v4',
        ]);
    });

    it('tries the language-prefix-stripped fallback with its own spelling', async () => {
        searchMovie = jest.fn(async (query: string) =>
            query === 'Amélie'
                ? [
                      {
                          id: 194,
                          title: 'Amélie',
                          original_title: 'Le Fabuleux Destin d’Amélie Poulain',
                          release_date: '2001-04-25',
                      },
                  ]
                : []
        );
        const service = createService();

        const id = await service.resolveBySearch('movie', {
            title: 'FR Amélie',
            year: 2001,
        });

        expect(id).toBe(194);
        expect(searchMovie.mock.calls.map(([query]) => query)).toEqual([
            'FR Amélie',
            'Amélie',
        ]);
    });
});
