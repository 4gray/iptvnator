export const HOSTED_SERVER_CONTROL = 'hosted-server:control';
export const HOSTED_SERVER_ACCESS_CODE = 'hosted-server:access-code';

export const HOSTED_SERVER_PORT = 4334;
export const HOSTED_SERVER_HTTPS_PORT = 4335;

export function parseHostedHttpsOrigin(value: string): URL {
    if (!/^https:\/\/[^/?#\\\s]+\/?$/i.test(value))
        throw new Error('Expected an HTTPS origin');
    const url = new URL(value);
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.href !== `${url.origin}/`
    ) {
        throw new Error(
            'Expected an HTTPS origin without a path or credentials'
        );
    }
    return url;
}

export type HostedServerCommand =
    | 'status'
    | 'stop'
    | { start: true; lanAddress?: string }
    | { restart: true; lanAddress: string }
    | { httpsOrigin: string };

export interface HostedServerStatus {
    state:
        | 'unavailable'
        | 'stopped'
        | 'starting'
        | 'running'
        | 'stopping'
        | 'error';
    autoStart?: boolean;
    localUrl?: string;
    lanUrl?: string;
    lanAddress?: string;
    availableAddresses?: string[];
    error?: 'port' | 'startup';
    /** Separately enabled local origin for an externally managed HTTPS proxy. */
    httpsOrigin?: string;
    httpsError?: boolean;
}

export type HostedServerWorkerMessage =
    | { ready: true; instanceId: string }
    | { https: true; requestId: string; origin: string; failed?: boolean }
    | { error: 'port' | 'startup' };

/** The connector process state; running does not verify external tunnel connectivity. */
export const HOSTED_CLOUDFLARE_CONTROL = 'hosted-cloudflare:control';
export type HostedCloudflareCommand =
    | 'status'
    | 'stop'
    | 'forget'
    | { start: true; token?: string };
export interface HostedCloudflareStatus {
    state: 'unavailable' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
    savedToken: boolean;
    secureStorage: boolean;
}
