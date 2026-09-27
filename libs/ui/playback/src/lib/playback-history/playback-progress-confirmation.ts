/** Seconds a stream must actually advance before it counts as watched. */
export const PLAYBACK_CONFIRMATION_SECONDS = 2;

/**
 * Largest position step still counted as playback. Engines report every
 * 250–500 ms, so anything larger is a seek (resume position, live-edge
 * catch-up, ±10 s keys) rather than seconds the viewer has seen.
 */
const MAX_PLAYBACK_STEP_SECONDS = 3;

/**
 * Turns an engine's position reports into a single "this stream plays"
 * signal. `playing` alone is not enough: a broken stream can fire it and
 * stall or error a moment later, so only position that really advanced
 * counts. Pauses, stalls, seeks and backwards jumps add nothing — including
 * short seeks of paused media, which engines report as `playing: false`.
 */
export class PlaybackProgressConfirmation {
    private lastPosition: number | null = null;
    private progressedSeconds = 0;
    private confirmed = false;

    constructor(private readonly onConfirmed: () => void) {}

    /** Starts over for a new stream. */
    reset(): void {
        this.lastPosition = null;
        this.progressedSeconds = 0;
        this.confirmed = false;
    }

    /**
     * Keeps the progress but forgets the last position, for an engine or
     * source swap within the same stream whose clock restarts elsewhere.
     */
    rebase(): void {
        this.lastPosition = null;
    }

    /**
     * @param playing whether the media was actually playing (not paused, not
     *   seeking) at this report; engines that cannot tell leave it undefined.
     */
    record(position: number, playing?: boolean): void {
        if (this.confirmed || !Number.isFinite(position)) {
            return;
        }

        const previous = this.lastPosition;
        this.lastPosition = position;
        if (previous === null || playing === false) {
            return;
        }

        const step = position - previous;
        if (step <= 0 || step > MAX_PLAYBACK_STEP_SECONDS) {
            return;
        }

        this.progressedSeconds += step;
        if (this.progressedSeconds >= PLAYBACK_CONFIRMATION_SECONDS) {
            this.confirmed = true;
            this.onConfirmed();
        }
    }
}
