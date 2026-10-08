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
 * Maps one measured "start playback" (renderer probe armed at the click and
 * ended by the video element's `playing` event, main IPC capture between the
 * start and end sentinels, mock request ledger) to the journey summary's
 * iteration record for J3.
 */
export const PLAYBACK_JOURNEY_ID = 'playback';

export const PLAYBACK_JOURNEY_COUNTER = {
    CD_TICKS: 'renderer.cdTicksToPlaying',
    DOM_MUTATIONS: 'renderer.domMutationsToPlaying',
    HTTP_REQUESTS: 'renderer.httpRequestsToPlaying',
    IPC_CALLS: 'renderer.ipcCallsToPlaying',
    LAYOUT_SHIFT_SCORE: 'renderer.layoutShiftScore',
    LONG_TASKS: 'renderer.longTasks',
} as const;

export const PLAYBACK_JOURNEY_WALL_CLOCK = {
    /** Click until the video element's first `loadedmetadata`. */
    CLICK_TO_LOADED_METADATA: 'clickToLoadedMetadataMs',
    /** Click until its first `playing`. */
    CLICK_TO_PLAYING: 'clickToPlayingMs',
} as const;

/** How long requests after `playing` are observed, for evidence only. */
export const PLAYBACK_JOURNEY_AFTER_PLAYING_WINDOW_MS = 1_000;

export const PLAYBACK_JOURNEY_UNAVAILABLE_COUNTERS: Readonly<
    Record<string, string>
> = Object.freeze({
    'renderer.ipcSerialDepthToPlaying':
        'The serial-depth helper is being added for J1 in a separate thread and is not on master yet; J3 adopts it once it lands.',
});

export interface PlaybackJourneyMeasurement {
    /** Logo requests to picsum.photos cancelled in the main process. */
    readonly externalArtworkCancelled: number;
    readonly http: {
        /** Requests in the first second after `playing`. */
        readonly afterPlaying: readonly JourneyMockRequest[];
        /** Mock requests after the app settled but before the click stamp. */
        readonly afterSettleBeforeClick: number;
        /** Mock requests from the spawn (J1, navigation, settling). */
        readonly beforeClick: readonly JourneyMockRequest[];
        /** Mock requests from the click stamp until `playing`. */
        readonly toPlaying: readonly JourneyMockRequest[];
    };
    readonly ipc: JourneyMainIpcCaptureState;
    readonly pid: number;
    readonly renderer: JourneyRendererProbeState;
    readonly settle: JourneyClickSettle;
}

const ROUTE_FRAGMENT = '/workspace/xtreams/';
const LIVE_STREAM_ROUTE = /^\/live\/:username\/:password\/[^/]+\.ts$/;

/**
 * Distance of the nearest ledger request to a boundary on either side
 * (null when there is none). The ledger and the renderer stamp with
 * different processes' clocks; a small margin flags a count that a clock
 * difference could move across the boundary.
 */
function boundaryMarginMs(
    before: readonly JourneyMockRequest[],
    after: readonly JourneyMockRequest[],
    boundaryEpochMs: number
): number | null {
    const distances = [
        ...before.map((entry) => boundaryEpochMs - entry.epochMs),
        ...after.map((entry) => entry.epochMs - boundaryEpochMs),
    ];
    return distances.length === 0 ? null : roundTenth(Math.min(...distances));
}

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function roundThousandth(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}

