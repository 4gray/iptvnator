import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import {
    assertJourneyRendererProbeState,
    createLaunchJourneyProbeOptions,
    createOpenSourceJourneyProbeOptions,
    JOURNEY_CD_TICK_COUNTER_KEY,
    JOURNEY_IDLE_WINDOW_MS,
    JOURNEY_IPC_SENTINEL_ID,
    JOURNEY_IPC_SENTINEL_METHOD,
    JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
    JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY,
    JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
    JOURNEY_PROBE_STATE_KEY,
    JOURNEY_SETTLE_CAP_MS,
    JOURNEY_SETTLE_QUIET_MS,
    JOURNEY_SETTLE_ROOT_SELECTOR,
    journeyRendererProbeScript,
    type JourneyRendererProbeOptions,
} from './journey-renderer-probe';
import {
    createFixtureFromDom,
    settle,
    type FakeEntry,
    type FakeObserver,
    type Fixture,
} from './journey-renderer-probe.test-helpers';

const PAGE = `<!doctype html><html><head></head><body class="mat-app-background">
<div id="initial-splash" role="status"><span>IPTVnator</span></div>
<app-root><main class="workspace-content"></main></app-root></body></html>`;

/** Short settle timers so the launch fixtures do not wait 500 ms each. */
const FAST_SETTLE = {
    capMs: 1_000,
    quietMs: 30,
    rootSelector: JOURNEY_SETTLE_ROOT_SELECTOR,
} as const;

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
        {
            ...createLaunchJourneyProbeOptions(null),
            settle: FAST_SETTLE,
            ...optionOverrides,
        },
        bridge
    );
}

/**
 * The electron-performance build's tick counter, installed in the fixture's
 * window the way `environment.performance.ts` installs it before bootstrap.
 */
function installTickCounter(fixture: Fixture): { count: number } {
    const counter = { count: 0 };
    Object.defineProperty(fixture.window, JOURNEY_CD_TICK_COUNTER_KEY, {
        configurable: true,
        value: counter,
    });
    return counter;
}

