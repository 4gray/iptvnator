interface HostedPairingBridge {
    postMessage(message: string): void;
    onmessage: ((message: MessageEvent<string>) => void) | null;
}

export function hostedPairingBridge(): HostedPairingBridge | undefined {
    const bridge = (window as Window & { HostedPairing?: HostedPairingBridge })
        .HostedPairing;
    return typeof bridge?.postMessage === 'function' ? bridge : undefined;
}

export function requestHostedPairing(
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
