import type { JourneyRendererGateState } from '../journeys/journey-renderer-gate-client';
import {
    JOURNEY_MAIN_COUNTER,
    type JourneyMainCountersState,
} from './journey-main-counters';
import { computeJourneyIpcSerialDepth } from './journey-ipc-serial-depth';
import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import {
    JOURNEY_IDLE_WINDOW_MS,
    type JourneyRendererProbeState,
} from './journey-renderer-probe';
import type { JourneyIterationRecord } from './journey-summary';

/**
 * Maps one measured launch (renderer probe, main IPC capture and main-process
 * counters) to the journey summary's iteration record for J1 "Launch to
 * usable".
 */
export const LAUNCH_JOURNEY_ID = 'launch';

export const LAUNCH_JOURNEY_COUNTER = {
    MODULES_REGISTERED_BEFORE_WINDOW:
        JOURNEY_MAIN_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW,
    SQL_STATEMENTS_BEFORE_READY_TO_SHOW:
        JOURNEY_MAIN_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW,
    CD_TICKS: 'renderer.cdTicksToFirstCard',
    CD_TICKS_IDLE: 'renderer.cdTicksIdle30s',
    DOM_MUTATIONS: 'renderer.domMutationsToFirstCard',
    IPC_CALLS: 'renderer.ipcCallsToFirstCard',
    IPC_SERIAL_DEPTH: 'renderer.ipcSerialDepthToFirstCard',
    LAYOUT_SHIFT_SCORE: 'renderer.layoutShiftScore',
    LAYOUT_SHIFT_SCORE_SETTLED: 'renderer.layoutShiftScoreSettled',
    LONG_TASKS: 'renderer.longTasks',
} as const;

export const LAUNCH_JOURNEY_WALL_CLOCK = {
    SPAWN_TO_DID_FINISH_LOAD: 'spawnToDidFinishLoadMs',
    SPAWN_TO_FIRST_CARD: 'spawnToFirstCardMs',
} as const;

/**
 * Counters the plan lists for J1 that this harness cannot measure. Every one
 * is measured now; the list stays so a future gap is reported, not faked.
 */
export const LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS: Readonly<
    Record<string, string>
> = Object.freeze({});

/**
 * A timer on an idle page runs within milliseconds of its deadline; a window
 * that closed later than this measured a busy page, not an idle one.
 */
export const LAUNCH_JOURNEY_IDLE_LATE_TOLERANCE_MS = 1_000;

/**
 * The idle window opens in the settle timer's callback, but the settle point
 * is that timer's deadline. A callback that ran later than this left ticks
 * between the two outside both windows, and means the page was still busy
 * at the settle point, so the iteration is refused rather than undercounted.
 */
export const LAUNCH_JOURNEY_IDLE_START_TOLERANCE_MS = 100;

export interface LaunchJourneyMeasurement {
    readonly electronVersion: string;
    readonly gate: JourneyRendererGateState;
    readonly ipc: JourneyMainIpcCaptureState;
    /** Null when the launch ran without the main-process counters (J2). */
    readonly mainCounters: JourneyMainCountersState | null;
    readonly pid: number;
    readonly renderer: JourneyRendererProbeState;
    readonly spawnEpochMs: number;
}

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

/** Layout-shift scores keep three decimals; see performance-journeys.md. */
function roundThousandth(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}

