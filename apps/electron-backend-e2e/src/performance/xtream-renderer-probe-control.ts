import type { Page } from '@playwright/test';
import { RENDERER_PERFORMANCE_PHASE_HOOK_KEY } from '@iptvnator/shared/logging';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import {
    XTREAM_RENDERER_STATE_KEY,
    XTREAM_RENDERER_STOPPED_KEY,
    type XtreamRendererProbeMetrics,
} from './xtream-renderer-probe-contract';
import {
    recordFixedGridRendererHeartbeats,
} from './renderer-heartbeat-fixed-grid';

export async function beginXtreamRendererOperation(
    page: Page
): Promise<number> {
    return page.evaluate((stateKey) => {
        const state = (globalThis as unknown as Record<string, unknown>)[
            stateKey
        ] as
            | {
                  operationStartEpochMs: number;
                  operationStartMonotonicMs: number;
              }
            | undefined;
        if (!state || state.operationStartEpochMs > 0) {
            throw new Error('xtream-renderer-probe-unavailable');
        }
        state.operationStartMonotonicMs = performance.now();
        state.operationStartEpochMs =
            performance.timeOrigin + state.operationStartMonotonicMs;
        return state.operationStartEpochMs;
    }, XTREAM_RENDERER_STATE_KEY);
}

export async function recordXtreamRendererHeartbeat(
    page: Page,
    deadlineEpochMs: number
): Promise<number> {
    return recordFixedGridRendererHeartbeats(
        page,
        XTREAM_RENDERER_STATE_KEY,
        deadlineEpochMs,
        'xtream-renderer-probe-unavailable'
    );
}

export async function assertXtreamBackgroundDeleteActive(
    page: Page
): Promise<void> {
    await page.evaluate((stateKey) => {
        const state = (globalThis as unknown as Record<string, unknown>)[
            stateKey
        ] as
            | {
                  activeDeleteOperationId: string | null;
                  invalidReason: string | null;
              }
            | undefined;
        if (
            !state ||
            state.invalidReason !== null ||
            typeof state.activeDeleteOperationId !== 'string' ||
            state.activeDeleteOperationId.length === 0
        ) {
            throw new Error('xtream-background-delete-not-active');
        }
    }, XTREAM_RENDERER_STATE_KEY);
}

export async function assertXtreamBackgroundRefreshActive(
    page: Page,
    identity: {
        readonly operationId: string;
        readonly playlistId: string;
    }
): Promise<void> {
    await page.evaluate(
        ({ identity, stateKey }) => {
            const state = (globalThis as unknown as Record<string, unknown>)[
                stateKey
            ] as
                | {
                      dbOperationEvents: {
                          operation: string;
                          operationId: string | null;
                          playlistId: string | null;
                          status: string;
                      }[];
                      invalidReason: string | null;
                      operationStartEpochMs: number;
                      scenarioId: string;
                      storeTerminalEpochMs: number | null;
                      terminalEpochMs: number | null;
                  }
                | undefined;
            const deleteEvents =
                state?.dbOperationEvents.filter(
                    ({ operation }) => operation === 'delete-xtream-content'
                ) ?? [];
            const started = deleteEvents.filter(
                ({ status }) => status === 'started'
            );
            const terminal = deleteEvents.filter(({ status }) =>
                ['cancelled', 'completed', 'error'].includes(status)
            );
            if (
                !state ||
                state.scenarioId !== 'xtream-background-ui' ||
                state.invalidReason !== null ||
                state.operationStartEpochMs <= 0 ||
                state.storeTerminalEpochMs !== null ||
                state.terminalEpochMs !== null ||
                started.length !== 1 ||
                terminal.length > 1 ||
                terminal.some(({ status }) => status !== 'completed') ||
                deleteEvents.some(
                    ({ operationId, playlistId }) =>
                        operationId !== identity.operationId ||
                        playlistId !== identity.playlistId
                )
            ) {
                throw new Error('xtream-background-refresh-not-active');
            }
        },
        { identity, stateKey: XTREAM_RENDERER_STATE_KEY }
    );
}

export async function waitForXtreamRendererTerminal(page: Page): Promise<void> {
    await page.waitForFunction(
        (stateKey) => {
            const state = (globalThis as unknown as Record<string, unknown>)[
                stateKey
            ] as
                | {
                      invalidReason: string | null;
                      terminalEpochMs: number | null;
                  }
                | undefined;
            return (
                typeof state?.terminalEpochMs === 'number' ||
                typeof state?.invalidReason === 'string'
            );
        },
        XTREAM_RENDERER_STATE_KEY,
        { timeout: 120_000 }
    );
    await page.evaluate((stateKey) => {
        const state = (globalThis as unknown as Record<string, unknown>)[
            stateKey
        ] as { invalidReason: string | null } | undefined;
        if (!state) throw new Error('xtream-renderer-probe-unavailable');
        if (state.invalidReason) throw new Error(state.invalidReason);
    }, XTREAM_RENDERER_STATE_KEY);
}

