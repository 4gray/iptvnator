import { TmdbApiClient } from './tmdb-api-client';
import { TmdbIdResolver } from './tmdb-id-resolver';
import { TmdbMemoryCache } from './tmdb-memory-cache';
import { TmdbMetadataClient } from './tmdb-metadata-client';

function fixture() {
    const runtime = {
        isEnabled: jest.fn(() => true),
        apiKey: () => 'fixture-key',
        language: () => 'en-US',
        appLanguage: () => 'en',
    };
    const api = new TmdbApiClient();
    const cache = new TmdbMemoryCache();
    const resolver = new TmdbIdResolver(runtime, api, cache);
    const search = jest.spyOn(resolver, 'resolveBySearch');
    const report = jest.fn();
    const client = new TmdbMetadataClient(
        runtime,
        api,
        cache,
        resolver,
        report
    );
    return { runtime, client, search, report };
}

afterEach(() => jest.restoreAllMocks());

describe.each(['movie', 'tv'] as const)(
    'explicit %s metadata lookup',
    (mediaType) => {
        it('uses the chosen ID, localization and details cache without title search', async () => {
            const { client, runtime, search } = fixture();
            const payload = {
                id: 900001,
                title: 'Synthetic Movie Alpha',
                name: 'Synthetic Series Alpha',
                original_language: 'en',
                overview: 'Synthetic description',
                release_dates: { results: [] },
                content_ratings: { results: [] },
            };
            const fetch = jest
                .spyOn(globalThis, 'fetch')
                .mockResolvedValue(Response.json(payload));
            expect(
                await client.getDetailsForMatch(mediaType, 900001)
            ).toMatchObject(payload);
            expect(
                await client.getDetailsForMatch(mediaType, 900001)
            ).toMatchObject(payload);
            expect(fetch).toHaveBeenCalledTimes(1);
            const url = new URL(String(fetch.mock.calls[0][0]));
            expect(url.pathname).toBe(`/3/${mediaType}/900001`);
            expect(url.searchParams.get('language')).toBe('en-US');
            expect(search).not.toHaveBeenCalled();
            runtime.isEnabled.mockReturnValue(false);
            expect(
                await client.getDetailsForMatch(mediaType, 900001)
            ).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
            'rejects invalid ID %s without a network request',
            async (id) => {
                const { client, search } = fixture();
                const fetch = jest.spyOn(globalThis, 'fetch');
                expect(
                    await client.getDetailsForMatch(mediaType, id)
                ).toBeNull();
                expect(fetch).not.toHaveBeenCalled();
                expect(search).not.toHaveBeenCalled();
            }
        );

        it('reports an unavailable selection without exposing the underlying error or guessing another match', async () => {
            const { client, search, report } = fixture();
            jest.spyOn(globalThis, 'fetch').mockRejectedValue(
                new Error('synthetic private failure detail')
            );
            expect(
                await client.getDetailsForMatch(mediaType, 900001)
            ).toBeNull();
            expect(search).not.toHaveBeenCalled();
            expect(report).toHaveBeenCalledWith(
                `TMDB ${mediaType} manual match unavailable.`
            );
        });
    }
);
