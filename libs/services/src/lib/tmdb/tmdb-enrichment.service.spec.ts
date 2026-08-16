import { Injector, runInInjectionContext } from '@angular/core';
import { TmdbApiError, TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbDiscoverService } from './tmdb-discover.service';
import { TmdbEnrichmentService } from './tmdb-enrichment.service';
import { TmdbIdResolverService } from './tmdb-id-resolver.service';
import { TmdbPersonService } from './tmdb-person.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSeasonService } from './tmdb-season.service';
import { TmdbTrendingService } from './tmdb-trending.service';
import { TmdbMovieDetails } from './tmdb.types';

/**
 * Regression coverage for provider-supplied `tmdb_id` handling. Panels
 * ship dead and stale ids; before this, a dead one short-circuited the
 * title search (leaving the item permanently unenriched) and a stale one
 * silently rendered another film's metadata.
 */
describe('TmdbEnrichmentService — provider tmdb_id handling', () => {
    const matrix: TmdbMovieDetails = {
        id: 603,
        title: 'The Matrix',
        original_title: 'The Matrix',
        overview: 'Plot',
        videos: { results: [{ key: 'k', site: 'YouTube', type: 'Trailer' }] },
    };
    const unrelated: TmdbMovieDetails = {
        id: 999,
        title: 'Completely Different Film',
        original_title: 'Completely Different Film',
        release_date: '1979-12-14',
        overview: 'Other plot',
        videos: { results: [{ key: 'x', site: 'YouTube', type: 'Trailer' }] },
    };

    let getMovieDetails: jest.Mock;
    let resolveBySearch: jest.Mock;
    let isKnownBadProviderId: jest.Mock;
    let rememberBadProviderId: jest.Mock;

    // The services Jest target has no @angular/core/testing — build the
    // service in a plain injection context instead of TestBed.
    function createService(): TmdbEnrichmentService {
        const injector = Injector.create({
            providers: [
                {
                    provide: TmdbRuntimeService,
                    useValue: {
                        isEnabled: () => true,
                        apiKey: () => 'key',
                        language: () => 'en-US',
                        appLanguage: () => 'en',
                    },
                },
                {
                    provide: TmdbApiService,
                    useValue: { getMovieDetails, getTvDetails: jest.fn() },
                },
                {
                    provide: TmdbCacheService,
                    useValue: {
                        get: jest.fn().mockResolvedValue(null),
                        set: jest.fn().mockResolvedValue(undefined),
                        isFresh: () => false,
                    },
                },
                {
                    provide: TmdbIdResolverService,
                    useValue: {
                        resolveBySearch,
                        isKnownBadProviderId,
                        rememberBadProviderId,
                    },
                },
                { provide: TmdbPersonService, useValue: {} },
                { provide: TmdbSeasonService, useValue: {} },
                { provide: TmdbTrendingService, useValue: {} },
                { provide: TmdbDiscoverService, useValue: {} },
            ],
        });
        return runInInjectionContext(
            injector,
            () => new TmdbEnrichmentService()
        );
    }

    beforeEach(() => {
        getMovieDetails = jest.fn().mockResolvedValue(matrix);
        resolveBySearch = jest.fn().mockResolvedValue(null);
        isKnownBadProviderId = jest.fn().mockResolvedValue(false);
        rememberBadProviderId = jest.fn().mockResolvedValue(undefined);
    });

    it('uses a valid provider id without searching at all', async () => {
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 603,
            title: 'The Matrix',
        });

        expect(details?.id).toBe(603);
        expect(getMovieDetails).toHaveBeenCalledTimes(1);
        expect(resolveBySearch).not.toHaveBeenCalled();
        expect(rememberBadProviderId).not.toHaveBeenCalled();
    });

    it('falls back to the title search when the provider id 404s', async () => {
        getMovieDetails
            .mockRejectedValueOnce(new TmdbApiError(404, 'Not Found'))
            .mockResolvedValueOnce(matrix);
        resolveBySearch.mockResolvedValue(603);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 123456789,
            title: 'The Matrix',
        });

        // Previously this returned null: the dead id skipped the search
        expect(details?.id).toBe(603);
        expect(resolveBySearch).toHaveBeenCalledTimes(1);
        expect(rememberBadProviderId).toHaveBeenCalledWith(
            'movie',
            123456789
        );
    });

    it('prefers a confident search match over a stale provider id', async () => {
        // The id resolves, but to a 1979 film while our item is from 1999
        getMovieDetails
            .mockResolvedValueOnce(unrelated)
            .mockResolvedValueOnce(matrix);
        resolveBySearch.mockResolvedValue(603);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 999,
            title: 'The Matrix',
            year: 1999,
        });

        expect(details?.id).toBe(603);
        // The id EXISTS — it is just wrong for this item. The bad-id row is
        // keyed by id alone and shared across playlists, so recording a
        // per-item mismatch would deny the direct lookup to every other
        // item that legitimately uses the same id.
        expect(rememberBadProviderId).not.toHaveBeenCalled();
    });

    it('does not blame the id for a transient failure', async () => {
        // Rate limit, bad key, 5xx or offline: the id may be perfectly
        // fine, so it must stay retryable rather than be disabled for days
        getMovieDetails.mockRejectedValue(new TmdbApiError(429, 'Too Many'));
        resolveBySearch.mockResolvedValue(null);
        const service = createService();

        await service.enrichMovie({ tmdbId: 603, title: 'The Matrix' });

        expect(rememberBadProviderId).not.toHaveBeenCalled();
    });

    it('does not search after a transient provider-id failure', async () => {
        // The search would hit the same outage, and a title match that
        // does come back is weaker evidence than the id we already have
        getMovieDetails.mockRejectedValue(new TmdbApiError(503, 'Down'));
        resolveBySearch.mockResolvedValue(603);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 603,
            title: 'The Matrix',
        });

        expect(details).toBeNull();
        expect(resolveBySearch).not.toHaveBeenCalled();
    });

    it('does not blame the id for a network error', async () => {
        getMovieDetails.mockRejectedValue(new Error('offline'));
        resolveBySearch.mockResolvedValue(null);
        const service = createService();

        await service.enrichMovie({ tmdbId: 603, title: 'The Matrix' });

        expect(rememberBadProviderId).not.toHaveBeenCalled();
    });

    it('keeps the provider payload when the title differs but the search finds nothing', async () => {
        // A localized provider title legitimately fails the name check —
        // TMDB returns titles in the REQUEST language. Never trade real
        // metadata for none on suspicion alone.
        getMovieDetails.mockResolvedValue(unrelated);
        resolveBySearch.mockResolvedValue(null);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 999,
            title: 'Ирония судьбы',
            year: 1979,
        });

        expect(details?.id).toBe(999);
        expect(rememberBadProviderId).not.toHaveBeenCalled();
    });

    it('never lets a name mismatch alone unseat a working provider id', async () => {
        // "IT - Chapter Two" normalizes to "chapter two" (the ALL-CAPS "IT"
        // reads as a language tag), so the correct payload fails the name
        // check. With no year to arbitrate, a search for "chapter two"
        // would confidently return the 1979 film of that name.
        getMovieDetails.mockResolvedValue({
            id: 474350,
            title: 'It Chapter Two',
            original_title: 'It Chapter Two',
            overview: 'Plot',
        });
        resolveBySearch.mockResolvedValue(30619);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 474350,
            title: 'IT - Chapter Two',
        });

        expect(details?.id).toBe(474350);
        expect(resolveBySearch).not.toHaveBeenCalled();
    });

    it('catches a stale id that shares the title but not the year', async () => {
        // The scraper case: "Blade Runner 2049" carrying the 1982 film's id.
        // Both titles normalize to "blade runner", so only the year sees it.
        getMovieDetails
            .mockResolvedValueOnce({
                id: 78,
                title: 'Blade Runner',
                release_date: '1982-06-25',
            })
            .mockResolvedValueOnce({
                id: 335984,
                title: 'Blade Runner 2049',
                release_date: '2017-10-04',
            });
        resolveBySearch.mockResolvedValue(335984);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 78,
            title: 'Blade Runner 2049',
            year: 2017,
        });

        expect(details?.id).toBe(335984);
    });

    it('keeps the provider payload when the competing search throws', async () => {
        // Same reasoning as above, but the search never returns a verdict:
        // TMDB is offline or rate-limiting. Details in hand beat nothing.
        getMovieDetails.mockResolvedValue(unrelated);
        resolveBySearch.mockRejectedValue(new TmdbApiError(503, 'Down'));
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 999,
            title: 'Ирония судьбы',
            year: 1999,
        });

        expect(details?.id).toBe(999);
    });

    it('skips a provider id already known to be bad', async () => {
        isKnownBadProviderId.mockResolvedValue(true);
        resolveBySearch.mockResolvedValue(603);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 123456789,
            title: 'The Matrix',
        });

        expect(details?.id).toBe(603);
        // One details call for the searched id — none for the dead one
        expect(getMovieDetails).toHaveBeenCalledTimes(1);
        expect(getMovieDetails).toHaveBeenCalledWith(603, 'en-US', 'key');
    });

    it('returns null when there is no provider id and no search match', async () => {
        const service = createService();

        await expect(
            service.enrichMovie({ title: 'Unknown Thing' })
        ).resolves.toBeNull();
        expect(getMovieDetails).not.toHaveBeenCalled();
    });
});
