import type { Page } from '@playwright/test';

import {
    JOURNEY_CD_TICK_COUNTER_KEY,
    JOURNEY_IPC_SENTINEL_METHOD,
} from './journey-renderer-probe';

/**
 * Renderer-side probe for J4 "Search" (docs/architecture/performance-journeys.md).
 *
 * Armed in the loaded `/workspace/search` document after the header search
 * input has focus. A capture-phase `keydown` listener on `window`, which runs
 * before every listener of the app, stamps each keystroke in the input; the
 * first one starts the journey and sends the start sentinel
 * (`cancelSourceProbe`, as in J2 and J3). DOM mutation records and
 * change-detection ticks are bucketed by the keystroke they follow, so the
 * debounce behaviour is visible per key.
 *
 * End: after the last expected keystroke, the results for the final term are
 * shown (URL `q` equals the query, a result card is visible and no loading
 * state is rendered) and then no DOM mutation arrives for `quietMs`. The
 * settled moment is the last mutation before that quiet window; the counters
 * run until the quiet window is confirmed, when the end sentinel is sent. A
 * plain "quiet after the last keystroke" would close inside the shell's
 * debounce before any query ran. Without a settle by `settleTimeoutMs`
 * after the last keystroke the iteration is invalid.
 *
 * The script must stay self-contained: Playwright serializes it with
 * `toString()`, so it may only use its argument and browser globals.
 */
export const SEARCH_JOURNEY_PROBE_STATE_KEY = '__iptvnatorJourneySearchProbe';
export const SEARCH_JOURNEY_PROBE_SCHEMA_VERSION = 1;
export const SEARCH_JOURNEY_START_SENTINEL_ID =
    '__iptvnator-journey-search-start__';
export const SEARCH_JOURNEY_END_SENTINEL_ID =
    '__iptvnator-journey-search-end__';
/** The workspace shell header's search box. */
export const SEARCH_JOURNEY_INPUT_SELECTOR =
    'app-workspace-shell-header .search-field input[type="search"]';
/** A rendered global search result (grouped or flat). */
export const SEARCH_JOURNEY_RESULT_SELECTOR =
    'app-search-results .results-container app-content-card';
/** The search layout's spinner while a query runs. */
export const SEARCH_JOURNEY_LOADING_SELECTOR =
    'app-search-results .loading-state';
export const SEARCH_JOURNEY_ROUTE_PATH = '/workspace/search';
export const SEARCH_JOURNEY_QUIET_MS = 200;
export const SEARCH_JOURNEY_SETTLE_TIMEOUT_MS = 15_000;

export interface SearchJourneyProbeOptions {
    readonly cdTickCounterKey: string;
    readonly endSentinelId: string;
    readonly inputSelector: string;
    /** Keystrokes the test types; the settle waits for the last one. */
    readonly keystrokes: number;
    readonly loadingSelector: string;
    /** Term the URL `q` must carry when the results count as final. */
    readonly query: string;
    readonly quietMs: number;
    readonly resultSelector: string;
    /** The route the results must be on; the renderer path ends with it. */
    readonly routePath: string;
    readonly sentinelMethod: string;
    /** Hard limit from the last keystroke to the settle. */
    readonly settleTimeoutMs: number;
    readonly startSentinelId: string;
    readonly stateKey: string;
}

export interface SearchJourneyProbeKeystroke {
    /** `min(event.timeStamp, listener time)` as epoch milliseconds. */
    readonly epochMs: number;
    readonly key: string;
    /** Running tick total at the keydown, before the app handles it. */
    readonly ticks: number | null;
}

export type SentinelStatus = 'bridge-missing' | 'failed' | 'not-sent' | 'sent';

