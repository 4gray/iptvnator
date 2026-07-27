import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { buildUpNextRailItems } from './up-next-rail.util';

interface TestEpisode {
    id: string;
    episode_num: number;
    season: number;
    title?: string;
    info?: { movie_image?: string } | unknown[];
}

function episode(
    id: number,
    season: number,
    episodeNum: number,
    overrides: Partial<TestEpisode> = {}
): TestEpisode {
    return {
        id: String(id),
        episode_num: episodeNum,
        season,
        title: `Episode ${episodeNum}`,
        ...overrides,
    };
}

function position(
    contentXtreamId: number,
    positionSeconds: number,
    durationSeconds: number
): PlaybackPositionData {
    return {
        playlistId: 'playlist-1',
        contentXtreamId,
        contentType: 'episode',
        positionSeconds,
        durationSeconds,
    };
}

const EPISODES_BY_SEASON = {
    '1': [episode(11, 1, 1), episode(12, 1, 2), episode(13, 1, 3)],
    '2': [episode(21, 2, 1), episode(22, 2, 2)],
};

describe('buildUpNextRailItems', () => {
    it('starts at the playing episode and spills over into the next season', () => {
        const items = buildUpNextRailItems({
            episodesBySeason: EPISODES_BY_SEASON,
            currentEpisodeId: 12,
        });

        expect(items.map((item) => item.id)).toEqual([12, 13, 21, 22]);
        expect(items.map((item) => item.label)).toEqual([
            'S01E02',
            'S01E03',
            'S02E01',
            'S02E02',
        ]);
        expect(items[0].isPlaying).toBe(true);
        expect(items.slice(1).every((item) => !item.isPlaying)).toBe(true);
    });

    it('orders numeric season keys numerically, not lexicographically', () => {
        const items = buildUpNextRailItems({
            episodesBySeason: {
                '10': [episode(101, 10, 1)],
                '2': [episode(21, 2, 1)],
                '1': [episode(11, 1, 1)],
            },
            currentEpisodeId: 11,
        });

        expect(items.map((item) => item.id)).toEqual([11, 21, 101]);
    });

    it('returns an empty list when the playing episode is not in the seasons', () => {
        expect(
            buildUpNextRailItems({
                episodesBySeason: EPISODES_BY_SEASON,
                currentEpisodeId: 999,
            })
        ).toEqual([]);
    });

    it('returns an empty list without seasons or a current episode', () => {
        expect(
            buildUpNextRailItems({
                episodesBySeason: null,
                currentEpisodeId: 12,
            })
        ).toEqual([]);
        expect(
            buildUpNextRailItems({
                episodesBySeason: EPISODES_BY_SEASON,
                currentEpisodeId: null,
            })
        ).toEqual([]);
    });

    it('caps the list at the given limit', () => {
        const items = buildUpNextRailItems({
            episodesBySeason: EPISODES_BY_SEASON,
            currentEpisodeId: 11,
            limit: 2,
        });

        expect(items.map((item) => item.id)).toEqual([11, 12]);
    });

    it('maps watch progress from playback positions and null when unstarted', () => {
        const positions = new Map<number, PlaybackPositionData>([
            [12, position(12, 600, 1200)],
        ]);

        const items = buildUpNextRailItems({
            episodesBySeason: EPISODES_BY_SEASON,
            currentEpisodeId: 12,
            playbackPositions: positions,
        });

        expect(items[0].progressPercent).toBe(50);
        expect(items[1].progressPercent).toBeNull();
    });

    it('uses http(s) episode thumbnails and rejects other schemes', () => {
        const items = buildUpNextRailItems({
            episodesBySeason: {
                '1': [
                    episode(11, 1, 1, {
                        info: { movie_image: 'https://cdn.example.com/a.jpg' },
                    }),
                    episode(12, 1, 2, {
                        info: { movie_image: 'javascript:alert(1)' },
                    }),
                    episode(13, 1, 3, { info: [] }),
                ],
            },
            currentEpisodeId: 11,
        });

        expect(items[0].thumbnailUrl).toBe('https://cdn.example.com/a.jpg');
        expect(items[1].thumbnailUrl).toBeNull();
        expect(items[2].thumbnailUrl).toBeNull();
    });

    it('carries the raw episode object through for host playback', () => {
        const items = buildUpNextRailItems({
            episodesBySeason: EPISODES_BY_SEASON,
            currentEpisodeId: 13,
        });

        expect(items[1].episode).toBe(EPISODES_BY_SEASON['2'][0]);
    });
});
