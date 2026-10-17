import {
    isIntroDbSegmentsRequest,
    normalizeIntroDbSegments,
} from './introdb.interface';

describe('isIntroDbSegmentsRequest', () => {
    it('accepts a series IMDb id with positive season and episode', () => {
        expect(
            isIntroDbSegmentsRequest({
                imdbId: 'tt0903747',
                seasonNumber: 1,
                episodeNumber: 2,
            })
        ).toBe(true);
    });

    it.each([
        [
            'a non-IMDb id',
            { imdbId: 'nm0000123', seasonNumber: 1, episodeNumber: 1 },
        ],
        [
            'a URL',
            {
                imdbId: 'https://evil.test/?tt0903747',
                seasonNumber: 1,
                episodeNumber: 1,
            },
        ],
        [
            'season 0',
            { imdbId: 'tt0903747', seasonNumber: 0, episodeNumber: 1 },
        ],
        [
            'a fractional episode',
            { imdbId: 'tt0903747', seasonNumber: 1, episodeNumber: 1.5 },
        ],
        [
            'a string season',
            { imdbId: 'tt0903747', seasonNumber: '1', episodeNumber: 1 },
        ],
        ['nothing', null],
    ])('rejects %s', (_case, payload) => {
        expect(isIntroDbSegmentsRequest(payload)).toBe(false);
    });
});

describe('normalizeIntroDbSegments', () => {
    it('reads millisecond timestamps as seconds and keeps null segments', () => {
        expect(
            normalizeIntroDbSegments({
                imdb_id: 'tt0903747',
                intro: {
                    start_ms: 314500,
                    end_ms: 331000,
                    start_sec: 314.5,
                    end_sec: 331,
                    confidence: 1,
                    submission_count: 5,
                },
                recap: null,
                outro: { start_sec: 2843, end_sec: 2901 },
            })
        ).toEqual({
            intro: { startSeconds: 314.5, endSeconds: 331 },
            recap: null,
            outro: { startSeconds: 2843, endSeconds: 2901 },
        });
    });

    it('drops reversed, negative and implausibly long segments', () => {
        expect(
            normalizeIntroDbSegments({
                intro: { start_sec: 90, end_sec: 30 },
                recap: { start_sec: -5, end_sec: 30 },
                outro: { start_sec: 0, end_sec: 60 * 60 },
            })
        ).toBeNull();
    });

    it('is null for responses that are not objects', () => {
        expect(normalizeIntroDbSegments(null)).toBeNull();
        expect(normalizeIntroDbSegments('Intro not found')).toBeNull();
    });
});
