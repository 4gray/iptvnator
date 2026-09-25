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
        item?: {
            uid?: string;
            xtreamId?: number;
            sourceType?: string;
            contentType?: string;
            stalkerId?: string;
        };
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

    it('returns null for M3U sources and missing positions', () => {
        expect(
            getRecentItemResumeNavigation(
                { ...recentSeries, source: 'm3u' },
                episodePosition()
            )
        ).toBeNull();
        expect(getRecentItemResumeNavigation(recentSeries, null)).toBeNull();
    });

    it('resumes a Stalker embedded-VOD show that routes as a movie', () => {
        // The stored row lives in the VOD catalog (`type: 'movie'` keeps it
        // routing there) but tracks per-episode progress under its parent id.
        const stalkerShow: PortalRecentItem = {
            id: '17572',
            title: 'Fake (10 episodes)',
            type: 'movie',
            watch_kind: 'series',
            source: 'stalker',
            playlist_id: 'stalker-R',
            category_id: '7',
            xtream_id: '17572',
            viewed_at: '2026-09-19T16:13:50.000Z',
            stalker_item: { id: '17572', series: [1, 2, 3] } as never,
        };
        const navigation = getRecentItemResumeNavigation(
            stalkerShow,
            episodePosition({
                playlistId: 'stalker-R',
                seriesXtreamId: 17572,
                contentXtreamId: 1750797722,
                seasonNumber: 1,
                episodeNumber: 5,
            })
        );

        expect(navigation?.link).toEqual(['/workspace', 'global-recent']);
        const state = navigation?.state as RecentNavigationState;
        expect(state.openCollectionDetailItem?.item).toEqual(
            expect.objectContaining({
                sourceType: 'stalker',
                contentType: 'movie',
                stalkerId: '17572',
            })
        );
        expect(state.openCollectionDetailItem?.seriesResume).toEqual({
            seriesXtreamId: 17572,
            contentXtreamId: 1750797722,
            seasonNumber: 1,
            episodeNumber: 5,
        });

        // Without the watch kind the same row is a plain movie: no handoff.
        expect(
            getRecentItemResumeNavigation(
                { ...stalkerShow, watch_kind: undefined },
                episodePosition({ seriesXtreamId: 17572 })
            )
        ).toBeNull();
    });
});
