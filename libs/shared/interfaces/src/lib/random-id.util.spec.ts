import { createRandomId } from './random-id.util';

const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createRandomId', () => {
    const nativeRandomUUID = crypto.randomUUID;

    afterEach(() => {
        Object.defineProperty(crypto, 'randomUUID', {
            configurable: true,
            value: nativeRandomUUID,
        });
    });

    it('returns a v4 uuid', () => {
        expect(createRandomId()).toMatch(UUID_V4);
    });

    it('returns unique ids', () => {
        const ids = new Set(
            Array.from({ length: 500 }, () => createRandomId())
        );

        expect(ids.size).toBe(500);
    });

    it('uses the native randomUUID when the context exposes it', () => {
        const randomUUID = jest
            .fn()
            .mockReturnValue('11111111-1111-4111-8111-111111111111');
        Object.defineProperty(crypto, 'randomUUID', {
            configurable: true,
            value: randomUUID,
        });

        expect(createRandomId()).toBe('11111111-1111-4111-8111-111111111111');
        expect(randomUUID).toHaveBeenCalledTimes(1);
    });

    describe('without randomUUID (insecure context)', () => {
        beforeEach(() => {
            Object.defineProperty(crypto, 'randomUUID', {
                configurable: true,
                value: undefined,
            });
        });

        it('still returns a v4 uuid from getRandomValues', () => {
            expect(createRandomId()).toMatch(UUID_V4);
        });

        it('returns unique ids', () => {
            const ids = new Set(
                Array.from({ length: 500 }, () => createRandomId())
            );

            expect(ids.size).toBe(500);
        });

        it('sets the version and variant bits on all-zero randomness', () => {
            jest.spyOn(crypto, 'getRandomValues').mockImplementation(
                (buffer) => buffer
            );

            expect(createRandomId()).toBe(
                '00000000-0000-4000-8000-000000000000'
            );
        });

        it('keeps the remaining bits from getRandomValues', () => {
            jest.spyOn(crypto, 'getRandomValues').mockImplementation(
                (buffer) => {
                    (buffer as Uint8Array).fill(0xff);
                    return buffer;
                }
            );

            expect(createRandomId()).toBe(
                'ffffffff-ffff-4fff-bfff-ffffffffffff'
            );
        });
    });
});
