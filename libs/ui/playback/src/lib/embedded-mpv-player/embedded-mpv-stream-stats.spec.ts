import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { toPlayerStreamStats } from './embedded-mpv-stream-stats';

function createSession(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: 'Channel',
        streamUrl: 'http://example.test/stream.ts',
        status: 'playing',
        positionSeconds: 12,
        durationSeconds: null,
        volume: 1,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:10.000Z',
        ...overrides,
    };
}

describe('toPlayerStreamStats', () => {
    it('maps mpv properties onto the shared stats shape', () => {
        const stats = toPlayerStreamStats(
            createSession({
                videoWidth: 1920,
                videoHeight: 1080,
                stats: {
                    fps: 50.04,
                    videoBitrateBps: 6_200_000,
                    audioBitrateBps: 192_000,
                    videoCodec: 'h264',
                    audioCodec: 'aac',
                    audioChannels: '5.1',
                    audioSampleRateHz: 48_000,
                    container: 'mpegts',
                    bufferedAheadSeconds: 18.5,
                    droppedFrames: 3,
                },
            })
        );

        expect(stats).toEqual({
            width: 1920,
            height: 1080,
            fps: 50.04,
            videoBitrateBps: 6_200_000,
            audioBitrateBps: 192_000,
            videoCodec: 'h264',
            audioCodec: 'aac',
            audioChannels: '5.1',
            audioSampleRateHz: 48_000,
            container: 'mpegts',
            bufferedAheadSeconds: 18.5,
            droppedFrames: 3,
            // mpv counts drops but never presented frames.
            totalFrames: null,
        });
    });

    it('keeps the size rows when only dwidth/dheight are known', () => {
        const stats = toPlayerStreamStats(
            createSession({ videoWidth: 1280, videoHeight: 720 })
        );

        expect(stats).toEqual(
            expect.objectContaining({
                width: 1280,
                height: 720,
                fps: null,
                videoCodec: null,
            })
        );
    });

    it('returns null when the engine reported nothing usable', () => {
        expect(toPlayerStreamStats(createSession())).toBeNull();
        expect(toPlayerStreamStats(createSession({ stats: {} }))).toBeNull();
        expect(toPlayerStreamStats(null)).toBeNull();
    });

    it('drops blank codec strings instead of rendering empty rows', () => {
        const stats = toPlayerStreamStats(
            createSession({
                stats: { videoCodec: '   ', audioCodec: 'aac' },
            })
        );

        expect(stats).toEqual(
            expect.objectContaining({ videoCodec: null, audioCodec: 'aac' })
        );
    });

    it('keeps a zero drop counter — it is a real measurement', () => {
        const stats = toPlayerStreamStats(
            createSession({ stats: { droppedFrames: 0 } })
        );

        expect(stats?.droppedFrames).toBe(0);
    });
});
