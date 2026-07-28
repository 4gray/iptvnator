import type { Signal } from '@angular/core';
import type {
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';

/**
 * Throttled persistence of the inline player's position.
 *
 * Extracted because Xtream and Stalker each carried their own copy of the same
 * "every timeupdate, but at most once per 15s" logic, and a resume point that
 * behaves differently per portal is exactly the kind of divergence users
 * notice.
 *
 * Beyond that throttle it holds one resume latch, because a position written
 * before the engine reaches `startTime` overwrites the point being resumed
 * from — a bug both copies had.
 */

/** The player fires ~4x/second; persisting that often would hammer SQLite. */
const DEFAULT_THROTTLE_MS = 15000;

/** Engines land near, not exactly on, the requested `startTime`. */
const RESUME_TOLERANCE_SECONDS = 5;

export interface InlinePlaybackPositionWriterConfig {
    /** The playback currently mounted in the inline player. */
    playback: Signal<ResolvedPortalPlayback | null>;
    save: (playlistId: string, position: PlaybackPositionData) => void;
    /** Called with each persisted position, for local resume state. */
    onSaved?: (position: PlaybackPositionData) => void;
    throttleMs?: number;
}

export interface InlinePlaybackPositionWriter {
    /**
     * @returns whether `currentTime` can be believed yet — false while the
     * engine is still on its way to `startTime`. Multi-source switching needs
     * the same answer to carry a timecode across, and one latch has to serve
     * both or the two disagree about where playback is.
     */
    handleTimeUpdate(event: { currentTime: number; duration: number }): boolean;
    /** Clears the throttle and the resume latch for a new playback. */
    reset(): void;
}

export function createInlinePlaybackPositionWriter(
    config: InlinePlaybackPositionWriterConfig
): InlinePlaybackPositionWriter {
    const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS;
    let lastSaveTime = 0;
    /** Cleared on every start; latches once playback reaches `startTime`. */
    let resumeSettled = false;

    return {
        handleTimeUpdate(event) {
            const playback = config.playback();
            // Without contentInfo there is no key to store the position under.
            // The latch never ran, so the answer is whatever it already was —
            // not a fresh "no".
            if (!playback?.contentInfo) {
                return resumeSettled;
            }

            // A resuming engine can emit timeupdates at ~0 before it finishes
            // seeking to startTime. Writing one would overwrite the very
            // position being resumed from — which a source switch then
            // inherits, restarting the film from the beginning.
            //
            // This is a one-shot latch, not a filter: once playback has
            // reached the resume point the guard is done, so a deliberate seek
            // backwards is still saved normally.
            if (!resumeSettled) {
                const startTime = playback.startTime ?? 0;
                // A shorter cut can never reach a position carried into it,
                // and latching on that would suppress every save this session.
                const reachable =
                    !(event.duration > 0) || startTime < event.duration;
                if (
                    reachable &&
                    startTime > 0 &&
                    event.currentTime < startTime - RESUME_TOLERANCE_SECONDS
                ) {
                    return false;
                }
                resumeSettled = true;
            }

            const now = Date.now();
            if (now - lastSaveTime <= throttleMs) {
                return true;
            }
            lastSaveTime = now;

            const position: PlaybackPositionData = {
                ...playback.contentInfo,
                positionSeconds: Math.floor(event.currentTime),
                durationSeconds: Math.floor(event.duration),
            };

            config.save(playback.contentInfo.playlistId, position);
            config.onSaved?.(position);
            return true;
        },

        reset() {
            lastSaveTime = 0;
            resumeSettled = false;
        },
    };
}
