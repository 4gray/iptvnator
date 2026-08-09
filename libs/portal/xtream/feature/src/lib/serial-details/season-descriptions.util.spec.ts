import type { XtreamSerieSeason } from '@iptvnator/shared/interfaces';
import { buildSeasonDescriptions } from './season-descriptions.util';

function season(
    seasonNumber: number,
    overview: string
): Pick<XtreamSerieSeason, 'season_number' | 'overview'> {
    return { season_number: seasonNumber, overview };
}

describe('buildSeasonDescriptions', () => {
    it('returns an empty map for a missing item', () => {
        expect(buildSeasonDescriptions(null)).toEqual({});
    });

    it('keys provider overviews by season number', () => {
        expect(
            buildSeasonDescriptions({
                seasons: [
                    season(1, 'Season one text'),
                    season(2, 'Season two text'),
                ] as XtreamSerieSeason[],
            })
        ).toEqual({ '1': 'Season one text', '2': 'Season two text' });
    });

    it('drops URL-only provider overviews', () => {
        expect(
            buildSeasonDescriptions({
                seasons: [
                    season(
                        1,
                        'http://line.example.net:80/images/series/x_small.jpg'
                    ),
                ] as XtreamSerieSeason[],
            })
        ).toEqual({});
    });

    it('falls back to TMDB overviews where provider text is absent or junk', () => {
        expect(
            buildSeasonDescriptions({
                seasons: [
                    season(1, 'https://cdn.example.com/cover.jpg'),
                    season(2, 'Real provider text'),
                ] as XtreamSerieSeason[],
                tmdb_season_overviews: {
                    '1': 'TMDB season 1',
                    '2': 'TMDB season 2',
                    '3': 'TMDB season 3',
                },
            })
        ).toEqual({
            '1': 'TMDB season 1',
            '2': 'Real provider text',
            '3': 'TMDB season 3',
        });
    });

    it('covers seasons the provider seasons array does not list', () => {
        expect(
            buildSeasonDescriptions({
                seasons: [],
                tmdb_season_overviews: { '1': 'TMDB only' },
            })
        ).toEqual({ '1': 'TMDB only' });
    });
});
