import { TmdbApiClient } from './tmdb-api-client';
import { TmdbIdResolver } from './tmdb-id-resolver';
import { TmdbMemoryCache } from './tmdb-memory-cache';
import { TmdbMetadataClient } from './tmdb-metadata-client';
import { buildDetailsLookupKey } from './tmdb-matcher';
import type { TmdbMovieDetails, TmdbTvDetails } from './tmdb.types';

const runtime = {
    isEnabled: () => true,
    apiKey: () => 'key',
    language: () => 'en-US',
    appLanguage: () => 'en',
};
const legacy = {
    id: 1,
    title: 'Northstar Harbor',
    original_language: 'en',
    overview: 'Cached plot',
};
function setup() {
    const cache = new TmdbMemoryCache();
    const api = new TmdbApiClient();
    const client = new TmdbMetadataClient(
        runtime,
        api,
        cache,
        new TmdbIdResolver(runtime, api, cache)
    );
    const seed = (payload: object) =>
        cache.set({
            mediaType: 'movie',
            lookupKey: buildDetailsLookupKey(1),
            language: 'en-US',
            tmdbId: 1,
            payload: JSON.stringify(payload),
        });
    const open = () => client.enrichMovie({ tmdbId: 1, title: legacy.title });
    return { cache, api, seed, open };
}

afterEach(() => jest.restoreAllMocks());

it('adds movie and TV certifications to the existing details calls', async () => {
    const append: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        append.push(
            new URL(String(input)).searchParams.get('append_to_response') ?? ''
        );
        return Response.json({ id: 1 });
    });
    const api = new TmdbApiClient();
    await api.getMovieDetails(1, 'de-DE', 'key');
    await api.getTvDetails(1, 'de-DE', 'key');
    expect(append).toEqual([
        'credits,videos,recommendations,release_dates',
        'credits,aggregate_credits,videos,recommendations,content_ratings',
    ]);
});

it('upgrades a fresh legacy entry once under its existing key', async () => {
    const { seed, api, cache, open } = setup();
    await seed(legacy);
    const updated: TmdbMovieDetails = {
        ...legacy,
        release_dates: { results: [] },
    };
    const request = jest
        .spyOn(api, 'getMovieDetails')
        .mockResolvedValue(updated);
    expect(await open()).toEqual(updated);
    expect(await open()).toEqual(updated);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
        JSON.parse(
            (await cache.get('movie', buildDetailsLookupKey(1), 'en-US'))
                ?.payload ?? 'null'
        )
    ).toEqual(updated);
});

it.each([{ results: [] }, { status_code: 34 }])(
    'reuses an attempted classification response %p',
    async (release_dates) => {
        const { seed, api, open } = setup();
        const current = { ...legacy, release_dates };
        await seed(current);
        const request = jest.spyOn(api, 'getMovieDetails');
        expect(await open()).toEqual(current);
        expect(request).not.toHaveBeenCalled();
    }
);

it('keeps fresh legacy metadata when the classification upgrade fails', async () => {
    const { seed, api, cache, open } = setup();
    await seed(legacy);
    const before = await cache.get('movie', buildDetailsLookupKey(1), 'en-US');
    jest.spyOn(api, 'getMovieDetails').mockRejectedValue(new Error('offline'));
    expect(await open()).toEqual(legacy);
    expect(await cache.get('movie', buildDetailsLookupKey(1), 'en-US')).toEqual(
        before
    );
});

it('waits five minutes before retrying a failed legacy classification upgrade', async () => {
    const startedAt = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
    const { seed, api, cache, open } = setup();
    await seed(legacy);
    const before = await cache.get('movie', buildDetailsLookupKey(1), 'en-US');
    const request = jest
        .spyOn(api, 'getMovieDetails')
        .mockRejectedValue(new Error('offline'));

    expect(await open()).toEqual(legacy);
    expect(await open()).toEqual(legacy);
    expect(request).toHaveBeenCalledTimes(1);
    now.mockReturnValue(startedAt + 5 * 60 * 1000 - 1);
    expect(await open()).toEqual(legacy);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await cache.get('movie', buildDetailsLookupKey(1), 'en-US')).toEqual(
        before
    );

    now.mockReturnValue(startedAt + 5 * 60 * 1000);
    const updated = { ...legacy, release_dates: { results: [] } };
    request.mockResolvedValue(updated);
    expect(await open()).toEqual(updated);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await open()).toEqual(updated);
    expect(request).toHaveBeenCalledTimes(2);
});

it('does not reuse legacy metadata that expires during the retry cooldown', async () => {
    const { seed, api, cache, open } = setup();
    await seed(legacy);
    const request = jest
        .spyOn(api, 'getMovieDetails')
        .mockRejectedValue(new Error('offline'));
    expect(await open()).toEqual(legacy);
    jest.spyOn(cache, 'isFresh').mockReturnValue(false);
    expect(await open()).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
});

it('never presents expired legacy metadata as a successful refresh', async () => {
    const { seed, api, cache, open } = setup();
    await seed(legacy);
    jest.spyOn(cache, 'isFresh').mockReturnValue(false);
    jest.spyOn(api, 'getMovieDetails').mockRejectedValue(new Error('offline'));
    expect(await open()).toBeNull();
});

it('upgrades TV payloads using content_ratings rather than release_dates', async () => {
    const cache = new TmdbMemoryCache();
    const api = new TmdbApiClient();
    const client = new TmdbMetadataClient(
        runtime,
        api,
        cache,
        new TmdbIdResolver(runtime, api, cache)
    );
    const old = { id: 1, name: 'Northstar Harbor', original_language: 'en' };
    await cache.set({
        mediaType: 'tv',
        lookupKey: buildDetailsLookupKey(1),
        language: 'en-US',
        tmdbId: 1,
        payload: JSON.stringify(old),
    });
    const current: TmdbTvDetails = {
        ...old,
        content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    };
    const request = jest.spyOn(api, 'getTvDetails').mockResolvedValue(current);
    expect(await client.enrichTv({ tmdbId: 1, title: old.name })).toEqual(
        current
    );
    expect(await client.enrichTv({ tmdbId: 1, title: old.name })).toEqual(
        current
    );
    expect(request).toHaveBeenCalledTimes(1);
});
