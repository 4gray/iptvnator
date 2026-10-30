import { TmdbApiClient } from './tmdb-api-client';
import { TmdbMemoryCache } from './tmdb-memory-cache';
import { TmdbSeasonClient } from './tmdb-season-client';
import { isGenericEpisodeTitle } from './tmdb-episode-title';
import { buildDetailsLookupKey } from './tmdb-matcher';
const runtime = {
    isEnabled: () => true,
    apiKey: () => 'fixture',
    language: () => 'ru-RU',
    appLanguage: () => 'ru',
};
afterEach(() => jest.restoreAllMocks());

it('shares language-scoped season cache and fills missing text in the original show language', async () => {
    const cache = new TmdbMemoryCache();
    await cache.set({
        mediaType: 'tv',
        lookupKey: buildDetailsLookupKey(7),
        language: 'ru-RU',
        tmdbId: 7,
        payload: JSON.stringify({ original_language: 'en' }),
    });
    const requests: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input));
        requests.push(url.searchParams.get('language')!);
        return Response.json({
            episodes: [
                {
                    episode_number: 1,
                    name:
                        url.searchParams.get('language') === 'en'
                            ? 'Pilot'
                            : '',
                    overview:
                        url.searchParams.get('language') === 'en'
                            ? 'Original plot'
                            : '',
                    still_path: '/primary.jpg',
                },
            ],
        });
    });
    const client = new TmdbSeasonClient(runtime, new TmdbApiClient(), cache);
    const result = await client.getSeason(7, 2);
    expect(result?.episodes?.[0]).toMatchObject({
        name: 'Pilot',
        overview: 'Original plot',
        still_path: '/primary.jpg',
    });
    expect(await client.getSeason(7, 2)).toEqual(result);
    expect(requests).toEqual(['ru-RU', 'en']);
});

it('does not lose localized season artwork when original-language fallback fails', async () => {
    const cache = new TmdbMemoryCache();
    await cache.set({
        mediaType: 'tv',
        lookupKey: buildDetailsLookupKey(7),
        language: 'ru-RU',
        tmdbId: 7,
        payload: JSON.stringify({ original_language: 'en' }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
        new URL(String(input)).searchParams.get('language') === 'en'
            ? new Response('', { status: 503 })
            : Response.json({
                  poster_path: '/season.jpg',
                  episodes: [{ episode_number: 1, name: '' }],
              })
    );
    const report = jest.fn();
    const result = await new TmdbSeasonClient(
        runtime,
        new TmdbApiClient(),
        cache,
        report
    ).getSeason(7, 1);
    expect(result?.poster_path).toBe('/season.jpg');
    expect(report).toHaveBeenCalledWith('TMDB season enrichment failed.');
});

it('disabled seasons perform no requests; corrupt cache refetches and failed requests remain retryable', async () => {
    const cache = new TmdbMemoryCache();
    const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockImplementation(async () => Response.json({ episodes: [] }));
    const api = new TmdbApiClient();
    expect(
        await new TmdbSeasonClient(
            { ...runtime, isEnabled: () => false },
            api,
            cache
        ).getSeason(7, 1)
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await cache.set({
        mediaType: 'tv',
        lookupKey: 'id:7|season:1',
        language: 'ru-RU',
        tmdbId: 7,
        payload: 'invalid-json',
    });
    const client = new TmdbSeasonClient(runtime, api, cache);
    expect(await client.getSeason(7, 1)).toBeNull();
    expect(await client.getSeason(7, 1)).toEqual({ episodes: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(['Episode 1', 'Серия 2', 'Эпизод 3', 'S04E01', '1', ''])(
    'recognizes a generic episode placeholder %s',
    (title) => expect(isGenericEpisodeTitle(title)).toBe(true)
);
it('keeps meaningful episode titles', () =>
    expect(isGenericEpisodeTitle('The Pilot')).toBe(false));
