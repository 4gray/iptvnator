import { once } from 'node:events';
import { XTREAM_CLIENT_USER_AGENT } from '@iptvnator/shared/interfaces';
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
    let entries: Set<string> | null | undefined;
    let pending: Promise<void> | undefined;
    let failures = 0;
    let retryAt = 0;
    const matches = (input: string) => {
        for (const target of entries ?? [])
            if (matchesVlcInput(input, target)) return true;
        return false;
    };
    return async (input) => {
        if (matches(input)) return true;
        // shortcut: three consecutive retries; extend for longer provider outages.
        if (
            !pending &&
            entries !== null &&
            failures <= 3 &&
            performance.now() >= retryAt
        )
            pending = loadPlaylistEntries(url, request)
                .then(
                    (next) => {
                        entries = next ?? entries ?? null;
                        failures = 0;
                    },
                    () => {
                        failures++;
                    }
                )
                .finally(() => {
                    retryAt = performance.now() + 5_000;
                    pending = undefined;
                });
        await pending;
        return matches(input);
    };
}

async function loadPlaylistEntries(
    url: string,
    request: VlcGuidePlaylistRequest
) {
    const input = new URL(url);
    const targets = new Set<string>();
    if (/\.(?:ts|m2ts|mp4|mkv|mp3|aac|webm|mpeg|mpg)$/i.test(input.pathname))
        return null;
    const {
        mergedHeaders,
        effectiveOrigin,
        effectiveReferer,
        effectiveUserAgent,
    } = request;
    const referer = effectiveReferer || effectiveOrigin;
    const headers = {
        ...mergedHeaders,
        ...(effectiveOrigin && { Origin: effectiveOrigin }),
        ...(referer && { Referer: referer }),
        'User-Agent': effectiveUserAgent?.trim() || XTREAM_CLIENT_USER_AGENT,
    };
    const signal = AbortSignal.timeout(2_000);
    // DNS validation can still be running when the HTTP deadline expires.
    const deadline = once(signal, 'abort').then(() => {
        throw signal.reason;
    });
    const {
        data,
        config,
        headers: responseHeaders,
    } = await Promise.race([
        requestWithValidatedRedirects<string>(
            input.href,
            {
                method: 'HEAD',
                headers,
                headersForUnsafeRedirect: {
                    'User-Agent': XTREAM_CLIENT_USER_AGENT,
                },
                validateStatus: (status) =>
                    (status >= 200 && status < 300) ||
                    status === 405 ||
                    status === 501,
                getAfterHead: (head, target) =>
                    head.status === 405 || head.status === 501
                        ? target.href === input.href && isM3uPath(input)
                        : hasM3uHint(target, head.headers?.['content-type']),
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
        deadline,
    ]);
    if (config.method?.toUpperCase() !== 'GET') return null;
    const finalUrl = new URL(config.url ?? url);
    const lines = data
        .trimStart()
        .split(/\r?\n/)
        .map((line) => line.trim());
    // shortcut: only direct children of a plain M3U; extend once VLC exposes deeper ancestry.
    if (
        (!hasM3uHint(finalUrl, responseHeaders?.['content-type']) &&
            !/^#EXTM3U(?:\s|$)/i.test(lines[0] ?? '')) ||
        lines.some((line) => /^#EXT-X-/i.test(line))
    )
        return null;
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

function isM3uPath(url: URL): boolean {
    return /\.m3u8?$/i.test(url.pathname);
}

function hasM3uHint(url: URL, header: unknown): boolean {
    const type = String(header ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    return (
        /^(?:application\/(?:vnd\.apple\.|x-)?|audio\/(?:x-)?)mpegurl$/.test(
            type
        ) ||
        (isM3uPath(url) &&
            ['', 'text/plain', 'application/octet-stream'].includes(type))
    );
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
