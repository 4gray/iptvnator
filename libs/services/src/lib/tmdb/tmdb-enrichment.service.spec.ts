import { Injector, runInInjectionContext } from '@angular/core';
import { TmdbApiError, TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
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
        // The id resolves, but to a film that is not ours
        getMovieDetails
            .mockResolvedValueOnce(unrelated)
            .mockResolvedValueOnce(matrix);
        resolveBySearch.mockResolvedValue(603);
        const service = createService();

        const details = await service.enrichMovie({
            tmdbId: 999,
            title: 'The Matrix',
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
        });

        expect(details?.id).toBe(999);
        expect(rememberBadProviderId).not.toHaveBeenCalled();
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
