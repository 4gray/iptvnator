import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { hydrateUserData, initialData, Media } from '@iptvnator/tv/util';
const item: Media = {
    id: 'source:movie:42',
    sourceId: 'source',
    providerId: '42',
    kind: 'movie',
    title: 'The Matrix',
    year: '1999',
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
            title: 'The Matrix',
            release_date: '1999-03-30',
            overview: 'TMDB plot',
            backdrop_path: '/wide.jpg',
            poster_path: '/poster.jpg',
            original_language: 'en',
            credits: {
                cast: [{ name: 'Keanu Reeves' }],
                crew: [{ name: 'Lana Wachowski', job: 'Director' }],
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
    assert.equal(enriched.metadata?.cast[0].name, 'Keanu Reeves');
    assert.equal(enriched.metadata?.authors[0].name, 'Lana Wachowski');
    assert.equal(enriched.metadata?.authorRole, 'Directors');
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
test('provider-neutral movies and series use confident title search without changing source identity', async (t) => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.pathname);
        const details = {
            id: 603,
            title: 'The Matrix',
            name: 'The Matrix',
            release_date: '1999-03-30',
            first_air_date: '1999-03-30',
            overview: 'Matched description',
            original_language: 'en',
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
    }
    assert.deepEqual(requests, [
        '/3/search/movie',
        '/3/movie/603',
        '/3/search/tv',
        '/3/tv/603',
    ]);
});
