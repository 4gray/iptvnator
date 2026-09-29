import type { ElectronApplication, Page } from '@playwright/test';

import { defaultXtreamPortalName } from '../electron-test-fixtures';
import {
    countJourneyMainIpcInFlight,
    detachJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_MAIN_IPC_STATE_KEY,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    peekJourneyMainIpcCapture,
    readJourneyMainIpcCapture,
} from '../performance/journey-main-ipc-capture';
import type { JourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import { waitForJourneyQuiet } from '../performance/journey-quiet-wait';
import {
    armJourneyRendererProbe,
    createOpenSourceJourneyProbeOptions,
    waitForJourneyRendererProbe,
    type JourneyRendererProbeState,
} from '../performance/journey-renderer-probe';
import type {
    OpenSourceJourneyMeasurement,
    OpenSourceJourneySettle,
} from '../performance/open-source-journey-record';
import type { LaunchJourneySession } from './launch-journey-app';

/**
 * J2 "Open a source": runs inside a process that J1 has just launched, after
 * J1's counters are final. The app is first allowed to settle (no DOM
 * mutation, bridge call or mock request for `QUIET_MS`), so leftovers of the
 * startup are not attributed to the click. Then the Xtream portal card on
 * the dashboard is clicked and the probe, the IPC capture and the mock
 * request ledger measure until the category list and the first page of
 * items are painted.
 */
export const OPEN_SOURCE_JOURNEY_MAIN_IPC_STATE_KEY =
    '__iptvnatorJourneyOpenSourceMainIpcCapture';
const QUIET_MS = 1_000;
const POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 30_000;
/**
 * After the mock settled, the ledger is watched this much longer before it
 * is read, so requests that arrive after the accepted quiet sample show up
 * in `httpRequestsAfterSettledByRoute` instead of vanishing unseen.
 */
const LATE_REQUEST_OBSERVATION_MS = QUIET_MS;

interface ActivitySample {
    readonly domMutations: number;
    readonly httpInFlight: number;
    readonly httpRequests: number;
    readonly ipcCalls: number;
    readonly ipcInFlight: number;
}

async function readPreStartMutations(
    page: Page,
    stateKey: string
): Promise<number> {
    return page.evaluate((key) => {
        const state = (globalThis as unknown as Record<string, unknown>)[
            key
        ] as { preStart?: { domMutations?: number } } | undefined;
        const count = state?.preStart?.domMutations;
        if (typeof count !== 'number') {
            throw new Error('journey-renderer-probe-not-armed');
        }
        return count;
    }, stateKey);
}

/**
 * Waits until DOM, bridge and mock traffic have all been unchanged for
 * `QUIET_MS` with no mock request and no bridge call in flight: a slow
 * response or a pending bridge call can still change the DOM or trigger
 * follow-up work after the click. Pending bridge calls come from J1's
 * capture, which was installed before the document loaded and so has seen
 * every call start. An app that never settles fails the iteration instead
 * of producing a count that includes its background work.
 */
async function waitForQuiet(
    electronApp: ElectronApplication,
    page: Page,
    ledger: JourneyMockRequestLedger,
    probeStateKey: string
): Promise<{
    /** Ledger position read by the accepted quiet sample itself. */
    readonly ledgerMark: number;
    readonly settle: OpenSourceJourneySettle;
}> {
    const armMark = ledger.mark();
    const sample = async (): Promise<ActivitySample> => {
        const launchCapture = await peekJourneyMainIpcCapture(
            electronApp,
            JOURNEY_MAIN_IPC_STATE_KEY
        );
        if (launchCapture.unmatchedCompletions > 0) {
            throw new Error('open-source-journey-bridge-completions-unmatched');
        }
        return {
            domMutations: await readPreStartMutations(page, probeStateKey),
            httpInFlight: ledger.inFlight(),
            httpRequests: ledger.mark(),
            ipcCalls: (
                await peekJourneyMainIpcCapture(
                    electronApp,
                    OPEN_SOURCE_JOURNEY_MAIN_IPC_STATE_KEY
                )
            ).callsBeforeStart,
            ipcInFlight: countJourneyMainIpcInFlight(launchCapture),
        };
    };
    const { sample: quiet, waitedMs } = await waitForJourneyQuiet({
        inFlight: (activity) => activity.httpInFlight + activity.ipcInFlight,
        pollMs: POLL_MS,
        quietMs: QUIET_MS,
        sample,
        timeoutError: (activity) =>
            new Error(
                `open-source-journey-not-quiet: ${JSON.stringify(activity)}`
            ),
        timeoutMs: SETTLE_TIMEOUT_MS,
    });
    return {
        ledgerMark: quiet.httpRequests,
        settle: {
            preStartDomMutations: quiet.domMutations,
            preStartHttpRequests: quiet.httpRequests - armMark,
            preStartIpcCalls: quiet.ipcCalls,
            quietMs: QUIET_MS,
            waitedMs,
        },
    };
}

/**
 * Waits until the mock has seen no new request for `QUIET_MS` and none is
 * in flight, so responses slower than the quiet interval and the requests
 * they trigger stay inside the measured window.
 */
async function waitForMockQuiet(
    ledger: JourneyMockRequestLedger
): Promise<number> {
    const { sample: quiet } = await waitForJourneyQuiet({
        inFlight: (activity) => activity.inFlight,
        pollMs: POLL_MS,
        quietMs: QUIET_MS,
        sample: async () => ({
            inFlight: ledger.inFlight(),
            requests: ledger.mark(),
        }),
        timeoutError: () => new Error('open-source-journey-mock-not-quiet'),
        timeoutMs: SETTLE_TIMEOUT_MS,
    });
    // The window ends at the ledger position this accepted sample read. A
    // request that arrives after it was never seen in flight, so its
    // response and follow-ups are not waited for; counting it would make
    // the counter depend on when the ledger is read.
    return quiet.requests;
}

/**
 * `spawnLedgerMark` is the ledger position taken before the process was
 * spawned, so the launch's own mock traffic is kept as evidence.
 */
export async function measureOpenSourceJourney(
    session: LaunchJourneySession,
    ledger: JourneyMockRequestLedger,
    spawnLedgerMark: number,
    timeoutMs: number
): Promise<OpenSourceJourneyMeasurement> {
    const { electronApp, mainWindow } = session;
    const probeOptions = createOpenSourceJourneyProbeOptions();
    const startClick = probeOptions.startClick;
    if (!startClick) {
        throw new Error('open-source-journey-probe-without-start');
    }
    await installJourneyMainIpcCapture(electronApp, {
        channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
        sentinelId: probeOptions.sentinelId,
        sentinelMethod: probeOptions.sentinelMethod,
        startSentinelId: startClick.sentinelId,
        stateKey: OPEN_SOURCE_JOURNEY_MAIN_IPC_STATE_KEY,
    });
    await armJourneyRendererProbe(mainWindow, probeOptions);
    const card = mainWindow
        .locator(startClick.selector)
        .filter({ hasText: defaultXtreamPortalName })
        .first();
    // Hover first so hover effects (and anything they trigger) happen
    // before the app settles, not inside the measured window.
    await card.hover({ timeout: timeoutMs });
    // The boundary for late requests is the ledger position the accepted
    // quiet sample read, like its DOM and IPC counts; a fresh mark taken
    // here would skip a request that arrived while that sample was still
    // reading the IPC capture. Requests from that position on but before
    // the renderer's click stamp arrived after the app settled, and the
    // record rejects such an iteration.
    const { ledgerMark: settledLedgerMark, settle } = await waitForQuiet(
        electronApp,
        mainWindow,
        ledger,
        probeOptions.stateKey
    );
    // J1's capture was only needed to see pending launch calls while
    // settling; detached, it no longer runs for every J2 bridge call.
    await detachJourneyMainIpcCapture(electronApp, JOURNEY_MAIN_IPC_STATE_KEY);
    await card.click({ timeout: timeoutMs });
    const renderer: JourneyRendererProbeState =
        await waitForJourneyRendererProbe(
            mainWindow,
            probeOptions.stateKey,
            timeoutMs
        );
    const ipc = await readJourneyMainIpcCapture(
        electronApp,
        OPEN_SOURCE_JOURNEY_MAIN_IPC_STATE_KEY,
        10_000
    );
    const settledAfterLedgerMark = await waitForMockQuiet(ledger);
    await new Promise((resolve) =>
        setTimeout(resolve, LATE_REQUEST_OBSERVATION_MS)
    );
    // The journey starts at the renderer's click stamp, not when Playwright
    // began its actionability checks, so a request that arrives in between
    // stays before the click like it does for every other J2 counter. The
    // ledger's clock is this process's wall clock and the stamp is the
    // renderer's; both read the same host clock.
    const clickEpochMs = renderer.start?.epochMs;
    if (clickEpochMs === undefined) {
        throw new Error('open-source-journey-click-not-started');
    }
    const sinceSpawn = ledger.since(spawnLedgerMark);
    const beforeClick = sinceSpawn.filter(
        (entry) => entry.epochMs < clickEpochMs
    );
    const afterClick = sinceSpawn.filter(
        (entry) => entry.epochMs >= clickEpochMs
    );
    return {
        http: {
            afterSettleBeforeClick: beforeClick.filter(
                (entry) => entry.sequence >= settledLedgerMark
            ).length,
            afterSettled: afterClick.filter(
                (entry) => entry.sequence >= settledAfterLedgerMark
            ),
            beforeClick,
            requests: afterClick.filter(
                (entry) => entry.sequence < settledAfterLedgerMark
            ),
        },
        ipc,
        pid: session.launch.pid,
        renderer,
        settle,
    };
}
