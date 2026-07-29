import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface CaptureModule {
    selectXtreamRendererTarget?: (session: FakeSession) => Promise<string>;
    startXtreamRendererCapture?: unknown;
}

interface ArtifactModule {
    assertRendererMeasurementWindow?: (input: {
        readonly captureCutoffEpochMs: number;
        readonly measurementStartEpochMs: number;
        readonly operationStartEpochMs: number;
        readonly terminalEpochMs: number;
    }) => void;
    selectRendererPeakHeapUsedBytes?: (
        samples: readonly {
            readonly epochMs: number;
            readonly usedSize: number;
        }[],
        measurementStartEpochMs: number,
        terminalEpochMs: number
    ) => number;
}

interface TargetInfo {
    readonly targetId: string;
    readonly title: string;
    readonly type: string;
    readonly url: string;
}

class FakeSession {
    constructor(private readonly targets: readonly TargetInfo[]) {}

    async send(method: string): Promise<Record<string, unknown>> {
        assert.equal(method, 'Target.getTargets');
        return { targetInfos: this.targets };
    }
}

const captureUrl = new URL('./xtream-renderer-capture.ts', import.meta.url);
const artifactUrl = new URL(
    './m3u-import-renderer-artifacts.ts',
    import.meta.url
);
const modulePromise = import(captureUrl.href)
    .then((module) => module as unknown as CaptureModule)
    .catch(() => null);
const artifactModulePromise = import(artifactUrl.href)
    .then((module) => module as unknown as ArtifactModule)
    .catch(() => null);

test('exports capture and persists the one exact IPTVnator renderer target', async () => {
    const module = await modulePromise;
    assert.ok(module, 'Xtream renderer capture module must exist');
    assert.equal(typeof module.startXtreamRendererCapture, 'function');
    assert.equal(typeof module.selectXtreamRendererTarget, 'function');

    const targetId = await module.selectXtreamRendererTarget?.(
        new FakeSession([
            {
                targetId: 'renderer-7',
                title: 'IPTVnator',
                type: 'page',
                url: 'http://localhost:4200/workspace/sources',
            },
            {
                targetId: 'devtools',
                title: 'DevTools',
                type: 'page',
                url: 'devtools://devtools/bundled/inspector.html',
            },
        ])
    );
    assert.equal(targetId, 'renderer-7');
});

test('fails closed when renderer target identity is missing or ambiguous', async () => {
    const module = await modulePromise;
    assert.ok(module?.selectXtreamRendererTarget);
    const target = {
        targetId: 'renderer-1',
        title: 'IPTVnator',
        type: 'page',
        url: 'http://localhost:4200/workspace/sources',
    };

    await assert.rejects(
        module.selectXtreamRendererTarget(new FakeSession([])),
        /xtream-renderer-target-count:0/
    );
    await assert.rejects(
        module.selectXtreamRendererTarget(
            new FakeSession([target, { ...target, targetId: 'renderer-2' }])
        ),
        /xtream-renderer-target-count:2/
    );
});

test('arms the renderer without sampling heap or starting diagnostics before the operation boundary', () => {
    const source = readFileSync(captureUrl, 'utf8');
    const artifacts = readFileSync(artifactUrl, 'utf8');
    const operationBoundary = source.indexOf(
        'await beginXtreamRendererOperation(page)'
    );
    const initialHeapSample = source.indexOf('await sampleHeap()');
    const diagnosticStart = source.indexOf(
        'await startRendererDiagnosticCapture(session, artifacts)'
    );
    const heapTimerStart = source.indexOf(
        'setInterval(() => void sampleHeap(), 20)'
    );

    assert.ok(operationBoundary >= 0);
    assert.ok(initialHeapSample > operationBoundary);
    assert.ok(diagnosticStart > operationBoundary);
    assert.ok(heapTimerStart > operationBoundary);
    assert.equal(source.match(/await sampleHeap\(\)/g)?.length, 1);
    assert.match(source, /RENDERER_HEARTBEAT_INTERVAL_MS/);
    assert.match(source, /Runtime\.getHeapUsage/);
    assert.match(source, /HeapProfiler\.collectGarbage/);
    assert.match(source, /createRendererArtifactCapture/);
    assert.match(source, /startRendererDiagnosticCapture/);
    assert.match(source, /stopRendererDiagnosticCapture/);
    assert.match(source, /takeRendererHeapSnapshot/);
    assert.match(artifacts, /Profiler\.start/);
    assert.match(artifacts, /Tracing\.start/);
});

