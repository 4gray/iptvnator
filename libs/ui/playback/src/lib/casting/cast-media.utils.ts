import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { getPlaybackMediaExtensionFromUrl } from '../playback-diagnostics/playback-media-source.util';

type RemotePlaybackMediaElement = HTMLMediaElement & {
    remote?: {
        prompt: () => Promise<void>;
    };
    webkitShowPlaybackTargetPicker?: () => void;
};

export function findCastMediaElement(
    controlElement: Element
): RemotePlaybackMediaElement | null {
    const host =
        controlElement.closest('.web-player-view, .radio-hero') ??
        controlElement.parentElement;

    return (
        host?.querySelector<RemotePlaybackMediaElement>('video, audio') ?? null
    );
}

export function isDirectCastUrl(streamUrl: string): boolean {
    try {
        const url = new URL(streamUrl);
        const hostname = url.hostname.toLowerCase();
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            !url.username &&
            !url.password &&
            hostname !== 'localhost' &&
            !hostname.endsWith('.localhost') &&
            hostname !== '[::1]' &&
            hostname !== '0.0.0.0' &&
            !hostname.startsWith('127.')
        );
    } catch {
        return false;
    }
}

export function getSafeCastThumbnailUrl(
    playback: ResolvedPortalPlayback
): string | undefined {
    if (!playback.thumbnail || !isDirectCastUrl(playback.thumbnail)) {
        return undefined;
    }

    try {
        const streamUrl = new URL(playback.streamUrl);
        const thumbnailUrl = new URL(playback.thumbnail);
        return streamUrl.origin === thumbnailUrl.origin
            ? thumbnailUrl.toString()
            : undefined;
    } catch {
        return undefined;
    }
}

export function getCastMediaType(streamUrl: string): string {
    const extension = getPlaybackMediaExtensionFromUrl(streamUrl);
    switch (extension) {
        case 'm3u':
        case 'm3u8':
            return 'application/x-mpegURL';
        case 'ts':
            return 'video/mp2t';
        case 'mp3':
            return 'audio/mpeg';
        case 'aac':
            return 'audio/aac';
        case 'm4a':
            return 'audio/mp4';
        case 'webm':
            return 'video/webm';
        case 'mkv':
            return 'video/x-matroska';
        case 'mp4':
            return 'video/mp4';
        default:
            return extension ? 'video/mp4' : 'video/mp2t';
    }
}

export function supportsAirPlayPicker(media: HTMLMediaElement | null): boolean {
    return (
        typeof (media as RemotePlaybackMediaElement | null)
            ?.webkitShowPlaybackTargetPicker === 'function'
    );
}

export function supportsRemotePlaybackPicker(
    media: HTMLMediaElement | null
): boolean {
    return (
        typeof (media as RemotePlaybackMediaElement | null)?.remote?.prompt ===
        'function'
    );
}
