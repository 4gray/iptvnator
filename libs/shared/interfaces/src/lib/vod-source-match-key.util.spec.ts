import {
    buildVodSourceMatchKey,
    buildVodSourceMatchKeyCandidates,
    isTmdbMatchKey,
} from './vod-source-match-key.util';

const MOVIE = { title: 'The Matrix', year: 1999, tmdbId: 603 };

describe('buildVodSourceMatchKey', () => {
    it('prefers the TMDB id when there is a usable one', () => {
        expect(buildVodSourceMatchKey(MOVIE)).toBe('tmdb:603');
        expect(isTmdbMatchKey('tmdb:603')).toBe(true);
    });

    it.each([[0], [''], [null], [undefined], ['abc']])(
        'falls back to the title for the unusable TMDB id %p',
        (tmdbId) => {
            expect(buildVodSourceMatchKey({ ...MOVIE, tmdbId })).toBe(
                'title:the matrix:1999'
            );
        }
    );

    it('refuses to key on nothing rather than writing a junk row', () => {
        expect(buildVodSourceMatchKey({ title: '  ', year: null })).toBeNull();
    });
});

describe('buildVodSourceMatchKeyCandidates', () => {
    it('covers every poorer form the pin may already be stored under', () => {
        // Enrichment adds the id AND the year, so a pin set before it landed
        // is under a title key — and one set before the year was known is
        // under the yearless form. Missing either loses the preference.
        expect(buildVodSourceMatchKeyCandidates(MOVIE)).toEqual([
            'tmdb:603',
            'title:the matrix:1999',
            'title:the matrix:',
        ]);
    });

    it('still offers the yearless alias without a TMDB id', () => {
        expect(
            buildVodSourceMatchKeyCandidates({ ...MOVIE, tmdbId: null })
        ).toEqual(['title:the matrix:1999', 'title:the matrix:']);
    });

    it('does not repeat the yearless key when the year is unknown', () => {
        expect(
            buildVodSourceMatchKeyCandidates({
                title: 'The Matrix',
                year: null,
            })
        ).toEqual(['title:the matrix:']);
    });

    it('is empty when the movie cannot be identified at all', () => {
        expect(buildVodSourceMatchKeyCandidates({ title: '' })).toEqual([]);
    });
});
