import { Injector, runInInjectionContext } from '@angular/core';
import { TmdbMemoryCache } from '@iptvnator/shared/tmdb';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbDiscoverService } from './tmdb-discover.service';
import { TmdbEnrichmentService } from './tmdb-enrichment.service';
import { TmdbIdResolverService } from './tmdb-id-resolver.service';
import { TmdbMatchService, type TmdbMatchIdentity } from './tmdb-match.service';
import { TmdbPersonService } from './tmdb-person.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSeasonService } from './tmdb-season.service';
import { TmdbTrendingService } from './tmdb-trending.service';

function fixture(onResolveMatches = () => undefined) {
    const runtime = {
        isEnabled: jest.fn(() => true),
        apiKey: () => 'fixture-key',
        language: () => 'en-US',
        appLanguage: () => 'en',
    };
    const api = {
        getMovieDetails: jest.fn().mockResolvedValue({
            id: 900001,
            title: 'Synthetic Movie Alpha',
            release_dates: { results: [] },
        }),
        getTvDetails: jest.fn().mockResolvedValue({
            id: 900001,
            name: 'Synthetic Series Alpha',
            content_ratings: { results: [] },
        }),
    };
    const resolver = {
        resolveBySearch: jest.fn().mockResolvedValue(900001),
        isKnownBadProviderId: jest.fn().mockResolvedValue(false),
    };
    const matches = new TmdbMatchService();
    const injector = Injector.create({
        providers: [
            { provide: TmdbRuntimeService, useValue: runtime },
            { provide: TmdbApiService, useValue: api },
            { provide: TmdbCacheService, useValue: new TmdbMemoryCache() },
            { provide: TmdbIdResolverService, useValue: resolver },
            {
                provide: TmdbMatchService,
                useFactory: () => {
                    onResolveMatches();
                    return matches;
                },
            },
            ...[
                TmdbPersonService,
                TmdbSeasonService,
                TmdbTrendingService,
                TmdbDiscoverService,
            ].map((provide) => ({ provide, useValue: {} })),
        ],
    });
    return {
        runtime,
        api,
        resolver,
        injector,
        matches,
        service: runInInjectionContext(
            injector,
            () => new TmdbEnrichmentService()
        ),
    };
}

afterEach(() => localStorage.clear());

it('leaves item-choice storage unconstructed for ordinary automatic enrichment', async () => {
    const resolved = jest.fn();
    const { service, matches, runtime } = fixture(resolved);
    await service.enrichMovie({ title: 'Synthetic Movie Alpha' });
    await service.enrichTv({ title: 'Synthetic Series Alpha' });
    expect(resolved).not.toHaveBeenCalled();
    runtime.isEnabled.mockReturnValue(false);
    await service.enrichMovie({
        title: 'Synthetic Movie Alpha',
        matchIdentity: {
            provider: 'xtream',
            playlistId: 'source',
            mediaType: 'movie',
            itemId: '42',
        },
    });
    expect(resolved).not.toHaveBeenCalled();
    expect(await service.getMatches()).toBe(matches);
    expect(resolved).toHaveBeenCalledTimes(1);
});

it('keeps provider data when choice storage cannot load', async () => {
    const { service, injector, api, resolver } = fixture();
    jest.spyOn(injector, 'get').mockImplementation(() => {
        throw new Error('Synthetic unavailable choice module');
    });
    const matchIdentity: TmdbMatchIdentity = {
        provider: 'xtream',
        playlistId: 'source',
        mediaType: 'movie',
        itemId: '42',
    };
    expect(await service.getMatches()).toBeNull();
    expect(
        await service.enrichMovie({
            title: 'Synthetic Movie Alpha',
            matchIdentity,
        })
    ).toBeNull();
    expect(
        await service.enrichTv({
            title: 'Synthetic Series Alpha',
            matchIdentity: { ...matchIdentity, mediaType: 'tv' },
        })
    ).toBeNull();
    expect(api.getMovieDetails).not.toHaveBeenCalled();
    expect(api.getTvDetails).not.toHaveBeenCalled();
    expect(resolver.resolveBySearch).not.toHaveBeenCalled();
});

describe.each(['movie', 'tv'] as const)('saved %s selection', (mediaType) => {
    const identity: TmdbMatchIdentity = {
        provider: 'xtream',
        playlistId: 'synthetic-source',
        mediaType,
        itemId: '42',
    };

    it('uses an explicit ID despite conflicting provider metadata and resets to automatic lookup', async () => {
        const { service, api, matches, resolver, runtime } = fixture();
        const query = {
            title: 'Synthetic Conflicting Provider Title',
            year: 2080,
            matchIdentity: identity,
        };
        const enrich = () =>
            mediaType === 'movie'
                ? service.enrichMovie(query)
                : service.enrichTv(query);
        const details =
            mediaType === 'movie' ? api.getMovieDetails : api.getTvDetails;
        await matches.save(identity, {
            mode: 'manual',
            tmdbId: 900001,
            title: 'Synthetic Selection',
        });
        expect((await enrich())?.id).toBe(900001);
        expect(details).toHaveBeenCalledWith(900001, 'en-US', 'fixture-key');
        expect(resolver.resolveBySearch).not.toHaveBeenCalled();
        await matches.save(identity, { mode: 'provider' });
        details.mockClear();
        expect(await enrich()).toBeNull();
        expect(details).not.toHaveBeenCalled();
        await matches.save(identity, null);
        expect((await enrich())?.id).toBe(900001);
        expect(resolver.resolveBySearch).toHaveBeenCalledWith(mediaType, query);
        runtime.isEnabled.mockReturnValue(false);
        expect(await enrich()).toBeNull();
    });

    it('keeps the saved choice after a transient detail failure and retries it later', async () => {
        const { service, api, matches, resolver } = fixture();
        const details =
            mediaType === 'movie' ? api.getMovieDetails : api.getTvDetails;
        const query = {
            title: 'Synthetic Provider Title',
            matchIdentity: identity,
        };
        const enrich = () =>
            mediaType === 'movie'
                ? service.enrichMovie(query)
                : service.enrichTv(query);
        const choice = {
            mode: 'manual' as const,
            tmdbId: 900001,
            title: 'Synthetic Selection',
        };
        await matches.save(identity, choice);
        details.mockRejectedValueOnce(new Error('offline'));
        expect(await enrich()).toBeNull();
        expect(matches.read(identity)).toEqual(choice);
        expect(resolver.resolveBySearch).not.toHaveBeenCalled();
        expect((await enrich())?.id).toBe(900001);
        expect(resolver.resolveBySearch).not.toHaveBeenCalled();
    });
});
