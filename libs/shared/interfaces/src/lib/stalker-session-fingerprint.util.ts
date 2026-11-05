import type { Playlist } from './playlist.interface';
import { normalizeStalkerIdentityValue } from './stalker-identity.utils';

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
    // JSON-encoded, not delimiter-joined: identity values are unrestricted
    // strings, and an unescaped separator would let distinct tuples alias
    // each other and bypass the identity invalidation.
    return JSON.stringify([
        normalizeStalkerIdentityValue(playlist.macAddress) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerSerialNumber) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerDeviceId1) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerDeviceId2) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerSignature1) ?? '',
        normalizeStalkerIdentityValue(playlist.stalkerSignature2) ?? '',
    ]);
}

/**
 * Everything a Stalker session is bound to: the endpoint it was negotiated
 * against, the device identity, and the account credentials.
 *
 * All three halves matter, and each was a real defect when missing:
 *
 * - **Endpoint** — `ensureToken()` re-presents tokens in a handshake, so a
 *   playlist repointed at another portal would disclose the previous one's
 *   bearer token to it. Origin alone is not enough: discovery deliberately
 *   preserves tenant base paths (`/tenant-a/…` vs `/tenant-b/…`), which are
 *   different portals on one host. URL Basic-auth credentials are part of
 *   the endpoint authority too: an edited userinfo identity must not receive
 *   a token negotiated through the previous one.
 * - **Identity** — an edited MAC/serial must not inherit the old session.
 * - **Credentials** — for a status-2 portal the login decides which account
 *   the token represents, so changing it must not keep serving the previous
 *   account's session.
 *
 * Used for BOTH the in-run cache and the persisted session: an edit applies
 * without waiting for a restart.
 */
export function stalkerSessionFingerprint(
    playlist: Pick<
        Playlist,
        | 'portalUrl'
        | 'macAddress'
        | 'username'
        | 'password'
        | 'stalkerSerialNumber'
        | 'stalkerDeviceId1'
        | 'stalkerDeviceId2'
        | 'stalkerSignature1'
        | 'stalkerSignature2'
    >
): string {
    return JSON.stringify([
        portalEndpoint(playlist.portalUrl),
        stalkerIdentityFingerprint(playlist as Playlist),
        playlist.username ?? '',
        playlist.password ?? '',
    ]);
}

/**
 * Origin AND path, minus query/fragment — the endpoint a session belongs to.
 *
 * No attempt is made to treat different handler paths for the same portal
 * (`…/portal.php` vs `…/server/load.php`) as equivalent. Both sides of the
 * comparison read the SAME persisted `portalUrl`, so the same portal always
 * yields the same key; the value changes only on a real edit or repair, and
 * both of those re-authenticate anyway. An equivalence rule would add
 * machinery whose only failure mode is aliasing two genuinely different
 * endpoints — the exact thing this key exists to prevent.
 */
function portalEndpoint(portalUrl: string | undefined): string {
    if (!portalUrl) {
        return '';
    }
    try {
        const parsed = new URL(portalUrl);
        const endpoint = `${parsed.origin}${parsed.pathname.replace(
            /\/+$/,
            ''
        )}`;

        // URL.origin deliberately omits userinfo. Preserve the legacy value
        // for ordinary endpoints so an upgrade does not invalidate healthy
        // sessions, while Basic-auth URLs bind the token to the exact accepted
        // credentials. JSON avoids ambiguous delimiter collisions.
        return parsed.username || parsed.password
            ? JSON.stringify([endpoint, parsed.username, parsed.password])
            : endpoint;
    } catch {
        // Unparseable: fall back to the raw string so a change is still a
        // change — never to a constant, which would alias every endpoint.
        return portalUrl;
    }
}
