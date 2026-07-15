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

describe('RecordingSchedulerService actions', () => {
    let repository: MemoryRecordingRepository;
    let engine: jest.Mocked<RecordingEngine>;
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

    it('sanitizes playback secrets and local paths from renderer results', async () => {
        const persisted = item('recording-private', 'completed', {
            streamUrl: 'https://example.com/private-token',
            requestHeaders: { Authorization: 'secret' },
            recordingDirectory: '/private/recordings',
            filePath: '/private/recordings/news.ts',
        });
        repository.records.set(persisted.id, persisted);

        const [publicItem] = await scheduler.list();

        expect(publicItem).toEqual(
            expect.objectContaining({
                id: persisted.id,
                fileAvailable: false,
            })
        );
        expect(publicItem).not.toHaveProperty('streamUrl');
        expect(publicItem).not.toHaveProperty('requestHeaders');
        expect(publicItem).not.toHaveProperty('recordingDirectory');
        expect(publicItem).not.toHaveProperty('filePath');
    });

    it('deduplicates concurrent requests for the same recording window', async () => {
        const [first, second] = await Promise.all([
            scheduler.schedule(request()),
            scheduler.schedule(request()),
        ]);

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(first.recording?.id).toBe(second.recording?.id);
        expect(repository.records.size).toBe(1);
    });

    it('marks a schedule failed if persisting cancellation fails once', async () => {
        const scheduled = await scheduler.schedule(request());
        const recordingId = scheduled.recording?.id as string;
        const originalUpdate = repository.update.bind(repository);
        let cancellationWriteFailed = false;
        jest.spyOn(repository, 'update').mockImplementation(
            async (id, update) => {
                if (update.status === 'canceled' && !cancellationWriteFailed) {
                    cancellationWriteFailed = true;
                    throw new Error('Cancellation write failed');
                }
                return originalUpdate(id, update);
            }
        );

        await expect(scheduler.cancel(recordingId)).resolves.toEqual({
            success: false,
            error: 'Cancellation write failed',
        });
        expect(repository.records.get(recordingId)).toEqual(
            expect.objectContaining({ status: 'failed', streamUrl: null })
        );
        await jest.advanceTimersByTimeAsync(120_000);
        expect(engine.start).not.toHaveBeenCalled();
    });

    it('blocks new schedules while their playlist is being deleted', async () => {
        await scheduler.cancelForPlaylist('playlist-1');

        await expect(scheduler.schedule(request())).resolves.toEqual({
            success: false,
            error: 'The playlist is being deleted or is no longer available',
        });

        scheduler.restorePlaylistScheduling('playlist-1');
        await expect(scheduler.schedule(request())).resolves.toEqual(
            expect.objectContaining({ success: true })
        );
    });

    it('lets playlist deletion observe and cancel an in-flight schedule', async () => {
        const originalList = repository.list.bind(repository);
        let releaseScheduleList!: () => void;
        let scheduleListStarted!: () => void;
        const scheduleListReady = new Promise<void>((resolve) => {
            scheduleListStarted = resolve;
        });
        const scheduleListBlocked = new Promise<void>((resolve) => {
            releaseScheduleList = resolve;
        });
        let pauseFirstList = true;
        jest.spyOn(repository, 'list').mockImplementation(async (statuses) => {
            if (pauseFirstList) {
                pauseFirstList = false;
                scheduleListStarted();
                await scheduleListBlocked;
            }
            return originalList(statuses);
        });

        const scheduling = scheduler.schedule(request());
        await scheduleListReady;
        const deleting = scheduler.cancelForPlaylist('playlist-1');
        releaseScheduleList();

        const scheduled = await scheduling;
        await deleting;
        expect(scheduled.success).toBe(true);
        expect(
            repository.records.get(scheduled.recording?.id as string)
        ).toEqual(expect.objectContaining({ status: 'canceled' }));
        expect(repository.records.size).toBe(1);
    });

    it('preserves engine metadata if persisting active cancellation fails', async () => {
        await scheduler.initialize();
        const active = item('recording-cancel-write-failure', 'recording');
        repository.records.set(active.id, active);
        const originalUpdate = repository.update.bind(repository);
        jest.spyOn(repository, 'update').mockImplementation(
            async (id, update) => {
                if (update.status === 'canceled') {
                    throw new Error('Cancellation write failed');
                }
                return originalUpdate(id, update);
            }
        );

        await expect(scheduler.cancel(active.id)).resolves.toEqual({
            success: false,
            error: 'Cancellation write failed',
        });
        expect(repository.records.get(active.id)).toEqual(
            expect.objectContaining({
                status: 'failed',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
            })
        );
    });

    it('keeps a recording active when its engine process is still running', async () => {
        await scheduler.initialize();
        const active = item('recording-stop-failure', 'recording');
        repository.records.set(active.id, active);
        engine.stop.mockRejectedValueOnce(new Error('VLC did not exit'));
        engine.hasActiveSession = jest.fn().mockReturnValue(true);

        await expect(scheduler.cancel(active.id)).resolves.toEqual({
            success: false,
            error: 'VLC did not exit',
        });
        expect(repository.records.get(active.id)).toEqual(
            expect.objectContaining({
                status: 'recording',
                streamUrl: active.streamUrl,
            })
        );
    });

    it('blocks schedules and waits for the engine during shutdown', async () => {
        let finishEngineShutdown: (() => void) | undefined;
        engine.shutdown.mockReturnValue(
            new Promise<void>((resolve) => {
                finishEngineShutdown = resolve;
            })
        );

        const shutdown = scheduler.shutdown();
        await expect(scheduler.schedule(request())).resolves.toEqual({
            success: false,
            error: 'The application is shutting down',
        });

        finishEngineShutdown?.();
        await shutdown;
        expect(engine.shutdown).toHaveBeenCalled();
    });

    it('finalizes active metadata and clears secrets during shutdown', async () => {
        const active = item('recording-on-quit', 'recording', {
            requestHeaders: { Authorization: 'Bearer secret' },
            recordingDirectory: '/recordings',
        });
        repository.records.set(active.id, active);

        await scheduler.shutdown();

        expect(engine.stop).toHaveBeenCalledWith(active.id);
        expect(repository.records.get(active.id)).toEqual(
            expect.objectContaining({
                status: 'interrupted',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
                streamUrl: null,
                requestHeaders: null,
                recordingDirectory: null,
            })
        );
    });

    it('preserves final metadata when the interrupted shutdown write fails', async () => {
        const active = item('recording-shutdown-write-failure', 'recording', {
            requestHeaders: { Authorization: 'Bearer secret' },
            recordingDirectory: '/recordings',
        });
        repository.records.set(active.id, active);
        const originalUpdate = repository.update.bind(repository);
        jest.spyOn(repository, 'update').mockImplementation(
            async (id, update) => {
                if (update.status === 'interrupted') {
                    throw new Error('Interrupted write failed');
                }
                return originalUpdate(id, update);
            }
        );

        await scheduler.shutdown();

        expect(repository.records.get(active.id)).toEqual(
            expect.objectContaining({
                status: 'failed',
                filePath: '/recordings/evening-news.ts',
                bytesRecorded: 4096,
                streamUrl: null,
                requestHeaders: null,
                recordingDirectory: null,
            })
        );
    });
});