test('bounds peak heap to timestamped samples inside the renderer operation window', async () => {
    const artifacts = await artifactModulePromise;
    assert.ok(artifacts?.selectRendererPeakHeapUsedBytes);

    assert.equal(
        artifacts.selectRendererPeakHeapUsedBytes(
            [
                { epochMs: 99, usedSize: 900 },
                { epochMs: 100, usedSize: 10 },
                { epochMs: 150, usedSize: 30 },
                { epochMs: 200, usedSize: 20 },
                { epochMs: 201, usedSize: 800 },
            ],
            100,
            200
        ),
        30
    );
    assert.throws(
        () =>
            artifacts.selectRendererPeakHeapUsedBytes?.(
                [{ epochMs: 201, usedSize: 800 }],
                100,
                200
            ),
        /renderer-heap-window-empty/
    );
});

test('validates and persists an explicit renderer measurement window', async () => {
    const artifacts = await artifactModulePromise;
    assert.ok(artifacts?.assertRendererMeasurementWindow);

    artifacts.assertRendererMeasurementWindow({
        captureCutoffEpochMs: 200,
        measurementStartEpochMs: 110,
        operationStartEpochMs: 100,
        terminalEpochMs: 190,
    });
    assert.throws(
        () =>
            artifacts.assertRendererMeasurementWindow?.({
                captureCutoffEpochMs: 200,
                measurementStartEpochMs: 99,
                operationStartEpochMs: 100,
                terminalEpochMs: 190,
            }),
        /renderer-measurement-window-invalid/
    );
    assert.throws(
        () =>
            artifacts.assertRendererMeasurementWindow?.({
                captureCutoffEpochMs: 189,
                measurementStartEpochMs: 110,
                operationStartEpochMs: 100,
                terminalEpochMs: 190,
            }),
        /renderer-measurement-window-invalid/
    );

    const source = readFileSync(captureUrl, 'utf8');
    assert.match(source, /readonly measurementStartEpochMs: number/);
    assert.match(source, /readonly captureCutoffEpochMs: number/);
});

test('cuts off scheduling and diagnostics before forced GC and snapshot work', () => {
    const source = readFileSync(captureUrl, 'utf8');
    const stopCapture = source.indexOf('const stopCapture');
    const stopScheduling = source.indexOf('stopScheduling()', stopCapture);
    const finalHeartbeat = source.indexOf(
        'await flushHeartbeat()',
        stopScheduling
    );
    const diagnosticStop = source.indexOf(
        'await stopRendererDiagnosticCapture(session, artifacts)',
        stopCapture
    );
    const forcedGc = source.indexOf(
        "await session.send('HeapProfiler.collectGarbage')",
        stopCapture
    );
    const heapSnapshot = source.indexOf(
        'await takeRendererHeapSnapshot(',
        stopCapture
    );

    assert.ok(stopCapture >= 0);
    assert.ok(stopScheduling > stopCapture);
    assert.ok(finalHeartbeat > stopScheduling);
    assert.ok(diagnosticStop > finalHeartbeat);
    assert.ok(forcedGc > diagnosticStop);
    assert.ok(heapSnapshot > forcedGc);
    assert.match(source, /assertFixedGridRendererHeartbeatCoverage\(/);
});

test('persists only error counts and cleans up listeners/session idempotently', () => {
    const source = readFileSync(captureUrl, 'utf8');

    assert.match(source, /consoleErrorCount/);
    assert.match(source, /pageErrorCount/);
    assert.doesNotMatch(source, /consoleErrorMessages|pageErrorMessages/);
    assert.match(source, /page\.off\('console'/);
    assert.match(source, /page\.off\('pageerror'/);
    assert.match(source, /disposePromise/);
});
