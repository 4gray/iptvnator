import type { RendererPerformancePhaseEvent } from '@iptvnator/shared/logging';

import type { XtreamScenarioId } from './xtream-benchmark-contract';

export const XTREAM_RENDERER_STATE_KEY = '__iptvnatorXtreamRendererCapture';
export const XTREAM_RENDERER_STOPPED_KEY =
    '__iptvnatorXtreamRendererCaptureStopped';

export interface XtreamRendererDbEvent {
    readonly current: number | null;
    readonly epochMs: number;
    readonly increment: number | null;
    readonly operation: string;
    readonly operationId: string | null;
    readonly phase: string | null;
    readonly playlistId: string | null;
    readonly status: string;
    readonly total: number | null;
}

export interface XtreamRendererProbeMetrics {
    readonly cancelEligibleProgressEpochMs: number | null;
    readonly cancellationClickEpochMs: number | null;
    readonly dbCancellationTerminalEpochMs: number | null;
    readonly dbOperationEvents: readonly XtreamRendererDbEvent[];
    readonly domReadyEpochMs: number | null;
    readonly frameGapsMs: readonly number[];
    readonly heartbeatDelaysMs: readonly number[];
    readonly invalidReason: string | null;
    readonly longTasksMs: readonly number[];
    readonly operationStartEpochMs: number;
    readonly performancePhaseEvents: readonly RendererPerformancePhaseEvent[];
    readonly routeReadyEpochMs: number | null;
    readonly scenarioId: XtreamScenarioId;
    readonly storeTerminalEpochMs: number | null;
    readonly terminalEpochMs: number | null;
    readonly uiPaintedEpochMs: number | null;
}

export interface XtreamRendererProbeOptions {
    readonly scenarioId: XtreamScenarioId;
    readonly sourceTitle: string;
}
