import type {
    EmbeddedMpvBounds,
    EmbeddedMpvSessionStatus,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { EmbeddedMpvNativeService as EmbeddedMpvNativeServiceType } from './embedded-mpv-native.service';

const mockSpawnSync = jest.fn();

jest.mock('child_process', () => ({
    spawnSync: mockSpawnSync,
}));

const powerSaveBlockerMock = {
    start: jest.fn<number, [string]>(),
    stop: jest.fn<void, [number]>(),
    isStarted: jest.fn<boolean, [number]>(),
};
const commandLineMock = {
    getSwitchValue: jest.fn<string, [string]>(),
};
const appMock = {
    isPackaged: true,
    getAppPath: () => '/mock/app.asar',
    commandLine: commandLineMock,
};

jest.mock('electron', () => ({
    app: appMock,
    powerSaveBlocker: powerSaveBlockerMock,
}));

const mainWindowSendMock = jest.fn();
const mainWindowGetNativeWindowHandleMock = jest.fn<Buffer, []>(() =>
    Buffer.alloc(8)
);
const mainWindowMock = {
    isDestroyed: () => false,
    getNativeWindowHandle: mainWindowGetNativeWindowHandleMock,
    webContents: { send: mainWindowSendMock },
};

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        get mainWindow() {
            return mainWindowMock;
        },
    },
}));

interface MockSnapshot {
    status: EmbeddedMpvSessionStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    streamUrl: string;
    audioTracks?: never[];
    selectedAudioTrackId?: number | null;
    recording?: {
        active: boolean;
        targetPath?: string;
        startedAt?: string;
        error?: string;
    };
    error?: string;
}

interface MockAddon {
    isSupported: jest.Mock<boolean, []>;
    createSession: jest.Mock<
        string,
        [Buffer, EmbeddedMpvBounds, string?, number?]
    >;
    loadPlayback: jest.Mock<void, [string, ResolvedPortalPlayback]>;
    setBounds: jest.Mock<void, [string, EmbeddedMpvBounds]>;
    setPaused: jest.Mock<void, [string, boolean]>;
    seek: jest.Mock<void, [string, number]>;
    setVolume: jest.Mock<void, [string, number]>;
    setAudioTrack: jest.Mock<void, [string, number]>;
    startRecording: jest.Mock<void, [string, string]>;
    stopRecording: jest.Mock<void, [string]>;
    getSessionSnapshot: jest.Mock<MockSnapshot | null, [string]>;
    disposeSession: jest.Mock<void, [string]>;
}

function createMockAddon(): MockAddon {
    return {
        isSupported: jest.fn().mockReturnValue(true),
        createSession: jest.fn(),
        loadPlayback: jest.fn(),
        setBounds: jest.fn(),
        setPaused: jest.fn(),
        seek: jest.fn(),
        setVolume: jest.fn(),
        setAudioTrack: jest.fn(),
        startRecording: jest.fn(),
        stopRecording: jest.fn(),
        getSessionSnapshot: jest.fn(),
        disposeSession: jest.fn(),
    };
}

const BOUNDS: EmbeddedMpvBounds = { x: 0, y: 0, width: 100, height: 100 };

