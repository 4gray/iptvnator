import type { Signal } from '@angular/core';
import {
    hasReachedPlaybackStart,
    type PlaybackPositionData,
    type PlaybackPositionUpdate,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { inlineProgressPosition } from './detail/playback-progress';

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
 *
 * The throttle only ever delays a write, never drops one: the newest held
 * position is persisted on pause or seek, when the player closes or another
 * playback supersedes it (`reset`), and when the page is hidden for good
 * (`pagehide`). Without that, closing the player rewound Resume by up to the
 * throttle window, even after pausing first.
 */

type HeldPosition = PlaybackPositionData & { playlistId: string };

/**
 * Writers holding a throttled position. One `pagehide` listener serves all
 * of them, and a writer leaves the set once nothing is held, so nothing has
 * to be torn down with the host.
 */
const heldWriters = new Set<() => void>();
let pageHideListening = false;

function holdUntilPageHide(flush: () => void): void {
    heldWriters.add(flush);
    if (pageHideListening || typeof window === 'undefined') return;
    pageHideListening = true;
    window.addEventListener('pagehide', () => {
        for (const held of [...heldWriters]) held();
    });
}

/** The player fires ~4x/second; persisting that often would hammer SQLite. */
const DEFAULT_THROTTLE_MS = 15000;

export interface InlinePlaybackPositionWriterConfig {
    /** The playback currently mounted in the inline player. */
    playback: Signal<ResolvedPortalPlayback | null>;
    save: (playlistId: string, position: PlaybackPositionData) => void;
    /** Called with each persisted position, for local resume state. */
    onSaved?: (position: PlaybackPositionData) => void;
    /**
     * Who the page is showing. A held position is flushed when the player
     * closes — often after the page has already moved to another item — and
     * `onSaved` then skips it, so the previous item's row cannot land in the
     * local resume state of the one now on screen. `save` always runs: the
     * row is keyed by its own media.
     */
    ownerKey?: () => string | null;
    throttleMs?: number;
}

export interface InlinePlaybackPositionWriter {
    /**
     * @returns whether `currentTime` can be believed yet — false while the
     * engine is still on its way to `startTime`. Multi-source switching needs
     * the same answer to carry a timecode across, and one latch has to serve
     * both or the two disagree about where playback is.
     */
    handleTimeUpdate(event: PlaybackPositionUpdate): boolean;
    /** Persists the latest accepted update if it was held by the throttle. */
    flush(): void;
    /**
     * Ends the current playback: persists the held position under its own
     * media key, then clears the throttle and the resume latch for the next
     * one.
     */
    reset(): void;
}

export function createInlinePlaybackPositionWriter(
    config: InlinePlaybackPositionWriterConfig
): InlinePlaybackPositionWriter {
    const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS;
    let lastSaveTime = 0;
    /** Cleared on every start; latches once playback reaches `startTime`. */
    let resumeSettled = false;
    let pending: HeldPosition | undefined;
    let pendingOwner: string | null = null;
    let lastSaved: HeldPosition | undefined;
    const flush = () => {
        heldWriters.delete(flush);
        if (!pending) return;
        const position = pending;
        pending = undefined;
        lastSaveTime = Date.now();
        lastSaved = position;
        config.save(position.playlistId, position);
        if (!config.ownerKey || config.ownerKey() === pendingOwner)
            config.onSaved?.(position);
    };

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
            if (
                !resumeSettled &&
                !hasReachedPlaybackStart(event, playback.startTime ?? 0)
            )
                return false;
            resumeSettled = true;

            const { contentInfo } = playback;
            pending = {
                ...inlineProgressPosition(contentInfo, event),
                playlistId: contentInfo.playlistId,
            };
            pendingOwner = config.ownerKey?.() ?? null;
            holdUntilPageHide(flush);

            if (
                event.checkpoint ||
                (event.playing === false && !isLastSaved(pending)) ||
                Date.now() - lastSaveTime > throttleMs
            )
                flush();
            return true;
        },

        flush,

        reset() {
            flush();
            lastSaveTime = 0;
            lastSaved = undefined;
            resumeSettled = false;
        },
    };

    /** A paused engine keeps reporting the same second; one write is enough. */
    function isLastSaved(position: HeldPosition): boolean {
        return (
            lastSaved !== undefined &&
            lastSaved.playlistId === position.playlistId &&
            lastSaved.contentXtreamId === position.contentXtreamId &&
            lastSaved.contentType === position.contentType &&
            lastSaved.positionSeconds === position.positionSeconds
        );
    }
}
