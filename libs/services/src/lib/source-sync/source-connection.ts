import {
    SOURCE_SYNC_CAPABILITY,
    type SourceServerConnection,
    type ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';

export const CONNECTION_KEY = 'iptvnator:source-server';
export const DISABLED_KEY = 'iptvnator:source-server-disabled';
const INCOMPATIBLE = 'SOURCE_SYNC.INCOMPATIBLE';
const INSTANCE_CHANGED = 'SOURCE_SYNC.INSTANCE_CHANGED';
const OFFLINE = 'SOURCE_SYNC.OFFLINE';
let selected: SourceServerConnection | null = null;
let readFailed = false;
let verified = false;
let verificationEpoch = 0;

export const sourceConnection = () => selected;
export const sourceConnectionReadFailed = () => readFailed;
export function markSourceConnectionReadFailed(): void {
    readFailed = true;
}
export const sourceVerificationEpoch = () => verificationEpoch;
export const sourceProfileName = () =>
    selected
        ? `iptvnator-server:${selected.instanceId}`
        : readFailed
          ? 'iptvnator-recovery'
          : 'iptvnator';
export const tokenKey = ({ apiUrl, instanceId }: SourceServerConnection) =>
    `iptvnator:server-token:${JSON.stringify([apiUrl, instanceId])}`;

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
        throw new Error(INCOMPATIBLE);
    }
}

/** Runs before Angular constructs storage or reads the source inventory. */
export async function prepareSourceConnection(
    runtimeBackendUrl?: string
): Promise<void> {
    selected = null;
    invalidateSourceVerification();
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
                throw new Error(INCOMPATIBLE);
            const apiUrl = new URL(connection.apiUrl);
            if (
                !['http:', 'https:'].includes(apiUrl.protocol) ||
                apiUrl.username ||
                apiUrl.password
            )
                throw new Error(INCOMPATIBLE);
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
        if (!response.ok) throw new Error(OFFLINE);
        const instance = (await response.json()) as ServerInstanceInfo;
        if (instance.storage === 'none') return;
        assertSourceInstance(instance);
        selected = { apiUrl, instanceId: instance.instanceId! };
        verified = true;
    } catch {
        selected = { apiUrl, instanceId: `pending:${apiUrl}` };
    }
    try {
        // Another tab may have connected or disconnected during discovery.
        if (
            localStorage.getItem(CONNECTION_KEY) ||
            localStorage.getItem(DISABLED_KEY)
        ) {
            await prepareSourceConnection();
            return;
        }
        localStorage.setItem(CONNECTION_KEY, JSON.stringify(selected));
    } catch {
        readFailed = true;
    }
}

/** A replacement database at the same address must never receive saved secrets. */
export function verifySourceInstance(
    value: unknown,
    expected = selected,
    epoch = verificationEpoch
): void {
    if (epoch !== verificationEpoch) throw new Error(OFFLINE);
    verified = false;
    assertSourceInstance(value);
    if (value.instanceId !== expected?.instanceId)
        throw new Error(INSTANCE_CHANGED);
    verified = true;
}

export function invalidateSourceVerification(): void {
    verified = false;
    verificationEpoch++;
}

export function isSourceBackendRequest(url: string): boolean {
    if (!selected || window.electron?.sourceSyncConnection) return false;
    const target = new URL(url, location.href);
    const backend = new URL(selected.apiUrl);
    return (
        target.origin === backend.origin &&
        target.pathname.startsWith(`${backend.pathname.replace(/\/+$/, '')}/`)
    );
}

/** Block the whole proxy call: its body/query may contain provider credentials. */
export function assertSourceRequestAllowed(url: string): void {
    if (isSourceBackendRequest(url) && !verified)
        throw new Error(INSTANCE_CHANGED);
}

export function sourceAuthorization(url: string): Record<string, string> {
    if (!verified || !isSourceBackendRequest(url)) return {};
    try {
        const token = sessionStorage.getItem(tokenKey(selected!));
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}
