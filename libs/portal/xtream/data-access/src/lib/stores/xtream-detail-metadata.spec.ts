import { XtreamSerieInfo, XtreamVodInfo } from '@iptvnator/shared/interfaces';
import {
    stripXtreamSerieInfoPlaceholders,
    stripXtreamVodInfoPlaceholders,
} from './xtream-detail-metadata';

describe('Xtream detail placeholders', () => {
    it('empties every stand-in the VOD detail route would render', () => {
        const info = stripXtreamVodInfoPlaceholders({
            name: 'Placeholder Film',
            o_name: 'N/A',
            movie_image: 'N/A',
            cover_big: '-',
            releasedate: 'N/A',
            genre: 'n/a',
            duration: 'N/A',
            country: '-',
            director: 'N/A',
            actors: 'N/A',
            cast: '-',
            description: 'N/A',
            plot: ' N/A ',
            rating_imdb: 'N/A',
            rating_kinopoisk: '0',
            backdrop_path: ['N/A', 'https://img.example/backdrop.jpg'],
            duration_secs: 0,
        } as unknown as XtreamVodInfo);

        expect(info).toEqual({
            name: 'Placeholder Film',
            o_name: '',
            movie_image: '',
            cover_big: '',
            releasedate: '',
            genre: '',
            duration: '',
            country: '',
            director: '',
            actors: '',
            cast: '',
            description: '',
            plot: '',
            rating_imdb: '',
            rating_kinopoisk: '',
            backdrop_path: ['https://img.example/backdrop.jpg'],
            duration_secs: 0,
        });
    });

    it('leaves real values, absent fields and non-text fields untouched', () => {
        const source = {
            name: 'Real Film',
            releasedate: '2019-04-05',
            rating_imdb: '7.4',
            rating: 0,
            tmdb_id: 123,
        } as unknown as XtreamVodInfo;

        expect(stripXtreamVodInfoPlaceholders(source)).toEqual(source);
    });

    it('empties every stand-in the series detail route would render', () => {
        const info = stripXtreamSerieInfoPlaceholders({
            name: 'Placeholder Series',
            cover: 'N/A',
            plot: 'N/A',
            cast: '-',
            director: 'n/a',
            genre: 'N/A',
            releaseDate: 'N/A',
            rating: '0',
            rating_5based: 0,
            episode_run_time: 'N/A',
            backdrop_path: ['-'],
        } as unknown as XtreamSerieInfo);

        expect(info).toEqual({
            name: 'Placeholder Series',
            cover: '',
            plot: '',
            cast: '',
            director: '',
            genre: '',
            releaseDate: '',
            rating: '',
            rating_5based: 0,
            episode_run_time: '',
            backdrop_path: [],
        });
    });

    it('passes a malformed info payload through unchanged', () => {
        expect(stripXtreamSerieInfoPlaceholders(undefined as never)).toBe(
            undefined
        );
        const list = [] as unknown as XtreamSerieInfo;
        expect(stripXtreamSerieInfoPlaceholders(list)).toBe(list);
    });
});
