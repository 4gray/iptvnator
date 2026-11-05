import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    GUIDE_SPAN,
    gridProgramAt,
    gridVisiblePrograms,
    guidePrograms,
    guideWindow,
} from '@iptvnator/tv/util';

test('grid clips by overlap and selects the same clock position across channels, including midnight', () => {
    const axis = { startMs: 1000, endMs: 3000 };
    const rows = guidePrograms([
        { title: 'Crossing', start: 500, end: 1500 },
        { title: 'Current', start: 1500, end: 2000 },
        { title: 'After gap', start: 2500, end: 3500 },
        { title: 'Outside', start: 3000, end: 4000 },
    ]);
    assert.deepEqual(
        gridVisiblePrograms(rows, axis, '').map((p) => p.title),
        ['Crossing', 'Current', 'After gap']
    );
    assert.equal(gridProgramAt(rows, axis, 1200)?.title, 'Crossing');
    assert.equal(gridProgramAt(rows, axis, 1500)?.title, 'Current');
    assert.equal(gridProgramAt(rows, axis, 2400)?.title, 'After gap');
    assert.equal(
        gridProgramAt(rows, { startMs: 5000, endMs: 6000 }, 5500),
        undefined
    );
    const midnight = new Date(2026, 9, 26).getTime();
    const overnight = guidePrograms([
        { title: 'Overnight', start: midnight - 1000, end: midnight + 1000 },
    ]);
    assert.equal(
        gridProgramAt(overnight, guideWindow(midnight), midnight)?.title,
        'Overnight'
    );
});

test('dense schedules bound programme DOM while retaining the remotely selected tiny programme', () => {
    const rows = guidePrograms(
        Array.from({ length: 300 }, (_, i) => ({
            title: String(i),
            start: i * 1000,
            end: (i + 1) * 1000,
        }))
    );
    const visible = gridVisiblePrograms(
        rows,
        { startMs: 0, endMs: 300000 },
        rows[200].id
    );
    assert.equal(visible.length, 65);
    assert.equal(visible[64].id, rows[200].id);
    assert.equal(
        gridVisiblePrograms(rows, { startMs: 0, endMs: 300000 }, rows[0].id)
            .length,
        64
    );
});

test('Now window aligns to a local half-hour and spans exactly two elapsed hours', () => {
    for (const minute of [0, 29, 30, 59]) {
        const now = new Date(2026, 9, 25, 3, minute, 23).getTime();
        const axis = guideWindow(now);
        assert.equal(axis.endMs - axis.startMs, GUIDE_SPAN);
        assert.equal(new Date(axis.startMs).getMinutes(), minute < 30 ? 0 : 30);
        assert.equal(new Date(axis.startMs).getSeconds(), 0);
        assert.ok(axis.startMs <= now && now < axis.endMs);
    }
});

test('Now alignment preserves the second occurrence of a clock hour at DST fallback', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    try {
        const first = Date.parse('2026-10-25T02:45:23+02:00');
        const second = Date.parse('2026-10-25T02:45:23+01:00');
        assert.equal(
            guideWindow(second).startMs - guideWindow(first).startMs,
            3600000
        );
        assert.equal(
            guideWindow(second).startMs,
            Date.parse('2026-10-25T02:30:00+01:00')
        );
    } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
});
