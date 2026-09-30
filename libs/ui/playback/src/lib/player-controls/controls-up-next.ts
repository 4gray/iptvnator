import { Signal, computed, signal } from '@angular/core';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerTimelineSegment,
    PlayerUpNextItem,
} from './player-controls.model';

/** Share of the episode's length the card is shown for. */
export const UP_NEXT_THRESHOLD_RATIO = 0.04;
/** Bounds of the adaptive lead: long enough to read, short enough not to nag. */
export const UP_NEXT_MIN_THRESHOLD_SECONDS = 40;
export const UP_NEXT_MAX_THRESHOLD_SECONDS = 3 * 60;
/** A credits chapter only counts in the episode's last third. */
const CREDITS_CHAPTER_MIN_RATIO = 2 / 3;
/** Long credits still bring the card no further forward than this. */
export const UP_NEXT_MAX_CREDITS_LEAD_SECONDS = 5 * 60;
const CREDITS_CHAPTER_TITLE =
    /\bcredits?\b|\boutro\b|\bending\b|титры|abspann|générique|genérico|créditos|crediti|napisy/i;
/** Anime chapter lists mark the ending theme as `ED` / `ED1`. */
const ENDING_THEME_TITLE = /^\s*ED\d*\s*$/;

/**
 * Seconds before the end at which the card appears: 4% of the episode,
 * clamped to 40 s … 3 min, so a 22-minute sitcom gets under a minute and an
 * hour-long drama a little over two.
 */
export function upNextThresholdSeconds(durationSeconds: number): number {
    return Math.min(
        UP_NEXT_MAX_THRESHOLD_SECONDS,
        Math.max(
            UP_NEXT_MIN_THRESHOLD_SECONDS,
            Math.round(durationSeconds * UP_NEXT_THRESHOLD_RATIO)
        )
    );
}

/**
 * Where the closing credits start, when the file's chapters name them.
 * Only chapters in the last third count, so an opening "Credits" chapter
 * never brings the card forward.
 */
export function creditsStartSeconds(
    segments: readonly PlayerTimelineSegment[] | null,
    durationSeconds: number
): number | null {
    const earliest = durationSeconds * CREDITS_CHAPTER_MIN_RATIO;
    let start: number | null = null;
    for (const segment of segments ?? []) {
        if (
            segment.title &&
            (CREDITS_CHAPTER_TITLE.test(segment.title) ||
                ENDING_THEME_TITLE.test(segment.title)) &&
            segment.startSeconds >= earliest &&
            segment.startSeconds < durationSeconds &&
            (start === null || segment.startSeconds < start)
        ) {
            start = segment.startSeconds;
        }
    }
    return start;
}

export interface ControlsUpNextDeps {
    item: Signal<PlayerUpNextItem | null>;
    state: Signal<PlayerControlsState>;
    capabilities: Signal<PlayerControlsCapabilities>;
    showControls: Signal<boolean>;
    /** The settings panel covers the card's corner; it yields while open. */
    settingsOpen: Signal<boolean>;
    /** Chapters; a closing-credits chapter decides when the card appears. */
    segments: Signal<readonly PlayerTimelineSegment[] | null>;
}

/**
 * When the "Up next" card shows: a series host supplied the next episode
 * (possibly the first of the following season, which the transport's
 * season-local `canNextEpisode` does not cover), the engine plays series,
 * the episode has a known length, and the closing credits have started — or,
 * without a credits chapter, the adaptive lead is reached. Live streams and
 * open-ended VOD never qualify because they have no remaining time to count
 * down. The viewer can dismiss the card for the episode it points to, and it
 * shrinks to a compact pill once it has been seen.
 */
export class ControlsUpNext {
    constructor(private readonly deps: ControlsUpNextDeps) {}

    /** Label of the next episode whose card the viewer closed. */
    private readonly dismissedLabel = signal<string | null>(null);
    /** Label of the next episode whose card has collapsed to a pill. */
    private readonly collapsedLabel = signal<string | null>(null);

    private readonly duration = computed(() => {
        const { durationSeconds } = this.deps.state();
        return typeof durationSeconds === 'number' &&
            Number.isFinite(durationSeconds) &&
            durationSeconds > 0
            ? durationSeconds
            : null;
    });

    readonly remainingSeconds = computed(() => {
        const duration = this.duration();
        if (duration === null) {
            return null;
        }
        const position = Math.max(0, this.deps.state().positionSeconds);
        return Math.max(0, duration - position);
    });

    /** Remaining time at which the card appears for this episode. */
    readonly thresholdSeconds = computed(() => {
        const duration = this.duration();
        if (duration === null) {
            return null;
        }
        const credits = creditsStartSeconds(this.deps.segments(), duration);
        return credits !== null
            ? Math.min(duration - credits, UP_NEXT_MAX_CREDITS_LEAD_SECONDS)
            : upNextThresholdSeconds(duration);
    });

    readonly item = computed<PlayerUpNextItem | null>(() => {
        const item = this.deps.item();
        const remaining = this.remainingSeconds();
        const threshold = this.thresholdSeconds();
        const state = this.deps.state();
        if (
            !item ||
            remaining === null ||
            threshold === null ||
            remaining > threshold ||
            item.label === this.dismissedLabel() ||
            state.isLive ||
            // An ended episode with autoplay off schedules no switch: a
            // countdown would promise one. Autoplay replaces the playback.
            state.status === 'ended' ||
            !this.deps.capabilities().seriesNavigation ||
            !this.deps.showControls() ||
            this.deps.settingsOpen()
        ) {
            return null;
        }
        return item;
    });

    readonly visible = computed(() => this.item() !== null);

    readonly collapsed = computed(() => {
        const item = this.item();
        return !!item && item.label === this.collapsedLabel();
    });

    /** Hides the card until the next episode it would point to changes. */
    dismiss(): void {
        this.dismissedLabel.set(this.item()?.label ?? null);
    }

    /** Shrinks the card to its pill for the rest of this episode. */
    collapse(): void {
        this.collapsedLabel.set(this.item()?.label ?? null);
    }
}
