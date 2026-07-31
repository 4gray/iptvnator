import type { TmdbMovieDetails, TmdbTvDetails } from '@iptvnator/services';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import {
    mapProviderToDownloadSnapshot,
    mergeSnapshotWithTmdb,
} from './download-metadata.mapper';

const providerSnapshot: DownloadMetadataSnapshot = {
    version: 1,
    language: 'de',
    mediaKind: 'movie',
    title: 'Provider title',
    originalTitle: 'Provider original',
    plot: 'Provider plot',
    posterUrl: 'https://images.example.test/provider-poster.jpg',
    providerCategoryId: '12',
    cast: [{ name: 'Provider actor', role: 'Provider role' }],
    enrichedAt: '2026-07-31T08:30:00.000Z',
};

const tmdbMovie: TmdbMovieDetails = {
    id: 603,
    title: 'TMDB translated title',
    original_title: 'TMDB original title',
    overview: 'Localized TMDB overview',
    release_date: '1999-03-31',
    runtime: 136,
    genres: [
        { id: 1, name: 'Science Fiction' },
        { id: 2, name: 'Action' },
    ],
    vote_average: 8.2,
    vote_count: 100,
    poster_path: '/tmdb-poster.jpg',
    backdrop_path: '/tmdb-backdrop.jpg',
    credits: {
        cast: [
            {
                id: 1,
                name: 'Actor One',
                character: 'Lead',
                order: 0,
                profile_path: '/one.jpg',
            },
            {
                id: 2,
                name: 'Actor Two',
                character: 'Guide',
                order: 1,
                profile_path: '/two.jpg',
            },
        ],
        crew: [
            {
                id: 3,
                name: 'Director One',
                job: 'Director',
                profile_path: '/director.jpg',
            },
        ],
    },
};

