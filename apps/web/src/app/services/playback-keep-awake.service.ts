import { Injectable } from '@angular/core';

type PlaybackKeepAwakeBridge = {
    setPlaybackKeepAwake?: (active: boolean) => Promise<void>;
};

type WakeLockSentinelLike = {
    release(): Promise<void>;
    addEventListener?(type: 'release', listener: () => void): void;
};

type WakeLockNavigator = Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

/** Events on a tracked video that mean it is no longer playing. */
const RELEASE_EVENTS = ['pause', 'ended', 'emptied', 'error'] as const;

/**
 * Keeps the display awake while any built-in web player (HTML5/hls.js,
 * Video.js, ArtPlayer) is playing video (issue #1095).
 *
 * Detection is a document-level capture listener for `playing`: media events
 * don't bubble, but capture still sees them from every `<video>` in the page,
 * so all current and future player surfaces are covered without per-engine
 * wiring. Only `HTMLVideoElement` counts — radio's `<audio>` deliberately
 * leaves the display free to sleep, matching browser behavior for audio.
 *
 * Once a video is tracked, its release listeners sit on the element itself:
 * Chromium pauses a media element removed from the DOM, but that `pause`
 * fires on the detached element and never reaches the document, so a
 * document-only listener would leak the lock on component teardown.
 *
 * In Electron the lock is a main-process `powerSaveBlocker` behind
 * `window.electron.setPlaybackKeepAwake` (Chromium's own video wake lock is
 * unreliable on Linux — DE-dependent D-Bus inhibitors, see the issue). In the
 * PWA it is the standard Screen Wake Lock API. Embedded MPV and external
 * MPV/VLC render no `<video>` here and manage display sleep themselves.
 *
 * Visibility gates the lock in both modes: a minimized window streaming
 * audio in the background should not pin the display on. The exception is a
 * tracked video in picture-in-picture — hiding the window keeps the PiP
 * surface on screen, so it counts as visible playback (and PiP enter/leave
 * resynchronizes the gate). The wake lock is re-requested on
 * `visibilitychange` because the browser auto-releases it when the page
 * hides.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackKeepAwakeService {
    private started = false;
    private readonly playingVideos = new Set<HTMLVideoElement>();
    private readonly releaseCleanups = new Map<HTMLVideoElement, () => void>();

    private lastSentToBridge: boolean | null = null;
    private wakeLock: WakeLockSentinelLike | null = null;
    private wakeLockRequestInFlight = false;

    private readonly onPlaying = (event: Event) => {
        const target = event.target;
        if (target instanceof HTMLVideoElement) {
            this.trackVideo(target);
        }
    };

    private readonly onVisibilityChange = () => {
        this.sync();
    };

    // PiP events don't bubble either; capture reaches them from any video.
    private readonly onPictureInPictureChange = () => {
        this.sync();
    };

    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        document.addEventListener('playing', this.onPlaying, true);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        document.addEventListener(
            'enterpictureinpicture',
            this.onPictureInPictureChange,
            true
        );
        document.addEventListener(
            'leavepictureinpicture',
            this.onPictureInPictureChange,
            true
        );
    }

    stop(): void {
        if (!this.started) {
            return;
        }
        this.started = false;
        document.removeEventListener('playing', this.onPlaying, true);
        document.removeEventListener(
            'visibilitychange',
            this.onVisibilityChange
        );
        document.removeEventListener(
            'enterpictureinpicture',
            this.onPictureInPictureChange,
            true
        );
        document.removeEventListener(
            'leavepictureinpicture',
            this.onPictureInPictureChange,
            true
        );
        for (const video of [...this.playingVideos]) {
            this.untrackVideo(video);
        }
    }

    private trackVideo(video: HTMLVideoElement): void {
        if (this.playingVideos.has(video)) {
            return;
        }
        this.playingVideos.add(video);
        const onRelease = () => this.untrackVideo(video);
        for (const type of RELEASE_EVENTS) {
            video.addEventListener(type, onRelease);
        }
        this.releaseCleanups.set(video, () => {
            for (const type of RELEASE_EVENTS) {
                video.removeEventListener(type, onRelease);
            }
        });
        this.sync();
    }

    private untrackVideo(video: HTMLVideoElement): void {
        if (!this.playingVideos.delete(video)) {
            return;
        }
        const cleanup = this.releaseCleanups.get(video);
        this.releaseCleanups.delete(video);
        cleanup?.();
        this.sync();
    }

    private sync(): void {
        const shouldBlock = this.shouldHoldLock();

        const bridge = this.getBridge();
        if (bridge?.setPlaybackKeepAwake) {
            if (this.lastSentToBridge !== shouldBlock) {
                this.lastSentToBridge = shouldBlock;
                bridge.setPlaybackKeepAwake(shouldBlock).catch(() => {
                    // Retry on the next state change.
                    this.lastSentToBridge = null;
                });
            }
            return;
        }

        if (shouldBlock) {
            this.acquireWakeLock();
        } else {
            this.releaseWakeLock();
        }
    }

    private acquireWakeLock(): void {
        if (this.wakeLock || this.wakeLockRequestInFlight) {
            return;
        }
        const wakeLock = (navigator as WakeLockNavigator).wakeLock;
        if (!wakeLock) {
            return;
        }
        this.wakeLockRequestInFlight = true;
        wakeLock
            .request('screen')
            .then((sentinel) => {
                this.wakeLockRequestInFlight = false;
                // The browser releases the sentinel on its own when the page
                // hides; forget it so the next sync() can re-request.
                sentinel.addEventListener?.('release', () => {
                    if (this.wakeLock === sentinel) {
                        this.wakeLock = null;
                    }
                });
                if (!this.shouldHoldLock()) {
                    sentinel.release().catch(() => undefined);
                    return;
                }
                this.wakeLock = sentinel;
            })
            .catch(() => {
                // Denied (battery saver, hidden document, …) — a later
                // `playing` or visibility event retries via sync().
                this.wakeLockRequestInFlight = false;
            });
    }

    /**
     * A hidden document normally releases the lock, but a tracked playing
     * video in picture-in-picture stays on screen after the window is
     * minimized — that is still watched playback.
     */
    private shouldHoldLock(): boolean {
        if (this.playingVideos.size === 0) {
            return false;
        }
        if (document.visibilityState === 'visible') {
            return true;
        }
        const pipElement = (
            document as { pictureInPictureElement?: Element | null }
        ).pictureInPictureElement;
        return (
            pipElement instanceof HTMLVideoElement &&
            this.playingVideos.has(pipElement)
        );
    }

    private releaseWakeLock(): void {
        const sentinel = this.wakeLock;
        if (!sentinel) {
            return;
        }
        this.wakeLock = null;
        sentinel.release().catch(() => undefined);
    }

    private getBridge(): PlaybackKeepAwakeBridge | undefined {
        return (window as { electron?: PlaybackKeepAwakeBridge }).electron;
    }
}
