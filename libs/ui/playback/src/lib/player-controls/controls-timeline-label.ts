import { Signal, computed, signal } from '@angular/core';
import { formatTime } from './controls-format.utils';
import {
    findTimelineSegment,
    type TimelineSegmentView,
} from './controls-timeline-segments';

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

/** Room (px) the label keeps from the player's left and right edges. */
export const TIMELINE_LABEL_EDGE_PX = 8;

/**
 * Left edge (px, from the bar's left) of a label `labelWidth` wide: centred
 * on the anchor at `percent` of the bar, but kept inside the player with
 * {@link TIMELINE_LABEL_EDGE_PX} to spare on each side. The bar is narrower
 * than the player (the times flank it), so the label may extend past the
 * bar's ends. A label wider than the room starts at the player's left edge.
 */
export function clampTimelineLabelLeft(
    percent: number,
    labelWidth: number,
    bar: Pick<DOMRect, 'left' | 'width'>,
    player: Pick<DOMRect, 'left' | 'right'>
): number {
    const centred = (percent / 100) * bar.width - labelWidth / 2;
    const min = player.left - bar.left + TIMELINE_LABEL_EDGE_PX;
    const max = player.right - bar.left - TIMELINE_LABEL_EDGE_PX - labelWidth;
    return Math.max(min, Math.min(centred, max));
}

/** Keys a focused range input moves its value with. */
const SEEK_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown',
]);

/** `:focus-visible`; focus counts as visible where the selector is unknown. */
function hasVisibleFocus(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    try {
        return target.matches(':focus-visible');
    } catch {
        return true;
    }
}

export interface ControlsTimelineLabelDeps {
    duration: Signal<number>;
    /** Whether the timeline accepts interaction at all. */
    interactive: Signal<boolean>;
    /** Drawn segments, for the title in the label; none means time only. */
    segments?: Signal<readonly TimelineSegmentView[]>;
    /** The slider value: the scrub preview, else the playback position. */
    value?: Signal<number>;
    /** A drag is previewing a position (see `ControlsTimeline`). */
    scrubbing?: Signal<boolean>;
}

/** The label's parts: the segment title, when there is one, and the time. */
export interface TimelineLabelText {
    title: string | null;
    time: string;
}

/**
 * The timeline label and where it points: the time under a hovering mouse
 * or pen; otherwise the slider value while the keyboard drives the slider
 * (keyboard focus or a seek key) or a drag previews a position — touch never
 * hovers, so a touch drag is how touch users see it. A non-interactive
 * timeline never labels.
 */
export class ControlsTimelineLabel {
    /** Time under a hovering mouse or pen. */
    readonly pointerSeconds = signal<number | null>(null);
    /** The keyboard holds the slider. */
    readonly keyboard = signal(false);

    constructor(private readonly deps: ControlsTimelineLabelDeps) {}

    readonly seconds = computed(() => {
        if (!this.deps.interactive()) {
            return null;
        }
        const pointer = this.pointerSeconds();
        if (pointer !== null) {
            return pointer;
        }
        const followsValue = this.keyboard() || !!this.deps.scrubbing?.();
        return followsValue ? (this.deps.value?.() ?? null) : null;
    });

    readonly percent = computed(() => {
        const seconds = this.seconds();
        const duration = this.deps.duration();
        if (seconds === null || duration <= 0) {
            return null;
        }
        return Math.min(100, Math.max(0, (seconds / duration) * 100));
    });

    /** The pointer's marker; for the keyboard and drags the knob is there. */
    readonly markerPercent = computed(() =>
        this.pointerSeconds() === null ? null : this.percent()
    );

    /** The titled segment the label points into, if any. */
    readonly segmentTitle = computed(() => {
        const seconds = this.seconds();
        const segments = this.deps.segments?.();
        if (seconds === null || !segments) {
            return null;
        }
        return findTimelineSegment(segments, seconds)?.title ?? null;
    });

    /** `{ title: 'Chapter 2', time: '12:40' }`, or the time alone. */
    readonly text = computed<TimelineLabelText | null>(() => {
        const seconds = this.seconds();
        if (seconds === null || this.percent() === null) {
            return null;
        }
        return { title: this.segmentTitle(), time: formatTime(seconds) };
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
        this.pointerSeconds.set(
            projectPointerToSeconds(
                event.clientX,
                target.getBoundingClientRect(),
                this.deps.duration()
            )
        );
    }

    clear(): void {
        if (this.pointerSeconds() !== null) {
            this.pointerSeconds.set(null);
        }
    }

    /**
     * Bound to the slider's `focus`. Only keyboard focus shows the label: a
     * pointer that focuses the slider labels through hover or the drag.
     */
    focus(event: FocusEvent): void {
        this.keyboard.set(hasVisibleFocus(event.target));
    }

    blur(): void {
        this.keyboard.set(false);
    }

    /** Bound to the slider's `keydown`: a seek key hands it to the keyboard. */
    keydown(event: KeyboardEvent): void {
        if (SEEK_KEYS.has(event.key)) {
            this.keyboard.set(true);
        }
    }
}
