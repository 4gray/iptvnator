import { SERVER_ACCESS_CHALLENGE } from '@iptvnator/shared/interfaces';

export const SERVER_ACCESS_TOKEN_STORAGE_KEY = 'iptvnator-server:access-token';

/** A 401 from the backend's access guard, not one a provider sent. */
export function isServerAccessChallenge(
    status: number,
    challenge: string | null
): boolean {
    return status === 401 && challenge === SERVER_ACCESS_CHALLENGE;
}

export function readServerAccessToken(): string | null {
    try {
        const token = localStorage
            .getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
            ?.trim();
        return token ? token : null;
    } catch {
        return null;
    }
}

/** False when browser storage refused it (private mode, full). */
export function writeServerAccessToken(token: string): boolean {
    try {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, token.trim());
        return true;
    } catch {
        return false;
    }
}

export function clearServerAccessToken(): void {
    try {
        localStorage.removeItem(SERVER_ACCESS_TOKEN_STORAGE_KEY);
    } catch {
        // Nothing stored.
    }
}

/** `Authorization` header for calls to the self-hosted backend. */
export function serverAuthorizationHeaders(): Record<string, string> {
    const token = readServerAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
