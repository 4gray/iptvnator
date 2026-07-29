/* eslint-disable playwright/expect-expect -- This is a Node assertion-based lifecycle test. */
import { RENDERER_PERFORMANCE_PHASE_HOOK_KEY } from '@iptvnator/shared/logging';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startM3uImportRendererCapture } from './m3u-import-renderer-capture';
import { M3U_IMPORT_RENDERER_STATE_KEY } from './m3u-import-renderer-probe';

test('waits for an in-flight heartbeat and flushes its next deadline once', async () => {
    const browser = installFakeBrowser();
    const outputDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-renderer-heartbeat-stop-')
    );
    const session = new FakeCdpSession();
    const timerToken = Object.freeze({});
    const descriptors = snapshotGlobals([
        'setTimeout',
        'clearTimeout',
        'document',
        'HTMLButtonElement',
    ]);
    let scheduledHeartbeat: (() => void) | null = null;
    let releaseHeartbeat!: () => void;
    const heartbeatGate = new Promise<void>((resolve) => {
        releaseHeartbeat = resolve;
    });
    const deliveredDeadlines: number[] = [];
    class FakeButton {
        readonly disabled = false;
        readonly textContent = 'Add playlist';
        click(): undefined {
            return undefined;
        }
    }
    const button = new FakeButton();
    replaceGlobal('HTMLButtonElement', FakeButton);
    replaceGlobal('document', {
        querySelector: () => null,
        querySelectorAll: () => [
            { querySelectorAll: () => [button] },
        ],
    });
    replaceGlobal('setTimeout', (callback: () => void) => {
        scheduledHeartbeat = callback;
        return timerToken;
    });
    replaceGlobal('clearTimeout', () => undefined);
    const page = createFakePage(
        browser,
        session,
        async (callback, argument) => {
            const heartbeat = argument as unknown as {
                firstDeadlineEpochMs?: number;
            };
            const result = await browser.page.evaluate(callback, argument);
            if (typeof heartbeat.firstDeadlineEpochMs === 'number') {
                deliveredDeadlines.push(heartbeat.firstDeadlineEpochMs);
                if (deliveredDeadlines.length === 1) {
                    await heartbeatGate;
                }
            }
            return result;
        }
    );

    try {
        const capture = await startM3uImportRendererCapture(page as never, {
            diagnostic: false,
            outputDirectory,
            playlistTitle: 'Synthetic',
            playlistUrl:
                'http://127.0.0.1:43210/synthetic-performance.m3u',
        });
        browser.setNow(100);
        await capture.triggerImport();
        browser.setNow(150);
        assert.ok(scheduledHeartbeat);
        scheduledHeartbeat();
        Object.assign(browser.readState() as object, {
            firstChannelVisibleEpochMs: 220,
            playlistId: 'synthetic-id',
            routeReadyEpochMs: 200,
            terminalEpochMs: 251,
            uiPaintedEpochMs: 251,
        });
        browser.setNow(300);
        const stopPromise = capture.stop();
        await Promise.resolve();
        releaseHeartbeat();
        const metrics = await stopPromise;

        assert.deepEqual(deliveredDeadlines, [150, 200]);
        assert.deepEqual(metrics.probe.heartbeatDelaysMs, [0, 51, 1]);
    } finally {
        restoreGlobals(descriptors);
        browser.cleanup();
        await rm(outputDirectory, { force: true, recursive: true });
    }
});

class FakeCdpSession extends EventEmitter {
    async detach(): Promise<void> {
        return undefined;
    }

    async send(method: string): Promise<Record<string, unknown>> {
        return method === 'Runtime.getHeapUsage'
            ? { usedSize: 1_024 }
            : {};
    }
}

function installFakeBrowser() {
    const descriptors = snapshotGlobals([
        'performance',
        'PerformanceObserver',
        'cancelAnimationFrame',
        'requestAnimationFrame',
        'location',
        'document',
    ]);
    let nextFrameId = 1;
    let nowMs = 0;
    class FakePerformanceObserver {
        static readonly supportedEntryTypes = ['longtask'];
        disconnect(): undefined {
            return undefined;
        }
        observe(): undefined {
            return undefined;
        }
        takeRecords(): PerformanceEntry[] {
            return [];
        }
    }
    replaceGlobal('performance', { now: () => nowMs, timeOrigin: 0 });
    replaceGlobal('PerformanceObserver', FakePerformanceObserver);
    replaceGlobal('cancelAnimationFrame', () => undefined);
    replaceGlobal('requestAnimationFrame', () => nextFrameId++);
    replaceGlobal('location', { pathname: '/' });
    replaceGlobal('document', { querySelector: () => null });

    return {
        cleanup: () => {
            restoreGlobals(descriptors);
            Reflect.deleteProperty(
                globalThis,
                Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY)
            );
            Reflect.deleteProperty(
                globalThis,
                M3U_IMPORT_RENDERER_STATE_KEY
            );
        },
        page: {
            evaluate: async (
                callback: (argument: never) => unknown,
                argument: never
            ) => callback(argument),
        },
        readState: () =>
            (globalThis as Record<string, unknown>)[
                M3U_IMPORT_RENDERER_STATE_KEY
            ],
        setNow: (value: number) => {
            nowMs = value;
        },
    };
}

function createFakePage(
    browser: ReturnType<typeof installFakeBrowser>,
    session: FakeCdpSession,
    evaluate = browser.page.evaluate
) {
    const control = {
        click: async () => undefined,
        fill: async () => undefined,
        first: () => control,
        getByRole: () => control,
        isDisabled: async () => false,
        last: () => control,
        waitFor: async () => undefined,
    };
    return {
        ...browser.page,
        context: () => ({ newCDPSession: async () => session }),
        evaluate,
        getByRole: () => control,
        locator: () => control,
    };
}

function snapshotGlobals(
    keys: readonly string[]
): Map<string, PropertyDescriptor | undefined> {
    return new Map(
        keys.map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ])
    );
}

function replaceGlobal(key: string, value: unknown): void {
    Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
    });
}

function restoreGlobals(
    descriptors: ReadonlyMap<string, PropertyDescriptor | undefined>
): void {
    for (const [key, descriptor] of descriptors) {
        if (descriptor) {
            Object.defineProperty(globalThis, key, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, key);
        }
    }
}
