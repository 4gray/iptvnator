import {
    SOURCE_SYNC_CAPABILITY,
    type SourceServerConnection,
    type ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';
import {
    hostedPairingBridge,
    requestHostedPairing,
} from './hosted-pairing-bridge';

export const CONNECTION_KEY = 'iptvnator:source-server';
export const DISABLED_KEY = 'iptvnator:source-server-disabled';
const INCOMPATIBLE = 'SOURCE_SYNC.INCOMPATIBLE';
const OFFLINE = 'SOURCE_SYNC.OFFLINE';
let selected: SourceServerConnection | null = null;
let nativePairing: SourceServerConnection | null = null;
let readFailed = false;
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

export function parseSourceConnection(raw: string): SourceServerConnection {
    const connection = JSON.parse(raw) as SourceServerConnection;
    if (
        typeof connection?.apiUrl !== 'string' ||
        typeof connection.instanceId !== 'string' ||
        !connection.instanceId
    )
        throw new Error(INCOMPATIBLE);
    const apiUrl = new URL(connection.apiUrl);
    if (
        !['http:', 'https:'].includes(apiUrl.protocol) ||
        apiUrl.username ||
        apiUrl.password ||
        apiUrl.search ||
        apiUrl.hash
    )
        throw new Error(INCOMPATIBLE);
    return {
        apiUrl: apiUrl.toString().replace(/\/$/, ''),
        instanceId: connection.instanceId,
    };
}

export function assertSourceInstance(
    value: unknown
): asserts value is ServerInstanceInfo & { instanceId: string } {
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
    nativePairing = null;
    invalidateSourceVerification();
    readFailed = false;
    try {
        if (window.electron?.sourceSyncConnection) {
            selected = window.electron.sourceSyncConnection();
            return;
        }
        const nativeAccess = window as Window & {
            HostedAccessApi?: unknown;
            __iptvnatorHostedAccessInstance?: string;
        };
        const instanceId = nativeAccess.__iptvnatorHostedAccessInstance;
        if (nativeAccess.HostedAccessApi && typeof instanceId === 'string' && instanceId) {
            selected = { apiUrl: `${location.origin}/api`, instanceId };
            return;
        }
        const bridge = hostedPairingBridge();
        if (bridge && runtimeBackendUrl) {
            const paired = await restoreNativeHostedPairing(
                bridge,
                runtimeBackendUrl
            );
            if (paired) {
                selected = nativePairing = paired;
                return;
            }
        }
        const saved = localStorage.getItem(CONNECTION_KEY);
        if (saved) {
            selected = parseSourceConnection(saved);
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
        if (response.status === 404) return;
        if (!response.ok) throw new Error(OFFLINE);
        const instance = (await response.json()) as ServerInstanceInfo;
        if (instance.storage === 'none') return;
        assertSourceInstance(instance);
        selected = { apiUrl, instanceId: instance.instanceId! };
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

async function restoreNativeHostedPairing(
    bridge: NonNullable<ReturnType<typeof hostedPairingBridge>>,
    runtimeBackendUrl: string
): Promise<SourceServerConnection | null> {
    try {
        const api = new URL(runtimeBackendUrl, location.href);
        if (api.href !== `${location.origin}/api`) return null;
        const response = await fetch(`${api.href}/v1/instance`, {
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
        });
        if (!response.ok) return null;
        const info: unknown = await response.json();
        assertSourceInstance(info);
        const instanceId = info.instanceId!;
        const reply = await requestHostedPairing(
            bridge,
            'credential',
            instanceId
        );
        const token = reply?.token;
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
            return null;
        const connection = { apiUrl: api.href, instanceId };
        sessionStorage.setItem(tokenKey(connection), token);
        localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
        localStorage.removeItem(DISABLED_KEY);
        return connection;
    } catch {
        return null;
    }
}

export async function forgetNativeHostedPairing(): Promise<void> {
    if (!nativePairing || nativePairing !== selected) return;
    const bridge = hostedPairingBridge();
    if (
        !bridge ||
        (await requestHostedPairing(bridge, 'forget', nativePairing.instanceId))
            ?.forgotten !== true
    ) {
        throw new Error('SOURCE_SYNC.REQUEST_FAILED');
    }
    nativePairing = null;
}

export function invalidateSourceVerification(): void {
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
