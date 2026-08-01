import { Request } from 'express';
import { extractMac } from './request-mac.js';

/**
 * Session/identity state of the mocked portal.
 *
 * Modelled on the plaintext Stalker 4.9.35 middleware (`server/lib/stb.class.php`),
 * which is the last openly readable ancestor of the encoded 5.x core:
 *
 * - the handshake token is random and **idempotent** — re-presenting a valid
 *   token returns the same one instead of rotating it
 * - a token only becomes a session once `get_profile` stores it for the MAC
 * - `device_id`/`device_id2` are pinned on first non-empty value and a later
 *   mismatch is a hard, permanent conflict
 * - `signature`, `metrics` and `prehash` are accepted but never verified
 */

interface PortalSession {
    /** Token handed out by the last handshake, before get_profile adopts it. */
    pendingToken?: string;
    /** Token stored for the MAC — what authorizes non-auth actions. */
    accessToken?: string;
    deviceId?: string;
    deviceId2?: string;
}

const sessions = new Map<string, PortalSession>();

/** Actions the portal answers without a valid Bearer token. */
const UNAUTHENTICATED_ACTIONS = new Set([
    'handshake',
    'get_profile',
    'get_localization',
    'do_auth',
]);

export type AuthFailure =
    | 'Authorization failed.'
    | 'Access denied.'
    | 'Unauthorized request.';

function getSession(mac: string): PortalSession {
    const key = mac.toLowerCase();
    if (!sessions.has(key)) {
        sessions.set(key, {});
    }
    return sessions.get(key) as PortalSession;
}

/** 32 uppercase hex chars, like `strtoupper(md5(microtime + uniqid))`. */
function generateToken(mac: string): string {
    const entropy = `${mac}:${sessions.size}:${tokenCounter++}`;
    let hex = '';
    for (let index = 0; index < 32; index += 1) {
        const code = entropy.charCodeAt(index % entropy.length) + index * 31;
        hex += (code % 16).toString(16).toUpperCase();
    }
    return hex;
}

let tokenCounter = 0;

/**
 * Issue (or re-confirm) a handshake token. Presenting the MAC's current access
 * token returns it unchanged, which is what lets real clients persist tokens
 * across restarts.
 */
export function issueHandshakeToken(mac: string, presentedToken?: string): {
    token: string;
    notValid: boolean;
} {
    const session = getSession(mac);

    if (presentedToken && presentedToken === session.accessToken) {
        return { token: session.accessToken, notValid: false };
    }

    const token = generateToken(mac);
    session.pendingToken = token;

    // The real server only sets not_valid when an auth_url is configured and a
    // stale token was presented; mirroring the flag lets clients exercise it.
    return { token, notValid: Boolean(presentedToken) };
}

/** Adopt the handshake token as the MAC's session token (what get_profile does). */
export function adoptToken(mac: string, token: string): void {
    const session = getSession(mac);
    session.accessToken = token;
    session.pendingToken = undefined;
}

export function readBearerToken(req: Request): string | undefined {
    const header = req.headers['authorization'];
    if (typeof header !== 'string') {
        return undefined;
    }
    // `\s+(.*)` would backtrack polynomially on "bearer" + a long run of
    // spaces, so require the token to start with a non-space character.
    const match = /^Bearer[ \t]+(\S.*)$/i.exec(header.trim());
    return match?.[1]?.trim() || undefined;
}

/**
 * Pin device identity to the MAC. Returns a conflict message when a previously
 * stored value is contradicted — including the "blank after pinned" case that
 * permanently locks real users out.
 */
export function pinDeviceIdentity(
    mac: string,
    deviceId: string | undefined,
    deviceId2: string | undefined
): string | null {
    const session = getSession(mac);

    for (const [field, incoming] of [
        ['deviceId', deviceId],
        ['deviceId2', deviceId2],
    ] as const) {
        const stored = session[field];
        if (!stored) {
            if (incoming) {
                session[field] = incoming;
            }
            continue;
        }
        if (stored !== (incoming ?? '')) {
            return field === 'deviceId'
                ? 'device conflict - device_id mismatch'
                : 'device conflict - MAC address mismatch';
        }
    }

    return null;
}

/**
 * Decide whether a request may proceed. `enforce` is false for the reseller-style
 * `/portal.php` endpoint, which commonly ignores tokens, and true for the
 * canonical `/stalker_portal/server/load.php` endpoint.
 */
export function checkRequestAuthorization(
    req: Request,
    enforce: boolean
): AuthFailure | null {
    const action = String(req.query['action'] ?? '');
    const hasMacCookie = (req.headers['cookie'] ?? '').includes('mac=');

    if (!hasMacCookie) {
        return 'Unauthorized request.';
    }
    if (!enforce || UNAUTHENTICATED_ACTIONS.has(action)) {
        return null;
    }

    const session = getSession(extractMac(req));
    const presented = readBearerToken(req);

    if (!session.accessToken || presented !== session.accessToken) {
        return 'Authorization failed.';
    }

    return null;
}

/** Drop the MAC's session so the next request must re-authenticate. */
export function invalidateSession(mac: string): void {
    sessions.delete(mac.toLowerCase());
}

export function resetAuthState(): void {
    sessions.clear();
    tokenCounter = 0;
}
