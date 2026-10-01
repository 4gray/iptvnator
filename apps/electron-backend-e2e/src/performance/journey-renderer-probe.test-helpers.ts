import type { JSDOM } from 'jsdom';

import {
    JOURNEY_IPC_SENTINEL_METHOD,
    journeyRendererProbeScript,
    type JourneyRendererProbeOptions,
    type JourneyRendererProbeState,
} from './journey-renderer-probe';

/**
 * jsdom fixtures shared by the renderer probe specs: fake performance
 * observers, a frozen bridge that records sentinel calls, and a wait for
 * every probe's post-paint cutoff.
 */
export interface FakeEntry {
    duration?: number;
    entryType: string;
    hadRecentInput?: boolean;
    sources?: {
        currentRect: { height: number; y: number };
        node: unknown;
        previousRect: { height: number; y: number };
    }[];
    startTime: number;
    value?: number;
}

export interface FakeObserver {
    disconnected: boolean;
    emit(entries: FakeEntry[]): void;
    queue: FakeEntry[];
    type: string | null;
}

export interface Fixture {
    readonly bridgeCalls: unknown[];
    readonly observers: FakeObserver[];
    /** The live state object inside the jsdom realm. */
    readonly rawState: () => JourneyRendererProbeState;
    /** A JSON clone, so assertions compare values across realms. */
    readonly state: () => JourneyRendererProbeState;
    readonly window: JSDOM['window'];
}

export function installFakePerformance(
    window: JSDOM['window'],
    observers: FakeObserver[]
): void {
    class FakePerformanceObserver implements FakeObserver {
        disconnected = false;
        queue: FakeEntry[] = [];
        type: string | null = null;
        constructor(
            private readonly callback: (list: {
                getEntries(): FakeEntry[];
            }) => void
        ) {
            observers.push(this);
        }
        observe(options: { type: string }): void {
            this.type = options.type;
        }
        takeRecords(): FakeEntry[] {
            const queued = this.queue;
            this.queue = [];
            return queued;
        }
        disconnect(): void {
            this.disconnected = true;
        }
        emit(entries: FakeEntry[]): void {
            this.callback({ getEntries: () => entries });
        }
    }
    Object.defineProperty(window, 'PerformanceObserver', {
        configurable: true,
        value: FakePerformanceObserver,
    });
    Object.defineProperty(window.performance, 'getEntriesByType', {
        configurable: true,
        value: (type: string) =>
            type === 'navigation'
                ? [{ domContentLoadedEventEnd: 100, loadEventEnd: 120 }]
                : [],
    });
    // jsdom never lays out, so visibility is "connected to the document".
    window.HTMLElement.prototype.getClientRects = function getClientRects(
        this: HTMLElement
    ) {
        return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    };
}

export function createFixtureFromDom(
    dom: JSDOM,
    options: JourneyRendererProbeOptions,
    bridge: boolean
): Fixture {
    const { window } = dom;
    const observers: FakeObserver[] = [];
    const bridgeCalls: unknown[] = [];
    installFakePerformance(window, observers);
    // tsx (esbuild keepNames) rewrites named inner functions as
    // `__name(fn, 'name')` when it transpiles the probe for this test runner.
    // Playwright's Babel transform, which serializes the probe for the real
    // browser, does not, so the shim is a test-runner concern only.
    Object.defineProperty(window, '__name', {
        configurable: true,
        value: (target: unknown) => target,
    });
    if (bridge) {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: Object.freeze({
                [JOURNEY_IPC_SENTINEL_METHOD]: (id: unknown) => {
                    bridgeCalls.push(id);
                    return Promise.resolve(null);
                },
                onSomething: () => undefined,
            }),
        });
    }
    window.eval(
        `(${journeyRendererProbeScript.toString()})(${JSON.stringify(options)})`
    );
    const rawState = (): JourneyRendererProbeState =>
        (window as unknown as Record<string, JourneyRendererProbeState>)[
            options.stateKey
        ] as JourneyRendererProbeState;
    liveStates.push(rawState);
    return {
        bridgeCalls,
        observers,
        rawState,
        state: () =>
            JSON.parse(JSON.stringify(rawState())) as JourneyRendererProbeState,
        window,
    };
}

/** Probes created by this file, so `settle` can wait for their cutoff. */
const liveStates: (() => JourneyRendererProbeState)[] = [];

/**
 * Waits `ms`, then until every probe that reached its terminal batch has also
 * passed the post-paint cutoff (a rAF plus a timer) and closed its settle
 * window. A fixed delay alone flakes when the harness runs all spec files in
 * parallel.
 */
export async function settle(ms = 40): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + 3_000;
    while (
        liveStates.some((read) => {
            const state = read();
            return (
                state.terminal !== null &&
                (!state.final ||
                    state.settle.status === 'pending' ||
                    state.idle.status === 'pending')
            );
        }) &&
        Date.now() < deadline
    ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
