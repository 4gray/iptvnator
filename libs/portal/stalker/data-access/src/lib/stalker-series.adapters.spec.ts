import {
    isVodSeriesItem,
    mapRegularSeriesEpisodes,
    mapRegularSeriesSeasons,
    mapVodSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
} from './stalker-series.adapters';
import { StalkerSelectedVodItem } from './models';

type EpisodeWithMetadata = {
    custom_sid?: string;
    id?: string;
    legacyTrackingId?: number;
    originalId?: string;
    originalCmd?: string;
};

describe('stalker-series.adapters', () => {
    it('detects vod-series flags from heterogeneous payloads', () => {
        expect(isVodSeriesItem({ is_series: true })).toBe(true);
        expect(isVodSeriesItem({ is_series: 1 })).toBe(true);
        expect(isVodSeriesItem({ is_series: '1' })).toBe(true);
        expect(isVodSeriesItem({ is_series: false })).toBe(false);
    });

    it('maps VOD-series seasons to VM shape with defaults', () => {
        const seasons = mapVodSeriesSeasonsToVm([
            {
                id: '10',
                video_id: '20',
                season_number: '2',
            },
        ]);

        expect(seasons).toEqual([
            {
                id: '10',
                video_id: '20',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
    });

    it('maps VOD-series episodes with stable tracking IDs and originalId metadata', () => {
        const mapped = mapVodSeriesEpisodes(
            [
                {
                    id: 's1',
                    video_id: 'v1',
                    name: 'Season 1',
                    season_number: '1',
                    episodes: [
                        {
                            id: 'api-shared-id',
                            series_number: 1,
                            name: 'Episode 1',
                        },
                        {
                            id: 'api-shared-id',
                            series_number: 2,
                            name: 'Episode 2',
                        },
                    ],
                    isLoading: false,
                    isExpanded: false,
                },
            ],
            {
                parentSeriesId: 100,
                fallbackPoster: 'poster.jpg',
            }
        );

        expect(mapped['1']).toHaveLength(2);
        const firstEpisode = mapped['1'][0] as EpisodeWithMetadata;
        expect(firstEpisode.custom_sid).toBe('vod-series');
        expect(firstEpisode.originalId).toBe('api-shared-id');
        expect(firstEpisode.id).not.toBe(mapped['1'][1].id);
    });

    it('preserves the Specials season zero through VOD episode mapping', () => {
        const mapped = mapVodSeriesEpisodes(
            [
                {
                    id: 'specials',
                    video_id: 'v1',
                    name: 'Specials',
                    season_number: '0',
                    episodes: [
                        {
                            id: 'special-1',
                            series_number: 1,
                            name: 'Special episode',
                        },
                    ],
                    isLoading: false,
                    isExpanded: false,
                },
            ],
            { parentSeriesId: 100 }
        );

        expect(mapped['0'][0].season).toBe(0);
    });

    it('generates deterministic VOD-series episode IDs for the same parent and provider episode', () => {
        const seasons = [
            {
                id: 's1',
                video_id: 'v1',
                name: 'Season 1',
                season_number: '1',
                episodes: [
                    {
                        id: 'provider-episode-1',
                        series_number: 1,
                        name: 'Episode 1',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ];
        const options = {
            parentSeriesId: 100,
            fallbackPoster: 'poster.jpg',
        };

        const firstMapping = mapVodSeriesEpisodes(seasons, options);
        const secondMapping = mapVodSeriesEpisodes(seasons, options);

        expect(firstMapping['1'][0].id).toBe('604391373');
        expect(firstMapping['1'][0].id).toBe(secondMapping['1'][0].id);
    });

    it('scopes VOD-series episode IDs by parent while preserving the legacy tracking ID', () => {
        const seasons = [
            {
                id: 's1',
                video_id: 'v1',
                name: 'Season 1',
                season_number: '1',
                episodes: [
                    {
                        id: 'provider-episode-1',
                        series_number: 1,
                        name: 'Episode 1',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ];

        const firstSeries = mapVodSeriesEpisodes(seasons, {
            parentSeriesId: 100,
            fallbackPoster: 'poster.jpg',
        });
        const secondSeries = mapVodSeriesEpisodes(seasons, {
            parentSeriesId: 200,
            fallbackPoster: 'poster.jpg',
        });
        const firstEpisode = firstSeries['1'][0] as EpisodeWithMetadata;
        const secondEpisode = secondSeries['1'][0] as EpisodeWithMetadata;

        expect(firstEpisode.id).not.toBe(secondEpisode.id);
        expect(firstEpisode.legacyTrackingId).toBe(624320047);
        expect(firstEpisode.legacyTrackingId).toBe(
            secondEpisode.legacyTrackingId
        );
    });

    it('scopes VOD-series episode IDs by provider episode identity', () => {
        const baseSeason = {
            id: 's1',
            video_id: 'v1',
            name: 'Season 1',
            season_number: '1',
            isLoading: false,
            isExpanded: false,
        };
        const firstSeries = mapVodSeriesEpisodes(
            [
                {
                    ...baseSeason,
                    episodes: [
                        {
                            id: 'provider-episode-1',
                            series_number: 1,
                            name: 'Episode 1',
                        },
                    ],
                },
            ],
            { parentSeriesId: 100 }
        );
        const secondSeries = mapVodSeriesEpisodes(
            [
                {
                    ...baseSeason,
                    episodes: [
                        {
                            id: 'provider-episode-2',
                            series_number: 1,
                            name: 'Episode 1',
                        },
                    ],
                },
            ],
            { parentSeriesId: 100 }
        );

        expect(firstSeries['1'][0].id).not.toBe(secondSeries['1'][0].id);
    });

    it('derives missing VOD-series season numbers from natural season order', () => {
        const mapped = mapVodSeriesEpisodes(
            [
                {
                    id: 'season-2',
                    video_id: 'v1',
                    name: 'Season 2',
                    season_number: '',
                    episodes: [
                        {
                            id: 'episode-2',
                            series_number: 1,
                            name: 'Second season pilot',
                        },
                    ],
                    isLoading: false,
                    isExpanded: false,
                },
                {
                    id: 'season-1',
                    video_id: 'v1',
                    name: 'Season 1',
                    season_number: '',
                    episodes: [
                        {
                            id: 'episode-1',
                            series_number: 1,
                            name: 'Pilot',
                        },
                    ],
                    isLoading: false,
                    isExpanded: false,
                },
            ],
            { parentSeriesId: 100 }
        );

        expect(mapped['Season 1'][0].season).toBe(1);
        expect(mapped['Season 2'][0].season).toBe(2);
    });

    it('maps embedded series payload into regular season episodes', () => {
        const regularSeasons = mapRegularSeriesSeasons(
            {
                id: '100',
                cmd: '/media/file_100.mpg',
                series: ['1', 2, 'x'],
                info: { name: 'Embedded Series' },
            } as StalkerSelectedVodItem,
            []
        );

        const mapped = mapRegularSeriesEpisodes(regularSeasons, 'poster.jpg');
        expect(regularSeasons[0].series).toEqual([1, 2]);
        expect(mapped['1']).toHaveLength(2);
        const firstEpisode = mapped['1'][0] as EpisodeWithMetadata;
        expect(firstEpisode.custom_sid).toBe('regular-series');
        expect(firstEpisode.id).toBe('91189090');
        expect(firstEpisode.originalCmd).toBe('/media/file_100.mpg');
    });
});
