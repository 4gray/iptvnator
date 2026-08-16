import { Injector, runInInjectionContext } from '@angular/core';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbDiscoverService } from './tmdb-discover.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbDiscoverResponse } from './tmdb.types';

describe('TmdbDiscoverService', () => {
    let discoverTitles: jest.Mock;
    let isEnabled: boolean;

    function page(
        start: number,
        count: number,
        totalPages: number
    ): TmdbDiscoverResponse {
        return {
            total_pages: totalPages,
            results: Array.from({ length: count }, (_, index) => ({
                id: start + index,
                title: `Movie ${start + index}`,
                release_date: '1990-06-01',
                poster_path: null,
            })),
        };
    }

    // The services Jest target has no @angular/core/testing — build the
    // service in a plain injection context instead of TestBed.
    function createService(): TmdbDiscoverService {
        const injector = Injector.create({
            providers: [
                {
                    provide: TmdbRuntimeService,
                    useValue: {
                        isEnabled: () => isEnabled,
                        apiKey: () => 'key',
                        language: () => 'en-US',
                        appLanguage: () => 'en',
                    },
                },
                { provide: TmdbApiService, useValue: { discoverTitles } },
            ],
        });
        return runInInjectionContext(
            injector,
            () => new TmdbDiscoverService()
        );
    }

    beforeEach(() => {
        isEnabled = true;
        discoverTitles = jest
            .fn()
            .mockImplementation((_type, _filters, pageNumber: number) =>
                Promise.resolve(page(pageNumber * 100, 20, 2))
            );
    });

    it('returns null without a request when enrichment is disabled', async () => {
        isEnabled = false;
        const service = createService();

        expect(await service.discoverTitles('movie', { year: 1990 })).toBeNull();
        expect(discoverTitles).not.toHaveBeenCalled();
    });

    it('fetches all pages up to total_pages', async () => {
        const service = createService();

        const titles = await service.discoverTitles('movie', { year: 1990 });

        expect(discoverTitles).toHaveBeenCalledTimes(2);
        expect(discoverTitles).toHaveBeenNthCalledWith(
            1,
            'movie',
            { year: 1990 },
            1,
            'en-US',
            'key'
        );
        expect(discoverTitles).toHaveBeenNthCalledWith(
            2,
            'movie',
            { year: 1990 },
            2,
            'en-US',
            'key'
        );
        expect(titles).toHaveLength(40);
        expect(titles?.[0]).toEqual({
            tmdbId: 100,
            mediaType: 'movie',
            title: 'Movie 100',
            originalTitle: null,
            year: 1990,
            posterUrl: null,
        });
    });

    it('caps the page fan-out at five pages', async () => {
        discoverTitles.mockImplementation((_t, _f, pageNumber: number) =>
            Promise.resolve(page(pageNumber * 100, 20, 500))
        );
        const service = createService();

        await service.discoverTitles('movie', { genreId: 18 });

        expect(discoverTitles).toHaveBeenCalledTimes(5);
    });

    it('serves repeated facet lookups from the session cache', async () => {
        const service = createService();

        const first = await service.discoverTitles('movie', { year: 1990 });
        const second = await service.discoverTitles('movie', { year: 1990 });

        expect(discoverTitles).toHaveBeenCalledTimes(2);
        expect(second).toBe(first);
    });

    it('keys the cache by media type and facets', async () => {
        const service = createService();

        await service.discoverTitles('movie', { year: 1990 });
        await service.discoverTitles('tv', { year: 1990 });
        await service.discoverTitles('movie', { year: 1991 });

        expect(discoverTitles).toHaveBeenCalledTimes(6);
    });

    it('returns null on failure and does not cache the error', async () => {
        discoverTitles.mockRejectedValue(new Error('offline'));
        const service = createService();

        expect(
            await service.discoverTitles('movie', { countryCode: 'US' })
        ).toBeNull();

        discoverTitles.mockImplementation((_t, _f, pageNumber: number) =>
            Promise.resolve(page(pageNumber * 100, 20, 1))
        );
        const retried = await service.discoverTitles('movie', {
            countryCode: 'US',
        });
        expect(retried).toHaveLength(20);
    });

    it('deduplicates titles repeated across pages', async () => {
        // Both pages return the same ids — popularity shifted mid-fetch
        discoverTitles.mockImplementation(() =>
            Promise.resolve(page(100, 20, 2))
        );
        const service = createService();

        const titles = await service.discoverTitles('movie', { year: 1990 });

        expect(titles).toHaveLength(20);
    });
});
