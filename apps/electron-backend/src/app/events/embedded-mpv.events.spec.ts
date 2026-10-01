jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

const mockEmbeddedMpvService = {
    createSession: jest.fn(),
    getSupport: jest.fn(),
    setPaused: jest.fn(),
};
const mockSessionOptions = {
    extraOptions: ['network-timeout=10', 'hwdec=no'],
    autoReconnect: false,
};

jest.mock('../services/embedded-mpv-native.service', () => ({
    EmbeddedMpvNativeService: class {},
    embeddedMpvNativeService: mockEmbeddedMpvService,
}));
jest.mock('../services/embedded-mpv-session-options', () => ({
    readEmbeddedMpvSessionOptions: () => mockSessionOptions,
}));
const mockWaitForLoginShellPath = jest.fn(() => Promise.resolve());
jest.mock('../startup/login-shell-path', () => ({
    waitForLoginShellPath: () => mockWaitForLoginShellPath(),
}));

import { ipcMain } from 'electron';
import {
    EMBEDDED_MPV_CREATE_SESSION,
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
        mockEmbeddedMpvService.createSession.mockReset();
        mockEmbeddedMpvService.getSupport.mockReset();
        mockEmbeddedMpvService.setPaused.mockReset();
    });

    describe('support checks and the login shell PATH', () => {
        const originalPlatform = process.platform;

        afterEach(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
            mockWaitForLoginShellPath.mockClear();
        });

        it('on Linux, checks support only after the lookup settled', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            let settle: () => void = () => undefined;
            mockWaitForLoginShellPath.mockReturnValueOnce(
                new Promise<void>((resolve) => {
                    settle = resolve;
                })
            );
            mockEmbeddedMpvService.getSupport.mockReturnValue({
                supported: true,
            });

            const support = getIpcMainHandler(EMBEDDED_MPV_SUPPORT)({});
            await new Promise<void>((resolve) => setImmediate(resolve));
            // Linux caches the result of a bare-name `mpv --version`.
            expect(mockEmbeddedMpvService.getSupport).not.toHaveBeenCalled();

            settle();
            await expect(support).resolves.toEqual({ supported: true });
        });

        it('elsewhere, and for session calls, never waits', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockEmbeddedMpvService.getSupport.mockReturnValue({
                supported: true,
            });
            mockEmbeddedMpvService.createSession.mockReturnValue({ id: 's' });

            await getIpcMainHandler(EMBEDDED_MPV_SUPPORT)({});
            Object.defineProperty(process, 'platform', { value: 'linux' });
            await getIpcMainHandler(EMBEDDED_MPV_CREATE_SESSION)(
                {},
                { x: 0, y: 0, width: 1, height: 1 }
            );

            expect(mockWaitForLoginShellPath).not.toHaveBeenCalled();
        });
    });

    it('creates a session with the options read from the settings mirror', async () => {
        const session = { id: 'session-1', status: 'idle' };
        mockEmbeddedMpvService.createSession.mockReturnValue(session);
        const bounds = { x: 0, y: 0, width: 640, height: 360 };

        const handler = getIpcMainHandler(EMBEDDED_MPV_CREATE_SESSION);

        await expect(handler({}, bounds, 'Title', 0.5)).resolves.toEqual(
            session
        );
        expect(mockEmbeddedMpvService.createSession).toHaveBeenCalledWith(
            bounds,
            'Title',
            0.5,
            mockSessionOptions
        );
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
