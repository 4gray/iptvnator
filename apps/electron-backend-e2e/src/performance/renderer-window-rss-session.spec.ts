/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
    createRendererProcessRssCaptureApi,
    type RendererProcessRssCapture,
    type RendererProcessRssCaptureApi,
} from './renderer-process-rss-capture';

interface RendererWindowIdentity {
    readonly browserWindowId: number;
    readonly webContentsId: number;
}

interface RendererWindowRssSessionMetrics {
    readonly responsiveEvents: number;
    readonly rss: RendererProcessRssCapture;
    readonly unresponsiveEvents: number;
    readonly windowIdentity: RendererWindowIdentity;
}

interface RendererWindowRssSession {
    detach(): void;
    sample(): RendererWindowRssSessionMetrics;
    snapshot(): RendererWindowRssSessionMetrics;
}

interface RendererWindowRssSessionFactory {
    create(input: {
        readonly browserWindowFromId: (
            browserWindowId: number
        ) => FakeBrowserWindow | null;
        readonly browserWindowId: number;
        readonly getAppMetrics: () => readonly unknown[];
        readonly rendererRssApi: RendererProcessRssCaptureApi;
        readonly webContentsId: number;
    }): RendererWindowRssSession;
}

interface RendererWindowRssSessionModule {
    createRendererWindowRssSessionApi?: () => RendererWindowRssSessionFactory;
}

class FakeWebContents {
    pidReads = 0;
    throwOnPidRead = false;

    constructor(
        readonly id: number,
        public pid: number
    ) {}

    getOSProcessId(): number {
        this.pidReads += 1;
        if (this.throwOnPidRead) {
            throw new Error('renderer unavailable');
        }
        return this.pid;
    }
}

class FakeBrowserWindow extends EventEmitter {
    constructor(
        readonly id: number,
        readonly webContents: FakeWebContents
    ) {
        super();
    }
}

const BROWSER_WINDOW_ID = 7;
const WEB_CONTENTS_ID = 70;
const RENDERER_PID = 700;
const CREATION_TIME = 1_721_234_567_890;

const sessionModulePromise = import(
    new URL('./renderer-window-rss-session.ts', import.meta.url).href
)
    .then((module) => module as RendererWindowRssSessionModule)
    .catch(() => null);

function processMetric(
    pid: number,
    workingSetSize: number,
    creationTime = CREATION_TIME
): unknown {
    return {
        creationTime,
        memory: { workingSetSize },
        pid,
        type: 'Tab',
    };
}

async function restoreSerializableFactory(): Promise<RendererWindowRssSessionFactory> {
    const module = await sessionModulePromise;
    assert.ok(module, 'renderer window RSS session module must exist');
    const factory = module.createRendererWindowRssSessionApi;
    assert.equal(typeof factory, 'function');

    const source = factory.toString();
    const restoredFactory = Function(
        `"use strict"; return (${source});`
    )() as () => RendererWindowRssSessionFactory;
    return restoredFactory();
}

test('scopes renderer RSS and window events to the exact BrowserWindow', async () => {
    const api = await restoreSerializableFactory();
    const targetWebContents = new FakeWebContents(
        WEB_CONTENTS_ID,
        RENDERER_PID
    );
    const targetWindow = new FakeBrowserWindow(
        BROWSER_WINDOW_ID,
        targetWebContents
    );
    const decoyWebContents = new FakeWebContents(71, 701);
    const decoyWindow = new FakeBrowserWindow(8, decoyWebContents);
    let targetExternalEvents = 0;
    let decoyExternalEvents = 0;
    targetWindow.on('unresponsive', () => {
        targetExternalEvents += 1;
    });
    decoyWindow.on('unresponsive', () => {
        decoyExternalEvents += 1;
    });

    let appMetricReads = 0;
    const targetWorkingSets = [1_000, 1_500];
    const session = api.create({
        browserWindowFromId: (id) =>
            id === BROWSER_WINDOW_ID ? targetWindow : decoyWindow,
        browserWindowId: BROWSER_WINDOW_ID,
        getAppMetrics: () => {
            const targetWorkingSet = targetWorkingSets[
                Math.min(appMetricReads, 1)
            ] as number;
            appMetricReads += 1;
            return [
                processMetric(701, 9_999_999, CREATION_TIME + 1),
                processMetric(RENDERER_PID, targetWorkingSet),
            ];
        },
        rendererRssApi: createRendererProcessRssCaptureApi(),
        webContentsId: WEB_CONTENTS_ID,
    });

    decoyWindow.emit('unresponsive');
    decoyWindow.emit('responsive');
    targetWindow.emit('unresponsive');
    targetWindow.emit('responsive');
    const sampled = session.sample();

    assert.deepEqual(sampled, {
        rss: {
            identity: {
                creationTime: CREATION_TIME,
                pid: RENDERER_PID,
            },
            missingSampleCount: 0,
            peakRssBytes: 1_536_000,
            unavailableReason: null,
            validSampleCount: 2,
        },
        responsiveEvents: 1,
        unresponsiveEvents: 1,
        windowIdentity: {
            browserWindowId: BROWSER_WINDOW_ID,
            webContentsId: WEB_CONTENTS_ID,
        },
    });
    assert.equal(targetWebContents.pidReads, 2);
    assert.equal(decoyWebContents.pidReads, 0);
    assert.equal(appMetricReads, 2);
    assert.equal(targetExternalEvents, 1);
    assert.equal(decoyExternalEvents, 1);
    assert.equal(targetWindow.listenerCount('unresponsive'), 2);
    assert.equal(decoyWindow.listenerCount('unresponsive'), 1);

    session.detach();
    assert.equal(targetWindow.listenerCount('unresponsive'), 1);
    assert.equal(targetWindow.listenerCount('responsive'), 0);
    assert.equal(decoyWindow.listenerCount('unresponsive'), 1);
    targetWindow.emit('unresponsive');
    decoyWindow.emit('unresponsive');
    assert.equal(session.snapshot().unresponsiveEvents, 1);
    assert.equal(targetExternalEvents, 2);
    assert.equal(decoyExternalEvents, 2);
});

