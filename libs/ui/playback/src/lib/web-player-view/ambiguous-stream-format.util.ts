import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/playback/util';

/**
 * Optional format hint for an extensionless/PHP URL. Never records URLs,
 * request headers or response bodies. A failed/blocked HEAD request leaves
 * the original player routing untouched.
 */
export type AmbiguousStreamFormat = 'hls' | 'mpegts' | null;

export function declaredAmbiguousStreamFormat(
    url: string,
    contentType: string | null
): AmbiguousStreamFormat {
    const extension = getPlaybackMediaExtensionFromUrl(url);
    if (extension === 'm3u8' || extension === 'm3u') return 'hls';
    if (extension === 'ts') return 'mpegts';
    const mime = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mime === 'application/vnd.apple.mpegurl' ||
        mime === 'application/x-mpegurl' ||
        mime === 'audio/mpegurl' ||
        mime === 'audio/x-mpegurl') return 'hls';
    if (mime === 'video/mp2t' || mime === 'video/mpeg2-ts') return 'mpegts';
    return null;
}

export function isAmbiguousStreamUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const extension = getPlaybackMediaExtensionFromUrl(url);
        // Script endpoints commonly serve HLS or TS regardless of .php.
        return !extension || extension === 'php' || extension === 'asp' ||
            extension === 'aspx' || extension === 'cgi';
    } catch {
        return false;
    }
}

/**
 * Only a HEAD request against the already-selected stream URL is attempted.
 * No extra URL, proxy, secrets or body. Hard bounded by a 1.8s abort.
 * Only a recognized content type changes player mode. Unknown fails closed.
 */
export async function probeAmbiguousStreamFormat(
    url: string,
    timeoutMs = 1800,
): Promise<AmbiguousStreamFormat> {
    if (!isAmbiguousStreamUrl(url) || typeof fetch !== 'function') return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
        });
        if (!response.ok) return null;
        return declaredAmbiguousStreamFormat(response.url || url,
            response.headers.get('content-type'));
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
