import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continueWatching, initialData, Progress } from '@iptvnator/tv/util';
const progress = (
    id: string,
    updated: number,
    extra: Partial<Progress> = {}
): Progress => ({
    item: {
        id,
        sourceId: 'a',
        providerId: id,
        kind: 'movie',
        title: id,
        raw: {},
    },
    seconds: 1200,
    duration: 3600,
    updated,
    ...extra,
});
test('continuation is source-scoped, newest first, limited and never mutates saved history', () => {
    const data = initialData();
    data.activeId = 'a';
    const foreign = progress('foreign', 100);
    foreign.item.sourceId = 'b';
    const live = progress('live', 101);
    live.item.kind = 'live';
    data.history = [
        progress('old', 1),
        progress('done', 9, { seconds: 3590 }),
        progress('new', 3),
        foreign,
        live,
        progress('unknown-duration', 2, { duration: 0 }),
        progress('not-started', 8, { seconds: 0 }),
    ];
    const saved = JSON.stringify(data);
    assert.deepEqual(
        continueWatching(data, 3).map((p) => p.item.id),
        ['new', 'unknown-duration', 'old']
    );
    assert.deepEqual(
        continueWatching(data, 1).map((p) => p.item.id),
        ['new']
    );
    assert.equal(JSON.stringify(data), saved);
});
test('one latest episode per series; completed latest episode cannot revive an older unfinished episode', () => {
    const data = initialData();
    data.activeId = 'a';
    const episodes = ['e1', 'e2', 'e3', 'other'].map((id, i) => {
        const p = progress(id, i + 1);
        p.item.kind = 'episode';
        p.item.parentId = id === 'other' ? 'series-b' : 'series-a';
        return p;
    });
    data.history = episodes;
    assert.deepEqual(
        continueWatching(data).map((p) => p.item.id),
        ['other', 'e3']
    );
    episodes[2].seconds = 3590;
    assert.deepEqual(
        continueWatching(data).map((p) => p.item.id),
        ['other']
    );
    delete episodes[0].item.parentId;
    assert.deepEqual(
        continueWatching(data).map((p) => p.item.id),
        ['other', 'e1']
    );
});
