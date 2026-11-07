import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tv from '@iptvnator/tv/util';
const item: tv.Media = {
    id: 'film',
    sourceId: 'source',
    providerId: '17',
    kind: 'movie',
    title: 'Synthetic film',
    raw: {},
};
const source: tv.Source = {
    id: item.sourceId,
    name: 'Synthetic',
    provider: 'xtream',
    url: 'https://example.test',
};
const p = (seconds: number, duration: number): tv.Progress => ({
    item,
    seconds,
    duration,
    updated: 1,
});
test('watch state matches rounded desktop threshold and preserves unknown duration resume', () => {
    assert.equal(tv.watchState(undefined), 'unwatched');
    assert.equal(tv.watchState(p(600, 3600)), 'in-progress');
    assert.equal(tv.watchState(p(3222, 3600)), 'watched'); // 89.5 rounds to 90
    assert.equal(tv.watchState(p(3221, 3600)), 'in-progress');
    assert.equal(tv.watchState(p(3240, 3600)), 'watched');
    for (const duration of [0, NaN, Infinity, -1]) {
        assert.equal(tv.watchState(p(600, duration)), 'in-progress');
        assert.equal(tv.resumeSeconds(p(600, duration)), 600);
    }
    assert.equal(tv.resumeSeconds(p(3240, 3600)), 0);
    assert.equal(tv.watchState(p(NaN, 3600)), 'unwatched');
});
test('manual actions retain raw records, survive reload and reject a delayed old checkpoint', () => {
    const other = { ...item, id: 'other' };
    const original = tv.recordProgress(tv.initialData(), p(600, 3600));
    original.favorites = [item];
    original.positions.other = { ...p(50, 100), item: other };
    const watched = tv.setWatchState(original, item, 'watched', 2);
    assert.equal(tv.watchState(watched.positions.film), 'watched');
    assert.equal(watched.positions.film.seconds, 600);
    assert.equal(
        tv.recordProgress(watched, { ...p(650, 3600), updated: 99 }),
        watched
    );
    const reset = tv.setWatchState(watched, item, 'reset', 3);
    const restored = tv.hydrateUserData(JSON.parse(JSON.stringify(reset)));
    assert.equal(tv.watchState(restored.positions.film), 'unwatched');
    assert.equal(tv.resumeSeconds(restored.positions.film), 0);
    assert.equal(restored.positions.film.seconds, 600);
    assert.equal(restored.positions.other.seconds, 50);
    assert.equal(restored.favorites[0].id, item.id);
    assert.equal(
        tv.recordProgress(restored, {
            ...p(660, 3600),
            updated: 100,
            revision: 1,
        }),
        restored
    );
    const replay = tv.recordProgress(restored, {
        ...p(15, 3600),
        updated: 101,
        revision: 2,
    });
    assert.equal(tv.watchState(replay.positions.film), 'in-progress');
});
test('90 percent is absent from continuation and cannot revive older unfinished episode', () => {
    const data = tv.initialData();
    data.sources = [source];
    data.history = [p(3240, 3600)];
    assert.deepEqual(tv.continueWatching(data), []);
});

test('a stale watch action cannot recreate deleted history and positions', () => {
    const original = tv.recordProgress(
        { ...tv.initialData(), sources: [source] },
        p(600, 3600)
    );
    const deleted = tv.removeSourceData(original, source.id);
    for (const action of ['watched', 'unwatched', 'reset'] as const) {
        const result = tv.setWatchState(deleted, item, action);
        assert.deepEqual(result.history, []);
        assert.deepEqual(result.positions, {});
    }
});
