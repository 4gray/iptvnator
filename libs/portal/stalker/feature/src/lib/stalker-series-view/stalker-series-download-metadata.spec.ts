import { createStalkerSeriesDownloadSnapshot } from './stalker-series-download-metadata';

describe('createStalkerSeriesDownloadSnapshot', () => {
    it('preserves zero coordinates from the download row', () => {
        const snapshot = createStalkerSeriesDownloadSnapshot({
            item: {
                id: '50',
                category_id: '18',
                info: {
                    name: 'Signal House',
                    description: 'Parent plot',
                    actors: 'Sienna Wave',
                    director: 'Cora Bell',
                },
            } as never,
            episode: {
                title: 'The Call',
                info: { plot: 'Episode plot', movie_image: 'still.jpg' },
            } as never,
            language: 'en',
            seriesTitle: 'Signal House',
            seasonNumber: 0,
            episodeNumber: '0',
        });

        expect(snapshot).toEqual(
            expect.objectContaining({
                mediaKind: 'series',
                title: 'Signal House',
                cast: [{ name: 'Sienna Wave' }],
                creators: [{ name: 'Cora Bell' }],
                episode: expect.objectContaining({
                    seasonNumber: 0,
                    episodeNumber: 0,
                    title: 'The Call',
                }),
            })
        );
    });

    it.each([
        [Number.NaN, 2],
        [1, -1],
        [1.5, 2],
    ])('omits episode metadata for malformed row coordinates', (season, ep) => {
        const snapshot = createStalkerSeriesDownloadSnapshot({
            item: { id: '50', info: { name: 'Signal House' } } as never,
            episode: { title: 'The Call', info: [] } as never,
            language: 'en',
            seriesTitle: 'Signal House',
            seasonNumber: season,
            episodeNumber: ep,
        });

        expect(snapshot.mediaKind).toBe('series');
        expect(snapshot.episode).toBeUndefined();
    });
});
