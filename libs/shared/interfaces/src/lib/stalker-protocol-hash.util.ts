export const STALKER_HASH_ALGORITHM = {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
} as const;

type StalkerHashAlgorithm =
    (typeof STALKER_HASH_ALGORITHM)[keyof typeof STALKER_HASH_ALGORITHM];

/**
 * Protocol hashes, never password storage or transport security. LAN HTTP
 * pages lack SubtleCrypto; load the same algorithms only when needed there.
 */
export async function hashStalkerProtocolValue(
    value: string,
    algorithm: StalkerHashAlgorithm
): Promise<string> {
    const data = new TextEncoder().encode(value);
    // Chromium 68 (the TV target) has crypto but no globalThis binding.
    const subtle = typeof crypto === 'undefined' ? undefined : crypto.subtle;
    let digest: Uint8Array;
    if (subtle) {
        digest = new Uint8Array(await subtle.digest(algorithm, data));
    } else if (algorithm === STALKER_HASH_ALGORITHM.SHA1) {
        const { sha1 } = await import('@noble/hashes/legacy.js');
        digest = sha1(data);
    } else {
        const { sha256 } = await import('@noble/hashes/sha2.js');
        digest = sha256(data);
    }

    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}
