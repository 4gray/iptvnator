const mockHandle = jest.fn();
const mockOpenPath = jest.fn();
const mockShowItemInFolder = jest.fn();
const mockExistsSync = jest.fn();
const mockScheduler = {
    list: jest.fn(),
    getSupport: jest.fn(),
    schedule: jest.fn(),
    cancel: jest.fn(),
    remove: jest.fn(),
    getAvailableFilePath: jest.fn(),
};

jest.mock('electron', () => ({
    ipcMain: { handle: mockHandle },
    shell: {
        openPath: mockOpenPath,
        showItemInFolder: mockShowItemInFolder,
    },
}));
jest.mock('node:fs', () => ({ existsSync: mockExistsSync }));
jest.mock('../../services/recording-scheduler.service', () => ({
    recordingSchedulerService: mockScheduler,
}));

import {
    RECORDINGS_GET_LIST,
    RECORDINGS_PLAY_FILE,
    RECORDINGS_REVEAL_FILE,
} from '@iptvnator/shared/interfaces';
import './recordings.events';

function handlerFor(channel: string): (...args: unknown[]) => Promise<unknown> {
    const registration = mockHandle.mock.calls.find(
        ([registeredChannel]) => registeredChannel === channel
    );
    if (!registration) throw new Error(`Missing handler for ${channel}`);
    return registration[1];
}

describe('recordings semantic IPC handlers', () => {
    beforeEach(() => {
        mockOpenPath.mockReset();
        mockShowItemInFolder.mockReset();
        mockExistsSync.mockReset();
        Object.values(mockScheduler).forEach((mock) => mock.mockReset());
    });

    it('returns only the scheduler public list contract', async () => {
        const items = [{ id: 'recording-1', fileAvailable: true }];
        mockScheduler.list.mockResolvedValue(items);

        await expect(handlerFor(RECORDINGS_GET_LIST)({})).resolves.toBe(items);
    });

    it('does not open a missing recording file', async () => {
        mockScheduler.getAvailableFilePath.mockResolvedValue(
            '/missing/file.ts'
        );
        mockExistsSync.mockReturnValue(false);

        await expect(
            handlerFor(RECORDINGS_PLAY_FILE)({}, 'recording-1')
        ).resolves.toEqual({
            success: false,
            error: 'Recording file not found',
        });
        expect(mockOpenPath).not.toHaveBeenCalled();
    });

    it('returns native open errors without exposing the file path', async () => {
        mockScheduler.getAvailableFilePath.mockResolvedValue(
            '/private/file.ts'
        );
        mockExistsSync.mockReturnValue(true);
        mockOpenPath.mockResolvedValue('No application can open this file');

        await expect(
            handlerFor(RECORDINGS_PLAY_FILE)({}, 'recording-1')
        ).resolves.toEqual({
            success: false,
            error: 'No application can open this file',
        });
    });

    it('reveals existing files by recording id', async () => {
        mockScheduler.getAvailableFilePath.mockResolvedValue(
            '/private/file.ts'
        );
        mockExistsSync.mockReturnValue(true);

        await expect(
            handlerFor(RECORDINGS_REVEAL_FILE)({}, 'recording-1')
        ).resolves.toEqual({ success: true });
        expect(mockShowItemInFolder).toHaveBeenCalledWith('/private/file.ts');
    });
});
