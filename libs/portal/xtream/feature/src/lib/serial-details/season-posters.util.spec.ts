import type { XtreamSerieSeason } from '@iptvnator/shared/interfaces';
import { buildSeasonPosters } from './season-posters.util';

const SHOW_POSTER = 'https://cdn.example.com/show.jpg';

function season(
    seasonNumber: number,
    cover: Partial<Pick<XtreamSerieSeason, 'cover' | 'cover_big'>> = {}
): XtreamSerieSeason {
    return {
        season_number: seasonNumber,
        cover: '',
        cover_big: '',
        ...cover,
    } as XtreamSerieSeason;
}

describe('buildSeasonPosters', () => {
    it('returns an empty map for a missing item', () => {
        expect(buildSeasonPosters(null)).toEqual({});
    });

    it('prefers the TMDB season poster over the provider cover', () => {
        expect(
            buildSeasonPosters({
                info: { cover: SHOW_POSTER },
                seasons: [
                    season(1, {
                        cover_big: 'https://cdn.example.com/s1-big.jpg',
                    }),
                ],
                tmdb_season_posters: {
                    '1': 'https://image.tmdb.org/t/p/w342/s1.jpg',
                },
            })
        ).toEqual({ '1': 'https://image.tmdb.org/t/p/w342/s1.jpg' });
    });

    it('falls back to cover_big, then cover, where TMDB has no season poster', () => {
        expect(
            buildSeasonPosters({
                info: { cover: SHOW_POSTER },
                seasons: [
                    season(1, {
                        cover: 'https://cdn.example.com/s1.jpg',
                        cover_big: 'https://cdn.example.com/s1-big.jpg',
                    }),
                    season(2, { cover: 'https://cdn.example.com/s2.jpg' }),
                ],
                tmdb_season_posters: {
                    '3': 'https://image.tmdb.org/t/p/w342/s3.jpg',
                },
            })
        ).toEqual({
            '1': 'https://cdn.example.com/s1-big.jpg',
            '2': 'https://cdn.example.com/s2.jpg',
            '3': 'https://image.tmdb.org/t/p/w342/s3.jpg',
        });
    });

    it('drops provider covers that repeat the show poster', () => {
        expect(
            buildSeasonPosters({
                info: { cover: SHOW_POSTER },
                seasons: [
                    season(1, { cover_big: SHOW_POSTER, cover: SHOW_POSTER }),
                    season(2, {
                        cover_big: SHOW_POSTER,
                        cover: 'https://cdn.example.com/s2.jpg',
                    }),
                ],
            })
        ).toEqual({ '2': 'https://cdn.example.com/s2.jpg' });
    });

    it('trims padded URLs and still recognizes a padded show-poster duplicate', () => {
        expect(
            buildSeasonPosters({
                info: { cover: ` ${SHOW_POSTER}\n` },
                seasons: [
                    season(1, { cover_big: `  ${SHOW_POSTER}  ` }),
                    season(2, {
                        cover_big: ' https://cdn.example.com/s2.jpg ',
                    }),
                ],
                tmdb_season_posters: {
                    '3': '\thttps://image.tmdb.org/t/p/w342/s3.jpg ',
                },
            })
        ).toEqual({
            '2': 'https://cdn.example.com/s2.jpg',
            '3': 'https://image.tmdb.org/t/p/w342/s3.jpg',
        });
    });

    it('accepts only http(s) URLs from either source', () => {
        expect(
            buildSeasonPosters({
                info: { cover: SHOW_POSTER },
                seasons: [
                    season(1, { cover_big: 'season one', cover: '/s1.jpg' }),
                    season(2, { cover_big: 'javascript:alert(1)' }),
                ],
                tmdb_season_posters: { '3': 'data:image/png;base64,AAAA' },
            })
        ).toEqual({});
    });

    it('ignores seasons without a number and an empty-array provider info', () => {
        expect(
            buildSeasonPosters({
                info: [],
                seasons: [
                    {
                        cover_big: 'https://cdn.example.com/x.jpg',
                    } as XtreamSerieSeason,
                    season(2, { cover_big: 'https://cdn.example.com/s2.jpg' }),
                ],
            })
        ).toEqual({ '2': 'https://cdn.example.com/s2.jpg' });
    });
});