describe('EmbeddedMpvNativeService power blocker', () => {
    let EmbeddedMpvNativeService: typeof EmbeddedMpvNativeServiceType;
    let service: EmbeddedMpvNativeServiceType;
    let addon: MockAddon;
    let nextBlockerId: number;
    let originalPlatform: NodeJS.Platform;
    let originalDisplay: string | undefined;
    let originalOzonePlatformHint: string | undefined;
    let originalWaylandDisplay: string | undefined;
    let tempDirs: string[];

    beforeEach(async () => {
        jest.resetModules();
        powerSaveBlockerMock.start.mockReset();
        powerSaveBlockerMock.stop.mockReset();
        powerSaveBlockerMock.isStarted.mockReset();
        commandLineMock.getSwitchValue.mockReset();
        commandLineMock.getSwitchValue.mockReturnValue('');
        mockSpawnSync.mockReset();
        mockSpawnSync.mockReturnValue({
            status: 0,
        });
        mainWindowGetNativeWindowHandleMock.mockReset();
        mainWindowGetNativeWindowHandleMock.mockReturnValue(Buffer.alloc(8));
        mainWindowSendMock.mockReset();

        tempDirs = [];
        nextBlockerId = 1;
        powerSaveBlockerMock.start.mockImplementation(() => nextBlockerId++);
        powerSaveBlockerMock.isStarted.mockReturnValue(true);
        originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
            value: 'darwin',
        });
        originalDisplay = process.env.DISPLAY;
        originalOzonePlatformHint = process.env.ELECTRON_OZONE_PLATFORM_HINT;
        originalWaylandDisplay = process.env.WAYLAND_DISPLAY;

        ({ EmbeddedMpvNativeService } =
            await import('./embedded-mpv-native.service'));
        service = new EmbeddedMpvNativeService();
        addon = createMockAddon();
        // The addon is normally loaded via createRequire from a vendored .node
        // file. For unit tests we inject a mock implementation directly.
        (service as unknown as { addon: MockAddon }).addon = addon;
    });

    afterEach(() => {
        service.shutdown();
        jest.useRealTimers();
        for (const tempDir of tempDirs) {
            rmSync(tempDir, { recursive: true, force: true });
        }
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
        });
        restoreEnv('DISPLAY', originalDisplay);
        restoreEnv('ELECTRON_OZONE_PLATFORM_HINT', originalOzonePlatformHint);
        restoreEnv('WAYLAND_DISPLAY', originalWaylandDisplay);
    });

    function restoreEnv(key: string, value: string | undefined): void {
        if (value === undefined) {
            delete process.env[key];
            return;
        }

        process.env[key] = value;
    }

    function createTempDir(): string {
        const tempDir = mkdtempSync(
            path.join(tmpdir(), 'iptvnator-recording-')
        );
        tempDirs.push(tempDir);
        return tempDir;
    }

    function startSession(sessionId: string, snapshot: MockSnapshot): void {
        addon.createSession.mockReturnValueOnce(sessionId);
        addon.getSessionSnapshot.mockReturnValueOnce(snapshot);
        service.createSession(BOUNDS, '', 1);
    }

    function snapshot(
        status: EmbeddedMpvSessionStatus,
        overrides: Partial<MockSnapshot> = {}
    ): MockSnapshot {
        return {
            status,
            positionSeconds: 0,
            durationSeconds: null,
            volume: 1,
            streamUrl: 'mock://stream',
            ...overrides,
        };
    }

    it('does not acquire a blocker for a loading session', () => {
        startSession('s1', snapshot('loading'));
        expect(powerSaveBlockerMock.start).not.toHaveBeenCalled();
    });

    it('keeps the polling timer alive when refreshing a session throws', () => {
        jest.useFakeTimers();
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation();

        try {
            startSession('s1', snapshot('playing'));
            startSession('s2', snapshot('playing'));

            // s1 keeps failing while s2 stays healthy: the healthy session
            // must not reset the log suppression for the failing one.
            addon.getSessionSnapshot.mockImplementation((sessionId: string) => {
                if (sessionId === 's1') {
                    throw new Error('addon crashed');
                }
                return snapshot('playing');
            });

            // Three poll ticks: nothing may escape the interval callback,
            // and the failure is logged once instead of at poll rate.
            expect(() => jest.advanceTimersByTime(1500)).not.toThrow();
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

            // Once the addon recovers, session updates flow again.
            addon.getSessionSnapshot.mockImplementation(() =>
                snapshot('playing', { positionSeconds: 42 })
            );
            mainWindowSendMock.mockClear();
            jest.advanceTimersByTime(500);
            expect(mainWindowSendMock).toHaveBeenCalled();

            // A recovered session that fails again logs once more (one line
            // per session per failure streak, not one per service lifetime).
            addon.getSessionSnapshot.mockImplementation(() => {
                throw new Error('addon crashed again');
            });
            jest.advanceTimersByTime(1000);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('acquires a single prevent-display-sleep blocker once a session is playing', () => {
        startSession('s1', snapshot('loading'));

        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('playing'));
        service.setPaused('s1', false);

        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);
        expect(powerSaveBlockerMock.start).toHaveBeenCalledWith(
            'prevent-display-sleep'
        );

        // Subsequent refreshes while still playing must not start a second blocker.
        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('playing'));
        service.setPaused('s1', false);
        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);
    });

    it('releases the blocker when the session transitions to paused', () => {
        startSession('s1', snapshot('playing'));
        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);

        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('paused'));
        service.setPaused('s1', true);

        expect(powerSaveBlockerMock.stop).toHaveBeenCalledTimes(1);
        expect(powerSaveBlockerMock.stop).toHaveBeenCalledWith(1);
    });

    it('releases the blocker when MPV reports playback ended', () => {
        startSession('s1', snapshot('playing'));
        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);

        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('ended'));
        service.setPaused('s1', false);

        expect(powerSaveBlockerMock.stop).toHaveBeenCalledTimes(1);
        expect(powerSaveBlockerMock.stop).toHaveBeenCalledWith(1);
    });

    it('keeps the blocker held while any other session is still playing', () => {
        startSession('s1', snapshot('playing'));
        startSession('s2', snapshot('playing'));

        // Only one blocker for both sessions.
        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);

        // s1 pauses — s2 still playing, so do not release.
        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('paused'));
        service.setPaused('s1', true);
        expect(powerSaveBlockerMock.stop).not.toHaveBeenCalled();

        // s2 pauses — now there is nothing playing.
        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('paused'));
        service.setPaused('s2', true);
        expect(powerSaveBlockerMock.stop).toHaveBeenCalledTimes(1);
    });

    it('releases the blocker when the playing session is disposed', () => {
        startSession('s1', snapshot('playing'));
        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);

        service.disposeSession('s1');

        expect(addon.disposeSession).toHaveBeenCalledWith('s1');
        expect(powerSaveBlockerMock.stop).toHaveBeenCalledTimes(1);
    });

    it('releases the blocker on shutdown', () => {
        startSession('s1', snapshot('playing'));
        expect(powerSaveBlockerMock.start).toHaveBeenCalledTimes(1);

        service.shutdown();

        expect(powerSaveBlockerMock.stop).toHaveBeenCalled();
    });

    it('skips powerSaveBlocker.stop if the assertion was already cleared externally', () => {
        startSession('s1', snapshot('playing'));
        powerSaveBlockerMock.isStarted.mockReturnValue(false);

        addon.getSessionSnapshot.mockReturnValueOnce(snapshot('paused'));
        service.setPaused('s1', true);

        expect(powerSaveBlockerMock.stop).not.toHaveBeenCalled();
    });

    it('reports recording support when the addon exposes recording methods', () => {
        expect(service.getSupport().capabilities?.recording).toBe(true);
    });

    it.each<NodeJS.Platform>(['darwin', 'win32', 'linux'])(
        'reports embedded MPV support on %s when the addon is already loaded',
        (platform) => {
            delete process.env.WAYLAND_DISPLAY;
            Object.defineProperty(process, 'platform', {
                value: platform,
            });

            expect(service.getSupport()).toEqual(
                expect.objectContaining({
                    supported: true,
                    platform,
                })
            );
        }
    );

    it('reports Linux Wayland as unsupported unless Electron is using X11/Xwayland', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        process.env.DISPLAY = ':0';
        process.env.WAYLAND_DISPLAY = 'wayland-0';

        const support = service.getSupport();

        expect(support.supported).toBe(false);
        expect(support.reason).toContain('Native Wayland embedding');
    });

    it('does not treat the ozone platform hint env as proof that Electron is using X11', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        process.env.DISPLAY = ':0';
        process.env.WAYLAND_DISPLAY = 'wayland-0';
        process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';

        expect(service.getSupport().supported).toBe(false);
    });

    it('reports Linux Wayland as supported when X11 ozone is requested', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        process.env.DISPLAY = ':0';
        process.env.WAYLAND_DISPLAY = 'wayland-0';
        commandLineMock.getSwitchValue.mockReturnValue('x11');

        expect(service.getSupport()).toEqual(
            expect.objectContaining({
                supported: true,
                platform: 'linux',
            })
        );
    });

    it('reports Linux as unsupported when the mpv executable is missing', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        delete process.env.WAYLAND_DISPLAY;
        mockSpawnSync.mockReturnValueOnce({
            status: null,
            error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
        });

        const support = service.getSupport();

        expect(support.supported).toBe(false);
        expect(support.reason).toContain('requires the mpv executable on PATH');
        expect(mockSpawnSync).toHaveBeenCalledWith('mpv', ['--version'], {
            stdio: 'ignore',
            timeout: 3000,
        });
    });

    it('caches the Linux mpv executable probe result', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        delete process.env.WAYLAND_DISPLAY;

        service.getSupport();
        service.getSupport();

        expect(mockSpawnSync).toHaveBeenCalledTimes(1);
        expect(mockSpawnSync).toHaveBeenCalledWith('mpv', ['--version'], {
            stdio: 'ignore',
            timeout: 3000,
        });
    });

    it('rejects Electron native Wayland placeholder handles before calling the addon', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        process.env.DISPLAY = ':0';
        process.env.WAYLAND_DISPLAY = 'wayland-0';
        mainWindowGetNativeWindowHandleMock.mockReturnValueOnce(
            Buffer.from([1, 0, 0, 0])
        );

        expect(() => service.createSession(BOUNDS, '', 1)).toThrow(
            'Embedded MPV on Linux requires Electron to run under X11 or Xwayland.'
        );
        expect(addon.createSession).not.toHaveBeenCalled();
    });

    it('rejects 64-bit Electron native Wayland placeholder handles before calling the addon', () => {
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        process.env.DISPLAY = ':0';
        process.env.WAYLAND_DISPLAY = 'wayland-0';
        mainWindowGetNativeWindowHandleMock.mockReturnValueOnce(
            Buffer.alloc(8)
        );

        expect(() => service.createSession(BOUNDS, '', 1)).toThrow(
            'Embedded MPV on Linux requires Electron to run under X11 or Xwayland.'
        );
        expect(addon.createSession).not.toHaveBeenCalled();
    });

    it.each([
        {
            platform: 'darwin' as NodeJS.Platform,
            runtimeFile: path.join('lib', 'libmpv.2.dylib'),
        },
        {
            platform: 'win32' as NodeJS.Platform,
            runtimeFile: path.join('lib', 'mpv-2.dll'),
        },
    ])(
        'loads the addon after validating the $platform runtime file exists',
        ({ platform, runtimeFile }) => {
            delete process.env.WAYLAND_DISPLAY;
            Object.defineProperty(process, 'platform', {
                value: platform,
            });
            const nativeDir = createTempDir();
            const addonPath = path.join(nativeDir, 'embedded_mpv.node');
            const runtimePath = path.join(nativeDir, runtimeFile);
            mkdirSync(path.dirname(runtimePath), { recursive: true });
            writeFileSync(addonPath, '');
            writeFileSync(runtimePath, '');
            const loadAddonModule = jest.fn().mockReturnValue(addon);

            Object.assign(service as unknown as Record<string, unknown>, {
                addon: null,
                addonLoadError: null,
                loadAddonModule,
                getAddonCandidatePaths: () => [addonPath],
            });

            expect(service.getSupport()).toEqual(
                expect.objectContaining({
                    supported: true,
                    platform,
                })
            );
            expect(loadAddonModule).toHaveBeenCalledWith(addonPath);
        }
    );

    it('loads the Linux addon without bundled libmpv runtime files', () => {
        delete process.env.WAYLAND_DISPLAY;
        Object.defineProperty(process, 'platform', {
            value: 'linux',
        });
        const nativeDir = createTempDir();
        const addonPath = path.join(nativeDir, 'embedded_mpv.node');
        writeFileSync(addonPath, '');
        const loadAddonModule = jest.fn().mockReturnValue(addon);

        Object.assign(service as unknown as Record<string, unknown>, {
            addon: null,
            addonLoadError: null,
            loadAddonModule,
            getAddonCandidatePaths: () => [addonPath],
        });

        expect(service.getSupport()).toEqual(
            expect.objectContaining({
                supported: true,
                platform: 'linux',
            })
        );
        expect(loadAddonModule).toHaveBeenCalledWith(addonPath);
        expect(mockSpawnSync).toHaveBeenCalledWith('mpv', ['--version'], {
            stdio: 'ignore',
            timeout: 3000,
        });
    });

    it('loads the addon before reporting support capabilities', () => {
        const loadAddonModule = jest.fn().mockReturnValue(addon);
        Object.assign(service as unknown as Record<string, unknown>, {
            addon: null,
            addonLoadError: null,
            loadAddonModule,
            getAddonCandidatePaths: () => [__filename],
            getMissingRuntimeReason: () => null,
        });

        const support = service.getSupport();

        expect(loadAddonModule).toHaveBeenCalledWith(__filename);
        expect(support.supported).toBe(true);
        expect(support.capabilities?.recording).toBe(true);
    });

    it('starts recording to a sanitized reserved unique ts file in the requested directory', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 4, 9, 10, 11, 12));
        const directory = createTempDir();
        startSession('s1', snapshot('playing'));

        const targetPath = path.join(directory, 'News_Live-20260509-101112.ts');
        addon.getSessionSnapshot.mockReturnValueOnce(
            snapshot('playing', {
                recording: {
                    active: true,
                    targetPath,
                    startedAt: '2026-05-09T08:11:12.000Z',
                },
            })
        );

        const updated = service.startRecording('s1', {
            directory,
            title: 'News/Live',
        });

        expect(addon.startRecording).toHaveBeenCalledWith('s1', targetPath);
        expect(existsSync(targetPath)).toBe(true);
        expect(updated?.recording?.active).toBe(true);
        expect(updated?.recording?.targetPath).toBe(targetPath);
    });

    it('reserves the next unique recording path when the first candidate exists', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 4, 9, 10, 11, 12));
        const directory = createTempDir();
        const firstCandidate = path.join(
            directory,
            'News_Live-20260509-101112.ts'
        );
        const reservedCandidate = path.join(
            directory,
            'News_Live-20260509-101112-2.ts'
        );
        writeFileSync(firstCandidate, 'existing recording');
        startSession('s1', snapshot('playing'));

        addon.getSessionSnapshot.mockReturnValueOnce(
            snapshot('playing', {
                recording: {
                    active: true,
                    targetPath: reservedCandidate,
                },
            })
        );

        service.startRecording('s1', {
            directory,
            title: 'News/Live',
        });

        expect(addon.startRecording).toHaveBeenCalledWith(
            's1',
            reservedCandidate
        );
        expect(existsSync(firstCandidate)).toBe(true);
        expect(existsSync(reservedCandidate)).toBe(true);
    });

    it('stops recording and keeps the last target path in the session snapshot', () => {
        const targetPath = '/tmp/News_Live-20260509-101112.ts';
        startSession(
            's1',
            snapshot('playing', {
                recording: {
                    active: true,
                    targetPath,
                    startedAt: '2026-05-09T08:11:12.000Z',
                },
            })
        );
        addon.getSessionSnapshot.mockReturnValueOnce(
            snapshot('playing', {
                recording: {
                    active: false,
                    targetPath,
                },
            })
        );

        const updated = service.stopRecording('s1');

        expect(addon.stopRecording).toHaveBeenCalledWith('s1');
        expect(updated?.recording?.active).toBe(false);
        expect(updated?.recording?.targetPath).toBe(targetPath);
    });

    it('preserves the recording target path when disposing an active recording session', () => {
        const targetPath = '/tmp/News_Live-20260509-101112.ts';
        startSession(
            's1',
            snapshot('playing', {
                recording: {
                    active: true,
                    targetPath,
                    startedAt: '2026-05-09T08:11:12.000Z',
                },
            })
        );
        addon.getSessionSnapshot.mockReturnValueOnce(
            snapshot('playing', {
                recording: {
                    active: true,
                    targetPath,
                    startedAt: '2026-05-09T08:11:12.000Z',
                },
            })
        );

        const disposed = service.disposeSession('s1');

        expect(addon.disposeSession).toHaveBeenCalledWith('s1');
        expect(disposed?.recording).toEqual({
            active: false,
            targetPath,
        });
        expect(mainWindowSendMock).toHaveBeenLastCalledWith(
            'EMBEDDED_MPV_SESSION_UPDATE',
            expect.objectContaining({
                recording: {
                    active: false,
                    targetPath,
                },
            })
        );
    });
});
