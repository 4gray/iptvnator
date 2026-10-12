import { computeJourneyIpcSerialDepth } from './journey-ipc-serial-depth';
import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import type { JourneyIterationRecord } from './journey-summary';
import type { SearchJourneyProbeState } from './search-journey-probe';

/**
 * Maps one measured global search (renderer probe from the first keystroke
 * until the results settled, main IPC capture between the start and end
 * sentinels, main-process activity sampled before every keystroke) to the
 * journey summary's iteration record for J4.
 */
export const SEARCH_JOURNEY_ID = 'search';

export const SEARCH_JOURNEY_COUNTER = {
    CD_TICKS: 'renderer.cdTicksToResults',
    DOM_MUTATIONS: 'renderer.domMutationsToResults',
    IPC_CALLS: 'renderer.ipcCallsPerSearch',
    IPC_SERIAL_DEPTH: 'renderer.ipcSerialDepthToResults',
    LAYOUT_SHIFT_SCORE: 'renderer.layoutShiftScore',
    LONG_TASKS: 'renderer.longTasks',
    SQL_STATEMENTS: 'renderer.sqlStatementsPerSearch',
} as const;

export const SEARCH_JOURNEY_WALL_CLOCK = {
    FIRST_KEYSTROKE_TO_FIRST_RESULT: 'firstKeystrokeToFirstResultMs',
    LAST_KEYSTROKE_TO_SETTLED: 'lastKeystrokeToSettledMs',
} as const;

export const SEARCH_JOURNEY_UNAVAILABLE_COUNTERS: Readonly<
    Record<string, string>
> = Object.freeze({});

/** Bridge method of a global search query (`DatabaseService`). */
export const SEARCH_JOURNEY_QUERY_METHOD = 'dbGlobalSearch';

/**
 * Longest accepted gap between two keydowns. Below the shell's 350 ms input
 * debounce, so a late key on a busy machine cannot let an intermediate term
 * run a query that steady typing would not.
 */
export const SEARCH_JOURNEY_MAX_KEY_INTERVAL_MS = 250;

/** One traced query event, stamped in the main process on arrival. */
export interface SearchJourneyQueryTraceEntry {
    readonly epochMs: number;
    readonly phase: string;
    /** Length of the returned array, on `success`. */
    readonly resultLength: number | null;
    readonly term: string | null;
}

/**
 * Main-process activity read in one synchronous pass: the journey capture's
 * call counts and the running `main.sqlStatements` total.
 */
export interface SearchJourneyActivitySample {
    readonly ipcCalls: number;
    readonly queryCalls: number;
    readonly sqlStatements: number;
}

/** How long the app was left alone before the first keystroke. */
export interface SearchJourneySettle {
    readonly preStartDomMutations: number;
    readonly preStartIpcCalls: number;
    readonly quietMs: number;
    readonly sqlStatements: number;
    readonly waitedMs: number;
}

export interface SearchJourneyMeasurement {
    readonly externalArtworkCancelled: number;
    readonly ipc: JourneyMainIpcCaptureState;
    readonly keyDelayMs: number;
    readonly pid: number;
    readonly query: string;
    readonly renderer: SearchJourneyProbeState;
    /**
     * Before each keystroke (index i before key i + 1), then once after the
     * probe settled and once more `afterSettledWindowMs` later.
     */
    readonly samples: readonly SearchJourneyActivitySample[];
    readonly afterSettled: SearchJourneyActivitySample;
    readonly afterSettledWindowMs: number;
    readonly settle: SearchJourneySettle;
    /**
     * `main.sqlStatements` read in the main process when the start and the
     * end sentinel arrived; null when it was not read.
     */
    readonly sqlAtSentinels: {
        readonly end: number | null;
        readonly start: number | null;
    };
    /** Every traced query event of the process, in arrival order. */
    readonly queryTrace: readonly SearchJourneyQueryTraceEntry[];
}

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function roundThousandth(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}

function difference(
    samples: readonly SearchJourneyActivitySample[],
    index: number,
    key: keyof SearchJourneyActivitySample
): number {
    return samples[index + 1][key] - samples[index][key];
}

/**
 * The query the settle waited for: the last one started between the start
 * and end sentinels. It must be for the final term and must have completed
 * before the end sentinel, otherwise the probe settled on results of an
 * earlier term (still shown while the final term debounced).
 */
