import { EventEmitter } from 'events';
import path from 'path';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { EmbeddedMpvFrameCopyAdapter } from './embedded-mpv-frame-copy.adapter';

class FakeHelperProcess extends EventEmitter {
    exitCode: number | null = null;
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    readonly stdin = {
        writable: true,
        written: [] as string[],
        write(line: string) {
            this.written.push(line);
            return true;
        },
    };
    readonly kill = jest.fn((signal?: string) => {
        this.exitCode = 0;
        this.emit('exit', 0, signal ?? null);
        return true;
    });

    emitStdout(payload: object): void {
        this.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`));
    }
}

describe('EmbeddedMpvFrameCopyAdapter', () => {
    let child: FakeHelperProcess;
    let frameSourceChanges: Array<{ sessionId: string; shmName: string }>;
    let adapter: EmbeddedMpvFrameCopyAdapter;

    const createAdapter = (helperPath: string | null = '/native/helper') => {
        frameSourceChanges = [];
        return new EmbeddedMpvFrameCopyAdapter({
            resolveHelperPath: () => helperPath,
            getScaleFactor: () => 2,
            onFrameSourceChanged: (sessionId, source) =>
                frameSourceChanges.push({ sessionId, shmName: source.shmName }),
        });
    };

    beforeEach(() => {
        jest.useFakeTimers();
        child = new FakeHelperProcess();
        spawnMock.mockReset();
        spawnMock.mockReturnValue(child);
        adapter = createAdapter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const createSession = () =>
        adapter.createSession(
            Buffer.alloc(0),
            { x: 0, y: 0, width: 640, height: 360 },
            'Title',
            0.8
        );

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
        ]);
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
        const withoutHelper = createAdapter(null);
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
