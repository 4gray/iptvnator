import type { PersistedRecordingItem } from '@iptvnator/shared/interfaces';
import type { RecordingEngine } from './recording-engine';
import type { RecordingEngineResult } from './recording-engine';
import type { RecordingRepository } from './recording-repository';
import type {
    RecordingSchedulerClock,
    RecordingTimerHandle,
} from './recording-scheduler-clock';
import { recoverPersistedRecordings as recoverRecordings } from './recording-scheduler-recovery';
import { shutdownRecordingRuntime } from './recording-scheduler-shutdown';
import {
    effectiveRecordingEnd,
    effectiveRecordingStart,
    playbackSecretsCleared,
    recordingErrorMessage,
} from './recording-scheduler.utils';

const STOP_RETRY_DELAY_MS = 1_000;
type RecordingTimers = {
    start?: RecordingTimerHandle;
    end?: RecordingTimerHandle;
};

const MAX_TIMER_DELAY_MS = 2_147_000_000;

export class RecordingSchedulerRuntime {
    private readonly timers = new Map<string, RecordingTimers>();
    private readonly operations = new Map<string, Promise<unknown>>();

    constructor(
        private readonly repository: RecordingRepository,
        private readonly engine: RecordingEngine,
        private readonly clock: RecordingSchedulerClock,
        private readonly notify: () => void,
        private readonly isShuttingDown: () => boolean
    ) {
        this.engine.setFailureHandler?.((recordingId, error) => {
            void this.handleEngineFailure(recordingId, error).catch(
                () => undefined
            );
        });
    }

    async recoverPersistedRecordings(): Promise<void> {
        return recoverRecordings(
            this.repository,
            (recording) => this.armRecording(recording),
            this.notify,
            () => this.nowIso()
        );
    }

    async armRecording(recording: PersistedRecordingItem): Promise<void> {
        if (this.isShuttingDown()) {
            return;
        }
        const startsAt = effectiveRecordingStart(recording);
        const endsAt = effectiveRecordingEnd(recording);
        const now = this.clock.now().getTime();

        if (endsAt <= now) {
            await this.repository.update(recording.id, {
                status: 'missed',
                completedAt: this.nowIso(),
                errorMessage: 'Scheduled recording window elapsed',
                ...playbackSecretsCleared(),
            });
            this.notify();
            return;
        }
        if (startsAt <= now) {
            await this.startRecording(recording.id);
            return;
        }

        this.setTimer(recording.id, 'start', startsAt, () =>
            this.startRecording(recording.id)
        );
    }

    runExclusive<T>(recordingId: string, action: () => Promise<T>): Promise<T> {
        const previous = this.operations.get(recordingId) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(action);
        const cleanup = () => {
            if (this.operations.get(recordingId) === operation) {
                this.operations.delete(recordingId);
            }
        };
        void operation.then(cleanup, cleanup);
        this.operations.set(recordingId, operation);
        return operation;
    }

    clearRecordingTimers(recordingId: string): void {
        const timers = this.timers.get(recordingId);
        if (timers?.start) this.clock.clearTimeout(timers.start);
        if (timers?.end) this.clock.clearTimeout(timers.end);
        this.timers.delete(recordingId);
    }

    async markFailed(
        recordingId: string,
        error: unknown,
        engineResult?: RecordingEngineResult | null
    ): Promise<void> {
        await this.repository.update(recordingId, {
            ...(engineResult ?? {}),
            status: 'failed',
            completedAt: this.nowIso(),
            errorMessage: recordingErrorMessage(error),
            ...playbackSecretsCleared(),
        });
        this.notify();
    }

    async shutdown(): Promise<void> {
        await shutdownRecordingRuntime({
            repository: this.repository,
            engine: this.engine,
            activeOperations: [...this.operations.values()],
            clearTimers: () => this.clearAllTimers(),
            runExclusive: (recordingId, action) =>
                this.runExclusive(recordingId, action),
            markFailed: (recordingId, error, engineResult) =>
                this.markFailed(recordingId, error, engineResult),
            nowIso: () => this.nowIso(),
        });
    }

