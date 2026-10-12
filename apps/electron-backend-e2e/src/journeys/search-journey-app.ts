import type { ElectronApplication, Page } from '@playwright/test';

import {
    blockJourneyExternalArtwork,
    readJourneyExternalArtworkCancelled,
} from '../performance/journey-external-artwork';
import {
    JOURNEY_MAIN_COUNTER,
    JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
} from '../performance/journey-main-counters';
import {
    countJourneyMainIpcInFlight,
    detachJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_MAIN_IPC_STATE_KEY,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    peekJourneyMainIpcCaptures,
    readJourneyMainIpcCapture,
} from '../performance/journey-main-ipc-capture';
import { waitForJourneyQuiet } from '../performance/journey-quiet-wait';
import {
    armSearchJourneyProbe,
    createSearchJourneyProbeOptions,
    readSearchJourneyPreStartMutations,
    type SearchJourneyProbeOptions,
    SEARCH_JOURNEY_INPUT_SELECTOR,
    SEARCH_JOURNEY_ROUTE_PATH,
    waitForSearchJourneyProbe,
} from '../performance/search-journey-probe';
import {
    SEARCH_JOURNEY_QUERY_METHOD,
    type SearchJourneyActivitySample,
    type SearchJourneyMeasurement,
    type SearchJourneyQueryTraceEntry,
    type SearchJourneySettle,
} from '../performance/search-journey-record';
import { JOURNEY_RENDERER_GATE_KEY } from './journey-renderer-gate-client';
import type {
    LaunchJourneySeedOptions,
    LaunchJourneySession,
} from './launch-journey-app';

/**
 * J4 "Search": runs inside a process that J1 has just launched with the
 * main-process counters on (SQL statements are counted). The test opens
 * global search from the rail and focuses the header search box (not
 * measured), lets the app settle, then types the query one key at a time
 * at a fixed interval and measures until the results have settled.
 *
 * Main-process activity (bridge calls, SQL statements) is sampled before
 * every keystroke, so the record can show what each key caused: with the
 * shell's debounce, only the last interval should run a query. Contract:
 * docs/architecture/performance-journeys.md.
 */
export const SEARCH_JOURNEY_MAIN_IPC_STATE_KEY =
    '__iptvnatorJourneySearchMainIpcCapture';
export const SEARCH_JOURNEY_PORTAL_NAME = 'Journey search portal';
/**
 * Six characters; on the mock's `large` account (12,000 items) the term
 * matches 170 series titles, more than the first page of 100.
 */
export const SEARCH_JOURNEY_QUERY = 'system';
/** Well below the shell's 350 ms input debounce, like steady typing. */
export const SEARCH_JOURNEY_KEY_DELAY_MS = 100;
const QUIET_MS = 1_000;
const QUIET_POLL_MS = 100;
const QUIET_TIMEOUT_MS = 30_000;
const AFTER_SETTLED_WINDOW_MS = 500;
const ERROR_PREFIX = 'search-journey';

/** J1's M3U source plus the mock's existing 12,000-item `large` catalog. */
export const SEARCH_JOURNEY_SEED: LaunchJourneySeedOptions = {
    portal: {
        name: SEARCH_JOURNEY_PORTAL_NAME,
        password: 'large',
        username: 'large',
    },
};

/**
 * One synchronous pass in the main process: the capture's counts and the
 * registered counters handler (which reads the registry synchronously), so
 * no bridge call or SQL report can land between the two reads.
 */
