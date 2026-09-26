import { Signal, computed } from '@angular/core';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerUpNextItem,
} from './player-controls.model';

/** The card appears once this little of the episode is left. */
export const UP_NEXT_THRESHOLD_SECONDS = 8 * 60;

export interface ControlsUpNextDeps {
    item: Signal<PlayerUpNextItem | null>;
    state: Signal<PlayerControlsState>;
    capabilities: Signal<PlayerControlsCapabilities>;
    showControls: Signal<boolean>;
    /** The settings panel covers the card's corner; it yields while open. */
    settingsOpen: Signal<boolean>;
}

/**
 * When the "Up next" card shows: a series host supplied the next episode,
 * the engine can actually switch to it, the episode has a known length,
 * and no more than the threshold of it is left. Live streams and open-ended
 * VOD never qualify because they have no remaining time to count down.
 */
export class ControlsUpNext {
    constructor(private readonly deps: ControlsUpNextDeps) {}

    readonly remainingSeconds = computed(() => {
        const { durationSeconds, positionSeconds } = this.deps.state();
        if (
            typeof durationSeconds !== 'number' ||
            !Number.isFinite(durationSeconds) ||
            durationSeconds <= 0
        ) {
            return null;
        }
        return Math.max(0, durationSeconds - Math.max(0, positionSeconds));
    });

    readonly item = computed<PlayerUpNextItem | null>(() => {
        const item = this.deps.item();
        const remaining = this.remainingSeconds();
        const state = this.deps.state();
        if (
            !item ||
            remaining === null ||
            remaining > UP_NEXT_THRESHOLD_SECONDS ||
            state.isLive ||
            // An ended episode with autoplay off schedules no switch: a
            // countdown would promise one. Autoplay replaces the playback.
            state.status === 'ended' ||
            !state.canNextEpisode ||
            !this.deps.capabilities().seriesNavigation ||
            !this.deps.showControls() ||
            this.deps.settingsOpen()
        ) {
            return null;
        }
        return item;
    });

    readonly visible = computed(() => this.item() !== null);

    /** Whole minutes left, never below one while the card is showing. */
    readonly minutesLeft = computed(() =>
        Math.max(1, Math.ceil((this.remainingSeconds() ?? 0) / 60))
    );
}
