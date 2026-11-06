import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { hydrateUserData, initialData, Media } from '@iptvnator/tv/util';
const item: Media = {
    id: 'source:movie:42',
    sourceId: 'source',
    providerId: '42',
    kind: 'movie',
    title: 'Fixture Movie',
    year: '2020',
    poster: 'https://provider.example/poster.jpg',
    description: 'Provider plot',
    raw: { stream_id: 42, container_extension: 'mkv', tmdb_id: 603 },
};
test('TMDB defaults remain opt-in for existing TV data, without touching user history', () => {
    const data = initialData();
    const { tmdb: _omitted, ...historical } = data;
    historical.favorites = [item];
    const restored = hydrateUserData(historical);
    assert.deepEqual(restored.tmdb, {
        enabled: false,
        apiKey: '',
        language: 'en',
    });
    assert.equal(restored.favorites[0], item);
});
test('TV enrichment patches editorial fields only and skips live or disabled requests', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
        Response.json({
            id: 603,
            title: 'Fixture Movie',
            release_date: '2020-03-30',
            overview: 'TMDB plot',
            backdrop_path: '/wide.jpg',
            poster_path: '/poster.jpg',
            original_language: 'en',
            genres: [{ id: 12, name: 'Adventure' }],
            production_countries: [{ iso_3166_1: 'XY', name: 'Fictionland' }],
            runtime: 110,
            vote_average: 7.6,
            vote_count: 25,
            release_dates: { results: [] },
            content_ratings: { results: [] },
            credits: {
                cast: [{ name: 'Fixture Actor' }],
                crew: [{ name: 'Fixture Director', job: 'Director' }],
            },
        })
    );
    const signal = new AbortController().signal;
    assert.equal(
        (await new TvMetadata(initialData().tmdb).enrich(item, signal)).item,
        item
    );
    const metadata = new TvMetadata({
        enabled: true,
        apiKey: 'fake-key',
        language: 'en',
    });
    const live = { ...item, kind: 'live' as const };
    assert.equal((await metadata.enrich(live, signal)).item, live);
    assert.equal(fetch.mock.calls.length, 0);
    const enriched = (await metadata.enrich(item, signal)).item;
    assert.equal(enriched.description, 'TMDB plot');
    assert.equal(enriched.metadata?.cast[0].name, 'Fixture Actor');
    assert.equal(enriched.metadata?.authors[0].name, 'Fixture Director');
    assert.equal(enriched.metadata?.authorRole, 'Directors');
    assert.deepEqual(enriched.metadata?.genres, ['Adventure']);
    assert.deepEqual(enriched.metadata?.countries, ['Fictionland']);
    assert.equal(enriched.metadata?.durationMinutes, 110);
    assert.equal(enriched.metadata?.year, '2020');
    assert.equal(enriched.metadata?.rating, 7.6);
    assert.equal(
        enriched.backdrop,
        'https://image.tmdb.org/t/p/w1280/wide.jpg'
    );
    assert.equal(enriched.id, item.id);
    assert.equal(enriched.providerId, item.providerId);
    assert.equal(enriched.raw, item.raw);
});
test('TV metadata errors leave the original provider selection usable', async (t) => {
    t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('', { status: 401 })
    );
    const result = await new TvMetadata({
        enabled: true,
        apiKey: 'invalid',
        language: 'en',
    }).enrich(item, new AbortController().signal);
    assert.equal(result.item, item);
    assert.equal(result.failed, true);
});

test('TMDB presentation keeps an early release year when the provider omits it', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({
            id: 603,
            title: 'Fixture Movie',
            release_date: '1895-03-04',
            original_language: 'en',
        })
    );
    const result = await new TvMetadata({
        enabled: true,
        apiKey: 'fixture-key',
        language: 'en',
    }).enrich({ ...item, year: undefined }, new AbortController().signal);
    assert.equal(result.item.metadata?.year, '1895');
});
test('provider-neutral movies and series use confident title search without changing source identity', async (t) => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.pathname);
        const details = {
            id: 603,
            title: 'Fixture Movie',
            name: 'Fixture Movie',
            release_date: '2020-03-30',
            first_air_date: '2020-03-30',
            runtime: 110,
            episode_run_time: [0, 45],
            origin_country: ['XY'],
            vote_count: 0,
            vote_average: 9,
            overview: 'Matched description',
            original_language: 'en',
            release_dates: { results: [] },
            content_ratings: { results: [] },
        };
        return Response.json(
            url.pathname.includes('/search/') ? { results: [details] } : details
        );
    });
    const metadata = new TvMetadata({
        enabled: true,
        apiKey: 'fake',
        language: 'en',
    });
    for (const kind of ['movie', 'series'] as const) {
        const original = { ...item, kind, raw: { cmd: 'provider command' } };
        const result = await metadata.enrich(
            original,
            new AbortController().signal
        );
        assert.equal(result.item.description, 'Matched description');
        assert.equal(result.item.raw, original.raw);
        assert.equal(result.item.sourceId, original.sourceId);
        assert.equal(result.item.kind, kind);
        assert.equal(
            result.item.metadata?.durationMinutes,
            kind === 'movie' ? 110 : 45
        );
        assert.equal(result.item.metadata?.rating, undefined);
        assert.deepEqual(result.item.metadata?.countries, ['XY']);
    }
    assert.deepEqual(requests, [
        '/3/search/movie',
        '/3/movie/603',
        '/3/search/tv',
        '/3/tv/603',
    ]);
});