function finalQuery(
    trace: readonly SearchJourneyQueryTraceEntry[],
    fromEpochMs: number,
    untilEpochMs: number,
    query: string
) {
    const inWindow = trace.filter(
        (entry) => entry.epochMs >= fromEpochMs && entry.epochMs <= untilEpochMs
    );
    const starts = inWindow.filter((entry) => entry.phase === 'start');
    const completions = inWindow.filter(
        (entry) => entry.phase === 'success' || entry.phase === 'error'
    );
    const last = starts.at(-1);
    if (last === undefined || last.term !== query) {
        throw new Error('search-journey-record-final-query-not-run');
    }
    const completion = completions.find(
        (entry) => entry.epochMs >= last.epochMs && entry.phase === 'success'
    );
    if (completion === undefined || completions.length < starts.length) {
        throw new Error('search-journey-record-final-query-incomplete');
    }
    return Object.freeze({
        durationMs: completion.epochMs - last.epochMs,
        resultLength: completion.resultLength,
        term: last.term,
    });
}

export function toSearchIterationRecord(
    index: number,
    warmup: boolean,
    measurement: SearchJourneyMeasurement
): JourneyIterationRecord {
    const { ipc, renderer, samples, settle } = measurement;
    const { keystrokes, start } = renderer;
    const keys = measurement.query.length;
    if (start === null || renderer.settle.status !== 'quiet') {
        throw new Error('search-journey-record-incomplete-probe');
    }
    if (ipc.start === null) {
        throw new Error('search-journey-record-ipc-without-start');
    }
    if (keystrokes.length !== keys || samples.length !== keys + 1) {
        throw new Error('search-journey-record-keystroke-count');
    }
    if (keystrokes.map((key) => key.key).join('') !== measurement.query) {
        throw new Error('search-journey-record-typed-text');
    }
    if (
        renderer.settle.query !== measurement.query ||
        renderer.settle.cardCount === 0 ||
        renderer.firstResult === null
    ) {
        throw new Error('search-journey-record-no-results');
    }
    const settledEpochMs = renderer.settle.epochMs;
    const lastKeyEpochMs = keystrokes[keys - 1].epochMs;
    if (
        settledEpochMs === null ||
        settledEpochMs < lastKeyEpochMs ||
        renderer.firstResult.epochMs < start.epochMs
    ) {
        throw new Error('search-journey-record-clock-order');
    }
    const { end: sqlAtEnd, start: sqlAtStart } = measurement.sqlAtSentinels;
    if (sqlAtStart === null || sqlAtEnd === null || sqlAtEnd < sqlAtStart) {
        throw new Error('search-journey-record-sql-at-sentinels-missing');
    }
    // Activity between the quiet snapshot and the first key could finish
    // after it and be counted as the search's. The probe, the capture and
    // the SQL total read at the start sentinel all reflect the first
    // keydown, so they must still match the snapshot.
    const moved = [
        renderer.preStart.domMutations !== settle.preStartDomMutations
            ? 'dom'
            : null,
        ipc.callsBeforeStart !== settle.preStartIpcCalls ? 'ipc' : null,
        sqlAtStart !== settle.sqlStatements ? 'sql' : null,
    ].filter((kind): kind is string => kind !== null);
    if (moved.length > 0) {
        throw new Error(
            `search-journey-record-activity-before-first-key-${moved.join('-')}`
        );
    }
    const keyIntervalsMs = keystrokes
        .slice(1)
        .map((key, position) =>
            roundTenth(key.epochMs - keystrokes[position].epochMs)
        );
    if (
        keyIntervalsMs.some(
            (interval) => interval > SEARCH_JOURNEY_MAX_KEY_INTERVAL_MS
        )
    ) {
        throw new Error(
            `search-journey-record-typing-cadence: ${keyIntervalsMs.join(', ')}`
        );
    }
    if (ipc.sentinel.receivedEpochMs === null) {
        throw new Error('search-journey-record-ipc-without-end');
    }
    const lastQuery = finalQuery(
        measurement.queryTrace,
        ipc.start.receivedEpochMs ?? Number.POSITIVE_INFINITY,
        ipc.sentinel.receivedEpochMs,
        measurement.query
    );
    const finalSample = samples[keys];
    if (finalSample.ipcCalls !== ipc.callsBeforeSentinel) {
        throw new Error('search-journey-record-ipc-sample-mismatch');
    }
    const settleTicks = renderer.settle.ticks;
    const ticks = keystrokes.map((key) => key.ticks);
    if (
        renderer.capabilities.changeDetectionTicks !== 'counted' ||
        settleTicks === null ||
        ticks.some((value) => value === null)
    ) {
        throw new Error(
            `search-journey-record-cd-ticks-${renderer.capabilities.changeDetectionTicks}`
        );
    }
    const tickAt = (position: number): number =>
        position < keys ? (ticks[position] as number) : settleTicks;
    const serialDepth = computeJourneyIpcSerialDepth(ipc.timeline);
    const perKeystroke = keystrokes.map((key, position) =>
        Object.freeze({
            atMs: roundTenth(key.epochMs - start.epochMs),
            cdTicks: tickAt(position + 1) - tickAt(position),
            domMutations: renderer.domMutationsByKeystroke[position] ?? 0,
            ipcCalls: difference(samples, position, 'ipcCalls'),
            key: key.key,
            queryCalls: difference(samples, position, 'queryCalls'),
            sqlStatements: difference(samples, position, 'sqlStatements'),
        })
    );
    return Object.freeze({
        counters: Object.freeze({
            [SEARCH_JOURNEY_COUNTER.CD_TICKS]: settleTicks - tickAt(0),
            [SEARCH_JOURNEY_COUNTER.DOM_MUTATIONS]:
                renderer.counters.domMutations,
            [SEARCH_JOURNEY_COUNTER.IPC_CALLS]: ipc.callsBeforeSentinel,
            [SEARCH_JOURNEY_COUNTER.IPC_SERIAL_DEPTH]: serialDepth.depth,
            // Typing is input, so shifts flagged hadRecentInput are
            // included, as in J2 and J3.
            [SEARCH_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE]: roundThousandth(
                renderer.counters.layoutShiftScore +
                    renderer.counters.recentInputLayoutShiftScore
            ),
            [SEARCH_JOURNEY_COUNTER.LONG_TASKS]: renderer.counters.longTasks,
            [SEARCH_JOURNEY_COUNTER.SQL_STATEMENTS]: sqlAtEnd - sqlAtStart,
        }),
        evidence: Object.freeze({
            capabilities: renderer.capabilities,
            epochs: Object.freeze({
                firstKeystroke: start.epochMs,
                firstResult: renderer.firstResult.epochMs,
                lastKeystroke: lastKeyEpochMs,
                mainIpcSentinel: ipc.sentinel.receivedEpochMs,
                mainIpcStart: ipc.start.receivedEpochMs,
                settleConfirmed: renderer.settle.confirmedEpochMs,
                settled: settledEpochMs,
            }),
            externalArtworkCancelled: measurement.externalArtworkCancelled,
            firstResult: Object.freeze({
                cardCount: renderer.firstResult.cardCount,
                query: renderer.firstResult.query,
            }),
            ipcCallsAfterSettled: ipc.callsAfterSentinel,
            ipcCallsByMethod: ipc.callsByMethod,
            ipcSerialDepth: serialDepth,
            ipcTimeline: ipc.timeline.map(
                (event) =>
                    `${event.phase === 'start' ? '+' : '-'}${event.method}`
            ),
            finalQuery: lastQuery,
            keyDelayMs: measurement.keyDelayMs,
            keyIntervalsMs,
            layoutShift: Object.freeze({
                recentInput: roundThousandth(
                    renderer.counters.recentInputLayoutShiftScore
                ),
                withoutRecentInput: roundThousandth(
                    renderer.counters.layoutShiftScore
                ),
            }),
            longTaskDurationsMs: renderer.longTaskDurationsMs.map(roundTenth),
            perKeystroke,
            query: measurement.query,
            results: Object.freeze({ cardCount: renderer.settle.cardCount }),
            settle,
            sqlAtSentinels: measurement.sqlAtSentinels,
            sqlStatementsAfterSettled: Object.freeze({
                count: measurement.afterSettled.sqlStatements - sqlAtEnd,
                windowMs: measurement.afterSettledWindowMs,
            }),
        }),
        index,
        pid: measurement.pid,
        wallClock: Object.freeze({
            [SEARCH_JOURNEY_WALL_CLOCK.FIRST_KEYSTROKE_TO_FIRST_RESULT]:
                roundTenth(renderer.firstResult.epochMs - start.epochMs),
            [SEARCH_JOURNEY_WALL_CLOCK.LAST_KEYSTROKE_TO_SETTLED]: roundTenth(
                settledEpochMs - lastKeyEpochMs
            ),
        }),
        warmup,
    });
}
