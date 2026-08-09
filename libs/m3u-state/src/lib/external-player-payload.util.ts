import {
    Channel,
    PlaylistMeta,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { isDashChannel } from '@iptvnator/shared/m3u-utils';

export type ExternalPlayerHeaderFallback = Pick<
    PlaylistMeta,
    'userAgent' | 'referrer' | 'origin'
>;

/**
 * Decides whether activating a channel should auto-launch the configured
 * external player. Radio channels use the inline audio player; DASH (`.mpd`)
 * channels use the inline Shaka engine because MPV/VLC cannot receive the
 * KODIPROP ClearKey configuration.
 */
export function shouldAutoLaunchExternalPlayer(
    settings:
        | { player?: VideoPlayer; openStreamOnDoubleClick?: boolean }
        | null
        | undefined,
    startPlayback: boolean | undefined,
    channel: Channel,
    player: VideoPlayer.MPV | VideoPlayer.VLC
): boolean {
    if (!settings || Object.keys(settings).length === 0) {
        return false;
    }

    const startRequested =
        !settings.openStreamOnDoubleClick || startPlayback === true;
    return (
        startRequested &&
        settings.player === player &&
        channel.radio !== 'true' &&
        !isDashChannel(channel)
    );
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) {
            return trimmed;
        }
    }
    return undefined;
}

/**
 * External players (MPV/VLC, embedded MPV) make their own HTTP requests, so
 * the playlist-level custom User-Agent/Referer/Origin configured on import
 * never reaches them through the Electron webRequest override that covers the
 * built-in web players. Channel-level `#EXTVLCOPT` values stay authoritative;
 * the playlist values only fill the gaps (#1221).
 */
export function resolveExternalPlayerHttpHeaders(
    channel: Pick<Channel, 'http'> | undefined | null,
    playlist?: ExternalPlayerHeaderFallback | null
): {
    'user-agent': string | undefined;
    referer: string | undefined;
    origin: string | undefined;
} {
    return {
        'user-agent': firstNonEmpty(
            channel?.http?.['user-agent'],
            playlist?.userAgent
        ),
        referer: firstNonEmpty(channel?.http?.referrer, playlist?.referrer),
        origin: firstNonEmpty(channel?.http?.origin, playlist?.origin),
    };
}

export function buildExternalPlayerPayload(
    activeChannel: Channel | undefined | null,
    playbackUrl: string,
    playlist?: ExternalPlayerHeaderFallback | null
): {
    url: string;
    title: string;
    'user-agent': string | undefined;
    referer: string | undefined;
    origin: string | undefined;
} | null {
    if (!playbackUrl || !activeChannel) {
        return null;
    }

    return {
        url: playbackUrl,
        title: activeChannel.name ?? '',
        ...resolveExternalPlayerHttpHeaders(activeChannel, playlist),
    };
}
