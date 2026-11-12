import { once } from 'node:events';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import type { EffectiveExternalPlaybackRequest } from './external-player-playback-request';

export type VlcGuidePlaylistRequest = Omit<
    EffectiveExternalPlaybackRequest,
    'headerFields'
>;

export function matchVlcGuidePlaylist(
    url: string,
    request: VlcGuidePlaylistRequest
): (input: string) => Promise<boolean> {
    let entries: Promise<Set<string>> | undefined;
    let failures = 0;
    let retryAt = 0;
    return async (input) => {
        if (!entries && performance.now() < retryAt) return false;
        entries ??= loadPlaylistEntries(url, request).catch(() => {
            // shortcut: three retries per tune; extend when longer provider outages need automatic recovery.
            if (++failures <= 3) {
                entries = undefined;
                retryAt = performance.now() + 5_000;
            }
            return new Set<string>();
        });
        for (const target of await entries)
            if (matchesVlcInput(input, target)) return true;
        return false;
    };
}

async function loadPlaylistEntries(
    url: string,
    request: VlcGuidePlaylistRequest
) {
    const {
        mergedHeaders,
        effectiveOrigin,
        effectiveReferer,
        effectiveUserAgent,
    } = request;
    const referer = effectiveReferer || effectiveOrigin;
    const signal = AbortSignal.timeout(2_000);
    const { data, config, headers } = await Promise.race([
        requestWithValidatedRedirects<string>(
            url,
            {
                headers: {
                    ...mergedHeaders,
                    ...(effectiveOrigin && { Origin: effectiveOrigin }),
                    ...(referer && { Referer: referer }),
                    ...(effectiveUserAgent && {
                        'User-Agent': effectiveUserAgent,
                    }),
                },
                responseType: 'text',
                maxContentLength: 64 * 1024,
                timeout: 2_000,
                signal,
                proxy: false,
            },
            {
                allowPrivateNetworks: true,
                allowPrivateNetworkRedirects: false,
                pinAllowedPrivateNetworkHosts: true,
            },
            3
        ),
        // Validation can still be resolving a hostname when the HTTP deadline expires.
        once(signal, 'abort').then(() => {
            throw signal.reason;
        }),
    ]);
    const targets = new Set<string>();
    const lines = data
        .trimStart()
        .split(/\r?\n/)
        .map((line) => line.trim());
    const finalUrl = new URL(config.url ?? url);
    const contentType = String(headers?.['content-type'] ?? '')
        .split(';')[0]
        .trim();
    const hasM3uHint =
        /\.m3u8?$/i.test(finalUrl.pathname) ||
        /^(?:application\/(?:vnd\.apple\.|x-)?|audio\/(?:x-)?)mpegurl$/i.test(
            contentType
        );
    // shortcut: only direct children of a plain M3U; extend once VLC exposes deeper ancestry.
    if (
        (!hasM3uHint && !/^#EXTM3U(?:\s|$)/i.test(lines[0] ?? '')) ||
        lines.some((line) => /^#EXT-X-/i.test(line))
    )
        return targets;
    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        try {
            const target = new URL(line, finalUrl);
            if (target.protocol === 'http:' || target.protocol === 'https:')
                targets.add(target.href);
        } catch {
            // Invalid entries cannot confirm a stream.
        }
    }
    return targets;
}

export function matchesVlcInput(input: string, url: string): boolean {
    if (input === url) return true;
    try {
        const normalize = (value: string) =>
            new URL(value).href.replace(/%[0-9a-f]{2}/gi, (escape) => {
                const character = String.fromCharCode(
                    parseInt(escape.slice(1), 16)
                );
                return /^[\w.~-]$/.test(character)
                    ? character
                    : escape.toUpperCase();
            });
        return normalize(input) === normalize(url);
    } catch {
        return false;
    }
}
