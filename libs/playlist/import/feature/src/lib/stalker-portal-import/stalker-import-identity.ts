import type { StalkerPortalErrorKind } from '@iptvnator/portal/stalker/data-access';
import type { StalkerPortalIdentity } from '@iptvnator/shared/interfaces';

/** The `stalker*` playlist columns the import form writes. */
export interface StalkerPlaylistIdentityFields {
    stalkerSerialNumber?: string;
    stalkerDeviceId1?: string;
    stalkerDeviceId2?: string;
    stalkerSignature1?: string;
    stalkerSignature2?: string;
}

/**
 * Maps the form's identity object onto the playlist's `stalker*` columns,
 * omitting every empty field. Absence is meaningful: an identity value the
 * portal has already pinned must keep being sent, and one it has not seen must
 * keep being absent — writing `''` instead of omitting would send an empty
 * `device_id`, which is how an account gets locked out permanently.
 */
export function toStalkerPlaylistIdentityFields(
    identity: StalkerPortalIdentity
): StalkerPlaylistIdentityFields {
    return {
        ...(identity.serialNumber
            ? { stalkerSerialNumber: identity.serialNumber }
            : {}),
        ...(identity.deviceId1
            ? { stalkerDeviceId1: identity.deviceId1 }
            : {}),
        ...(identity.deviceId2
            ? { stalkerDeviceId2: identity.deviceId2 }
            : {}),
        ...(identity.signature1
            ? { stalkerSignature1: identity.signature1 }
            : {}),
        ...(identity.signature2
            ? { stalkerSignature2: identity.signature2 }
            : {}),
    };
}

/** Headline shown for each way a portal can refuse the import. */
export const STALKER_IMPORT_ERROR_KEY_BY_KIND: Readonly<
    Record<StalkerPortalErrorKind, string>
> = {
    'login-required': 'HOME.STALKER_PORTAL.LOGIN_REQUIRED',
    'login-rejected': 'HOME.STALKER_PORTAL.LOGIN_REJECTED',
    'device-conflict': 'HOME.STALKER_PORTAL.DEVICE_CONFLICT',
    blocked: 'HOME.STALKER_PORTAL.PORTAL_REFUSED',
    'auth-failed': 'HOME.STALKER_PORTAL.AUTH_FAILED',
};
