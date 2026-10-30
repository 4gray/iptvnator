import { defaultXtreamPortalName } from '../electron-test-fixtures';
import {
    JOURNEY_CLICK_QUIET_MS,
    waitForJourneyClickQuiet,
    waitForJourneyMockQuiet,
} from '../performance/journey-click-settle';
import {
    detachJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_MAIN_IPC_STATE_KEY,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    readJourneyMainIpcCapture,
} from '../performance/journey-main-ipc-capture';
import type { JourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import {
    armJourneyRendererProbe,
    createOpenSourceJourneyProbeOptions,
    waitForJourneyRendererProbe,
    type JourneyRendererProbeState,
} from '../performance/journey-renderer-probe';
import type { OpenSourceJourneyMeasurement } from '../performance/open-source-journey-record';
import type { LaunchJourneySession } from './launch-journey-app';

/**
 * J2 "Open a source": runs inside a process that J1 has just launched, after
 * J1's counters are final. The app is first allowed to settle (no DOM
 * mutation, bridge call or mock request for `JOURNEY_CLICK_QUIET_MS`), so
 * leftovers of the startup are not attributed to the click. Then the Xtream portal card on
 * the dashboard is clicked and the probe, the IPC capture and the mock
 * request ledger measure until the category list and the first page of
 * items are painted.
 */
export const OPEN_SOURCE_JOURNEY_MAIN_IPC_STATE_KEY =
    '__iptvnatorJourneyOpenSourceMainIpcCapture';
const ERROR_PREFIX = 'open-source-journey';
/**
 * After the mock settled, the ledger is watched this much longer before it
 * is read, so requests that arrive after the accepted quiet sample show up
 * in `httpRequestsAfterSettledByRoute` instead of vanishing unseen.
 */
const LATE_REQUEST_OBSERVATION_MS = JOURNEY_CLICK_QUIET_MS;

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
    const { ledgerMark: settledLedgerMark, settle } =
        await waitForJourneyClickQuiet(electronApp, mainWindow, ledger, {
            errorPrefix: ERROR_PREFIX,
            ipcCaptureStateKey: OPEN_SOURCE_JOURNEY_MAIN_IPC_STATE_KEY,
            probeStateKey: probeOptions.stateKey,
        });
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
    const settledAfterLedgerMark = await waitForJourneyMockQuiet(
        ledger,
        ERROR_PREFIX
    );
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
