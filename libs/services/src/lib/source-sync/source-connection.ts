import {
    SOURCE_SYNC_CAPABILITY,
    type SourceServerConnection,
    type ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';

const CONNECTION_KEY = 'iptvnator:source-server';
const DISABLED_KEY = 'iptvnator:source-server-disabled';
let selected: SourceServerConnection | null = null;
let readFailed = false;

export const sourceConnection = () => selected;
export const sourceConnectionReadFailed = () => readFailed;
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
        typeof info.instanceId !== 'string' ||
        !info.instanceId ||
        !Array.isArray(info.capabilities) ||
        !info.capabilities.includes(SOURCE_SYNC_CAPABILITY)
    ) {
        throw new Error('SOURCE_SYNC.INCOMPATIBLE');
    }
}

/** Runs before Angular constructs storage or reads the source inventory. */
export async function prepareSourceConnection(
    runtimeBackendUrl?: string
): Promise<void> {
    selected = null;
    readFailed = false;
    try {
        if (window.electron?.sourceSyncConnection) {
            selected = window.electron.sourceSyncConnection();
            return;
        }
        const saved = localStorage.getItem(CONNECTION_KEY);
        if (saved) {
            const connection = JSON.parse(saved) as SourceServerConnection;
            if (
                typeof connection.apiUrl !== 'string' ||
                typeof connection.instanceId !== 'string' ||
                !connection.instanceId
            )
                throw new Error('SOURCE_SYNC.INCOMPATIBLE');
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
    } catch {
        readFailed = true;
        return;
    }
    // Runtime BACKEND_URL is already an API base (including a bare backend
    // in development); only manually entered app URLs gain /api.
    let apiUrl: string;
    try {
        const parsed = new URL(runtimeBackendUrl!, location.href);
        if (
            !['http:', 'https:'].includes(parsed.protocol) ||
            parsed.username ||
            parsed.password ||
            parsed.search ||
            parsed.hash
        )
            throw new Error('Invalid backend URL');
        apiUrl = parsed.toString().replace(/\/$/, '');
    } catch {
        readFailed = true;
        return;
    }
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
    try {
        localStorage.setItem(CONNECTION_KEY, JSON.stringify(selected));
    } catch {
        readFailed = true;
    }
}

export function saveBrowserSourceConnection(
    connection: SourceServerConnection,
    token: string
): void {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    localStorage.removeItem(DISABLED_KEY);
    sessionStorage.setItem(tokenKey(connection.apiUrl), token);
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
        readFailed = true;
        return false;
    }
    try {
        if (selected) sessionStorage.removeItem(tokenKey(selected.apiUrl));
    } catch {
        /* Storage denied. */
    }
    try {
        localStorage.removeItem(CONNECTION_KEY);
        if (disableDiscovery) localStorage.setItem(DISABLED_KEY, '1');
        return true;
    } catch {
        readFailed = true;
        return false;
    }
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
    try {
        const token = sessionStorage.getItem(tokenKey(selected.apiUrl));
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}
