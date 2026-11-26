export const HOSTED_SERVER_CONTROL = 'hosted-server:control';
export const HOSTED_SERVER_ACCESS_CODE = 'hosted-server:access-code';
export const HOSTED_DEVICE_CONTROL = 'hosted-server:devices';
export const HOSTED_PAIRING_PASSWORD_MIN_LENGTH = 12;
export const HOSTED_PAIRING_PASSWORD_MAX_LENGTH = 128;

export type HostedDeviceCommand =
    | { action: 'invite' }
    | { action: 'list'; inviteId?: string }
    | { action: 'approve'; claimId: string }
    | { action: 'revoke'; deviceId: string }
    | { action: 'set-device-approval'; deviceId: string; canApprove: boolean }
    | { action: 'browser-settings' }
    | { action: 'set-browser-password'; password: string | null };

export interface HostedDeviceInvite {
    url: string;
    expiresAt: string;
}

export interface HostedDeviceList {
    inviteActive?: boolean;
    pending: {
        claimId: string;
        inviteId: string;
        name: string;
        confirmationCode: string;
    }[];
    devices: { id: string; name: string; canApprove: boolean }[];
}

export interface HostedDeviceResults {
    invite: HostedDeviceInvite;
    list: HostedDeviceList;
    approve: void;
    revoke: void;
    'set-device-approval': void;
    'browser-settings': { passwordConfigured: boolean };
    'set-browser-password': void;
}

export const HOSTED_SERVER_PORT = 4334;
export const HOSTED_SERVER_HTTPS_PORT = 4335;

export type HostedServerMode =
    | { mode: 'lan'; address: string; access: 'paired' | 'open' }
    | {
          mode: 'https' | 'proxy';
          origin: string;
          address: string;
          certificatePath: string;
          keyPath: string;
      }
    | {
          mode: 'cloudflare';
          origin: string;
          certificatePath: string;
          keyPath: string;
          team: string;
          audience: string;
          managed: boolean;
      };

export interface HostedWorkerRequest {
    path: string;
    method: string;
    headers?: Record<string, string>;
    body?: unknown;
}

export interface HostedWorkerResponse {
    status: number;
    etag?: string;
    retryAfter?: number;
    body: unknown;
}

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
    | { start: true; configuration: HostedServerMode; connectorToken?: string }
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
    error?: 'port' | 'startup' | 'tls' | 'connector';
    configuration?: HostedServerMode;
    savedConfigurations?: Partial<Record<HostedServerMode['mode'], HostedServerMode>>;
    mode?: HostedServerMode['mode'];
    endpoint?: string;
    publicRoute?: 'unchecked' | 'access-protected' | 'unverified';
    /** Separately enabled local origin for an externally managed HTTPS proxy. */
    httpsOrigin?: string;
    httpsError?: boolean;
}

export type HostedServerWorkerMessage =
    | { ready: true; instanceId: string }
    | { reply: string; response?: HostedWorkerResponse }
    | { https: true; requestId: string; origin: string; failed?: boolean }
    | { error: 'port' | 'startup' | 'tls' };

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
