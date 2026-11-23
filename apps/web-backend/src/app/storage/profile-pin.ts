import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** A profile PIN: 4 to 8 digits. */
export const PROFILE_PIN = /^[0-9]{4,8}$/;

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 32;

function derive(pin: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) =>
        scrypt(
            pin,
            salt,
            KEY_LENGTH,
            {
                N: SCRYPT_COST,
                r: SCRYPT_BLOCK_SIZE,
                p: SCRYPT_PARALLELISM,
            },
            (error, key) => (error ? reject(error) : resolve(key))
        )
    );
}

/** `scrypt:<N>:<r>:<p>:<salt>:<key>`, base64url. Never returned by the API. */
export async function hashProfilePin(pin: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(pin, salt);
    return [
        'scrypt',
        SCRYPT_COST,
        SCRYPT_BLOCK_SIZE,
        SCRYPT_PARALLELISM,
        salt.toString('base64url'),
        key.toString('base64url'),
    ].join(':');
}

export async function verifyProfilePin(
    pin: string,
    stored: string
): Promise<boolean> {
    const [scheme, cost, blockSize, parallelism, salt, key] = stored.split(':');
    if (
        scheme !== 'scrypt' ||
        Number(cost) !== SCRYPT_COST ||
        Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
        Number(parallelism) !== SCRYPT_PARALLELISM ||
        !salt ||
        !key
    ) {
        return false;
    }
    const expected = Buffer.from(key, 'base64url');
    const actual = await derive(pin, Buffer.from(salt, 'base64url'));
    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}
