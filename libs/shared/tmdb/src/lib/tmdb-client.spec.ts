import { TmdbApiClient } from './tmdb-api-client';
import { TmdbIdResolver } from './tmdb-id-resolver';
import { TmdbMemoryCache } from './tmdb-memory-cache';
import { TmdbMetadataClient } from './tmdb-metadata-client';

const movie = {
    id: 603,
    title: 'The Matrix',
    release_date: '1999-03-30',
    overview: 'Overview',
    original_language: 'en',
};
const runtime = {
    isEnabled: () => true,
    apiKey: () => 'test-key',
    language: () => 'en-US',
    appLanguage: () => 'en',
};
function client(signal?: AbortSignal) {
    const api = new TmdbApiClient(signal);
    const cache = new TmdbMemoryCache();
    return new TmdbMetadataClient(
        runtime,
        api,
        cache,
        new TmdbIdResolver(runtime, api, cache)
    );
}
afterEach(() => jest.restoreAllMocks());

it('retries an English provider title in English when localized and original names cannot corroborate it', async () => {
    const requests: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input));
        requests.push(`${url.pathname}:${url.searchParams.get('language')}`);
        if (url.pathname.includes('/search/'))
            return Response.json({
                results: [
                    {
                        id: 127865,
                        name:
                            url.searchParams.get('language') === 'en-US'
                                ? 'The Chestnut Man'
                                : 'Каштановый человечек',
                        original_name: 'Kastanjemanden',
                        first_air_date: '2021-09-29',
                    },
                ],
            });
        return Response.json({
            id: 127865,
            name: 'Каштановый человечек',
            overview: 'Russian plot',
            original_language: 'ru',
        });
    });
    const api = new TmdbApiClient();
    const cache = new TmdbMemoryCache();
    const russian = {
        ...runtime,
        appLanguage: () => 'ru',
        language: () => 'ru-RU',
    };
    const metadata = new TmdbMetadataClient(
        russian,
        api,
        cache,
        new TmdbIdResolver(russian, api, cache)
    );
    expect(
        (await metadata.enrichTv({ title: 'The Chestnut Man s02', year: 2026 }))
            ?.id
    ).toBe(127865);
    expect(requests).toEqual([
        '/3/search/tv:ru-RU',
        '/3/search/tv:en-US',
        '/3/tv/127865:ru-RU',
    ]);
    await metadata.enrichTv({ title: 'The Chestnut Man s02', year: 2026 });
    expect(requests).toHaveLength(3);
});

it('recovers dead provider IDs, caches confident searches and reuses detail metadata', async () => {
    const requests: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input));
        requests.push(url.pathname);
        if (url.pathname === '/3/movie/999')
            return new Response('', { status: 404 });
        return Response.json(
            url.pathname.includes('/search/') ? { results: [movie] } : movie
        );
    });
    const metadata = client();
    const query = { tmdbId: 999, title: 'The Matrix (1999)', year: 1999 };
    expect(await metadata.enrichMovie(query)).toEqual(movie);
    expect(await metadata.enrichMovie(query)).toEqual(movie);
    expect(requests).toEqual([
        '/3/movie/999',
        '/3/search/movie',
        '/3/movie/603',
    ]);
});
it('does not replace a provider ID after an authentication or rate-limit failure', async () => {
    const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('', { status: 429 }));
    expect(
        await client().enrichMovie({
            tmdbId: 603,
            title: 'The Matrix',
            year: 1999,
        })
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
});
it('sends v3 keys and v4 read tokens through their documented authentication channels', async () => {
    const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => Response.json({}));
    const api = new TmdbApiClient();
    expect(await api.validateApiKey('v3-key')).toBe(true);
    const first = fetch.mock.calls[0];
    expect(new URL(String(first[0])).searchParams.get('api_key')).toBe(
        'v3-key'
    );
    expect(first[1]?.headers).not.toHaveProperty('authorization');
    expect(await api.validateApiKey('eyJ.fake-read-token')).toBe(true);
    const second = fetch.mock.calls[1];
    expect(new URL(String(second[0])).searchParams.has('api_key')).toBe(false);
    expect(second[1]?.headers).toHaveProperty(
        'authorization',
        'Bearer eyJ.fake-read-token'
    );
});
it('passes caller cancellation to fetch and does not launch follow-up searches after abort', async () => {
    const abort = new AbortController();
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(
        (_input, init) =>
            new Promise((_resolve, reject) => {
                expect(init?.signal).toBe(abort.signal);
                init?.signal?.addEventListener('abort', () =>
                    reject(new Error('aborted'))
                );
                abort.abort();
            })
    );
    expect(
        await client(abort.signal).enrichMovie({
            tmdbId: 603,
            title: 'The Matrix',
        })
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps a bounded LRU cache with language/type separation and expiry', async () => {
    const cache = new TmdbMemoryCache(2);
    const entry = {
        mediaType: 'movie' as const,
        lookupKey: 'id:1',
        language: 'en-US',
        tmdbId: 1,
        payload: '{}',
    };
    await cache.set(entry);
    await cache.set({ ...entry, language: 'de-DE' });
    expect(cache.isFresh(await cache.get('movie', 'id:1', 'en-US'), 1000)).toBe(
        true
    );
    await cache.set({ ...entry, mediaType: 'tv' });
    expect(await cache.get('movie', 'id:1', 'de-DE')).toBeNull();
    expect(await cache.get('tv', 'id:1', 'en-US')).not.toBeNull();
    expect(cache.isFresh({ ...entry, fetchedAt: '2000-01-01' }, 1000)).toBe(
        false
    );
});