describe('download metadata mapper', () => {
    it('keeps provider identity while TMDB replaces editorial fields', () => {
        const merged = mergeSnapshotWithTmdb(
            providerSnapshot,
            tmdbMovie,
            'xtream'
        );

        expect(merged.title).toBe('Provider title');
        expect(merged.originalTitle).toBe('Provider original');
        expect(merged.providerCategoryId).toBe('12');
        expect(merged.plot).toBe('Localized TMDB overview');
        expect(merged.posterUrl).toBe(
            'https://image.tmdb.org/t/p/w500/tmdb-poster.jpg'
        );
        expect(merged.backdropUrl).toBe(
            'https://image.tmdb.org/t/p/w1280/tmdb-backdrop.jpg'
        );
        expect(merged.cast).toHaveLength(2);
        expect(merged.cast?.[0]).toEqual(
            expect.objectContaining({ name: 'Actor One', role: 'Lead' })
        );
        expect(merged.creators?.[0]?.name).toBe('Director One');
        expect(merged.tmdbId).toBe(603);
    });

    it('keeps a normalized Stalker provider title through TMDB enrichment', () => {
        const merged = mergeSnapshotWithTmdb(
            providerSnapshot,
            tmdbMovie,
            'stalker'
        );

        expect(merged.title).toBe('Provider title');
        expect(merged.originalTitle).toBe('Provider original');
    });

    it('maps a Stalker recent payload without copying credentials or playback fields', () => {
        const mapped = mapProviderToDownloadSnapshot({
            source: 'stalker',
            language: 'en',
            mediaKind: 'movie',
            fallback: providerSnapshot,
            provider: {
                movie_id: '41',
                title: 'Stalker provider title',
                category_id: 'vod',
                cover: 'https://images.example.test/stalker.jpg',
                description: 'Stalker provider plot',
                actors: 'First Actor, Second Actor',
                genre: 'Drama, Mystery',
                cmd: 'ffmpeg http://stream.example.test/movie/41',
                portalUrl: 'https://portal.example.test',
                username: 'account-user',
                password: 'account-secret',
                token: 'session-token',
            },
        });

        expect(mapped.title).toBe('Stalker provider title');
        expect(mapped.plot).toBe('Stalker provider plot');
        expect(mapped.posterUrl).toBe(
            'https://images.example.test/stalker.jpg'
        );
        expect(mapped.genres).toEqual(['Drama', 'Mystery']);
        expect(mapped.cast?.map(({ name }) => name)).toEqual([
            'First Actor',
            'Second Actor',
        ]);
        const encoded = JSON.stringify(mapped);
        expect(encoded).not.toContain('account-secret');
        expect(encoded).not.toContain('session-token');
        expect(encoded).not.toContain('stream.example.test');
        expect(mapped).not.toHaveProperty('cmd');
    });

    it('prefers a flat Stalker recent title over its generic name', () => {
        const mapped = mapProviderToDownloadSnapshot({
            source: 'stalker',
            language: 'en',
            mediaKind: 'movie',
            fallback: providerSnapshot,
            provider: {
                title: 'Canonical recent title',
                name: 'video_name_format',
            },
        });

        expect(mapped.title).toBe('Canonical recent title');
    });

    it('prefers a flat Stalker recent original title over its generic name', () => {
        const mapped = mapProviderToDownloadSnapshot({
            source: 'stalker',
            language: 'en',
            mediaKind: 'movie',
            fallback: providerSnapshot,
            provider: {
                o_name: 'Canonical recent original title',
                name: 'video_name_format',
            },
        });

        expect(mapped.title).toBe('Canonical recent original title');
        expect(mapped.originalTitle).toBe('Canonical recent original title');
    });

    it('normalizes nested Stalker series identity and legacy editorial fallbacks', () => {
        const fallback: DownloadMetadataSnapshot = {
            version: 1,
            language: 'en',
            mediaKind: 'series',
            title: 'Downloaded episode title',
            episode: {
                title: 'Local episode',
                seasonNumber: 2,
                episodeNumber: 4,
            },
        };

        const mapped = mapProviderToDownloadSnapshot({
            source: 'stalker',
            language: 'en',
            mediaKind: 'series',
            fallback,
            provider: {
                title: 'Root episode title',
                screenshot_uri:
                    'https://images.example.test/stills/legacy-series.jpg',
                genres_str: 'Drama, Mystery',
                year: '2024',
                info: {
                    name: 'Nested parent series title',
                    o_name: 'Original parent title',
                },
            },
        });

        expect(mapped.title).toBe('Nested parent series title');
        expect(mapped.originalTitle).toBe('Original parent title');
        expect(mapped.posterUrl).toBe(
            'https://images.example.test/stills/legacy-series.jpg'
        );
        expect(mapped.genres).toEqual(['Drama', 'Mystery']);
        expect(mapped.releaseDate).toBe('2024');
        expect(mapped.year).toBe(2024);
        expect(mapped.episode).toEqual(fallback.episode);
    });

    it('bounds mapped people and genres to the persisted DTO limits', () => {
        const mapped = mapProviderToDownloadSnapshot({
            source: 'xtream',
            language: 'en',
            mediaKind: 'movie',
            fallback: providerSnapshot,
            provider: {
                title: 'Large provider record',
                category_id: 5,
                genre: Array.from(
                    { length: 25 },
                    (_, index) => `Genre ${index + 1}`
                ).join(', '),
                actors: Array.from(
                    { length: 35 },
                    (_, index) => `Actor ${index + 1}`
                ).join(', '),
                director: Array.from(
                    { length: 35 },
                    (_, index) => `Creator ${index + 1}`
                ).join(', '),
            },
        });

        expect(mapped.genres).toHaveLength(20);
        expect(mapped.cast).toHaveLength(30);
        expect(mapped.creators).toHaveLength(30);
    });

    it('preserves the downloaded episode and never derives episodes from TMDB series data', () => {
        const snapshot: DownloadMetadataSnapshot = {
            version: 1,
            language: 'en',
            mediaKind: 'series',
            title: 'Provider series',
            providerCategoryId: '9',
            episode: {
                title: 'Downloaded episode',
                plot: 'Local episode plot',
                stillUrl: 'https://images.example.test/local-still.jpg',
                seasonNumber: 2,
                episodeNumber: 7,
            },
            enrichedAt: '2026-07-31T08:30:00.000Z',
        };
        const details = {
            id: 900,
            name: 'TMDB series title',
            overview: 'Localized series overview',
            poster_path: '/series.jpg',
            seasons: [{ season_number: 1, episode_count: 12 }],
            episodes: [{ season_number: 1, episode_number: 1 }],
        } as TmdbTvDetails & Record<string, unknown>;

        const merged = mergeSnapshotWithTmdb(snapshot, details, 'stalker');

        expect(merged.title).toBe('Provider series');
        expect(merged.episode).toEqual(snapshot.episode);
        expect(merged).not.toHaveProperty('episodes');
        expect(merged).not.toHaveProperty('seasons');
    });

    it('does not fabricate episode metadata for a legacy series snapshot without it', () => {
        const snapshot: DownloadMetadataSnapshot = {
            version: 1,
            language: 'en',
            mediaKind: 'series',
            title: 'Legacy provider series',
        };

        const merged = mergeSnapshotWithTmdb(
            snapshot,
            {
                id: 901,
                name: 'TMDB series title',
                overview: 'Localized series overview',
            },
            'xtream'
        );

        expect(merged).not.toHaveProperty('episode');
    });
});
