import type { SeriesResumeTarget } from '@iptvnator/portal/shared/util';
import type {
    StalkerMappedEpisode,
    VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';
import {
    findStalkerResumeLazySeason,
    resolveStalkerResumeEpisode,
    stalkerSeriesResumeKey,
} from './stalker-series-resume';

function episode(
    overrides: Partial<StalkerMappedEpisode> & { id: number }
): StalkerMappedEpisode {
    return {
        title: `Episode ${overrides.episode_num ?? 1}`,
        container_extension: 'mpg',
        custom_sid: 'vod-series',
        added: '',
        season: 1,
        episode_num: 1,
        direct_source: '',
        info: {},
        ...overrides,
    } as StalkerMappedEpisode;
}

function season(overrides: Partial<VodSeriesSeasonVm>): VodSeriesSeasonVm {
    return {
        id: 'season-1',
        video_id: '17572',
        name: 'Season 1',
        season_number: '1',
        episodes: [],
        isLoading: false,
        isExpanded: false,
        ...overrides,
    };
}

const target: SeriesResumeTarget = {
    seriesXtreamId: 17572,
    contentXtreamId: 1750797722,
    seasonNumber: 1,
    episodeNumber: 5,
};

describe('resolveStalkerResumeEpisode', () => {
    it('prefers the exact scoped tracking id the position was saved under', () => {
        const scoped = episode({ id: 1750797722, season: 2, episode_num: 9 });
        const byCoordinates = episode({ id: 42, season: 1, episode_num: 5 });

        expect(
            resolveStalkerResumeEpisode({
                target,
                episodesBySeason: { '1': [byCoordinates], '2': [scoped] },
            })
        ).toBe(scoped);
    });

    it('accepts the pre-scope legacy tracking id', () => {
        const legacy = episode({
            id: 7,
            legacyTrackingId: 1750797722,
            season: 3,
            episode_num: 1,
        });

        expect(
            resolveStalkerResumeEpisode({
                target,
                episodesBySeason: { '3': [legacy] },
            })
        ).toBe(legacy);
    });

    it('falls back to season/episode coordinates, including the provider season', () => {
        const corrected = episode({
            id: 9,
            season: 4,
            providerSeasonNumber: 1,
            episode_num: 5,
        });

        expect(
            resolveStalkerResumeEpisode({
                target,
                episodesBySeason: {
                    '4': [
                        episode({ id: 8, season: 4, episode_num: 4 }),
                        corrected,
                    ],
                },
            })
        ).toBe(corrected);
    });

    it('returns null while the episode is not on the page', () => {
        expect(
            resolveStalkerResumeEpisode({
                target,
                episodesBySeason: {
                    '1': [episode({ id: 1, season: 1, episode_num: 1 })],
                },
            })
        ).toBeNull();
    });
});

describe('findStalkerResumeLazySeason', () => {
    it('names the unhydrated season the target lives in', () => {
        const seasons = [
            season({ id: 'season-1', season_number: '1' }),
            season({ id: 'season-2', season_number: '2' }),
        ];

        expect(findStalkerResumeLazySeason({ target, seasons })?.id).toBe(
            'season-1'
        );
    });

    it('returns null once that season is loading, loaded, or answered empty', () => {
        expect(
            findStalkerResumeLazySeason({
                target,
                seasons: [season({ isLoading: true })],
            })
        ).toBeNull();
        expect(
            findStalkerResumeLazySeason({
                target,
                seasons: [season({ episodesLoaded: true })],
            })
        ).toBeNull();
        expect(
            findStalkerResumeLazySeason({
                target,
                seasons: [
                    season({
                        episodes: [{ id: 'e1', series_number: 1 } as never],
                    }),
                ],
            })
        ).toBeNull();
        expect(
            findStalkerResumeLazySeason({
                target: { ...target, seasonNumber: 3 },
                seasons: [season({})],
            })
        ).toBeNull();
    });
});

describe('stalkerSeriesResumeKey', () => {
    it('identifies one handoff per playlist and coordinates', () => {
        expect(stalkerSeriesResumeKey('stalker-1', target)).toBe(
            'stalker-1:17572:1750797722:1:5'
        );
        expect(stalkerSeriesResumeKey('stalker-2', target)).not.toBe(
            stalkerSeriesResumeKey('stalker-1', target)
        );
    });
});
