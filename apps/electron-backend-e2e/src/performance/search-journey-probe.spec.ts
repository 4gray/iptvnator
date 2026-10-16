import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import {
    JOURNEY_CD_TICK_COUNTER_KEY,
    JOURNEY_IPC_SENTINEL_METHOD,
    JOURNEY_PLAYBACK_PROBE_STATE_KEY,
    JOURNEY_PROBE_STATE_KEY,
} from './journey-renderer-probe';
import {
    installFakePerformance,
    type FakeObserver,
} from './journey-renderer-probe.test-helpers';
import {
    assertSearchJourneyProbeState,
    createSearchJourneyProbeOptions,
    SEARCH_JOURNEY_END_SENTINEL_ID,
    SEARCH_JOURNEY_PROBE_STATE_KEY,
    SEARCH_JOURNEY_START_SENTINEL_ID,
    searchJourneyProbeScript,
    type SearchJourneyProbeOptions,
    type SearchJourneyProbeState,
} from './search-journey-probe';

const QUERY = 'system';

interface SearchFixture {
    readonly bridgeCalls: unknown[];
    readonly input: HTMLInputElement;
    readonly observers: FakeObserver[];
    readonly results: HTMLElement;
    readonly state: () => SearchJourneyProbeState;
    readonly ticks: { count: number };
    readonly window: JSDOM['window'];
}

function createSearchFixture(
    overrides: Partial<SearchJourneyProbeOptions> = {}
): SearchFixture {
    const dom = new JSDOM(
        `<!doctype html><html><body><app-root>
<app-workspace-shell-header><label class="search-field">
<input type="search" /></label></app-workspace-shell-header>
<button id="elsewhere">x</button>
<app-search-results><div class="results-container"></div></app-search-results>
</app-root></body></html>`,
        {
            pretendToBeVisual: true,
            runScripts: 'outside-only',
            url: 'http://localhost/workspace/search',
        }
    );
    const { window } = dom;
    const observers: FakeObserver[] = [];
    const bridgeCalls: unknown[] = [];
    installFakePerformance(window, observers);
    // See journey-renderer-probe.test-helpers.ts: tsx keeps names.
    Object.defineProperty(window, '__name', {
        configurable: true,
        value: (target: unknown) => target,
    });
    Object.defineProperty(window, 'electron', {
        configurable: true,
        value: Object.freeze({
            [JOURNEY_IPC_SENTINEL_METHOD]: (id: unknown) => {
                bridgeCalls.push(id);
                return Promise.resolve(null);
            },
        }),
    });
    const ticks = { count: 40 };
    Object.defineProperty(window, JOURNEY_CD_TICK_COUNTER_KEY, {
        configurable: true,
        value: ticks,
    });
    const options = {
        ...createSearchJourneyProbeOptions(QUERY),
        quietMs: 30,
        ...overrides,
    };
    window.eval(
        `(${searchJourneyProbeScript.toString()})(${JSON.stringify(options)})`
    );
    const { document } = window;
    return {
        bridgeCalls,
        input: document.querySelector('input') as HTMLInputElement,
        observers,
        results: document.querySelector('.results-container') as HTMLElement,
        state: () =>
            JSON.parse(
                JSON.stringify(
                    (window as unknown as Record<string, unknown>)[
                        options.stateKey
                    ]
                )
            ) as SearchJourneyProbeState,
        ticks,
        window,
    };
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A keydown in the input plus what the shell renders for it. */
async function typeKey(fixture: SearchFixture, key: string): Promise<void> {
    fixture.input.dispatchEvent(
        new fixture.window.KeyboardEvent('keydown', { bubbles: true, key })
    );
    fixture.input.setAttribute('data-value', fixture.input.value + key);
    fixture.input.value += key;
    await wait(0);
}

function setQuery(fixture: SearchFixture, query: string): void {
    fixture.window.history.replaceState(
        null,
        '',
        `/workspace/search?q=${encodeURIComponent(query)}`
    );
}

function addCards(fixture: SearchFixture, count: number): void {
    for (let index = 0; index < count; index += 1) {
        fixture.results.append(
            fixture.window.document.createElement('app-content-card')
        );
    }
}

async function waitForFinal(fixture: SearchFixture): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!fixture.state().final && Date.now() < deadline) {
        await wait(5);
    }
}