export interface SearchJourneyProbeState {
    readonly capabilities: {
        changeDetectionTicks:
            'counted' | 'pending' | 'unavailable-counter-missing';
        layoutShift: boolean;
        longTask: boolean;
    };
    readonly counters: {
        domMutations: number;
        layoutShiftScore: number;
        longTasks: number;
        /** Shifts with `hadRecentInput === true`; typing is input. */
        recentInputLayoutShiftScore: number;
    };
    /** Mutation records after each keystroke, until the next or the end. */
    readonly domMutationsByKeystroke: number[];
    final: boolean;
    /** First batch with a visible result card, for any term. */
    firstResult: {
        readonly cardCount: number;
        readonly epochMs: number;
        readonly query: string | null;
    } | null;
    readonly invalidReasons: string[];
    readonly keystrokes: SearchJourneyProbeKeystroke[];
    readonly longTaskDurationsMs: number[];
    readonly preStart: {
        domMutations: number;
        lastMutationEpochMs: number | null;
    };
    readonly schemaVersion: number;
    sentinel: { epochMs: number | null; status: SentinelStatus };
    settle: {
        cardCount: number;
        /** When the quiet window was confirmed; the counters stop here. */
        confirmedEpochMs: number | null;
        /** Last mutation batch before the quiet window: "settled". */
        epochMs: number | null;
        query: string | null;
        status: 'pending' | 'quiet' | 'timeout';
        ticks: number | null;
    };
    start: {
        readonly epochMs: number;
        readonly pathname: string;
        readonly sentinelStatus: SentinelStatus;
    } | null;
}