function renderFirstCard(fixture: Fixture): void {
    const { document } = fixture.window;
    document.getElementById('initial-splash')?.remove();
    const rail = document.createElement('section');
    rail.setAttribute('data-test-id', 'dashboard-recent-sources-rail');
    document.querySelector('main.workspace-content')?.append(rail);
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
        `(${journeyRendererProbeScript.toString()})(${JSON.stringify(createLaunchJourneyProbeOptions(null))})`
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
    // No tick counter in this build: reported, never zero.
    assert.equal(
        state.capabilities.changeDetectionTicks,
        'unavailable-counter-missing'
    );
    assert.equal(state.counters.changeDetectionTicks, null);
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

function layoutShift(
    startTime: number,
    value: number,
    hadRecentInput = false
): FakeEntry {
    return { entryType: 'layout-shift', hadRecentInput, startTime, value };
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs = 3_000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('waitFor timed out');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test('keeps summing shifts without recent input after the first-card cutoff until the workspace content is quiet', async () => {
    const fixture = createFixture({
        settle: { ...FAST_SETTLE, capMs: 5_000, quietMs: 80 },
    });
    const [observer] = fixture.observers as [FakeObserver];
    const now = () => fixture.window.performance.now();
    const content = fixture.window.document.querySelector(
        'main.workspace-content'
    ) as HTMLElement;
    observer.emit([layoutShift(now(), 0.25)]);
    renderFirstCard(fixture);
    await waitFor(() => fixture.rawState().final);
    const cutoff = fixture.state();
    assert.equal(cutoff.counters.layoutShiftScore, 0.25);
    assert.equal(cutoff.settle.status, 'pending');
    assert.equal(cutoff.settle.observedTarget, 'root');
    assert.equal(cutoff.counters.layoutShiftScoreSettled, 0);
    assert.equal(observer.disconnected, false);

    // A skeleton rail that resolved empty collapses about 15 ms after the
    // first card and pulls the rails below upwards (#1738).
    const rail = fixture.window.document.createElement('lib-dashboard-rail');
    const railSection = fixture.window.document.createElement('section');
    railSection.className = 'rail';
    railSection.setAttribute('data-test-id', 'dashboard-favorites-rail');
    rail.append(railSection);
    const collapse = {
        ...layoutShift(now(), 0.5),
        sources: [
            {
                currentRect: { height: 220, y: 300 },
                node: rail,
                previousRect: { height: 220, y: 540 },
            },
        ],
    };
    observer.emit([collapse, layoutShift(now(), 0.3, true)]);
    for (let step = 0; step < 3; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        content.append(fixture.window.document.createElement('div'));
    }
    // Queued, not yet delivered, when the settle point is sampled.
    observer.queue.push(
        layoutShift(now(), 0.125),
        layoutShift(now() + 60_000, 9)
    );
    // Outside the settle root: does not keep the window open.
    fixture.window.document.body.setAttribute('data-late', '1');
    await settle();
    const state = fixture.state();
    assert.equal(state.settle.status, 'quiet');
    assert.equal(state.settle.domMutations, 3);
    assert.ok(state.settle.epochMs !== null && state.settle.epochMs > 0);
    assert.ok(
        state.settle.epochMs - (state.settle.lastMutationEpochMs ?? 0) >= 75,
        'the quiet period restarts at the last mutation'
    );
    assert.equal(state.counters.layoutShiftScoreSettled, 0.875);
    // Only shifts after the cutoff are attributed; input-flagged ones are not.
    assert.deepEqual(
        state.settle.lateShifts.map((shift) => [shift.value, shift.sources]),
        [
            [
                0.5,
                [
                    {
                        deltaHeight: 0,
                        deltaY: -240,
                        node: 'lib-dashboard-rail[data-test-id="dashboard-favorites-rail"]',
                    },
                ],
            ],
            [0.125, []],
        ]
    );
    assert.ok(
        state.settle.lateShifts.every((shift) => shift.afterFirstCardMs > 0)
    );
    // The first-card counters were frozen at the cutoff.
    assert.equal(state.counters.layoutShiftScore, 0.25);
    assert.equal(state.counters.recentInputLayoutShiftScore, 0);
    assert.equal(observer.disconnected, true);
    assert.doesNotThrow(() => assertJourneyRendererProbeState(state));

    observer.emit([layoutShift(now(), 1)]);
    content.append(fixture.window.document.createElement('div'));
    await settle();
    assert.equal(fixture.state().counters.layoutShiftScoreSettled, 0.875);
    assert.equal(fixture.state().settle.domMutations, 3);
});

test('the cap ends the settle window while the workspace content keeps mutating', async () => {
    const fixture = createFixture({
        settle: { ...FAST_SETTLE, capMs: 250, quietMs: 150 },
    });
    const [observer] = fixture.observers as [FakeObserver];
    const now = () => fixture.window.performance.now();
    const { document } = fixture.window;
    renderFirstCard(fixture);
    await waitFor(() => fixture.rawState().final);
    const content = document.querySelector('main.workspace-content');
    const ticker = setInterval(() => {
        content?.setAttribute('data-tick', String(now()));
    }, 10);
    try {
        observer.emit([layoutShift(now(), 0.0625)]);
        await waitFor(() => fixture.rawState().settle.status !== 'pending');
        observer.emit([layoutShift(now(), 0.5)]);
        await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
        clearInterval(ticker);
    }
    const state = fixture.state();
    assert.equal(state.settle.status, 'cap');
    assert.ok(state.settle.domMutations > 0);
    assert.ok(
        (state.settle.epochMs ?? 0) - (state.firstCardPaintEpochMs ?? 0) >= 245,
        'the cap is measured from the first-card cutoff'
    );
    assert.equal(state.counters.layoutShiftScoreSettled, 0.0625);
    assert.doesNotThrow(() => assertJourneyRendererProbeState(state));
});

test('a late cap timer ends the window at its scheduled deadline', async () => {
    const fixture = createFixture({
        settle: { ...FAST_SETTLE, capMs: 100, quietMs: 60_000 },
    });
    const [observer] = fixture.observers as [FakeObserver];
    const now = () => fixture.window.performance.now();
    renderFirstCard(fixture);
    await waitFor(() => fixture.rawState().final);
    const cutoffMs =
        (fixture.rawState().firstCardPaintEpochMs ?? 0) -
        fixture.window.performance.timeOrigin;
    observer.emit([layoutShift(now(), 0.25)]);
    // Hold the main thread past the cap so its timer runs late, and shift
    // the layout after the deadline while it is held.
    while (now() < cutoffMs + 250) {
        // busy
    }
    observer.emit([layoutShift(now(), 0.5)]);
    observer.queue.push(layoutShift(now(), 1));
    await waitFor(() => fixture.rawState().settle.status !== 'pending');
    const state = fixture.state();
    assert.equal(state.settle.status, 'cap');
    const settledAfterCutoff =
        (state.settle.epochMs ?? 0) - (state.firstCardPaintEpochMs ?? 0);
    assert.ok(
        settledAfterCutoff >= 100 && settledAfterCutoff < 150,
        `settle point at the deadline, not when the timer ran (${settledAfterCutoff} ms)`
    );
    assert.equal(state.counters.layoutShiftScoreSettled, 0.25);
});

test('watches the document element when the settle root is missing', async () => {
    const fixture = createFixture({
        settle: { ...FAST_SETTLE, rootSelector: 'app-missing-root' },
    });
    renderFirstCard(fixture);
    await settle();
    const state = fixture.state();
    assert.equal(state.settle.observedTarget, 'documentElement');
    assert.equal(state.settle.status, 'quiet');
});

test('refuses a probe whose settle window is still open', async () => {
    const fixture = createFixture({
        settle: { ...FAST_SETTLE, capMs: 60_000, quietMs: 60_000 },
    });
    renderFirstCard(fixture);
    await waitFor(() => fixture.rawState().final);
    assert.throws(
        () => assertJourneyRendererProbeState(fixture.state()),
        /settle-pending/
    );
    // Mark the window closed so later tests' `settle()` does not wait on it,
    // and stop its timers so they do not keep the runner alive.
    fixture.rawState().settle.status = 'cap';
    fixture.window.close();
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

test('counts change-detection ticks from document start until the terminal batch', async () => {
    const fixture = createFixture();
    const counter = installTickCounter(fixture);
    counter.count += 3;
    renderFirstCard(fixture);
    // The tick that rendered the card ran before the observer's microtask.
    counter.count += 1;
    await settle();
    counter.count += 5;
    const state = fixture.state();
    assert.equal(state.capabilities.changeDetectionTicks, 'counted');
    assert.equal(state.counters.changeDetectionTicks, 4);
    assert.equal(state.idle.status, 'disabled');
    assert.equal(state.idle.ticks, null);
});

test('counts ticks and mutations in the idle window that opens at the settle point', async () => {
    const fixture = createFixture({ idle: { durationMs: 80 } });
    const counter = installTickCounter(fixture);
    renderFirstCard(fixture);
    counter.count += 2;
    await waitFor(() => fixture.rawState().idle.startEpochMs !== null);
    const opened = fixture.state();
    assert.equal(opened.idle.status, 'pending');
    assert.ok(opened.settle.epochMs !== null);
    assert.ok((opened.idle.startEpochMs ?? 0) >= opened.settle.epochMs);
    assert.throws(
        () => assertJourneyRendererProbeState(opened),
        /idle-pending/
    );
    counter.count += 7;
    fixture.window.document.body.append(
        fixture.window.document.createElement('div')
    );
    await waitFor(() => fixture.rawState().idle.status === 'done');
    counter.count += 100;
    const state = fixture.state();
    assert.equal(state.counters.changeDetectionTicks, 2);
    assert.equal(state.idle.ticks, 7);
    assert.equal(state.idle.domMutations, 1);
    assert.ok(
        (state.idle.endEpochMs ?? 0) - (state.idle.startEpochMs ?? 0) >= 79
    );
    assert.doesNotThrow(() => assertJourneyRendererProbeState(state));
});

test('launch options add the idle window only when asked', () => {
    assert.equal(createLaunchJourneyProbeOptions(null).idle, undefined);
    assert.deepEqual(
        createLaunchJourneyProbeOptions(JOURNEY_IDLE_WINDOW_MS).idle,
        { durationMs: 30_000 }
    );
    assert.equal(
        createLaunchJourneyProbeOptions(null).cdTickCounterKey,
        '__iptvnatorCdTicks'
    );
});

test('launch options target the workspace source cards and the shared sentinel', () => {
    const options = createLaunchJourneyProbeOptions(null);
    assert.equal(options.stateKey, JOURNEY_PROBE_STATE_KEY);
    assert.equal(options.sentinelMethod, 'cancelSourceProbe');
    assert.equal(options.splashId, 'initial-splash');
    assert.equal(options.routeFragment, '/workspace');
    assert.match(options.cardSelector, /dashboard-recent-sources-rail-card/);
    assert.match(options.cardSelector, /app-playlist-item/);
    assert.deepEqual(options.settle, {
        capMs: JOURNEY_SETTLE_CAP_MS,
        quietMs: JOURNEY_SETTLE_QUIET_MS,
        rootSelector: 'main.workspace-content',
    });
    assert.equal(JOURNEY_SETTLE_QUIET_MS, 500);
    assert.equal(JOURNEY_SETTLE_CAP_MS, 3_000);
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
    assert.equal(
        state.capabilities.changeDetectionTicks,
        'unavailable-counter-missing'
    );
    assert.doesNotThrow(() => assertJourneyRendererProbeState(state));

    // One start per armed probe.
    document.body.append(document.createElement('div'));
    fixture.card.click();
    await settle();
    assert.equal(fixture.bridgeCalls.length, 2);
});

test('counts ticks from the click, not from document start', async () => {
    const fixture = createOpenSourceFixture();
    const counter = installTickCounter(fixture);
    counter.count = 40;
    fixture.card.addEventListener('click', () => {
        counter.count += 1;
        openSource(fixture);
        counter.count += 1;
    });
    fixture.card.click();
    await settle();
    counter.count += 10;
    const state = fixture.state();
    assert.equal(state.capabilities.changeDetectionTicks, 'counted');
    assert.equal(state.counters.changeDetectionTicks, 2);
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
    // J2 has no settle window: the observers close at the cutoff.
    assert.equal(state.settle.status, 'disabled');
    assert.equal(state.counters.layoutShiftScoreSettled, 0);
    assert.ok(fixture.observers.every((observer) => observer.disconnected));
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
