import { normalizeStalkerMacAddress } from './stalker-mac-address.util';

export const LEGACY_DEFAULT_STALKER_SERIAL = 'BEDACD4569BAF';
const STALKER_CFDUID_LENGTH = 32;
const STALKER_SERIAL_CFDUID_SUFFIX = 'e030245495acd6ebfc1';

export interface StalkerPortalIdentity {
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
}

export function normalizeStalkerIdentityValue(
    value: string | undefined | null
): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

export function normalizeStalkerSerialNumber(
    serialNumber: string | undefined | null
): string | undefined {
    const trimmed = normalizeStalkerIdentityValue(serialNumber);
    if (
        !trimmed ||
        trimmed.toUpperCase() === LEGACY_DEFAULT_STALKER_SERIAL
    ) {
        return undefined;
    }

    return trimmed;
}

export function normalizeStalkerPortalIdentity(
    identity: StalkerPortalIdentity | undefined | null
): StalkerPortalIdentity {
    const serialNumber = normalizeStalkerSerialNumber(identity?.serialNumber);
    const deviceId1 = normalizeStalkerIdentityValue(identity?.deviceId1);
    const deviceId2 = normalizeStalkerIdentityValue(identity?.deviceId2);
    const signature1 = normalizeStalkerIdentityValue(identity?.signature1);
    const signature2 = normalizeStalkerIdentityValue(identity?.signature2);

    return {
        ...(serialNumber ? { serialNumber } : {}),
        ...(deviceId1 ? { deviceId1 } : {}),
        ...(deviceId2 ? { deviceId2 } : {}),
        ...(signature1 ? { signature1 } : {}),
        ...(signature2 ? { signature2 } : {}),
    };
}

/**
 * Derives the MAC-based device ID that StbEmu and the `stalker-to-m3u`
 * reference client generate: uppercase hex `SHA256` of the canonical
 * `00:1A:79:…` form of the MAC. A user who already reached the portal from one
 * of those clients has this exact value pinned server-side, which is the only
 * reason deriving one is useful at all.
 *
 * This is a PREFILL helper, never a runtime fallback. `device_id`/`device_id2`
 * are the one identity pair the stock server enforces: the first non-empty
 * value it sees is bound to the MAC permanently, a later mismatch is refused
 * as a device conflict, and going back to sending nothing locks the account
 * out for good. So a derived ID is written into the form as a literal value
 * the user can see and edit, and persisted as a literal string — never
 * recomputed behind their back, where a MAC edit would silently re-derive it
 * into a conflict.
 *
 * Returns `null` whenever it cannot produce a trustworthy ID: when the MAC is
 * not a valid address (hashing whatever happens to be in the field would bind
 * the account to a typo, permanently), and when the runtime has no WebCrypto
 * — an insecure-context PWA, where the handshake's own SHA-1 prehash cannot
 * run either, so full-portal auth is already out of reach. Both cases fail
 * closed: no ID is written, so nothing is pinned.
 */
export async function deriveStalkerDeviceIdFromMac(
    macAddress: string | null | undefined
): Promise<string | null> {
    const normalizedMac = normalizeStalkerMacAddress(macAddress);
    if (!normalizedMac || !globalThis.crypto?.subtle) {
        return null;
    }

    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(normalizedMac)
    );

    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

export function buildStalkerSerialCfduid(serialNumber: string): string {
    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');

    return `${serialPrefix}${STALKER_SERIAL_CFDUID_SUFFIX}`
        .slice(0, STALKER_CFDUID_LENGTH)
        .padEnd(STALKER_CFDUID_LENGTH, '0');
}
