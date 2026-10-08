import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
    PORTAL_WATCHED_PROGRESS_PERCENT,
    stampPlaybackPositionNow,
} from './portal-playback-positions';

function row(
    positionSeconds: number,
    durationSeconds = 6000
): PlaybackPositionData {
    return {
        contentXtreamId: positionSeconds,
        contentType: 'episode',
        positionSeconds,
        durationSeconds,
    };
}

describe('portal playback positions', () => {
    it('counts a title as watched once only the credits are left', () => {
        expect(PORTAL_WATCHED_PROGRESS_PERCENT).toBe(90);
        // 61 s of a 59-minute episode left: the end credits.
        expect(isPortalPlaybackWatched(row(3491, 3552))).toBe(true);
        expect(isPortalPlaybackWatched(row(5400))).toBe(true);
        expect(isPortalPlaybackWatched(row(5340))).toBe(false);
        expect(isPortalPlaybackWatched(row(5400, 0))).toBe(false);
        expect(isPortalPlaybackWatched(null)).toBe(false);
    });

    it('treats progress below the watched threshold as resumable', () => {
        expect(isPortalPlaybackInProgress(row(5340))).toBe(true);
        expect(isPortalPlaybackInProgress(row(5400))).toBe(false);
        // A few seconds in is not worth resuming.
        expect(isPortalPlaybackInProgress(row(5))).toBe(false);
    });

    it('dates a row a page writes itself, and leaves a dated row alone', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-08T09:00:00Z'));
        try {
            const tick = row(600);
            expect(stampPlaybackPositionNow(tick)).toEqual({
                ...tick,
                updatedAt: '2026-10-08T09:00:00.000Z',
            });
            // The caller's row is not modified.
            expect(tick.updatedAt).toBeUndefined();

            const stored = { ...row(600), updatedAt: '2026-10-03 08:00:00' };
            expect(stampPlaybackPositionNow(stored)).toBe(stored);
        } finally {
            jest.useRealTimers();
        }
    });
});
