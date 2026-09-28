import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import {
    assertJourneyRendererProbeState,
    createLaunchJourneyProbeOptions,
    createOpenSourceJourneyProbeOptions,
    JOURNEY_IPC_SENTINEL_ID,
    JOURNEY_IPC_SENTINEL_METHOD,
    JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
    JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY,
    JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
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
    return createFixtureFromDom(
        dom,
        { ...createLaunchJourneyProbeOptions(), ...optionOverrides },
        bridge
    );
}

function createFixtureFromDom(
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
 * passed the post-paint cutoff (a rAF plus a timer). A fixed delay alone
 * flakes when the harness runs all spec files in parallel.
 */
async function settle(ms = 40): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + 2_000;
    while (
        liveStates.some((read) => {
            const state = read();
            return state.terminal !== null && !state.final;
        }) &&
        Date.now() < deadline
    ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
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
    assert.equal(options.sentinelMethod, 'cancelSourceProbe');
    assert.equal(options.splashId, 'initial-splash');
    assert.equal(options.routeFragment, '/workspace');
    assert.match(options.cardSelector, /dashboard-recent-sources-rail-card/);
    assert.match(options.cardSelector, /app-playlist-item/);
});

// J2 "Open a source": the probe is armed in a loaded document and starts at
// the click on the portal card.

const DASHBOARD_URL = 'http://localhost/workspace/dashboard';

function createOpenSourceFixture(
    overrides: { bridge?: boolean } = {}
): Fixture & { readonly card: HTMLElement } {
    const dom = new JSDOM(
        `<!doctype html><html><body><app-root>
<app-workspace-context-panel></app-workspace-context-panel>
<main></main></app-root></body></html>`,
        {
            pretendToBeVisual: true,
            runScripts: 'outside-only',
            url: DASHBOARD_URL,
        }
    );
    const card = dom.window.document.createElement('div');
    card.setAttribute('data-test-id', 'dashboard-recent-sources-rail-card');
    card.innerHTML = '<a><span class="title">Mock Xtream Portal</span></a>';
    dom.window.document.querySelector('main')?.append(card);
    const fixture = createFixtureFromDom(
        dom,
        createOpenSourceJourneyProbeOptions(),
        overrides.bridge ?? true
    );
    return { ...fixture, card };
}

function openSource(
    fixture: Fixture,
    parts: { categories?: boolean; items?: boolean } = {}
): void {
    const { categories = true, items = true } = parts;
    const { document, history } = fixture.window;
    history.pushState({}, '', '/workspace/xtreams/playlist-1/vod');
    document.querySelector('main')?.replaceChildren();
    if (categories) {
        const category = document.createElement('div');
        category.className = 'category-item';
        document.querySelector('app-workspace-context-panel')?.append(category);
    }
    if (items) {
        const grid = document.createElement('app-grid-list');
        grid.append(
            document.createElement('mat-card'),
            document.createElement('mat-card')
        );
        document.querySelector('main')?.append(grid);
    }
}

test('a click-started probe only tracks activity before the click inside the start selector', async () => {
    const fixture = createOpenSourceFixture();
    const { document } = fixture.window;
    assert.deepEqual(fixture.state().invalidReasons, []);
    assert.equal(fixture.state().start, null);

    document.body.append(document.createElement('div'));
    await settle();
    document.body.click();
    await settle();
    const before = fixture.state();
    assert.equal(before.start, null);
    assert.equal(before.counters.domMutations, 0);
    assert.equal(before.preStart.domMutations, 1);
    assert.equal(typeof before.preStart.lastMutationEpochMs, 'number');
    assert.deepEqual(fixture.bridgeCalls, []);
    // Already on a page with cards and categories: nothing ends before the
    // start.
    assert.equal(before.terminal, null);
});

test('the click sends the start sentinel before the app sees it and the end sentinel when the first page is visible', async () => {
    const fixture = createOpenSourceFixture();
    const { document } = fixture.window;
    const order: string[] = [];
    fixture.card.addEventListener('click', () => {
        order.push(`app:${fixture.bridgeCalls.length}`);
        openSource(fixture);
    });
    (fixture.card.querySelector('.title') as HTMLElement).click();
    await settle();
    const state = fixture.state();
    assert.deepEqual(order, ['app:1']);
    assert.deepEqual(fixture.bridgeCalls, [
        JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
        JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
    ]);
    assert.ok(state.start, 'start must be recorded');
    assert.equal(state.start.sentinelStatus, 'sent');
    assert.equal(
        state.start.targetTestId,
        'dashboard-recent-sources-rail-card'
    );
    assert.equal(state.start.pathname, '/workspace/dashboard');
    assert.ok(state.start.epochMs <= state.start.listenerEpochMs);
    assert.ok(state.terminal, 'terminal must be recorded');
    assert.equal(state.terminal.pathname, '/workspace/xtreams/playlist-1/vod');
    assert.equal(state.terminal.cardTag, 'mat-card');
    assert.equal(state.terminal.cardCount, 2);
    assert.deepEqual(state.terminal.companionCounts, [1]);
    // main emptied (1) + category (1) + grid (1)
    assert.equal(state.counters.domMutations, 3);
    assert.equal(state.navigation, null);
    assert.equal(state.final, true);
    assert.ok(state.terminal.epochMs >= state.start.epochMs);
    assert.doesNotThrow(() => assertJourneyRendererProbeState(state));

    // One start per armed probe.
    document.body.append(document.createElement('div'));
    fixture.card.click();
    await settle();
    assert.equal(fixture.bridgeCalls.length, 2);
});

