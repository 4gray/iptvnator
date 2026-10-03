import {
    journeyActivityBeforeClick,
    type JourneyClickSettle,
} from './journey-click-settle';
import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import {
    countJourneyMockRoutes,
    type JourneyMockRequest,
} from './journey-mock-request-ledger';
import type { JourneyRendererProbeState } from './journey-renderer-probe';
import type { JourneyIterationRecord } from './journey-summary';

/**
 * Maps one measured "open a source" (renderer probe armed at the click, main
 * IPC capture between the start and end sentinels, mock request ledger) to
 * the journey summary's iteration record for J2.
 */
export const OPEN_SOURCE_JOURNEY_ID = 'open-source';

export const OPEN_SOURCE_JOURNEY_COUNTER = {
    CD_TICKS: 'renderer.cdTicksToFirstPage',
    DOM_MUTATIONS: 'renderer.domMutationsToFirstPage',
    IPC_CALLS: 'renderer.ipcCallsToFirstPage',
    LAYOUT_SHIFT_SCORE: 'renderer.layoutShiftScore',
    LONG_TASKS: 'renderer.longTasks',
    MOCK_HTTP_REQUESTS: 'main.mockHttpRequestsToSettled',
} as const;

export const OPEN_SOURCE_JOURNEY_WALL_CLOCK = {
    /** Click until the batch that made the first page visible. */
    CLICK_TO_FIRST_PAGE: 'clickToFirstPageMs',
    /** Click until the frame that paints it has been committed. */
    CLICK_TO_FIRST_PAGE_PAINT: 'clickToFirstPagePaintMs',
} as const;

export const OPEN_SOURCE_JOURNEY_UNAVAILABLE_COUNTERS: Readonly<
    Record<string, string>
> = Object.freeze({
    'main.sqlStatementsToFirstPage':
        'The main.sqlStatements running total is read from the test process through the journey gate, so it cannot be sampled at the click or at the first-page batch, and the worker count is ordered against worker responses rather than the renderer. A click-to-settled count is a follow-up.',
});

/** How long the app was left alone before the click, and what it did. */
export type OpenSourceJourneySettle = JourneyClickSettle;

export interface OpenSourceJourneyMeasurement {
    readonly http: {
        /** Mock requests after the app settled but before the click stamp. */
        readonly afterSettleBeforeClick: number;
        /**
         * Requests after the post-terminal quiet sample; outside the window
         * because their completion was not waited for.
         */
        readonly afterSettled: readonly JourneyMockRequest[];
        /** Mock requests from the spawn (J1 and settling) until the click. */
        readonly beforeClick: readonly JourneyMockRequest[];
        /** Mock requests from the click until the mock was quiet again. */
        readonly requests: readonly JourneyMockRequest[];
    };
    readonly ipc: JourneyMainIpcCaptureState;
    readonly pid: number;
    readonly renderer: JourneyRendererProbeState;
    readonly settle: OpenSourceJourneySettle;
}

const ROUTE_FRAGMENT = '/workspace/xtreams/';

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function roundThousandth(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}

