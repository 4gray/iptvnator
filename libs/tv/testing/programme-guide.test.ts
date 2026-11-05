import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    guidePrograms,
    programmeNow,
    programmeDay,
    programmeWindow,
} from '@iptvnator/tv/util';

test('guide keeps supplied schedule order by time, rejects invalid spans and removes exact duplicates', () => {
    const first = {
        title: 'First',
        start: 1000,
        end: 2000,
        description: 'Full description',
    };
    const second = { title: 'Second', start: 2000, end: 3000 };
    const supplied = [
        second,
        first,
        first,
        { title: 'Invalid', start: NaN, end: 4000 },
        { title: 'Empty', start: 4000, end: 4000 },
    ];
    const rows = guidePrograms(supplied);
    assert.deepEqual(
        rows.map((row) => row.title),
        ['First', 'Second']
    );
    assert.equal(rows[0].description, first.description);
    assert.equal(supplied[0], second);
    assert.equal(new Set(rows.map((row) => row.id)).size, 2);
});

test('Now uses current programme, next supplied programme in a gap, and final programme after schedule ends', () => {
    const rows = guidePrograms([
        { title: 'A', start: 100, end: 200 },
        { title: 'B', start: 300, end: 400 },
    ]);
    assert.equal(programmeNow(rows, 150)?.title, 'A');
    assert.equal(programmeNow(rows, 200)?.title, 'B');
    assert.equal(programmeNow(rows, 300)?.title, 'B');
    assert.equal(programmeNow(rows, 500)?.title, 'B');
    assert.equal(programmeNow([], 150), undefined);
});

test('overnight programme belongs to its actual start day and remains the current selection after midnight', () => {
    const start = new Date(2026, 9, 25, 23, 30).getTime();
    const end = new Date(2026, 9, 26, 1).getTime();
    const now = new Date(2026, 9, 26, 0, 30).getTime();
    const rows = guidePrograms([{ title: 'Overnight', start, end }]);
    assert.equal(rows[0].day, '2026-10-25');
    assert.notEqual(rows[0].day, programmeDay(now));
    assert.equal(programmeNow(rows, now), rows[0]);
});

test('large schedules retain the focused row and bound mounted rows across distant scrolling', () => {
    for (const scroll of [0, 10000, 999999]) {
        const window = programmeWindow(1000, scroll, 500);
        assert.ok(window.length <= 21);
        assert.ok(window.includes(500));
        assert.equal(new Set(window).size, window.length);
        assert.ok(window.every((index) => index >= 0 && index < 1000));
    }
    assert.deepEqual(programmeWindow(0, 0, -1), []);
    assert.deepEqual(programmeWindow(1, 0, 0), [0]);
});
