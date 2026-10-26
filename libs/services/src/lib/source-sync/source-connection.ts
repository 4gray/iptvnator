import {
    SOURCE_SYNC_CAPABILITY,
    type SourceServerConnection,
    type ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';

const CONNECTION_KEY = 'iptvnator:source-server';
const DISABLED_KEY = 'iptvnator:source-server-disabled';
let selected: SourceServerConnection | null = null;

export const sourceConnection = () => selected;
export const sourceProfileName = () =>
    selected ? `iptvnator-server:${selected.instanceId}` : 'iptvnator';
export const tokenKey = (apiUrl: string) => `iptvnator:server-token:${apiUrl}`;

export function assertSourceInstance(
    value: unknown
): asserts value is ServerInstanceInfo {
    const info = value as ServerInstanceInfo;
    if (
        info?.service !== 'iptvnator' ||
        info.apiVersion !== 1 ||
        info.storage !== 'server' ||
        !info.instanceId ||
        !info.capabilities?.includes(SOURCE_SYNC_CAPABILITY)
    ) {
        throw new Error('SOURCE_SYNC.INCOMPATIBLE');
    }
}

/** Runs before Angular constructs storage or reads the source inventory. */
export async function prepareSourceConnection(
    runtimeBackendUrl?: string
): Promise<void> {
    selected = null;
    if (window.electron?.sourceSyncConnection) {
        selected = window.electron.sourceSyncConnection();
        return;
    }
    const saved = localStorage.getItem(CONNECTION_KEY);
    if (saved) {
        const connection = JSON.parse(saved) as SourceServerConnection;
        const apiUrl = new URL(connection.apiUrl);
        if (
            !['http:', 'https:'].includes(apiUrl.protocol) ||
            apiUrl.username ||
            apiUrl.password
        )
            throw new Error('SOURCE_SYNC.INCOMPATIBLE');
        selected = {
            apiUrl: apiUrl.toString().replace(/\/$/, ''),
            instanceId: connection.instanceId,
        };
        return;
    }
    if (!runtimeBackendUrl || localStorage.getItem(DISABLED_KEY)) return;
    // Runtime BACKEND_URL is already an API base (including a bare backend
    // in development); only manually entered app URLs gain /api.
    const apiUrl = new URL(runtimeBackendUrl, location.href)
        .toString()
        .replace(/\/$/, '');
    // A configured same-instance deployment stays in server mode on later failures.
    try {
        const response = await fetch(`${apiUrl}/v1/instance`, {
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
        });
        if (!response.ok) throw new Error('SOURCE_SYNC.OFFLINE');
        const instance = (await response.json()) as ServerInstanceInfo;
        if (instance.storage === 'none') return;
        assertSourceInstance(instance);
        selected = { apiUrl, instanceId: instance.instanceId! };
    } catch {
        selected = { apiUrl, instanceId: `pending:${apiUrl}` };
    }
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(selected));
}

export function saveBrowserSourceConnection(
    connection: SourceServerConnection,
    token: string
): void {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    localStorage.removeItem(DISABLED_KEY);
    sessionStorage.setItem(tokenKey(connection.apiUrl), token);
}

export function disconnectBrowserSourceConnection(): void {
    if (selected) sessionStorage.removeItem(tokenKey(selected.apiUrl));
    localStorage.removeItem(CONNECTION_KEY);
    localStorage.setItem(DISABLED_KEY, '1');
}

export function sourceAuthorization(url: string): Record<string, string> {
    if (!selected || window.electron?.sourceSyncConnection) return {};
    const target = new URL(url, location.href);
    const backend = new URL(selected.apiUrl);
    if (
        target.origin !== backend.origin ||
        !target.pathname.startsWith(`${backend.pathname.replace(/\/+$/, '')}/`)
    )
        return {};
    const token = sessionStorage.getItem(tokenKey(selected.apiUrl));
    return token ? { Authorization: `Bearer ${token}` } : {};
}
