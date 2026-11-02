import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { decodeProviderGzip, readProviderBody } from './provider-response';

describe('provider response limits', () => {
    it('stops a continuous body at the byte limit and closes its iterator', async () => {
        let closed = false;
        async function* chunks() {
            try {
                for (let index = 0; index < 10; index++) yield Buffer.alloc(16);
            } finally {
                closed = true;
            }
        }
        const stream = Readable.from(chunks());
        await expect(
            readProviderBody(stream, true, undefined, undefined, 32)
        ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
        expect(stream.destroyed).toBe(true);
        expect(closed).toBe(true);
    });

    it('accepts a response exactly at the limit', async () => {
        await expect(
            readProviderBody(
                Readable.from(['1234', '5678']),
                false,
                undefined,
                undefined,
                8
            )
        ).resolves.toBe(12345678);
    });

    it('counts UTF-8 bytes rather than characters', async () => {
        await expect(
            readProviderBody(
                Readable.from(['ééé']),
                false,
                undefined,
                undefined,
                5
            )
        ).rejects.toMatchObject({
            code: 'PROVIDER_RESPONSE_TOO_LARGE',
        });
    });

    it('bounds gzip output, even when its compressed body fits', () => {
        const compressed = gzipSync('x'.repeat(4096));
        expect(compressed.length).toBeLessThan(128);
        expect(() => decodeProviderGzip(compressed, 128)).toThrow(
            'Provider response exceeds the configured size limit'
        );
        expect(decodeProviderGzip(gzipSync('guide'), 5)).toBe('guide');
    });
});
