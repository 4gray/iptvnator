import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import {
    assertJourneyRendererProbeState,
    createLaunchJourneyProbeOptions,
    JOURNEY_IPC_SENTINEL_ID,
    JOURNEY_IPC_SENTINEL_METHOD,
    JOURNEY_PROBE_STATE_KEY,
    journeyRendererProbeScript,
    type JourneyRendererProbeOptions,
    type JourneyRendererProbeState,
} from './journey-renderer-probe';

interface FakeEntry {
    duration?: number;
    entryType: string;
    hadRecentInput?: boolean;
    startTime: number;
    value?: number;
}

interface FakeObserver {
    disconnected: boolean;
    emit(entries: FakeEntry[]): void;
    queue: FakeEntry[];
    type: string | null;
}

interface Fixture {
    readonly bridgeCalls: unknown[];
    readonly observers: FakeObserver[];
    /** The live state object inside the jsdom realm. */
    readonly rawState: () => JourneyRendererProbeState;
    /** A JSON clone, so assertions compare values across realms. */
    readonly state: () => JourneyRendererProbeState;
    readonly window: JSDOM['window'];
}

const PAGE = `<!doctype html><html><head></head><body class="mat-app-background">
<div id="initial-splash" role="status"><span>IPTVnator</span></div>
<app-root></app-root></body></html>`;

function installFakePerformance(
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

function createFixture(
    overrides: Partial<JourneyRendererProbeOptions> & {
        bridge?: boolean;
        url?: string;
    } = {}
): Fixture {
    const {
        bridge = true,
        url = 'file:///dist/apps/web/workspace/dashboard',
        ...optionOverrides
    } = overrides;
    const dom = new JSDOM(PAGE, {
        pretendToBeVisual: true,
        runScripts: 'outside-only',
        url,
    });
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
    const options = {
        ...createLaunchJourneyProbeOptions(),
        ...optionOverrides,
    };
    window.eval(
        `(${journeyRendererProbeScript.toString()})(${JSON.stringify(options)})`
    );
    const rawState = (): JourneyRendererProbeState =>
        (window as unknown as Record<string, JourneyRendererProbeState>)[
            options.stateKey
        ] as JourneyRendererProbeState;
    return {
        bridgeCalls,
        observers,
        rawState,
        state: () =>
            JSON.parse(JSON.stringify(rawState())) as JourneyRendererProbeState,
        window,
    };
}

function settle(ms = 40): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderFirstCard(fixture: Fixture): void {
    const { document } = fixture.window;
    document.getElementById('initial-splash')?.remove();
    const rail = document.createElement('section');
    rail.setAttribute('data-test-id', 'dashboard-recent-sources-rail');
    document.querySelector('app-root')?.append(rail);
    const card = document.createElement('div');
    card.setAttribute('data-test-id', 'dashboard-recent-sources-rail-card');
    rail.append(card);
}

test('records install facts before any renderer script ran', () => {
    const fixture = createFixture();
    const state = fixture.state();
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.journey, 'launch');
    assert.equal(state.installed.readyState, 'loading');
    assert.equal(state.installed.scriptCount, 0);
    assert.equal(state.installed.bridgePresent, true);
    assert.equal(state.capabilities.observedTarget, 'documentElement');
    assert.equal(state.capabilities.layoutShift, true);
    assert.equal(state.capabilities.longTask, true);
    assert.deepEqual(state.invalidReasons, []);
    assert.equal(state.terminal, null);
    assert.deepEqual(
        fixture.observers.map((observer) => observer.type),
        ['layout-shift', 'longtask']
    );
});

test('installs once per document', () => {
    const fixture = createFixture();
    const first = fixture.rawState();
    fixture.window.eval(
        `(${journeyRendererProbeScript.toString()})(${JSON.stringify(createLaunchJourneyProbeOptions())})`
    );
    assert.equal(fixture.rawState(), first);
});

test('counts mutation records until the first card is visible after the splash is gone', async () => {
    const fixture = createFixture();
    const { document } = fixture.window;
    const appRoot = document.querySelector('app-root') as HTMLElement;
    appRoot.append(document.createElement('div'));
    appRoot.append(document.createElement('div'));
    appRoot.setAttribute('data-ready', '1');
    await settle();
    assert.equal(fixture.state().terminal, null);

    renderFirstCard(fixture);
    await settle();
    const state = fixture.state();
    assert.ok(state.terminal, 'terminal must be recorded');
    assert.equal(
        state.terminal.cardTestId,
        'dashboard-recent-sources-rail-card'
    );
    assert.equal(state.terminal.cardTag, 'div');
    assert.match(state.terminal.pathname, /\/workspace\/dashboard$/);
    // 2 appends + 1 attribute + splash removal + rail append + card append
    assert.equal(state.counters.domMutations, 6);
    assert.equal(state.final, true);
    assert.equal(typeof state.firstCardPaintEpochMs, 'number');
    assert.deepEqual(fixture.bridgeCalls, [JOURNEY_IPC_SENTINEL_ID]);
    assert.equal(state.sentinel.status, 'sent');
    assert.equal(
        state.navigation?.loadEventEndEpochMs,
        fixture.window.performance.timeOrigin + 120
    );
    assert.equal(
        state.capabilities.changeDetectionTicks,
        'unavailable-ng-global-not-published'
    );
    assert.ok(fixture.observers.every((observer) => observer.disconnected));

    appRoot.append(document.createElement('div'));
    await settle();
    assert.equal(fixture.state().counters.domMutations, 6);
    assert.doesNotThrow(() => assertJourneyRendererProbeState(fixture.state()));
});

