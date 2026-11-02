import { createHash } from 'node:crypto';
import { sha256 } from './favorites-sha256';
import { m3uFavoriteReference } from './favorites-sync.reducer';

describe('HTTP-compatible favorite hashes', () => {
    it.each([0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 100000])(
        'matches SHA-256 across padding and block boundaries (%i bytes)',
        (length) => {
            const bytes = Uint8Array.from(
                { length },
                (_, i) => (i * 37 + 11) % 256
            );
            expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(
                createHash('sha256').update(bytes).digest('hex')
            );
        }
    );
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