export async function stopXtreamRendererProbe(
    page: Page
): Promise<XtreamRendererProbeMetrics> {
    return page.evaluate(
        ({ hookKey, stateKey, stoppedKey }) => {
            const target = globalThis as unknown as Record<
                PropertyKey,
                unknown
            >;
            const previous = target[stoppedKey] as
                XtreamRendererProbeMetrics | undefined;
            if (previous) return previous;
            const state = target[stateKey] as
                | (XtreamRendererProbeMetrics & {
                      dbUnsubscribe: (() => void) | null;
                      frameRequestId: number;
                      longTaskObserver: PerformanceObserver | null;
                      recordLongTask(entry: PerformanceEntry): void;
                      removeCancelClickListener: (() => void) | null;
                  })
                | undefined;
            if (!state) {
                throw new Error('xtream-renderer-probe-unavailable');
            }
            cancelAnimationFrame(state.frameRequestId);
            for (const entry of state.longTaskObserver?.takeRecords() ?? []) {
                state.recordLongTask(entry);
            }
            state.longTaskObserver?.disconnect();
            state.dbUnsubscribe?.();
            state.removeCancelClickListener?.();
            const snapshot: XtreamRendererProbeMetrics = {
                cancelEligibleProgressEpochMs:
                    state.cancelEligibleProgressEpochMs,
                cancellationClickEpochMs: state.cancellationClickEpochMs,
                dbCancellationTerminalEpochMs:
                    state.dbCancellationTerminalEpochMs,
                dbOperationEvents: [...state.dbOperationEvents],
                domReadyEpochMs: state.domReadyEpochMs,
                frameGapsMs: [...state.frameGapsMs],
                heartbeatDelaysMs: [...state.heartbeatDelaysMs],
                invalidReason: state.invalidReason,
                longTasksMs: [...state.longTasksMs],
                operationStartEpochMs: state.operationStartEpochMs,
                performancePhaseEvents: [...state.performancePhaseEvents],
                routeReadyEpochMs: state.routeReadyEpochMs,
                scenarioId: state.scenarioId,
                storeTerminalEpochMs: state.storeTerminalEpochMs,
                terminalEpochMs: state.terminalEpochMs,
                uiPaintedEpochMs: state.uiPaintedEpochMs,
            };
            target[stoppedKey] = snapshot;
            delete target[stateKey];
            delete target[Symbol.for(hookKey)];
            return snapshot;
        },
        {
            hookKey: RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
            stateKey: XTREAM_RENDERER_STATE_KEY,
            stoppedKey: XTREAM_RENDERER_STOPPED_KEY,
        }
    );
}

export function assertCompleteXtreamRendererProbe(
    probe: XtreamRendererProbeMetrics | null | undefined
): asserts probe is XtreamRendererProbeMetrics & {
    readonly storeTerminalEpochMs: number;
    readonly terminalEpochMs: number;
    readonly uiPaintedEpochMs: number;
} {
    const scenarios = new Set(Object.values(XTREAM_SCENARIO_ID));
    if (
        !probe ||
        !scenarios.has(probe.scenarioId) ||
        probe.invalidReason !== null ||
        !positive(probe.operationStartEpochMs) ||
        !positive(probe.routeReadyEpochMs) ||
        !positive(probe.storeTerminalEpochMs) ||
        !positive(probe.domReadyEpochMs) ||
        !positive(probe.uiPaintedEpochMs) ||
        !positive(probe.terminalEpochMs) ||
        probe.storeTerminalEpochMs < probe.operationStartEpochMs ||
        probe.routeReadyEpochMs < probe.operationStartEpochMs ||
        probe.domReadyEpochMs < probe.storeTerminalEpochMs ||
        probe.uiPaintedEpochMs < probe.storeTerminalEpochMs ||
        probe.uiPaintedEpochMs < probe.domReadyEpochMs ||
        probe.terminalEpochMs < probe.uiPaintedEpochMs
    ) {
        throw new Error('xtream-renderer-probe-incomplete');
    }
    if (
        probe.scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT &&
        (!positive(probe.cancelEligibleProgressEpochMs) ||
            !positive(probe.cancellationClickEpochMs) ||
            !positive(probe.dbCancellationTerminalEpochMs) ||
            probe.cancellationClickEpochMs <
                probe.cancelEligibleProgressEpochMs ||
            probe.dbCancellationTerminalEpochMs <
                probe.cancellationClickEpochMs ||
            probe.uiPaintedEpochMs < probe.dbCancellationTerminalEpochMs)
    ) {
        throw new Error('xtream-renderer-probe-incomplete');
    }
}

function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