export function toPlaybackIterationRecord(
    index: number,
    warmup: boolean,
    measurement: PlaybackJourneyMeasurement
): JourneyIterationRecord {
    const { http, ipc, renderer, settle } = measurement;
    const { media, start, terminal } = renderer;
    if (start === null || terminal === null || media === null) {
        throw new Error('playback-journey-record-incomplete-probe');
    }
    if (ipc.start === null) {
        throw new Error('playback-journey-record-ipc-without-start');
    }
    if (
        !start.pathname.includes(ROUTE_FRAGMENT) ||
        !start.pathname.includes('/live')
    ) {
        throw new Error('playback-journey-record-start-route');
    }
    if (terminal.cardTag !== 'video' || media.element === null) {
        throw new Error('playback-journey-record-not-a-video');
    }
    const loadedMetadataEpochMs = media.phases['loadedmetadata'];
    const clickToPlayingMs = terminal.epochMs - start.epochMs;
    if (
        loadedMetadataEpochMs === undefined ||
        loadedMetadataEpochMs < start.epochMs ||
        loadedMetadataEpochMs > terminal.epochMs ||
        clickToPlayingMs <= 0
    ) {
        throw new Error('playback-journey-record-clock-order');
    }
    // The stream itself must have come from the mock's local fixture; a
    // player that played something else did not measure this journey.
    if (!http.toPlaying.some((entry) => LIVE_STREAM_ROUTE.test(entry.route))) {
        throw new Error('playback-journey-record-no-local-stream');
    }
    const lateActivity = journeyActivityBeforeClick(settle, {
        httpAfterSettleBeforeClick: http.afterSettleBeforeClick,
        ipcCallsBeforeStart: ipc.callsBeforeStart,
        preStartDomMutations: renderer.preStart.domMutations,
    });
    if (lateActivity.length > 0) {
        throw new Error(
            `playback-journey-record-activity-before-click-${lateActivity.join('-')}`
        );
    }
    const cdTicks = renderer.counters.changeDetectionTicks;
    if (
        renderer.capabilities.changeDetectionTicks !== 'counted' ||
        cdTicks === null
    ) {
        throw new Error(
            `playback-journey-record-cd-ticks-${renderer.capabilities.changeDetectionTicks}`
        );
    }
    return Object.freeze({
        counters: Object.freeze({
            [PLAYBACK_JOURNEY_COUNTER.CD_TICKS]: cdTicks,
            [PLAYBACK_JOURNEY_COUNTER.DOM_MUTATIONS]:
                renderer.counters.domMutations,
            [PLAYBACK_JOURNEY_COUNTER.HTTP_REQUESTS]: http.toPlaying.length,
            [PLAYBACK_JOURNEY_COUNTER.IPC_CALLS]: ipc.callsBeforeSentinel,
            // The click's 500 ms input window covers the start of the
            // journey, so shifts flagged hadRecentInput are included, as
            // in J2.
            [PLAYBACK_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE]: roundThousandth(
                renderer.counters.layoutShiftScore +
                    renderer.counters.recentInputLayoutShiftScore
            ),
            [PLAYBACK_JOURNEY_COUNTER.LONG_TASKS]: renderer.counters.longTasks,
        }),
        evidence: Object.freeze({
            capabilities: renderer.capabilities,
            epochs: Object.freeze({
                click: start.epochMs,
                clickListener: start.listenerEpochMs,
                loadedMetadata: loadedMetadataEpochMs,
                mainIpcSentinel: ipc.sentinel.receivedEpochMs,
                mainIpcStart: ipc.start.receivedEpochMs,
                playing: terminal.epochMs,
            }),
            externalArtworkCancelled: measurement.externalArtworkCancelled,
            httpRequestsAfterPlayingByRoute: countJourneyMockRoutes(
                http.afterPlaying
            ),
            httpRequestsBeforeClickByRoute: countJourneyMockRoutes(
                http.beforeClick
            ),
            httpRequestsByRoute: countJourneyMockRoutes(http.toPlaying),
            httpBoundaryMarginsMs: Object.freeze({
                click: boundaryMarginMs(
                    http.beforeClick,
                    http.toPlaying,
                    start.epochMs
                ),
                playing: boundaryMarginMs(
                    http.toPlaying,
                    http.afterPlaying,
                    terminal.epochMs
                ),
            }),
            ipcCallsAfterPlaying: ipc.callsAfterSentinel,
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
            media: Object.freeze({
                ...media.element,
                currentTime: roundThousandth(media.element.currentTime),
                videoElements: terminal.cardCount,
            }),
            settle,
            start: Object.freeze({
                pathname: start.pathname,
                targetTag: start.targetTag,
                targetTestId: start.targetTestId,
            }),
            terminalPathname: terminal.pathname,
        }),
        index,
        pid: measurement.pid,
        wallClock: Object.freeze({
            [PLAYBACK_JOURNEY_WALL_CLOCK.CLICK_TO_LOADED_METADATA]: roundTenth(
                loadedMetadataEpochMs - start.epochMs
            ),
            [PLAYBACK_JOURNEY_WALL_CLOCK.CLICK_TO_PLAYING]:
                roundTenth(clickToPlayingMs),
        }),
        warmup,
    });
}
