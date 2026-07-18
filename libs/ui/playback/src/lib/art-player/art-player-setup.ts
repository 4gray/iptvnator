import { getPlaybackMediaExtensionFromUrl } from '../playback-diagnostics/playback-diagnostics.util';

/**
 * ArtPlayer option overrides for the legacy and shared-control surfaces.
 *
 * The flag-off branch deliberately mirrors the existing runtime options. The
 * flag-on branch disables every optional ArtPlayer interaction owner; a
 * transparent capture surface blocks the core click/double-click handlers that
 * ArtPlayer installs independently of these options.
 */
export function buildArtPlayerChrome(
    sharedControls: boolean
): Record<string, unknown> {
    if (!sharedControls) {
        return {
            pip: true,
            autoPlayback: true,
            autoSize: true,
            autoMini: true,
            screenshot: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            airplay: true,
        };
    }

    return {
        controls: [],
        pip: false,
        autoPlayback: false,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: false,
        playbackRate: false,
        aspectRatio: false,
        fullscreen: false,
        fullscreenWeb: false,
        airplay: false,
        hotkey: false,
        fastForward: false,
        autoOrientation: false,
        lock: false,
        gesture: false,
        miniProgressBar: false,
        subtitleOffset: false,
    };
}

export function resolveArtPlayerIsLive(
    sharedControls: boolean,
    authoritativeIsLive: boolean,
    url: string
): boolean {
    if (sharedControls) {
        return authoritativeIsLive;
    }

    const extension = getPlaybackMediaExtensionFromUrl(url);
    return extension === 'm3u8' || extension === 'ts' || !extension;
}

export function getArtPlayerVideoType(url: string): string {
    const extension = getPlaybackMediaExtensionFromUrl(url);
    switch (extension) {
        case 'mkv':
            return 'video/matroska';
        case 'm3u8':
            return 'm3u8';
        case 'mp4':
            return 'mp4';
        case 'mpd':
            return 'mpd';
        case 'ts':
            return 'ts';
        default:
            // Extensionless IPTV proxy/script URLs are predominantly raw
            // MPEG-TS and retain the established ArtPlayer fallback.
            return extension ? 'auto' : 'ts';
    }
}

export function exitOwnedArtPlayerFullscreen(
    sharedControls: boolean,
    surface: HTMLElement | undefined,
    reportError: (error: unknown) => void
): void {
    if (
        !sharedControls ||
        document.fullscreenElement !== surface ||
        typeof document.exitFullscreen !== 'function'
    ) {
        return;
    }

    try {
        void Promise.resolve(document.exitFullscreen()).catch(reportError);
    } catch (error: unknown) {
        reportError(error);
    }
}