test('the first page needs the category list as well as the items', async () => {
    const fixture = createOpenSourceFixture();
    fixture.card.addEventListener('click', () =>
        openSource(fixture, { categories: false })
    );
    fixture.card.click();
    await settle();
    assert.equal(fixture.state().terminal, null);
    const category = fixture.window.document.createElement('div');
    category.className = 'category-item';
    fixture.window.document
        .querySelector('app-workspace-context-panel')
        ?.append(category);
    await settle();
    const state = fixture.state();
    assert.ok(state.terminal);
    assert.equal(state.counters.domMutations, 3);

    const skeletons = createOpenSourceFixture();
    skeletons.card.addEventListener('click', () => {
        openSource(skeletons, { items: false });
        const skeleton = skeletons.window.document.createElement('div');
        skeleton.className = 'grid-skeleton-card';
        skeletons.window.document.querySelector('main')?.append(skeleton);
    });
    skeletons.card.click();
    await settle();
    assert.equal(skeletons.state().terminal, null);
});

test('drops performance entries from before the click and keeps recent-input shifts apart', async () => {
    const fixture = createOpenSourceFixture();
    const [layoutShift, longTask] = fixture.observers as [
        FakeObserver,
        FakeObserver,
    ];
    const now = () => fixture.window.performance.now();
    const beforeClick = now() - 1;
    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: beforeClick,
            value: 3,
        },
    ]);
    longTask.emit([
        { duration: 400, entryType: 'longtask', startTime: beforeClick },
    ]);
    fixture.card.click();
    await settle(5);
    // Delivered after the click but started before it (buffered J1 entries).
    layoutShift.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: beforeClick,
            value: 2,
        },
        {
            entryType: 'layout-shift',
            hadRecentInput: true,
            startTime: now(),
            value: 0.25,
        },
        {
            entryType: 'layout-shift',
            hadRecentInput: false,
            startTime: now(),
            value: 0.125,
        },
    ]);
    longTask.emit([
        // A buffered J1 task that ended before the click.
        {
            duration: 250,
            entryType: 'longtask',
            startTime: beforeClick - 300,
        },
        { duration: 90, entryType: 'longtask', startTime: now() },
    ]);
    openSource(fixture);
    await settle();
    const state = fixture.state();
    assert.equal(state.final, true);
    assert.equal(state.counters.layoutShiftScore, 0.125);
    assert.equal(state.counters.recentInputLayoutShiftScore, 0.25);
    assert.equal(state.counters.longTasks, 1);
    assert.deepEqual(state.longTaskDurationsMs, [90]);
});

test('counts the long task that dispatches the click although it began before the event', async () => {
    const fixture = createOpenSourceFixture();
    const [, longTask] = fixture.observers as [FakeObserver, FakeObserver];
    const now = () => fixture.window.performance.now();
    fixture.card.addEventListener('click', () => openSource(fixture));
    fixture.card.click();
    const clickMs =
        (fixture.rawState().start?.epochMs ?? 0) -
        fixture.window.performance.timeOrigin;
    longTask.emit([
        // Began 20 ms before the click stamp and ran through it: the task
        // that dispatched the click and rendered the page.
        { duration: 120, entryType: 'longtask', startTime: clickMs - 20 },
        // Ended before the click: earlier work, not part of the journey.
        { duration: 60, entryType: 'longtask', startTime: clickMs - 100 },
        { duration: 70, entryType: 'longtask', startTime: now() },
    ]);
    await settle();
    const state = fixture.state();
    assert.equal(state.final, true);
    assert.equal(state.counters.longTasks, 2);
    assert.deepEqual(state.longTaskDurationsMs, [120, 70]);
});

test('rejects a click start whose sentinel could not be sent', async () => {
    const fixture = createOpenSourceFixture({ bridge: false });
    fixture.card.addEventListener('click', () => openSource(fixture));
    fixture.card.click();
    await settle();
    const state = fixture.state();
    assert.equal(state.start?.sentinelStatus, 'bridge-missing');
    assert.throws(
        () => assertJourneyRendererProbeState(state),
        /sentinel-bridge-missing/
    );
    const started = {
        ...state,
        sentinel: { epochMs: 1, status: 'sent' as const },
    };
    assert.throws(
        () => assertJourneyRendererProbeState(started),
        /start-sentinel-bridge-missing/
    );
});

test('open-source options start at the portal card and end on the source route', () => {
    const options = createOpenSourceJourneyProbeOptions();
    assert.equal(options.journey, 'open-source');
    assert.equal(options.stateKey, JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY);
    assert.notEqual(options.stateKey, JOURNEY_PROBE_STATE_KEY);
    assert.equal(options.sentinelId, JOURNEY_OPEN_SOURCE_END_SENTINEL_ID);
    assert.equal(
        options.startClick?.sentinelId,
        JOURNEY_OPEN_SOURCE_START_SENTINEL_ID
    );
    assert.notEqual(options.sentinelId, JOURNEY_IPC_SENTINEL_ID);
    assert.match(
        options.startClick?.selector ?? '',
        /dashboard-recent-sources-rail-card/
    );
    assert.match(options.startClick?.selector ?? '', /app-playlist-item/);
    assert.equal(options.routeFragment, '/workspace/xtreams/');
    assert.match(options.cardSelector, /app-grid-list mat-card/);
    assert.match(options.cardSelector, /channel-item/);
    assert.deepEqual(options.companionSelectors, [
        'app-workspace-context-panel .category-item',
    ]);
});
