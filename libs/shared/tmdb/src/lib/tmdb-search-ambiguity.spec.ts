import { TmdbApiClient } from './tmdb-api-client';
import { TmdbIdResolver } from './tmdb-id-resolver';
import { TmdbMemoryCache } from './tmdb-memory-cache';
import { TmdbMetadataClient } from './tmdb-metadata-client';

afterEach(() => jest.restoreAllMocks());

it('ignores a fresh v4 wrong match, caches the ambiguous verdict and never fetches its details', async () => {
    const runtime = {
        isEnabled: () => true,
        apiKey: () => 'test-key',
        language: () => 'ru-RU',
        appLanguage: () => 'ru',
    };
    const api = new TmdbApiClient();
    const cache = new TmdbMemoryCache();
    await cache.set({
        mediaType: 'tv',
        lookupKey: 'title:красота|year:2026|v4',
        language: 'ru-RU',
        tmdbId: 273160,
        payload: null,
    });
    const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
            if (!new URL(String(input)).pathname.includes('/search/')) {
                return Response.json({
                    id: 273160,
                    name: 'Красота',
                    original_name: 'The Beauty',
                    original_language: 'en',
                    overview: 'American series overview',
                    content_ratings: { results: [] },
                });
            }
            return Response.json({
                results: [
                    {
                        id: 318158,
                        name: 'Красота',
                        original_name: 'Красота',
                        first_air_date: '2026-10-30',
                        vote_count: 0,
                    },
                    {
                        id: 273160,
                        name: 'Красота',
                        original_name: 'The Beauty',
                        first_air_date: '2026-01-21',
                        vote_count: 1000,
                    },
                ],
            });
        });
    const metadata = new TmdbMetadataClient(
        runtime,
        api,
        cache,
        new TmdbIdResolver(runtime, api, cache)
    );
    const query = { title: 'Красота (8 серий)', year: 2026 };
    expect(await metadata.enrichTv(query)).toBeNull();
    expect(await metadata.enrichTv(query)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/3/search/tv');
    expect(url.searchParams.get('query')).toBe('Красота');
    expect(url.searchParams.get('language')).toBe('ru-RU');
    expect(
        await cache.get('tv', 'title:красота|year:2026|v5', 'ru-RU')
    ).toMatchObject({ tmdbId: null });
});
