import {
    normalizeStalkerMacAddress,
    normalizeStalkerSourceUrl,
} from '@iptvnator/portal/stalker/protocol';
import {
    LEGACY_DEFAULT_STALKER_SERIAL,
    type StalkerSessionConnectionDescriptor,
    type StalkerSessionIdentityOverrides,
} from '@iptvnator/shared/interfaces';
import type { StalkerAuthCredentials } from './stalker-auth-session';

type SavedPlaylistReader = (
    playlistRef: string
) => Promise<unknown>;

const IDENTITY_KEYS = [
    'apiSignature',
    'deviceId1',
    'deviceId2',
    'firmwareVersion',
    'hardwareVersion',
    'hardwareVersion2',
    'imageVersion',
    'numberOfBanks',
    'prehash',
    'serialNumber',
    'signature1',
    'signature2',
    'videoOutput',
] as const satisfies readonly (keyof StalkerSessionIdentityOverrides)[];

export function createStalkerSavedCredentialsLoader(
    readPlaylist: SavedPlaylistReader
): (
    descriptor: StalkerSessionConnectionDescriptor
) => Promise<StalkerAuthCredentials | undefined> {
    return async (descriptor) => {
        const value = await readPlaylist(descriptor.playlistRef);
        if (!isRecord(value) || !matchesDescriptor(value, descriptor)) {
            return undefined;
        }
        const username = presentString(value['username'])?.trim();
        const password = value['password'];
        if (
            username === undefined ||
            typeof password !== 'string' ||
            password.length === 0
        ) {
            return undefined;
        }
        return {
            password,
            username,
        };
    };
}

function matchesDescriptor(
    playlist: Readonly<Record<string, unknown>>,
    descriptor: StalkerSessionConnectionDescriptor
): boolean {
    if (
        (playlist['type'] !== undefined &&
            playlist['type'] !== 'stalker') ||
        !matchesSource(playlist, descriptor.sourceUrl) ||
        !matchesMac(playlist['macAddress'], descriptor.macAddress) ||
        !matchesProfile(playlist['stalkerProfilePreset'], descriptor) ||
        !matchesIdentity(playlist, descriptor.identityOverrides)
    ) {
        return false;
    }
    return true;
}

function matchesSource(
    playlist: Readonly<Record<string, unknown>>,
    descriptorSourceUrl: string
): boolean {
    const source = firstPresentString(
        playlist['stalkerSourceUrl'],
        playlist['portalUrl'],
        playlist['url']
    );
    if (source === undefined) {
        return false;
    }
    try {
        return (
            normalizeStalkerSourceUrl(source) ===
            normalizeStalkerSourceUrl(descriptorSourceUrl)
        );
    } catch {
        return false;
    }
}

function matchesMac(value: unknown, descriptorMac: string): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    try {
        return (
            normalizeStalkerMacAddress(value) ===
            normalizeStalkerMacAddress(descriptorMac)
        );
    } catch {
        return false;
    }
}

function matchesProfile(
    value: unknown,
    descriptor: StalkerSessionConnectionDescriptor
): boolean {
    if (value === undefined) {
        return (
            descriptor.profilePreset.id ===
                'mag250-public-5_1-minimal-v1' &&
            descriptor.profilePreset.version === 1
        );
    }
    return (
        isRecord(value) &&
        value['id'] === descriptor.profilePreset.id &&
        value['version'] === descriptor.profilePreset.version
    );
}

function matchesIdentity(
    playlist: Readonly<Record<string, unknown>>,
    descriptorIdentity: StalkerSessionIdentityOverrides | undefined
): boolean {
    const saved = readSavedIdentity(playlist);
    const descriptor = descriptorIdentity ?? {};
    return IDENTITY_KEYS.every(
        (key) => saved[key] === presentString(descriptor[key])
    );
}

function readSavedIdentity(
    playlist: Readonly<Record<string, unknown>>
): StalkerSessionIdentityOverrides {
    const structured = playlist['stalkerIdentityOverrides'];
    if (isRecord(structured)) {
        return copyIdentity(structured);
    }
    const serialNumber = presentString(playlist['stalkerSerialNumber']);
    return copyIdentity({
        deviceId1: playlist['stalkerDeviceId1'],
        deviceId2: playlist['stalkerDeviceId2'],
        serialNumber:
            serialNumber?.toUpperCase() === LEGACY_DEFAULT_STALKER_SERIAL
                ? undefined
                : serialNumber,
        signature1: playlist['stalkerSignature1'],
        signature2: playlist['stalkerSignature2'],
    });
}

function copyIdentity(
    value: Readonly<Record<string, unknown>>
): StalkerSessionIdentityOverrides {
    return Object.fromEntries(
        IDENTITY_KEYS.flatMap((key) => {
            const present = presentString(value[key]);
            return present === undefined ? [] : [[key, present]];
        })
    ) as StalkerSessionIdentityOverrides;
}

function firstPresentString(...values: readonly unknown[]): string | undefined {
    for (const value of values) {
        const present = presentString(value);
        if (present !== undefined) {
            return present;
        }
    }
    return undefined;
}

function presentString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
