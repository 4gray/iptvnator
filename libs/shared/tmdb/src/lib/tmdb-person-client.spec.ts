import { TmdbApiClient } from './tmdb-api-client';
import { TmdbMemoryCache } from './tmdb-memory-cache';
import { TmdbPersonClient } from './tmdb-person-client';
import { mapPersonFilmography } from './tmdb-person';
const runtime = {
    isEnabled: () => true,
    apiKey: () => 'fixture',
    language: () => 'ru-RU',
    appLanguage: () => 'ru',
};
afterEach(() => jest.restoreAllMocks());
it('fetches combined credits once per person/language and forwards cancellation', async () => {
    const abort = new AbortController();
    const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, options) => {
            expect(options?.signal).toBe(abort.signal);
            expect(
                new URL(String(input)).searchParams.get('append_to_response')
            ).toBe('combined_credits');
            return Response.json({ id: 10, name: 'Actor' });
        });
    const cache = new TmdbMemoryCache();
    const api = new TmdbApiClient(abort.signal);
    const person = new TmdbPersonClient(runtime, api, cache);
    expect(await person.getPersonDetails(10)).toMatchObject({ name: 'Actor' });
    await person.getPersonDetails(10);
    expect(fetch).toHaveBeenCalledTimes(1);
    await new TmdbPersonClient(
        { ...runtime, language: () => 'en-US' },
        api,
        cache
    ).getPersonDetails(10);
    expect(fetch).toHaveBeenCalledTimes(2);
});
it('disabled/invalid lookups make no request, and API failures are sanitized and retryable', async () => {
    const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockImplementation(async () => Response.json({ id: 10 }));
    const cache = new TmdbMemoryCache();
    const api = new TmdbApiClient();
    const report = jest.fn();
    const client = new TmdbPersonClient(runtime, api, cache, report);
    expect(await client.getPersonDetails(-1)).toBeNull();
    expect(
        await new TmdbPersonClient(
            { ...runtime, isEnabled: () => false },
            api,
            cache
        ).getPersonDetails(10)
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await client.getPersonDetails(10)).toBeNull();
    expect(report).toHaveBeenCalledWith('TMDB person enrichment failed.');
    expect(await client.getPersonDetails(10)).toMatchObject({ id: 10 });
});
it('TV can display all deduplicated acting/directing credits while Angular keeps its existing default limit', () => {
    const person = {
        id: 10,
        combined_credits: {
            cast: Array.from({ length: 100 }, (_, i) => ({
                id: i + 1,
                media_type: 'movie',
                title: `Film ${i + 1}`,
                original_title: `Original ${i + 1}`,
                release_date: '2020-01-01',
            })),
            crew: [
                {
                    id: 101,
                    media_type: 'movie',
                    title: 'Directed film',
                    job: 'Director',
                },
                {
                    id: 1,
                    media_type: 'movie',
                    title: 'Film 1',
                    job: 'Director',
                },
                {
                    id: 102,
                    media_type: 'movie',
                    title: 'Produced film',
                    job: 'Producer',
                },
            ],
        },
    };
    expect(mapPersonFilmography(person)).toHaveLength(80);
    const all = mapPersonFilmography(person, Infinity);
    expect(all).toHaveLength(101);
    expect(all.find((c) => c.tmdbId === 101)?.crewJob).toBe('Director');
    expect(all[0].originalTitle).toBe('Original 1');
});
