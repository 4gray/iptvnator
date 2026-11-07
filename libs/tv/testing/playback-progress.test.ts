import assert from 'node:assert/strict';
import test from 'node:test';
import {
    initialData,
    recordProgress,
    hydrateUserData,
    continueWatching,
    watchState,
    resumeSeconds,
    progressLabel,
    setWatchState,
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
    const watched = setWatchState(original, saved().item, 'watched');
    const restored = hydrateUserData(JSON.parse(JSON.stringify(watched)));
    assert.equal(watchState(restored.positions.demo), 'watched');
    assert.equal(resumeSeconds(restored.positions.demo), 0);
    assert.equal(continueWatching(restored).length, 0);
    assert.equal(restored.history[0].seconds, 1200);
    assert.equal(restored.history[0].updated, 42);
    assert.equal(original.history[0].watched, undefined);
    const undone = setWatchState(restored, saved().item, 'unwatched');
    assert.equal(resumeSeconds(undone.positions.demo), 1200);
    assert.equal(continueWatching(undone).length, 1);
    const replayed = recordProgress(restored, {
        ...saved(0, 30),
        updated: 43,
        revision: restored.positions.demo.revision,
    });
    assert.equal(watchState(replayed.positions.demo), 'in-progress');
    assert.equal(continueWatching(replayed).length, 1);
});

test('legacy manual status timestamps still fence older progress-save retries', () => {
    const pending = saved(2760, 1200);
    for (const watched of [true, false]) {
        const marked = recordProgress(initialData(), {
            ...pending,
            watched,
            watchedUpdated: 43,
        });
        const retried = recordProgress(marked, pending);
        assert.equal(retried.positions.demo.watched, watched);
        assert.equal(retried.history[0].watched, watched);
        assert.equal(retried.history[0].updated, pending.updated);
        assert.equal(retried.history[0].seconds, pending.seconds);
        const hydrated = hydrateUserData(JSON.parse(JSON.stringify(marked)));
        assert.equal(
            recordProgress(hydrated, pending).positions.demo.watched,
            watched
        );
        const newPlayback = recordProgress(hydrated, {
            ...pending,
            seconds: 30,
            updated: 44,
            revision: 0,
        });
        assert.equal(newPlayback.positions.demo.watched, undefined);
        assert.equal(newPlayback.positions.demo.seconds, 30);
    }
});

test('automatic completion and its manual override use the same resume decision', () => {
    const data = recordProgress(initialData(), saved(2760, 2700));
    assert.equal(resumeSeconds(data.positions.demo), 0);
    const undone = setWatchState(data, saved().item, 'unwatched');
    assert.equal(resumeSeconds(undone.positions.demo), 2700);
    assert.equal(continueWatching(undone).length, 1);
    assert.equal(resumeSeconds(undefined), 0);
    for (const duration of [0, NaN, Infinity, -1]) {
        assert.equal(watchState(saved(duration)), 'in-progress');
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
    assert.equal(progressLabel(saved(0, NaN)), 'Unwatched');
});
