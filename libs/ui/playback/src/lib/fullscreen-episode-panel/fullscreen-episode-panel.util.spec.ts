import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    buildFullscreenEpisodePanelSeasons,
    formatEpisodeDuration,
    sortSeasonKeys,
} from './fullscreen-episode-panel.util';

function episode(
    id: number,
    season: number,
    episodeNum: number,
    info: Record<string, unknown> | [] = {}
) {
    return {
        id: String(id),
        season,
        episode_num: episodeNum,
        title: `Episode ${episodeNum}`,
        info,
    };
}

function position(
    contentXtreamId: number,
    positionSeconds: number,
    durationSeconds = 100
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        positionSeconds,
        durationSeconds,
    };
}

describe('buildFullscreenEpisodePanelSeasons', () => {
    it('returns nothing without seasons', () => {
        expect(
            buildFullscreenEpisodePanelSeasons({
                episodesBySeason: null,
                currentEpisodeId: 1,
            })
        ).toEqual([]);
    });

    it('orders seasons numerically, keeps every season and marks the playing row', () => {
        const seasons = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: {
                '10': [episode(31, 10, 1)],
                '2': [episode(21, 2, 1), episode(22, 2, 2)],
                '1': [episode(11, 1, 1)],
            },
            currentEpisodeId: '22',
        });

        expect(seasons.map((season) => season.key)).toEqual(['1', '2', '10']);
        expect(seasons.every((season) => season.loadState === 'loaded')).toBe(
            true
        );
        const playing = seasons[1].episodes[1];
        expect(playing.isPlaying).toBe(true);
        expect(playing.label).toBe('S02E02');
        expect(playing.seasonKey).toBe('2');
        expect(playing.episodeNumber).toBe(2);
        expect(
            seasons
                .flatMap((season) => season.episodes)
                .filter((e) => e.isPlaying)
        ).toHaveLength(1);
    });

    it('marks no row when nothing plays, so the tab falls back to the first season', () => {
        const seasons = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: { '1': [episode(11, 1, 1)] },
            currentEpisodeId: null,
        });
        expect(seasons[0].episodes[0].isPlaying).toBe(false);
    });

    it('reads still, overview and runtime off the (TMDB-overlaid) info', () => {
        const [season] = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: {
                '1': [
                    episode(11, 1, 1, {
                        movie_image: 'https://img.test/still.jpg',
                        plot: '  A rescue signal.  ',
                        duration_secs: 2700,
                    }),
                    // No metadata at all: the provider sends `[]`.
                    episode(12, 1, 2, []),
                    // A non-http image never becomes a still.
                    episode(13, 1, 3, {
                        movie_image: 'file:///poster.jpg',
                        duration: '1h 30min',
                    }),
                ],
            },
            currentEpisodeId: 11,
        });

        expect(season.episodes[0]).toEqual(
            expect.objectContaining({
                thumbnailUrl: 'https://img.test/still.jpg',
                overview: 'A rescue signal.',
                durationLabel: '45 min',
            })
        );
        expect(season.episodes[1]).toEqual(
            expect.objectContaining({
                thumbnailUrl: null,
                overview: '',
                durationLabel: null,
            })
        );
        expect(season.episodes[2]).toEqual(
            expect.objectContaining({
                thumbnailUrl: null,
                durationLabel: '90 min',
            })
        );
    });

    it('derives progress and the watched flag from playback positions', () => {
        const positions = new Map<number, PlaybackPositionData>([
            [11, position(11, 40)],
            [12, position(12, 95)],
        ]);
        const [season] = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: {
                '1': [episode(11, 1, 1), episode(12, 1, 2), episode(13, 1, 3)],
            },
            currentEpisodeId: 13,
            playbackPositions: positions,
        });

        expect(season.episodes[0]).toEqual(
            expect.objectContaining({ progressPercent: 40, watched: false })
        );
        expect(season.episodes[1]).toEqual(
            expect.objectContaining({ progressPercent: 95, watched: true })
        );
        expect(season.episodes[2]).toEqual(
            expect.objectContaining({ progressPercent: null, watched: false })
        );
    });

    it('carries the host\u2019s in-flight and unanswered season states, defaulting to loaded', () => {
        const seasons = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: { '1': [episode(11, 1, 1)], '2': [], '3': [] },
            currentEpisodeId: 11,
            seasonLoadStates: { '2': 'loading', '3': 'unloaded' },
        });

        expect(seasons.map((season) => season.loadState)).toEqual([
            'loaded',
            'loading',
            'unloaded',
        ]);
        expect(seasons[1]).toEqual({
            key: '2',
            loadState: 'loading',
            episodes: [],
        });
    });

    it('carries the host’s season poster only for seasons that have one', () => {
        const seasons = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: { '1': [episode(11, 1, 1)], '2': [] },
            currentEpisodeId: 11,
            seasonPosters: { '1': 'https://img.test/season-1.jpg' },
        });

        expect(seasons[0].posterUrl).toBe('https://img.test/season-1.jpg');
        expect('posterUrl' in seasons[1]).toBe(false);
    });

    it('falls back to the season key and the list index when an episode carries no numbers', () => {
        const [season] = buildFullscreenEpisodePanelSeasons({
            episodesBySeason: {
                '3': [{ id: 5, title: 'Pilot' }, { id: 6 }],
            },
            currentEpisodeId: 6,
        });

        expect(season.episodes.map((e) => e.label)).toEqual([
            'S03E01',
            'S03E02',
        ]);
        expect(season.episodes[1].title).toBe('');
    });
});

describe('formatEpisodeDuration', () => {
    it.each([
        [2700, undefined, '45 min'],
        [0, '45 min', '45 min'],
        [undefined, '1h 30min', '90 min'],
        [undefined, '01:30:00', '90 min'],
        [undefined, '45:30', '46 min'],
        [undefined, '', null],
        [undefined, 'soon', null],
        [-5, undefined, null],
    ])('formats %s / %s as %s', (seconds, text, expected) => {
        expect(formatEpisodeDuration(seconds, text)).toBe(expected);
    });
});

describe('sortSeasonKeys', () => {
    it('sorts numeric keys ascending and keeps named keys after them in order', () => {
        expect(sortSeasonKeys(['Specials', '2', 'Extras', '10', '1'])).toEqual([
            '1',
            '2',
            '10',
            'Specials',
            'Extras',
        ]);
    });
});
