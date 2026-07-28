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
 * Deliberately behaviour-identical to the two implementations it replaces.
 */

/** The player fires ~4x/second; persisting that often would hammer SQLite. */
const DEFAULT_THROTTLE_MS = 15000;

export interface InlinePlaybackPositionWriterConfig {
    /** The playback currently mounted in the inline player. */
    playback: Signal<ResolvedPortalPlayback | null>;
    save: (playlistId: string, position: PlaybackPositionData) => void;
    /** Called with each persisted position, for local resume state. */
    onSaved?: (position: PlaybackPositionData) => void;
    throttleMs?: number;
}

export interface InlinePlaybackPositionWriter {
    handleTimeUpdate(event: { currentTime: number; duration: number }): void;
    /** Clears the throttle so the next update is written immediately. */
    reset(): void;
}

export function createInlinePlaybackPositionWriter(
    config: InlinePlaybackPositionWriterConfig
): InlinePlaybackPositionWriter {
    const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS;
    let lastSaveTime = 0;

    return {
        handleTimeUpdate(event) {
            const playback = config.playback();
            // Without contentInfo there is no key to store the position under.
            if (!playback?.contentInfo) {
                return;
            }

            const now = Date.now();
            if (now - lastSaveTime <= throttleMs) {
                return;
            }
            lastSaveTime = now;

            const position: PlaybackPositionData = {
                ...playback.contentInfo,
                positionSeconds: Math.floor(event.currentTime),
                durationSeconds: Math.floor(event.duration),
            };

            config.save(playback.contentInfo.playlistId, position);
            config.onSaved?.(position);
        },

        reset() {
            lastSaveTime = 0;
        },
    };
}
