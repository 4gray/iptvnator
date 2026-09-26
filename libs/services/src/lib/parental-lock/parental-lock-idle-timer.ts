/**
 * Re-lock timer for the parental lock.
 *
 * Counts minutes since the last user interaction while unlocked. Playback is
 * treated as interaction through `isBusy`: a film that runs for two hours
 * without a click must not lock itself half way, so an expiry that lands on
 * active playback is deferred and re-checked instead of fired.
 *
 * Listener shape mirrors `ControlsSurface` (document-level, capture phase,
 * passive) so it costs nothing per event beyond a timestamp write.
 */
const ACTIVITY_EVENTS: readonly string[] = [
    'pointerdown',
    'pointermove',
    'keydown',
    'wheel',
    'touchstart',
];

/** How often a deferred expiry re-checks whether playback has stopped. */
export const PARENTAL_LOCK_BUSY_RECHECK_MS = 60_000;

export interface ParentalLockIdleTimerOptions {
    onExpire: () => void;
    /** True while something (playback) should keep the app unlocked. */
    isBusy?: () => boolean;
    /** Injectable clock and scheduler for tests. */
    now?: () => number;
    setTimeout?: (callback: () => void, delayMs: number) => number;
    clearTimeout?: (handle: number) => void;
    target?: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

export class ParentalLockIdleTimer {
    private readonly onExpire: () => void;
    private readonly isBusy: () => boolean;
    private readonly now: () => number;
    private readonly schedule: (
        callback: () => void,
        delayMs: number
    ) => number;
    private readonly cancel: (handle: number) => void;
    private readonly target: Pick<
        Document,
        'addEventListener' | 'removeEventListener'
    > | null;

    private timeoutMs = 0;
    private lastActivityAt = 0;
    private handle: number | null = null;
    private listening = false;

    private readonly onActivity = () => {
        this.lastActivityAt = this.now();
    };

    constructor(options: ParentalLockIdleTimerOptions) {
        this.onExpire = options.onExpire;
        this.isBusy = options.isBusy ?? (() => false);
        this.now = options.now ?? (() => Date.now());
        this.schedule =
            options.setTimeout ??
            ((callback, delayMs) =>
                window.setTimeout(callback, delayMs) as unknown as number);
        this.cancel =
            options.clearTimeout ?? ((handle) => window.clearTimeout(handle));
        this.target =
            options.target ??
            (typeof document === 'undefined' ? null : document);
    }

    /**
     * Starts (or restarts) the countdown. `minutes === 0` means "never by
     * idle" — only an explicit lock or a restart locks again.
     */
    arm(minutes: number): void {
        this.disarm();
        if (!Number.isFinite(minutes) || minutes <= 0) {
            return;
        }
        this.timeoutMs = minutes * 60_000;
        this.lastActivityAt = this.now();
        this.listen();
        this.scheduleCheck(this.timeoutMs);
    }

    disarm(): void {
        if (this.handle !== null) {
            this.cancel(this.handle);
            this.handle = null;
        }
        this.unlisten();
    }

    get armed(): boolean {
        return this.handle !== null;
    }

    private scheduleCheck(delayMs: number): void {
        this.handle = this.schedule(
            () => {
                this.handle = null;
                this.check();
            },
            Math.max(delayMs, 1_000)
        );
    }

    private check(): void {
        const idleFor = this.now() - this.lastActivityAt;
        if (idleFor < this.timeoutMs) {
            this.scheduleCheck(this.timeoutMs - idleFor);
            return;
        }
        if (this.isBusy()) {
            // Playback counts as presence; look again once it may have ended.
            this.scheduleCheck(PARENTAL_LOCK_BUSY_RECHECK_MS);
            return;
        }
        this.unlisten();
        this.onExpire();
    }

    private listen(): void {
        if (this.listening || !this.target) {
            return;
        }
        this.listening = true;
        for (const type of ACTIVITY_EVENTS) {
            this.target.addEventListener(type, this.onActivity, {
                capture: true,
                passive: true,
            });
        }
    }

    private unlisten(): void {
        if (!this.listening || !this.target) {
            return;
        }
        this.listening = false;
        for (const type of ACTIVITY_EVENTS) {
            this.target.removeEventListener(type, this.onActivity, {
                capture: true,
            });
        }
    }
}
