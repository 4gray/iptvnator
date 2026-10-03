jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

const mockEmbeddedMpvService = {
    createSession: jest.fn(),
    prepareAddon: jest.fn(),
    getSupport: jest.fn(),
    willProbeLinuxMpvExecutable: jest.fn(() => false),
    forgetMissingLinuxMpvExecutable: jest.fn(),
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
const mockWaitForLoginShellPath = jest.fn(() => Promise.resolve(true));
let settleLookup: () => void = () => undefined;
const mockLookupSettled = new Promise<void>((resolve) => {
    settleLookup = resolve;
});
jest.mock('../startup/login-shell-path', () => ({
    waitForLoginShellPath: () => mockWaitForLoginShellPath(),
    whenLoginShellPathSettled: () => mockLookupSettled,
}));

import { ipcMain } from 'electron';
import {
    EMBEDDED_MPV_CREATE_SESSION,
    EMBEDDED_MPV_PREPARE,
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
        afterEach(() => {
            mockWaitForLoginShellPath.mockClear();
            mockEmbeddedMpvService.willProbeLinuxMpvExecutable.mockReset();
            mockEmbeddedMpvService.willProbeLinuxMpvExecutable.mockReturnValue(
                false
            );
        });

        it.each([EMBEDDED_MPV_SUPPORT, EMBEDDED_MPV_PREPARE])(
            '%s waits for the lookup before the bare-name mpv probe',
            async (channel) => {
                mockEmbeddedMpvService.willProbeLinuxMpvExecutable.mockReturnValue(
                    true
                );
                let settle: (settled: boolean) => void = () => undefined;
                mockWaitForLoginShellPath.mockReturnValueOnce(
                    new Promise<boolean>((resolve) => {
                        settle = resolve;
                    })
                );
                mockEmbeddedMpvService.getSupport.mockReturnValue({
                    supported: true,
                });
                mockEmbeddedMpvService.prepareAddon.mockReturnValue({
                    supported: true,
                });

                const support = getIpcMainHandler(channel)({});
                await new Promise<void>((resolve) => setImmediate(resolve));
                expect(
                    mockEmbeddedMpvService.getSupport
                ).not.toHaveBeenCalled();
                expect(
                    mockEmbeddedMpvService.prepareAddon
                ).not.toHaveBeenCalled();

                settle(true);
                await expect(support).resolves.toEqual({ supported: true });
                expect(
                    mockEmbeddedMpvService.forgetMissingLinuxMpvExecutable
                ).not.toHaveBeenCalled();
            }
        );

        it('re-probes a missing mpv once a lookup that ran out finally answers', async () => {
            mockEmbeddedMpvService.willProbeLinuxMpvExecutable.mockReturnValue(
                true
            );
            mockWaitForLoginShellPath.mockResolvedValueOnce(false);
            mockEmbeddedMpvService.getSupport.mockReturnValue({
                supported: false,
            });

            await expect(
                getIpcMainHandler(EMBEDDED_MPV_SUPPORT)({})
            ).resolves.toEqual({ supported: false });
            expect(
                mockEmbeddedMpvService.forgetMissingLinuxMpvExecutable
            ).not.toHaveBeenCalled();

            settleLookup();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(
                mockEmbeddedMpvService.forgetMissingLinuxMpvExecutable
            ).toHaveBeenCalledTimes(1);
        });

        it('does not wait when no probe runs, nor for session calls', async () => {
            mockEmbeddedMpvService.getSupport.mockReturnValue({
                supported: true,
                engine: 'frame-copy',
            });
            mockEmbeddedMpvService.createSession.mockReturnValue({ id: 's' });

            await getIpcMainHandler(EMBEDDED_MPV_SUPPORT)({});
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
