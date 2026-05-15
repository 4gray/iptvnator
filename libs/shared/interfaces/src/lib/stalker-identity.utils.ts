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

export function buildStalkerSerialCfduid(serialNumber: string): string {
    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');

    return `${serialPrefix}${STALKER_SERIAL_CFDUID_SUFFIX}`
        .slice(0, STALKER_CFDUID_LENGTH)
        .padEnd(STALKER_CFDUID_LENGTH, '0');
}
