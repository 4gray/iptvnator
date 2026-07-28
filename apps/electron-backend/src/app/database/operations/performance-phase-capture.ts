import type {
    PerformancePhaseMetadata,
    XtreamDatabasePerformancePhase,
} from '@iptvnator/shared/interfaces';

export interface DatabaseOperationPerformancePhaseCapture {
    captureAsync: <TResult>(
        phase: XtreamDatabasePerformancePhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => Promise<TResult>;
    captureSync: <TResult>(
        phase: XtreamDatabasePerformancePhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => TResult;
}
