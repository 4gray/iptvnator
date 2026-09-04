import path from 'path';

// The adapter reaches `electron` through the platform util for packaged
// paths only; mocking it keeps this suite independent of the Electron binary
// being present (a CI runner can restore node_modules without it).
jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app',
        getPath: () => '/mock/user-data',
    },
}));

const spawnMock = jest.fn();
jest.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

import type { EmbeddedMpvFrameCopyAdapter } from './embedded-mpv-frame-copy.adapter';
import { EmbeddedMpvSessionGoneError } from './embedded-mpv-session-errors';
import {
    createFrameCopyAdapter,
    createFrameCopySession,
    FakeHelperProcess,
    type FrameSourceChange,
} from './embedded-mpv-frame-copy.adapter.test-helpers';

// The Linux loader-environment contract lives in
// embedded-mpv-frame-copy.adapter.linux-env.spec.ts.
describe('EmbeddedMpvFrameCopyAdapter', () => {
    let child: FakeHelperProcess;
    let frameSourceChanges: FrameSourceChange[];
    let adapter: EmbeddedMpvFrameCopyAdapter;

    beforeEach(() => {
        jest.useFakeTimers();
        child = new FakeHelperProcess();
        spawnMock.mockReset();
        spawnMock.mockReturnValue(child);
        ({ adapter, frameSourceChanges } = createFrameCopyAdapter());
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const createSession = () => createFrameCopySession(adapter);

    it('spawns the helper with device-pixel size and initial volume', () => {
        const sessionId = createSession();
        expect(sessionId).toMatch(/^impv-fc-/);
        const [helperPath, args] = spawnMock.mock.calls[0];
        expect(helperPath).toBe('/native/helper');
        expect(args).toEqual([
            '--shm-base',
            `/${sessionId}`,
            '--width',
            '1280',
            '--height',
            '720',
            '--volume',
            '0.8',
            '--mpv-options-stdin',
        ]);
        expect(child.stdin.written[0]).toBe('mpv-options\n');
    });

    it('caches helper snapshot events for getSessionSnapshot', () => {
        const sessionId = createSession();
        child.emitStdout({
            event: 'snapshot',
            status: 'playing',
            positionSeconds: 12.5,
            durationSeconds: 60,
            volume: 0.8,
            streamUrl: 'http://stream',
            audioTracks: [],
            selectedAudioTrackId: null,
            subtitleTracks: [],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: { active: false },
        });
        const snapshot = adapter.getSessionSnapshot(sessionId);
        expect(snapshot?.status).toBe('playing');
        expect(snapshot?.positionSeconds).toBe(12.5);
        expect(snapshot?.streamUrl).toBe('http://stream');
    });

    it('publishes shm generations through onFrameSourceChanged', () => {
        const sessionId = createSession();
        child.emitStdout({
            event: 'shm',
            name: `/${sessionId}-g1`,
            width: 1280,
            height: 720,
            generation: 1,
        });
        expect(frameSourceChanges).toEqual([
            { sessionId, shmName: `/${sessionId}-g1` },
        ]);
        // path.join output is host-specific; build the expectation the
        // same way so the spec passes on Windows checkouts too.
        expect(adapter.getFrameSource(sessionId)?.readerPath).toBe(
            path.join('/native', 'embedded_mpv_frame_reader.node')
        );
    });

    it('sends the session options as the first stdin line, never on argv', () => {
        adapter.createSession(
            Buffer.alloc(0),
            { x: 0, y: 0, width: 640, height: 360 },
            'Title',
            0.8,
            ['network-timeout=10', 'http-header-fields=X-Key: s%cr\tet']
        );
        const [, args] = spawnMock.mock.calls[0];
        expect(args).toContain('--mpv-options-stdin');
        expect(args.join(' ')).not.toContain('network-timeout');
        expect(args.join(' ')).not.toContain('X-Key');
        expect(child.stdin.written[0]).toBe(
            'mpv-options\to000=network-timeout=10\to001=http-header-fields=X-Key: s%25cr%09et\n'
        );
    });

    it('flips the cached snapshot to loading as soon as a load is sent', () => {
        const sessionId = createSession();
        child.emitStdout({
            event: 'snapshot',
            status: 'error',
            error: 'connection reset',
            positionSeconds: 0,
            durationSeconds: null,
            volume: 0.8,
            streamUrl: 'http://stream',
            audioTracks: [],
            selectedAudioTrackId: null,
            subtitleTracks: [],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: { active: false },
        });
        expect(adapter.getSessionSnapshot(sessionId)?.status).toBe('error');

        adapter.loadPlayback(sessionId, {
            streamUrl: 'http://stream',
            title: 'Live',
        });

        const snapshot = adapter.getSessionSnapshot(sessionId);
        expect(snapshot?.status).toBe('loading');
        expect(snapshot?.error).toBeUndefined();
        expect(snapshot?.streamUrl).toBe('http://stream');
    });

    it('refuses a load once the helper process has exited', () => {
        const sessionId = createSession();
        child.exitCode = 1;
        child.emit('exit', 1, null);
        expect(adapter.getSessionSnapshot(sessionId)?.status).toBe('error');

        expect(() =>
            adapter.loadPlayback(sessionId, {
                streamUrl: 'http://stream',
                title: 'Live',
            })
        ).toThrow(EmbeddedMpvSessionGoneError);
        expect(adapter.getSessionSnapshot(sessionId)?.status).toBe('error');
        expect(
            child.stdin.written.some((line) => line.startsWith('load\t'))
        ).toBe(false);
    });

    it('refuses a load once the helper died from a signal', () => {
        const sessionId = createSession();
        child.signalCode = 'SIGKILL';
        child.emit('exit', null, 'SIGKILL');
        expect(adapter.getSessionSnapshot(sessionId)?.status).toBe('error');

        expect(() =>
            adapter.loadPlayback(sessionId, {
                streamUrl: 'http://stream',
                title: 'Live',
            })
        ).toThrow(EmbeddedMpvSessionGoneError);
        expect(adapter.getSessionSnapshot(sessionId)?.status).toBe('error');
    });

    it('surfaces the helper warning for a session option libmpv rejected', () => {
        const sessionId = createSession();
        const warn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        try {
            child.emitStdout({
                event: 'log',
                level: 'warn',
                prefix: 'iptvnator',
                text: 'rejected session option nonexistent-option: option not found',
            });
            child.emitStdout({
                event: 'log',
                level: 'warn',
                prefix: 'ffmpeg/demuxer',
                text: 'mpegts: PES packet size mismatch',
            });

            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain(sessionId);
            expect(warn.mock.calls[0][0]).toContain(
                'rejected session option nonexistent-option'
            );
        } finally {
            warn.mockRestore();
        }
    });

    it('encodes loadfile options with percent-escaping', () => {
        const sessionId = createSession();
        adapter.loadPlayback(sessionId, {
            streamUrl: 'http://host/live.m3u8',
            title: 'Tab\there',
            userAgent: 'UA 1.0',
            startTime: 42,
            headers: { 'X-Token': 'abc' },
        });
        const line = child.stdin.written.at(-1) ?? '';
        expect(line.startsWith('load\turl=http://host/live.m3u8\t')).toBe(true);
        expect(line).toContain('opt.force-media-title=Tab%09here');
        expect(line).toContain('opt.user-agent=UA 1.0');
        expect(line).toContain('opt.start=42');
        expect(line).toContain('opt.http-header-fields=X-Token: abc');
    });

    it('sends the subtitle protocol commands over stdin', () => {
        const sessionId = createSession();

        adapter.addSubtitle(sessionId, '/subs/movie subs.srt');
        expect(child.stdin.written.at(-1)).toBe(
            'sub-add\tpath=/subs/movie subs.srt\n'
        );

        adapter.setSubtitleDelay(sessionId, 1.5);
        expect(child.stdin.written.at(-1)).toBe('sub-delay\tvalue=1.5\n');

        adapter.setSubtitleStyle(sessionId, {
            sizePercent: 150,
            color: '#ffe94f',
        });
        expect(child.stdin.written.slice(-2)).toEqual([
            'sub-scale\tvalue=1.5\n',
            'sub-color\tvalue=#ffe94f\n',
        ]);

        // A null color resets mpv's default so a previous pick cannot linger.
        adapter.setSubtitleStyle(sessionId, { sizePercent: 100, color: null });
        expect(child.stdin.written.slice(-2)).toEqual([
            'sub-scale\tvalue=1\n',
            'sub-color\tvalue=#FFFFFF\n',
        ]);
    });

    it('percent-escapes protocol-reserved characters in subtitle paths', () => {
        const sessionId = createSession();
        adapter.addSubtitle(sessionId, '/subs/tab\tname.srt');
        expect(child.stdin.written.at(-1)).toBe(
            'sub-add\tpath=/subs/tab%09name.srt\n'
        );
    });

    it('scales bounds and ignores hidden/degenerate bounds', () => {
        const sessionId = createSession();
        adapter.setBounds(sessionId, { x: 0, y: 0, width: 800, height: 450 });
        expect(child.stdin.written.at(-1)).toBe(
            'size\twidth=1600\theight=900\n'
        );
        const writesBefore = child.stdin.written.length;
        adapter.setBounds(sessionId, {
            x: -10000,
            y: -10000,
            width: 1,
            height: 1,
        });
        expect(child.stdin.written.length).toBe(writesBefore);
    });

    it('maps an unexpected helper exit to a session error', () => {
        const sessionId = createSession();
        child.exitCode = 1;
        child.emit('exit', 1, null);
        const snapshot = adapter.getSessionSnapshot(sessionId);
        expect(snapshot?.status).toBe('error');
        expect(snapshot?.error).toContain('exited unexpectedly');
    });

    it('disposes with quit and escalates to SIGTERM', () => {
        const sessionId = createSession();
        adapter.disposeSession(sessionId);
        expect(child.stdin.written.at(-1)).toBe('quit\n');
        expect(adapter.getSessionSnapshot(sessionId)).toBeNull();
        child.exitCode = null; // helper ignored quit
        jest.advanceTimersByTime(600);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('reports unsupported without a helper binary', () => {
        const { adapter: withoutHelper } = createFrameCopyAdapter(null);
        expect(withoutHelper.isSupported()).toBe(false);
    });

    describe('isSupported platform gate', () => {
        const originalPlatform = process.platform;
        const originalArch = process.arch;

        afterEach(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
            Object.defineProperty(process, 'arch', { value: originalArch });
        });

        it.each<[NodeJS.Platform, string, boolean]>([
            ['darwin', 'arm64', true],
            ['darwin', 'x64', false],
            ['linux', 'x64', true],
            ['linux', 'arm64', false],
            ['win32', 'x64', true],
            ['freebsd', 'x64', false],
        ])(
            'on %s/%s with a helper binary present -> %s',
            (platform, arch, expected) => {
                Object.defineProperty(process, 'platform', {
                    value: platform,
                });
                Object.defineProperty(process, 'arch', { value: arch });
                expect(adapter.isSupported()).toBe(expected);
            }
        );
    });
});
