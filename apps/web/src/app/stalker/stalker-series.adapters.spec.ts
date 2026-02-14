import {
    isVodSeriesItem,
    mapRegularSeriesEpisodes,
    mapRegularSeriesSeasons,
    mapVodSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
} from './stalker-series.adapters';
import { StalkerSelectedVodItem } from './models';

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
            'poster.jpg'
        );

        expect(mapped['1']).toHaveLength(2);
        expect(mapped['1'][0].custom_sid).toBe('vod-series');
        expect((mapped['1'][0] as any).originalId).toBe('api-shared-id');
        expect(mapped['1'][0].id).not.toBe(mapped['1'][1].id);
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
        expect(mapped['1'][0].custom_sid).toBe('regular-series');
        expect((mapped['1'][0] as any).originalCmd).toBe('/media/file_100.mpg');
    });
});
