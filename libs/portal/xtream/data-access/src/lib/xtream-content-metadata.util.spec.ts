import {
    xtreamContentMetadataKey,
    xtreamDetailContentMetadata,
} from './xtream-content-metadata.util';

describe('xtreamDetailContentMetadata', () => {
    it('reads a VOD detail response', () => {
        expect(
            xtreamDetailContentMetadata({
                backdrop_path: ['https://example.com/b.jpg'],
                tmdb_id: '603',
                releasedate: '1999-03-31',
                o_name: 'The Matrix',
            })
        ).toEqual({
            backdropUrl: 'https://example.com/b.jpg',
            tmdbId: 603,
            releaseYear: 1999,
            originalTitle: 'The Matrix',
        });
    });

    it('reads a series detail response, which spells the date differently', () => {
        expect(
            xtreamDetailContentMetadata({
                releaseDate: '2019-11-12',
                tmdb_id: 82856,
            })
        ).toEqual({ tmdbId: 82856, releaseYear: 2019 });
    });

    it('does not store a date TMDB supplied when the provider had none', () => {
        // `mergeVodInfoWithTmdb` fills `releasedate` from `details.release_date`
        // whenever the provider left it empty, and this runs against the
        // merged object. Recording that as a provider fact is unfixable
        // afterwards: the column is never overwritten, so a real provider date
        // arriving later cannot correct it.
        expect(
            xtreamDetailContentMetadata({
                releasedate: '2015-06-19',
                tmdb_supplied_release_date: true,
                tmdb_id: 150540,
            })
        ).toEqual({ tmdbId: 150540 });
    });

    it('stores the date when the provider stated it, enrichment or not', () => {
        // The merge keeps the provider's own value and leaves the marker off,
        // so an enriched item with a real provider date still records it.
        expect(
            xtreamDetailContentMetadata({
                releasedate: '1999-03-31',
                tmdb_id: 603,
            })
        ).toEqual({ tmdbId: 603, releaseYear: 1999 });
    });

    it('applies the same rule to a series releaseDate', () => {
        expect(
            xtreamDetailContentMetadata({
                releaseDate: '2019-11-12',
                tmdb_supplied_release_date: true,
            })
        ).toBeNull();
    });

    it('never stores a year found only in the title', () => {
        // The provider stated no date. Readers apply their own title-derived
        // fallback; recording one here would turn a guess into a fact, and
        // "2001: A Space Odyssey" is not a 2001 film.
        expect(
            xtreamDetailContentMetadata({
                tmdb_id: 62,
                releasedate: '',
            })
        ).toEqual({ tmdbId: 62 });
    });

    it.each([
        ['no info at all', null],
        ['an empty response', {}],
        ['only empty values', { backdrop_path: [], releasedate: '', o_name: '' }],
    ])('reports %s as nothing to persist', (_label, info) => {
        expect(xtreamDetailContentMetadata(info)).toBeNull();
    });

    it('takes only the first backdrop', () => {
        expect(
            xtreamDetailContentMetadata({
                backdrop_path: ['https://a.example/1.jpg', 'https://a.example/2.jpg'],
            })
        ).toEqual({ backdropUrl: 'https://a.example/1.jpg' });
    });
});

describe('xtreamContentMetadataKey', () => {
    it('changes when enrichment adds the id to an already-backfilled patch', () => {
        // The detail effect skips a repeat write by comparing this key. Keyed
        // on the backdrop alone, it would suppress the write that carries the
        // id arriving moments later.
        const beforeEnrichment = xtreamDetailContentMetadata({
            backdrop_path: ['https://example.com/b.jpg'],
        });
        const afterEnrichment = xtreamDetailContentMetadata({
            backdrop_path: ['https://example.com/b.jpg'],
            tmdb_id: 603,
        });

        expect(xtreamContentMetadataKey(beforeEnrichment)).not.toEqual(
            xtreamContentMetadataKey(afterEnrichment)
        );
    });

    it('is stable for an unchanged patch', () => {
        const patch = { backdropUrl: 'https://example.com/b.jpg', tmdbId: 603 };

        expect(xtreamContentMetadataKey(patch)).toEqual(
            xtreamContentMetadataKey({ ...patch })
        );
    });

    it('is empty for no patch', () => {
        expect(xtreamContentMetadataKey(null)).toBe('');
    });
});
