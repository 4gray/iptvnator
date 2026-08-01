import { createXtreamSeriesDownloadMetadataContext } from './serial-download-metadata';

describe('createXtreamSeriesDownloadMetadataContext', () => {
    it('maps already-enriched series metadata to the shared context', () => {
        const context = createXtreamSeriesDownloadMetadataContext(
            {
                name: 'Signal House',
                plot: 'Series plot',
                cover: 'poster.jpg',
                genre: 'Drama, Mystery',
                releaseDate: '2024-04-10',
                episode_run_time: '47',
                rating: '8.2',
                category_id: '7',
                backdrop_path: ['backdrop.jpg'],
                tmdb_id: 123,
                tmdb_cast: [
                    {
                        name: 'Sienna Wave',
                        character: 'Mara',
                        tmdbPersonId: 10,
                    },
                ],
                tmdb_directors: [{ name: 'Cora Bell', tmdbPersonId: 11 }],
            } as never,
            'de'
        );

        expect(context).toEqual(
            expect.objectContaining({
                language: 'de',
                title: 'Signal House',
                plot: 'Series plot',
                year: 2024,
                durationMinutes: 47,
                genres: ['Drama', 'Mystery'],
                rating: 8.2,
                tmdbId: 123,
                cast: [
                    {
                        name: 'Sienna Wave',
                        role: 'Mara',
                        tmdbPersonId: 10,
                    },
                ],
                creators: [{ name: 'Cora Bell', tmdbPersonId: 11 }],
            })
        );
    });

    it('keeps sparse provider data valid', () => {
        const context = createXtreamSeriesDownloadMetadataContext(
            { name: 'Sparse Show' } as never,
            'en'
        );

        expect(context.language).toBe('en');
        expect(context.title).toBe('Sparse Show');
        expect(context.cast).toBeUndefined();
    });
});
