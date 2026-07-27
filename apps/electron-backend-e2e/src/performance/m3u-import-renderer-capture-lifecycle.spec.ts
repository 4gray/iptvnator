/* eslint-disable playwright/expect-expect -- This is a Node assertion-based lifecycle test. */
import { RENDERER_PERFORMANCE_PHASE_HOOK_KEY } from '@iptvnator/shared/logging';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startM3uImportRendererCapture } from './m3u-import-renderer-capture';
import { M3U_IMPORT_RENDERER_STATE_KEY } from './m3u-import-renderer-probe';

test('idempotently disposes failed-iteration timers, probe, trace stream, listeners, and CDP session', async () => {
    const browser = installFakeProbeEnvironment();
    const outputDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-renderer-capture-dispose-')
    );
    const session = new FakeCdpSession();
    const control = {
        click: async () => undefined,
        fill: async () => undefined,
        first: () => control,
        getByRole: () => control,
        isDisabled: async () => false,
        last: () => control,
        waitFor: async () => undefined,
    };
    const page = {
        ...browser.page,
        context: () => ({
            newCDPSession: async () => session,
        }),
        getByRole: () => control,
        locator: () => control,
    };

    try {
        const capture = await startM3uImportRendererCapture(
            page as never,
            {
                diagnostic: true,
                outputDirectory,
                playlistTitle: 'Synthetic',
                playlistUrl:
                    'http://127.0.0.1:43210/synthetic-performance.m3u',
            }
        );
        assert.equal(session.listenerCount('Tracing.dataCollected'), 1);
        assert.equal(session.listenerCount('Tracing.tracingComplete'), 1);

        await capture.dispose();
        await capture.dispose();

        assert.equal(session.detachCount, 1);
        assert.equal(session.listenerCount('Tracing.dataCollected'), 0);
        assert.equal(session.listenerCount('Tracing.tracingComplete'), 0);
        assert.equal(browser.readState(), undefined);
        const heapSamplesAfterDispose = session.heapUsageCalls;
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(session.heapUsageCalls, heapSamplesAfterDispose);
        assert.deepEqual(
            JSON.parse(
                await readFile(
                    join(outputDirectory, 'renderer.trace.json'),
                    'utf8'
                )
            ),
            { traceEvents: [] }
        );
    } finally {
        browser.cleanup();
        await rm(outputDirectory, { force: true, recursive: true });
    }
});

test('failed-iteration disposal does not await a wedged renderer or CDP detach', async () => {
    const browser = installFakeProbeEnvironment();
    const outputDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-renderer-capture-wedged-')
    );
    const session = new FakeCdpSession({ hangDetach: true });
    let evaluateCalls = 0;
    const page = createFakePage(browser, session, async (callback, argument) => {
        evaluateCalls += 1;
        if (evaluateCalls > 1) {
            return new Promise<never>(() => undefined);
        }
        return browser.page.evaluate(callback, argument);
    });

    try {
        const capture = await startM3uImportRendererCapture(page as never, {
            diagnostic: false,
            outputDirectory,
            playlistTitle: 'Synthetic',
            playlistUrl:
                'http://127.0.0.1:43210/synthetic-performance.m3u',
        });
        const outcome = await Promise.race([
            capture.dispose().then(() => 'disposed'),
            new Promise<'timeout'>((resolve) =>
                setTimeout(() => resolve('timeout'), 150)
            ),
        ]);

        assert.equal(outcome, 'disposed');
        assert.equal(session.detachCount, 1);
        const heapSamplesAfterDispose = session.heapUsageCalls;
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(session.heapUsageCalls, heapSamplesAfterDispose);
    } finally {
        browser.cleanup();
        await rm(outputDirectory, { force: true, recursive: true });
    }
});

test('rolls back partially started capture when Chromium tracing rejects', async () => {
    const browser = installFakeProbeEnvironment();
    const outputDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-renderer-capture-startup-')
    );
    const session = new FakeCdpSession({ failMethod: 'Tracing.start' });
    const intervalToken = Object.freeze({});
    const setIntervalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'setInterval'
    );
    const clearIntervalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'clearInterval'
    );
    let clearIntervalCalls = 0;
    Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        value: () => intervalToken,
        writable: true,
    });
    Object.defineProperty(globalThis, 'clearInterval', {
        configurable: true,
        value: (token: unknown) => {
            if (token === intervalToken) {
                clearIntervalCalls += 1;
            }
        },
        writable: true,
    });

    try {
        await assert.rejects(
            startM3uImportRendererCapture(
                createFakePage(browser, session) as never,
                {
                    diagnostic: true,
                    outputDirectory,
                    playlistTitle: 'Synthetic',
                    playlistUrl:
                        'http://127.0.0.1:43210/synthetic-performance.m3u',
                }
            ),
            /synthetic Tracing\.start failure/
        );

        assert.equal(clearIntervalCalls, 1);
        assert.equal(session.detachCount, 1);
        assert.equal(session.listenerCount('Tracing.dataCollected'), 0);
        assert.equal(session.listenerCount('Tracing.tracingComplete'), 0);
        assert.equal(browser.readState(), undefined);
        assert.deepEqual(
            JSON.parse(
                await readFile(
                    join(outputDirectory, 'renderer.trace.json'),
                    'utf8'
                )
            ),
            { traceEvents: [] }
        );
    } finally {
        restoreGlobal('setInterval', setIntervalDescriptor);
        restoreGlobal('clearInterval', clearIntervalDescriptor);
        browser.cleanup();
        await rm(outputDirectory, { force: true, recursive: true });
    }
});

class FakeCdpSession extends EventEmitter {
    detachCount = 0;
    heapUsageCalls = 0;

    constructor(
        private readonly options: {
            readonly failMethod?: string;
            readonly hangDetach?: boolean;
        } = {}
    ) {
        super();
    }

    async detach(): Promise<void> {
        this.detachCount += 1;
        if (this.options.hangDetach) {
            return new Promise<never>(() => undefined);
        }
    }

    async send(method: string): Promise<Record<string, unknown>> {
        if (method === this.options.failMethod) {
            throw new Error(`synthetic ${method} failure`);
        }
        if (method === 'Runtime.getHeapUsage') {
            this.heapUsageCalls += 1;
            return { usedSize: 1_024 };
        }
        return {};
    }
}

function installFakeProbeEnvironment() {
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    let nextFrameId = 1;
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
    replaceGlobal('performance', { now: () => 0, timeOrigin: 0 });
    replaceGlobal('PerformanceObserver', FakePerformanceObserver);
    replaceGlobal('cancelAnimationFrame', () => undefined);
    replaceGlobal('requestAnimationFrame', () => nextFrameId++);
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
    };
}

function createFakePage(
    browser: ReturnType<typeof installFakeProbeEnvironment>,
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
        context: () => ({
            newCDPSession: async () => session,
        }),
        evaluate,
        getByRole: () => control,
        locator: () => control,
    };
}

function restoreGlobal(
    key: 'clearInterval' | 'setInterval',
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, key);
    }
}
