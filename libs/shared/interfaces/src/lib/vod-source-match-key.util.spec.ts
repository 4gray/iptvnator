import {
    buildVodSourceMatchKey,
    buildVodSourceMatchKeyCandidates,
    isTmdbMatchKey,
    buildVodSourceMatchKeyWriteKeys,
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

describe('buildVodSourceMatchKeyWriteKeys — the ambiguous alias', () => {
    it('is not written beside a precise key', () => {
        // `title:dune:` names every remake. Retiring it while storing the
        // tmdb pin could delete another film's pre-enrichment preference.
        expect(
            buildVodSourceMatchKeyWriteKeys({
                tmdbId: 603,
                title: 'Dune',
                year: null,
            })
        ).toEqual(['tmdb:603']);
    });

    it('is still used when it is the only key there is', () => {
        // Refusing to pin at all would be worse than an imprecise pin.
        expect(
            buildVodSourceMatchKeyWriteKeys({ title: 'Dune', year: null })
        ).toEqual(['title:dune:']);
    });

    it('is unnecessary once a year disambiguates the title', () => {
        expect(
            buildVodSourceMatchKeyWriteKeys({
                tmdbId: 603,
                title: 'Dune',
                year: 2021,
            })
        ).toEqual(['tmdb:603', 'title:dune:2021']);
    });
});
