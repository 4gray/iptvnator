import {
    PlaylistMeta,
    STALKER_MAG_USER_AGENT,
    isStalkerStreamCredentialSafe,
} from '@iptvnator/shared/interfaces';
import {
    buildStalkerSerialCfduid,
    normalizeStalkerSerialNumber,
} from './stalker-identity.utils';

export { STALKER_MAG_USER_AGENT };
export const STALKER_STREAM_USER_AGENT = 'KSPlayer';

export function getStalkerPortalOrigin(
    playlist: PlaylistMeta | undefined | null
): string | undefined {
    const portalUrl = playlist?.portalUrl;
    if (!portalUrl) {
        return undefined;
    }

    try {
        return new URL(portalUrl).origin;
    } catch {
        return undefined;
    }
}

/**
 * True when the stream must be treated as foreign to the portal — a
 * different HOST or an https→http downgrade — and therefore must not carry
 * the portal's credentials. A same-host stream on another port or an
 * upgraded scheme stays portal-owned: IPTV panels routinely serve streams
 * from `:8080` next to the portal on `:80`, and those are exactly the
 * streams gated on the portal's mac cookie/token (#1158 class; curl
 * semantics, matching the validated redirect layer).
 */
export function isCrossOriginStalkerStream(
    playlist: PlaylistMeta | undefined | null,
    streamUrl?: string
): boolean {
    if (!playlist?.portalUrl || !streamUrl) {
        return false;
    }

    return !isStalkerStreamCredentialSafe(playlist.portalUrl, streamUrl);
}

export function buildStalkerExternalPlaybackHeaders(
    playlist: PlaylistMeta | undefined | null,
    token?: string | null,
    streamUrl?: string
): Record<string, string> {
    if (!playlist?.macAddress) {
        return {};
    }

    // Foreign-host (or TLS-downgraded) streams get the credential-free
    // KSPlayer direct-stream profile: their access token travels in the URL
    // that create_link minted, and the portal's mac cookie/Bearer token must
    // never reach a third-party host.
    // Leave Range to the player: a fixed bytes=0- overrides its seek offset.
    if (isCrossOriginStalkerStream(playlist, streamUrl)) {
        return {
            'User-Agent': STALKER_STREAM_USER_AGENT,
            Accept: '*/*',
            Connection: 'keep-alive',
            'Icy-MetaData': '1',
        };
    }

    const cookieParts = [
        `mac=${playlist.macAddress}`,
        'stb_lang=en_US@rg=dezzzz',
        'timezone=Europe/Berlin',
    ];
    const serialNumber = normalizeStalkerSerialNumber(
        playlist.stalkerSerialNumber
    );

    if (serialNumber) {
        cookieParts.push(`__cfduid=${buildStalkerSerialCfduid(serialNumber)}`);
    }

    // Both the real User-Agent and Stalker's X-User-Agent, matching what the
    // API request path sends — a portal that filters streams on the MAG UA
    // never saw it here before (audit finding: same-origin set only
    // X-User-Agent). A playlist-level custom UA keeps precedence.
    const magUserAgent = playlist.userAgent?.trim() || STALKER_MAG_USER_AGENT;
    const headers: Record<string, string> = {
        Cookie: cookieParts.join('; '),
        'User-Agent': magUserAgent,
        'X-User-Agent': STALKER_MAG_USER_AGENT,
    };

    if (serialNumber) {
        headers['SN'] = serialNumber;
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const origin = getStalkerPortalOrigin(playlist);
    if (origin) {
        headers['Origin'] = origin;
        headers['Referer'] = origin;
    }

    return Object.entries(headers).reduce<Record<string, string>>(
        (acc, [name, value]) => {
            if (value?.trim()) {
                acc[name] = value;
            }
            return acc;
        },
        {}
    );
}