test('sums layout shifts without recent input and counts long tasks over 50 ms up to the post-paint cutoff', async () => {
    const fixture = createFixture();
    const [layoutShift, longTask] = fixture.observers as [
        FakeObserver,
        FakeObserver,
    ];
    const now = () => fixture.window.performance.now();
    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now(),
            value: 0.25,
        },
        {
            entryType: 'layout-shift',
            hadRecentInput: true,
            startTime: now(),
            value: 5,
        },
    ]);
    longTask.emit([
        { duration: 80, entryType: 'longtask', startTime: now() },
        { duration: 50, entryType: 'longtask', startTime: now() },
    ]);
    // Entries still queued when the terminal frame closes the observers.
    layoutShift.queue.push(
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now(),
            value: 0.5,
        },
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now() + 60_000,
            value: 9,
        }
    );
    longTask.queue.push(
        { duration: 120, entryType: 'longtask', startTime: now() },
        { duration: 300, entryType: 'longtask', startTime: now() + 60_000 }
    );
    renderFirstCard(fixture);
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    // Delivered after the terminal batch, before the post-paint cutoff.
    assert.ok(fixture.rawState().terminal, 'terminal must be set');
    assert.equal(fixture.rawState().final, false);
    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now(),
            value: 0.125,
        },
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now() + 60_000,
            value: 7,
        },
    ]);
    longTask.emit([
        { duration: 64, entryType: 'longtask', startTime: now() },
        { duration: 500, entryType: 'longtask', startTime: now() + 60_000 },
    ]);
    await settle();
    const state = fixture.state();
    assert.equal(state.final, true);
    assert.ok(
        (state.firstCardPaintEpochMs ?? 0) >
            (state.terminal?.epochMs ?? Number.POSITIVE_INFINITY),
        'the cutoff is sampled after the terminal batch'
    );
    assert.equal(state.counters.layoutShiftScore, 0.875);
    assert.equal(state.counters.longTasks, 3);
    assert.deepEqual(state.longTaskDurationsMs, [80, 64, 120]);

    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now(),
            value: 1,
        },
    ]);
    longTask.emit([{ duration: 99, entryType: 'longtask', startTime: now() }]);
    assert.equal(fixture.state().counters.layoutShiftScore, 0.875);
    assert.equal(fixture.state().counters.longTasks, 3);
});

test('does not end while the splash is present, off the workspace route, or before a card is visible', async () => {
    const withSplash = createFixture();
    const rail = withSplash.window.document.createElement('div');
    rail.setAttribute('data-test-id', 'dashboard-recent-sources-rail-card');
    withSplash.window.document.querySelector('app-root')?.append(rail);
    await settle();
    assert.equal(withSplash.state().terminal, null);
    assert.deepEqual(withSplash.bridgeCalls, []);

    const offRoute = createFixture({ url: 'file:///dist/apps/web/index.html' });
    renderFirstCard(offRoute);
    await settle();
    assert.equal(offRoute.state().terminal, null);

    const noCard = createFixture();
    noCard.window.document.getElementById('initial-splash')?.remove();
    await settle();
    assert.equal(noCard.state().terminal, null);
    assert.throws(
        () => assertJourneyRendererProbeState(noCard.state()),
        /incomplete/
    );
});

test('reports a missing bridge instead of guessing the IPC boundary', async () => {
    const fixture = createFixture({ bridge: false });
    assert.equal(fixture.state().installed.bridgePresent, false);
    renderFirstCard(fixture);
    await settle();
    assert.equal(fixture.state().sentinel.status, 'bridge-missing');
    assert.throws(
        () => assertJourneyRendererProbeState(fixture.state()),
        /sentinel-bridge-missing/
    );
});

test('rejects a probe that was installed after the document started', async () => {
    const fixture = createFixture();
    const state = fixture.rawState() as { invalidReasons: string[] };
    state.invalidReasons.push('probe-installed-after-document-start');
    renderFirstCard(fixture);
    await settle();
    assert.throws(
        () => assertJourneyRendererProbeState(fixture.state()),
        /probe-installed-after-document-start/
    );
});

test('rejects a probe whose performance observers were unavailable instead of reporting zeros', async () => {
    const fixture = createFixture();
    const state = fixture.rawState() as {
        capabilities: { layoutShift: boolean; longTask: boolean };
    };
    state.capabilities.longTask = false;
    renderFirstCard(fixture);
    await settle();
    assert.equal(fixture.state().counters.longTasks, 0);
    assert.throws(
        () => assertJourneyRendererProbeState(fixture.state()),
        /observer-unavailable: longTask/
    );
    state.capabilities.layoutShift = false;
    assert.throws(
        () => assertJourneyRendererProbeState(fixture.state()),
        /observer-unavailable: layoutShift, longTask/
    );
});

test('launch options target the workspace source cards and the shared sentinel', () => {
    const options = createLaunchJourneyProbeOptions();
    assert.equal(options.stateKey, JOURNEY_PROBE_STATE_KEY);
    assert.equal(options.sentinelMethod, 'dbGetAppPlaylist');
    assert.equal(options.splashId, 'initial-splash');
    assert.equal(options.routeFragment, '/workspace');
    assert.match(options.cardSelector, /dashboard-recent-sources-rail-card/);
    assert.match(options.cardSelector, /app-playlist-item/);
});
