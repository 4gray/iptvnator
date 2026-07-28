import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    deriveXtreamMeasuredPlaylistId,
    xtreamScenarioRequiresSeed,
} from './xtream-benchmark-runtime';

describe('Xtream benchmark runtime evidence', () => {
    it('seeds only scenarios that measure an operation on an existing portal', () => {
        const expected: Record<XtreamScenarioId, boolean> = {
            [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE]: false,
            [XTREAM_SCENARIO_ID.REFRESH_LARGE]: true,
            [XTREAM_SCENARIO_ID.DELETE_LARGE]: true,
            [XTREAM_SCENARIO_ID.CANCEL_IMPORT]: false,
            [XTREAM_SCENARIO_ID.BACKGROUND_UI]: true,
        };

        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            assert.equal(
                xtreamScenarioRequiresSeed(scenarioId),
                expected[scenarioId]
            );
        }
    });

    it('derives exactly one non-null measured playlist identity', () => {
        assert.equal(
            deriveXtreamMeasuredPlaylistId([
                { playlistId: null },
                { playlistId: 'playlist-1' },
                { playlistId: 'playlist-1' },
            ]),
            'playlist-1'
        );

        for (const requests of [
            [{ playlistId: null }],
            [{ playlistId: 'playlist-1' }, { playlistId: 'playlist-2' }],
            [{ playlistId: '' }],
        ]) {
            assert.throws(
                () => deriveXtreamMeasuredPlaylistId(requests),
                /xtream-measured-playlist-identity-invalid/
            );
        }
    });
});
