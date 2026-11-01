import { createHash, webcrypto } from 'node:crypto';
import {
    hashStalkerProtocolValue,
    STALKER_HASH_ALGORITHM,
} from './stalker-protocol-hash.util';

describe('Stalker protocol hashes', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(
        globalThis,
        'crypto'
    );

    afterEach(() => {
        if (originalCrypto) {
            Object.defineProperty(globalThis, 'crypto', originalCrypto);
        } else {
            Reflect.deleteProperty(globalThis, 'crypto');
        }
    });

    describe.each([
        ['Web Crypto', webcrypto],
        ['LAN HTTP', {}],
    ])('%s', (_name, cryptoApi) => {
        beforeEach(() => {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                value: cryptoApi,
            });
        });

        it.each(Object.values(STALKER_HASH_ALGORITHM))(
            'matches independent %s digests byte for byte',
            async (algorithm) => {
                for (const value of [
                    '',
                    'abc',
                    '00:1A:79:AA:BB:CC',
                    'Портал 📺'.repeat(16),
                ]) {
                    const expected = createHash(
                        algorithm.replace('-', '').toLowerCase()
                    )
                        .update(value)
                        .digest('hex')
                        .toUpperCase();
                    await expect(
                        hashStalkerProtocolValue(value, algorithm)
                    ).resolves.toBe(expected);
                }
            }
        );
    });

    it('propagates an available native digest failure', async () => {
        const failure = new Error('Native hashing failed');
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: { subtle: { digest: jest.fn().mockRejectedValue(failure) } },
        });

        await expect(
            hashStalkerProtocolValue('abc', STALKER_HASH_ALGORITHM.SHA1)
        ).rejects.toBe(failure);
    });
});
