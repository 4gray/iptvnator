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

/** Events on a tracked video that mean it may have stopped advancing. */
const STALL_EVENTS = ['waiting', 'stalled'] as const;

/**
 * A tracked video that has not advanced this long after `waiting` or
 * `stalled` is released: a stream that dies after starting (starved MSE,
 * a dropped live source) never fires `pause` or `ended`. Its next `playing`
 * tracks it again.
 */
export const PLAYBACK_STALL_RELEASE_MS = 60_000;

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
    private readonly stallChecks = new Map<
        HTMLVideoElement,
        { handle: ReturnType<typeof setTimeout>; time: number }
    >();

    private lastSentToBridge: boolean | null = null;
    private wakeLock: WakeLockSentinelLike | null = null;
    private wakeLockRequestInFlight = false;
    private wakeLockRetryQueued = false;

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

    /** Whether any tracked `<video>` is currently playing. */
    hasPlayingVideo(): boolean {
        return this.playingVideos.size > 0;
    }

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
        const onStall = () => this.scheduleStallCheck(video);
        const onResume = () => this.clearStallCheck(video);
        for (const type of RELEASE_EVENTS) {
            video.addEventListener(type, onRelease);
        }
        for (const type of STALL_EVENTS) {
            video.addEventListener(type, onStall);
        }
        video.addEventListener('playing', onResume);
        this.releaseCleanups.set(video, () => {
            video.removeEventListener('playing', onResume);
            for (const type of RELEASE_EVENTS) {
                video.removeEventListener(type, onRelease);
            }
            for (const type of STALL_EVENTS) {
                video.removeEventListener(type, onStall);
            }
        });
        this.sync();
    }

    /**
     * Judged by progress, not by the event: `stalled` also fires while the
     * buffer still plays. A pending check restarts only when the video moved
     * since it was taken (a recovery followed by a new stall), so repeated
     * stall events on a frozen video cannot postpone the release. A video
     * that moved is checked again until `playing` reports it resumed: it may
     * advance a little and freeze without another event.
     */
    private scheduleStallCheck(video: HTMLVideoElement): void {
        const pending = this.stallChecks.get(video);
        if (pending && pending.time === video.currentTime) {
            return;
        }
        clearTimeout(pending?.handle);
        const time = video.currentTime;
        const handle = setTimeout(() => {
            this.stallChecks.delete(video);
            if (video.currentTime === time) {
                this.untrackVideo(video);
            } else {
                this.scheduleStallCheck(video);
            }
        }, PLAYBACK_STALL_RELEASE_MS);
        this.stallChecks.set(video, { handle, time });
    }

    private clearStallCheck(video: HTMLVideoElement): void {
        clearTimeout(this.stallChecks.get(video)?.handle);
        this.stallChecks.delete(video);
    }

    private untrackVideo(video: HTMLVideoElement): void {
        if (!this.playingVideos.delete(video)) {
            return;
        }
        const cleanup = this.releaseCleanups.get(video);
        this.releaseCleanups.delete(video);
        cleanup?.();
        this.clearStallCheck(video);
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
        if (this.wakeLock) {
            return;
        }
        if (this.wakeLockRequestInFlight) {
            // A state change arrived while request() is still pending (e.g.
            // hidden→visible round-trip). The pending request may reject
            // because of the moment it was processed in, so remember to
            // re-evaluate once it settles instead of dropping this signal.
            this.wakeLockRetryQueued = true;
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
                // The resolve path re-reads current state below, which
                // covers whatever change queued the retry.
                this.wakeLockRetryQueued = false;
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
                this.wakeLockRequestInFlight = false;
                if (this.wakeLockRetryQueued) {
                    // A state change was masked by the in-flight request —
                    // re-evaluate now. Permanent denials don't loop: without
                    // a fresh interleaved change nothing queues a retry.
                    this.wakeLockRetryQueued = false;
                    this.sync();
                }
                // Otherwise: denied (battery saver, hidden document, …) — a
                // later `playing` or visibility event retries via sync().
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
