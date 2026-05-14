import {
    findXtreamVodDuplicateVariants,
    groupXtreamSeriesDuplicates,
    groupXtreamVodDuplicates,
    matchesXtreamSeriesSearchTerm,
    matchesXtreamVodSearchTerm,
} from './vod-duplicates.util';

describe('vod duplicates utilities', () => {
    it('collapses variants of the same IMDb title and keeps the highest quality as default', () => {
        const items = [
            {
                stream_id: 101,
                imdb_id: 'tt1234567',
                name: 'Example Movie 1080p WEB-DL H264',
                container_extension: 'mp4',
                added: '100',
            },
            {
                stream_id: 102,
                imdb_id: 'tt1234567',
                name: 'Example Movie UHD 2160p WEB-DL HEVC',
                container_extension: 'mkv',
                added: '90',
            },
            {
                stream_id: 201,
                imdb_id: 'tt7654321',
                name: 'Other Movie 720p',
                container_extension: 'mp4',
                added: '80',
            },
        ];

        const grouped = groupXtreamVodDuplicates(items);
        const duplicate = grouped.find(
            (item) => item.duplicateGroupKey === 'imdb:tt1234567'
        );

        expect(grouped).toHaveLength(2);
        expect(duplicate?.stream_id).toBe(102);
        expect(duplicate?.duplicateCount).toBe(2);
        expect(duplicate?.duplicateDefaultVariantId).toBe('102');
        expect(duplicate?.duplicateQualityLabel).toContain('2160p');
        expect(
            duplicate?.duplicateVariants?.map((item) => item.stream_id)
        ).toEqual([102, 101]);
    });

    it('uses IMDb matched titles to group localized provider titles', () => {
        const items = [
            {
                stream_id: 301,
                name: 'Il Padrino 1080p ITA',
                imdbMatchedTitle: 'The Godfather',
                imdbMatchedYear: 1972,
                container_extension: 'mp4',
            },
            {
                stream_id: 302,
                name: 'The Godfather 2160p UHD',
                imdbMatchedTitle: 'The Godfather',
                imdbMatchedYear: 1972,
                container_extension: 'mkv',
            },
        ];

        const variants = findXtreamVodDuplicateVariants(items, items[0]);

        expect(variants.map((item) => item.stream_id)).toEqual([302, 301]);
        expect(variants[0].duplicateQualityLabel).toContain('2160p');
    });

    it('collapses same-poster localized variants and keeps the UHD variant as default', () => {
        const items = [
            {
                stream_id: 401,
                name: 'IT - Harry Potter E La Camera Dei Segreti 1080p',
                poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                container_extension: 'mp4',
            },
            {
                stream_id: 402,
                name: 'IT -uhd Harry Potter e la camera dei segreti',
                poster_url:
                    'https://image.tmdb.org/t/p/w500/chamber.jpg?cached=1',
                container_extension: 'mkv',
            },
        ];

        const grouped = groupXtreamVodDuplicates(items);

        expect(grouped).toHaveLength(1);
        expect(grouped[0].stream_id).toBe(402);
        expect(grouped[0].duplicateCount).toBe(2);
        expect(grouped[0].duplicateQualityLabel).toContain('2160p');
        expect(
            grouped[0].duplicateVariants?.map((item) => item.stream_id)
        ).toEqual([402, 401]);
    });

    it('matches search terms against every variant and resolved IMDb title', () => {
        const grouped = groupXtreamVodDuplicates([
            {
                stream_id: 501,
                name: 'IT - Harry Potter E La Camera Dei Segreti 1080p',
                poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                container_extension: 'mp4',
            },
            {
                stream_id: 502,
                name: 'Harry Potter and the Chamber of Secrets UHD',
                imdbMatchedTitle: 'Harry Potter and the Chamber of Secrets',
                imdbMatchedYear: 2002,
                poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                container_extension: 'mkv',
            },
        ]);

        expect(
            matchesXtreamVodSearchTerm(grouped[0], 'harry potter e la camera')
        ).toBe(true);
        expect(
            matchesXtreamVodSearchTerm(grouped[0], 'harry potter chamber')
        ).toBe(true);
    });

    it('uses TMDb IDs as a stable key when localized titles differ', () => {
        const grouped = groupXtreamVodDuplicates([
            {
                stream_id: 601,
                name: 'IT - La Citta Incantata 1080p',
                tmdb_id: 129,
                poster_url: 'https://cdn.example/italian.jpg',
            },
            {
                stream_id: 602,
                name: 'Spirited Away 2160p UHD',
                tmdb_id: 129,
                poster_url: 'https://cdn.example/english.jpg',
            },
        ]);

        expect(grouped).toHaveLength(1);
        expect(grouped[0].duplicateGroupKey).toBe('tmdb:129');
        expect(grouped[0].stream_id).toBe(602);
    });

    it('can use manual IMDb overrides as stable keys for dedupe', () => {
        const grouped = groupXtreamVodDuplicates([
            {
                stream_id: 611,
                name: 'Titolo provider sbagliato 1080p',
                manualImdbId: 'tt0241527',
            },
            {
                stream_id: 612,
                name: 'Harry Potter and the Philosopher Stone 2160p',
                imdbOverrideId: 'https://www.imdb.com/title/tt0241527/',
            },
        ]);

        expect(grouped).toHaveLength(1);
        expect(grouped[0].duplicateGroupKey).toBe('imdb:tt0241527');
        expect(grouped[0].stream_id).toBe(612);
    });

    it('applies the same external-ID grouping and multilingual search to series', () => {
        const grouped = groupXtreamSeriesDuplicates([
            {
                series_id: 701,
                name: 'La Casa di Carta',
                imdb_id: 'tt6468322',
                poster_url: 'https://cdn.example/la-casa.jpg',
            },
            {
                series_id: 702,
                name: 'Money Heist',
                imdb_id: 'tt6468322',
                imdbMatchedTitle: 'Money Heist',
                poster_url: 'https://cdn.example/money-heist.jpg',
            },
        ]);

        expect(grouped).toHaveLength(1);
        expect(grouped[0].duplicateGroupKey).toBe('imdb:tt6468322');
        expect(grouped[0].duplicateCount).toBe(2);
        expect(matchesXtreamSeriesSearchTerm(grouped[0], 'money heist')).toBe(
            true
        );
        expect(
            matchesXtreamSeriesSearchTerm(grouped[0], 'la casa di carta')
        ).toBe(true);
    });
});
