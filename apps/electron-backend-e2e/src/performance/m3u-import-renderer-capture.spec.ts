/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import { RENDERER_PERFORMANCE_PHASE_HOOK_KEY } from '@iptvnator/shared/logging';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface ImportProbe {
    firstChannelVisibleEpochMs: number | null;
    frameGapsMs: readonly number[];
    heartbeatDelaysMs: readonly number[];
    longTasksMs: readonly number[];
    operationStartEpochMs: number;
    performancePhaseEvents: readonly unknown[];
    playlistId: string | null;
    routeReadyEpochMs: number | null;
    terminalEpochMs: number | null;
    uiPaintedEpochMs: number | null;
}

interface RendererCaptureModule {
    assertCompleteM3uImportRendererProbe?: (probe: ImportProbe) => void;
    startM3uImportRendererCapture?: unknown;
}

interface RendererProbeModule {
    M3U_IMPORT_RENDERER_STATE_KEY?: string;
    installM3uImportRendererProbe?: (page: unknown) => Promise<void>;
    recordM3uImportHeartbeat?: (
        page: unknown,
        deadlineEpochMs: number
    ) => Promise<number>;
    stopM3uImportRendererProbe?: (page: unknown) => Promise<ImportProbe>;
}

interface FakeProbeState {
    frameGapsMs: number[];
    heartbeatDelaysMs: number[];
    operationStartEpochMs: number;
    operationStartMonotonicMs: number;
    terminalEpochMs: number | null;
}

const captureUrl = new URL('./m3u-import-renderer-capture.ts', import.meta.url);
const artifactsUrl = new URL(
    './m3u-import-renderer-artifacts.ts',
    import.meta.url
);
const probeUrl = new URL('./m3u-import-renderer-probe.ts', import.meta.url);
const captureModulePromise = import(captureUrl.href)
    .then((module) => module as RendererCaptureModule)
    .catch(() => null);
const probeModulePromise = import(probeUrl.href)
    .then((module) => module as unknown as RendererProbeModule)
    .catch(() => null);

function installFakeBrowserEnvironment() {
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const frames = new Map<number, (timestamp: number) => void>();
    let nextFrameId = 1;
    let nowMs = 0;
    let observerRecords: PerformanceEntry[] | null = null;

    const replaceGlobal = (key: string, value: unknown): void => {
        descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value,
            writable: true,
        });
    };
    class FakePerformanceObserver {
        static readonly supportedEntryTypes = ['longtask'];

        constructor() {
            observerRecords = [];
        }

        disconnect(): undefined {
            return undefined;
        }
        observe(): undefined {
            return undefined;
        }
        takeRecords(): PerformanceEntry[] {
            return observerRecords?.splice(0) ?? [];
        }
    }
    replaceGlobal('performance', { now: () => nowMs, timeOrigin: 0 });
    replaceGlobal('PerformanceObserver', FakePerformanceObserver);
    replaceGlobal('cancelAnimationFrame', (requestId: number) => {
        frames.delete(requestId);
    });
    replaceGlobal(
        'requestAnimationFrame',
        (callback: (timestamp: number) => void) => {
            const requestId = nextFrameId++;
            frames.set(requestId, callback);
            return requestId;
        }
    );
    replaceGlobal('location', { pathname: '/' });
    replaceGlobal('document', { querySelector: () => null });

    return {
        cleanup: () => {
            for (const [key, descriptor] of descriptors) {
                if (descriptor) {
                    Object.defineProperty(globalThis, key, descriptor);
                } else {
                    Reflect.deleteProperty(globalThis, key);
                }
            }
            Reflect.deleteProperty(
                globalThis,
                Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY)
            );
        },
        getObserver: () => observerRecords,
        page: {
            evaluate: async (
                callback: (argument: unknown) => unknown,
                argument: unknown
            ) => callback(argument),
        },
        readState: (stateKey: string) =>
            (globalThis as Record<string, unknown>)[stateKey] as FakeProbeState,
        runFrame: (timestamp: number) => {
            nowMs = timestamp;
            for (const [requestId, callback] of [...frames]) {
                if (frames.delete(requestId)) {
                    callback(timestamp);
                }
            }
        },
        setNow: (value: number) => {
            nowMs = value;
        },
        showTerminal: () => {
            (
                globalThis as unknown as {
                    location: { pathname: string };
                }
            ).location.pathname =
                '/Users/test/iptvnator/dist/apps/web/workspace/playlists/synthetic-id/all';
            Object.defineProperty(globalThis, 'document', {
                configurable: true,
                value: { querySelector: () => ({}) },
                writable: true,
            });
        },
    };
}