async function sampleActivity(
    electronApp: ElectronApplication
): Promise<SearchJourneyActivitySample> {
    return electronApp.evaluate(
        async (_electron, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const capture = target[input.captureKey] as
                | {
                      callsBeforeSentinel: number;
                      callsByMethod: Record<string, number>;
                  }
                | undefined;
            const gate = target[input.gateKey] as
                | { invokeHandler?: (channel: string) => Promise<unknown> }
                | undefined;
            if (!capture || typeof gate?.invokeHandler !== 'function') {
                throw new Error('search-journey-sample-unavailable');
            }
            const ipcCalls = capture.callsBeforeSentinel;
            const queryCalls = capture.callsByMethod[input.queryMethod] ?? 0;
            const pending = gate.invokeHandler(input.channel);
            const snapshot = (await pending) as {
                counters?: Record<string, number>;
            } | null;
            const sqlStatements = snapshot?.counters?.[input.sqlCounter];
            if (typeof sqlStatements !== 'number') {
                throw new Error('search-journey-sql-counter-missing');
            }
            return { ipcCalls, queryCalls, sqlStatements };
        },
        {
            captureKey: SEARCH_JOURNEY_MAIN_IPC_STATE_KEY,
            channel: JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
            gateKey: JOURNEY_RENDERER_GATE_KEY,
            queryMethod: SEARCH_JOURNEY_QUERY_METHOD,
            sqlCounter: JOURNEY_MAIN_COUNTER.SQL_STATEMENTS,
        }
    );
}

/**
 * Waits until DOM, bridge calls (started and in flight) and SQL statements
 * have all been unchanged for `QUIET_MS`, so leftovers of the launch and of
 * the navigation to global search are not attributed to the first key.
 */
async function waitForSearchQuiet(
    electronApp: ElectronApplication,
    page: Page,
    probeStateKey: string
): Promise<SearchJourneySettle> {
    const { sample, waitedMs } = await waitForJourneyQuiet({
        inFlight: (activity) => activity.ipcInFlight,
        pollMs: QUIET_POLL_MS,
        quietMs: QUIET_MS,
        sample: async () => {
            const [launchCapture, journeyCapture] =
                await peekJourneyMainIpcCaptures(electronApp, [
                    JOURNEY_MAIN_IPC_STATE_KEY,
                    SEARCH_JOURNEY_MAIN_IPC_STATE_KEY,
                ]);
            if (launchCapture.unmatchedCompletions > 0) {
                throw new Error(`${ERROR_PREFIX}-bridge-completions-unmatched`);
            }
            return {
                domMutations: await readSearchJourneyPreStartMutations(
                    page,
                    probeStateKey
                ),
                ipcCalls: journeyCapture.callsBeforeStart,
                ipcInFlight: countJourneyMainIpcInFlight(launchCapture),
                sqlStatements: (await sampleActivity(electronApp))
                    .sqlStatements,
            };
        },
        timeoutError: (activity) =>
            new Error(`${ERROR_PREFIX}-not-quiet: ${JSON.stringify(activity)}`),
        timeoutMs: QUIET_TIMEOUT_MS,
    });
    return {
        preStartDomMutations: sample.domMutations,
        preStartIpcCalls: sample.ipcCalls,
        quietMs: QUIET_MS,
        sqlStatements: sample.sqlStatements,
        waitedMs,
    };
}

function sleepUntil(epochMs: number): Promise<void> {
    const remainingMs = epochMs - Date.now();
    return remainingMs > 0
        ? new Promise((resolve) => setTimeout(resolve, remainingMs))
        : Promise.resolve();
}

const QUERY_TRACE_KEY = '__iptvnatorJourneySearchQueryTrace';

/**
 * Records every trace event of the query method in the main process, with
 * the term and result length the preload's summaries carry and the main
 * process's arrival epoch (the clock the IPC capture stamps its sentinels
 * with). The record uses it to prove the final term's query completed
 * before the settle, so results of an earlier term cannot end the journey.
 * The summaries hold the search term and counts only.
 */
async function traceQueryCalls(
    electronApp: ElectronApplication
): Promise<void> {
    await electronApp.evaluate(
        ({ ipcMain }, input) => {
            const entries: unknown[] = [];
            (globalThis as unknown as Record<string, unknown>)[input.key] =
                entries;
            ipcMain.on(input.channel, (_event, payload: unknown) => {
                const record = payload as Record<string, unknown> | null;
                if (record?.['method'] !== input.method) return;
                const args = record['args'] as { items?: unknown[] } | null;
                const result = record['result'] as { length?: unknown } | null;
                const term = args?.items?.[0];
                entries.push({
                    epochMs: Date.now(),
                    phase: String(record['phase']),
                    resultLength:
                        typeof result?.length === 'number'
                            ? result.length
                            : null,
                    term: typeof term === 'string' ? term : null,
                });
            });
        },
        {
            channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
            key: QUERY_TRACE_KEY,
            method: SEARCH_JOURNEY_QUERY_METHOD,
        }
    );
}

