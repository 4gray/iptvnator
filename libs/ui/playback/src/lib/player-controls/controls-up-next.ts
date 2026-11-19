import { Signal, computed, signal } from '@angular/core';
import { upNextLeadSeconds } from '@iptvnator/shared/interfaces';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerTimelineSegment,
    PlayerUpNextItem,
} from './player-controls.model';

/**
 * The timing lives in `@iptvnator/shared/interfaces` so the TV client
 * shows the card at the same moment; re-exported for existing callers.
 */
export {
    UP_NEXT_MAX_CREDITS_LEAD_SECONDS,
    UP_NEXT_MAX_THRESHOLD_SECONDS,
    UP_NEXT_MIN_THRESHOLD_SECONDS,
    UP_NEXT_THRESHOLD_RATIO,
    creditsStartSeconds,
    upNextThresholdSeconds,
} from '@iptvnator/shared/interfaces';

export interface ControlsUpNextDeps {
    item: Signal<PlayerUpNextItem | null>;
    state: Signal<PlayerControlsState>;
    capabilities: Signal<PlayerControlsCapabilities>;
    showControls: Signal<boolean>;
    /** The settings panel covers the card's corner; it yields while open. */
    settingsOpen: Signal<boolean>;
    /** Chapters; a closing-credits chapter decides when the card appears. */
    segments: Signal<readonly PlayerTimelineSegment[] | null>;
    /**
     * Where the closing credits start, from a metadata source (TheIntroDB,
     * #2239). Wins over chapters; absent until a source supplies one.
     */
    creditsStart?: Signal<number | null>;
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
    readonly thresholdSeconds = computed(() =>
        upNextLeadSeconds({
            durationSeconds: this.duration(),
            chapters: this.deps.segments(),
            creditsStartSeconds: this.deps.creditsStart?.() ?? null,
        })
    );

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
        const item = this.item();
        if (item) this.dismissedLabel.set(item.label);
    }

    /** Escape: dismisses a visible card; true when there was one. */
    dismissIfVisible(): boolean {
        if (!this.visible()) {
            return false;
        }
        this.dismiss();
        return true;
    }

    /** Shrinks the card to its pill for the rest of this episode. */
    collapse(): void {
        this.collapsedLabel.set(this.item()?.label ?? null);
    }
}
