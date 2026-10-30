import { RuntimeCapabilitiesService, takeSlowStart } from '@iptvnator/services';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type { IptvnatorRuntimeConfig } from '../services/runtime-config';

const PROBE_TIMEOUT_MS = 2_500;
/** After a reload for a server that answered later: as long as requests. */
const SLOW_PROBE_TIMEOUT_MS = 20_000;

/**
 * - `skipped`: no runtime backend URL, or Electron.
 * - `server` / `none`: the backend answered (a 404 is an older backend).
 * - `unreachable`: no answer, a timeout, a 5xx (nginx answers 502 while
 *   the backend restarts) or another refusal such as a proxy's 429, so the
 *   result says nothing about storage.
 */
export type ServerInstanceProbe =
    | { readonly kind: 'skipped' | 'none' | 'unreachable' }
    | { readonly kind: 'server'; readonly instance: ServerInstanceInfo };

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
): Promise<ServerInstanceProbe> {
    const runtimeConfig =
        options.runtimeConfig ?? globalThis.window?.__IPTVNATOR_CONFIG__;
    // The capability service has no dependencies, so it works before
    // bootstrap and keeps one definition of the desktop runtime.
    const isElectron =
        options.isElectron ?? new RuntimeCapabilitiesService().isElectron;
    const baseUrl = runtimeConfig?.BACKEND_URL?.trim();
    if (isElectron || !baseUrl) {
        return { kind: 'skipped' };
    }

    let response: Response;
    try {
        const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
        response = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/v1/instance`, {
            cache: 'no-store',
            signal:
                typeof AbortSignal.timeout === 'function'
                    ? AbortSignal.timeout(
                          takeSlowStart()
                              ? SLOW_PROBE_TIMEOUT_MS
                              : PROBE_TIMEOUT_MS
                      )
                    : undefined,
        });
    } catch {
        return { kind: 'unreachable' };
    }
    if (response.status === 404) {
        // A backend from before server storage has no /v1 routes.
        return { kind: 'none' };
    }
    if (!response.ok) {
        return { kind: 'unreachable' };
    }
    try {
        const body: unknown = await response.json();
        return isServerInstance(body) && body.storage === 'server'
            ? { kind: 'server', instance: body }
            : { kind: 'none' };
    } catch (error) {
        // Unparseable JSON is an answer; a cut-off body is an outage.
        return error instanceof SyntaxError
            ? { kind: 'none' }
            : { kind: 'unreachable' };
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