const SENTINEL_SQL_KEY = '__iptvnatorJourneySearchSentinelSql';

/**
 * Reads `main.sqlStatements` in the main process when the start and the end
 * sentinel arrive, so the SQL counter covers exactly the IPC capture's
 * window: database work just before the first key or after the settle is
 * not counted. The gate's `invokeHandler` runs the counters handler
 * synchronously, so the value is the total at the sentinel's arrival even
 * though it is stored when the promise settles.
 */
async function stampSqlAtSentinels(
    electronApp: ElectronApplication,
    probeOptions: SearchJourneyProbeOptions
): Promise<void> {
    await electronApp.evaluate(
        ({ ipcMain }, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const gate = target[input.gateKey] as {
                invokeHandler: (channel: string) => Promise<unknown>;
            };
            const state: Record<'end' | 'start', number | null> = {
                end: null,
                start: null,
            };
            target[input.key] = state;
            ipcMain.on(input.channel, (_event, payload: unknown) => {
                const record = payload as Record<string, unknown> | null;
                if (
                    record?.['method'] !== input.sentinelMethod ||
                    record['phase'] !== 'start'
                ) {
                    return;
                }
                const args = JSON.stringify(record['args'] ?? null);
                const which = args.includes(input.startId)
                    ? 'start'
                    : args.includes(input.endId)
                      ? 'end'
                      : null;
                if (which === null || state[which] !== null) return;
                void gate
                    .invokeHandler(input.countersChannel)
                    .then((snapshot) => {
                        const value = (
                            snapshot as { counters?: Record<string, number> }
                        )?.counters?.[input.sqlCounter];
                        state[which] = typeof value === 'number' ? value : null;
                    });
            });
        },
        {
            channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
            countersChannel: JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
            endId: probeOptions.endSentinelId,
            gateKey: JOURNEY_RENDERER_GATE_KEY,
            key: SENTINEL_SQL_KEY,
            sentinelMethod: probeOptions.sentinelMethod,
            sqlCounter: JOURNEY_MAIN_COUNTER.SQL_STATEMENTS,
            startId: probeOptions.startSentinelId,
        }
    );
}

async function readQueryTrace(
    electronApp: ElectronApplication
): Promise<SearchJourneyQueryTraceEntry[]> {
    return electronApp.evaluate(
        (_electron, key) =>
            JSON.parse(
                JSON.stringify(
                    (globalThis as unknown as Record<string, unknown>)[key]
                )
            ) as SearchJourneyQueryTraceEntry[],
        QUERY_TRACE_KEY
    );
}

/**
 * What a failed settle saw: the bridge calls of the search, renderer errors
 * (a search that threw shows the same empty view as one that found
 * nothing), SQL statements before each key and now, and the traced query
 * calls with their terms and result lengths.
 */
async function describeSettleFailure(
    electronApp: ElectronApplication,
    samples: readonly SearchJourneyActivitySample[],
    consoleErrors: readonly string[]
): Promise<string> {
    const [capture] = await peekJourneyMainIpcCaptures(electronApp, [
        SEARCH_JOURNEY_MAIN_IPC_STATE_KEY,
    ]);
    const now = await sampleActivity(electronApp);
    const queryTrace = await readQueryTrace(electronApp);
    return JSON.stringify({
        bridgeCalls: capture.callsByMethod,
        consoleErrors,
        queryTrace,
        sqlBeforeKeysAndNow: [...samples, now].map(
            (entry) => entry.sqlStatements
        ),
    });
}

/** Rail link → global search, then focus the header box. Not measured. */
async function openGlobalSearch(page: Page, timeoutMs: number): Promise<void> {
    await page
        .getByRole('link', { name: 'Global search', exact: true })
        .click({ timeout: timeoutMs });
    // A router navigation, not a document load: wait on the path itself.
    await page
        .waitForFunction(
            (path) => location.pathname.endsWith(path),
            SEARCH_JOURNEY_ROUTE_PATH,
            { timeout: timeoutMs }
        )
        .catch((failure: unknown) => {
            throw new Error(
                `${ERROR_PREFIX}-route-not-reached: ${page.url()} (${String(failure)})`
            );
        });
    const input = page.locator(SEARCH_JOURNEY_INPUT_SELECTOR);
    await input.waitFor({ state: 'visible', timeout: timeoutMs });
    await input.focus({ timeout: timeoutMs });
}

