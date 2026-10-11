export const SERVER_ACCESS_TOKEN_STORAGE_KEY = 'iptvnator-server:access-token';

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

export function writeServerAccessToken(token: string): void {
    try {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, token.trim());
    } catch {
        // Storage unavailable (private mode): the token cannot persist.
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
