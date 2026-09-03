import {
    PlaybackSourceKind,
    getPlaybackMediaExtensionFromUrl,
    resolvePlaybackUrlSourceKind,
} from '@iptvnator/playback/util';

/**
 * ArtPlayer `type` under which every container that is not an HLS/DASH
 * manifest or raw MPEG-TS (mkv, webm, mp4, avi, mov, m4v, …) reaches
 * `ArtPlayerSourceSession`'s native path. One key keeps the session the owner
 * of that source change (engine teardown plus controls binding) instead of
 * ArtPlayer's bare `video.src` assignment for an unmatched type.
 */
export const ART_PLAYER_NATIVE_SOURCE_TYPE = 'native';

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
            // The app-level legacy shortcuts own the keyboard: ArtPlayer's
            // focus-scoped hotkeys ignore `defaultPrevented` and would
            // double-handle every key they cover.
            hotkey: false,
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

/**
 * Maps the shared URL routing decision onto the `customType` keys served by
 * `ArtPlayerSourceSession`, so ArtPlayer and the HTML5 player always pick the
 * same engine for a URL.
 */
export function getArtPlayerVideoType(url: string): string {
    switch (resolvePlaybackUrlSourceKind(url)) {
        case PlaybackSourceKind.Dash:
            return 'mpd';
        case PlaybackSourceKind.Hls:
            return 'm3u8';
        case PlaybackSourceKind.MpegTs:
            return 'ts';
        default:
            return ART_PLAYER_NATIVE_SOURCE_TYPE;
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