export async function measureSearchJourney(
    session: LaunchJourneySession,
    timeoutMs: number
): Promise<SearchJourneyMeasurement> {
    const { electronApp, mainWindow } = session;
    const query = SEARCH_JOURNEY_QUERY;
    const probeOptions = createSearchJourneyProbeOptions(query);
    // Kept for the message of a failed settle.
    const consoleErrors: string[] = [];
    mainWindow.on('console', (message) => {
        if (message.type() === 'error' && consoleErrors.length < 10) {
            consoleErrors.push(message.text().slice(0, 300));
        }
    });
    await blockJourneyExternalArtwork(electronApp);
    await traceQueryCalls(electronApp);
    await stampSqlAtSentinels(electronApp, probeOptions);
    await openGlobalSearch(mainWindow, timeoutMs);
    await installJourneyMainIpcCapture(electronApp, {
        channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
        sentinelId: probeOptions.endSentinelId,
        sentinelMethod: probeOptions.sentinelMethod,
        startSentinelId: probeOptions.startSentinelId,
        stateKey: SEARCH_JOURNEY_MAIN_IPC_STATE_KEY,
    });
    await armSearchJourneyProbe(mainWindow, probeOptions);
    const settle = await waitForSearchQuiet(
        electronApp,
        mainWindow,
        probeOptions.stateKey
    );
    await detachJourneyMainIpcCapture(electronApp, JOURNEY_MAIN_IPC_STATE_KEY);
    const focused = await mainWindow
        .locator(SEARCH_JOURNEY_INPUT_SELECTOR)
        .evaluate((input) => input === document.activeElement);
    if (!focused) {
        throw new Error(`${ERROR_PREFIX}-input-not-focused`);
    }
    // One `keyboard.type` per character on a fixed schedule, so the
    // main-process sample before each key sits between two keystrokes.
    const samples: SearchJourneyActivitySample[] = [];
    const firstKeyAtMs = Date.now();
    for (let position = 0; position < query.length; position += 1) {
        await sleepUntil(firstKeyAtMs + position * SEARCH_JOURNEY_KEY_DELAY_MS);
        samples.push(await sampleActivity(electronApp));
        await mainWindow.keyboard.type(query[position]);
    }
    const renderer = await waitForSearchJourneyProbe(
        mainWindow,
        probeOptions.stateKey,
        timeoutMs
    ).catch(async (failure: unknown) => {
        throw new Error(
            `${String(failure)} ${await describeSettleFailure(electronApp, samples, consoleErrors)}`
        );
    });
    const ipc = await readJourneyMainIpcCapture(
        electronApp,
        SEARCH_JOURNEY_MAIN_IPC_STATE_KEY,
        10_000
    );
    samples.push(await sampleActivity(electronApp));
    await new Promise((resolve) =>
        setTimeout(resolve, AFTER_SETTLED_WINDOW_MS)
    );
    return {
        afterSettled: await sampleActivity(electronApp),
        afterSettledWindowMs: AFTER_SETTLED_WINDOW_MS,
        externalArtworkCancelled:
            await readJourneyExternalArtworkCancelled(electronApp),
        ipc,
        keyDelayMs: SEARCH_JOURNEY_KEY_DELAY_MS,
        pid: session.launch.pid,
        query,
        queryTrace: await readQueryTrace(electronApp),
        sqlAtSentinels: await electronApp.evaluate(
            (_electron, key) =>
                JSON.parse(
                    JSON.stringify(
                        (globalThis as unknown as Record<string, unknown>)[key]
                    )
                ) as SearchJourneyMeasurement['sqlAtSentinels'],
            SENTINEL_SQL_KEY
        ),
        renderer,
        samples,
        settle,
    };
}
