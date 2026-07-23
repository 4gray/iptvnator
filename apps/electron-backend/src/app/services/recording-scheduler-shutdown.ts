import type { PersistedRecordingItem } from '@iptvnator/shared/interfaces';
import type {
    RecordingEngine,
    RecordingEngineResult,
} from './recording-engine';
import type { RecordingRepository } from './recording-repository';
import { playbackSecretsCleared } from './recording-scheduler.utils';

const SHUTDOWN_STEP_TIMEOUT_MS = 7_000;

interface RecordingSchedulerShutdownContext {
    repository: RecordingRepository;
    engine: RecordingEngine;
    activeOperations: Promise<unknown>[];
    clearTimers(): void;
    runExclusive(
        recordingId: string,
        action: () => Promise<void>
    ): Promise<void>;
    markFailed(
        recordingId: string,
        error: unknown,
        engineResult?: RecordingEngineResult | null
    ): Promise<void>;
    nowIso(): string;
}

export async function shutdownRecordingRuntime(
    context: RecordingSchedulerShutdownContext
): Promise<void> {
    context.clearTimers();
    try {
        await settleWithin(
            Promise.allSettled(context.activeOperations),
            SHUTDOWN_STEP_TIMEOUT_MS
        );
        context.clearTimers();
        const active =
            (await settleWithin(
                context.repository.list(['recording']),
                SHUTDOWN_STEP_TIMEOUT_MS
            )) ?? [];
        await settleWithin(
            Promise.allSettled(
                active.map((recording) =>
                    context.runExclusive(recording.id, () =>
                        stopActiveRecording(context, recording)
                    )
                )
            ),
            SHUTDOWN_STEP_TIMEOUT_MS
        );
    } finally {
        await settleWithin(
            Promise.resolve(context.engine.shutdown()),
            SHUTDOWN_STEP_TIMEOUT_MS
        );
    }
}

async function stopActiveRecording(
    context: RecordingSchedulerShutdownContext,
    recording: PersistedRecordingItem
): Promise<void> {
    let engineResult: RecordingEngineResult | null = null;
    try {
        engineResult = await context.engine.stop(recording.id);
        await context.repository.update(recording.id, {
            ...engineResult,
            status: 'interrupted',
            completedAt: context.nowIso(),
            errorMessage: 'Recording stopped when IPTVnator quit',
            ...playbackSecretsCleared(),
        });
    } catch (error) {
        await context.markFailed(recording.id, error, engineResult);
    }
}

function settleWithin<T>(
    operation: Promise<T>,
    timeoutMs: number
): Promise<T | undefined> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(undefined), timeoutMs);
        timeout.unref?.();
        operation.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            () => {
                clearTimeout(timeout);
                resolve(undefined);
            }
        );
    });
}
