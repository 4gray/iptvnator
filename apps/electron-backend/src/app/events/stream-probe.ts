/**
 * Stream reachability probe.
 *
 * A cheap "is this URL alive" check that runs in the main process because the
 * renderer cannot do it: a browser request to an arbitrary IPTV host is
 * CORS-blocked, and `no-cors` yields an opaque response where 200, 403 and 404
 * are indistinguishable. Electron does not escape this either — `webSecurity`
 * stays on — so the honest answer has to come from Node.
 *
 * Originally inline in `xtream.events.ts` for catchup URL checks; extracted so
 * VOD multi-source can reuse it, and so that file stays inside its line budget.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import { UnsafeUrlError } from './url-safety';
import { requestWithValidatedRedirects } from '../util/validated-axios';

// Some Xtream panels sit behind Cloudflare (or similar WAFs) configured to
// challenge generic browser-looking User-Agents while allowlisting known
// IPTV player clients. A VLC-style User-Agent reliably passes those checks.
const PROBE_CLIENT_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';
const PROBE_TIMEOUT_MS = 10000;

export interface StreamProbePayload {
    url: string;
    method?: 'GET' | 'HEAD';
}

export interface StreamProbeResponse {
    /**
     * The HTTP status, or 0 when no response was obtained at all.
     *
     * 0 is NOT "offline" — it also covers a timeout and a URL rejected by the
     * redirect-safety policy. Callers must render it as "could not check",
     * never as a dead source.
     */
    status: number;
    url: string;
    /** Round-trip time; present whenever the request completed either way. */
    latencyMs?: number;
    error?: string;
}

export async function runStreamProbe(
    payload: StreamProbePayload
): Promise<StreamProbeResponse> {
    const method = payload.method ?? 'HEAD';
    const config: AxiosRequestConfig = {
        method,
        url: payload.url,
        headers: {
            'User-Agent': PROBE_CLIENT_USER_AGENT,
            // Some servers reject a bare HEAD but answer a tiny ranged GET.
            ...(method === 'GET' ? { Range: 'bytes=0-4095' } : {}),
        },
        timeout: PROBE_TIMEOUT_MS,
        responseType: method === 'GET' ? 'stream' : undefined,
        validateStatus: () => true,
    };

    // Monotonic: a wall-clock change mid-probe must not yield a negative latency.
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    try {
        const response = await requestWithValidatedRedirects(
            payload.url,
            config,
            {
                allowPrivateNetworkRedirects: false,
                allowPrivateNetworks: true,
                pinAllowedPrivateNetworkHosts: true,
            }
        );
        // A ranged GET opens a stream we never read — release it immediately.
        const responseBody = response.data as
            | { destroy?: () => void }
            | undefined;
        responseBody?.destroy?.();
        return {
            status: response.status,
            url: response.config?.url ?? payload.url,
            latencyMs: elapsed(),
        };
    } catch (error) {
        // A refusal still answers the question "is anything there".
        if (axios.isAxiosError(error) && error.response) {
            return {
                status: error.response.status,
                url: payload.url,
                latencyMs: elapsed(),
            };
        }

        if (error instanceof UnsafeUrlError) {
            return {
                status: 0,
                url: payload.url,
                error: error.message,
            };
        }

        return {
            status: 0,
            url: payload.url,
        };
    }
}

export function registerStreamProbeHandlers(): void {
    ipcMain.handle(
        'STREAM_PROBE_URL',
        async (_event, payload: StreamProbePayload) => runStreamProbe(payload)
    );

    // Retained for the Xtream catchup variant probe, which predates this
    // module and whose renderer call site still uses the old channel.
    ipcMain.handle(
        'XTREAM_PROBE_URL',
        async (_event, payload: StreamProbePayload) => runStreamProbe(payload)
    );
}
