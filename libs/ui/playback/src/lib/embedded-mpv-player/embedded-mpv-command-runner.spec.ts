import { signal } from '@angular/core';
import { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvCommandRunner } from './embedded-mpv-command-runner';

function createSession(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'mpv-1',
        title: 'Example Movie',
        streamUrl: 'https://example.com/movie.mp4',
        status: 'playing',
        positionSeconds: 10,
        durationSeconds: 120,
        volume: 0.7,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: { active: false },
        startedAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:01.000Z',
        ...overrides,
    };
}

describe('EmbeddedMpvCommandRunner', () => {
    const sessionId = signal<string | null>('mpv-1');
    const session = signal<EmbeddedMpvSession | null>(createSession());
    let runner: EmbeddedMpvCommandRunner;
    let electron: Record<string, jest.Mock>;

    const setBridge = (value: unknown) =>
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value,
        });

    beforeEach(() => {
        sessionId.set('mpv-1');
        session.set(createSession());
        electron = {
            setEmbeddedMpvPaused: jest
                .fn()
                .mockResolvedValue(createSession({ status: 'paused' })),
            seekEmbeddedMpv: jest
                .fn()
                .mockResolvedValue(createSession({ positionSeconds: 42 })),
            setEmbeddedMpvVolume: jest
                .fn()
                .mockResolvedValue(createSession({ volume: 0.3 })),
            setEmbeddedMpvAudioTrack: jest.fn().mockResolvedValue(null),
            setEmbeddedMpvSubtitleTrack: jest.fn().mockResolvedValue(null),
            setEmbeddedMpvSpeed: jest
                .fn()
                .mockResolvedValue(createSession({ playbackSpeed: 1.5 })),
            setEmbeddedMpvAspect: jest
                .fn()
                .mockResolvedValue(createSession({ aspectOverride: '16:9' })),
            startEmbeddedMpvRecording: jest.fn().mockResolvedValue(
                createSession({
                    recording: { active: true, targetPath: '/tmp/rec.ts' },
                })
            ),
            stopEmbeddedMpvRecording: jest.fn().mockResolvedValue(
                createSession({
                    recording: { active: false, targetPath: '/tmp/rec.ts' },
                })
            ),
            getEmbeddedMpvDefaultRecordingFolder: jest
                .fn()
                .mockResolvedValue('/movies/recordings'),
        };
        setBridge(electron);
        runner = new EmbeddedMpvCommandRunner({ sessionId, session });
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('togglePaused flips based on the current status and reconciles the snapshot', async () => {
        await runner.togglePaused();
        expect(electron.setEmbeddedMpvPaused).toHaveBeenCalledWith(
            'mpv-1',
            true
        );
        expect(session()?.status).toBe('paused');

        await runner.togglePaused();
        // Now paused → resume.
        expect(electron.setEmbeddedMpvPaused).toHaveBeenLastCalledWith(
            'mpv-1',
            false
        );
    });

    it('guards commands when no session id is set', async () => {
        sessionId.set(null);
        await runner.togglePaused();
        expect(await runner.seekBy(10)).toBe(false);
        await runner.seekTo(5);
        await runner.applyVolume(0.5);
        await runner.setSpeed(2);
        expect(await runner.startRecording(undefined, 'Title')).toBeNull();
        expect(await runner.stopRecording()).toBeNull();
        expect(electron.setEmbeddedMpvPaused).not.toHaveBeenCalled();
        expect(electron.seekEmbeddedMpv).not.toHaveBeenCalled();
    });

    it('guards session-dependent commands when the session snapshot is missing', async () => {
        session.set(null);
        await runner.togglePaused();
        expect(await runner.seekBy(10)).toBe(false);
        expect(electron.setEmbeddedMpvPaused).not.toHaveBeenCalled();
        expect(electron.seekEmbeddedMpv).not.toHaveBeenCalled();
    });

    it('guards every command when the bridge method is unavailable', async () => {
        setBridge({});
        await runner.togglePaused();
        expect(await runner.seekBy(5)).toBe(false);
        await runner.seekTo(5);
        await runner.applyVolume(0.4);
        await runner.setAudioTrack(1);
        await runner.setSubtitleTrack(2);
        await runner.setSpeed(1.25);
        await runner.setAspect('4:3');
        expect(await runner.startRecording('/tmp', 'Title')).toBeNull();
        expect(await runner.stopRecording()).toBeNull();
        expect(session()?.status).toBe('playing');
    });

    it('seekTo seeks to an absolute position and reconciles the snapshot', async () => {
        await runner.seekTo(42);
        expect(electron.seekEmbeddedMpv).toHaveBeenCalledWith('mpv-1', 42);
        expect(session()?.positionSeconds).toBe(42);
    });

    it('seekBy clamps to zero and reports that it ran', async () => {
        expect(await runner.seekBy(-999)).toBe(true);
        expect(electron.seekEmbeddedMpv).toHaveBeenCalledWith('mpv-1', 0);
        expect(session()?.positionSeconds).toBe(42);
    });

    it('delegates track/speed/aspect commands and keeps state on null snapshots', async () => {
        const before = session();
        await runner.setAudioTrack(3);
        await runner.setSubtitleTrack(-1);
        expect(electron.setEmbeddedMpvAudioTrack).toHaveBeenCalledWith(
            'mpv-1',
            3
        );
        expect(electron.setEmbeddedMpvSubtitleTrack).toHaveBeenCalledWith(
            'mpv-1',
            -1
        );
        // Null snapshots must not clear the current session.
        expect(session()).toBe(before);

        await runner.setSpeed(1.5);
        expect(session()?.playbackSpeed).toBe(1.5);
        await runner.setAspect('16:9');
        expect(session()?.aspectOverride).toBe('16:9');
    });

    it('swallows IPC errors and leaves the session untouched', async () => {
        const current = session();
        electron.seekEmbeddedMpv.mockRejectedValueOnce(
            new Error('session disposed')
        );
        expect(await runner.seekBy(10)).toBe(true);
        expect(session()).toBe(current);

        electron.setEmbeddedMpvVolume.mockRejectedValueOnce(
            new Error('gone')
        );
        await expect(runner.applyVolume(0.2)).resolves.toBeUndefined();
        expect(session()).toBe(current);
    });

    it('startRecording resolves the default folder for blank directories', async () => {
        const recording = await runner.startRecording('   ', 'My Show');
        expect(
            electron.getEmbeddedMpvDefaultRecordingFolder
        ).toHaveBeenCalled();
        expect(electron.startEmbeddedMpvRecording).toHaveBeenCalledWith(
            'mpv-1',
            { directory: '/movies/recordings', title: 'My Show' }
        );
        expect(recording).toEqual({ active: true, targetPath: '/tmp/rec.ts' });
        expect(session()?.recording?.active).toBe(true);
    });

    it('startRecording uses the explicit directory when provided', async () => {
        await runner.startRecording('/custom/dir', 'My Show');
        expect(
            electron.getEmbeddedMpvDefaultRecordingFolder
        ).not.toHaveBeenCalled();
        expect(electron.startEmbeddedMpvRecording).toHaveBeenCalledWith(
            'mpv-1',
            { directory: '/custom/dir', title: 'My Show' }
        );
    });

    it('startRecording returns null when the IPC call fails', async () => {
        electron.startEmbeddedMpvRecording.mockRejectedValueOnce(
            new Error('no disk')
        );
        expect(await runner.startRecording('/custom', 'Title')).toBeNull();
    });

    it('stopRecording returns the reconciled recording state', async () => {
        const recording = await runner.stopRecording();
        expect(electron.stopEmbeddedMpvRecording).toHaveBeenCalledWith(
            'mpv-1'
        );
        expect(recording).toEqual({ active: false, targetPath: '/tmp/rec.ts' });
        expect(session()?.recording).toEqual(recording);
    });
});
