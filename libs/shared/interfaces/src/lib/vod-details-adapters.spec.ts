import {
    normalizeStalkerVod,
    normalizeXtreamVod,
    youtubeEmbedUrl,
} from './vod-details-adapters';

describe('normalized release year', () => {
    const stalker = (releasedate: string) =>
        normalizeStalkerVod({
            id: '1',
            cmd: '',
            info: {
                movie_image: '',
                description: '',
                name: 'Film',
                actors: '',
                director: '',
                releasedate,
                genre: '',
                rating_imdb: '',
                rating_kinopoisk: '',
            },
        }).year;

    it('reads the year out of a day-first provider date', () => {
        // A fixed prefix renders '31-0' here, which is both the wrong
        // label and a year the Discover chip cannot filter by
        expect(stalker('31-03-1999')).toBe('1999');
    });

    it('keeps reading ordinary date shapes', () => {
        expect(stalker('1976')).toBe('1976');
        expect(stalker('1999-03-31')).toBe('1999');
        expect(
            normalizeXtreamVod({
                info: {
                    kinopoisk_url: '',
                    tmdb_id: 0,
                    name: 'Film',
                    o_name: '',
                    cover_big: '',
                    movie_image: '',
                    releasedate: '2018-05-01',
                    episode_run_time: 0,
                    youtube_trailer: '',
                    director: '',
                    actors: '',
                    cast: '',
                    description: '',
                    plot: '',
                    age: '',
                    mpaa_rating: '',
                    rating_count_kinopoisk: 0,
                    country: '',
                    genre: '',
                    backdrop_path: [],
                    duration_secs: 0,
                    duration: '',
                    video: [],
                    audio: [],
                    bitrate: 0,
                    rating: 0,
                },
            }).year
        ).toBe('2018');
    });

    it('states no year for a placeholder or unusable date', () => {
        expect(stalker('0000-00-00')).toBeUndefined();
        expect(stalker('')).toBeUndefined();
    });
});

describe('provider placeholders in the details view model', () => {
    const PLACEHOLDER_FREE_FIELDS = [
        'description',
        'posterUrl',
        'backdropUrl',
        'year',
        'genre',
        'duration',
        'country',
        'director',
        'actors',
        'ratingImdb',
        'ratingKinopoisk',
    ] as const;

    it('renders none of the stand-ins a Stalker portal sends for empty fields', () => {
        const meta = normalizeStalkerVod({
            id: '1',
            cmd: '',
            info: {
                name: 'Placeholder Film',
                o_name: 'N/A',
                movie_image: 'N/A',
                description: 'N/A',
                actors: 'n/a',
                director: '-',
                releasedate: 'N/A',
                genre: ' N/A ',
                rating_imdb: 'N/A',
                rating_kinopoisk: '0',
            },
        });

        // A placeholder original title must not shadow the real one
        expect(meta.title).toBe('Placeholder Film');
        for (const field of PLACEHOLDER_FREE_FIELDS) {
            expect(meta[field]).toBeUndefined();
        }
    });

    it('renders none of the stand-ins in an Xtream detail response', () => {
        const meta = normalizeXtreamVod({
            info: {
                kinopoisk_url: '',
                tmdb_id: 0,
                name: 'N/A',
                o_name: '',
                cover_big: '-',
                movie_image: 'N/A',
                releasedate: 'N/A',
                episode_run_time: 0,
                youtube_trailer: '',
                director: 'N/A',
                actors: 'N/A',
                cast: '-',
                description: 'N/A',
                plot: 'n/a',
                age: '',
                mpaa_rating: '',
                rating_count_kinopoisk: 0,
                country: 'N/A',
                genre: '-',
                backdrop_path: ['N/A'],
                duration_secs: 0,
                duration: 'N/A',
                video: [],
                audio: [],
                bitrate: 0,
                rating: 0,
                rating_imdb: '0.0',
                rating_kinopoisk: 'N/A',
            },
            movie_data: {
                stream_id: 5,
                name: 'Catalog Title',
                added: '',
                category_id: '1',
                container_extension: 'mp4',
                custom_sid: null,
                direct_source: '',
            },
        });

        expect(meta.title).toBe('Catalog Title');
        for (const field of PLACEHOLDER_FREE_FIELDS) {
            expect(meta[field]).toBeUndefined();
        }
    });

    it('falls through a placeholder to the next usable Xtream field', () => {
        const meta = normalizeXtreamVod({
            info: {
                name: 'Fallback Film',
                description: 'N/A',
                plot: 'A plot from the second field',
                actors: '-',
                cast: 'First Actor, Second Actor',
                duration: 'N/A',
                duration_secs: 5400,
                rating_imdb: '7.2',
            } as never,
        });

        expect(meta.description).toBe('A plot from the second field');
        expect(meta.actors).toBe('First Actor, Second Actor');
        expect(meta.duration).toBe('1h 30m');
        expect(meta.ratingImdb).toBe('7.2');
    });
});

describe('youtubeEmbedUrl', () => {
    it('builds an embed URL from a plain video id (TMDB format)', () => {
        expect(youtubeEmbedUrl('zAGVQLHvwOY')).toBe(
            'https://www.youtube-nocookie.com/embed/zAGVQLHvwOY'
        );
    });

    it('extracts the id from full watch URLs', () => {
        expect(
            youtubeEmbedUrl('https://www.youtube.com/watch?v=zAGVQLHvwOY')
        ).toBe('https://www.youtube-nocookie.com/embed/zAGVQLHvwOY');
        expect(
            youtubeEmbedUrl('https://www.youtube.com/watch?feature=x&v=abc123def')
        ).toBe('https://www.youtube-nocookie.com/embed/abc123def');
    });

    it('extracts the id from youtu.be short links and embed URLs', () => {
        expect(youtubeEmbedUrl('https://youtu.be/zAGVQLHvwOY')).toBe(
            'https://www.youtube-nocookie.com/embed/zAGVQLHvwOY'
        );
        expect(
            youtubeEmbedUrl('https://www.youtube.com/embed/zAGVQLHvwOY')
        ).toBe('https://www.youtube-nocookie.com/embed/zAGVQLHvwOY');
    });

    it('returns null for empty or unusable values', () => {
        expect(youtubeEmbedUrl(undefined)).toBeNull();
        expect(youtubeEmbedUrl(null)).toBeNull();
        expect(youtubeEmbedUrl('')).toBeNull();
        expect(youtubeEmbedUrl('   ')).toBeNull();
        expect(youtubeEmbedUrl('not a video!!!')).toBeNull();
        expect(youtubeEmbedUrl('https://vimeo.com/12345')).toBeNull();
    });
});
