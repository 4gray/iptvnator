import { Injectable } from '@angular/core';
import type {
    StreamProbeHeaders,
    VodSourceProbeResult,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';

/**
 * On-demand stream reachability checks via the Electron main process.
 *
 * The renderer cannot do this itself: a browser request to an arbitrary IPTV
 * host is CORS-blocked, and `no-cors` returns an opaque response in which 200,
 * 403 and 404 are indistinguishable. So in the PWA `isAvailable` is false and
 * every source stays honestly "unchecked" rather than being guessed at.
 *
 * Probing is explicitly user-triggered — this is not a background pinger.
 */

/** Results older than this are re-fetched; a stream can die at any moment. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
    result: VodSourceProbeResult;
    storedAt: number;
}

@Injectable({ providedIn: 'root' })
export class StreamProbeService {
    private readonly cache = new Map<string, CacheEntry>();
    /** Deduplicates concurrent probes of the same URL into one request. */
    private readonly inFlight = new Map<string, Promise<VodSourceProbeResult>>();

    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.probeStreamUrl === 'function'
        );
    }

    /** A cached result for this URL, if one is still fresh. */
    peek(url: string): VodSourceProbeResult | null {
        const entry = this.cache.get(url);
        if (!entry || Date.now() - entry.storedAt > CACHE_TTL_MS) {
            return null;
        }
        return entry.result;
    }

    /**
     * @param headers what the owning playlist plays this stream with. A panel
     * that requires them answers 401/403 without them, and a source that plays
     * fine must never be reported as dead.
     */
    async probe(
        url: string,
        method: 'GET' | 'HEAD' = 'HEAD',
        headers?: StreamProbeHeaders
    ): Promise<VodSourceProbeResult> {
        if (!this.isAvailable || !url) {
            // Not "offline" — we are simply unable to find out.
            return { status: 'unknown' };
        }

        const cached = this.peek(url);
        if (cached) {
            return cached;
        }

        const pending = this.inFlight.get(url);
        if (pending) {
            return pending;
        }

        const request = this.runProbe(url, method, headers).finally(() => {
            this.inFlight.delete(url);
        });
        this.inFlight.set(url, request);
        return request;
    }

    /** Drops cached results, e.g. after a playlist refresh changed the URLs. */
    invalidate(): void {
        this.cache.clear();
    }

    private async runProbe(
        url: string,
        method: 'GET' | 'HEAD',
        headers?: StreamProbeHeaders
    ): Promise<VodSourceProbeResult> {
        let result: VodSourceProbeResult;

        try {
            let response = await window.electron.probeStreamUrl(
                url,
                method,
                headers
            );

            // Plenty of stream servers reject HEAD outright yet serve the media
            // happily over GET. Reporting those as unavailable would be a
            // confident lie, so retry once with the ranged GET the main process
            // already supports.
            if (method === 'HEAD' && refusesHeadRequests(response.status)) {
                response = await window.electron.probeStreamUrl(
                    url,
                    'GET',
                    headers
                );
            }

            result = {
                status: toProbeStatus(response.status),
                httpStatus: response.status,
                latencyMs: response.latencyMs,
                probedAt: new Date().toISOString(),
            };
        } catch (error) {
            // The probed URL is a stream URL, and Xtream builds those out
            // of the username and password — never log one raw.
            console.warn('Stream probe failed:', redactSensitiveData(error));
            result = { status: 'unknown' };
        }

        // Only cache answers. An 'unknown' is a failure to measure, and
        // caching it would keep a perfectly good source looking unverified
        // for the whole TTL.
        if (result.status !== 'unknown') {
            this.cache.set(url, { result, storedAt: Date.now() });
        }

        return result;
    }
}

/**
 * Map an HTTP status onto a verdict.
 *
 * Status 0 means no response was obtained at all — a timeout, or a URL the
 * redirect-safety policy refused. That is NOT evidence the source is dead, so
 * it maps to 'unknown' and the UI keeps offering a check.
 */
/** Statuses that mean "not this method", not "not this resource". */
function refusesHeadRequests(httpStatus: number): boolean {
    return httpStatus === 405 || httpStatus === 501;
}

function toProbeStatus(httpStatus: number): VodSourceProbeResult['status'] {
    if (httpStatus === 0) {
        return 'unknown';
    }
    if (httpStatus >= 200 && httpStatus < 400) {
        return 'ok';
    }
    return 'fail';
}
