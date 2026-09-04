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
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { EmbeddedMpvNativeService as EmbeddedMpvNativeServiceType } from './embedded-mpv-native.service';

const mockSpawnSync = jest.fn();
const mockIsFrameCopyRuntimeUsable = jest.fn<boolean, []>();
const mockGetFrameCopyRuntimeAvailability = jest.fn();

jest.mock('child_process', () => ({
    spawnSync: mockSpawnSync,
}));

const recordingTrackerMock = {
    onRecordingStarted: jest.fn(),
    onRecordingStopped: jest.fn(),
    onRecordingInterrupted: jest.fn(),
    observeSnapshot: jest.fn(),
};
jest.mock('./embedded-mpv-recording-tracker', () => ({
    embeddedMpvRecordingTracker: recordingTrackerMock,
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
let userDataDir = '';
const appMock = {
    isPackaged: true,
    getAppPath: () => '/mock/app.asar',
    getPath: () => userDataDir,
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
    recording?: { active: boolean; targetPath?: string };
    error?: string;
    errorOrigin?: 'playback' | 'engine';
}

const BOUNDS: EmbeddedMpvBounds = { x: 0, y: 0, width: 100, height: 100 };
const LIVE: ResolvedPortalPlayback = {
    streamUrl: 'http://host/live.ts',
    title: 'Live channel',
    isLive: true,
};
const VOD: ResolvedPortalPlayback = {
    streamUrl: 'http://host/movie.mkv',
    title: 'Movie',
    isLive: false,
    startTime: 30,
    contentInfo: {
        playlistId: 'playlist-1',
        contentXtreamId: 7,
        contentType: 'vod',
    },
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
    let positionSeconds: number;
    let recordingActive: boolean;
    let errorOrigin: 'playback' | 'engine' | undefined;
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
        userDataDir = mkdtempSync(
            path.join(tmpdir(), 'iptvnator-mpv-options-')
        );

        ({ EmbeddedMpvNativeService } =
            await import('./embedded-mpv-native.service'));
        service = new EmbeddedMpvNativeService();
        status = 'idle';
        positionSeconds = 0;
        recordingActive = false;
        errorOrigin = undefined;
        recordingTrackerMock.onRecordingStarted.mockReset();
        recordingTrackerMock.onRecordingStopped.mockReset();
        recordingTrackerMock.onRecordingInterrupted.mockReset();
        recordingTrackerMock.observeSnapshot.mockReset();
        addon = {
            isSupported: jest.fn<boolean, []>(() => true),
            createSession: jest.fn<string, unknown[]>(() => 'session-1'),
            loadPlayback: jest.fn(),
            getSessionSnapshot: jest.fn<MockSnapshot | null, [string]>(() => ({
                status,
                positionSeconds,
                durationSeconds: null,
                volume: 1,
                streamUrl: LIVE.streamUrl,
                recording: { active: recordingActive },
                ...(errorOrigin ? { errorOrigin } : {}),
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
        rmSync(userDataDir, { recursive: true, force: true });
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

    it('hands Linux native-view its options through a user-only include file', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        Object.defineProperty(process, 'arch', { value: 'x64' });

        service.createSession(BOUNDS, 'Title', 0.5, {
            extraOptions: [
                'network-timeout=10',
                'http-header-fields=X-Key: secret',
            ],
            autoReconnect: true,
        });

        const addonOptions = addon.createSession.mock.calls[0][4] as string[];
        expect(addonOptions).toHaveLength(1);
        expect(addonOptions[0]).toMatch(/^include=.*session-options-.*\.conf$/);
        const file = addonOptions[0].slice('include='.length);
        expect(path.dirname(file)).toBe(
            path.join(userDataDir, 'embedded-mpv', `options-${process.pid}`)
        );
        expect(readFileSync(file, 'utf8')).toBe(
            'network-timeout=10\nhttp-header-fields=X-Key: secret\n'
        );
        expect(statSync(file).mode & 0o777).toBe(0o600);

        service.disposeSession('session-1');
        expect(existsSync(file)).toBe(false);
    });

    it('sweeps only option directories whose owning process is gone', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        Object.defineProperty(process, 'arch', { value: 'x64' });
        const root = path.join(userDataDir, 'embedded-mpv');
        const staleDir = path.join(root, 'options-2147483646');
        const liveDir = path.join(root, `options-${process.ppid}`);
        mkdirSync(staleDir, { recursive: true });
        mkdirSync(liveDir, { recursive: true });
        writeFileSync(path.join(staleDir, 'session-options-old.conf'), 'x=1\n');
        writeFileSync(path.join(liveDir, 'session-options-live.conf'), 'y=1\n');

        service.createSession(BOUNDS, 'Title', 0.5, {
            extraOptions: ['network-timeout=10'],
            autoReconnect: true,
        });

        expect(existsSync(staleDir)).toBe(false);
        expect(
            existsSync(path.join(liveDir, 'session-options-live.conf'))
        ).toBe(true);
        const ownDir = path.join(root, `options-${process.pid}`);
        expect(existsSync(ownDir)).toBe(true);

        service.shutdown();
        expect(existsSync(ownDir)).toBe(false);
    });

    it('restarts a recording that was running when the stream dropped', () => {
        startPlayingLive();
        service.startRecording('session-1', { title: 'Live channel' });
        expect(addon.startRecording).toHaveBeenCalledTimes(1);
        const firstTarget = addon.startRecording.mock.calls[0][1] as string;
        recordingActive = true;
        poll('playing');

        recordingActive = false;
        poll('error');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);
        expect(
            recordingTrackerMock.onRecordingInterrupted
        ).not.toHaveBeenCalled();

        status = 'loading';
        jest.advanceTimersByTime(2_000);
        expect(
            recordingTrackerMock.onRecordingInterrupted
        ).toHaveBeenCalledWith('session-1');
        poll('playing');
        // The restart is deferred with a 0 ms timer scheduled from inside
        // the poll tick, which the fake clock parks one millisecond out.
        jest.advanceTimersByTime(1);

        expect(addon.startRecording).toHaveBeenCalledTimes(2);
        const secondTarget = addon.startRecording.mock.calls[1][1] as string;
        expect(secondTarget).not.toBe(firstTarget);
        expect(path.dirname(secondTarget)).toBe(path.dirname(firstTarget));
        expect(recordingTrackerMock.onRecordingStarted).toHaveBeenCalledTimes(
            2
        );
    });

    it('files the interruption once even when the first reload attempt fails', () => {
        startPlayingLive();
        service.startRecording('session-1', { title: 'Live channel' });
        recordingActive = true;
        poll('playing');

        recordingActive = false;
        poll('error');
        status = 'loading';
        jest.advanceTimersByTime(2_000);
        poll('error');
        jest.advanceTimersByTime(4_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(3);
        expect(
            recordingTrackerMock.onRecordingInterrupted
        ).toHaveBeenCalledTimes(1);
    });

    it('leaves a recording alone when the stream recovers before the reload fires', () => {
        startPlayingLive();
        service.startRecording('session-1', { title: 'Live channel' });
        recordingActive = true;
        poll('playing');

        poll('error');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);
        // ffmpeg's own reconnect brings the stream back within the backoff;
        // mpv never stopped recording.
        poll('playing');
        jest.advanceTimersByTime(60_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
        expect(addon.startRecording).toHaveBeenCalledTimes(1);
        expect(
            recordingTrackerMock.onRecordingInterrupted
        ).not.toHaveBeenCalled();
    });

    it('does not restart a recording the user had stopped or replaced', () => {
        startPlayingLive();
        service.startRecording('session-1', { title: 'Live channel' });
        recordingActive = true;
        poll('playing');
        service.stopRecording('session-1');
        recordingActive = false;
        poll('playing');

        poll('error');
        status = 'loading';
        jest.advanceTimersByTime(2_000);
        poll('playing');
        // The restart is deferred with a 0 ms timer scheduled from inside
        // the poll tick, which the fake clock parks one millisecond out.
        jest.advanceTimersByTime(1);

        expect(addon.startRecording).toHaveBeenCalledTimes(1);
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
        // keep-open leaves mpv paused after EOF; the reload must clear it.
        expect(addon.setPaused).toHaveBeenCalledWith('session-1', false);
        expect(lastUpdate()?.status).toBe('loading');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);

        poll('playing');

        expect(lastUpdate()?.status).toBe('playing');
        expect(lastUpdate()?.reconnect).toBeUndefined();
    });

    it('reloads a dropped movie from the position it reached', () => {
        service.createSession(BOUNDS, 'Title', 0.5, {
            extraOptions: [],
            autoReconnect: true,
        });
        service.loadPlayback('session-1', VOD);
        poll('loading');
        positionSeconds = 640;
        poll('playing');
        poll('playing');

        poll('error');
        status = 'loading';
        jest.advanceTimersByTime(2_000);

        expect(addon.loadPlayback).toHaveBeenLastCalledWith('session-1', {
            ...VOD,
            startTime: 640,
        });
    });

    it('treats EOF on a live stream as a drop', () => {
        startPlayingLive();

        poll('ended');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);

        status = 'loading';
        jest.advanceTimersByTime(2_000);
        expect(addon.loadPlayback).toHaveBeenCalledTimes(2);
    });

    it('leaves an error the engine attributes to itself alone', () => {
        startPlayingLive();

        errorOrigin = 'engine';
        poll('error');
        jest.advanceTimersByTime(120_000);

        expect(lastUpdate()?.status).toBe('error');
        expect(lastUpdate()?.reconnect).toBeUndefined();
        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
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

    it('drops the pending reload when the user pauses from the error state', () => {
        startPlayingLive();
        poll('error');
        expect(lastUpdate()?.reconnect?.attempt).toBe(1);

        service.setPaused('session-1', true);
        expect(addon.setPaused).toHaveBeenCalledWith('session-1', true);
        expect(lastUpdate()?.reconnect).toBeUndefined();
        jest.advanceTimersByTime(60_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
    });

    it('drops the pending reload when the session is disposed', () => {
        startPlayingLive();
        poll('error');

        service.disposeSession('session-1');
        jest.advanceTimersByTime(60_000);

        expect(addon.loadPlayback).toHaveBeenCalledTimes(1);
    });

    it('still counts the attempt when only the unpause fails', () => {
        startPlayingLive();
        poll('error');
        addon.setPaused.mockImplementationOnce(() => {
            throw new Error('socket not ready');
        });
        const warn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);

        try {
            status = 'loading';
            jest.advanceTimersByTime(2_000);

            expect(addon.loadPlayback).toHaveBeenCalledTimes(2);
            expect(lastUpdate()?.reconnect?.attempt).toBe(1);
            poll('playing');
            expect(lastUpdate()?.reconnect).toBeUndefined();
        } finally {
            warn.mockRestore();
        }
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
