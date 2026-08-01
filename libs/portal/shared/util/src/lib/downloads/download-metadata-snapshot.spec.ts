import type { DownloadMetadataPerson } from '@iptvnator/shared/interfaces';
import {
    createMovieDownloadSnapshot,
    createSeriesEpisodeDownloadSnapshot,
} from './download-metadata-snapshot';

function people(count: number): DownloadMetadataPerson[] {
    return Array.from({ length: count }, (_, index) => ({
        tmdbPersonId: index + 1,
        name: `Person ${index + 1}`,
        role: `Role ${index + 1}`,
        profileUrl: `https://image.tmdb.org/t/p/w185/person-${index + 1}.jpg`,
    }));
}

describe('download metadata snapshot factories', () => {
    it('creates an allowlisted movie snapshot without provider secrets or stream URLs', () => {
        const snapshot = createMovieDownloadSnapshot({
            language: 'de',
            title: 'Provider title',
            originalTitle: 'Original title',
            plot: 'Provider plot',
            posterUrl: 'https://images.example.test/poster.jpg',
            providerCategoryId: '12',
            enrichedAt: '2026-07-31T08:30:00.000Z',
            username: 'account-user',
            password: 'account-secret',
            url: 'https://stream.example.test/movie/41.m3u8',
            portalUrl: 'https://portal.example.test',
            macAddress: '00:1A:79:12:34:56',
        } as Parameters<typeof createMovieDownloadSnapshot>[0] &
            Record<string, unknown>);

        expect(snapshot).toEqual({
            version: 1,
            language: 'de',
            mediaKind: 'movie',
            title: 'Provider title',
            originalTitle: 'Original title',
            plot: 'Provider plot',
            posterUrl: 'https://images.example.test/poster.jpg',
            providerCategoryId: '12',
            enrichedAt: '2026-07-31T08:30:00.000Z',
        });
        expect(JSON.stringify(snapshot)).not.toContain('account-secret');
        expect(JSON.stringify(snapshot)).not.toContain('.m3u8');
        expect(snapshot).not.toHaveProperty('username');
        expect(snapshot).not.toHaveProperty('portalUrl');
    });

    it('creates series metadata with parent and episode display fields', () => {
        const snapshot = createSeriesEpisodeDownloadSnapshot({
            language: 'en',
            title: 'Signal House',
            plot: 'Parent series plot',
            posterUrl: 'https://images.example.test/series.jpg',
            providerCategoryId: '8',
            episode: {
                title: 'The Relay',
                plot: 'Episode plot',
                stillUrl: 'https://images.example.test/relay.jpg',
                seasonNumber: 2,
                episodeNumber: 4,
            },
            enrichedAt: '2026-07-31T08:30:00.000Z',
        });

        expect(snapshot).toEqual({
            version: 1,
            language: 'en',
            mediaKind: 'series',
            title: 'Signal House',
            plot: 'Parent series plot',
            posterUrl: 'https://images.example.test/series.jpg',
            providerCategoryId: '8',
            episode: {
                title: 'The Relay',
                plot: 'Episode plot',
                stillUrl: 'https://images.example.test/relay.jpg',
                seasonNumber: 2,
                episodeNumber: 4,
            },
            enrichedAt: '2026-07-31T08:30:00.000Z',
        });
    });

    it('bounds people to 30 and genres to 20 in deterministic input order', () => {
        const snapshot = createMovieDownloadSnapshot({
            language: 'en',
            title: 'Bounded metadata',
            genres: Array.from(
                { length: 25 },
                (_, index) => `Genre ${index + 1}`
            ),
            cast: people(35),
            creators: people(34),
        });

        expect(snapshot.genres).toHaveLength(20);
        expect(snapshot.genres?.[19]).toBe('Genre 20');
        expect(snapshot.cast).toHaveLength(30);
        expect(snapshot.cast?.[29]?.name).toBe('Person 30');
        expect(snapshot.creators).toHaveLength(30);
        expect(snapshot.creators?.[29]?.name).toBe('Person 30');
        expect(snapshot.enrichedAt).toEqual(expect.any(String));
    });

    it('keeps safe artwork names while dropping stream and credential URLs', () => {
        const snapshot = createMovieDownloadSnapshot({
            language: 'en',
            title: 'Safe artwork',
            posterUrl: 'https://streams.example.test/live/123',
            backdropUrl:
                'https://viewer:secret@images.example.test/backdrop.jpg',
            cast: [
                {
                    name: 'Actor',
                    profileUrl:
                        'https://images.example.test/posters/secret-garden.jpg',
                },
            ],
        });

        expect(snapshot.posterUrl).toBeUndefined();
        expect(snapshot.backdropUrl).toBeUndefined();
        expect(snapshot.cast?.[0]?.profileUrl).toBe(
            'https://images.example.test/posters/secret-garden.jpg'
        );
    });

    it.each([
        'accesskey',
        'accesstoken',
        'apikey',
        'auth',
        'authentication',
        'authorization',
        'cookie',
        'credential',
        'credentials',
        'devicemac',
        'key',
        'mac',
        'macaddress',
        'oauth',
        'password',
        'passwd',
        'privatekey',
        'refreshtoken',
        'secret',
        'secretkey',
        'session',
        'sig',
        'signature',
        'signingkey',
        'token',
        'username',
    ])('drops artwork containing backend credential path alias %s', (alias) => {
        const snapshot = createMovieDownloadSnapshot({
            language: 'en',
            title: 'Unsafe artwork',
            posterUrl: `https://images.example.test/${alias}/value/poster.jpg`,
        });

        expect(snapshot.posterUrl).toBeUndefined();
    });

    it.each([
        'authentication',
        'authorization',
        'cookie',
        'credential',
        'macaddress',
        'oauth',
        'password',
        'passwd',
        'secret',
        'session',
        'signature',
        'token',
        'auth',
        'key',
        'mac',
        'sig',
        'proxy-auth',
        'device-mac',
        'access-key',
        'api-key',
        'private-key',
        'secret-key',
        'signing-key',
        'username',
    ])(
        'drops artwork containing backend credential query alias %s',
        (alias) => {
            const snapshot = createMovieDownloadSnapshot({
                language: 'en',
                title: 'Unsafe artwork',
                posterUrl: `https://images.example.test/poster.jpg?${alias}=value`,
            });

            expect(snapshot.posterUrl).toBeUndefined();
        }
    );
});
