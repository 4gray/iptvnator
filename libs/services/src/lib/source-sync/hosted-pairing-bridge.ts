import type { SourceServerConnection } from '@iptvnator/shared/interfaces';
import {
    CONNECTION_KEY,
    DISABLED_KEY,
    assertSourceInstance,
    tokenKey,
} from './source-connection';

interface HostedPairingBridge {
    postMessage(message: string): void;
    onmessage: ((message: MessageEvent<string>) => void) | null;
}

function hostedPairingBridge(): HostedPairingBridge | undefined {
    const bridge = (window as Window & { HostedPairing?: HostedPairingBridge })
        .HostedPairing;
    return typeof bridge?.postMessage === 'function' ? bridge : undefined;
}

function requestHostedPairing(
    bridge: HostedPairingBridge,
    action: 'credential' | 'forget',
    instanceId: string
): Promise<{ token?: unknown; forgotten?: unknown } | null> {
    return new Promise((resolve) => {
        const previous = bridge.onmessage;
        const finish = (
            reply: { token?: unknown; forgotten?: unknown } | null
        ) => {
            clearTimeout(timeout);
            bridge.onmessage = previous;
            resolve(reply);
        };
        const timeout = setTimeout(() => finish(null), 1000);
        bridge.onmessage = ({ data }) => {
            try {
                const value = JSON.parse(data);
                finish(value && typeof value === 'object' ? value : null);
            } catch {
                finish(null);
            }
        };
        try {
            bridge.postMessage(JSON.stringify({ action, instanceId }));
        } catch {
            finish(null);
        }
    });
}

export async function restoreNativeHostedPairing(
    runtimeBackendUrl: string
): Promise<SourceServerConnection | null> {
    try {
        const bridge = hostedPairingBridge();
        if (!bridge) return null;
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

export async function forgetHostedPairing(
    instanceId: string
): Promise<boolean> {
    const bridge = hostedPairingBridge();
    return (
        !!bridge &&
        (await requestHostedPairing(bridge, 'forget', instanceId))
            ?.forgotten === true
    );
}