function readSource(url: URL): string | null {
    try {
        return readFileSync(url, 'utf8');
    } catch {
        return null;
    }
}

function completeProbe(): ImportProbe {
    return {
        firstChannelVisibleEpochMs: 130,
        frameGapsMs: [16, 48],
        heartbeatDelaysMs: [0, 12],
        longTasksMs: [72],
        operationStartEpochMs: 100,
        performancePhaseEvents: [],
        playlistId: 'synthetic-id',
        routeReadyEpochMs: 120,
        terminalEpochMs: 150,
        uiPaintedEpochMs: 150,
    };
}

test('exports the formal M3U import renderer collector', async () => {
    const module = await captureModulePromise;

    assert.ok(module, 'M3U import renderer capture module must exist');
    assert.equal(typeof module.startM3uImportRendererCapture, 'function');
    assert.equal(
        typeof module.assertCompleteM3uImportRendererProbe,
        'function'
    );
});

test('prepares the URL dialog before starting any measured capture', () => {
    const source = readSource(captureUrl);
    assert.ok(source, 'M3U import renderer capture source must exist');

    const dialogPreparation = source.indexOf(
        'await prepareM3uImportDialog(page, options)'
    );
    const cdpSession = source.indexOf('newCDPSession(page)');
    const initialHeapSample = source.indexOf('await sampleHeap()');

    assert.ok(dialogPreparation >= 0);
    assert.ok(cdpSession > dialogPreparation);
    assert.ok(initialHeapSample > cdpSession);
});

test('captures heap samples in every run and raw CPU, trace, and heap artifacts only in diagnostics', () => {
    const source = readSource(captureUrl);
    const artifactSource = readSource(artifactsUrl);
    assert.ok(source);
    assert.ok(artifactSource);

    assert.match(source, /setInterval\(\(\) => void sampleHeap\(\), 20\)/);
    assert.match(source, /Runtime\.getHeapUsage/);
    assert.match(source, /HeapProfiler\.collectGarbage/);
    assert.match(
        artifactSource,
        /cpuProfilePath: options\.diagnostic[\s\S]*renderer\.cpuprofile/
    );
    assert.match(artifactSource, /Profiler\.start/);
    assert.match(artifactSource, /Tracing\.start/);
    assert.match(artifactSource, /HeapProfiler\.takeHeapSnapshot/);
});

test('clips drained long tasks and heartbeat samples to the operation window', async () => {
    const module = await probeModulePromise;
    assert.ok(module);
    assert.equal(typeof module.installM3uImportRendererProbe, 'function');
    assert.equal(typeof module.recordM3uImportHeartbeat, 'function');
    assert.equal(typeof module.stopM3uImportRendererProbe, 'function');
    assert.equal(typeof module.M3U_IMPORT_RENDERER_STATE_KEY, 'string');
    const browser = installFakeBrowserEnvironment();

    try {
        await module.installM3uImportRendererProbe?.(browser.page);
        const state = browser.readState(
            module.M3U_IMPORT_RENDERER_STATE_KEY ?? ''
        );
        state.operationStartEpochMs = 100;
        state.operationStartMonotonicMs = 100;
        state.terminalEpochMs = 200;
        const observerRecords = browser.getObserver();
        assert.ok(observerRecords);
        observerRecords.push(
            { duration: 40, startTime: 80 } as PerformanceEntry,
            { duration: 30, startTime: 190 } as PerformanceEntry,
            { duration: 30, startTime: 210 } as PerformanceEntry
        );

        browser.setNow(250);
        const nextDeadline = await module.recordM3uImportHeartbeat?.(
            browser.page,
            150
        );
        const metrics = await module.stopM3uImportRendererProbe?.(browser.page);

        assert.equal(nextDeadline, 250);
        assert.deepEqual(metrics?.heartbeatDelaysMs, [50, 0]);
        assert.deepEqual(metrics?.longTasksMs, [20, 10]);
    } finally {
        browser.cleanup();
    }
});

