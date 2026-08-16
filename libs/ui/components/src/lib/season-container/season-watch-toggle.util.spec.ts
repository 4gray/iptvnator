import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    buildSeasonWatchToggleRequest,
    buildSeriesWatchToggleRequest,
} from './season-watch-toggle.util';

// The Stalker-style '45 min' format parses to 2700 seconds.
const PARSED_DURATION = 2700;

function createEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Pilot',
        container_extension: 'mp4',
        info: { duration: '45 min' },
        custom_sid: '',
        added: '',
        season: 0,
        direct_source: '',
        ...overrides,
    } as XtreamSerieEpisode;
}

const watchedIds = (ids: number[]) => {
    const set = new Set(ids);
    return (episode: XtreamSerieEpisode) => set.has(Number(episode.id));
};

describe('buildSeriesWatchToggleRequest', () => {
    const twoSeasons = (): Record<string, XtreamSerieEpisode[]> => ({
        '1': [
            createEpisode({ id: '101', episode_num: 1 }),
            createEpisode({ id: '102', episode_num: 2 }),
        ],
        '2': [
            createEpisode({ id: '201', episode_num: 1 }),
            createEpisode({ id: '202', episode_num: 2 }),
        ],
    });

    it('marks unwatched episodes across every season with per-season numbers', () => {
        const request = buildSeriesWatchToggleRequest({
            seasons: twoSeasons(),
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([101]),
        });

        expect(request?.markWatched).toBe(true);
        expect(request?.requests.map((item) => item.contentXtreamId)).toEqual([
            102, 201, 202,
        ]);
        // Episodes without their own season fall back to the KEY of the
        // season they came from, not one shared fallback.
        expect(
            request?.requests.map((item) => item.nextPosition?.seasonNumber)
        ).toEqual([1, 2, 2]);
        expect(request?.requests[0].nextPosition).toEqual(
            expect.objectContaining({
                contentXtreamId: 102,
                contentType: 'episode',
                seriesXtreamId: 20,
                episodeNumber: 2,
                positionSeconds: PARSED_DURATION,
                durationSeconds: PARSED_DURATION,
                playlistId: 'playlist-1',
            })
        );
    });

    it('skips excluded episodes when marking', () => {
        const request = buildSeriesWatchToggleRequest({
            seasons: twoSeasons(),
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([]),
            excludedEpisodeIds: new Set([201]),
        });

        expect(request?.requests.map((item) => item.contentXtreamId)).toEqual([
            101, 102, 202,
        ]);
    });

    it('clears every episode of every season on unwatch, exclusions ignored', () => {
        const request = buildSeriesWatchToggleRequest({
            seasons: twoSeasons(),
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([101, 102, 201, 202]),
            excludedEpisodeIds: new Set([101]),
        });

        expect(request?.markWatched).toBe(false);
        expect(request?.requests).toEqual([
            { contentXtreamId: 101, nextPosition: null },
            { contentXtreamId: 102, nextPosition: null },
            { contentXtreamId: 201, nextPosition: null },
            { contentXtreamId: 202, nextPosition: null },
        ]);
    });

    it('returns null when there is nothing to touch', () => {
        expect(
            buildSeriesWatchToggleRequest({
                seasons: {},
                seriesId: 20,
                playlistId: 'playlist-1',
                isEpisodeWatched: watchedIds([]),
            })
        ).toBeNull();
        expect(
            buildSeriesWatchToggleRequest({
                seasons: { '1': [] },
                seriesId: 20,
                playlistId: 'playlist-1',
                isEpisodeWatched: watchedIds([]),
            })
        ).toBeNull();
    });

    it('honors a forced mark direction over inference', () => {
        // Everything watched: inference would unwatch, the forced direction
        // (what the label advertised) yields no targets instead.
        const request = buildSeriesWatchToggleRequest({
            seasons: twoSeasons(),
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([101, 102, 201, 202]),
            markWatched: true,
        });

        expect(request).toBeNull();
    });

    it('honors a forced unwatch direction and still clears all episodes', () => {
        const request = buildSeriesWatchToggleRequest({
            seasons: twoSeasons(),
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([101]),
            markWatched: false,
        });

        expect(request?.markWatched).toBe(false);
        expect(request?.requests).toHaveLength(4);
        expect(
            request?.requests.every((item) => item.nextPosition === null)
        ).toBe(true);
    });
});

describe('buildSeasonWatchToggleRequest', () => {
    it('returns null for an empty season', () => {
        expect(
            buildSeasonWatchToggleRequest({
                episodes: [],
                seasonKey: '1',
                seriesId: 20,
                playlistId: 'playlist-1',
                isEpisodeWatched: watchedIds([]),
            })
        ).toBeNull();
    });

    it('falls back to a one-second duration when nothing parses', () => {
        const request = buildSeasonWatchToggleRequest({
            episodes: [createEpisode({ id: '101', info: undefined })],
            seasonKey: '3',
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([]),
        });

        expect(request?.requests[0].nextPosition).toEqual(
            expect.objectContaining({
                positionSeconds: 1,
                durationSeconds: 1,
                seasonNumber: 3,
            })
        );
    });

    it('keeps an episode-level season over the fallback key', () => {
        const request = buildSeasonWatchToggleRequest({
            episodes: [createEpisode({ id: '101', season: 5 })],
            seasonKey: '3',
            seriesId: 20,
            playlistId: 'playlist-1',
            isEpisodeWatched: watchedIds([]),
        });

        expect(request?.requests[0].nextPosition?.seasonNumber).toBe(5);
    });
});
