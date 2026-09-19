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
 * cached the miss for a week ("Фейк (10 серий)", "Волшебный участок").
 */
describe('TmdbIdResolverService.resolveBySearch', () => {
    const fake2026: TmdbSearchResult = {
        id: 317869,
        name: 'Фейк',
        original_name: 'Фейк',
        first_air_date: '2026-07-16',
        vote_count: 3,
    };
    const fake2024: TmdbSearchResult = {
        id: 322696,
        name: 'Фейк',
        original_name: 'Фейк',
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
            query === 'Фейк' ? [fake2026, fake2024] : []
        );
        searchMovie = jest.fn().mockResolvedValue([]);
        cacheGet = jest.fn().mockResolvedValue(null);
        cacheSet = jest.fn().mockResolvedValue(undefined);
    });

    it('sends the provider spelling to TMDB and matches on the folded key', async () => {
        const service = createService();

        const id = await service.resolveBySearch('tv', {
            title: 'Фейк (10 серий)',
            year: 2026,
        });

        expect(id).toBe(317869);
        expect(searchTv).toHaveBeenCalledTimes(1);
        expect(searchTv).toHaveBeenCalledWith('Фейк', null, 'ru-RU', 'key');
        expect(cacheSet).toHaveBeenCalledWith({
            mediaType: 'tv',
            lookupKey: 'title:фейк|year:2026|v3',
            language: 'ru-RU',
            tmdbId: 317869,
            payload: null,
        });
    });

    it('caches the miss under the folded v3 key', async () => {
        searchTv.mockResolvedValue([]);
        const service = createService();

        const id = await service.resolveBySearch('tv', {
            title: 'Молодой Шерлок',
            year: 2026,
        });

        expect(id).toBeNull();
        expect(searchTv).toHaveBeenCalledWith(
            'Молодой Шерлок',
            null,
            'ru-RU',
            'key'
        );
        expect(cacheSet).toHaveBeenCalledWith(
            expect.objectContaining({
                lookupKey: 'title:молодой шерлок|year:2026|v3',
                tmdbId: null,
            })
        );
    });

    it('reads the cache before searching', async () => {
        cacheGet.mockResolvedValue({ tmdbId: 317869 });
        const service = createService();
        const cacheService = (service as unknown as { cache: TmdbCacheService })
            .cache;
        jest.spyOn(cacheService, 'isFresh').mockReturnValue(true);

        const id = await service.resolveBySearch('tv', {
            title: 'Фейк (10 серий)',
            year: 2026,
        });

        expect(id).toBe(317869);
        expect(cacheGet).toHaveBeenCalledWith(
            'tv',
            'title:фейк|year:2026|v3',
            'ru-RU'
        );
        expect(searchTv).not.toHaveBeenCalled();
    });

    it('searches a display spelling that a misspelled original title folds onto', async () => {
        const service = createService();

        const id = await service.resolveBySearch('tv', {
            title: 'Фейк',
            originalTitle: 'Феик',
            year: 2026,
        });

        expect(id).toBe(317869);
        expect(searchTv.mock.calls.map(([query]) => query)).toEqual([
            'Феик',
            'Фейк',
        ]);
        // Each attempted variant records its own verdict
        expect(
            cacheSet.mock.calls.map(([row]) => [row.lookupKey, row.tmdbId])
        ).toEqual([
            ['title:феик|year:2026|v3', null],
            ['title:фейк|year:2026|v3', 317869],
        ]);
    });

    it("does not let one variant's cached verdict answer for another", async () => {
        // Item A (original "Феик", display "Феик") cached a miss under
        // "феик". Item B shares the original title but displays "Фейк":
        // the cached miss must not suppress B's own second variant.
        cacheGet.mockImplementation(async (_type: string, key: string) =>
            key === 'title:феик|year:2026|v3' ? { tmdbId: null } : null
        );
        const service = createService();
        const cacheService = (service as unknown as { cache: TmdbCacheService })
            .cache;
        jest.spyOn(cacheService, 'isFresh').mockImplementation(
            (row) => row !== null && row !== undefined
        );

        const id = await service.resolveBySearch('tv', {
            title: 'Фейк',
            originalTitle: 'Феик',
            year: 2026,
        });

        expect(id).toBe(317869);
        expect(searchTv).toHaveBeenCalledTimes(1);
        expect(searchTv).toHaveBeenCalledWith('Фейк', null, 'ru-RU', 'key');
        expect(cacheGet.mock.calls.map(([, key]) => key)).toEqual([
            'title:феик|year:2026|v3',
            'title:фейк|year:2026|v3',
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
