import type { JourneyRendererGateState } from '../journeys/journey-renderer-gate-client';
import {
    JOURNEY_MAIN_COUNTER,
    type JourneyMainCountersState,
} from './journey-main-counters';
import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import type { JourneyRendererProbeState } from './journey-renderer-probe';
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
    DOM_MUTATIONS: 'renderer.domMutationsToFirstCard',
    IPC_CALLS: 'renderer.ipcCallsToFirstCard',
    LAYOUT_SHIFT_SCORE: 'renderer.layoutShiftScore',
    LAYOUT_SHIFT_SCORE_SETTLED: 'renderer.layoutShiftScoreSettled',
    LONG_TASKS: 'renderer.longTasks',
} as const;

export const LAUNCH_JOURNEY_WALL_CLOCK = {
    SPAWN_TO_DID_FINISH_LOAD: 'spawnToDidFinishLoadMs',
    SPAWN_TO_FIRST_CARD: 'spawnToFirstCardMs',
} as const;

/**
 * Counters the plan lists for J1 that this harness cannot measure without
 * production changes. They are reported instead of faked.
 */
export const LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS: Readonly<
    Record<string, string>
> = Object.freeze({
    'renderer.cdTicksToFirstCard':
        'The electron-performance build optimizes scripts (ngDevMode=false), so Angular does not publish window.ng and ɵsetProfiler is unavailable.',
});

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
    const { settle } = renderer;
    if (
        (settle.status !== 'quiet' && settle.status !== 'cap') ||
        settle.epochMs === null ||
        renderer.firstCardPaintEpochMs === null ||
        settle.epochMs < renderer.firstCardPaintEpochMs
    ) {
        throw new Error(`launch-journey-record-settle-${settle.status}`);
    }
    if (
        renderer.capabilities.changeDetectionTicks !==
        'unavailable-ng-global-not-published'
    ) {
        throw new Error(
            `launch-journey-record-cd-hook-${renderer.capabilities.changeDetectionTicks}`
        );
    }
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
            [LAUNCH_JOURNEY_COUNTER.DOM_MUTATIONS]:
                renderer.counters.domMutations,
            [LAUNCH_JOURNEY_COUNTER.IPC_CALLS]: ipc.callsBeforeSentinel,
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
            ipcCallsAfterFirstCard: ipc.callsAfterSentinel,
            // Running totals when the counters were read, after the first card.
            mainCountersAtRead: mainCounters.counters,
            rendererGateReadyToShowHeldOnBlank:
                measurement.gate.readyToShowHeldOnBlank,
            ipcCallsByMethod: ipc.callsByMethod,
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
