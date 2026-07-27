import type { VodSourcePinService } from '@iptvnator/services';
import {
    buildVodSourceMatchKey,
    type VodSourceCandidate,
    type VodSourcePin,
} from '@iptvnator/shared/interfaces';

/**
 * Reading and writing the per-movie pinned source.
 *
 * Split out of the host service to keep it inside its line budget; the pin is a
 * self-contained errand with its own key handling, and nothing else in the
 * host needs to know how a match key is chosen.
 */

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
