export const HOSTED_SERVER_CONTROL = 'hosted-server:control';
export const HOSTED_SERVER_ACCESS_CODE = 'hosted-server:access-code';

export const HOSTED_SERVER_PORT = 4334;

export type HostedServerCommand =
    'status' | 'stop' | { start: true; lanAddress?: string };

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
}

export type HostedServerWorkerMessage =
    | { ready: true; instanceId: string }
    | { error: 'port' | 'startup' };
