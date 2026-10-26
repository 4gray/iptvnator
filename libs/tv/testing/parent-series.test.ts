import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findParentSeries } from '@iptvnator/tv/data-access';
import {
    identity,
    Media,
    ProviderClient,
    Source,
    withSeriesContext,
} from '@iptvnator/tv/util';

const source: Source = {
    id: 'source',
    name: 'Fixture',
    provider: 'stalker',
    url: 'https://fixture.invalid',
};
const parent: Media = {
    id: identity(source, 'series', 'movie:7'),
    sourceId: source.id,
    providerId: '7',
    kind: 'series',
    title: 'The show s04',
    poster: 'https://fixture.invalid/series.jpg',
    raw: { origin: 'vod', is_series: true },
};
const episode: Media = {
    ...parent,
    id: 'episode',
    parentId: parent.id,
    kind: 'episode',
    title: 'An episode',
    seriesTitle: parent.title,
    poster: 'https://fixture.invalid/still.jpg',
    raw: { cmd: 'keep-episode-command' },
};
const client = (catalog: ProviderClient['catalog']) =>
    ({
        catalog,
        capabilities: {
            live: false,
            movies: true,
            series: true,
            epg: false,
            vodSeries: true,
        },
    }) as ProviderClient;
const signal = () => new AbortController().signal;

test('historical series details find their exact VOD parent across pages instead of a same-title series', async () => {
    const calls: unknown[] = [];
    const provider = client(async (kind, _category, page, query) => {
        calls.push([kind, page, query]);
        return {
            items: page ? [parent] : [{ ...parent, id: 'different-parent' }],
            total: 2,
            page,
            categories: [],
        };
    });
    assert.equal(
        await findParentSeries(provider, source, episode, signal()),
        parent
    );
    assert.deepEqual(calls, [
        ['movie', 0, parent.title],
        ['movie', 1, parent.title],
    ]);
    assert.equal(episode.raw.cmd, 'keep-episode-command');
    assert.equal(episode.poster, 'https://fixture.invalid/still.jpg');
});
test('saved parents reopen without a network request, but cannot cross sources or publish after cancellation', async () => {
    const provider = client(async () => {
        throw new Error('Must not request');
    });
    const saved = withSeriesContext(episode, parent);
    assert.equal(
        await findParentSeries(provider, source, saved, signal()),
        saved.parentSeries
    );
    assert.equal(
        await findParentSeries(
            provider,
            { ...source, id: 'other' },
            saved,
            signal()
        ),
        undefined
    );
    const abort = new AbortController();
    const late = client(async (_kind, _category, page) => {
        abort.abort();
        return { items: [parent], total: 1, page, categories: [] };
    });
    await assert.rejects(
        findParentSeries(late, source, episode, abort.signal),
        { name: 'AbortError' }
    );
});
test('unavailable or incomplete parent lookups never synthesize an episode-only series', async () => {
    const empty = client(async (_kind, _category, page) => ({
        items: [],
        total: 0,
        page,
        categories: [],
    }));
    assert.equal(
        await findParentSeries(empty, source, episode, signal()),
        undefined
    );
    const repeating = client(async (_kind, _category, page) => ({
        items: [{ ...parent, id: 'other' }],
        total: 99,
        page,
        categories: [],
    }));
    await assert.rejects(
        findParentSeries(repeating, source, episode, signal()),
        /incomplete/
    );
});