export function toLaunchIterationRecord(
    index: number,
    warmup: boolean,
    measurement: LaunchJourneyMeasurement
): JourneyIterationRecord {
    const { ipc, mainCounters, renderer, spawnEpochMs } = measurement;
    if (mainCounters === null) {
        throw new Error('launch-journey-record-main-counters-missing');
    }
    if (renderer.terminal === null || renderer.navigation === null) {
        throw new Error('launch-journey-record-incomplete-probe');
    }
    const spawnToFirstCardMs = renderer.terminal.epochMs - spawnEpochMs;
    const spawnToDidFinishLoadMs =
        renderer.navigation.loadEventEndEpochMs - spawnEpochMs;
    if (
        spawnToDidFinishLoadMs <= 0 ||
        spawnToFirstCardMs <= spawnToDidFinishLoadMs
    ) {
        throw new Error('launch-journey-record-clock-order');
    }
    const serialDepth = computeJourneyIpcSerialDepth(ipc.timeline);
    const { settle } = renderer;
    if (
        (settle.status !== 'quiet' && settle.status !== 'cap') ||
        settle.epochMs === null ||
        renderer.firstCardPaintEpochMs === null ||
        settle.epochMs < renderer.firstCardPaintEpochMs
    ) {
        throw new Error(`launch-journey-record-settle-${settle.status}`);
    }
    const cdTicks = renderer.counters.changeDetectionTicks;
    if (
        renderer.capabilities.changeDetectionTicks !== 'counted' ||
        cdTicks === null
    ) {
        throw new Error(
            `launch-journey-record-cd-ticks-${renderer.capabilities.changeDetectionTicks}`
        );
    }
    const idle = assertLaunchIdleWindow(renderer, settle.epochMs);
    return Object.freeze({
        counters: Object.freeze({
            [LAUNCH_JOURNEY_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW]:
                mainCounters.counters[
                    LAUNCH_JOURNEY_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW
                ],
            [LAUNCH_JOURNEY_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW]:
                mainCounters.counters[
                    LAUNCH_JOURNEY_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW
                ],
            [LAUNCH_JOURNEY_COUNTER.CD_TICKS]: cdTicks,
            [LAUNCH_JOURNEY_COUNTER.CD_TICKS_IDLE]: idle.ticks,
            [LAUNCH_JOURNEY_COUNTER.DOM_MUTATIONS]:
                renderer.counters.domMutations,
            [LAUNCH_JOURNEY_COUNTER.IPC_CALLS]: ipc.callsBeforeSentinel,
            [LAUNCH_JOURNEY_COUNTER.IPC_SERIAL_DEPTH]: serialDepth.depth,
            [LAUNCH_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE]: roundThousandth(
                renderer.counters.layoutShiftScore
            ),
            [LAUNCH_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE_SETTLED]:
                roundThousandth(renderer.counters.layoutShiftScoreSettled),
            [LAUNCH_JOURNEY_COUNTER.LONG_TASKS]: renderer.counters.longTasks,
        }),
        evidence: Object.freeze({
            capabilities: renderer.capabilities,
            electronVersion: measurement.electronVersion,
            epochs: Object.freeze({
                firstCard: renderer.terminal.epochMs,
                firstCardPaint: renderer.firstCardPaintEpochMs,
                loadEventEnd: renderer.navigation.loadEventEndEpochMs,
                mainIpcCaptureInstalled: ipc.installedEpochMs,
                mainReadyToShow:
                    mainCounters.frozenAtEpochMs[
                        LAUNCH_JOURNEY_COUNTER
                            .SQL_STATEMENTS_BEFORE_READY_TO_SHOW
                    ],
                mainWindowCreated:
                    mainCounters.frozenAtEpochMs[
                        LAUNCH_JOURNEY_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW
                    ],
                mainProcessStart: ipc.processStartEpochMs,
                rendererGateBlankLoaded: measurement.gate.blankLoadedEpochMs,
                rendererGateReleased: measurement.gate.releasedEpochMs,
                rendererProbeInstalled: renderer.installed.epochMs,
                settled: settle.epochMs,
                spawn: spawnEpochMs,
            }),
            firstCard: Object.freeze({
                cardTag: renderer.terminal.cardTag,
                cardTestId: renderer.terminal.cardTestId,
                pathname: renderer.terminal.pathname,
            }),
            idle: Object.freeze({
                domMutations: idle.domMutations,
                durationMs: roundTenth(idle.durationMs),
                settledToIdleStartMs: roundTenth(
                    idle.startEpochMs - settle.epochMs
                ),
            }),
            ipcCallsAfterFirstCard: ipc.callsAfterSentinel,
            // Running totals when the counters were read, after the first card.
            mainCountersAtRead: mainCounters.counters,
            rendererGateReadyToShowHeldOnBlank:
                measurement.gate.readyToShowHeldOnBlank,
            ipcCallsByMethod: ipc.callsByMethod,
            ipcSerialDepth: serialDepth,
            ipcTimelineAmbiguousCompletions: ipc.ambiguousTimelineCompletions,
            // `+method` for a start, `-method` for a completion.
            ipcTimeline: ipc.timeline.map(
                ({ method, phase }) =>
                    `${phase === 'start' ? '+' : '-'}${method}`
            ),
            longTaskDurationsMs: renderer.longTaskDurationsMs.map(roundTenth),
            observedTarget: renderer.capabilities.observedTarget,
            settle: Object.freeze({
                domMutations: settle.domMutations,
                firstCardToSettledMs: roundTenth(
                    settle.epochMs - renderer.terminal.epochMs
                ),
                lateShifts: settle.lateShifts.map((shift) =>
                    Object.freeze({
                        afterFirstCardMs: roundTenth(shift.afterFirstCardMs),
                        sources: shift.sources,
                        value: Math.round(shift.value * 10_000) / 10_000,
                    })
                ),
                observedTarget: settle.observedTarget,
                reason: settle.status,
            }),
        }),
        index,
        pid: measurement.pid,
        wallClock: Object.freeze({
            [LAUNCH_JOURNEY_WALL_CLOCK.SPAWN_TO_DID_FINISH_LOAD]: roundTenth(
                spawnToDidFinishLoadMs
            ),
            [LAUNCH_JOURNEY_WALL_CLOCK.SPAWN_TO_FIRST_CARD]:
                roundTenth(spawnToFirstCardMs),
        }),
        warmup,
    });
}

/**
 * The idle window must have opened at or after the settle point and closed
 * on time; see performance-journeys.md.
 */
function assertLaunchIdleWindow(
    renderer: JourneyRendererProbeState,
    settledEpochMs: number
): {
    readonly domMutations: number;
    readonly durationMs: number;
    readonly startEpochMs: number;
    readonly ticks: number;
} {
    const { idle } = renderer;
    if (
        idle.status !== 'done' ||
        idle.ticks === null ||
        idle.startEpochMs === null ||
        idle.endEpochMs === null
    ) {
        throw new Error(`launch-journey-record-idle-${idle.status}`);
    }
    if (idle.startEpochMs < settledEpochMs) {
        throw new Error('launch-journey-record-idle-before-settle');
    }
    if (
        idle.startEpochMs - settledEpochMs >
        LAUNCH_JOURNEY_IDLE_START_TOLERANCE_MS
    ) {
        throw new Error('launch-journey-record-idle-start-late');
    }
    const durationMs = idle.endEpochMs - idle.startEpochMs;
    // Timers may fire up to a millisecond early after clamping.
    if (durationMs < JOURNEY_IDLE_WINDOW_MS - 1) {
        throw new Error('launch-journey-record-idle-window-short');
    }
    if (
        durationMs >
        JOURNEY_IDLE_WINDOW_MS + LAUNCH_JOURNEY_IDLE_LATE_TOLERANCE_MS
    ) {
        throw new Error('launch-journey-record-idle-window-late');
    }
    return {
        domMutations: idle.domMutations,
        durationMs,
        startEpochMs: idle.startEpochMs,
        ticks: idle.ticks,
    };
}
