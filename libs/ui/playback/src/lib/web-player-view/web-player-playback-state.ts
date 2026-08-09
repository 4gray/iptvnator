import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/playback/util';
import type {
    Channel,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { PlayerMediaTitle } from '../player-controls';

export function resolveWebPlayerPlayback(options: {
    readonly playback: ResolvedPortalPlayback | null;
    readonly streamUrl: string;
    readonly title: string;
    readonly startTime: number;
}): ResolvedPortalPlayback {
    return (
        options.playback ?? {
            streamUrl: options.streamUrl,
            title: options.title || options.streamUrl,
            startTime: options.startTime,
        }
    );
}

export function resolveWebPlayerIsLive(
    playback: ResolvedPortalPlayback
): boolean {
    return typeof playback.isLive === 'boolean'
        ? playback.isLive
        : !playback.contentInfo;
}

export function resolveWebPlayerMediaTitle(
    explicit: PlayerMediaTitle | null,
    playback: ResolvedPortalPlayback
): PlayerMediaTitle | null {
    if (explicit?.primary?.trim()) {
        return explicit;
    }
    const title = playback.title?.trim();
    return !title || title === playback.streamUrl
        ? null
        : { primary: title, secondary: null };
}

export function createWebPlayerChannel(
    playback: ResolvedPortalPlayback
): Channel {
    const title = playback.title || playback.streamUrl;
    return {
        id: playback.streamUrl,
        url: playback.streamUrl,
        name: title,
        group: { title: '' },
        tvg: {
            id: '',
            name: title,
            url: '',
            logo: playback.thumbnail ?? '',
            rec: '',
        },
        http: {
            referrer:
                playback.referer ??
                getHeaderValue(playback.headers, 'Referer') ??
                '',
            'user-agent':
                playback.userAgent ??
                getHeaderValue(playback.headers, 'User-Agent') ??
                '',
            origin:
                playback.origin ??
                getHeaderValue(playback.headers, 'Origin') ??
                '',
        },
        radio: 'false',
        drm: playback.drm,
    };
}

export function createVideoJsOptions(options: {
    readonly streamUrl: string;
    readonly isLive: boolean;
    readonly reloadToken: number;
}): {
    readonly isLive: boolean;
    readonly reloadToken: number;
    readonly sources: readonly {
        readonly src: string;
        readonly type: string;
    }[];
} {
    const extension = getPlaybackMediaExtensionFromUrl(options.streamUrl);
    const type =
        extension === 'm3u' || extension === 'm3u8'
            ? 'application/x-mpegURL'
            : extension === 'ts' || !extension
              ? 'video/mp2t'
              : extension === 'mkv'
                ? 'video/matroska'
                : 'video/mp4';

    return {
        isLive: options.isLive,
        reloadToken: options.reloadToken,
        sources: [{ src: options.streamUrl, type }],
    };
}

function getHeaderValue(
    headers: ResolvedPortalPlayback['headers'] | undefined,
    name: string
): string | undefined {
    if (!headers) {
        return undefined;
    }
    const matchingKey = Object.keys(headers).find(
        (key) => key.toLowerCase() === name.toLowerCase()
    );
    return matchingKey ? headers[matchingKey] : undefined;
}
