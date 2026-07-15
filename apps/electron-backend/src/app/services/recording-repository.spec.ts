import type { ScheduleRecordingRequest } from '@iptvnator/shared/interfaces';
import { databaseWorkerClient } from './database-worker-client';
import { WorkerRecordingRepository } from './recording-repository';

jest.mock('./database-worker-client', () => ({
    databaseWorkerClient: { request: jest.fn() },
}));

const request: ScheduleRecordingRequest = {
    playlistId: 'playlist-1',
    sourceType: 'xtream',
    channelId: '42',
    channelName: 'News',
    title: 'Evening News',
    scheduledStartAt: '2026-07-14T18:00:00.000Z',
    scheduledEndAt: '2026-07-14T19:00:00.000Z',
    playback: {
        streamUrl: 'https://example.com/live/42.m3u8',
        title: 'News',
    },
};

describe('WorkerRecordingRepository', () => {
    const workerRequest = databaseWorkerClient.request as jest.Mock;
    const databaseReady = jest.fn().mockResolvedValue(undefined);
    const repository = new WorkerRecordingRepository(databaseReady);

    beforeEach(() => {
        databaseReady.mockClear();
        workerRequest.mockReset().mockResolvedValue({});
    });

    it('creates recordings through the private worker contract', async () => {
        await repository.create('recording-1', request);
        expect(databaseReady).toHaveBeenCalled();
        expect(workerRequest).toHaveBeenCalledWith('DB_CREATE_RECORDING', {
            id: 'recording-1',
            request,
        });
    });

    it('does not start the worker before schema creation and migrations finish', async () => {
        let markDatabaseReady: (() => void) | undefined;
        const waitForDatabase = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    markDatabaseReady = resolve;
                })
        );
        const gatedRepository = new WorkerRecordingRepository(waitForDatabase);

        const listing = gatedRepository.list();
        await Promise.resolve();
        expect(workerRequest).not.toHaveBeenCalled();

        markDatabaseReady?.();
        await listing;
        expect(workerRequest).toHaveBeenCalledWith('DB_LIST_RECORDINGS', {
            statuses: undefined,
        });
    });

    it('gets recordings through the private worker contract', async () => {
        await repository.get('recording-1');
        expect(workerRequest).toHaveBeenCalledWith('DB_GET_RECORDING', {
            id: 'recording-1',
        });
    });

    it('lists recordings with an optional status filter', async () => {
        await repository.list(['scheduled', 'recording']);
        expect(workerRequest).toHaveBeenCalledWith('DB_LIST_RECORDINGS', {
            statuses: ['scheduled', 'recording'],
        });
    });

    it('updates recordings through the private worker contract', async () => {
        const update = { status: 'completed' as const };
        await repository.update('recording-1', update);
        expect(workerRequest).toHaveBeenCalledWith('DB_UPDATE_RECORDING', {
            id: 'recording-1',
            update,
        });
    });

    it('deletes recordings through the private worker contract', async () => {
        await repository.delete('recording-1');
        expect(workerRequest).toHaveBeenCalledWith('DB_DELETE_RECORDING', {
            id: 'recording-1',
        });
    });
});
