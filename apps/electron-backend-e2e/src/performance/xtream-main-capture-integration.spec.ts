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

    it('restores argument-taking capture functions without invoking them', () => {
        assert.match(
            source,
            /const restoreFunction = <T>\(source: string\): T =>/
        );
        assert.match(
            source,
            /const factory = restoreFunction<\(\) => T>\(source\);\s*return factory\(\);/
        );

        for (const factoryName of [
            'diagnosticsPerformancePhaseEventParserFactory',
            'xtreamIpcMarkerProtocolFactory',
            'xtreamIpcMarkerCaptureFactory',
            'xtreamMainLifecycleValidatorFactory',
        ]) {
            assert.match(
                source,
                new RegExp(
                    `const ${factoryName} = restoreFunction<[\\s\\S]*?>\\(`
                ),
                `${factoryName} must be restored without an eager zero-argument call`
            );
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

    it('arms attribution before starting deferred operation-window metrics exactly once', () => {
        const measurement = section(
            'const beginMeasurement = async',
            'const startCapture = async'
        );
        const arm = section('const startCapture = async', 'const api =');

        assert.doesNotMatch(arm, /threadCpuUsage|monitorEventLoopDelay/);
        assert.doesNotMatch(arm, /setInterval\(sampleMain/);
        assert.doesNotMatch(arm, /'Profiler\.start'/);
        assert.match(measurement, /state\.measurementStartedEpochMs/);
        assert.match(measurement, /runtimeProcess\.threadCpuUsage\(\)/);
        assert.match(measurement, /monitorEventLoopDelay/);
        assert.match(measurement, /setInterval\(sampleMain, 20\)/);
        assert.match(measurement, /'Profiler\.start'/);
        assert.match(
            source,
            /if \(!options\.deferMeasurement\) \{\s*await beginMeasurement\(\);\s*\}/
        );
        assert.match(
            source,
            /beginMeasurement: async \(\): Promise<number> =>\s*beginMeasurement\(\)/
        );
        assert.match(
            source,
            /export async function beginXtreamMainMeasurement/
        );
    });

    it('uses Electron main-thread CPU accounting instead of process-wide CPU', () => {
        assert.match(
            source,
            /runtimeProcess\.threadCpuUsage\(\s*state\.cpuStart \?\? undefined\s*\)/
        );
        assert.doesNotMatch(source, /\bprocess\.cpuUsage\(/);
        assert.doesNotMatch(source, /\bruntimeProcess\.cpuUsage\(/);
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

    it('adds Xtream status gates without replacing the existing M3U status API', () => {
        for (const required of [
            'status: (): MainCaptureStatus',
            'xtreamStatus: (): XtreamMainCaptureStatus',
            'activeOperations:',
            'captureGeneration: state.captureGeneration',
            'lateDatabaseRequestCount: cutoff.lateRequestCount',
            'operationOutcomes: readOperationOutcomes()',
            "kind === 'database.worker'",
            "kind === 'playlist-refresh.worker'",
        ]) {
            assert.ok(source.includes(required), `missing ${required}`);
        }
        assert.match(
            source,
            /progress:\s*request\.progress\s*\?\s*\{ \.\.\.request\.progress \}\s*:\s*null/
        );
    });

    it('snapshots the completed generation and cutoff before atomically starting the next capture', () => {
        const cutoff = source.indexOf(
            'const captureCutoffEpochMs = nowEpochMs()'
        );
        const beginStop = source.indexOf(
            'databaseWorkerPostGcCutoffApi.beginStop()',
            cutoff
        );
        const stopped = source.indexOf(
            'const captureStoppedEpochMs = nowEpochMs()',
            beginStop
        );
        const rollover = source.indexOf(
            'databaseWorkerPostGcCutoffApi.rolloverCapture()',
            stopped
        );
        const nextStart = source.indexOf(
            'await startCapture(nextOptions)',
            rollover
        );
        const completedReturn = source.indexOf(
            'return { ...transport, rollover, xtream }',
            nextStart
        );

        assert.ok(cutoff >= 0);
        assert.ok(cutoff < beginStop);
        assert.ok(beginStop < stopped);
        assert.ok(stopped < rollover);
        assert.ok(rollover < nextStart);
        assert.ok(nextStart < completedReturn);
        assert.match(source, /captureGeneration: completedCaptureGeneration/);
        assert.match(
            source,
            /captureStartedEpochMs: completedCaptureStartedEpochMs/
        );
    });

    it('strictly allowlists Xtream IPC and cancel timeline labels at the public boundary', () => {
        assert.match(
            source,
            /XTREAM_IPC_TIMELINE_TYPES = new Set\(\[\s*'xtream-main-phase',\s*'xtream-preload-marker'/
        );
        assert.match(
            source,
            /XTREAM_CANCEL_TIMELINE_TYPES = new Set\(\[\s*'db-cancel-dispatched',\s*'db-cancel-received',\s*'db-cancel-terminal-received'/
        );
        assert.match(
            source,
            /throw new Error\(`xtream-main-capture-\$\{kind\}-invalid`\)/
        );
    });
});

function section(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0, `missing start marker: ${startMarker}`);
    assert.ok(end > start, `missing end marker: ${endMarker}`);
    return source.slice(start, end);
}
