import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TvMetadata } from '@iptvnator/tv/data-access';
import type { Media } from '@iptvnator/tv/util';

const parent: Media = {
    id: 'show',
    sourceId: 'source',
    providerId: 'panel-id',
    kind: 'series',
    title: 'Ted Lasso s04',
    year: '2026',
    raw: {},
};
const episode: Media = {
    id: 'saved-episode',
    sourceId: 'source',
    providerId: 'file-id',
    kind: 'episode',
    title: 'Эпизод 1',
    seriesTitle: parent.title,
    seriesYear: parent.year,
    parentId: parent.id,
    season: 1,
    episode: 1,
    raw: { cmd: 'original-command', series: 1 },
};
const settings = { enabled: true, apiKey: 'fixture', language: 'ru' };
const signal = () => new AbortController().signal;

test('shared matching finds a season-suffixed series and TV renders its cast/creators', async (t) => {
    const paths: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        if (url.pathname.includes('/search/')) {
            assert.equal(url.searchParams.get('query'), 'Ted Lasso');
            return Response.json({
                results: [
                    {
                        id: 97546,
                        name: 'Тед Лассо',
                        original_name: 'Ted Lasso',
                        first_air_date: '2020-08-14',
                    },
                ],
            });
        }
        return Response.json({
            id: 97546,
            name: 'Тед Лассо',
            original_language: 'ru',
            created_by: [{ name: 'Creator' }],
            credits: {
                cast: [
                    {
                        name: 'Actor',
                        character: 'Coach',
                        profile_path: '/person.jpg',
                    },
                ],
            },
            backdrop_path: '/wide.jpg',
            overview: 'Show overview',
        });
    });
    const metadata = new TvMetadata(settings);
    const result = await metadata.enrich(parent, signal());
    assert.equal(result.item.metadata?.tmdbId, 97546);
    assert.equal(result.item.metadata?.cast[0].character, 'Coach');
    assert.equal(result.item.metadata?.authors[0].name, 'Creator');
    assert.equal(result.item.raw, parent.raw);
    const home = await metadata.enrich(episode, signal());
    assert.equal(home.item.seriesTitle, parent.title);
    assert.equal(home.item.title, 'Эпизод 1');
    assert.equal(home.item.metadata?.tmdbId, 97546);
    assert.deepEqual(paths, ['/3/search/tv', '/3/tv/97546']);
});

test('season metadata uses the marked season, merges by episode number and preserves playback', async (t) => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input)).pathname);
        return Response.json({
            episodes: [
                {
                    episode_number: 1,
                    name: 'Real episode',
                    overview: 'Episode plot',
                    still_path: '/still.jpg',
                },
            ],
        });
    });
    const show = {
        ...parent,
        metadata: {
            tmdbId: 97546,
            cast: [],
            authors: [],
            authorRole: 'Creators' as const,
        },
    };
    const meaningful = {
        ...episode,
        id: 'named',
        title: 'Provider editorial title',
    };
    const unmatched = { ...episode, id: 'unknown', episode: 99 };
    const foreign = { ...episode, id: 'foreign', parentId: 'another-show' };
    const unnumbered = { ...episode, id: 'unnumbered', episode: undefined };
    const metadata = new TvMetadata(settings);
    const result = await metadata.enrichEpisodes(
        show,
        [episode, meaningful, unmatched, foreign, unnumbered],
        1,
        signal()
    );
    assert.deepEqual(requests, ['/3/tv/97546/season/4']);
    assert.equal(result.items[0].title, 'Real episode');
    assert.equal(result.items[0].description, 'Episode plot');
    assert.match(result.items[0].episodeStill!, /\/still.jpg$/);
    assert.equal(result.items[0].poster, episode.poster);
    assert.equal(result.items[0].id, episode.id);
    assert.equal(result.items[0].raw, episode.raw);
    assert.equal(result.items[0].season, 1);
    assert.equal(result.items[1].title, meaningful.title);
    assert.equal(result.items[2], unmatched);
    assert.equal(result.items[3], foreign);
    assert.equal(result.items[4], unnumbered);
    await metadata.enrichEpisodes(show, [episode], 1, signal());
    assert.equal(requests.length, 1);
});

test('missing, failing or cancelled season metadata keeps every provider episode', async (t) => {
    const fetch = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('', { status: 404 })
    );
    const metadata = new TvMetadata(settings);
    const items = [episode];
    assert.equal(
        (await metadata.enrichEpisodes(parent, items, 1, signal())).items,
        items
    );
    assert.equal(fetch.mock.calls.length, 0);
    const show = {
        ...parent,
        metadata: {
            tmdbId: 97546,
            cast: [],
            authors: [],
            authorRole: 'Creators' as const,
        },
    };
    const result = await metadata.enrichEpisodes(show, items, 1, signal());
    assert.equal(result.items, items);
    assert.equal(result.failed, true);
    const abort = new AbortController();
    abort.abort();
    assert.equal(
        (await metadata.enrichEpisodes(show, items, 1, abort.signal)).items,
        items
    );
    assert.equal(fetch.mock.calls.length, 1);
});

test('season slices keep markers from alternate raw provider names and preserve multi-season numbering', async (t) => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input)).pathname);
        return Response.json({
            episodes: [{ episode_number: 1, name: 'Marked-season episode' }],
        });
    });
    const show = {
        ...parent,
        title: 'Ted Lasso',
        raw: { o_name: 'Ted Lasso', name: 'Ted Lasso s04' },
        metadata: {
            tmdbId: 97546,
            cast: [],
            authors: [],
            authorRole: 'Creators' as const,
        },
    };
    const metadata = new TvMetadata(settings);
    const single = await metadata.enrichEpisodes(show, [episode], 1, signal());
    assert.equal(single.items[0].title, 'Marked-season episode');
    const multi = await metadata.enrichEpisodes(
        show,
        [episode, { ...episode, id: 'second-season', season: 2 }],
        1,
        signal()
    );
    assert.equal(multi.items[1].title, episode.title);
    assert.deepEqual(requests, [
        '/3/tv/97546/season/4',
        '/3/tv/97546/season/1',
    ]);
});
