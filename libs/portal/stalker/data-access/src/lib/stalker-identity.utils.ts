import {
    normalizeStalkerPortalIdentity as normalizeSharedStalkerPortalIdentity,
    type Playlist,
    type StalkerPortalIdentity,
} from '@iptvnator/shared/interfaces';

export {
    buildStalkerSerialCfduid,
    LEGACY_DEFAULT_STALKER_SERIAL,
    normalizeStalkerIdentityValue,
    normalizeStalkerPortalIdentity,
    normalizeStalkerSerialNumber,
    type StalkerPortalIdentity,
} from '@iptvnator/shared/interfaces';

export function getStalkerPortalIdentityFromPlaylist(
    playlist: Pick<
        Playlist,
        | 'stalkerSerialNumber'
        | 'stalkerDeviceId1'
        | 'stalkerDeviceId2'
        | 'stalkerSignature1'
        | 'stalkerSignature2'
    >
): StalkerPortalIdentity {
    return normalizeSharedStalkerPortalIdentity({
        serialNumber: playlist.stalkerSerialNumber,
        deviceId1: playlist.stalkerDeviceId1,
        deviceId2: playlist.stalkerDeviceId2,
        signature1: playlist.stalkerSignature1,
        signature2: playlist.stalkerSignature2,
    });
}
