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
