/**
 * Decides whether a resolved Stalker stream URL may carry the portal's
 * credentials (mac cookie, Bearer token, serial-number headers).
 *
 * Both the renderer playback-header builder and the Electron main-process
 * playback-context fallback classify streams with this single predicate; if
 * the two ever disagreed, `isStalkerDirectStreamProfile` in the external
 * player path would silently discard the caller's credentialed headers.
 *
 * The rule mirrors the transport-security carve-out of the validated
 * redirect layer (docs/architecture/electron-security.md): IPTV portals
 * routinely hand out stream URLs on the same host but a different port or an
 * upgraded scheme, and losing the session cookie/token there breaks playback
 * outright (#1158, #849, #910). A different host would hand provider
 * credentials to a third party, and an https→http downgrade would replay a
 * TLS-obtained session in cleartext — both stay credential-free.
 */
export function isStalkerStreamCredentialSafe(
    portalUrl: string | undefined | null,
    streamUrl: string | undefined | null
): boolean {
    if (!portalUrl || !streamUrl) {
        return false;
    }

    let portal: URL;
    let stream: URL;
    try {
        portal = new URL(portalUrl);
        stream = new URL(streamUrl);
    } catch {
        return false;
    }

    if (stream.protocol !== 'http:' && stream.protocol !== 'https:') {
        return false;
    }

    if (portal.hostname.toLowerCase() !== stream.hostname.toLowerCase()) {
        return false;
    }

    return !(portal.protocol === 'https:' && stream.protocol === 'http:');
}
