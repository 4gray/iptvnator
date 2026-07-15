jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

const mockEmbeddedMpvService = {
    assertRendererSession: jest.fn(),
    getSupport: jest.fn(),
    setPaused: jest.fn(),
};

jest.mock('../services/embedded-mpv-native.service', () => ({
    EmbeddedMpvNativeService: class {},
    embeddedMpvNativeService: mockEmbeddedMpvService,
}));

import { ipcMain } from 'electron';
import {
    EMBEDDED_MPV_SET_PAUSED,
    EMBEDDED_MPV_SUPPORT,
} from '@iptvnator/shared/interfaces';
import './embedded-mpv.events';

function getIpcMainHandler(
    channel: string
): (...args: unknown[]) => Promise<unknown> {
    const handleMock = ipcMain.handle as unknown as jest.Mock;
    const calls = handleMock.mock.calls as Array<
        [string, (...args: unknown[]) => Promise<unknown>]
    >;
    const match = calls.find(
        ([registeredChannel]) => registeredChannel === channel
    );

    if (!match) {
        throw new Error(`Missing ipcMain handler for ${channel}`);
    }

    return match[1];
}

describe('EmbeddedMpvEvents IPC handlers', () => {
    beforeEach(() => {
        mockEmbeddedMpvService.getSupport.mockReset();
        mockEmbeddedMpvService.assertRendererSession.mockReset();
        mockEmbeddedMpvService.setPaused.mockReset();
    });

    it('forwards arguments to the native service and returns its result', async () => {
        const session = { id: 'session-1', status: 'paused' };
        mockEmbeddedMpvService.setPaused.mockReturnValue(session);

        const handler = getIpcMainHandler(EMBEDDED_MPV_SET_PAUSED);

        await expect(handler({}, 'session-1', true)).resolves.toEqual(session);
        expect(mockEmbeddedMpvService.setPaused).toHaveBeenCalledWith(
            'session-1',
            true
        );
        expect(
            mockEmbeddedMpvService.assertRendererSession
        ).toHaveBeenCalledWith('session-1');
    });

    it('rejects renderer control of a main-process-owned recording session', async () => {
        mockEmbeddedMpvService.assertRendererSession.mockImplementation(() => {
            throw new Error('Session is owned by the Electron main process');
        });
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation();

        try {
            const handler = getIpcMainHandler(EMBEDDED_MPV_SET_PAUSED);
            await expect(
                handler({}, 'private-recording', true)
            ).rejects.toThrow('owned by the Electron main process');
            expect(mockEmbeddedMpvService.setPaused).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('logs in the main process and rethrows when the native service throws', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation();

        try {
            mockEmbeddedMpvService.getSupport.mockImplementation(() => {
                throw new Error('addon failed to load');
            });

            const handler = getIpcMainHandler(EMBEDDED_MPV_SUPPORT);

            await expect(handler({})).rejects.toThrow('addon failed to load');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining(EMBEDDED_MPV_SUPPORT),
                expect.any(Error)
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
