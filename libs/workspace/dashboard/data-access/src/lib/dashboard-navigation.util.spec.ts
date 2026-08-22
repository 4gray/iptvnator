import type {
    PlaybackPositionData,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    getRecentItemDetailNavigationState,
    getRecentItemNavigationState,
    getRecentItemResumeNavigation,
} from './dashboard-navigation.util';

const recentSeries: PortalRecentItem = {
    id: 200,
    title: 'Shadow Bay',
    type: 'series',
    source: 'xtream',
    playlist_id: 'xtream-C',
    category_id: 30,
    xtream_id: 4000,
    viewed_at: '2026-05-01T09:00:00.000Z',
};

function episodePosition(
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId: 4007,
        contentType: 'episode',
        seriesXtreamId: 4000,
        seasonNumber: 3,
        episodeNumber: 7,
        positionSeconds: 540,
        durationSeconds: 1800,
        playlistId: 'xtream-C',
        ...overrides,
    };
}

type RecentNavigationState = {
    openCollectionDetailItem?: {
        item?: { uid?: string; xtreamId?: number };
        seriesResume?: unknown;
    };
};

describe('getRecentItemNavigationState series resume target', () => {
    it('forwards an in-progress episode as the resume target', () => {
        const state = getRecentItemNavigationState(
            recentSeries,
            episodePosition()
        ) as RecentNavigationState;

        expect(state.openCollectionDetailItem?.seriesResume).toEqual({
            seriesXtreamId: 4000,
            contentXtreamId: 4007,
            seasonNumber: 3,
            episodeNumber: 7,
        });
    });

    it('keeps watched rows out of resume selection', () => {
        // A watched row (natural finish or a manual/bulk "mark watched") is a
        // completion marker, not resumable progress — auto-playing it would
        // start the episode at its end. The handoff stays detail-only.
        const state = getRecentItemNavigationState(
            recentSeries,
            episodePosition({ positionSeconds: 1800 })
        ) as RecentNavigationState;

        expect(state.openCollectionDetailItem?.seriesResume).toBeUndefined();
        expect(state.openCollectionDetailItem?.item).toBeDefined();
    });
});

describe('getRecentItemDetailNavigationState', () => {
    it('never carries a resume target, even for an in-progress series', () => {
        // Continue Watching default click is detail-only (issue #1441) —
        // resuming is an explicit card action instead.
        const state = getRecentItemDetailNavigationState(
            recentSeries,
            episodePosition()
        ) as RecentNavigationState;

        expect(state.openCollectionDetailItem?.seriesResume).toBeUndefined();
        expect(state.openCollectionDetailItem?.item).toBeDefined();
    });

    it('still rewrites an episode-keyed row to the parent series identity', () => {
        // Legacy recent rows can carry the EPISODE id in xtream_id; the
        // position names the parent series, and the detail must target it
        // even without the resume handoff — including for watched rows.
        const state = getRecentItemDetailNavigationState(
            { ...recentSeries, xtream_id: 4007 },
            episodePosition({ positionSeconds: 1800 })
        ) as RecentNavigationState;

        expect(state.openCollectionDetailItem?.item?.xtreamId).toBe(4000);
        expect(state.openCollectionDetailItem?.seriesResume).toBeUndefined();
    });
});

describe('getRecentItemResumeNavigation', () => {
    it('builds a full navigation target for an in-progress episode', () => {
        const navigation = getRecentItemResumeNavigation(
            recentSeries,
            episodePosition()
        );

        expect(navigation?.link).toEqual(['/workspace', 'global-recent']);
        const state = navigation?.state as RecentNavigationState;
        expect(state.openCollectionDetailItem?.seriesResume).toEqual({
            seriesXtreamId: 4000,
            contentXtreamId: 4007,
            seasonNumber: 3,
            episodeNumber: 7,
        });
    });

    it('returns null for watched rows', () => {
        expect(
            getRecentItemResumeNavigation(
                recentSeries,
                episodePosition({ positionSeconds: 1800 })
            )
        ).toBeNull();
    });

    it('returns null for non-Xtream sources and missing positions', () => {
        expect(
            getRecentItemResumeNavigation(
                { ...recentSeries, source: 'stalker' },
                episodePosition()
            )
        ).toBeNull();
        expect(getRecentItemResumeNavigation(recentSeries, null)).toBeNull();
    });
});
