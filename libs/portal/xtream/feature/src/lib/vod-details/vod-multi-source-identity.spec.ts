import {
    resolveVodMultiSourceMovie,
    vodMultiSourceMovieKey,
    vodMultiSourceSessionKey,
    type VodMultiSourceMovie,
} from './vod-multi-source-identity';

const BASE = {
    playlistId: 'playlist-1',
    playlistName: 'Portal One',
    vodId: 101,
    vodInfo: null,
    catalogItem: null,
};

function movie(overrides: Partial<VodMultiSourceMovie> = {}) {
    return {
        playlistId: 'playlist-1',
        playlistName: 'Portal One',
        contentId: 101,
        title: 'Dune',
        year: null,
        ...overrides,
    } as VodMultiSourceMovie;
}

describe('resolveVodMultiSourceMovie', () => {
    it('is null until a title is knowable', () => {
        expect(resolveVodMultiSourceMovie(BASE)).toBeNull();
    });

    it('is null without a usable playlist or vod id', () => {
        const withTitle = { ...BASE, catalogItem: { title: 'Dune' } };
        expect(
            resolveVodMultiSourceMovie({ ...withTitle, playlistId: null })
        ).toBeNull();
        expect(
            resolveVodMultiSourceMovie({ ...withTitle, vodId: 0 })
        ).toBeNull();
    });

    it('takes the title from the catalog row before metadata arrives', () => {
        const resolved = resolveVodMultiSourceMovie({
            ...BASE,
            catalogItem: { title: 'Dune' },
        });

        expect(resolved).toEqual(
            expect.objectContaining({ title: 'Dune', contentId: 101 })
        );
    });

    it('prefers the provider metadata title once it lands', () => {
        const resolved = resolveVodMultiSourceMovie({
            ...BASE,
            catalogItem: { title: 'Dune' },
            vodInfo: {
                name: 'Dune: Part Two',
                releasedate: '2024-02-27',
                tmdb_id: 693134,
            } as never,
        });

        expect(resolved?.title).toBe('Dune: Part Two');
        expect(resolved?.year).toBe(2024);
        expect(resolved?.tmdbId).toBe(693134);
    });

    it('ignores a year that belongs to the movie’s name', () => {
        const resolved = resolveVodMultiSourceMovie({
            ...BASE,
            catalogItem: { title: '2001: A Space Odyssey' },
        });

        // Reading any year anywhere calls this a 2001 film. Every genuine copy
        // states 1968 and fails the year gate, so the movie has no alternative
        // sources at all — and its pin key moves as soon as enrichment
        // supplies the real year.
        expect(resolved?.year).toBeNull();
    });

    it('reads a release tag in either shape', () => {
        expect(
            resolveVodMultiSourceMovie({
                ...BASE,
                catalogItem: { title: 'Dune (2021)' },
            })?.year
        ).toBe(2021);
        expect(
            resolveVodMultiSourceMovie({
                ...BASE,
                catalogItem: { title: 'The Matrix 1999' },
            })?.year
        ).toBe(1999);
    });

    it('prefers the stated release date over anything in the title', () => {
        const resolved = resolveVodMultiSourceMovie({
            ...BASE,
            catalogItem: { title: 'The Matrix 1999' },
            vodInfo: {
                name: 'The Matrix 1999',
                releasedate: '1999-03-31',
            } as never,
        });

        expect(resolved?.year).toBe(1999);
    });

    it('falls back to the playlist id when the name is empty', () => {
        const resolved = resolveVodMultiSourceMovie({
            ...BASE,
            playlistName: '   ',
            catalogItem: { title: 'Dune' },
        });

        expect(resolved?.playlistName).toBe('playlist-1');
    });
});

describe('vodMultiSourceMovieKey', () => {
    it('is stable for the same movie described the same way', () => {
        expect(vodMultiSourceMovieKey(movie())).toBe(
            vodMultiSourceMovieKey(movie())
        );
    });

    it('changes when enrichment supplies the release year', () => {
        // The catalog title usually arrives before get_vod_info. If the key
        // ignored the year, discovery would stay yearless forever because the
        // host would never see the identity change.
        expect(vodMultiSourceMovieKey(movie({ year: 2021 }))).not.toBe(
            vodMultiSourceMovieKey(movie())
        );
    });

    it('changes when enrichment supplies a TMDB id', () => {
        // Without this, a `tmdb:`-keyed pin saved earlier would never be found,
        // because the pin lookup keys are only rebuilt on a reload.
        expect(vodMultiSourceMovieKey(movie({ tmdbId: 438631 }))).not.toBe(
            vodMultiSourceMovieKey(movie())
        );
    });

    it('changes for a different movie in the same playlist', () => {
        expect(vodMultiSourceMovieKey(movie({ contentId: 202 }))).not.toBe(
            vodMultiSourceMovieKey(movie())
        );
    });
});

describe('vodMultiSourceSessionKey', () => {
    it('ignores everything enrichment can change', () => {
        // The whole point of the second key: the movie key SHOULD react to a
        // year and a TMDB id arriving, so discovery reruns — but that rerun
        // must not be mistaken for a different film and reset the session
        // out from under the source that is playing.
        expect(
            vodMultiSourceSessionKey(
                movie({ title: 'Dune (2021)', year: 2021, tmdbId: 438631 })
            )
        ).toBe(vodMultiSourceSessionKey(movie()));
    });

    it('separates two movies and two playlists', () => {
        expect(vodMultiSourceSessionKey(movie({ contentId: 202 }))).not.toBe(
            vodMultiSourceSessionKey(movie())
        );
        expect(
            vodMultiSourceSessionKey(movie({ playlistId: 'playlist-2' }))
        ).not.toBe(vodMultiSourceSessionKey(movie()));
    });
});
