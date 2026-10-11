import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type { IptvnatorRuntimeConfig } from '../services/runtime-config';

const PROBE_TIMEOUT_MS = 2_500;

export interface ServerInstanceProbeOptions {
    readonly runtimeConfig?: IptvnatorRuntimeConfig;
    readonly isElectron?: boolean;
    readonly fetchFn?: typeof fetch;
}

/**
 * Asks the backend whether it offers server storage. Runs only when the
 * deployment wrote a runtime `BACKEND_URL` (the Docker entrypoint does), so
 * hosted builds never call an external parser API for it.
 */
export async function probeServerInstance(
    options: ServerInstanceProbeOptions = {}
): Promise<ServerInstanceInfo | null> {
    const runtimeConfig =
        options.runtimeConfig ?? globalThis.window?.__IPTVNATOR_CONFIG__;
    const isElectron = options.isElectron ?? !!globalThis.window?.electron;
    const baseUrl = runtimeConfig?.BACKEND_URL?.trim();
    if (isElectron || !baseUrl) {
        return null;
    }

    try {
        const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
        const response = await fetchFn(
            `${baseUrl.replace(/\/+$/, '')}/v1/instance`,
            {
                cache: 'no-store',
                signal:
                    typeof AbortSignal.timeout === 'function'
                        ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
                        : undefined,
            }
        );
        if (!response.ok) {
            return null;
        }
        const body: unknown = await response.json();
        return isServerInstance(body) && body.storage === 'server'
            ? body
            : null;
    } catch {
        return null;
    }
}

function isServerInstance(value: unknown): value is ServerInstanceInfo {
    const record = value as Partial<ServerInstanceInfo> | null;
    return (
        !!record &&
        record.service === 'iptvnator' &&
        typeof record.apiVersion === 'number' &&
        typeof record.instanceId === 'string' &&
        (record.storage === 'server' || record.storage === 'none') &&
        (record.auth === 'none' || record.auth === 'token')
    );
}
