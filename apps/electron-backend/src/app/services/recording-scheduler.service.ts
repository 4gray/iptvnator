import { randomUUID } from 'node:crypto';
import type {
    RecordingActionResult,
    RecordingItem,
    RecordingSupport,
    ScheduleRecordingRequest,
    ScheduleRecordingResult,
} from '@iptvnator/shared/interfaces';
import { DesktopRecordingEngine, RecordingEngine } from './recording-engine';
import {
    RecordingRepository,
    WorkerRecordingRepository,
} from './recording-repository';
import {
    RecordingSchedulerClock,
    systemRecordingSchedulerClock,
} from './recording-scheduler-clock';
import { RecordingSchedulerRuntime } from './recording-scheduler.runtime';
import {
    normalizeScheduleRecordingRequest,
    playlistUnavailableResult,
    recordingScheduleKey,
    toPublicRecordingItem,
    validateScheduleRecordingRequest,
} from './recording-scheduler.utils';
import { broadcastRecordingUpdate } from './recording-update-notifier';
import { RecordingSchedulingGate } from './recording-scheduling-gate';
import { cancelRecording } from './recording-scheduler-cancel';

export class RecordingSchedulerService {
    private readonly runtime: RecordingSchedulerRuntime;
    private readonly schedulingGate: RecordingSchedulingGate;
    private shuttingDown = false;
    private initialization: Promise<void> | null = null;

    constructor(
        private readonly repository: RecordingRepository = new WorkerRecordingRepository(),
        private readonly engine: RecordingEngine = new DesktopRecordingEngine(),
        private readonly clock: RecordingSchedulerClock = systemRecordingSchedulerClock,
        private readonly notify: () => void = broadcastRecordingUpdate
    ) {
        this.runtime = new RecordingSchedulerRuntime(
            repository,
            engine,
            clock,
            notify,
            () => this.shuttingDown
        );
        this.schedulingGate = new RecordingSchedulingGate((key, action) =>
            this.runtime.runExclusive(key, action)
        );
    }

    initialize(): Promise<void> {
        if (!this.initialization) {
            const attempt = this.runtime.recoverPersistedRecordings();
            this.initialization = attempt;
            void attempt.catch(() => {
                if (this.initialization === attempt) {
                    this.initialization = null;
                }
            });
        }
        return this.initialization;
    }

    async list(): Promise<RecordingItem[]> {
        await this.initialize();
        return (await this.repository.list()).map(toPublicRecordingItem);
    }

    async getAvailableFilePath(recordingId: string): Promise<string | null> {
        await this.initialize();
        const recording = await this.repository.get(recordingId);
        return recording?.filePath ?? null;
    }

    getSupport(): RecordingSupport {
        return this.engine.getSupport();
    }
    async schedule(
        request: ScheduleRecordingRequest
    ): Promise<ScheduleRecordingResult> {
        if (this.shuttingDown) {
            return {
                success: false,
                error: 'The application is shutting down',
            };
        }
        await this.initialize();
        const validationError = validateScheduleRecordingRequest(
            request,
            this.clock.now().getTime()
        );
        if (validationError) {
            return { success: false, error: validationError };
        }
        const normalizedRequest = normalizeScheduleRecordingRequest(request);
        const { playlistId, channelId, scheduledStartAt, scheduledEndAt } =
            normalizedRequest;
        if (this.schedulingGate.isBlocked(playlistId)) {
            return playlistUnavailableResult();
        }
        const support =
            this.engine.getSupportFor?.(normalizedRequest) ??
            this.engine.getSupport();
        if (!support.supported) {
            return {
                success: false,
                error: support.reason || 'Recordings are not available',
            };
        }

        const scheduleKey = recordingScheduleKey(normalizedRequest);

        return this.schedulingGate.runForPlaylist(playlistId, () =>
            this.runtime.runExclusive(scheduleKey, async () => {
                if (this.schedulingGate.isBlocked(playlistId)) {
                    return playlistUnavailableResult();
                }
                const duplicate = (
                    await this.repository.list(['scheduled', 'recording'])
                ).find(
                    (recording) =>
                        recording.playlistId === playlistId &&
                        recording.channelId === channelId &&
                        recording.scheduledStartAt === scheduledStartAt &&
                        recording.scheduledEndAt === scheduledEndAt
                );
                if (duplicate) {
                    return {
                        success: true,
                        recording: toPublicRecordingItem(duplicate),
                    };
                }

                const recording = await this.repository.create(
                    randomUUID(),
                    normalizedRequest
                );
                await this.runtime.armRecording(recording);
                this.notify();
                const updated =
                    (await this.repository.get(recording.id)) ?? recording;
                if (updated.status === 'failed') {
                    return {
                        success: false,
                        error:
                            updated.errorMessage || 'Recording could not start',
                        recording: toPublicRecordingItem(updated),
                    };
                }
                return {
                    success: true,
                    recording: toPublicRecordingItem(updated),
                };
            })
        );
    }

    async cancel(recordingId: string): Promise<RecordingActionResult> {
        await this.initialize();
        return cancelRecording(
            recordingId,
            this.repository,
            this.engine,
            this.runtime,
            this.clock,
            this.notify
        );
    }

    async cancelForPlaylist(playlistId: string): Promise<void> {
        await this.initialize();
        await this.schedulingGate.blockPlaylistAndRun(playlistId, async () => {
            const active = (
                await this.repository.list(['scheduled', 'recording'])
            ).filter((recording) => recording.playlistId === playlistId);
            for (const recording of active) {
                const result = await this.cancel(recording.id);
                if (!result.success) {
                    throw new Error(
                        result.error || 'Failed to cancel playlist recording'
                    );
                }
            }
        });
    }

    restorePlaylistScheduling(playlistId: string): void {
        this.schedulingGate.restorePlaylist(playlistId);
    }

    async cancelAllActive(): Promise<void> {
        await this.initialize();
        await this.schedulingGate.blockAllAndRun(async () => {
            const active = await this.repository.list([
                'scheduled',
                'recording',
            ]);
            for (const recording of active) {
                const result = await this.cancel(recording.id);
                if (!result.success) {
                    throw new Error(
                        result.error || 'Failed to cancel active recording'
                    );
                }
            }
        });
    }

    resumeSchedulingAfterDeleteAll(): void {
        this.schedulingGate.resumeAll();
    }

    async remove(recordingId: string): Promise<RecordingActionResult> {
        await this.initialize();
        return this.runtime.runExclusive(recordingId, async () => {
            const recording = await this.repository.get(recordingId);
            if (!recording) {
                return { success: false, error: 'Recording not found' };
            }
            if (['scheduled', 'recording'].includes(recording.status)) {
                return {
                    success: false,
                    error: 'Cancel an active recording before removing it',
                };
            }

            const result = await this.repository.delete(recordingId);
            if (result.success) {
                this.notify();
            }
            return result;
        });
    }

    async shutdown(): Promise<void> {
        this.shuttingDown = true;
        this.schedulingGate.blockAll();
        await this.initialization?.catch(() => undefined);
        await this.runtime.shutdown();
        this.initialization = null;
    }
}

export const recordingSchedulerService = new RecordingSchedulerService();
