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
