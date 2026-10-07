/**
 * The Linux native-view support check end to end in the main process: the
 * real IPC handlers, native service and login shell PATH lookup. Only the
 * process boundary is faked: the shell (`readPath`), `mpv --version`
 * (`spawnSync`) and Electron. `process.platform` is forced here, so the
 * Linux branch runs on every host.
 */
import {
    EMBEDDED_MPV_PREPARE,
    EMBEDDED_MPV_SUPPORT,
    type EmbeddedMpvSupport,
} from '@iptvnator/shared/interfaces';

const mockSpawnSync = jest.fn();
const mockIpcHandle = jest.fn();

jest.mock('child_process', () => ({ spawnSync: mockSpawnSync }));
jest.mock('electron', () => ({
    app: {
        isPackaged: true,
        getAppPath: () => '/mock/app.asar',
        commandLine: { getSwitchValue: () => '' },
    },
    ipcMain: { handle: mockIpcHandle },
    powerSaveBlocker: {
        start: jest.fn(),
        stop: jest.fn(),
        isStarted: jest.fn(),
    },
    screen: { getDisplayMatching: jest.fn() },
}));
jest.mock('../app', () => ({
    __esModule: true,
    default: { mainWindow: null },
}));
jest.mock('../services/embedded-mpv-session-options', () => ({
    readEmbeddedMpvSessionOptions: () => ({
        extraOptions: [],
        autoReconnect: true,
    }),
}));
jest.mock('../services/embedded-mpv-frame-copy-platform.util', () => ({
    ...jest.requireActual('../services/embedded-mpv-frame-copy-platform.util'),
    getFrameCopyRuntimeAvailability: () => ({
        usable: false,
        reason: 'helper-probe-failed',
    }),
    isFrameCopyRuntimeUsable: () => false,
}));

const INHERITED_PATH = '/usr/bin:/bin';
const LOGIN_SHELL_ONLY_DIR = '/home/user/.local/bin';
const LOGIN_SHELL_PATH = `${LOGIN_SHELL_ONLY_DIR}:${INHERITED_PATH}`;
/** Budget of the lookup; the shell in these tests never answers within it. */
const LOOKUP_BUDGET_MS = 5;

type SupportHandler = (event: unknown) => Promise<EmbeddedMpvSupport>;

async function flushLookup(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

describe('Embedded MPV support and a slow login shell (Linux native-view)', () => {
    const originalPlatform = process.platform;
    const originalEnv = {
        PATH: process.env.PATH,
        DISPLAY: process.env.DISPLAY,
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
        IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY:
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY,
    };
    let answerShell: (path: string) => void;

    function handlerFor(channel: string): SupportHandler {
        const registration = mockIpcHandle.mock.calls.find(
            ([registered]) => registered === channel
        );
        if (!registration) {
            throw new Error(`Missing ipcMain handler for ${channel}`);
        }
        return registration[1] as SupportHandler;
    }

    beforeEach(async () => {
        jest.resetModules();
        mockIpcHandle.mockReset();
        mockSpawnSync.mockReset();
        // mpv is installed where only the login shell PATH reaches it.
        mockSpawnSync.mockImplementation(() => ({
            status: (process.env.PATH ?? '')
                .split(':')
                .includes(LOGIN_SHELL_ONLY_DIR)
                ? 0
                : 1,
        }));
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.env.PATH = INHERITED_PATH;
        process.env.DISPLAY = ':0';
        delete process.env.WAYLAND_DISPLAY;
        delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY;

        const { scheduleDeferredFixPath } =
            await import('../startup/login-shell-path');
        const { embeddedMpvNativeService } =
            await import('../services/embedded-mpv-native.service');
        await import('./embedded-mpv.events');
        // The addon is normally a vendored .node file; with it in place,
        // mpv on PATH is the only thing support depends on.
        (
            embeddedMpvNativeService as unknown as {
                addon: { isSupported(): boolean };
            }
        ).addon = { isSupported: () => true };

        scheduleDeferredFixPath(
            () =>
                new Promise((resolve) => {
                    answerShell = resolve;
                }),
            LOOKUP_BUDGET_MS
        );
        // The lookup starts on the next tick; only then can it be answered.
        await flushLookup();
    });

    afterEach(async () => {
        // Let the lookup finish, so no test leaves a pending shell behind.
        answerShell(INHERITED_PATH);
        await flushLookup();
    });

    afterAll(() => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
        });
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it.each([EMBEDDED_MPV_SUPPORT, EMBEDDED_MPV_PREPARE])(
        '%s reports a missing mpv as inconclusive until the shell answers',
        async (channel) => {
            const check = handlerFor(channel);

            // The lookup runs out of budget: this probe sees the inherited
            // PATH, where mpv is missing.
            await expect(check({})).resolves.toMatchObject({
                supported: false,
                inconclusive: true,
            });
            // Asked again meanwhile: the cached answer is still not final.
            await expect(check({})).resolves.toMatchObject({
                supported: false,
                inconclusive: true,
            });
            expect(mockSpawnSync).toHaveBeenCalledTimes(1);

            answerShell(LOGIN_SHELL_PATH);
            await flushLookup();

            const settled = await check({});
            expect(settled.supported).toBe(true);
            expect(settled.inconclusive).toBeUndefined();
            expect(mockSpawnSync).toHaveBeenCalledTimes(2);
        }
    );

    it('reports a missing mpv as final once the shell answered without it', async () => {
        const support = handlerFor(EMBEDDED_MPV_SUPPORT);
        await expect(support({})).resolves.toMatchObject({
            supported: false,
            inconclusive: true,
        });

        answerShell(INHERITED_PATH);
        await flushLookup();

        const settled = await support({});
        expect(settled.supported).toBe(false);
        expect(settled.reason).toContain('mpv executable');
        expect(settled.inconclusive).toBeUndefined();
    });

    it('reports a missing mpv as final when the shell answered in time', async () => {
        answerShell(INHERITED_PATH);
        await flushLookup();

        const answer = await handlerFor(EMBEDDED_MPV_SUPPORT)({});
        expect(answer.supported).toBe(false);
        expect(answer.inconclusive).toBeUndefined();
    });
});