test('records the terminal animation-frame gap exactly once', async () => {
    const module = await probeModulePromise;
    assert.ok(module?.installM3uImportRendererProbe);
    assert.equal(typeof module.M3U_IMPORT_RENDERER_STATE_KEY, 'string');
    const browser = installFakeBrowserEnvironment();

    try {
        await module.installM3uImportRendererProbe(browser.page);
        browser.runFrame(80);
        const state = browser.readState(
            module.M3U_IMPORT_RENDERER_STATE_KEY ?? ''
        );
        state.operationStartEpochMs = 100;
        state.operationStartMonotonicMs = 100;
        browser.showTerminal();
        browser.runFrame(120);
        browser.runFrame(140);
        browser.runFrame(160);

        assert.equal(state.terminalEpochMs, 160);
        assert.deepEqual(state.frameGapsMs, [20, 20, 20]);
        await module.stopM3uImportRendererProbe?.(browser.page);
    } finally {
        browser.cleanup();
    }
});

test('installs the production renderer phase hook and returns its raw events', () => {
    const source = readSource(probeUrl);
    assert.ok(source);

    assert.match(source, /RENDERER_PERFORMANCE_PHASE_HOOK_KEY/);
    assert.match(source, /Symbol\.for\(hookKey\)/);
    assert.match(source, /performancePhaseEvents\.push\(event\)/);
    assert.match(
        source,
        /performancePhaseEvents: \[\.\.\.state\.performancePhaseEvents\]/
    );
    assert.match(source, /delete target\[hookSymbol\]/);
});

test('timestamps the click immediately before final Add and requires route, first item, and two animation frames', () => {
    const source = readSource(probeUrl);
    assert.ok(source);

    const operationStart = source.indexOf(
        'state.operationStartMonotonicMs = performance.now()'
    );
    const click = source.indexOf('button.click()', operationStart);
    assert.ok(operationStart >= 0);
    assert.ok(click > operationStart);
    assert.ok(source.includes('/\\/workspace\\/playlists\\/([^/]+)\\/all$/'));
    assert.match(source, /\[data-test-id="channel-item"\]/);
    const firstPaintFrame = source.indexOf(
        'state.uiPaintFrameRequestId = requestAnimationFrame'
    );
    const secondPaintFrame = source.indexOf(
        'state.uiPaintFrameRequestId = requestAnimationFrame',
        firstPaintFrame + 1
    );
    assert.ok(firstPaintFrame >= 0);
    assert.ok(secondPaintFrame > firstPaintFrame);
    for (const phase of [
        'operationStartEpochMs',
        'routeReadyEpochMs',
        'firstChannelVisibleEpochMs',
        'uiPaintedEpochMs',
        'terminalEpochMs',
    ]) {
        assert.match(source, new RegExp(phase));
    }
});

test('fails closed when any terminal proof or the probe itself is missing', async () => {
    const module = await captureModulePromise;
    assert.ok(module);
    const assertComplete = module.assertCompleteM3uImportRendererProbe;
    assert.equal(typeof assertComplete, 'function');

    assert.doesNotThrow(() => assertComplete?.(completeProbe()));
    for (const field of [
        'playlistId',
        'routeReadyEpochMs',
        'firstChannelVisibleEpochMs',
        'uiPaintedEpochMs',
        'terminalEpochMs',
    ] as const) {
        const incomplete = { ...completeProbe(), [field]: null };
        assert.throws(
            () => assertComplete?.(incomplete),
            /m3u-import-renderer-probe-incomplete/
        );
    }
    assert.throws(
        () =>
            assertComplete?.({
                ...completeProbe(),
                operationStartEpochMs: 0,
            }),
        /m3u-import-renderer-probe-incomplete/
    );
});

test('clears the harness heap sampler even when the renderer probe is missing', () => {
    const source = readSource(captureUrl);
    assert.ok(source);
    const stopBackgroundWork = source.indexOf('const stopBackgroundWork');
    const stopScheduling = source.indexOf(
        'stopSchedulingBackgroundWork()',
        stopBackgroundWork
    );
    const finalHeartbeat = source.indexOf(
        'await flushHeartbeat()',
        stopScheduling
    );
    const backgroundStop = source.indexOf(
        'await stopBackgroundWork()',
        source.indexOf('const stopCapture')
    );
    const probeStop = source.indexOf('probe = await stopProbe()', backgroundStop);

    assert.match(source, /clearInterval\(heapSampleTimer\)/);
    assert.ok(stopScheduling >= 0);
    assert.ok(finalHeartbeat > stopScheduling);
    assert.ok(backgroundStop >= 0);
    assert.ok(probeStop > backgroundStop);
    assert.match(source, /assertFixedGridRendererHeartbeatCoverage\(/);
});
