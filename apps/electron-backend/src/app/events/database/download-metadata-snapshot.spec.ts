import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import {
    decodeDownloadMetadataSnapshot,
    DOWNLOAD_METADATA_MAX_BYTES,
    encodeDownloadMetadataSnapshot,
} from './download-metadata-snapshot';

const validSnapshot: DownloadMetadataSnapshot = {
    version: 1,
    language: 'en',
    mediaKind: 'movie',
    title: 'The Example',
    plot: 'A bounded offline summary.',
    genres: ['Drama', 'Mystery'],
    rating: 8.2,
    cast: [
        {
            tmdbPersonId: 7,
            name: 'Example Actor',
            role: 'Lead',
            profileUrl: 'https://image.tmdb.org/example.jpg',
        },
    ],
};

describe('download metadata snapshot', () => {
    it('encodes a valid normalized snapshot without changing its shape', () => {
        expect(encodeDownloadMetadataSnapshot(validSnapshot)).toBe(
            JSON.stringify(validSnapshot)
        );
    });

    it('rejects an unsupported snapshot version', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                version: 2,
            } as never)
        ).toThrow('Invalid download metadata snapshot');
    });

    it('rejects an unsupported media kind', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                mediaKind: 'live',
            } as never)
        ).toThrow('Invalid download metadata snapshot');
    });

    it('rejects an empty display title', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                title: '   ',
            })
        ).toThrow('Invalid download metadata snapshot');
    });

    it('rejects an empty snapshot language', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                language: '   ',
            })
        ).toThrow('Invalid download metadata snapshot');
    });

    it('bounds cast and creator arrays to 30 people', () => {
        const people = Array.from({ length: 35 }, (_, index) => ({
            name: `Person ${index}`,
        }));

        const decoded = JSON.parse(
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                cast: people,
                creators: people,
            })
        ) as DownloadMetadataSnapshot;

        expect(decoded.cast).toHaveLength(30);
        expect(decoded.creators).toHaveLength(30);
        expect(decoded.cast?.at(-1)?.name).toBe('Person 29');
    });

    it('bounds genres to 20 entries', () => {
        const decoded = JSON.parse(
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                genres: Array.from(
                    { length: 25 },
                    (_, index) => `Genre ${index}`
                ),
            })
        ) as DownloadMetadataSnapshot;

        expect(decoded.genres).toHaveLength(20);
        expect(decoded.genres?.at(-1)).toBe('Genre 19');
    });

    it('rejects an allowed field beyond the fixed UTF-8 byte ceiling', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                plot: '🛰️'.repeat(DOWNLOAD_METADATA_MAX_BYTES),
            })
        ).toThrow('Download metadata snapshot is too large');
    });

    it('rejects a huge discarded array before walking its entries', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                ignored: Array.from({ length: 10_000 }, () => ({
                    harmless: 'value',
                })),
            } as never)
        ).toThrow('Invalid download metadata snapshot');
    });

    it('rejects a huge discarded object before walking all its keys', () => {
        const ignored = Object.fromEntries(
            Array.from({ length: 10_000 }, (_, index) => [
                `harmless${index}`,
                index,
            ])
        );

        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                ignored,
            } as never)
        ).toThrow('Invalid download metadata snapshot');
    });

    it('rejects discarded data beyond the raw traversal depth budget', () => {
        let ignored: Record<string, unknown> = {};
        for (let depth = 0; depth < 50; depth += 1) {
            ignored = { nested: ignored };
        }

        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                ignored,
            } as never)
        ).toThrow('Invalid download metadata snapshot');
    });

    it('rejects discarded strings beyond the cumulative raw byte budget', () => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                ignored: 'x'.repeat(DOWNLOAD_METADATA_MAX_BYTES + 1),
            } as never)
        ).toThrow('Download metadata snapshot is too large');
    });

    it.each(['url', 'headers', 'password', 'macAddress', 'cookie'])(
        'rejects a nested credential-bearing %s key',
        (forbiddenKey) => {
            const unsafe = {
                ...validSnapshot,
                ignored: {
                    deeper: [{ [forbiddenKey]: 'must-not-persist' }],
                },
            };

            expect(() =>
                encodeDownloadMetadataSnapshot(unsafe as never)
            ).toThrow('Invalid download metadata snapshot');
        }
    );

    it.each([NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
        'rejects unsafe numeric metadata %s',
        (year) => {
            expect(() =>
                encodeDownloadMetadataSnapshot({
                    ...validSnapshot,
                    year,
                })
            ).toThrow('Invalid download metadata snapshot');
        }
    );

    it('trims display strings and drops unknown harmless fields', () => {
        const encoded = encodeDownloadMetadataSnapshot({
            ...validSnapshot,
            language: ' en ',
            title: ' The Example ',
            genres: [' Drama '],
            ignored: 'not persisted',
        } as never);

        expect(JSON.parse(encoded)).toEqual({
            ...validSnapshot,
            language: 'en',
            title: 'The Example',
            genres: ['Drama'],
        });
    });

    it('accepts absolute credential-free TMDB and CDN artwork URLs', () => {
        const snapshot: DownloadMetadataSnapshot = {
            ...validSnapshot,
            posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
            backdropUrl:
                'https://cdn.example.test/art/backdrop.webp?width=1280',
            cast: [
                {
                    name: 'Actor',
                    profileUrl: 'https://image.tmdb.org/t/p/w185/profile.png',
                },
            ],
            episode: {
                episodeNumber: 2,
                seasonNumber: 1,
                stillUrl:
                    'https://cdn.example.test/stills/episode-2.jpeg?width=640',
            },
        };

        expect(JSON.parse(encodeDownloadMetadataSnapshot(snapshot))).toEqual(
            snapshot
        );
    });

    it('accepts trusted extensionless artwork hosts and image endpoints', () => {
        const snapshot: DownloadMetadataSnapshot = {
            ...validSnapshot,
            posterUrl: 'https://image.tmdb.org/t/p/w500/extensionless-poster',
            backdropUrl: 'https://picsum.photos/1280/720',
            cast: [
                {
                    name: 'Actor',
                    profileUrl:
                        'https://cdn.example.test/api?action=get_image&id=profile-1',
                },
            ],
            episode: {
                episodeNumber: 2,
                seasonNumber: 1,
                stillUrl: 'https://cdn.example.test/images/still/episode-2',
            },
        };

        expect(JSON.parse(encodeDownloadMetadataSnapshot(snapshot))).toEqual(
            snapshot
        );
    });

    it('accepts artwork filenames containing title-like credential words', () => {
        const snapshot: DownloadMetadataSnapshot = {
            ...validSnapshot,
            posterUrl: 'https://images.example.test/posters/secret-garden.jpg',
            episode: {
                episodeNumber: 9,
                seasonNumber: 1,
                stillUrl: 'https://images.example.test/stills/session-9.jpg',
            },
        };

        expect(JSON.parse(encodeDownloadMetadataSnapshot(snapshot))).toEqual(
            snapshot
        );
    });

    it('normalizes blank optional artwork sentinels as absent', () => {
        expect(
            JSON.parse(
                encodeDownloadMetadataSnapshot({
                    ...validSnapshot,
                    posterUrl: '   ',
                    backdropUrl: '\t',
                    cast: [{ name: 'Actor', profileUrl: '\n' }],
                    episode: {
                        episodeNumber: 2,
                        seasonNumber: 1,
                        stillUrl: ' ',
                    },
                })
            )
        ).toEqual({
            ...validSnapshot,
            cast: [{ name: 'Actor' }],
            episode: {
                episodeNumber: 2,
                seasonNumber: 1,
            },
        });
    });

    it.each([
        [
            'poster userinfo',
            {
                posterUrl:
                    'https://viewer:secret@images.example.test/poster.jpg',
            },
        ],
        [
            'backdrop credential query',
            {
                backdropUrl:
                    'https://images.example.test/backdrop.jpg?access_token=secret',
            },
        ],
        [
            'person stream URL',
            {
                cast: [
                    {
                        name: 'Actor',
                        profileUrl:
                            'https://streams.example.test/channel/index.m3u8',
                    },
                ],
            },
        ],
        [
            'episode session query',
            {
                episode: {
                    episodeNumber: 1,
                    seasonNumber: 1,
                    stillUrl:
                        'https://images.example.test/still.jpg?sessionId=secret',
                },
            },
        ],
        [
            'poster media URL',
            {
                posterUrl: 'https://media.example.test/movie.mp4',
            },
        ],
        [
            'extensionless stream endpoint',
            {
                posterUrl: 'https://streams.example.test/live/123',
            },
        ],
        [
            'URL fragment',
            {
                posterUrl: 'https://images.example.test/poster.jpg#overview',
            },
        ],
        [
            'relative artwork URL',
            {
                posterUrl: '/images/poster.jpg',
            },
        ],
        [
            'non-http artwork URL',
            {
                posterUrl: 'ftp://images.example.test/poster.jpg',
            },
        ],
    ])('rejects unsafe artwork in %s', (_label, fields) => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                ...fields,
            } as DownloadMetadataSnapshot)
        ).toThrow('Invalid download metadata snapshot');
    });

    it.each([
        'access_token',
        'token',
        'password',
        'secret',
        'cookie',
        'session',
        'signature',
        'credential',
        'AUTH',
        'device_mac',
        'api-key',
        'access_token=secret',
        'token:abc',
    ])('rejects credential-like artwork path token %s', (pathToken) => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                posterUrl: `https://images.example.test/${pathToken}/value/poster.jpg`,
            })
        ).toThrow('Invalid download metadata snapshot');
    });

    it.each([
        'token',
        'AUTH',
        'api_key',
        'password',
        'device_mac',
        'cookie',
        'sessionId',
        'X-Amz-Signature',
        'client_secret',
        'credential',
    ])('rejects credential-like artwork query key %s', (queryKey) => {
        expect(() =>
            encodeDownloadMetadataSnapshot({
                ...validSnapshot,
                posterUrl: `https://images.example.test/poster.jpg?${queryKey}=secret`,
            })
        ).toThrow('Invalid download metadata snapshot');
    });

    it('decodes malformed persisted JSON as absent metadata', () => {
        expect(decodeDownloadMetadataSnapshot('{not-json')).toBeUndefined();
    });

    it('decodes invalid persisted metadata as absent metadata', () => {
        expect(
            decodeDownloadMetadataSnapshot(
                JSON.stringify({ ...validSnapshot, title: ' ' })
            )
        ).toBeUndefined();
    });
});
