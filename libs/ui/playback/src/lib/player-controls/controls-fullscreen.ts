import { signal } from '@angular/core';
import {
    isNativeVideoFullscreen,
    type WebKitFullscreenVideo,
} from '../web-video-support/webkit-video-fullscreen';

const VIDEO_FULLSCREEN_EVENTS = [
    'loadedmetadata',
    'emptied',
    'resize',
    'webkitbeginfullscreen',
    'webkitendfullscreen',
    'webkitpresentationmodechanged',
] as const;

/**
 * Fullscreens the DOM target or falls back to native video fullscreen when
 * the shared controls supply a video surface.
 */
export class ControlsFullscreen {
    readonly isFullscreen = signal(false);
    private readonly canVideoFullscreen = signal(false);
    private videoSurface: HTMLElement | null = null;

    private readonly onFullscreenChange = () => {
        this.sync();
        this.onChange?.();
    };

    private readonly onVideoFullscreenEvent = (event: Event) => {
        if (event.target !== this.video()) {
            return;
        }
        const wasFullscreen = this.isFullscreen();
        this.sync();
        if (wasFullscreen && !this.isFullscreen()) {
            this.onChange?.();
        }
    };

    constructor(
        private readonly target: () => HTMLElement | null,
        private readonly onChange?: () => void
    ) {
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
        }
    }

    sync(): void {
        const target = this.target();
        const video = this.fullscreenVideo();
        this.canVideoFullscreen.set(video !== null);
        this.isFullscreen.set(
            Boolean(
                (target &&
                    typeof document !== 'undefined' &&
                    document.fullscreenElement === target) ||
                isNativeVideoFullscreen(video)
            )
        );
    }

    observeVideo(surface: HTMLElement | null): () => void {
        this.videoSurface = surface;
        // Capture media events so this also follows a replaced Video.js tech.
        for (const event of VIDEO_FULLSCREEN_EVENTS) {
            surface?.addEventListener(event, this.onVideoFullscreenEvent, true);
        }
        this.sync();
        return () => {
            for (const event of VIDEO_FULLSCREEN_EVENTS) {
                surface?.removeEventListener(
                    event,
                    this.onVideoFullscreenEvent,
                    true
                );
            }
            this.videoSurface = null;
        };
    }

    canFullscreen(): boolean {
        return (
            this.canDomFullscreen(this.target()) || this.canVideoFullscreen()
        );
    }

    exitNativeVideo(): void {
        const video = this.video();
        if (video && isNativeVideoFullscreen(video)) {
            try {
                video.webkitExitFullscreen?.();
            } catch {
                return;
            }
        }
    }

    private canDomFullscreen(target: HTMLElement | null): boolean {
        return (
            typeof document !== 'undefined' &&
            document.fullscreenEnabled !== false &&
            typeof target?.requestFullscreen === 'function' &&
            typeof document.exitFullscreen === 'function'
        );
    }

    private video(): WebKitFullscreenVideo | null {
        return this.videoSurface?.querySelector('video') ?? null;
    }

    private fullscreenVideo(): WebKitFullscreenVideo | null {
        const video = this.video();
        return video?.webkitEnterFullscreen &&
            video.webkitExitFullscreen &&
            (video.webkitSupportsFullscreen || isNativeVideoFullscreen(video))
            ? video
            : null;
    }

    async toggle(): Promise<void> {
        const target = this.target();
        try {
            if (target && this.canDomFullscreen(target)) {
                if (document.fullscreenElement === target) {
                    await document.exitFullscreen();
                } else {
                    await target.requestFullscreen();
                }
                return;
            }
            const video = this.fullscreenVideo();
            if (isNativeVideoFullscreen(video)) {
                this.exitNativeVideo();
            } else {
                video?.webkitEnterFullscreen?.();
            }
        } catch {
            return;
        }
    }

    dispose(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
        }
    }
}
