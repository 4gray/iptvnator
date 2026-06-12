import type { DownloadItem } from 'electron';
import {
    attachDownloadItem,
    requestDownloadCancellation,
    type DownloadTask,
} from './download-task';

function createTask(): DownloadTask {
    return {
        directory: '/downloads',
        fileName: 'movie.mp4',
        id: 42,
        url: 'https://example.test/movie.mp4',
    };
}

describe('download runtime cancellation', () => {
    it('cancels the item when an earlier cancellation request reaches onStarted', () => {
        const task = createTask();
        const cancel = jest.fn();

        requestDownloadCancellation(task);
        attachDownloadItem(task, { cancel } as unknown as DownloadItem);

        expect(task.cancelRequested).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('cancels an already-started item immediately', () => {
        const cancel = jest.fn();
        const task = {
            ...createTask(),
            downloadItem: { cancel } as unknown as DownloadItem,
        };

        requestDownloadCancellation(task);

        expect(task.cancelRequested).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
    });
});
