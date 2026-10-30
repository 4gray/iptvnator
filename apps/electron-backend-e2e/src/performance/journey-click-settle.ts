import type { ElectronApplication, Page } from '@playwright/test';

import {
    countJourneyMainIpcInFlight,
    JOURNEY_MAIN_IPC_STATE_KEY,
    peekJourneyMainIpcCaptures,
} from './journey-main-ipc-capture';
import type { JourneyMockRequestLedger } from './journey-mock-request-ledger';
import { waitForJourneyQuiet } from './journey-quiet-wait';

/**
 * Settling for the click-started journeys (J2 "Open a source", J3
 * "Playback"). Before the click the app must be quiet, so leftovers of the
 * startup or of the navigation to the start screen are not attributed to
 * the click. Contract: docs/architecture/performance-journeys.md.
 */
export const JOURNEY_CLICK_QUIET_MS = 1_000;
const POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 30_000;

/** How long the app was left alone before the click, and what it did. */
export interface JourneyClickSettle {
    readonly preStartDomMutations: number;
    readonly preStartHttpRequests: number;
    readonly preStartIpcCalls: number;
    readonly quietMs: number;
    readonly waitedMs: number;
}

export interface JourneyClickSettleOptions {
    /** Prefix of the timeout errors, e.g. `open-source-journey`. */
    readonly errorPrefix: string;
    /** State key of the journey's own IPC capture (with a start sentinel). */
    readonly ipcCaptureStateKey: string;
    readonly probeStateKey: string;
}

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
 * `JOURNEY_CLICK_QUIET_MS` with no mock request and no bridge call in
 * flight: a slow response or a pending bridge call can still change the DOM
 * or trigger follow-up work after the click. Pending bridge calls come from
 * J1's capture, which was installed before the document loaded and so has
 * seen every call start. An app that never settles fails the iteration
 * instead of producing a count that includes its background work.
 */
export async function waitForJourneyClickQuiet(
    electronApp: ElectronApplication,
    page: Page,
    ledger: JourneyMockRequestLedger,
    options: JourneyClickSettleOptions
): Promise<{
    /** Ledger position read by the accepted quiet sample itself. */
    readonly ledgerMark: number;
    readonly settle: JourneyClickSettle;
}> {
    const armMark = ledger.mark();
    const sample = async (): Promise<ActivitySample> => {
        // Both captures in one snapshot: a call counted by the journey's
        // capture is then also pending in J1's, never counted with a stale
        // in-flight 0.
        const [launchCapture, journeyCapture] =
            await peekJourneyMainIpcCaptures(electronApp, [
                JOURNEY_MAIN_IPC_STATE_KEY,
                options.ipcCaptureStateKey,
            ]);
        if (launchCapture.unmatchedCompletions > 0) {
            throw new Error(
                `${options.errorPrefix}-bridge-completions-unmatched`
            );
        }
        return {
            domMutations: await readPreStartMutations(
                page,
                options.probeStateKey
            ),
            httpInFlight: ledger.inFlight(),
            httpRequests: ledger.mark(),
            ipcCalls: journeyCapture.callsBeforeStart,
            ipcInFlight: countJourneyMainIpcInFlight(launchCapture),
        };
    };
    const { sample: quiet, waitedMs } = await waitForJourneyQuiet({
        inFlight: (activity) => activity.httpInFlight + activity.ipcInFlight,
        pollMs: POLL_MS,
        quietMs: JOURNEY_CLICK_QUIET_MS,
        sample,
        timeoutError: (activity) =>
            new Error(
                `${options.errorPrefix}-not-quiet: ${JSON.stringify(activity)}`
            ),
        timeoutMs: SETTLE_TIMEOUT_MS,
    });
    return {
        ledgerMark: quiet.httpRequests,
        settle: {
            preStartDomMutations: quiet.domMutations,
            preStartHttpRequests: quiet.httpRequests - armMark,
            preStartIpcCalls: quiet.ipcCalls,
            quietMs: JOURNEY_CLICK_QUIET_MS,
            waitedMs,
        },
    };
}

/**
 * Waits until the mock has seen no new request for `JOURNEY_CLICK_QUIET_MS`
 * and none is in flight, so responses slower than the quiet interval and
 * the requests they trigger stay inside the measured window.
 */
export async function waitForJourneyMockQuiet(
    ledger: JourneyMockRequestLedger,
    errorPrefix: string
): Promise<number> {
    const { sample: quiet } = await waitForJourneyQuiet({
        inFlight: (activity) => activity.inFlight,
        pollMs: POLL_MS,
        quietMs: JOURNEY_CLICK_QUIET_MS,
        sample: async () => ({
            inFlight: ledger.inFlight(),
            requests: ledger.mark(),
        }),
        timeoutError: () => new Error(`${errorPrefix}-mock-not-quiet`),
        timeoutMs: SETTLE_TIMEOUT_MS,
    });
    // The window ends at the ledger position this accepted sample read. A
    // request that arrives after it was never seen in flight, so its
    // response and follow-ups are not waited for; counting it would make
    // the counter depend on when the ledger is read.
    return quiet.requests;
}

/**
 * Rejects an iteration whose activity moved after the settle snapshot but
 * before the click (while Playwright ran its actionability checks): it
 * could complete after the click and be counted as the journey's. The probe
 * and the capture keep counting until the click itself, so they must still
 * match the snapshot. Returns the kinds that moved.
 */
export function journeyActivityBeforeClick(
    settle: JourneyClickSettle,
    observed: {
        readonly httpAfterSettleBeforeClick: number;
        readonly ipcCallsBeforeStart: number;
        readonly preStartDomMutations: number;
    }
): string[] {
    return [
        observed.preStartDomMutations !== settle.preStartDomMutations
            ? 'dom'
            : null,
        observed.ipcCallsBeforeStart !== settle.preStartIpcCalls ? 'ipc' : null,
        observed.httpAfterSettleBeforeClick > 0 ? 'http' : null,
    ].filter((kind): kind is string => kind !== null);
}
