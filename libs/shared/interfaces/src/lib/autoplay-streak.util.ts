/**
 * Episodes played in a row by autoplay, with no playback the viewer started
 * in between. This is the hook for "Are you still watching?" (#2245), shared
 * by the desktop/web hosts and the TV client:
 *
 * - every autoplay site calls `beginAutoplay()` and only plays on when it
 *   returns true;
 * - every playback start calls `playbackStarted()`, which keeps the run when
 *   autoplay started it and resets it otherwise (the viewer picked an
 *   episode, pressed Next, or chose the Up next card).
 *
 * Without a limit, the default, autoplay always continues.
 */
export class AutoplayStreak {
    private count = 0;
    private pending = false;

    constructor(private readonly limit: () => number | null = () => null) {}

    /** Episodes autoplay has started since the viewer last started one. */
    get length(): number {
        return this.count;
    }

    /** False once the run reaches the limit; #2245 asks the viewer then. */
    canContinue(): boolean {
        const limit = this.limit();
        return limit === null || this.count < limit;
    }

    /** Claims the next autoplay; call it right before playing on. */
    beginAutoplay(): boolean {
        if (!this.canContinue()) {
            return false;
        }
        this.count += 1;
        this.pending = true;
        return true;
    }

    /** Releases an autoplay that failed or was cancelled before playback. */
    cancelAutoplay(): void {
        if (!this.pending) return;
        this.pending = false;
        this.count -= 1;
    }

    /** A new episode started playing, by autoplay or by the viewer. */
    playbackStarted(): void {
        if (this.pending) {
            this.pending = false;
            return;
        }
        this.count = 0;
    }

    /** The viewer answered "still watching": start a fresh run. */
    reset(): void {
        this.count = 0;
        this.pending = false;
    }
}
