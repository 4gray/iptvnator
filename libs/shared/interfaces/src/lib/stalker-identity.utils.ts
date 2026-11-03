import { normalizeStalkerMacAddress } from './stalker-mac-address.util';
import { loadStalkerProtocolHash } from './stalker-protocol-hash.loader';

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
 * Salt that separates `device_id2` from `device_id`, matching the
 * `stalker-to-m3u` reference client.
 */
const STALKER_DEVICE_ID2_SALT = 'stalker';

export interface StalkerDerivedDeviceIds {
    deviceId1: string;
    deviceId2: string;
}

/**
 * Derives the MAC-based device ID pair that StbEmu and the `stalker-to-m3u`
 * reference client generate: uppercase hex `SHA256` of the canonical
 * `00:1A:79:…` MAC for `device_id`, and of that MAC plus a `stalker` salt for
 * `device_id2`. A user who already reached the portal from one of those
 * clients has these exact values pinned server-side, which is the only reason
 * deriving them is useful at all.
 *
 * The two must differ. On a real box they come from separate firmware calls
 * (`gSTB.GetUID()` and `gSTB.GetUID('device_id', token)`) and are never equal,
 * so an identical pair is a fingerprint no STB produces — and since the first
 * non-empty value is pinned to the MAC permanently, it cannot be corrected
 * afterwards. They are derived together for that reason: nothing should be
 * able to fill one without the other.
 *
 * This is a PREFILL helper, never a runtime fallback. `device_id`/`device_id2`
 * are the one identity pair the stock server enforces: the first non-empty
 * value it sees is bound to the MAC permanently, a later mismatch is refused
 * as a device conflict, and going back to sending nothing locks the account
 * out for good. So derived IDs are written into the form as literal values the
 * user can see and edit, and persisted as literal strings — never recomputed
 * behind their back, where a MAC edit would silently re-derive them into a
 * conflict.
 *
 * Returns `null` when the MAC is not valid: hashing whatever happens to be in
 * the field would bind the account to a typo permanently. Native Web Crypto
 * and LAN HTTP use the same SHA-256 values through the protocol hash helper.
 */
export async function deriveStalkerDeviceIdsFromMac(
    macAddress: string | null | undefined
): Promise<StalkerDerivedDeviceIds | null> {
    const normalizedMac = normalizeStalkerMacAddress(macAddress);
    if (!normalizedMac) {
        return null;
    }

    // Identity normalization runs during startup; hashing is only needed
    // when the user explicitly opts into deriving device IDs.
    const { hashStalkerProtocolValue, STALKER_HASH_ALGORITHM } =
        await loadStalkerProtocolHash();
    const [deviceId1, deviceId2] = await Promise.all([
        hashStalkerProtocolValue(normalizedMac, STALKER_HASH_ALGORITHM.SHA256),
        hashStalkerProtocolValue(
            `${normalizedMac}${STALKER_DEVICE_ID2_SALT}`,
            STALKER_HASH_ALGORITHM.SHA256
        ),
    ]);

    return { deviceId1, deviceId2 };
}

export function buildStalkerSerialCfduid(serialNumber: string): string {
    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');

    return `${serialPrefix}${STALKER_SERIAL_CFDUID_SUFFIX}`
        .slice(0, STALKER_CFDUID_LENGTH)
        .padEnd(STALKER_CFDUID_LENGTH, '0');
}
