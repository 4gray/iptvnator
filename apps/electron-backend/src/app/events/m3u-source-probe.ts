import { ipcMain } from 'electron';
import type { Readable } from 'node:stream';
import {
    M3U_SOURCE_PROBE,
    SourceProbeContext,
    SourceHealthResult,
    sourceHealthUnknown,
} from '@iptvnator/shared/interfaces';
import { createPlaylistAgentFactory } from '../util/secure-https';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import { sourceProbeControl } from './source-probe-control';

const LIMIT = 65536;
export function looksLikeM3u(text: string): boolean {
    const value = text.replace(/^\uFEFF/, '').trimStart();
    return (
        /^#EXTM3U(?:\s|$)/.test(value) ||
        /^#EXTINF:[^\r\n]*\r?\n(?:#[^\r\n]*\r?\n)*[^#\s<][^\r\n]*/.test(value)
    );
}
export async function probeM3uSource(
    payload: {
        url: string;
        userAgent?: string;
        trustedInsecureTlsHosts?: string[];
        probe: SourceProbeContext;
    },
    owner: number
): Promise<SourceHealthResult> {
    const control = sourceProbeControl(owner, payload.probe);
    let stream: Readable | undefined;
    try {
        for (const ranged of [true, false]) {
            const response = await requestWithValidatedRedirects<Readable>(
                payload.url,
                {
                    method: 'GET',
                    responseType: 'stream',
                    signal: control.signal,
                    timeout: Math.max(1, payload.probe.deadlineAt - Date.now()),
                    agentFactory: createPlaylistAgentFactory({
                        trustedInsecureTlsHosts:
                            payload.trustedInsecureTlsHosts,
                    }),
                    headers: {
                        ...(payload.userAgent?.trim()
                            ? { 'User-Agent': payload.userAgent.trim() }
                            : {}),
                        ...(ranged ? { Range: `bytes=0-${LIMIT - 1}` } : {}),
                    },
                    validateStatus: () => true,
                },
                { allowPrivateNetworks: true }
            );
            stream = response.data;
            if (ranged && [400, 405, 416].includes(response.status)) {
                stream.destroy();
                continue;
            }
            if (response.status >= 400)
                return {
                    ...sourceHealthUnknown(
                        [401, 403].includes(response.status) ? 'auth' : 'http'
                    ),
                    httpStatus: response.status,
                };
            let body = Buffer.alloc(0);
            for await (const chunk of stream) {
                const bytes = Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk);
                body = Buffer.concat([
                    body,
                    bytes.subarray(0, LIMIT - body.length),
                ]);
                if (looksLikeM3u(body.toString('utf8')))
                    return {
                        state: 'active',
                        reason: 'available',
                        confirmedInactive: false,
                    };
                if (body.length >= LIMIT) return sourceHealthUnknown('unknown');
            }
            return sourceHealthUnknown('invalid');
        }
        return sourceHealthUnknown('http');
    } catch {
        return sourceHealthUnknown(
            control.signal?.aborted
                ? Date.now() >= payload.probe.deadlineAt
                    ? 'timeout'
                    : 'cancelled'
                : 'network'
        );
    } finally {
        stream?.destroy();
        control.dispose();
    }
}
export function registerM3uSourceProbe() {
    ipcMain.handle(M3U_SOURCE_PROBE, (event, payload) =>
        probeM3uSource(payload, event.sender.id)
    );
}
