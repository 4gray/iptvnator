import assert from 'node:assert/strict';
import test from 'node:test';
import {
    initialData,
    recordProgress,
    hydrateUserData,
    continueWatching,
    isWatched,
    resumePosition,
    progressLabel,
    setWatched,
    type Progress,
} from '@iptvnator/tv/util';

const saved = (duration = 2760, seconds = 1200): Progress => ({
    item: {
        id: 'demo',
        sourceId: 'source-a',
        providerId: 'demo',
        kind: 'movie',
        title: 'Demo film',
        raw: {},
    },
    duration,
    seconds,
    updated: 42,
});

test('manual completion preserves position and survives reload; undo and replay restore continuation', () => {
    const original = recordProgress(initialData(), saved(0));
    const watched = setWatched(original, 'demo', true);
    const restored = hydrateUserData(JSON.parse(JSON.stringify(watched)));
    assert.equal(isWatched(restored.positions.demo), true);
    assert.equal(resumePosition(restored.positions.demo), 0);
    assert.equal(continueWatching(restored).length, 0);
    assert.equal(restored.history[0].seconds, 1200);
    assert.equal(restored.history[0].updated, 42);
    assert.equal(original.history[0].watched, undefined);
    const undone = setWatched(restored, 'demo', false);
    assert.equal(resumePosition(undone.positions.demo), 1200);
    assert.equal(continueWatching(undone).length, 1);
    const replayed = recordProgress(restored, saved(0, 30));
    assert.equal(isWatched(replayed.positions.demo), false);
    assert.equal(continueWatching(replayed).length, 1);
});

test('automatic completion and its manual override use the same resume decision', () => {
    const data = recordProgress(initialData(), saved(2760, 2700));
    assert.equal(resumePosition(data.positions.demo), 0);
    const undone = setWatched(data, 'demo', false);
    assert.equal(resumePosition(undone.positions.demo), 2700);
    assert.equal(continueWatching(undone).length, 1);
    assert.equal(resumePosition(undefined), 0);
    for (const duration of [0, NaN, Infinity, -1]) {
        assert.equal(isWatched(saved(duration)), false);
    }
});

test('labels show remaining time, completion or watched minutes for unknown duration', () => {
    assert.equal(progressLabel(saved(2760, 1200)), '26 min left');
    assert.equal(
        progressLabel({ ...saved(2760, 2700), watched: false }),
        '1 min left'
    );
    assert.equal(progressLabel(saved(2760, 2700)), 'Watched');
    assert.equal(progressLabel(saved(0, 1200)), '20 min watched');
    assert.equal(progressLabel({ ...saved(0), watched: true }), 'Watched');
    assert.equal(progressLabel(saved(0, NaN)), '0 min watched');
});
