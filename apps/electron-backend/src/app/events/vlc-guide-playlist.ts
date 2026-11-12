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
    const { data } = await requestWithValidatedRedirects<string>(
        url,
        {
            headers: {
                ...mergedHeaders,
                ...(effectiveOrigin && { Origin: effectiveOrigin }),
                ...(effectiveReferer && { Referer: effectiveReferer }),
                ...(effectiveUserAgent && { 'User-Agent': effectiveUserAgent }),
            },
            responseType: 'text',
            maxContentLength: 64 * 1024,
            timeout: 2_000,
            signal: AbortSignal.timeout(2_000),
            proxy: false,
        },
        { allowPrivateNetworks: true },
        0
    );
    const targets = new Set<string>();
    const lines = data
        .trimStart()
        .split(/\r?\n/)
        .map((line) => line.trim());
    // shortcut: only direct children of a plain M3U; extend once VLC exposes deeper ancestry.
    if (
        lines[0] !== '#EXTM3U' ||
        lines.some((line) => line.startsWith('#EXT-X-'))
    )
        return targets;
    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        try {
            const target = new URL(line, url);
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
