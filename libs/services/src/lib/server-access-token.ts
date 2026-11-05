import { SERVER_ACCESS_CHALLENGE } from '@iptvnator/shared/interfaces';

export const SERVER_ACCESS_TOKEN_STORAGE_KEY = 'iptvnator-server:access-token';

/**
 * A gateway's answer for a backend that is down (nginx's 502/503/504 page),
 * not the backend's own JSON error for a provider that failed.
 */
export function isGatewayOutage(
    status: number,
    contentType: string | null | undefined
): boolean {
    return (
        [502, 503, 504].includes(status) &&
        !contentType?.includes('application/json')
    );
}

/** A 401 from the backend's access guard, not one a provider sent. */
export function isServerAccessChallenge(
    status: number,
    challenge: string | null
): boolean {
    return status === 401 && challenge === SERVER_ACCESS_CHALLENGE;
}

/** The instance the stored token was given for. */
export const SERVER_ACCESS_TOKEN_OWNER_KEY =
    'iptvnator-server:access-token-instance';

/**
 * The stored token; with `instanceId`, only when it was given for that
 * instance: a tab still open on another server (a changed backend URL)
 * never sends it there.
 */
export function readServerAccessToken(
    instanceId?: string | null
): string | null {
    try {
        const token = localStorage
            .getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
            ?.trim();
        return token &&
            (instanceId === undefined ||
                localStorage.getItem(SERVER_ACCESS_TOKEN_OWNER_KEY) ===
                    (instanceId ?? ''))
            ? token
            : null;
    } catch {
        return null;
    }
}

/** False when browser storage refused it (private mode, full). */
export function writeServerAccessToken(
    token: string,
    instanceId: string | null
): boolean {
    try {
        // The owner goes last: a token stored without one is sent nowhere.
        localStorage.removeItem(SERVER_ACCESS_TOKEN_OWNER_KEY);
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, token.trim());
        localStorage.setItem(SERVER_ACCESS_TOKEN_OWNER_KEY, instanceId ?? '');
        return true;
    } catch {
        return false;
    }
}

export function clearServerAccessToken(): void {
    try {
        localStorage.removeItem(SERVER_ACCESS_TOKEN_STORAGE_KEY);
        localStorage.removeItem(SERVER_ACCESS_TOKEN_OWNER_KEY);
    } catch {
        // Nothing stored.
    }
}

/**
 * Whether `url` goes to the backend: the same origin as the backend URL and
 * a path inside it. A plain prefix check fails for `BACKEND_URL=/`, where
 * every URL, other origins included, would carry the token.
 */
export function isBackendUrl(
    url: string,
    baseUrl: string,
    pageUrl = globalThis.location?.href ?? 'http://localhost/'
): boolean {
    try {
        const base = new URL(baseUrl, pageUrl);
        const target = new URL(url, pageUrl);
        const root = base.pathname.endsWith('/')
            ? base.pathname
            : `${base.pathname}/`;
        return (
            target.origin === base.origin &&
            (target.pathname === base.pathname ||
                target.pathname.startsWith(root))
        );
    } catch {
        return false;
    }
}
