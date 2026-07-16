import type {
    VideoJsPlayer,
    VideoPlayerOptions,
    VideoPlayerSource,
} from './vjs-player.types';

export function createVjsPlayerOptions(
    options: VideoPlayerOptions,
    isMpegTs: boolean,
    sharedControls: boolean
): VideoPlayerOptions {
    const baseOptions = isMpegTs
        ? { ...options, sources: [], autoplay: false }
        : { ...options, autoplay: true };
    if (!sharedControls) {
        return baseOptions;
    }
    return {
        ...baseOptions,
        controls: false,
        userActions: {
            ...options.userActions,
            click: false,
            doubleClick: false,
            hotkeys: false,
        },
        spatialNavigation: {
            ...options.spatialNavigation,
            enabled: false,
        },
    };
}

export function hasVjsPlaybackInputChanged(
    previousOptions: VideoPlayerOptions,
    currentOptions: VideoPlayerOptions,
    previousSource: VideoPlayerSource | undefined,
    currentSource: VideoPlayerSource | undefined
): boolean {
    return (
        previousOptions.reloadToken !== currentOptions.reloadToken ||
        previousSource?.src !== currentSource?.src ||
        previousSource?.type !== currentSource?.type
    );
}

export function hasVjsMpegTsModeChanged(
    previousOptions: VideoPlayerOptions,
    currentOptions: VideoPlayerOptions,
    isMpegTsSource: boolean
): boolean {
    return (
        isMpegTsSource &&
        (previousOptions.isLive !== false) !== (currentOptions.isLive !== false)
    );
}

export function shouldChangeVjsSource(
    previousOptions: VideoPlayerOptions,
    currentOptions: VideoPlayerOptions,
    isMpegTsSource: (url?: string) => boolean
): boolean {
    const previousSource = previousOptions.sources?.[0];
    const currentSource = currentOptions.sources?.[0];
    return (
        hasVjsPlaybackInputChanged(
            previousOptions,
            currentOptions,
            previousSource,
            currentSource
        ) ||
        hasVjsMpegTsModeChanged(
            previousOptions,
            currentOptions,
            isMpegTsSource(currentSource?.src)
        )
    );
}

export function initializeVjsPlugins(player: VideoJsPlayer): void {
    try {
        player.qualitySelectorHls?.({ displayCurrentQuality: true });
    } catch (error) {
        console.warn('qualitySelectorHls plugin failed to initialize:', error);
    }
    try {
        player.aspectRatioPanel?.();
    } catch (error) {
        console.warn('aspectRatioPanel plugin failed to initialize:', error);
    }
}

export function exitOwnedVjsFullscreen(
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

export function queueVjsTask(callback: () => void): void {
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(callback);
    } else {
        void Promise.resolve().then(callback);
    }
}