test('rejects a missing or mismatched BrowserWindow before attaching listeners', async () => {
    const api = await restoreSerializableFactory();
    const targetWindow = new FakeBrowserWindow(
        BROWSER_WINDOW_ID,
        new FakeWebContents(WEB_CONTENTS_ID, RENDERER_PID)
    );
    let appMetricReads = 0;
    const baseInput = {
        browserWindowId: BROWSER_WINDOW_ID,
        getAppMetrics: () => {
            appMetricReads += 1;
            return [processMetric(RENDERER_PID, 1_000)];
        },
        rendererRssApi: createRendererProcessRssCaptureApi(),
        webContentsId: WEB_CONTENTS_ID,
    };

    assert.throws(
        () =>
            api.create({
                ...baseInput,
                browserWindowFromId: () => null,
            }),
        /renderer-browser-window-missing/
    );
    assert.throws(
        () =>
            api.create({
                ...baseInput,
                browserWindowFromId: () =>
                    new FakeBrowserWindow(
                        BROWSER_WINDOW_ID + 1,
                        targetWindow.webContents
                    ),
            }),
        /renderer-browser-window-identity-mismatch/
    );
    assert.throws(
        () =>
            api.create({
                ...baseInput,
                browserWindowFromId: () =>
                    new FakeBrowserWindow(
                        BROWSER_WINDOW_ID,
                        new FakeWebContents(WEB_CONTENTS_ID + 1, RENDERER_PID)
                    ),
            }),
        /renderer-web-contents-identity-mismatch/
    );
    assert.equal(targetWindow.listenerCount('unresponsive'), 0);
    assert.equal(targetWindow.listenerCount('responsive'), 0);
    assert.equal(targetWindow.webContents.pidReads, 0);
    assert.equal(appMetricReads, 0);
});

test('keeps PID and metric failures sticky while sampling the exact target every time', async () => {
    const api = await restoreSerializableFactory();
    const targetWebContents = new FakeWebContents(
        WEB_CONTENTS_ID,
        RENDERER_PID
    );
    const targetWindow = new FakeBrowserWindow(
        BROWSER_WINDOW_ID,
        targetWebContents
    );
    let appMetricReads = 0;
    let metrics: readonly unknown[] = [processMetric(RENDERER_PID, 1_000)];
    const session = api.create({
        browserWindowFromId: () => targetWindow,
        browserWindowId: BROWSER_WINDOW_ID,
        getAppMetrics: () => {
            appMetricReads += 1;
            return metrics;
        },
        rendererRssApi: createRendererProcessRssCaptureApi(),
        webContentsId: WEB_CONTENTS_ID,
    });

    targetWebContents.pid = RENDERER_PID + 1;
    metrics = [processMetric(RENDERER_PID + 1, 5_000, CREATION_TIME + 1)];
    const invalid = session.sample();
    assert.deepEqual(invalid.rss, {
        identity: {
            creationTime: CREATION_TIME,
            pid: RENDERER_PID,
        },
        missingSampleCount: 0,
        peakRssBytes: null,
        unavailableReason: 'renderer-process-identity-changed',
        validSampleCount: 1,
    });

    targetWebContents.pid = RENDERER_PID;
    metrics = [processMetric(RENDERER_PID, 10_000)];
    assert.deepEqual(session.sample().rss, invalid.rss);
    assert.equal(targetWebContents.pidReads, 3);
    assert.equal(appMetricReads, 3);

    const missingMetricSession = api.create({
        browserWindowFromId: () => targetWindow,
        browserWindowId: BROWSER_WINDOW_ID,
        getAppMetrics: () => [],
        rendererRssApi: createRendererProcessRssCaptureApi(),
        webContentsId: WEB_CONTENTS_ID,
    });
    assert.deepEqual(missingMetricSession.snapshot().rss, {
        identity: null,
        missingSampleCount: 1,
        peakRssBytes: null,
        unavailableReason: 'renderer-process-metric-missing-at-start',
        validSampleCount: 0,
    });

    targetWebContents.throwOnPidRead = true;
    const invalidPidSession = api.create({
        browserWindowFromId: () => targetWindow,
        browserWindowId: BROWSER_WINDOW_ID,
        getAppMetrics: () => [processMetric(RENDERER_PID, 1_000)],
        rendererRssApi: createRendererProcessRssCaptureApi(),
        webContentsId: WEB_CONTENTS_ID,
    });
    assert.equal(
        invalidPidSession.snapshot().rss.unavailableReason,
        'renderer-os-pid-invalid'
    );

    session.detach();
    missingMetricSession.detach();
    invalidPidSession.detach();
});
