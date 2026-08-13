import { hasEpisodeMarker, isLikelyM3uMovie } from './m3u-vod-detection.util';

const movie = (url: string, name = 'Some Movie', radio = '') => ({
    url,
    name,
    radio,
});

describe('isLikelyM3uMovie', () => {
    describe('movie container extensions', () => {
        it.each([
            'http://host/films/Dune.Part.Two.2024.mkv',
            'http://host/films/Dune.mp4',
            'http://host/films/OLDBOY.MKV',
            'http://host/films/movie.avi',
            'http://host/films/movie.webm',
            'http://host/films/clip.m4v',
        ])('recognizes %s', (url) => {
            expect(isLikelyM3uMovie(movie(url))).toBe(true);
        });

        it('recognizes a query-declared extension', () => {
            expect(isLikelyM3uMovie(movie('http://host/stream?ext=mp4'))).toBe(
                true
            );
        });

        it.each([
            'http://host/live/channel.ts',
            'http://host/live/channel.m3u8',
            'http://host/live/segment.m4s',
            'http://host/live/audio.mp3',
            'http://host/live/audio.aac',
            'http://host/live/channel',
        ])('does not treat streaming/audio URL %s as a movie', (url) => {
            expect(isLikelyM3uMovie(movie(url))).toBe(false);
        });
    });

    describe('xtream-style path segments', () => {
        it('recognizes /movie/ paths without a file extension', () => {
            expect(
                isLikelyM3uMovie(movie('http://host/movie/user/pass/12345'))
            ).toBe(true);
        });

        it('recognizes HLS VOD under /movie/', () => {
            expect(
                isLikelyM3uMovie(
                    movie('http://host/movie/user/pass/12345.m3u8')
                )
            ).toBe(true);
        });

        it.each(['movies', 'vod'])('recognizes /%s/ segment', (segment) => {
            expect(
                isLikelyM3uMovie(movie(`http://host/${segment}/12345`))
            ).toBe(true);
        });

        it('is case-insensitive about the segment', () => {
            expect(
                isLikelyM3uMovie(movie('http://host/MOVIE/user/pass/1'))
            ).toBe(true);
        });

        it('does not fire on a segment merely containing the word', () => {
            expect(
                isLikelyM3uMovie(movie('http://host/moviestar-tv/live'))
            ).toBe(false);
        });

        it('treats /series/ as episodes, not movies, even with a movie container', () => {
            expect(
                isLikelyM3uMovie(movie('http://host/series/user/pass/777.mkv'))
            ).toBe(false);
        });
    });

    describe('exclusions', () => {
        it('never treats a radio entry as a movie', () => {
            expect(
                isLikelyM3uMovie(movie('http://host/x.mp4', 'Jazz FM', 'true'))
            ).toBe(false);
        });

        it('never treats a DASH URL as a movie, even under /movie/', () => {
            expect(
                isLikelyM3uMovie(movie('http://host/movie/stream.mpd'))
            ).toBe(false);
        });

        it('skips entries whose name carries an episode marker', () => {
            expect(
                isLikelyM3uMovie(
                    movie('http://host/f/x.mkv', 'Breaking Bad S01E02')
                )
            ).toBe(false);
        });

        it('handles null and missing urls', () => {
            expect(isLikelyM3uMovie(null)).toBe(false);
            expect(isLikelyM3uMovie(undefined)).toBe(false);
            expect(isLikelyM3uMovie(movie(''))).toBe(false);
        });

        it('handles unparseable urls without throwing', () => {
            expect(isLikelyM3uMovie(movie('http://['))).toBe(false);
        });
    });
});

describe('hasEpisodeMarker', () => {
    it.each([
        'Breaking Bad S01E02',
        'Breaking Bad s1.e2',
        'Breaking Bad S01 E02',
        'Breaking Bad 1x02',
        'The Boys Season 3',
        'The Boys season_02',
        'Sherlock Episode 5',
        'Dark Folge 3',
        'La Casa de Papel Episodio 2',
        'Шерлок 2 серия',
        'Во все тяжкие 1 сезон',
        'Пацаны 3-й сезон',
        'Эпизод 4 Шерлок',
    ])('detects "%s"', (name) => {
        expect(hasEpisodeMarker(name)).toBe(true);
    });

    it.each([
        'Dune Part Two',
        '4x4',
        '2001: A Space Odyssey',
        '1917',
        'Se7en',
        'Postseason Story',
        'The Fifth Season',
        'Друзья Оушена 13',
        '',
    ])('does not fire on "%s"', (name) => {
        expect(hasEpisodeMarker(name)).toBe(false);
    });

    // Documented cost of the conservative gate: a real film whose NAME
    // carries an episode word is skipped and keeps the current live-style
    // view. Safe direction — never mis-enrich a series episode as a film.
    it('skips "Star Wars: Episode 1" by design', () => {
        expect(hasEpisodeMarker('Star Wars: Episode 1')).toBe(true);
    });

    it('handles null/undefined', () => {
        expect(hasEpisodeMarker(null)).toBe(false);
        expect(hasEpisodeMarker(undefined)).toBe(false);
    });
});
