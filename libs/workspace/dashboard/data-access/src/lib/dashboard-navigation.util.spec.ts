import type {
    PlaybackPositionData,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import { getRecentItemNavigationState } from './dashboard-navigation.util';

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
        item?: unknown;
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