test('search options use their own state key, sentinels and the query length', () => {
    const options = createSearchJourneyProbeOptions(QUERY);
    assert.equal(options.keystrokes, 6);
    assert.equal(options.query, QUERY);
    assert.equal(options.quietMs, 200);
    assert.equal(options.stateKey, SEARCH_JOURNEY_PROBE_STATE_KEY);
    assert.notEqual(options.stateKey, JOURNEY_PROBE_STATE_KEY);
    assert.notEqual(options.stateKey, JOURNEY_PLAYBACK_PROBE_STATE_KEY);
    assert.equal(options.startSentinelId, SEARCH_JOURNEY_START_SENTINEL_ID);
    assert.equal(options.endSentinelId, SEARCH_JOURNEY_END_SENTINEL_ID);
    assert.equal(options.sentinelMethod, JOURNEY_IPC_SENTINEL_METHOD);
    assert.equal(options.cdTickCounterKey, JOURNEY_CD_TICK_COUNTER_KEY);
});

test('starts at the first keydown in the search box and buckets work per key', async () => {
    const fixture = createSearchFixture();
    fixture.results.setAttribute('data-before', '1');
    await wait(0);
    // A key elsewhere does not start the journey.
    fixture.window.document.getElementById('elsewhere')?.dispatchEvent(
        new fixture.window.KeyboardEvent('keydown', {
            bubbles: true,
            key: 'x',
        })
    );
    assert.equal(fixture.state().start, null);
    assert.deepEqual(fixture.bridgeCalls, []);

    for (const key of QUERY) {
        fixture.ticks.count += 1;
        await typeKey(fixture, key);
    }
    let state = fixture.state();
    assert.equal(state.preStart.domMutations, 1);
    assert.deepEqual(fixture.bridgeCalls, [SEARCH_JOURNEY_START_SENTINEL_ID]);
    assert.deepEqual(
        state.keystrokes.map((key) => key.key),
        [...QUERY]
    );
    assert.deepEqual(
        state.keystrokes.map((key) => key.ticks),
        [41, 42, 43, 44, 45, 46]
    );
    // One attribute record per key, each in its own bucket.
    assert.deepEqual(state.domMutationsByKeystroke, [1, 1, 1, 1, 1, 1]);

    // The debounced term lands: results for the final query.
    setQuery(fixture, QUERY);
    fixture.ticks.count += 4;
    addCards(fixture, 3);
    await waitForFinal(fixture);
    state = assertSearchJourneyProbeState(fixture.state());
    assert.equal(state.settle.status, 'quiet');
    assert.equal(state.settle.query, QUERY);
    assert.equal(state.settle.cardCount, 3);
    assert.equal(state.settle.ticks, 50);
    assert.equal(state.capabilities.changeDetectionTicks, 'counted');
    assert.deepEqual(state.domMutationsByKeystroke, [1, 1, 1, 1, 1, 4]);
    assert.equal(state.counters.domMutations, 9);
    assert.equal(state.firstResult?.query, QUERY);
    assert.equal(state.firstResult?.cardCount, 3);
    assert.ok(
        (state.settle.confirmedEpochMs ?? 0) - (state.settle.epochMs ?? 0) >= 25
    );
    assert.deepEqual(fixture.bridgeCalls, [
        SEARCH_JOURNEY_START_SENTINEL_ID,
        SEARCH_JOURNEY_END_SENTINEL_ID,
    ]);
});

test('does not settle on results for an intermediate term or while loading', async () => {
    const fixture = createSearchFixture();
    for (const key of QUERY) {
        await typeKey(fixture, key);
    }
    // Results of an earlier term are a first result, not the settle.
    setQuery(fixture, 'syst');
    addCards(fixture, 2);
    await wait(80);
    let state = fixture.state();
    assert.equal(state.final, false);
    assert.equal(state.firstResult?.query, 'syst');

    // The final term's spinner keeps the window closed.
    setQuery(fixture, QUERY);
    const spinner = fixture.window.document.createElement('div');
    spinner.className = 'loading-state';
    fixture.window.document
        .querySelector('app-search-results')
        ?.append(spinner);
    await wait(80);
    assert.equal(fixture.state().final, false);

    spinner.remove();
    await waitForFinal(fixture);
    state = assertSearchJourneyProbeState(fixture.state());
    assert.equal(state.settle.query, QUERY);
    assert.equal(state.settle.cardCount, 2);
});

