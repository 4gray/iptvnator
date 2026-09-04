/**
 * Reconnect and session-option behaviour of EmbeddedMpvNativeService. Kept
 * apart from embedded-mpv-native.service.spec.ts, which is close to the
 * 1200-line spec limit; the mocks mirror that file.
 */
import type {
    EmbeddedMpvBounds,
    EmbeddedMpvSession,
    EmbeddedMpvSessionStatus,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { EmbeddedMpvNativeService as EmbeddedMpvNativeServiceType } from './embedded-mpv-native.service';

const mockSpawnSync = jest.fn();
const mockIsFrameCopyRuntimeUsable = jest.fn<boolean, []>();
const mockGetFrameCopyRuntimeAvailability = jest.fn();

jest.mock('child_process', () => ({
    spawnSync: mockSpawnSync,
}));

jest.mock('./embedded-mpv-frame-copy-platform.util', () => {
    const actual = jest.requireActual(
        './embedded-mpv-frame-copy-platform.util'
    );
    return {
        ...actual,
        getFrameCopyRuntimeAvailability: mockGetFrameCopyRuntimeAvailability,
        isFrameCopyRuntimeUsable: mockIsFrameCopyRuntimeUsable,
    };
});

const powerSaveBlockerMock = {
    start: jest.fn<number, [string]>(() => 1),
    stop: jest.fn<void, [number]>(),
    isStarted: jest.fn<boolean, [number]>(() => true),
};
const appMock = {
    isPackaged: true,
    getAppPath: () => '/mock/app.asar',
    commandLine: { getSwitchValue: jest.fn<string, [string]>(() => '') },
};

jest.mock('electron', () => ({
    app: appMock,
    powerSaveBlocker: powerSaveBlockerMock,
    screen: { getDisplayMatching: jest.fn(() => ({ scaleFactor: 1 })) },
}));

const mainWindowSendMock = jest.fn();
const mainWindowMock = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(8),
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    webContents: {
        send: mainWindowSendMock,
        on: jest.fn(),
        getZoomFactor: () => 1,
    },
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
    error?: string;
}

const BOUNDS: EmbeddedMpvBounds = { x: 0, y: 0, width: 100, height: 100 };
const LIVE: ResolvedPortalPlayback = {
    streamUrl: 'http://host/live.ts',
    title: 'Live channel',
    isLive: true,
};

