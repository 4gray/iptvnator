/**
 * ArtPlayer option overrides that toggle its built-in chrome.
 *
 * When the shared `app-player-controls` own the chrome we strip ArtPlayer's
 * skin/affordances but keep the engine (hls/mpegts customType handlers).
 * Otherwise ArtPlayer renders its full default control set.
 */
export function buildArtPlayerChrome(
    sharedControls: boolean
): Record<string, unknown> {
    if (!sharedControls) {
        return {
            pip: true,
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
        setting: false,
        playbackRate: false,
        aspectRatio: false,
        fullscreen: false,
        fullscreenWeb: false,
        pip: false,
        screenshot: false,
        airplay: false,
        autoMini: false,
        // `autoSize` resizes the whole `.art-video-player` element to the
        // video's aspect ratio, leaving black margins inside the container —
        // which the full-bleed overlay then spans (most visible in fullscreen).
        // The shared-controls layout fills the container and lets the
        // `<video>`'s object-fit handle real stream letterboxing instead.
        autoSize: false,
    };
}
