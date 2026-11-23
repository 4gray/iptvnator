import { signal } from '@angular/core';
import { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvCommandRunner } from './embedded-mpv-command-runner';

const sessionSnapshot: EmbeddedMpvSession = {
    id: 'mpv-1', title: 'Example Movie', streamUrl: 'https://example.com/movie.mp4',
    status: 'playing', positionSeconds: 0, durationSeconds: 60, volume: 1,
    audioTracks: [], selectedAudioTrackId: null, subtitleTracks: [], selectedSubtitleTrackId: null,
    playbackSpeed: 1, aspectOverride: 'no', recording: { active: false },
    startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('EmbeddedMpvCommandRunner video fit IPC', () => {
    it.each(['original', 'crop', 'stretch'] as const)('forwards %s fit command for active session', async (mode) => {
        const setEmbeddedMpvVideoFit = jest.fn().mockResolvedValue(null);
        Object.defineProperty(window, 'electron', { configurable: true, value: { setEmbeddedMpvVideoFit } });
        const runner = new EmbeddedMpvCommandRunner({
            sessionId: signal('mpv-1'), session: signal(sessionSnapshot),
        });

        await runner.setVideoFit(mode);

        expect(setEmbeddedMpvVideoFit).toHaveBeenCalledWith('mpv-1', mode);
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('keeps Crop distinct from Original for native mpv property mapping', async () => {
        const setEmbeddedMpvVideoFit = jest.fn().mockResolvedValue(null);
        Object.defineProperty(window, 'electron', { configurable: true, value: { setEmbeddedMpvVideoFit } });
        const runner = new EmbeddedMpvCommandRunner({
            sessionId: signal('mpv-1'), session: signal(sessionSnapshot),
        });

        await runner.setVideoFit('original');
        await runner.setVideoFit('crop');

        expect(setEmbeddedMpvVideoFit.mock.calls).toEqual([
            ['mpv-1', 'original'],
            ['mpv-1', 'crop'],
        ]);
        const properties = (mode: 'original' | 'crop' | 'stretch') => ({
            keepaspect: mode !== 'stretch',
            panscan: mode === 'crop' ? 1 : 0,
        });
        expect(properties('crop')).not.toEqual(properties('original'));
        expect(properties('crop')).toEqual({ keepaspect: true, panscan: 1 });
        expect(properties('original')).toEqual({ keepaspect: true, panscan: 0 });
        expect(setEmbeddedMpvVideoFit.mock.calls[0][1]).not.toBe(setEmbeddedMpvVideoFit.mock.calls[1][1]);
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('swallows rejected fit IPC commands and leaves session snapshot unchanged', async () => {
        const setEmbeddedMpvVideoFit = jest.fn().mockRejectedValue(new Error('fit command failed'));
        Object.defineProperty(window, 'electron', { configurable: true, value: { setEmbeddedMpvVideoFit } });
        const session = signal(sessionSnapshot);
        const runner = new EmbeddedMpvCommandRunner({
            sessionId: signal('mpv-1'), session,
        });

        await expect(runner.setVideoFit('crop')).resolves.toBeUndefined();
        expect(session()).toBe(sessionSnapshot);
        delete (window as unknown as { electron?: unknown }).electron;
    });
});
