import type {
    XtreamDatabasePerformancePhase,
    PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';

export interface RecordedOperationPhase {
    readonly boundary: 'end' | 'start';
    readonly metadata?: PerformancePhaseMetadata;
    readonly phase: XtreamDatabasePerformancePhase;
}

export function createRecordingOperationPhaseCapture(
    onBoundary?: (event: RecordedOperationPhase) => void
): {
    readonly capture: DatabaseOperationPerformancePhaseCapture;
    readonly events: RecordedOperationPhase[];
} {
    const events: RecordedOperationPhase[] = [];
    const record = (event: RecordedOperationPhase): void => {
        events.push(event);
        onBoundary?.(event);
    };

    return {
        capture: {
            async captureAsync<TResult>(
                phase: XtreamDatabasePerformancePhase,
                execute: () => Promise<TResult>,
                metadata?: (result: TResult) => PerformancePhaseMetadata
            ): Promise<TResult> {
                record({ boundary: 'start', phase });
                try {
                    const result = await execute();
                    record({
                        boundary: 'end',
                        metadata: metadata?.(result),
                        phase,
                    });
                    return result;
                } catch (error) {
                    record({ boundary: 'end', phase });
                    throw error;
                }
            },
            captureSync<TResult>(
                phase: XtreamDatabasePerformancePhase,
                execute: () => TResult,
                metadata?: (result: TResult) => PerformancePhaseMetadata
            ): TResult {
                record({ boundary: 'start', phase });
                try {
                    const result = execute();
                    record({
                        boundary: 'end',
                        metadata: metadata?.(result),
                        phase,
                    });
                    return result;
                } catch (error) {
                    record({ boundary: 'end', phase });
                    throw error;
                }
            },
        },
        events,
    };
}
