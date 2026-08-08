import {
    normalizeStalkerIdentityValue,
    normalizeStalkerSerialNumber,
    type Playlist,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';

export const STALKER_PORTAL_URL_PATTERN = /^\s*https?:\/\/[^ "\s]+\s*$/;

const STALKER_CONNECTION_FIELDS = [
    'portalUrl',
    'macAddress',
    'username',
    'password',
    'stalkerSerialNumber',
    'stalkerDeviceId1',
    'stalkerDeviceId2',
    'stalkerSignature1',
    'stalkerSignature2',
] as const;

type StalkerConnectionField = (typeof STALKER_CONNECTION_FIELDS)[number];

export function hasStalkerConnectionChanged(
    current: Playlist,
    update: PlaylistMeta
): boolean {
    return STALKER_CONNECTION_FIELDS.some(
        (field) =>
            comparableConnectionValue(field, current[field]) !==
            comparableConnectionValue(field, update[field])
    );
}

/** Keeps an unchanged connection byte-identical during metadata-only edits. */
export function preserveStalkerConnection(
    current: Playlist,
    update: PlaylistMeta
): PlaylistMeta {
    return {
        ...update,
        portalUrl: current.portalUrl,
        macAddress: current.macAddress,
        username: current.username,
        password: current.password,
        stalkerSerialNumber: current.stalkerSerialNumber,
        stalkerDeviceId1: current.stalkerDeviceId1,
        stalkerDeviceId2: current.stalkerDeviceId2,
        stalkerSignature1: current.stalkerSignature1,
        stalkerSignature2: current.stalkerSignature2,
    };
}

function comparableConnectionValue(
    field: StalkerConnectionField,
    value: string | undefined
): string {
    if (field === 'portalUrl') {
        return value?.trim() ?? '';
    }
    if (field === 'stalkerSerialNumber') {
        return normalizeStalkerSerialNumber(value) ?? '';
    }
    if (field.startsWith('stalker')) {
        return normalizeStalkerIdentityValue(value) ?? '';
    }
    return value ?? '';
}
