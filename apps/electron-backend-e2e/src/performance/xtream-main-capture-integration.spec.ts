import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const source = readFileSync(
    join(import.meta.dirname, 'm3u-refresh-main-capture.ts'),
    'utf8'
);

describe('Xtream main capture integration', () => {
    it('installs the strict preload and diagnostics correlators in the existing capture generation', () => {
        for (const required of [
            'createDatabaseWorkerCancelCapture',
            'createDiagnosticsPerformancePhaseEventParser',
            'createPerformanceTimelineMergeApi',
            'createXtreamIpcMarkerCapture',
            'createXtreamIpcMarkerProtocol',
            'createXtreamMainLifecycleValidator',
            'XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL',
            'XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL',
            'xtreamIpcMarkerCapture.acceptPreload',
            'xtreamIpcMarkerCapture.acceptMainPhase',
            'xtreamIpcMarkerCapture.start',
            'xtreamIpcMarkerCapture.stop',
            'databaseWorkerCancelCapture.acceptReceipt',
            'databaseWorkerCancelCapture.acceptTerminal',
            'databaseWorkerCancelCapture.start',
            'databaseWorkerCancelCapture.stop',
        ]) {
            assert.ok(source.includes(required), `missing ${required}`);
        }
    });

    it('fences Xtream events with an epoch captured before activation', () => {
        const captureStart = source.indexOf(
            'const captureStartedEpochMs = nowEpochMs()'
        );
        const active = source.indexOf('state.active = true', captureStart);
        assert.ok(captureStart >= 0);
        assert.ok(active > captureStart);
        assert.match(
            source,
            /xtreamIpcMarkerCapture\.start\(\s*options\.rendererWindowIdentity\.webContentsId,\s*captureStartedEpochMs\s*\)/
        );
    });

    it('correlates DB cancel dispatch before recognizing the worker receipt', () => {
        const dispatch = source.indexOf(
            'xtreamIpcMarkerCapture.matchDatabaseCancel'
        );
        const receipt = source.indexOf(
            'databaseWorkerCancelCapture.acceptReceipt'
        );
        const response = source.indexOf("message['type'] === 'response'");
        assert.ok(dispatch >= 0);
        assert.ok(receipt >= 0);
        assert.ok(response >= 0);
        assert.ok(receipt < response);
        assert.match(
            source,
            /message\['type'\]\s*===\s*'performance-cancel-received'/
        );
    });

    it('routes Xtream DB request attribution before the legacy M3U identity branch', () => {
        const xtreamMatch = source.indexOf(
            'xtreamIpcMarkerCapture.matchDatabaseRequest'
        );
        const m3uMatch = source.indexOf(
            'databaseRequestIdentityCapture.matchDatabaseRequest'
        );
        assert.ok(xtreamMatch >= 0);
        assert.ok(m3uMatch >= 0);
        assert.ok(xtreamMatch < m3uMatch);
    });

    it('merges stop-buffered Xtream events before timeline serialization', () => {
        const merge = source.indexOf('performanceTimelineMergeApi.merge');
        const serialize = source.indexOf('timeline: state.timeline');
        assert.ok(merge >= 0);
        assert.ok(serialize >= 0);
        assert.ok(merge < serialize);
        assert.equal(
            source.includes(
                'state.timeline.push(...xtreamIpcSnapshot.timeline)'
            ),
            false
        );
    });
});
