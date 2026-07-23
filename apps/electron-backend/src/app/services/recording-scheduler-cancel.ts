import type { RecordingActionResult } from '@iptvnator/shared/interfaces';
import type {
    RecordingEngine,
    RecordingEngineResult,
} from './recording-engine';
import type { RecordingRepository } from './recording-repository';
import type { RecordingSchedulerClock } from './recording-scheduler-clock';
import type { RecordingSchedulerRuntime } from './recording-scheduler.runtime';
import {
    playbackSecretsCleared,
    recordingErrorMessage,
} from './recording-scheduler.utils';

export async function cancelRecording(
    recordingId: string,
    repository: RecordingRepository,
    engine: RecordingEngine,
    runtime: RecordingSchedulerRuntime,
    clock: RecordingSchedulerClock,
    notify: () => void
): Promise<RecordingActionResult> {
    return runtime.runExclusive(recordingId, async () => {
        const recording = await repository.get(recordingId);
        if (!recording) {
            return { success: false, error: 'Recording not found' };
        }
        if (!['scheduled', 'recording'].includes(recording.status)) {
            return {
                success: false,
                error: 'Recording is already finished',
            };
        }

        let engineResult: RecordingEngineResult | null = null;
        if (recording.status === 'recording') {
            try {
                engineResult = await engine.stop(recordingId);
            } catch (error) {
                if (engine.hasActiveSession?.(recordingId)) {
                    return {
                        success: false,
                        error: recordingErrorMessage(error),
                    };
                }
                await runtime.markFailed(recordingId, error, engineResult);
                runtime.clearRecordingTimers(recordingId);
                return {
                    success: false,
                    error: recordingErrorMessage(error),
                };
            }
        }

        try {
            await repository.update(recordingId, {
                status: 'canceled',
                completedAt: clock.now().toISOString(),
                errorMessage: null,
                ...(engineResult ?? {}),
                ...playbackSecretsCleared(),
            });
            runtime.clearRecordingTimers(recordingId);
            notify();
            return { success: true };
        } catch (error) {
            try {
                await runtime.markFailed(recordingId, error, engineResult);
                runtime.clearRecordingTimers(recordingId);
            } catch {
                // Preserve the armed timer when persistence is unavailable.
            }
            return { success: false, error: recordingErrorMessage(error) };
        }
    });
}