describe('EmbeddedMpvNativeService reconnect', () => {
    let EmbeddedMpvNativeService: typeof EmbeddedMpvNativeServiceType;
    let service: EmbeddedMpvNativeServiceType;
    let addon: {
        isSupported: jest.Mock<boolean, []>;
        createSession: jest.Mock<string, unknown[]>;
        loadPlayback: jest.Mock<void, [string, ResolvedPortalPlayback]>;
        getSessionSnapshot: jest.Mock<MockSnapshot | null, [string]>;
        disposeSession: jest.Mock<void, [string]>;
        setBounds: jest.Mock;
        setPaused: jest.Mock;
        seek: jest.Mock;
        setVolume: jest.Mock;
        setAudioTrack: jest.Mock;
        startRecording: jest.Mock;
        stopRecording: jest.Mock;
    };
    let status: EmbeddedMpvSessionStatus;
    let originalPlatform: NodeJS.Platform;
    let originalArch: string;
    let originalExperiment: string | undefined;

    beforeEach(async () => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-03T10:00:00Z'));
        mainWindowSendMock.mockReset();
        mockSpawnSync.mockReset();
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockIsFrameCopyRuntimeUsable.mockReset();
        mockIsFrameCopyRuntimeUsable.mockReturnValue(false);
        mockGetFrameCopyRuntimeAvailability.mockReset();
        mockGetFrameCopyRuntimeAvailability.mockReturnValue({
            usable: false,
            reason: 'helper-probe-failed',
        });
        originalPlatform = process.platform;
        originalArch = process.arch;
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        Object.defineProperty(process, 'arch', { value: 'arm64' });
        originalExperiment =
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT = '1';

        ({ EmbeddedMpvNativeService } =
            await import('./embedded-mpv-native.service'));
        service = new EmbeddedMpvNativeService();
        status = 'idle';
        addon = {
            isSupported: jest.fn<boolean, []>(() => true),
            createSession: jest.fn<string, unknown[]>(() => 'session-1'),
            loadPlayback: jest.fn(),
            getSessionSnapshot: jest.fn<MockSnapshot | null, [string]>(() => ({
                status,
                positionSeconds: 0,
                durationSeconds: null,
                volume: 1,
                streamUrl: LIVE.streamUrl,
            })),
            disposeSession: jest.fn(),
            setBounds: jest.fn(),
            setPaused: jest.fn(),
            seek: jest.fn(),
            setVolume: jest.fn(),
            setAudioTrack: jest.fn(),
            startRecording: jest.fn(),
            stopRecording: jest.fn(),
        };
        (service as unknown as { addon: typeof addon }).addon = addon;
    });

    afterEach(() => {
        service.shutdown();
        jest.useRealTimers();
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        Object.defineProperty(process, 'arch', { value: originalArch });
        if (originalExperiment === undefined) {
            delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
        } else {
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT =
                originalExperiment;
        }
    });

    /** Lets the 500 ms poll observe the addon status once. */
    const poll = (next: EmbeddedMpvSessionStatus) => {
        status = next;
        jest.advanceTimersByTime(500);
    };

    const lastUpdate = (): EmbeddedMpvSession | undefined =>
        mainWindowSendMock.mock.calls.at(-1)?.[1] as
            EmbeddedMpvSession | undefined;

    const startPlayingLive = (autoReconnect = true) => {
        service.createSession(BOUNDS, 'Title', 0.5, {
            extraOptions: ['network-timeout=10'],
            autoReconnect,
        });
        service.loadPlayback('session-1', LIVE);
        poll('loading');
        poll('playing');
        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
    };

    it('hands the session options to the addon', () => {
        service.createSession(BOUNDS, 'Title', 0.5, {
            extraOptions: ['network-timeout=10', 'hwdec=no'],
            autoReconnect: true,
        });

        expect(addon.createSession).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({ width: 100, height: 100 }),
            'Title',
            0.5,
            ['network-timeout=10', 'hwdec=no']
        );
    });

    it('sends an empty option list when no options were captured', () => {
        service.createSession(BOUNDS);

        expect(addon.createSession.mock.calls[0][4]).toEqual([]);
    });

    it('reloads a dropped live stream, tells the renderer, and clears once it plays again', () => {
        startPlayingLive();

        poll('error');

        expect(lastUpdate()?.status).toBe('error');
        expect(lastUpdate()?.reconnect).toEqual({
            attempt: 1,
            maxAttempts: 6,
            nextAttemptAt: new Date(Date.now() + 2_000).toISOString(),
        });
        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);

        status = 'loading';
        jest.advanceTimersByTime(2_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(2);
        expect(addon.loadPlayback).toHaveBeenLastCalledWith('session-1', LIVE);
        expect(lastUpdate()?.status).toBe('loading');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);

        poll('playing');

        expect(lastUpdate()?.status).toBe('playing');
        expect(lastUpdate()?.reconnect).toBeUndefined();
    });

    it('treats EOF on a live stream as a drop', () => {
        startPlayingLive();

        poll('ended');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);

        status = 'loading';
        jest.advanceTimersByTime(2_000);
        expect(addon.loadPlayback).toHaveBeenCalledTimes(2);
    });

    it('stays quiet when the setting is off', () => {
        startPlayingLive(false);

        poll('error');
        jest.advanceTimersByTime(120_000);

        expect(lastUpdate()?.reconnect).toBeUndefined();
        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
    });

    it('drops the pending reload when the user loads something else', () => {
        startPlayingLive();
        poll('error');

        const next: ResolvedPortalPlayback = {
            ...LIVE,
            streamUrl: 'http://host/other.ts',
        };
        status = 'loading';
        service.loadPlayback('session-1', next);
        jest.advanceTimersByTime(60_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(2);
        expect(addon.loadPlayback).toHaveBeenLastCalledWith('session-1', next);
    });

    it('drops the pending reload when the session is disposed', () => {
        startPlayingLive();
        poll('error');

        service.disposeSession('session-1');
        jest.advanceTimersByTime(60_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
    });

    it('keeps the main process alive when a reload attempt throws', () => {
        startPlayingLive();
        poll('error');
        addon.loadPlayback.mockImplementationOnce(() => {
            throw new Error('addon exploded');
        });
        const warn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);

        try {
            expect(() => jest.advanceTimersByTime(2_000)).not.toThrow();
            expect(lastUpdate()?.reconnect?.attempt).toBe(2);
        } finally {
            warn.mockRestore();
        }
    });
});
