import type { VodMultiSourceController } from '@iptvnator/portal/shared/data-access';
import type { VodSourcePinService } from '@iptvnator/services';
import {
    buildVodSourceMatchKey,
    buildVodSourceMatchKeyCandidates,
    buildVodSourceMatchKeyWriteKeys,
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
    keys: PinKeySets,
    candidate: VodSourceCandidate
): Promise<boolean> {
    const matchKey = keys.write[0] ?? buildVodSourceMatchKey(candidate);
    if (!matchKey) {
        return false;
    }

    // The write goes FIRST, and the old rows only go once it landed. The
    // other order destroys the stored preference and then fails to replace it
    // — leaving nothing persisted while the UI still shows the old pin.
    // Lookups are most-trusted-first, so a leftover alias never outranks the
    // key just written.
    const stored = await pins.set({
        matchKey,
        playlistId: candidate.playlistId,
        contentId: candidate.contentId,
        portalType: candidate.portalType,
    });
    if (!stored) {
        return false;
    }

    await erasePin(
        pins,
        retirablePinKeys(keys).filter((key) => key !== matchKey)
    );
    return true;
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
    keys: PinKeySets,
    candidate: VodSourceCandidate | null,
    isPinned: boolean
): Promise<string | null | undefined> {
    if (keys.write.length === 0) {
        return undefined;
    }

    if (isPinned) {
        return (await erasePin(pins, retirablePinKeys(keys)))
            ? null
            : undefined;
    }

    if (!candidate) {
        return undefined;
    }

    return (await writePin(pins, keys, candidate)) ? candidate.id : undefined;
}

/** Which keys a pin may be looked up under, stored under, and removed from. */
export interface PinKeySets {
    /** Every alias the pin may be sitting under, most-trusted first. */
    lookup: readonly string[];
    /** Keys that name exactly one film. */
    write: readonly string[];
    /** The key the pin currently on screen was actually found under. */
    loaded?: string | null;
}

/** The three key sets for a movie, in one place so they cannot disagree. */
export function pinKeysFor(movie: {
    tmdbId?: number | string | null;
    title?: string | null;
    year?: number | null;
}): PinKeySets {
    return {
        lookup: buildVodSourceMatchKeyCandidates(movie),
        write: buildVodSourceMatchKeyWriteKeys(movie),
    };
}

/**
 * The rows a write or an unpin is allowed to remove.
 *
 * Never the ambiguous yearless alias on spec — it may hold another remake's
 * preference. The one exception is the row this session actually READ: the
 * user is acting on the pin they can see, whatever key it happens to live
 * under, and leaving it would make an unpin come back.
 */
function retirablePinKeys(keys: PinKeySets): string[] {
    const retire = [...keys.write];
    if (keys.loaded && !retire.includes(keys.loaded)) {
        retire.push(keys.loaded);
    }
    return retire;
}

/** What starting the pinned source needs from the host. */
export interface PinnedPlayDeps {
    controller: VodMultiSourceController;
    pinnedSourceId: string | null;
    /** Where THAT source was last watched, when the host can look it up. */
    resumeFor?: (source: VodSourceCandidate) => Promise<number | null>;
    /** False once another movie owns the screen — the lookup is awaited. */
    isCurrent: () => boolean;
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

    const looked = !!deps.resumeFor;
    const stored = await deps.resumeFor?.(pinned);
    // That lookup is a database round-trip, and the user can navigate across
    // it. Playing then would hand THIS film's source id to whatever movie now
    // owns the screen — starting it, if the id happens to exist there.
    if (!deps.isCurrent()) {
        return false;
    }

    if (looked) {
        // `null` means this copy has never been watched, and the controller is
        // still holding the ROUTE copy's position. Carrying that across would
        // drop the user an hour into a film they have not started here — and
        // the first save would write that timecode under this source's key.
        deps.controller.setResumeSeconds(stored ?? 0);
    }

    return deps.play(pinned.id);
}
