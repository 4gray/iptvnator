import type { VodMultiSourceController } from '@iptvnator/portal/shared/data-access';
import type { VodSourcePinService } from '@iptvnator/services';
import {
    buildVodSourceMatchKey,
    type VodSourceCandidate,
    type VodSourceDescriptor,
    type VodSourcePin,
} from '@iptvnator/shared/interfaces';

/**
 * Reading and writing the per-movie pinned source.
 *
 * Split out of the host service to keep it inside its line budget; the pin is a
 * self-contained errand with its own key handling, and nothing else in the
 * host needs to know how a match key is chosen.
 */

/**
 * The one copy inside the playlist being viewed that discovery must keep.
 *
 * A pin can point at another copy of the film in that same playlist, and
 * excluding the playlist wholesale would drop the pinned row from the list —
 * leaving the preference pointing at nothing and silently ignored.
 */
export function pinnedCopyInPlaylist(
    pin: VodSourcePin | null,
    playlistId: string
): number | null {
    return pin && pin.playlistId === playlistId ? pin.contentId : null;
}

/**
 * The pinned row, when it is not the one already playing.
 *
 * "Make this the main source" has to survive reopening the movie, or the
 * persisted preference is just an icon. The host consults this before its
 * normal Play, so the pin decides where playback starts.
 */
export function pinnedSourceAwaitingPlay(
    sources: readonly VodSourceDescriptor[]
): string | null {
    const pinned = sources.find((source) => source.isPinned);
    return pinned && !pinned.isActive ? pinned.id : null;
}

/** The row id the controller uses, derived from a stored pin. */
export function pinnedSourceIdOf(pin: VodSourcePin): string {
    return `${pin.playlistId}:${pin.portalType}:${pin.contentId}`;
}

export async function readPin(
    pins: Pick<VodSourcePinService, 'get'>,
    matchKeys: readonly string[]
): Promise<VodSourcePin | null> {
    return matchKeys.length > 0 ? pins.get([...matchKeys]) : null;
}

/**
 * Persist the pin for `candidate` under the movie's most-trusted key, having
 * first cleared every alias it could otherwise be found under.
 *
 * Both halves are load-bearing, and each rules out the other's obvious
 * shortcut:
 *
 * - Writing ONLY the top key leaves the lower-trust aliases pointing at
 *   whatever was pinned before, and a reopen that reads one of those —
 *   because enrichment has not landed yet — starts the source the user just
 *   replaced. Hence the clear.
 * - Writing the decision INTO every alias is not the fix either: the yearless
 *   `title:{base}:` form is shared by every remake, so a known-year pin stored
 *   there would answer for a different film — pin Dune (2021), open Dune
 *   (1984) before its year arrives, and it would start the 2021 source. That
 *   alias stays readable, for genuinely pre-enrichment pins, and unwritten.
 */
export async function writePin(
    pins: Pick<VodSourcePinService, 'set' | 'clear'>,
    matchKeys: readonly string[],
    candidate: VodSourceCandidate
): Promise<boolean> {
    const matchKey = matchKeys[0] ?? buildVodSourceMatchKey(candidate);
    if (!matchKey) {
        return false;
    }

    await erasePin(pins, matchKeys);

    // The write can fail — no bridge, or the DB refused it. Reporting success
    // then would show a pin the next visit does not have.
    return pins.set({
        matchKey,
        playlistId: candidate.playlistId,
        contentId: candidate.contentId,
        portalType: candidate.portalType,
    });
}

/** Clears every alias, so unpinning is not undone by a stale row. */
export async function erasePin(
    pins: Pick<VodSourcePinService, 'clear'>,
    matchKeys: readonly string[]
): Promise<boolean> {
    return matchKeys.length > 0 ? pins.clear([...matchKeys]) : false;
}

/**
 * Pin or unpin `candidate`, and report the id the controller should now hold.
 *
 * `undefined` means the toggle did not happen at all — no key to store it
 * under, no such row, or the write did not land — and the caller must leave
 * the current pin exactly as it was rather than showing one that was not
 * saved. A pin the database refused is worse than no pin: the icon promises
 * the preference will be there next time, and it will not be.
 */
export async function togglePinnedSource(
    pins: Pick<VodSourcePinService, 'set' | 'clear'>,
    matchKeys: readonly string[],
    candidate: VodSourceCandidate | null,
    isPinned: boolean
): Promise<string | null | undefined> {
    if (matchKeys.length === 0) {
        return undefined;
    }

    if (isPinned) {
        return (await erasePin(pins, matchKeys)) ? null : undefined;
    }

    if (!candidate) {
        return undefined;
    }

    return (await writePin(pins, matchKeys, candidate))
        ? candidate.id
        : undefined;
}

/** What starting the pinned source needs from the host. */
export interface PinnedPlayDeps {
    controller: VodMultiSourceController;
    pinnedSourceId: string | null;
    /** Where THAT source was last watched, when the host can look it up. */
    resumeFor?: (source: VodSourceCandidate) => Promise<number | null>;
    play: (sourceId: string) => Promise<boolean>;
}

/**
 * Start the movie from its pinned source, at the position that source was
 * last left at.
 *
 * Playback positions are keyed by (playlist, stream), so watching through a
 * pinned alternative stores progress under ITS ids. The page loaded the ROUTE
 * row, which for this source is stale or missing entirely — resuming from it
 * would restart the film or jump to where a different copy was left.
 */
export async function playPinned(deps: PinnedPlayDeps): Promise<boolean> {
    const pinned = deps.controller.findSource(deps.pinnedSourceId ?? '');
    if (!pinned) {
        return false;
    }

    const stored = await deps.resumeFor?.(pinned);
    if (stored !== null && stored !== undefined) {
        deps.controller.setResumeSeconds(stored);
    }

    return deps.play(pinned.id);
}
