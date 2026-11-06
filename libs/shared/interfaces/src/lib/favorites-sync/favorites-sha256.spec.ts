import { createHash } from 'node:crypto';
import { m3uFavoriteReference } from './favorites-sync.reducer';

describe('HTTP-compatible favorite hashes', () => {
    it('uses exact UTF-8 URL bytes when HTTP provides no SubtleCrypto', async () => {
        const original = globalThis.crypto;
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {},
        });
        try {
            for (const url of [
                'https://synthetic.invalid/поток?x=✓',
                'https://synthetic.invalid/%61',
                'https://synthetic.invalid/a',
                ...[1, 55, 56, 63, 64, 65, 127, 128, 1000, 100000].map(
                    (length) => 's'.repeat(length)
                ),
            ]) {
                expect((await m3uFavoriteReference(url)).urlHash).toBe(
                    createHash('sha256').update(url).digest('hex')
                );
            }
        } finally {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                value: original,
            });
        }
    });
});
