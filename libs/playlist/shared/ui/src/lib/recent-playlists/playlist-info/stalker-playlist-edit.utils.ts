import {
    normalizeStalkerIdentityValue,
    normalizeStalkerSerialNumber,
    type Playlist,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';

export const STALKER_PORTAL_URL_PATTERN = /^\s*https?:\/\/[^ "\s]+\s*$/i;

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

/** Lets the queued persistence boundary preserve its current connection. */
export function omitStalkerConnection(update: PlaylistMeta): PlaylistMeta {
    const metadata = { ...update };
    for (const field of STALKER_CONNECTION_FIELDS) {
        delete metadata[field];
    }
    delete metadata.isFullStalkerPortal;
    return metadata;
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
