import { Signal, computed } from '@angular/core';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerSkipSegment,
} from './player-controls.model';

/**
 * The button gives up this close to a segment's end: the jump would save
 * the viewer nothing and the button would flash for a moment.
 */
export const SKIP_SEGMENT_END_MARGIN_SECONDS = 1.5;

/** The segment the playback position is inside, if any. */
export function activeSkipSegment(
    segments: readonly PlayerSkipSegment[] | null,
    positionSeconds: number
): PlayerSkipSegment | null {
    for (const segment of segments ?? []) {
        if (
            Number.isFinite(segment.startSeconds) &&
            Number.isFinite(segment.endSeconds) &&
            positionSeconds >= segment.startSeconds &&
            positionSeconds <
                segment.endSeconds - SKIP_SEGMENT_END_MARGIN_SECONDS
        ) {
            return segment;
        }
    }
    return null;
}

export interface ControlsSkipSegmentDeps {
    segments: Signal<readonly PlayerSkipSegment[] | null>;
    state: Signal<PlayerControlsState>;
    capabilities: Signal<PlayerControlsCapabilities>;
    showControls: Signal<boolean>;
    /** The settings panel covers the button's corner; it yields while open. */
    settingsOpen: Signal<boolean>;
    seekTo: (seconds: number) => void;
}

/**
 * When the "Skip intro" / "Skip recap" button shows: a host supplied the
 * episode's segments, the playback position is inside one of them and the
 * engine can seek. Like the "Up next" card it does not fade with idle
 * controls — a viewer waiting through the opening titles has no reason to
 * move the mouse first. Pressing it seeks to the segment's end.
 */
export class ControlsSkipSegment {
    constructor(private readonly deps: ControlsSkipSegmentDeps) {}

    readonly segment = computed<PlayerSkipSegment | null>(() => {
        const state = this.deps.state();
        if (
            state.isLive ||
            !state.canSeek ||
            !this.deps.capabilities().seek ||
            !this.deps.showControls() ||
            this.deps.settingsOpen()
        ) {
            return null;
        }
        return activeSkipSegment(
            this.deps.segments(),
            Math.max(0, state.positionSeconds)
        );
    });

    /**
     * The segment the button offers. An auto-skip segment never gets one:
     * it is skipped on entry, and a viewer who seeks back into it chose to
     * watch it.
     */
    readonly buttonSegment = computed(() => {
        const segment = this.segment();
        return segment?.autoSkip ? null : segment;
    });

    readonly labelKey = computed(() =>
        this.segment()?.kind === 'recap'
            ? 'EMBEDDED_MPV.PLAYER.SKIP_RECAP'
            : 'EMBEDDED_MPV.PLAYER.SKIP_INTRO'
    );

    /** Auto-skip segments already skipped; a new episode brings new objects. */
    private readonly autoSkipped = new WeakSet<PlayerSkipSegment>();

    /**
     * Seeks past the active auto-skip segment the first time playback enters
     * it — once only, so seeking back into it never loops.
     */
    autoSkip(): void {
        const segment = this.segment();
        if (!segment?.autoSkip || this.autoSkipped.has(segment)) {
            return;
        }
        this.autoSkipped.add(segment);
        this.skip();
    }

    skip(): void {
        const segment = this.segment();
        if (!segment) {
            return;
        }
        const { durationSeconds } = this.deps.state();
        // A segment reported past the file's end (a different cut of the
        // episode) must not seek beyond it.
        const target =
            typeof durationSeconds === 'number' &&
            Number.isFinite(durationSeconds) &&
            durationSeconds > 0
                ? Math.min(segment.endSeconds, durationSeconds)
                : segment.endSeconds;
        this.deps.seekTo(target);
    }
}
