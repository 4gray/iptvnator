import { Signal, computed, signal } from '@angular/core';
import { formatTime } from './controls-format.utils';

/**
 * Projects a pointer's horizontal position over the timeline bar onto a
 * playback time (seconds), clamped to the bar. Null when the bar has no
 * width or the duration is unknown.
 */
export function projectPointerToSeconds(
    clientX: number,
    rect: Pick<DOMRect, 'left' | 'width'>,
    durationSeconds: number
): number | null {
    if (
        !Number.isFinite(clientX) ||
        !Number.isFinite(rect.width) ||
        rect.width <= 0 ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0
    ) {
        return null;
    }
    const fraction = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width)
    );
    return fraction * durationSeconds;
}

export interface ControlsTimelineHoverDeps {
    duration: Signal<number>;
    /** Whether the timeline accepts pointer interaction at all. */
    interactive: Signal<boolean>;
}

/**
 * Hover state of the timeline: the time under the pointer, its position as
 * a percentage of the bar (for the marker and label), and the label text.
 * Touch never hovers, so a coarse pointer leaves this empty.
 */
export class ControlsTimelineHover {
    readonly seconds = signal<number | null>(null);

    constructor(private readonly deps: ControlsTimelineHoverDeps) {}

    readonly percent = computed(() => {
        const seconds = this.seconds();
        const duration = this.deps.duration();
        if (seconds === null || duration <= 0) {
            return null;
        }
        return Math.min(100, Math.max(0, (seconds / duration) * 100));
    });

    readonly label = computed(() => {
        const seconds = this.seconds();
        return seconds === null ? null : formatTime(seconds);
    });

    /** Bound to `pointermove` on the bar element itself (`currentTarget`). */
    move(event: PointerEvent, bar?: HTMLElement): void {
        const target = bar ?? event.currentTarget;
        if (
            !(target instanceof HTMLElement) ||
            !this.deps.interactive() ||
            event.pointerType === 'touch'
        ) {
            this.clear();
            return;
        }
        this.seconds.set(
            projectPointerToSeconds(
                event.clientX,
                target.getBoundingClientRect(),
                this.deps.duration()
            )
        );
    }

    clear(): void {
        if (this.seconds() !== null) {
            this.seconds.set(null);
        }
    }
}
