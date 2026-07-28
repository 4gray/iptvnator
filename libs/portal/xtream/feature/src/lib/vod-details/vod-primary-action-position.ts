import { Signal, computed, effect, signal } from '@angular/core';
import { getPortalPlaybackProgressPercent } from '@iptvnator/portal/shared/util';
import type {
    PlaybackPositionData,
    VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';

/**
 * The position the PRIMARY button acts on.
 *
 * The page loads the route copy's position, but a pin means the button plays
 * a different copy — and positions are keyed by (playlist, stream), so that
 * copy has its own row. Reading the route's would let the button say
 * "Resume 42:00" and then start an unwatched copy from zero, or say "Play"
 * and jump into the middle of one that was already watched.
 *
 * When a pin names another copy its row governs, INCLUDING when there is no
 * row: never watched means Play, not Resume.
 */

export interface PrimaryActionPositionDeps {
    /** Discovered sources; the pinned one, if any, carries `isPinned`. */
    sources: Signal<VodSourceDescriptor[]>;
    /** The route's own (playlist, stream), for telling "another copy" apart. */
    routePlaylistId: Signal<string | undefined>;
    routeContentId: Signal<number>;
    /** The route copy's position, as loaded by the page. */
    routePosition: Signal<PlaybackPositionData | null>;
    /**
     * The last position seen from any copy. The pinned copy's stored row goes
     * stale the moment the user watches it, and re-reading the database on
     * every update would be a round-trip per timeupdate.
     */
    livePosition: Signal<PlaybackPositionData | null>;
    load: (source: VodSourceDescriptor) => Promise<PlaybackPositionData | null>;
}

export interface PrimaryActionPosition {
    position: Signal<PlaybackPositionData | null>;
    /** Whether the button should read Resume rather than Play. */
    hasPosition: Signal<boolean>;
    /** The pinned copy the button acts on, when it is not the route's own. */
    foreignPin: Signal<VodSourceDescriptor | null>;
}

/**
 * Whether a stored position is worth resuming from.
 *
 * Shared so the label and the start point cannot disagree: a copy watched to
 * the end shows Play, and starting it must then mean starting it, not seeking
 * back to the 95% mark it was left at.
 */
export function isResumablePosition(
    position: PlaybackPositionData | null
): boolean {
    const progress = getPortalPlaybackProgressPercent(position);
    return progress > 0 && progress < 90;
}

export function createPrimaryActionPosition(
    deps: PrimaryActionPositionDeps
): PrimaryActionPosition {
    /** The pinned copy, only while it is NOT the route's own row. */
    const foreignPin = computed(() => {
        const pinned = deps.sources().find((source) => source.isPinned);
        if (
            !pinned ||
            (pinned.playlistId === deps.routePlaylistId() &&
                pinned.contentId === deps.routeContentId())
        ) {
            return null;
        }

        return pinned;
    });

    const pinnedPosition = signal<PlaybackPositionData | null>(null);
    /** Distinguishes "not looked up yet" from "looked up, never watched". */
    const pinnedLoadedFor = signal<string | null>(null);

    effect(() => {
        const pinned = foreignPin();
        if (!pinned) {
            pinnedPosition.set(null);
            pinnedLoadedFor.set(null);
            return;
        }

        if (pinnedLoadedFor() === pinned.id) {
            return;
        }

        void deps.load(pinned).then((position) => {
            // The pin can change across the lookup — applying a stale answer
            // would describe a copy the button no longer plays.
            if (foreignPin()?.id !== pinned.id) {
                return;
            }

            pinnedPosition.set(position);
            pinnedLoadedFor.set(pinned.id);
        });
    });

    const position = computed(() => {
        const pinned = foreignPin();
        if (!pinned) {
            return deps.routePosition();
        }

        // The pin names a copy whose row has not been read yet. Showing the
        // ROUTE copy's `Resume 42:18` here would be a label for a stream this
        // button is not going to start — and a click across this window looks
        // the pinned position up separately and begins somewhere else. Say
        // nothing until the answer is in; empty beats wrong.
        if (!pinnedLoadedFor()) {
            return null;
        }

        // What just played beats what was stored before it did.
        const live = deps.livePosition();
        const isPinnedCopy =
            live?.playlistId === pinned.playlistId &&
            live?.contentXtreamId === pinned.contentId;

        return isPinnedCopy ? live : pinnedPosition();
    });

    const hasPosition = computed(() => isResumablePosition(position()));

    return { position, hasPosition, foreignPin };
}

/** `01:02:03`, or `02:03` for anything under an hour. */
export function formatPlaybackPosition(
    position: PlaybackPositionData | null
): string {
    if (!position) {
        return '';
    }

    const date = new Date(0);
    date.setSeconds(position.positionSeconds);
    const timeString = date.toISOString().substring(11, 19);
    return timeString.startsWith('00:') ? timeString.substring(3) : timeString;
}
