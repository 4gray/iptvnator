import { StalkerVodInfo } from '@iptvnator/shared/interfaces';
import { mergeStalkerInfoWithTmdb } from './tmdb-merge';
import { TmdbMovieDetails, TmdbTvDetails } from './tmdb.types';

describe('mergeStalkerInfoWithTmdb', () => {
    const providerStalkerInfo: StalkerVodInfo = {
        movie_image: '',
        description: '',
        name: 'Ирония судьбы, или С лёгким паром!',
        o_name: undefined,
        actors: 'Провайдерский актёр',
        director: '',
        releasedate: '1976',
        genre: '',
        rating_imdb: '',
        rating_kinopoisk: '8.1',
    };

    const tmdbMovieRu: TmdbMovieDetails = {
        id: 20992,
        title: 'Ирония судьбы, или С лёгким паром!',
        overview: 'Описание из TMDB',
        genres: [{ id: 35, name: 'комедия' }],
        release_date: '1976-01-01',
        vote_average: 7.9,
        vote_count: 250,
        poster_path: '/irony-poster.jpg',
        backdrop_path: '/irony-backdrop.jpg',
        credits: {
            cast: [
                {
                    name: 'Андрей Мягков',
                    order: 0,
                    profile_path: '/myagkov.jpg',
                },
            ],
            crew: [{ id: 77, name: 'Эльдар Рязанов', job: 'Director' }],
        },
    };

    it('prefers TMDB editorial fields and attaches cast/backdrop', () => {
        const merged = mergeStalkerInfoWithTmdb(
            providerStalkerInfo,
            tmdbMovieRu,
            'movie'
        );

        expect(merged.description).toBe('Описание из TMDB');
        expect(merged.actors).toBe('Андрей Мягков');
        expect(merged.director).toBe('Эльдар Рязанов');
        expect(merged.tmdb_directors?.[0]).toEqual({
            name: 'Эльдар Рязанов',
            profileUrl: null,
            tmdbPersonId: 77,
        });
        expect(merged.genre).toBe('комедия');
        expect(merged.movie_image).toBe(
            'https://image.tmdb.org/t/p/w500/irony-poster.jpg'
        );
        expect(merged.tmdb_backdrop).toBe(
            'https://image.tmdb.org/t/p/w1280/irony-backdrop.jpg'
        );
        expect(merged.tmdb_cast).toEqual([
            {
                name: 'Андрей Мягков',
                profileUrl: 'https://image.tmdb.org/t/p/w185/myagkov.jpg',
            },
        ]);
        // Provider keeps its own fields where TMDB should not win
        expect(merged.name).toBe('Ирония судьбы, или С лёгким паром!');
        expect(merged.rating_kinopoisk).toBe('8.1');
        expect(merged.releasedate).toBe('1976');
    });

    it('only fills rating_imdb when the provider left it empty', () => {
        const merged = mergeStalkerInfoWithTmdb(
            providerStalkerInfo,
            tmdbMovieRu,
            'movie'
        );
        expect(merged.rating_imdb).toBe('7.9');

        const withProviderRating = mergeStalkerInfoWithTmdb(
            { ...providerStalkerInfo, rating_imdb: '8.4' },
            tmdbMovieRu,
            'movie'
        );
        expect(withProviderRating.rating_imdb).toBe('8.4');
    });

    it('uses series creators as director for tv items', () => {
        const tv: TmdbTvDetails = {
            id: 1,
            overview: 'tv overview',
            created_by: [{ name: 'Создатель Сериала' }],
        };
        const merged = mergeStalkerInfoWithTmdb(providerStalkerInfo, tv, 'tv');
        expect(merged.director).toBe('Создатель Сериала');
    });

    it('keeps provider values for missing TMDB fields', () => {
        const merged = mergeStalkerInfoWithTmdb(
            { ...providerStalkerInfo, description: 'Провайдерский сюжет' },
            { id: 20992 },
            'movie'
        );

        expect(merged.description).toBe('Провайдерский сюжет');
        expect(merged.actors).toBe('Провайдерский актёр');
        expect(merged.tmdb_cast).toBeUndefined();
        expect(merged.tmdb_backdrop).toBeUndefined();
    });
});
