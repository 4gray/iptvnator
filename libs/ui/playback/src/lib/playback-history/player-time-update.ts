import type { PlaybackPositionUpdate } from '@iptvnator/shared/interfaces';

/** Position report an engine emits on every media time update. */
export interface PlayerTimeUpdate extends PlaybackPositionUpdate {
    /**
     * Whether the media was actually playing — not paused and not seeking.
     * Seeks of paused media also move the position; only playing reports
     * count towards the "really played" history confirmation. Left undefined
     * by an engine that cannot tell.
     */
    readonly playing?: boolean;
}
