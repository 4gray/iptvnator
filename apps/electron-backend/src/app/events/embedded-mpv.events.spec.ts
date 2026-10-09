jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

const mockMainWindow = { webContents: {} };
jest.mock('../app', () => ({
    __esModule: true,
    default: { mainWindow: mockMainWindow },
}));

const mockEmbeddedMpvService = {
    createSession: jest.fn(),
    prepareAddon: jest.fn(),
    getSupport: jest.fn(),
    willProbeLinuxMpvExecutable: jest.fn(() => false),
    forgetLinuxMpvExecutableProbe: jest.fn(),
    markLinuxMpvExecutableProbeProvisional: jest.fn(),
    setPaused: jest.fn(),
    openFloatingPlayer: jest.fn(),
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
let mockLookupSettled = Promise.resolve();
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
): (...args: unknown[]) => unknown {
    const handleMock = ipcMain.handle as unknown as jest.Mock;
    const calls = handleMock.mock.calls as Array<
        [string, (...args: unknown[]) => unknown]
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
        mockEmbeddedMpvService.openFloatingPlayer.mockReset();
    });

    describe('support checks and the login shell PATH', () => {
        beforeEach(() => {
            // A lookup of its own per test: the pending re-probe of one test
            // must not answer for the next.
            mockLookupSettled = new Promise<void>((resolve) => {
                settleLookup = resolve;
            });
            mockEmbeddedMpvService.forgetLinuxMpvExecutableProbe.mockClear();
            mockEmbeddedMpvService.markLinuxMpvExecutableProbeProvisional.mockClear();
        });

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
                    mockEmbeddedMpvService.forgetLinuxMpvExecutableProbe
                ).not.toHaveBeenCalled();
                // The probe saw the login shell PATH: its answer is final.
                expect(
                    mockEmbeddedMpvService.markLinuxMpvExecutableProbeProvisional
                ).not.toHaveBeenCalled();
            }
        );

        it('re-probes mpv once a lookup that ran out finally answers', async () => {
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
            // The service is told before it probes, so the answer of this
            // very check is already marked as not final.
            const { markLinuxMpvExecutableProbeProvisional, getSupport } =
                mockEmbeddedMpvService;
            expect(
                markLinuxMpvExecutableProbeProvisional
            ).toHaveBeenCalledTimes(1);
            expect(
                markLinuxMpvExecutableProbeProvisional.mock
                    .invocationCallOrder[0]
            ).toBeLessThan(getSupport.mock.invocationCallOrder[0]);
            expect(
                mockEmbeddedMpvService.forgetLinuxMpvExecutableProbe
            ).not.toHaveBeenCalled();

            settleLookup();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(
                mockEmbeddedMpvService.forgetLinuxMpvExecutableProbe
            ).toHaveBeenCalledTimes(1);
        });

        it('still re-probes when the check on the inherited PATH throws', async () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            mockEmbeddedMpvService.willProbeLinuxMpvExecutable.mockReturnValue(
                true
            );
            mockWaitForLoginShellPath.mockResolvedValueOnce(false);
            mockEmbeddedMpvService.getSupport.mockImplementation(() => {
                throw new Error('probe failed');
            });

            try {
                await expect(
                    getIpcMainHandler(EMBEDDED_MPV_SUPPORT)({})
                ).rejects.toThrow('probe failed');
                // Otherwise the provisional state would outlive the lookup.
                settleLookup();
                await new Promise<void>((resolve) => setImmediate(resolve));
                expect(
                    mockEmbeddedMpvService.forgetLinuxMpvExecutableProbe
                ).toHaveBeenCalledTimes(1);
            } finally {
                consoleErrorSpy.mockRestore();
            }
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

    it('opens the floating session only from the main application renderer', () => {
        mockEmbeddedMpvService.openFloatingPlayer.mockReturnValue(true);
        expect(
            getIpcMainHandler('EMBEDDED_MPV_FLOATING_OPEN')(
                { sender: mockMainWindow.webContents },
                'session-1'
            )
        ).toBe(true);
        expect(mockEmbeddedMpvService.openFloatingPlayer).toHaveBeenCalledWith(
            'session-1'
        );
    });

    it.each([
        [{ sender: {} }, 'session-1'],
        [{ sender: mockMainWindow.webContents }, null],
        [{ sender: mockMainWindow.webContents }, 42],
    ])(
        'rejects an unrelated renderer or malformed floating request',
        (event, sessionId) => {
            expect(
                getIpcMainHandler('EMBEDDED_MPV_FLOATING_OPEN')(
                    event,
                    sessionId
                )
            ).toBe(false);
            expect(
                mockEmbeddedMpvService.openFloatingPlayer
            ).not.toHaveBeenCalled();
        }
    );

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
