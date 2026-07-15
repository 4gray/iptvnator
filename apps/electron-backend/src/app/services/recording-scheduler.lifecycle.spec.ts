import type { RecordingEngine } from './recording-engine';
import { RecordingSchedulerService } from './recording-scheduler.service';
import {
    MemoryRecordingRepository,
    RECORDING_TEST_NOW as NOW,
    recordingTestItem as item,
    recordingTestRequest as request,
} from './recording-scheduler.test-helpers';

jest.mock('../app', () => ({
    __esModule: true,
    default: { mainWindow: null },
}));
jest.mock('./store.service', () => ({
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    store: { get: jest.fn().mockReturnValue('') },
}));

describe('RecordingSchedulerService lifecycle recovery', () => {
    let repository: MemoryRecordingRepository;
    let engine: jest.Mocked<RecordingEngine>;
    let scheduler: RecordingSchedulerService;
    let reportEngineFailure:
        | ((recordingId: string, error: Error) => void)
        | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        repository = new MemoryRecordingRepository();
        engine = {
            getSupport: jest.fn().mockReturnValue({ supported: true }),
            setFailureHandler: jest.fn((handler) => {
                reportEngineFailure = handler;
            }),
            start: jest.fn().mockResolvedValue({
                fileName: 'evening-news.ts',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: null,
            }),
            stop: jest.fn().mockResolvedValue({
                fileName: 'evening-news.ts',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
            }),
            shutdown: jest.fn(),
        };
        scheduler = new RecordingSchedulerService(repository, engine, {
            now: () => new Date(),
            setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
            clearTimeout: (handle) => clearTimeout(handle),
        });
    });

    afterEach(async () => {
        await scheduler.shutdown();
        jest.useRealTimers();
    });

    it('marks a recording failed when its engine exits unexpectedly', async () => {
        const result = await scheduler.schedule(
            request({
                scheduledStartAt: '2026-07-14T11:59:00.000Z',
                scheduledEndAt: '2026-07-14T12:05:00.000Z',
            })
        );
        const recordingId = result.recording?.id as string;

        reportEngineFailure?.(recordingId, new Error('Engine exited early'));
        for (
            let attempt = 0;
            attempt < 20 &&
            repository.records.get(recordingId)?.status !== 'failed';
            attempt++
        ) {
            await Promise.resolve();
        }

        expect(engine.stop).toHaveBeenCalledWith(recordingId);
        expect(repository.records.get(recordingId)).toEqual(
            expect.objectContaining({
                status: 'failed',
                errorMessage: 'Engine exited early',
                bytesRecorded: 4096,
            })
        );
    });

    it('retries automatic stop while the recording engine remains active', async () => {
        engine.stop.mockRejectedValueOnce(new Error('VLC did not exit'));
        engine.hasActiveSession = jest.fn().mockReturnValue(true);
        const result = await scheduler.schedule(request());
        const recordingId = result.recording?.id as string;

        await jest.advanceTimersByTimeAsync(120_000);
        expect(repository.records.get(recordingId)?.status).toBe('recording');

        await jest.advanceTimersByTimeAsync(1_000);
        expect(engine.stop).toHaveBeenCalledTimes(2);
        expect(repository.records.get(recordingId)).toEqual(
            expect.objectContaining({
                status: 'completed',
                bytesRecorded: 4096,
            })
        );
    });

    it('retries stop after start metadata persistence fails', async () => {
        const pending = item('recording-persist-stop-retry', 'scheduled', {
            scheduledStartAt: '2026-07-14T11:59:00.000Z',
            scheduledEndAt: '2026-07-14T12:05:00.000Z',
        });
        repository.records.set(pending.id, pending);
        const originalUpdate = repository.update.bind(repository);
        jest.spyOn(repository, 'update').mockImplementation(
            async (id, update) => {
                if (update.filePath && !update.status) {
                    throw new Error('Database write failed');
                }
                return originalUpdate(id, update);
            }
        );
        engine.stop.mockRejectedValueOnce(new Error('VLC did not exit'));
        engine.hasActiveSession = jest.fn().mockReturnValue(true);

        await scheduler.initialize();
        expect(repository.records.get(pending.id)?.status).toBe('recording');

        await jest.advanceTimersByTimeAsync(1_000);
        expect(engine.stop).toHaveBeenCalledTimes(2);
        expect(repository.records.get(pending.id)).toEqual(
            expect.objectContaining({
                status: 'failed',
                errorMessage: 'Database write failed',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
            })
        );
    });

    it('retries stop after an engine failure while its session remains active', async () => {
        const result = await scheduler.schedule(
            request({
                scheduledStartAt: '2026-07-14T11:59:00.000Z',
                scheduledEndAt: '2026-07-14T12:05:00.000Z',
            })
        );
        const recordingId = result.recording?.id as string;
        engine.stop.mockRejectedValueOnce(new Error('VLC did not exit'));
        engine.hasActiveSession = jest.fn().mockReturnValue(true);

        reportEngineFailure?.(recordingId, new Error('Engine exited early'));
        await jest.advanceTimersByTimeAsync(0);
        expect(repository.records.get(recordingId)?.status).toBe('recording');

        await jest.advanceTimersByTimeAsync(1_000);
        expect(engine.stop).toHaveBeenCalledTimes(2);
        expect(repository.records.get(recordingId)).toEqual(
            expect.objectContaining({
                status: 'failed',
                errorMessage: 'Engine exited early',
                bytesRecorded: 4096,
            })
        );
    });

    it('marks an active persisted recording as interrupted after restart', async () => {
        const interrupted = item('recording-1', 'recording');
        repository.records.set(interrupted.id, interrupted);

        await scheduler.initialize();

        expect(repository.records.get(interrupted.id)).toEqual(
            expect.objectContaining({
                status: 'interrupted',
                completedAt: NOW.toISOString(),
            })
        );
        expect(engine.start).not.toHaveBeenCalled();
    });

    it('continues recovery after an invalid persisted recording fails', async () => {
        const invalid = item('recording-invalid', 'scheduled', {
            scheduledStartAt: '2026-07-14T10:00:00.000Z',
            scheduledEndAt: '2026-07-14T11:00:00.000Z',
        });
        const future = item('recording-future', 'scheduled');
        repository.records.set(invalid.id, invalid);
        repository.records.set(future.id, future);
        const originalUpdate = repository.update.bind(repository);
        jest.spyOn(repository, 'update').mockImplementation((id, update) => {
            if (id === invalid.id) {
                throw new Error('Invalid row cannot be updated');
            }
            return originalUpdate(id, update);
        });

        await scheduler.initialize();
        await jest.advanceTimersByTimeAsync(60_000);

        expect(engine.start).toHaveBeenCalledWith(
            expect.objectContaining({ id: future.id })
        );
    });
});