export function searchJourneyProbeScript(
    options: SearchJourneyProbeOptions
): void {
    const target = globalThis as unknown as Record<string, unknown>;
    if (target[options.stateKey] !== undefined) {
        return;
    }
    const epoch = (): number => performance.timeOrigin + performance.now();
    const bridge = target['electron'] as Record<string, unknown> | undefined;
    const state: SearchJourneyProbeState = {
        capabilities: {
            changeDetectionTicks: 'pending',
            layoutShift: false,
            longTask: false,
        },
        counters: {
            domMutations: 0,
            layoutShiftScore: 0,
            longTasks: 0,
            recentInputLayoutShiftScore: 0,
        },
        domMutationsByKeystroke: [],
        final: false,
        firstResult: null,
        invalidReasons: [],
        keystrokes: [],
        longTaskDurationsMs: [],
        preStart: { domMutations: 0, lastMutationEpochMs: null },
        schemaVersion: 1,
        sentinel: { epochMs: null, status: 'not-sent' },
        settle: {
            cardCount: 0,
            confirmedEpochMs: null,
            epochMs: null,
            query: null,
            status: 'pending',
            ticks: null,
        },
        start: null,
    };
    target[options.stateKey] = state;
    const readTicks = (): number | null => {
        const counter = target[options.cdTickCounterKey] as
            { count?: unknown } | undefined;
        return typeof counter?.count === 'number' ? counter.count : null;
    };
    const callSentinel = (id: string): SentinelStatus => {
        const method = bridge?.[options.sentinelMethod];
        if (typeof method !== 'function') return 'bridge-missing';
        try {
            void Promise.resolve(method.call(bridge, id)).catch(
                () => undefined
            );
            return 'sent';
        } catch {
            return 'failed';
        }
    };
    const readQuery = (): string | null =>
        new URLSearchParams(location.search).get('q');
    const visibleCards = (): number => {
        let count = 0;
        for (const card of Array.from(
            document.querySelectorAll(options.resultSelector)
        )) {
            if (card.getClientRects().length > 0) count += 1;
        }
        return count;
    };

    // Entries before the first keystroke belong to the launch (buffered
    // entries included) and are dropped.
    let fromEpochMs = Number.POSITIVE_INFINITY;
    const shifts: PerformanceEntry[] = [];
    const tasks: PerformanceEntry[] = [];
    const observe = (
        type: string,
        sink: PerformanceEntry[]
    ): PerformanceObserver | null => {
        try {
            const observer = new PerformanceObserver((list) => {
                if (!state.final) sink.push(...list.getEntries());
            });
            observer.observe({ type, buffered: true });
            return observer;
        } catch {
            return null;
        }
    };
    const shiftObserver = observe('layout-shift', shifts);
    const taskObserver = observe('longtask', tasks);
    state.capabilities.layoutShift = shiftObserver !== null;
    state.capabilities.longTask = taskObserver !== null;

    const countEntries = (untilEpochMs: number): void => {
        if (shiftObserver) shifts.push(...shiftObserver.takeRecords());
        if (taskObserver) tasks.push(...taskObserver.takeRecords());
        shiftObserver?.disconnect();
        taskObserver?.disconnect();
        for (const entry of shifts) {
            const shift = entry as PerformanceEntry & {
                hadRecentInput?: boolean;
                value?: number;
            };
            const at = performance.timeOrigin + entry.startTime;
            if (
                typeof shift.value !== 'number' ||
                at < fromEpochMs ||
                at > untilEpochMs
            ) {
                continue;
            }
            if (shift.hadRecentInput === true) {
                state.counters.recentInputLayoutShiftScore += shift.value;
            } else {
                state.counters.layoutShiftScore += shift.value;
            }
        }
        // A task overlaps the window when it ends after the first keydown:
        // the task that dispatched it still counts.
        for (const entry of tasks) {
            const at = performance.timeOrigin + entry.startTime;
            if (
                entry.duration <= 50 ||
                at + entry.duration < fromEpochMs ||
                at > untilEpochMs
            ) {
                continue;
            }
            state.counters.longTasks += 1;
            state.longTaskDurationsMs.push(entry.duration);
        }
    };

    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMutationEpochMs: number | null = null;
    const accept = (count: number): void => {
        if (count === 0) return;
        if (state.start === null) {
            state.preStart.domMutations += count;
            state.preStart.lastMutationEpochMs = epoch();
            return;
        }
        state.counters.domMutations += count;
        const bucket = state.keystrokes.length - 1;
        state.domMutationsByKeystroke[bucket] =
            (state.domMutationsByKeystroke[bucket] ?? 0) + count;
        lastMutationEpochMs = epoch();
    };
    const ready = (): boolean =>
        location.pathname.endsWith(options.routePath) &&
        readQuery() === options.query &&
        document.querySelector(options.loadingSelector) === null &&
        visibleCards() > 0;
    const end = (status: 'quiet' | 'timeout'): void => {
        if (state.settle.status !== 'pending') return;
        clearTimeout(quietTimer);
        clearTimeout(timeoutTimer);
        accept(mutationObserver.takeRecords().length);
        mutationObserver.disconnect();
        const confirmedEpochMs = epoch();
        const ticks = readTicks();
        state.settle = {
            cardCount: visibleCards(),
            confirmedEpochMs,
            epochMs: lastMutationEpochMs,
            query: readQuery(),
            status,
            ticks,
        };
        if (status === 'timeout') {
            // What the ready condition saw, so a timeout says which part
            // never held.
            const input = document.querySelector(options.inputSelector);
            state.invalidReasons.push(
                `settle-timeout ${JSON.stringify({
                    cards: visibleCards(),
                    input:
                        input instanceof HTMLInputElement ? input.value : null,
                    loading:
                        document.querySelector(options.loadingSelector) !==
                        null,
                    path: location.pathname.slice(-40),
                    q: readQuery(),
                    view:
                        document.querySelector(
                            'app-search-results .results-container'
                        )?.firstElementChild?.className ?? null,
                })}`
            );
        }
        state.capabilities.changeDetectionTicks =
            ticks === null || state.keystrokes[0]?.ticks === null
                ? 'unavailable-counter-missing'
                : 'counted';
        countEntries(confirmedEpochMs);
        const sentinelStatus = callSentinel(options.endSentinelId);
        state.sentinel = {
            epochMs: sentinelStatus === 'sent' ? epoch() : null,
            status: sentinelStatus,
        };
        window.removeEventListener('keydown', onKeydown, true);
        state.final = true;
    };
    const mutationObserver = new MutationObserver((records) => {
        if (state.settle.status !== 'pending') return;
        accept(records.length);
        if (state.start === null) return;
        if (state.firstResult === null) {
            const cardCount = visibleCards();
            if (cardCount > 0) {
                state.firstResult = {
                    cardCount,
                    epochMs: epoch(),
                    query: readQuery(),
                };
            }
        }
        // Every batch after the last keystroke restarts the quiet window,
        // which only opens once the final term's results are shown.
        clearTimeout(quietTimer);
        if (state.keystrokes.length >= options.keystrokes && ready()) {
            quietTimer = setTimeout(() => end('quiet'), options.quietMs);
        }
    });
    mutationObserver.observe(document.documentElement ?? document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
    });

    // Capture phase on window runs before every listener of the app, so the
    // start sentinel precedes any bridge call the first key causes, and the
    // records queued before a key belong to the previous bucket.
    const onKeydown = (event: Event): void => {
        const origin =
            event.target instanceof Element
                ? event.target.closest(options.inputSelector)
                : null;
        if (origin === null || state.settle.status !== 'pending') return;
        if (state.keystrokes.length >= options.keystrokes) {
            state.invalidReasons.push('unexpected-keystroke');
            return;
        }
        accept(mutationObserver.takeRecords().length);
        const listenerEpochMs = epoch();
        const eventEpochMs = performance.timeOrigin + event.timeStamp;
        const epochMs =
            Number.isFinite(eventEpochMs) && eventEpochMs <= listenerEpochMs
                ? eventEpochMs
                : listenerEpochMs;
        if (state.start === null) {
            state.start = {
                epochMs,
                pathname: location.pathname,
                sentinelStatus: callSentinel(options.startSentinelId),
            };
            fromEpochMs = epochMs;
        }
        state.keystrokes.push({
            epochMs,
            key: (event as KeyboardEvent).key ?? '',
            ticks: readTicks(),
        });
        state.domMutationsByKeystroke.push(0);
        if (state.keystrokes.length === options.keystrokes) {
            timeoutTimer = setTimeout(
                () => end('timeout'),
                options.settleTimeoutMs
            );
        }
    };
    window.addEventListener('keydown', onKeydown, true);
}

