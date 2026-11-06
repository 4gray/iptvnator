import { createHash, webcrypto } from 'node:crypto';
import { generatePrehash } from './stalker-auth.utils';

describe('Stalker protocol prehash', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(
        globalThis,
        'crypto'
    );
    const mac = '00:1A:79:AA:BB:CC';
    const expected = createHash('sha1').update(mac).digest('hex').toUpperCase();

    afterEach(() => {
        if (originalCrypto) {
            Object.defineProperty(globalThis, 'crypto', originalCrypto);
        } else {
            Reflect.deleteProperty(globalThis, 'crypto');
        }
    });

    it.each([
        ['native Web Crypto', webcrypto],
        ['LAN HTTP without SubtleCrypto', {}],
        ['no crypto API', undefined],
    ])('preserves the prehash with %s', async (_name, cryptoApi) => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: cryptoApi,
        });

        await expect(generatePrehash(mac.toLowerCase())).resolves.toBe(
            expected
        );
    });
});