export function toOpenSourceIterationRecord(
    index: number,
    warmup: boolean,
    measurement: OpenSourceJourneyMeasurement
): JourneyIterationRecord {
    const { http, ipc, renderer, settle } = measurement;
    const { start, terminal } = renderer;
    if (start === null || terminal === null) {
        throw new Error('open-source-journey-record-incomplete-probe');
    }
    if (ipc.start === null) {
        throw new Error('open-source-journey-record-ipc-without-start');
    }
    if (!terminal.pathname.includes(ROUTE_FRAGMENT)) {
        throw new Error('open-source-journey-record-route');
    }
    if (start.pathname.includes(ROUTE_FRAGMENT)) {
        throw new Error('open-source-journey-record-started-inside-source');
    }
    const clickToFirstPageMs = terminal.epochMs - start.epochMs;
    const paintEpochMs = renderer.firstCardPaintEpochMs;
    if (
        clickToFirstPageMs <= 0 ||
        paintEpochMs === null ||
        paintEpochMs < terminal.epochMs
    ) {
        throw new Error('open-source-journey-record-clock-order');
    }
    // Activity that started after the settle snapshot but before the click
    // (while Playwright ran its actionability checks) could complete after
    // the click and be counted as J2. The probe and the capture keep
    // counting until the click itself, so they must still match the
    // snapshot; otherwise the iteration is rejected.
    const lateActivity = journeyActivityBeforeClick(settle, {
        httpAfterSettleBeforeClick: http.afterSettleBeforeClick,
        ipcCallsBeforeStart: ipc.callsBeforeStart,
        preStartDomMutations: renderer.preStart.domMutations,
    });
    if (lateActivity.length > 0) {
        throw new Error(
            `open-source-journey-record-activity-before-click-${lateActivity.join('-')}`
        );
    }
    const cdTicks = renderer.counters.changeDetectionTicks;
    if (
        renderer.capabilities.changeDetectionTicks !== 'counted' ||
        cdTicks === null
    ) {
        throw new Error(
            `open-source-journey-record-cd-ticks-${renderer.capabilities.changeDetectionTicks}`
        );
    }
    // The ledger's clock is the test process's, the terminal's the
    // renderer's; the split is evidence only.
    const requestsToFirstPage = http.requests.filter(
        (entry) => entry.epochMs <= terminal.epochMs
    ).length;
    const section = terminal.pathname
        .slice(
            terminal.pathname.indexOf(ROUTE_FRAGMENT) + ROUTE_FRAGMENT.length
        )
        .split('/')[1];
    return Object.freeze({
        counters: Object.freeze({
            [OPEN_SOURCE_JOURNEY_COUNTER.CD_TICKS]: cdTicks,
            [OPEN_SOURCE_JOURNEY_COUNTER.DOM_MUTATIONS]:
                renderer.counters.domMutations,
            [OPEN_SOURCE_JOURNEY_COUNTER.IPC_CALLS]: ipc.callsBeforeSentinel,
            // The whole journey runs inside the 500 ms window after the
            // click, so shifts flagged hadRecentInput are included.
            [OPEN_SOURCE_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE]: roundThousandth(
                renderer.counters.layoutShiftScore +
                    renderer.counters.recentInputLayoutShiftScore
            ),
            [OPEN_SOURCE_JOURNEY_COUNTER.LONG_TASKS]:
                renderer.counters.longTasks,
            [OPEN_SOURCE_JOURNEY_COUNTER.MOCK_HTTP_REQUESTS]:
                http.requests.length,
        }),
        evidence: Object.freeze({
            capabilities: renderer.capabilities,
            epochs: Object.freeze({
                click: start.epochMs,
                clickListener: start.listenerEpochMs,
                firstPage: terminal.epochMs,
                firstPagePaint: renderer.firstCardPaintEpochMs,
                mainIpcStart: ipc.start.receivedEpochMs,
                mainIpcSentinel: ipc.sentinel.receivedEpochMs,
            }),
            firstPage: Object.freeze({
                cardCount: terminal.cardCount,
                cardTag: terminal.cardTag,
                cardTestId: terminal.cardTestId,
                categoryCount: terminal.companionCounts[0] ?? null,
                pathname: terminal.pathname,
                section: section ?? null,
            }),
            httpRequestsBeforeClickByRoute: countJourneyMockRoutes(
                http.beforeClick
            ),
            httpRequestsAfterSettledByRoute: countJourneyMockRoutes(
                http.afterSettled
            ),
            httpRequestsByRoute: countJourneyMockRoutes(http.requests),
            httpRequestsToFirstPage: requestsToFirstPage,
            ipcCallsAfterFirstPage: ipc.callsAfterSentinel,
            ipcCallsByMethod: ipc.callsByMethod,
            layoutShift: Object.freeze({
                recentInput: roundThousandth(
                    renderer.counters.recentInputLayoutShiftScore
                ),
                withoutRecentInput: roundThousandth(
                    renderer.counters.layoutShiftScore
                ),
            }),
            longTaskDurationsMs: renderer.longTaskDurationsMs.map(roundTenth),
            settle,
            start: Object.freeze({
                pathname: start.pathname,
                targetTag: start.targetTag,
                targetTestId: start.targetTestId,
            }),
        }),
        index,
        pid: measurement.pid,
        wallClock: Object.freeze({
            [OPEN_SOURCE_JOURNEY_WALL_CLOCK.CLICK_TO_FIRST_PAGE]:
                roundTenth(clickToFirstPageMs),
            [OPEN_SOURCE_JOURNEY_WALL_CLOCK.CLICK_TO_FIRST_PAGE_PAINT]:
                roundTenth(paintEpochMs - start.epochMs),
        }),
        warmup,
    });
}