test('a mutation inside the quiet window restarts it', async () => {
    const fixture = createSearchFixture({ quietMs: 60 });
    for (const key of QUERY) {
        await typeKey(fixture, key);
    }
    setQuery(fixture, QUERY);
    addCards(fixture, 1);
    await wait(30);
    addCards(fixture, 1);
    const lastMutationAt = Date.now();
    await waitForFinal(fixture);
    const state = assertSearchJourneyProbeState(fixture.state());
    assert.equal(state.settle.cardCount, 2);
    assert.ok(Date.now() - lastMutationAt >= 55);
});

test('fails the iteration when results never settle', async () => {
    const fixture = createSearchFixture({ settleTimeoutMs: 40 });
    for (const key of QUERY) {
        await typeKey(fixture, key);
    }
    await waitForFinal(fixture);
    const state = fixture.state();
    assert.equal(state.settle.status, 'timeout');
    assert.throws(
        () => assertSearchJourneyProbeState(state),
        /search-journey-probe-invalid: settle-timeout/
    );
});

test('flags a keystroke beyond the expected count', async () => {
    const fixture = createSearchFixture({ keystrokes: 2 });
    await typeKey(fixture, 'a');
    await typeKey(fixture, 'b');
    await typeKey(fixture, 'c');
    assert.deepEqual(fixture.state().invalidReasons, ['unexpected-keystroke']);
});

test('counts shifts and long tasks from the first key until the settle only', async () => {
    const fixture = createSearchFixture();
    const shifts = fixture.observers.find(
        (observer) => observer.type === 'layout-shift'
    );
    const tasks = fixture.observers.find(
        (observer) => observer.type === 'longtask'
    );
    assert.ok(shifts && tasks);
    // Buffered launch entries before the first key are dropped.
    shifts.emit([{ entryType: 'layout-shift', startTime: 0, value: 0.5 }]);
    tasks.emit([{ duration: 60, entryType: 'longtask', startTime: 0 }]);
    // jsdom's clock starts with the fixture: let that task end first.
    await wait(100);
    for (const key of QUERY) {
        await typeKey(fixture, key);
    }
    const now = fixture.window.performance.now();
    shifts.emit([
        {
            entryType: 'layout-shift',
            hadRecentInput: true,
            startTime: now,
            value: 0.02,
        },
        { entryType: 'layout-shift', startTime: now, value: 0.01 },
    ]);
    tasks.emit([
        { duration: 30, entryType: 'longtask', startTime: now },
        { duration: 80, entryType: 'longtask', startTime: now },
    ]);
    setQuery(fixture, QUERY);
    addCards(fixture, 1);
    await waitForFinal(fixture);
    const state = assertSearchJourneyProbeState(fixture.state());
    assert.equal(state.counters.recentInputLayoutShiftScore, 0.02);
    assert.equal(state.counters.layoutShiftScore, 0.01);
    assert.equal(state.counters.longTasks, 1);
    assert.deepEqual(state.longTaskDurationsMs, [80]);
    assert.ok(shifts.disconnected && tasks.disconnected);
});

test('rejects a state without the tick counter or the end sentinel', () => {
    assert.throws(
        () => assertSearchJourneyProbeState({ schemaVersion: 1 }),
        /search-journey-probe-incomplete/
    );
    const base = {
        capabilities: { layoutShift: true, longTask: true },
        final: true,
        invalidReasons: [],
        schemaVersion: 1,
        sentinel: { status: 'bridge-missing' },
        start: { sentinelStatus: 'sent' },
    };
    assert.throws(
        () => assertSearchJourneyProbeState(base),
        /search-journey-probe-sentinel-bridge-missing/
    );
    assert.throws(
        () =>
            assertSearchJourneyProbeState({
                ...base,
                capabilities: { layoutShift: false, longTask: true },
                sentinel: { status: 'sent' },
            }),
        /search-journey-probe-observer-unavailable/
    );
});
