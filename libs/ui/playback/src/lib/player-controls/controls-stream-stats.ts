import { computed, signal } from '@angular/core';
import type {
    PlayerStreamStats,
    PlayerStreamStatsSource,
} from './player-stream-stats.model';
import { buildStreamStatsRows } from './stream-stats-format.utils';

/**
 * How often the open popover re-reads the engine. Fast enough that a bitrate
 * or buffer change is visible while watching a row, slow enough that the
 * numbers stay readable instead of flickering.
 */
export const STREAM_STATS_SAMPLE_INTERVAL_MS = 1000;

/**
 * Owns the stream-info popover's sampling loop.
 *
 * Sampling runs only between {@link start} and {@link stop} — i.e. only while
 * the popover is open — so a closed panel costs nothing, and the engine's own
 * frame-rate accounting is not driven by a UI nobody is looking at.
 */
export class ControlsStreamStats {
    private readonly snapshot = signal<PlayerStreamStats | null>(null);
    private timer: ReturnType<typeof setInterval> | null = null;

    readonly rows = computed(() => buildStreamStatsRows(this.snapshot()));
    readonly hasRows = computed(() => this.rows().length > 0);

    constructor(
        private readonly source: () =>
            PlayerStreamStatsSource | null | undefined
    ) {}

    start(): void {
        this.stop();
        this.sample();
        this.timer = setInterval(
            () => this.sample(),
            STREAM_STATS_SAMPLE_INTERVAL_MS
        );
    }

    /** Idempotent; drops the snapshot so a reopen never shows stale numbers. */
    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.snapshot.set(null);
    }

    dispose(): void {
        this.stop();
    }

    private sample(): void {
        try {
            this.snapshot.set(this.source()?.sample() ?? null);
        } catch {
            // A stats read is diagnostic only: an engine that throws mid-teardown
            // must never take the controls down with it.
            this.snapshot.set(null);
        }
    }
}