export function createSearchJourneyProbeOptions(
    query: string
): SearchJourneyProbeOptions {
    return {
        cdTickCounterKey: JOURNEY_CD_TICK_COUNTER_KEY,
        endSentinelId: SEARCH_JOURNEY_END_SENTINEL_ID,
        inputSelector: SEARCH_JOURNEY_INPUT_SELECTOR,
        keystrokes: query.length,
        loadingSelector: SEARCH_JOURNEY_LOADING_SELECTOR,
        query,
        quietMs: SEARCH_JOURNEY_QUIET_MS,
        resultSelector: SEARCH_JOURNEY_RESULT_SELECTOR,
        routePath: SEARCH_JOURNEY_ROUTE_PATH,
        sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
        settleTimeoutMs: SEARCH_JOURNEY_SETTLE_TIMEOUT_MS,
        startSentinelId: SEARCH_JOURNEY_START_SENTINEL_ID,
        stateKey: SEARCH_JOURNEY_PROBE_STATE_KEY,
    };
}

export async function armSearchJourneyProbe(
    page: Page,
    options: SearchJourneyProbeOptions
): Promise<void> {
    await page.evaluate(searchJourneyProbeScript, options);
}

export async function readSearchJourneyPreStartMutations(
    page: Page,
    stateKey: string
): Promise<number> {
    return page.evaluate((key) => {
        const state = (globalThis as unknown as Record<string, unknown>)[
            key
        ] as { preStart?: { domMutations?: number } } | undefined;
        const count = state?.preStart?.domMutations;
        if (typeof count !== 'number') {
            throw new Error('search-journey-probe-not-armed');
        }
        return count;
    }, stateKey);
}

export async function waitForSearchJourneyProbe(
    page: Page,
    stateKey: string,
    timeoutMs: number
): Promise<SearchJourneyProbeState> {
    await page.waitForFunction(
        (key) =>
            (
                (globalThis as unknown as Record<string, unknown>)[key] as
                    { final?: boolean } | undefined
            )?.final === true,
        stateKey,
        { polling: 50, timeout: timeoutMs }
    );
    const state = await page.evaluate(
        (key) =>
            JSON.parse(
                JSON.stringify(
                    (globalThis as unknown as Record<string, unknown>)[key]
                )
            ) as unknown,
        stateKey
    );
    return assertSearchJourneyProbeState(state);
}

export function assertSearchJourneyProbeState(
    value: unknown
): SearchJourneyProbeState {
    const state = value as SearchJourneyProbeState | null;
    if (
        !state ||
        state.schemaVersion !== SEARCH_JOURNEY_PROBE_SCHEMA_VERSION ||
        state.final !== true ||
        state.start === null
    ) {
        throw new Error('search-journey-probe-incomplete');
    }
    if (state.invalidReasons.length > 0) {
        throw new Error(
            `search-journey-probe-invalid: ${state.invalidReasons.join(', ')}`
        );
    }
    if (state.start.sentinelStatus !== 'sent') {
        throw new Error(
            `search-journey-probe-start-sentinel-${state.start.sentinelStatus}`
        );
    }
    if (state.sentinel.status !== 'sent') {
        throw new Error(
            `search-journey-probe-sentinel-${state.sentinel.status}`
        );
    }
    // A zero from an observer that never ran is not a measurement.
    if (!state.capabilities.layoutShift || !state.capabilities.longTask) {
        throw new Error('search-journey-probe-observer-unavailable');
    }
    return state;
}
