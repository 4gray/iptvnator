import { webcrypto } from 'node:crypto';
import {
    hashParentalLockPin,
    isValidParentalLockPin,
    verifyParentalLockPin,
} from './parental-lock-pin.util';

describe('parental-lock-pin.util', () => {
    beforeAll(() => {
        // The lib compiles for the browser; give Node's WebCrypto the same
        // global shape the renderer has.
        if (!globalThis.crypto?.subtle) {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                value: webcrypto,
            });
        }
    });

    it('accepts 4 to 8 digits only', () => {
        expect(isValidParentalLockPin('1234')).toBe(true);
        expect(isValidParentalLockPin('12345678')).toBe(true);
        expect(isValidParentalLockPin('123')).toBe(false);
        expect(isValidParentalLockPin('123456789')).toBe(false);
        expect(isValidParentalLockPin('12a4')).toBe(false);
        expect(isValidParentalLockPin(1234)).toBe(false);
    });

    it('hashes with a fresh salt and verifies the right PIN only', async () => {
        const first = await hashParentalLockPin('2468');
        const second = await hashParentalLockPin('2468');

        expect(first).not.toEqual(second);
        expect(first.startsWith('v1$')).toBe(true);
        expect(first).not.toContain('2468');
        await expect(verifyParentalLockPin('2468', first)).resolves.toBe(true);
        await expect(verifyParentalLockPin('2468', second)).resolves.toBe(true);
        await expect(verifyParentalLockPin('2469', first)).resolves.toBe(false);
    });

    it('never verifies against a malformed or missing hash', async () => {
        await expect(verifyParentalLockPin('1234', null)).resolves.toBe(false);
        await expect(verifyParentalLockPin('1234', 'v0$x$y$z')).resolves.toBe(
            false
        );
        await expect(
            verifyParentalLockPin('1234', 'v1$abc$!!$??')
        ).resolves.toBe(false);
        await expect(
            verifyParentalLockPin('12', 'v1$1$AA==$AA==')
        ).resolves.toBe(false);
    });

    it('refuses to hash an invalid PIN', async () => {
        await expect(hashParentalLockPin('12')).rejects.toThrow();
    });
});
