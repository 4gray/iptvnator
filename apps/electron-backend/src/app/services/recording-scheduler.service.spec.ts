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

describe('RecordingSchedulerService', () => {
    let repository: MemoryRecordingRepository;
    let engine: jest.Mocked<RecordingEngine>;
    let notify: jest.Mock;
    let scheduler: RecordingSchedulerService;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        repository = new MemoryRecordingRepository();
        engine = {
            getSupport: jest.fn().mockReturnValue({ supported: true }),
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
        notify = jest.fn();
        scheduler = new RecordingSchedulerService(
            repository,
            engine,
            {
                now: () => new Date(),
                setTimeout: (callback, delayMs) =>
                    setTimeout(callback, delayMs),
                clearTimeout: (handle) => clearTimeout(handle),
            },
            notify
        );
    });

    afterEach(async () => {
        await scheduler.shutdown();
        jest.useRealTimers();
    });

    it('persists, starts, and completes a future recording', async () => {
        const result = await scheduler.schedule(request());
        const recordingId = result.recording?.id;

        expect(result.success).toBe(true);
        expect(recordingId).toBeDefined();
        expect(repository.records.get(recordingId as string)?.status).toBe(
            'scheduled'
        );

        await jest.advanceTimersByTimeAsync(60_000);

        expect(engine.start).toHaveBeenCalledWith(
            expect.objectContaining({ id: recordingId, status: 'scheduled' })
        );
        expect(repository.records.get(recordingId as string)).toEqual(
            expect.objectContaining({
                status: 'recording',
                filePath: '/recordings/evening-news.ts',
            })
        );

        await jest.advanceTimersByTimeAsync(60_000);

        expect(engine.stop).toHaveBeenCalledWith(recordingId);
        expect(repository.records.get(recordingId as string)).toEqual(
            expect.objectContaining({
                status: 'completed',
                bytesRecorded: 4096,
                completedAt: '2026-07-14T12:02:00.000Z',
            })
        );
        expect(notify).toHaveBeenCalled();
    });

    it('preserves final engine metadata if completion persistence fails', async () => {
        const originalUpdate = repository.update.bind(repository);
        jest.spyOn(repository, 'update').mockImplementation(
            async (id, update) => {
                if (update.status === 'completed') {
                    throw new Error('Completion write failed');
                }
                return originalUpdate(id, update);
            }
        );
        const result = await scheduler.schedule(request());
        const recordingId = result.recording?.id as string;

        await jest.advanceTimersByTimeAsync(120_000);

        expect(repository.records.get(recordingId)).toEqual(
            expect.objectContaining({
                status: 'failed',
                errorMessage: 'Completion write failed',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
            })
        );
    });

    it('reports an immediate engine-start failure instead of a false success', async () => {
        engine.start.mockRejectedValue(new Error('Engine start failed'));

        const result = await scheduler.schedule(
            request({
                scheduledStartAt: '2026-07-14T11:59:00.000Z',
                scheduledEndAt: '2026-07-14T12:05:00.000Z',
            })
        );

        expect(result).toEqual(
            expect.objectContaining({
                success: false,
                error: 'Engine start failed',
                recording: expect.objectContaining({ status: 'failed' }),
            })
        );
    });

    it('cancels a scheduled recording without starting the engine', async () => {
        const result = await scheduler.schedule(request());
        const recordingId = result.recording?.id as string;

        await expect(scheduler.cancel(recordingId)).resolves.toEqual({
            success: true,
        });

        expect(repository.records.get(recordingId)?.status).toBe('canceled');
        expect(engine.stop).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(120_000);
        expect(engine.start).not.toHaveBeenCalled();
    });

    it('rejects invalid recording windows before writing to the repository', async () => {
        const result = await scheduler.schedule(
            request({
                scheduledStartAt: '2026-07-14T13:00:00.000Z',
                scheduledEndAt: '2026-07-14T12:30:00.000Z',
            })
        );

        expect(result).toEqual({
            success: false,
            error: 'Recording end time must be after its start time',
        });
        expect(repository.records.size).toBe(0);
    });

    it('rejects invalid source types before writing to the repository', async () => {
        const result = await scheduler.schedule(
            request({ sourceType: 'invalid' as never })
        );

        expect(result).toEqual({
            success: false,
            error: 'Recording source type is not supported',
        });
        expect(repository.records.size).toBe(0);
    });

    it('rejects scheduling when native recording support is unavailable', async () => {
        engine.getSupport.mockReturnValue({
            supported: false,
            reason: 'Native recording is unavailable',
        });

        await expect(scheduler.schedule(request())).resolves.toEqual({
            success: false,
            error: 'Native recording is unavailable',
        });
        expect(repository.records.size).toBe(0);
    });

    it('rejects a request that the available engine cannot record', async () => {
        engine.getSupportFor = jest.fn().mockReturnValue({
            supported: false,
            reason: 'VLC cannot forward Authorization',
        });

        await expect(scheduler.schedule(request())).resolves.toEqual({
            success: false,
            error: 'VLC cannot forward Authorization',
        });
        expect(repository.records.size).toBe(0);
    });

    it('serializes cancellation behind an in-flight recording start', async () => {
        const pending = item('recording-race', 'scheduled', {
            scheduledStartAt: '2026-07-14T11:59:00.000Z',
            scheduledEndAt: '2026-07-14T12:05:00.000Z',
        });
        repository.records.set(pending.id, pending);
        let resolveStart:
            | ((value: {
                  fileName: string;
                  filePath: string;
                  bytesRecorded: null;
              }) => void)
            | undefined;
        engine.start.mockReturnValue(
            new Promise((resolve) => {
                resolveStart = resolve;
            })
        );

        const initializing = scheduler.initialize();
        for (
            let attempt = 0;
            attempt < 10 && !engine.start.mock.calls.length;
            attempt++
        ) {
            await Promise.resolve();
        }
        expect(engine.start).toHaveBeenCalled();

        const canceling = scheduler.cancel(pending.id);
        resolveStart?.({
            fileName: 'race.ts',
            filePath: '/recordings/race.ts',
            bytesRecorded: null,
        });
        await initializing;
        await expect(canceling).resolves.toEqual({ success: true });

        expect(engine.stop).toHaveBeenCalledWith(pending.id);
        expect(repository.records.get(pending.id)).toEqual(
            expect.objectContaining({
                status: 'canceled',
                streamUrl: null,
            })
        );
    });

    it('stops the engine if persistence fails after recording has started', async () => {
        const pending = item('recording-persist-failure', 'scheduled', {
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

        await scheduler.initialize();

        expect(engine.stop).toHaveBeenCalledWith(pending.id);
        expect(repository.records.get(pending.id)).toEqual(
            expect.objectContaining({
                status: 'failed',
                errorMessage: 'Database write failed',
                streamUrl: null,
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
            })
        );
    });
});
