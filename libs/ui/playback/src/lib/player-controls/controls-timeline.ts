import { Signal, computed, signal } from '@angular/core';
import type { PlayerControlsState } from './player-controls.model';

/**
 * Owns the scrub state and timeline projections for the controls bar: the
 * current slider value (scrub position while dragging, playback position
 * otherwise), the bounded duration, and the progress percentage.
 */
export class ControlsTimeline {
    readonly scrubPosition = signal<number | null>(null);

    constructor(private readonly state: Signal<PlayerControlsState>) {}

    readonly duration = computed(() => {
        const duration = this.state().durationSeconds;
        return typeof duration === 'number' && Number.isFinite(duration)
            ? Math.max(0, duration)
            : 0;
    });

    readonly value = computed(
        () =>
            this.normalize(
                this.scrubPosition() ?? this.state().positionSeconds
            ) ?? 0
    );

    readonly progress = computed(() => {
        const duration = this.duration();
        return this.state().canSeek && duration > 0
            ? (this.value() / duration) * 100
            : 0;
    });

    readEventValue(event: Event): number | null {
        return this.normalize(Number((event.target as HTMLInputElement).value));
    }

    private normalize(value: number): number | null {
        if (!Number.isFinite(value)) {
            return null;
        }

        const duration = this.state().durationSeconds;
        const upperBound =
            typeof duration === 'number' && Number.isFinite(duration)
                ? Math.max(0, duration)
                : Number.POSITIVE_INFINITY;
        return Math.min(Math.max(0, value), upperBound);
    }
}
