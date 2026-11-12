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
    return async (input) => {
        entries ??= loadPlaylistEntries(url, request).catch(() => new Set());
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
    const signal = AbortSignal.timeout(2_000);
    const { data, config } = await Promise.race([
        requestWithValidatedRedirects<string>(
            url,
            {
                headers: {
                    ...mergedHeaders,
                    ...(effectiveOrigin && { Origin: effectiveOrigin }),
                    ...(effectiveReferer && { Referer: effectiveReferer }),
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
    // shortcut: only direct children of a plain M3U; extend once VLC exposes deeper ancestry.
    if (
        !/^#EXTM3U(?:\s|$)/i.test(lines[0] ?? '') ||
        lines.some((line) => line.startsWith('#EXT-X-'))
    )
        return targets;
    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        try {
            const target = new URL(line, config.url ?? url);
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
        return input === decodeURIComponent(url);
    } catch {
        return false;
    }
}
