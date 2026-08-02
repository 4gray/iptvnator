import {
    normalizeStalkerIdentityValue,
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

/**
 * Canonical fingerprint of WHO a portal session belongs to: the MAC plus
 * every Stalker identity field, trim-normalized so blank and absent values
 * are equivalent. The repair override, the once-per-config probe latch and
 * the session token cache are all keyed/validated with this — a session
 * negotiated for one fingerprint must never serve another.
 */
export function stalkerIdentityFingerprint(
    playlist: Pick<
        Playlist,
        | 'macAddress'
        | 'stalkerSerialNumber'
        | 'stalkerDeviceId1'
        | 'stalkerDeviceId2'
        | 'stalkerSignature1'
        | 'stalkerSignature2'
    >
): string {
    return [
        normalizeStalkerIdentityValue(playlist.macAddress) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerSerialNumber) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerDeviceId1) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerDeviceId2) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerSignature1) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerSignature2) ?? '',
    ].join('|');
}

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
