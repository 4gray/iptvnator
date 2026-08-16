import { mapDiscoverResults } from './tmdb-discover';

describe('mapDiscoverResults', () => {
    it('keeps the original title as a matching alias', () => {
        const [movie] = mapDiscoverResults(
            [
                {
                    id: 1,
                    title: 'Ирония судьбы',
                    original_title: 'Ирония судьбы, или С лёгким паром!',
                    release_date: '1976-01-01',
                },
            ],
            'movie'
        );

        // TMDB localizes `title` while the catalog stores whatever the
        // panel named the file, which is often the original
        expect(movie.title).toBe('Ирония судьбы');
        expect(movie.originalTitle).toBe(
            'Ирония судьбы, или С лёгким паром!'
        );
    });

    it('reads the original name for tv results', () => {
        const [show] = mapDiscoverResults(
            [{ id: 2, name: 'Тьма', original_name: 'Dark' }],
            'tv'
        );

        expect(show.originalTitle).toBe('Dark');
    });

    it('has no alias when the original matches the localized title', () => {
        const [movie] = mapDiscoverResults(
            [{ id: 3, title: 'Dune', original_title: 'Dune' }],
            'movie'
        );

        expect(movie.originalTitle).toBeNull();
    });

    it('drops untitled results and deduplicates by id', () => {
        const mapped = mapDiscoverResults(
            [
                { id: 4, title: 'Alien' },
                { id: 4, title: 'Alien' },
                { id: 5, title: '   ' },
            ],
            'movie'
        );

        expect(mapped.map((entry) => entry.tmdbId)).toEqual([4]);
    });
});
