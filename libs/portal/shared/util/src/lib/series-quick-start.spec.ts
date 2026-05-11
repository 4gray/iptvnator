import { PlaybackPositionData, XtreamSerieEpisode } from 'shared-interfaces';
import {
    SERIES_QUICK_START_ACTION_KIND,
    formatSeriesEpisodeCode,
    getSeriesQuickStartAction,
} from './series-quick-start';

function episode(
    id: number,
    season: number,
    episodeNum: number,
    title = `Episode ${episodeNum}`
): XtreamSerieEpisode {
    return {
        id: String(id),
        episode_num: episodeNum,
        title,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        season,
        direct_source: '',
    };
}

function position(
    contentXtreamId: number,
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: 10,
        positionSeconds: 0,
        durationSeconds: 100,
        ...overrides,
    };
}

describe('getSeriesQuickStartAction', () => {
    it('returns the first episode when there are no playback positions', () => {
        const firstEpisode = episode(101, 1, 1);

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [firstEpisode, episode(102, 1, 2)],
            },
            playbackPositions: new Map(),
        });

        expect(action).toEqual({
            kind: SERIES_QUICK_START_ACTION_KIND.PlayFirst,
            labelKey: 'XTREAM.PLAY_FIRST_EPISODE',
            episodeLabel: 'S01E01 · Episode 1',
            icon: 'play_arrow',
            episode: firstEpisode,
            position: null,
            disabled: false,
        });
    });

    it('resumes the latest in-progress episode by updatedAt', () => {
        const olderEpisode = episode(101, 1, 1);
        const latestEpisode = episode(102, 1, 2);

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [olderEpisode, latestEpisode],
            },
            playbackPositions: new Map([
                [
                    101,
                    position(101, {
                        positionSeconds: 20,
                        updatedAt: '2026-05-10T10:00:00.000Z',
                    }),
                ],
                [
                    102,
                    position(102, {
                        positionSeconds: 30,
                        updatedAt: '2026-05-10T11:00:00.000Z',
                    }),
                ],
            ]),
        });

        expect(action?.kind).toBe(SERIES_QUICK_START_ACTION_KIND.Resume);
        expect(action?.labelKey).toBe('XTREAM.RESUME_EPISODE');
        expect(action?.episodeLabel).toBe('S01E02 · Episode 2');
        expect(action?.episode).toBe(latestEpisode);
        expect(action?.position?.positionSeconds).toBe(30);
    });

    it('plays the next unwatched episode after watched episodes', () => {
        const nextEpisode = episode(102, 1, 2);

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [episode(101, 1, 1), nextEpisode],
            },
            playbackPositions: new Map([
                [
                    101,
                    position(101, {
                        positionSeconds: 95,
                        durationSeconds: 100,
                    }),
                ],
            ]),
        });

        expect(action?.kind).toBe(SERIES_QUICK_START_ACTION_KIND.PlayNext);
        expect(action?.labelKey).toBe('XTREAM.PLAY_NEXT_EPISODE');
        expect(action?.episodeLabel).toBe('S01E02 · Episode 2');
        expect(action?.episode).toBe(nextEpisode);
    });

    it('plays the first episode of the next season when the current season is watched', () => {
        const nextSeasonEpisode = episode(201, 2, 1);

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [episode(101, 1, 1)],
                '2': [nextSeasonEpisode],
            },
            playbackPositions: new Map([
                [
                    101,
                    position(101, {
                        positionSeconds: 100,
                        durationSeconds: 100,
                    }),
                ],
            ]),
        });

        expect(action?.kind).toBe(SERIES_QUICK_START_ACTION_KIND.PlayNext);
        expect(action?.episodeLabel).toBe('S02E01 · Episode 1');
        expect(action?.episode).toBe(nextSeasonEpisode);
    });

    it('returns a disabled completed action when every episode is watched', () => {
        const finalEpisode = episode(102, 1, 2);

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [episode(101, 1, 1), finalEpisode],
            },
            playbackPositions: new Map([
                [
                    101,
                    position(101, {
                        positionSeconds: 100,
                        durationSeconds: 100,
                    }),
                ],
                [
                    102,
                    position(102, {
                        positionSeconds: 90,
                        durationSeconds: 100,
                    }),
                ],
            ]),
        });

        expect(action).toEqual({
            kind: SERIES_QUICK_START_ACTION_KIND.Completed,
            labelKey: 'XTREAM.SERIES_WATCHED',
            episodeLabel: 'S01E02 · Episode 2',
            icon: 'check_circle',
            episode: finalEpisode,
            position: expect.any(Object),
            disabled: true,
        });
    });

    it('sorts nonnumeric season keys naturally', () => {
        const seasonTwoEpisode = episode(201, 2, 1);

        const action = getSeriesQuickStartAction({
            seasons: {
                'Season 10': [episode(1001, 10, 1)],
                'Season 2': [seasonTwoEpisode],
            },
            playbackPositions: new Map(),
        });

        expect(action?.episode).toBe(seasonTwoEpisode);
    });

    it('falls back to series order when in-progress positions have no updatedAt', () => {
        const laterEpisode = episode(102, 1, 2);

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [episode(101, 1, 1), laterEpisode],
            },
            playbackPositions: new Map([
                [
                    101,
                    position(101, {
                        positionSeconds: 20,
                    }),
                ],
                [
                    102,
                    position(102, {
                        positionSeconds: 30,
                    }),
                ],
            ]),
        });

        expect(action?.kind).toBe(SERIES_QUICK_START_ACTION_KIND.Resume);
        expect(action?.episode).toBe(laterEpisode);
    });

    it('omits the title separator when an episode title is empty', () => {
        const firstEpisode = episode(101, 1, 1, '');

        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [firstEpisode],
            },
            playbackPositions: new Map(),
        });

        expect(action?.episodeLabel).toBe('S01E01');
    });

    it('returns null when no playable episodes exist', () => {
        const action = getSeriesQuickStartAction({
            seasons: {
                '1': [],
            },
            playbackPositions: new Map(),
        });

        expect(action).toBeNull();
    });
});

describe('formatSeriesEpisodeCode', () => {
    it('formats season and episode numbers with two digit minimums', () => {
        expect(formatSeriesEpisodeCode(1, 2)).toBe('S01E02');
        expect(formatSeriesEpisodeCode(12, 14)).toBe('S12E14');
    });

    it('falls back to S01E01 for invalid positive integer parts', () => {
        expect(formatSeriesEpisodeCode(0, -1)).toBe('S01E01');
        expect(formatSeriesEpisodeCode(Number.NaN, 2)).toBe('S01E02');
    });
});
