export type WebKitFullscreenVideo = HTMLVideoElement & {
    readonly webkitPresentationMode?: string;
    readonly webkitSupportsFullscreen?: boolean;
    readonly webkitDisplayingFullscreen?: boolean;
    webkitEnterFullscreen?: () => void;
    webkitExitFullscreen?: () => void;
};

export function isNativeVideoFullscreen(
    video: WebKitFullscreenVideo | null
): boolean {
    const mode = video?.webkitPresentationMode;
    // The legacy flag can also be true in Picture in Picture.
    return mode === undefined
        ? video?.webkitDisplayingFullscreen === true
        : mode === 'fullscreen';
}
