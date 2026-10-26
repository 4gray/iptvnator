import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialData,
    identity,
    lumaFeed,
    lumaSelection,
    withSeriesContext,
    withLumaIds,
    type Media,
} from '@iptvnator/tv/util';
import { ServerLibrary } from '@iptvnator/tv/data-access';

const item: Media = {
    id: 'movie-1',
    sourceId: 'source',
    providerId: 'provider',
    kind: 'movie',
    title: 'A film',
    poster: 'https://provider.test/poster?password=secret',
    raw: { url: 'https://provider.test/movie/user/password/1.mp4' },
};
function fixture() {
    const data = initialData();
    data.sources = [
        {
            id: 'source',
            provider: 'xtream',
            name: 'Private',
            url: 'https://provider.test',
            password: 'secret',
        },
    ];
    data.activeId = 'source';
    data.favorites = [item];
    data.history = [{ item, seconds: 60, duration: 120, updated: 1 }];
    return withLumaIds(data);
}
test('Luma feed contains bounded saved cards and progress, never provider secrets or raw playback', () => {
    const data = fixture();
    data.favorites.push({ ...item, id: 'orphan', sourceId: 'removed' });
    const feed = lumaFeed(data, 123);
    assert.equal(feed.recent[0].seconds, 60);
    assert.equal(feed.updatedAt, 123);
    assert.equal(feed.favorites.length, 1);
    assert.equal(feed.favorites[0].poster, undefined);
    assert.doesNotMatch(
        JSON.stringify(feed),
        /secret|provider.test|password|raw/
    );
    data.favorites[0] = {
        ...item,
        poster: 'https://image.tmdb.org/t/p/w342/film.jpg',
    };
    assert.equal(lumaFeed(data).favorites[0].poster, data.favorites[0].poster);
});
test('M3U Luma handles never expose a stream URL and survive storage round trips', () => {
    const data = fixture();
    data.sources[0].provider = 'm3u';
    const url = 'https://portal.test/movie/private-user/private-password/1.mp4';
    const saved = {
        ...item,
        id: identity(data.sources[0], 'movie', url),
        providerId: url,
    };
    data.favorites = [saved];
    data.history = [{ item: saved, seconds: 60, duration: 120, updated: 1 }];
    const prepared = withLumaIds(data);
    const feed = lumaFeed(prepared);
    assert.doesNotMatch(
        JSON.stringify(feed),
        /private-user|private-password|portal\.test|https:|mp4/
    );
    const command = {
        action: 'open',
        id: feed.favorites[0].id,
        sourceId: saved.sourceId,
    };
    assert.deepEqual(
        lumaSelection(JSON.parse(JSON.stringify(prepared)), command),
        saved
    );
    assert.equal(withLumaIds(prepared), prepared);
    assert.equal(lumaFeed(data).favorites.length, 0);
    assert.equal(data.favorites[0].id, saved.id);
});
test('Luma opens only a currently saved media identity and source, never supplied stream URLs', () => {
    const data = fixture();
    const command = { action: 'open', id: item.id, sourceId: item.sourceId };
    assert.equal(lumaSelection(data, command), item);
    assert.equal(
        lumaSelection(data, { ...command, sourceId: 'other' }),
        undefined
    );
    assert.equal(
        lumaSelection(data, {
            ...command,
            id: 'unsaved',
            url: 'https://evil.test',
        }),
        undefined
    );
    data.sources = [];
    assert.equal(lumaSelection(data, command), undefined);
});
test('Luma publication checks public instance before sending a token or writing', async () => {
    const original = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
            JSON.stringify({
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                instanceId: 'wrong',
                auth: 'token',
            })
        );
    }) as typeof fetch;
    try {
        await assert.rejects(
            new ServerLibrary(
                'https://nas.test/api',
                'secret',
                'expected'
            ).publishLuma(lumaFeed(fixture()), new AbortController().signal)
        );
        assert.equal(calls.length, 1);
        assert.equal(
            (calls[0].init?.headers as Record<string, string>).Authorization,
            undefined
        );
    } finally {
        globalThis.fetch = original;
    }
});
test('Luma identifies a saved series by its parent name and opens its episode list', () => {
    const data = fixture();
    const parent = {
        ...item,
        id: 'show',
        providerId: 'show-id',
        kind: 'series' as const,
        title: 'The series',
        poster: 'https://image.tmdb.org/t/p/w342/series.jpg',
        raw: {},
    };
    const episode = withSeriesContext(
        {
            ...item,
            id: 'episode',
            parentId: parent.id,
            kind: 'episode',
            title: 'An episode',
        },
        parent
    );
    data.favorites = [];
    data.history = [{ item: episode, seconds: 60, duration: 120, updated: 1 }];
    data.lumaIds = withLumaIds(data).lumaIds;
    const feed = lumaFeed(data);
    assert.equal(feed.recent[0].title, parent.title);
    assert.equal(feed.recent[0].kind, 'series');
    assert.equal(feed.recent[0].poster, parent.poster);
    const command = {
        action: 'open',
        id: feed.recent[0].id,
        sourceId: episode.sourceId,
    };
    assert.deepEqual(lumaSelection(data, command), episode.parentSeries);
    const legacy = { ...episode, parentSeries: undefined };
    data.history[0].item = legacy;
    assert.equal(lumaFeed(data).recent[0].title, parent.title);
    assert.equal(lumaSelection(data, command), legacy);
    assert.equal(data.history[0].seconds, 60);
});