    private async startRecording(recordingId: string): Promise<void> {
        if (this.isShuttingDown()) {
            return;
        }
        await this.runExclusive(recordingId, async () => {
            if (this.isShuttingDown()) {
                return;
            }
            this.clearRecordingTimers(recordingId);
            let engineStarted = false;
            let engineResult: RecordingEngineResult | null = null;

            try {
                const recording = await this.repository.get(recordingId);
                if (!recording || recording.status !== 'scheduled') {
                    return;
                }
                if (
                    effectiveRecordingEnd(recording) <=
                    this.clock.now().getTime()
                ) {
                    await this.repository.update(recordingId, {
                        status: 'missed',
                        completedAt: this.nowIso(),
                        errorMessage: 'Scheduled recording window elapsed',
                        ...playbackSecretsCleared(),
                    });
                    this.notify();
                    return;
                }

                await this.repository.update(recordingId, {
                    status: 'recording',
                    startedAt: this.nowIso(),
                    errorMessage: null,
                });
                engineResult = await this.engine.start(recording);
                engineStarted = true;
                await this.repository.update(recordingId, engineResult);
                this.setTimer(
                    recordingId,
                    'end',
                    effectiveRecordingEnd(recording),
                    () => this.finishRecording(recordingId)
                );
                this.notify();
            } catch (error) {
                if (engineStarted) {
                    try {
                        engineResult = await this.engine.stop(recordingId);
                    } catch {
                        if (this.engine.hasActiveSession?.(recordingId)) {
                            const startError =
                                error instanceof Error
                                    ? error
                                    : new Error(String(error));
                            this.setTimer(
                                recordingId,
                                'end',
                                this.clock.now().getTime() +
                                    STOP_RETRY_DELAY_MS,
                                () =>
                                    this.handleEngineFailure(
                                        recordingId,
                                        startError
                                    )
                            );
                            return;
                        }
                    }
                }
                await this.markFailed(recordingId, error, engineResult);
            }
        });
    }

    private async finishRecording(recordingId: string): Promise<void> {
        await this.runExclusive(recordingId, async () => {
            this.clearRecordingTimers(recordingId);
            let engineResult: RecordingEngineResult | null = null;

            try {
                const recording = await this.repository.get(recordingId);
                if (!recording || recording.status !== 'recording') {
                    return;
                }
                engineResult = await this.engine.stop(recordingId);
                await this.repository.update(recordingId, {
                    ...engineResult,
                    status: 'completed',
                    completedAt: this.nowIso(),
                    errorMessage: null,
                    ...playbackSecretsCleared(),
                });
                this.notify();
            } catch (error) {
                if (this.engine.hasActiveSession?.(recordingId)) {
                    this.setTimer(
                        recordingId,
                        'end',
                        this.clock.now().getTime() + STOP_RETRY_DELAY_MS,
                        () => this.finishRecording(recordingId)
                    );
                    return;
                }
                await this.markFailed(recordingId, error, engineResult);
            }
        });
    }

    private async handleEngineFailure(
        recordingId: string,
        error: Error
    ): Promise<void> {
        await this.runExclusive(recordingId, async () => {
            this.clearRecordingTimers(recordingId);
            const recording = await this.repository.get(recordingId);
            if (!recording || recording.status !== 'recording') {
                return;
            }
            let engineResult: RecordingEngineResult | null = null;
            try {
                engineResult = await this.engine.stop(recordingId);
            } catch {
                if (this.engine.hasActiveSession?.(recordingId)) {
                    this.setTimer(
                        recordingId,
                        'end',
                        this.clock.now().getTime() + STOP_RETRY_DELAY_MS,
                        () => this.handleEngineFailure(recordingId, error)
                    );
                    return;
                }
            }
            await this.markFailed(recordingId, error, engineResult);
        });
    }

    private setTimer(
        recordingId: string,
        phase: keyof RecordingTimers,
        targetTime: number,
        callback: () => Promise<void>
    ): void {
        const delay = Math.max(0, targetTime - this.clock.now().getTime());
        const handle = this.clock.setTimeout(
            () => {
                if (delay > MAX_TIMER_DELAY_MS) {
                    this.setTimer(recordingId, phase, targetTime, callback);
                    return;
                }
                void callback().catch(() => undefined);
            },
            Math.min(delay, MAX_TIMER_DELAY_MS)
        );
        const timers = this.timers.get(recordingId) ?? {};
        timers[phase] = handle;
        this.timers.set(recordingId, timers);
    }

    private clearAllTimers(): void {
        for (const recordingId of this.timers.keys()) {
            this.clearRecordingTimers(recordingId);
        }
    }

    private nowIso(): string {
        return this.clock.now().toISOString();
    }
}
