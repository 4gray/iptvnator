import type { SourceServerConnection } from '@iptvnator/shared/interfaces';
import {
    CONNECTION_KEY,
    DISABLED_KEY,
    sourceConnection,
    tokenKey,
    markSourceConnectionReadFailed,
} from './source-connection';

export function saveBrowserSourceConnection(
    connection: SourceServerConnection,
    token: string,
    expected?: SourceServerConnection
): void {
    if (expected) {
        const saved = localStorage.getItem(CONNECTION_KEY);
        const current = saved
            ? (JSON.parse(saved) as SourceServerConnection)
            : null;
        if (
            current?.apiUrl !== expected.apiUrl ||
            current?.instanceId !== expected.instanceId
        )
            return;
    }
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    localStorage.removeItem(DISABLED_KEY);
    sessionStorage.setItem(tokenKey(connection), token);
}

export function disconnectBrowserSourceConnection(
    disableDiscovery = true,
    expected?: SourceServerConnection
): boolean {
    try {
        if (expected) {
            const saved = localStorage.getItem(CONNECTION_KEY);
            const current = saved
                ? (JSON.parse(saved) as SourceServerConnection)
                : null;
            if (
                current &&
                (current.apiUrl !== expected.apiUrl ||
                    current.instanceId !== expected.instanceId)
            )
                return true;
        }
    } catch {
        markSourceConnectionReadFailed();
        return false;
    }
    try {
        const selected = sourceConnection();
        if (selected) sessionStorage.removeItem(tokenKey(selected));
    } catch {
        /* Storage denied. */
    }
    try {
        localStorage.removeItem(CONNECTION_KEY);
        if (disableDiscovery) localStorage.setItem(DISABLED_KEY, '1');
        return true;
    } catch {
        markSourceConnectionReadFailed();
        return false;
    }
}
