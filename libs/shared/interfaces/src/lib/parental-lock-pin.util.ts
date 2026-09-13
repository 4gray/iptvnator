/**
 * PIN hashing for the parental lock.
 *
 * The PIN is a child lock, not a security boundary: the stored hash lives in a
 * user-readable file. It is still never stored in clear — PBKDF2-SHA256 with
 * a random salt through WebCrypto, which exists in both the Electron
 * renderer and the browser, so Electron and PWA share one implementation.
 *
 * Stored format: `v1$<iterations>$<salt base64>$<hash base64>`.
 */

export const PARENTAL_LOCK_PIN_MIN_LENGTH = 4;
export const PARENTAL_LOCK_PIN_MAX_LENGTH = 8;

const PIN_HASH_VERSION = 'v1';
const PIN_HASH_ITERATIONS = 100_000;
const PIN_HASH_SALT_BYTES = 16;
const PIN_HASH_LENGTH_BITS = 256;

export function isValidParentalLockPin(pin: unknown): pin is string {
    return (
        typeof pin === 'string' &&
        pin.length >= PARENTAL_LOCK_PIN_MIN_LENGTH &&
        pin.length <= PARENTAL_LOCK_PIN_MAX_LENGTH &&
        /^[0-9]+$/.test(pin)
    );
}

function getSubtleCrypto(): SubtleCrypto {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) {
        throw new Error('WebCrypto is unavailable in this runtime.');
    }
    return cryptoApi.subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

async function derivePinHash(
    pin: string,
    salt: Uint8Array,
    iterations: number
): Promise<Uint8Array> {
    const subtle = getSubtleCrypto();
    const keyMaterial = await subtle.importKey(
        'raw',
        new TextEncoder().encode(pin),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: salt as BufferSource,
            iterations,
        },
        keyMaterial,
        PIN_HASH_LENGTH_BITS
    );
    return new Uint8Array(bits);
}

export async function hashParentalLockPin(pin: string): Promise<string> {
    if (!isValidParentalLockPin(pin)) {
        throw new Error('PIN must be 4 to 8 digits.');
    }
    const salt = new Uint8Array(PIN_HASH_SALT_BYTES);
    globalThis.crypto.getRandomValues(salt);
    const hash = await derivePinHash(pin, salt, PIN_HASH_ITERATIONS);
    return [
        PIN_HASH_VERSION,
        String(PIN_HASH_ITERATIONS),
        bytesToBase64(salt),
        bytesToBase64(hash),
    ].join('$');
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) {
        return false;
    }
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}

/**
 * Verifies a PIN against a stored hash. A malformed stored value never
 * verifies — it can only be replaced by setting a new PIN.
 */
export async function verifyParentalLockPin(
    pin: string,
    storedHash: string | null | undefined
): Promise<boolean> {
    if (!isValidParentalLockPin(pin) || typeof storedHash !== 'string') {
        return false;
    }
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== PIN_HASH_VERSION) {
        return false;
    }
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) {
        return false;
    }
    try {
        const salt = base64ToBytes(parts[2]);
        const expected = base64ToBytes(parts[3]);
        const actual = await derivePinHash(pin, salt, iterations);
        return constantTimeEqual(actual, expected);
    } catch {
        return false;
    }
}
