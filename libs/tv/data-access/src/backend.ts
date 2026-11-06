import { httpUrl } from '@iptvnator/tv/util';
export interface BackendInfo {
    url: string;
    pairing: boolean;
    auth: 'none' | 'token';
}
export function backendUrl(value: string) {
    const url = new URL(httpUrl(value));
    if (url.search || url.hash)
        throw new Error('Use a backend address without query or fragment.');
    return url.href.replace(/\/$/, '');
}
export async function backendJson(
    url: string,
    signal: AbortSignal,
    init?: RequestInit,
    timeout = 4000
) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel);
    if (signal.aborted) cancel();
    const timer = setTimeout(cancel, timeout);
    try {
        const response = await fetch(url, {
            ...init,
            signal: abort.signal,
            cache: 'no-store',
            redirect: 'error',
        });
        if (!response.ok)
            throw new Error(
                response.status === 401
                    ? 'Enter a valid backend access token.'
                    : 'Backend request failed.'
            );
        return await response.json();
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}
/** No credentials during discovery. A responding web server alone is never a match. */
export async function identifyBackend(
    value: string,
    signal: AbortSignal,
    timeout = 4000
): Promise<BackendInfo> {
    const url = backendUrl(value);
    const info = await backendJson(
        `${url}/tv/connection`,
        signal,
        undefined,
        timeout
    );
    if (
        info.service !== 'iptvnator' ||
        info.protocol !== 1 ||
        info.pairing !== true ||
        !['none', 'token'].includes(info.auth)
    )
        throw new Error('This address is not a compatible IPTVnator backend.');
    return { url, pairing: true, auth: info.auth };
}
export async function checkBackend(
    value: string,
    token: string,
    signal: AbortSignal
): Promise<BackendInfo> {
    const info = await identifyBackend(value, signal);
    const response = await backendJson(
        `${info.url}/tv/connection/check`,
        signal,
        {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
    );
    if (response.service !== 'iptvnator' || response.connected !== true)
        throw new Error('Backend API check failed.');
    return info;
}
interface Network {
    ipAddress?: string;
    netmask?: string;
    state?: string;
}
interface Bridge {
    onservicecallback: (text: string) => void;
    call(uri: string, args: string): void;
    cancel(): void;
}
export async function localNetwork(
    signal: AbortSignal
): Promise<Network | undefined> {
    const Bridge = (
        window as unknown as { PalmServiceBridge?: new () => Bridge }
    ).PalmServiceBridge;
    if (!Bridge || signal.aborted) return undefined;
    return new Promise((resolve) => {
        const bridge = new Bridge();
        let done = false;
        const finish = (value?: Network) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
            try {
                bridge.cancel();
            } catch {
                /* Completed one-shot bridge. */
            }
            resolve(value);
        };
        const cancel = () => finish();
        const timer = setTimeout(cancel, 2000);
        signal.addEventListener('abort', cancel);
        bridge.onservicecallback = (text) => {
            try {
                const data = JSON.parse(text);
                finish(
                    [data.wired, data.wifi].find(
                        (n) => n?.state === 'connected' && n.ipAddress
                    )
                );
            } catch {
                finish();
            }
        };
        try {
            bridge.call(
                'luna://com.palm.connectionmanager/getStatus',
                '{"subscribe":false}'
            );
        } catch {
            finish();
        }
    });
}
/** At most one RFC1918 /24, narrowed further for smaller subnets. Never scan public addresses. */
export function discoveryCandidates(network?: Network) {
    const candidates = [
        'http://iptvnator.local:3333',
        'http://iptvnator.local:3335',
        'http://iptvnator.local:4333/api',
    ];
    const ip = network?.ipAddress?.split('.').map(Number);
    const mask = network?.netmask?.split('.').map(Number);
    if (
        !ip ||
        ip.length !== 4 ||
        ip.some((v) => !Number.isInteger(v) || v < 0 || v > 255) ||
        !(
            ip[0] === 10 ||
            (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
            (ip[0] === 192 && ip[1] === 168)
        )
    )
        return candidates;
    if (
        !mask ||
        mask.length !== 4 ||
        mask.slice(0, 3).some((v) => v !== 255) ||
        ![0, 128, 192, 224, 240, 248, 252].includes(mask[3])
    )
        return candidates;
    const start = ip[3] & mask[3];
    const end = start + 255 - mask[3];
    for (let host = start + 1; host < end; host++) {
        if (host === ip[3]) continue;
        const address = `${ip.slice(0, 3).join('.')}.${host}`;
        candidates.push(
            `http://${address}:3333`,
            `http://${address}:3335`,
            `http://${address}:4333/api`
        );
    }
    return candidates;
}
export async function discoverBackends(
    signal: AbortSignal,
    onFound: (info: BackendInfo) => void
) {
    const candidates = discoveryCandidates(await localNetwork(signal));
    let next = 0;
    const deadline = Date.now() + 55_000;
    await Promise.all(
        Array.from({ length: 12 }, async () => {
            while (
                !signal.aborted &&
                Date.now() < deadline &&
                next < candidates.length
            ) {
                const candidate = candidates[next++];
                try {
                    const info = await identifyBackend(candidate, signal, 750);
                    if (!signal.aborted) onFound(info);
                } catch {
                    /* Other LAN services and absent hosts are not backends. */
                }
            }
        })
    );
}
