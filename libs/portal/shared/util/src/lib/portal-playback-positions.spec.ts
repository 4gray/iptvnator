import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
    newestPortalPlaybackPosition,
    PORTAL_WATCHED_PROGRESS_PERCENT,
} from './portal-playback-positions';

function row(
    positionSeconds: number,
    durationSeconds = 6000,
    updatedAt?: string
): PlaybackPositionData {
    return {
        contentXtreamId: positionSeconds,
        contentType: 'episode',
        positionSeconds,
        durationSeconds,
        updatedAt,
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

    it('picks the most recently updated row', () => {
        const older = row(100, 6000, '2026-10-03T08:00:00Z');
        const newer = row(200, 6000, '2026-10-04T08:00:00Z');
        const undated = row(300);

        expect(newestPortalPlaybackPosition([older, newer, undated])).toBe(
            newer
        );
        expect(newestPortalPlaybackPosition([undated, older])).toBe(older);
        expect(newestPortalPlaybackPosition([])).toBeNull();
    });
});
