import {
    isVodSeriesItem,
    mapRegularSeriesEpisodes,
    mapRegularSeriesSeasons,
    mapVodSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
} from './stalker-series.adapters';
import { StalkerSelectedVodItem } from './models';
import { pickSeasonMarkedTitle } from '@iptvnator/shared/interfaces';

type EpisodeWithMetadata = {
    custom_sid?: string;
    id?: string;
    legacyTrackingId?: number;
    originalId?: string;
    originalCmd?: string;
};

describe('stalker-series.adapters', () => {
    it.each([
        ['Show S01', 'Show (1-9 season)', 1],
        ['Show Seasons 1-9', 'Show (1-9 season)', 9],
        ['Show Seasons 1-9', 'Show S01', 1],
    ] as const)(
        'detects ranges across titles while preserving historical coordinates: %s / %s',
        (name, original, season) => {
            const titles = [name, original];
            const episodes = mapRegularSeriesEpisodes(
                [
                    {
                        id: '900001',
                        name: 'Episodes',
                        cmd: '/media/900001.mpg',
                        series: [189],
                    },
                ],
                undefined,
                pickSeasonMarkedTitle(...titles),
                900001,
                'embedded',
                titles
            );
            expect(episodes[String(season)][0]).toMatchObject({
                season,
                episode_num: 189,
                seasonUnknown: true,
            });
        }
    );
    it('marks flat range collections without changing playback or episode identities', () => {
        const seasons = [
            {
                id: '900001',
                name: 'Episodes',
                cmd: '/media/900001.mpg',
                series: [1, 2, 189],
            },
        ];
        const old = mapRegularSeriesEpisodes(
            seasons,
            undefined,
            'Show (9 season)',
            900001,
            'embedded'
        )['9'];
        const episodes = Object.values(
            mapRegularSeriesEpisodes(
                seasons,
                undefined,
                'Synthetic Series Alpha (1-9 season)',
                900001,
                'embedded'
            )
        )[0];
        expect(episodes.map((e) => e.id)).toEqual(old.map((e) => e.id));
        expect(episodes.map((e) => e.activityIdentity)).toEqual(
            old.map((e) => e.activityIdentity)
        );
        expect(
            episodes.map((e) => (e as EpisodeWithMetadata).originalCmd)
        ).toEqual(old.map((e) => (e as EpisodeWithMetadata).originalCmd));
        expect(episodes.every((e) => e.seasonUnknown)).toBe(true);
        expect(episodes.map((e) => e.season)).toEqual(old.map((e) => e.season));
        const structured = mapRegularSeriesEpisodes(
            seasons,
            undefined,
            'Show (1-9 season)',
            900001,
            'regular'
        );
        expect(Object.values(structured)[0].some((e) => e.seasonUnknown)).toBe(
            false
        );
    });
    it.each([
        'Synthetic Series Beta s02',
        'Synthetic Series Beta season2',
        'Synthetic Series Beta (s02)',
        'Synthetic Series Beta (season 2)',
        'Пример (2 сезон)',
        'Пример (сезон 2)',
        'Пример s02',
        'Пример season2',
    ])(
        'uses the title season for lazy VOD %s without changing tracking IDs',
        (title) => {
            const provider = [
                {
                    id: 's1',
                    video_id: 'v1',
                    season_number: '1',
                    name: 'Season 1',
                },
            ];
            const load = (
                seasons: ReturnType<typeof mapVodSeriesSeasonsToVm>
            ) =>
                seasons.map((season) => ({
                    ...season,
                    episodes: [
                        {
                            id: 'provider-episode-1',
                            series_number: 1,
                            name: 'Episode 1',
                        },
                    ],
                }));
            const original = mapVodSeriesEpisodes(
                load(mapVodSeriesSeasonsToVm(provider)),
                { parentSeriesId: 100 }
            );
            const correctedSeasons = mapVodSeriesSeasonsToVm(provider, title);
            expect(correctedSeasons[0].season_number).toBe('2');
            expect(correctedSeasons[0].episodes).toEqual([]);
            expect(correctedSeasons[0].id).toBe('s1');
            expect(correctedSeasons[0].video_id).toBe('v1');
            const corrected = mapVodSeriesEpisodes(load(correctedSeasons), {
                parentSeriesId: 100,
            });
            expect(Object.keys(corrected)).toEqual(['2']);
            expect(corrected['2'][0]).toEqual(
                expect.objectContaining({
                    id: original['1'][0].id,
                    season: 2,
                    providerSeasonNumber: 1,
                    legacyTrackingId: (original['1'][0] as EpisodeWithMetadata)
                        .legacyTrackingId,
                    originalId: 'provider-episode-1',
                })
            );
        }
    );

    it('keeps multi-season VOD numbering despite a parent title marker', () => {
        const provider = [1, 2].map((number) => ({
            id: `s${number}`,
            video_id: 'v1',
            season_number: String(number),
        }));
        expect(
            mapVodSeriesSeasonsToVm(provider, 'Show s02').map(
                (season) => season.season_number
            )
        ).toEqual(['1', '2']);
    });

    it('corrects embedded and single regular season coordinates without changing episode IDs', () => {
        const seasons = [
            {
                id: 's1',
                name: 'Episodes',
                cmd: '/media/file_100.mpg',
                series: [1, 2],
            },
        ];
        const original = mapRegularSeriesEpisodes(seasons);
        const corrected = mapRegularSeriesEpisodes(
            seasons,
            undefined,
            'Show (season 2)'
        );
        expect(Object.keys(corrected)).toEqual(['2']);
        expect(corrected['2'][0].season).toBe(2);
        expect(corrected['2'].map((episode) => episode.id)).toEqual(
            original['1'].map((episode) => episode.id)
        );
    });

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

describe('portable Stalker activity identities', () => {
    it('distinguishes regular and embedded episodes without changing their local tracking ids', () => {
        const seasons = [
            { id: 'provider-season', name: 'Season', series: [1, 2] },
        ];
        const regular = mapRegularSeriesEpisodes(
            seasons,
            undefined,
            undefined,
            'raw-parent',
            'regular'
        );
        const embedded = mapRegularSeriesEpisodes(
            seasons,
            undefined,
            undefined,
            'raw-parent',
            'embedded'
        );
        const a = Object.values(regular)[0][0];
        const b = Object.values(embedded)[0][0];
        expect(a.id).toBe(b.id);
        expect(a.activityIdentity).toMatchObject({
            provider: 'stalker',
            kind: 'episode',
            seriesId: 'raw-parent',
            mode: 'regular',
            seasonKey: 'provider-season',
            episodeNumber: 1,
        });
        expect(b.activityIdentity).toEqual({
            ...a.activityIdentity,
            mode: 'embedded',
        });
    });
    it('keeps the raw lazy parent and provider coordinates separate from a legacy numeric alias', () => {
        const seasons = [
            {
                id: 's1',
                video_id: 'provider-parent',
                isLoading: false,
                isExpanded: true,
                name: 'Season 1',
                season_number: '1',
                episodes: [{ id: 'provider-file', series_number: 1 }],
            },
        ];
        const local = mapVodSeriesEpisodes(seasons, { parentSeriesId: 123 });
        const portable = mapVodSeriesEpisodes(seasons, {
            parentSeriesId: 123,
            activityParentSeriesId: 'raw-parent',
            mode: 'lazy',
        });
        const a = Object.values(local)[0][0];
        const b = Object.values(portable)[0][0];
        expect(b.id).toBe(a.id);
        expect(b.activityIdentity).toMatchObject({
            mode: 'lazy',
            seriesId: 'raw-parent',
            id: 'provider-file',
            seasonKey: '1',
            episodeNumber: 1,
        });
    });
});
