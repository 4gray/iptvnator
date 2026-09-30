import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { embeddedMpvTimelineSegments } from './embedded-mpv-chapter-segments';

function session(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: 'Episode',
        streamUrl: 'https://example.test/episode.mkv',
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: 1500,
        volume: 1,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        startedAt: '2026-09-30T10:00:00Z',
        updatedAt: '2026-09-30T10:00:00Z',
        chapters: [
            { timeSeconds: 0, title: 'Opening' },
            { timeSeconds: 1410, title: 'Ending' },
        ],
        ...overrides,
    };
}

describe('embeddedMpvTimelineSegments', () => {
    it('maps mpv chapters when the host passes no segments', () => {
        const expected = [
            { startSeconds: 0, endSeconds: 1410, title: 'Opening' },
            { startSeconds: 1410, endSeconds: 1500, title: 'Ending' },
        ];
        expect(embeddedMpvTimelineSegments(null, session())).toEqual(expected);
        expect(embeddedMpvTimelineSegments([], session())).toEqual(expected);
    });

    it('keeps catch-up programmes ahead of file chapters', () => {
        const catchup = [{ startSeconds: 0, endSeconds: 1800, title: 'News' }];
        expect(embeddedMpvTimelineSegments(catchup, session())).toBe(catchup);
    });

    it('draws nothing without chapters or a known duration', () => {
        expect(embeddedMpvTimelineSegments(null, null)).toBeNull();
        expect(
            embeddedMpvTimelineSegments(null, session({ chapters: undefined }))
        ).toBeNull();
        expect(
            embeddedMpvTimelineSegments(
                null,
                session({ durationSeconds: null })
            )
        ).toBeNull();
    });
});
