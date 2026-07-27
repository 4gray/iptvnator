import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createPerformanceTimelineMergeApi,
    type PerformanceTimelineMergeApi,
} from './performance-timeline-merge';

describe('performance timeline merge', () => {
    it('restores without module closures for Electron-main injection', () => {
        const source = createPerformanceTimelineMergeApi.toString();
        assert.doesNotMatch(source, /__name/);
        const factory = new Function(
            `"use strict"; return (${source});`
        )() as typeof createPerformanceTimelineMergeApi;
        assert.equal(factory().merge([], []).length, 0);
    });

    it('inserts Xtream records by epoch without reordering existing M3U JSON', () => {
        const api: PerformanceTimelineMergeApi =
            createPerformanceTimelineMergeApi();
        const baseline = [
            { epochMs: 100, type: 'm3u-a' },
            { epochMs: 300, type: 'm3u-b' },
            { epochMs: 300, type: 'm3u-c' },
        ];
        const additions = [
            { epochMs: 300, type: 'xtream-c' },
            { epochMs: 50, type: 'xtream-a' },
            { epochMs: 200, type: 'xtream-b' },
            { epochMs: 400, type: 'xtream-d' },
        ];

        const merged = api.merge(baseline, additions);

        assert.deepEqual(
            merged.map(({ type }) => type),
            [
                'xtream-a',
                'm3u-a',
                'xtream-b',
                'm3u-b',
                'm3u-c',
                'xtream-c',
                'xtream-d',
            ]
        );
        assert.equal(
            JSON.stringify(merged.filter(({ type }) => type.startsWith('m3u'))),
            JSON.stringify(baseline)
        );
    });
});
