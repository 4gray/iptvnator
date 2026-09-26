import type { JourneyRendererGateState } from '../journeys/journey-renderer-gate-client';
import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import type { JourneyRendererProbeState } from './journey-renderer-probe';
import type { JourneyIterationRecord } from './journey-summary';

/**
 * Maps one measured launch (renderer probe + main IPC capture) to the
 * journey summary's iteration record for J1 "Launch to usable".
 */
export const LAUNCH_JOURNEY_ID = 'launch';

export const LAUNCH_JOURNEY_COUNTER = {
    DOM_MUTATIONS: 'renderer.domMutationsToFirstCard',
    IPC_CALLS: 'renderer.ipcCallsToFirstCard',
    LAYOUT_SHIFT_SCORE: 'renderer.layoutShiftScore',
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
    'main.sqlStatementsBeforeReadyToShow':
        'SQL statements are only visible as worker stdout trace lines, which are forwarded asynchronously; plan item A2 adds a countable channel.',
    'renderer.cdTicksToFirstCard':
        'The electron-performance build optimizes scripts (ngDevMode=false), so Angular does not publish window.ng and ɵsetProfiler is unavailable.',
});

export interface LaunchJourneyMeasurement {
    readonly electronVersion: string;
    readonly gate: JourneyRendererGateState;
    readonly ipc: JourneyMainIpcCaptureState;
    readonly pid: number;
    readonly renderer: JourneyRendererProbeState;
    readonly spawnEpochMs: number;
}

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

export function toLaunchIterationRecord(
    index: number,
    warmup: boolean,
    measurement: LaunchJourneyMeasurement
): JourneyIterationRecord {
    const { ipc, renderer, spawnEpochMs } = measurement;
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
            [LAUNCH_JOURNEY_COUNTER.DOM_MUTATIONS]:
                renderer.counters.domMutations,
            [LAUNCH_JOURNEY_COUNTER.IPC_CALLS]: ipc.callsBeforeSentinel,
            [LAUNCH_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE]:
                Math.round(renderer.counters.layoutShiftScore * 1_000) / 1_000,
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
                mainProcessStart: ipc.processStartEpochMs,
                rendererGateBlankLoaded: measurement.gate.blankLoadedEpochMs,
                rendererGateReleased: measurement.gate.releasedEpochMs,
                rendererProbeInstalled: renderer.installed.epochMs,
                spawn: spawnEpochMs,
            }),
            firstCard: Object.freeze({
                cardTag: renderer.terminal.cardTag,
                cardTestId: renderer.terminal.cardTestId,
                pathname: renderer.terminal.pathname,
            }),
            ipcCallsAfterFirstCard: ipc.callsAfterSentinel,
            ipcCallsByMethod: ipc.callsByMethod,
            longTaskDurationsMs: renderer.longTaskDurationsMs.map(roundTenth),
            observedTarget: renderer.capabilities.observedTarget,
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
