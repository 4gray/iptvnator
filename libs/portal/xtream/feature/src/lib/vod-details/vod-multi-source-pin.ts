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
 * Persist the pin for `candidate`.
 *
 * Written under the most-trusted key while lookups pass every alias, so a TMDB
 * id arriving after the fact does not orphan the row.
 */
export async function writePin(
    pins: Pick<VodSourcePinService, 'set'>,
    matchKeys: readonly string[],
    candidate: VodSourceCandidate
): Promise<boolean> {
    const matchKey = matchKeys[0] ?? buildVodSourceMatchKey(candidate);
    if (!matchKey) {
        return false;
    }

    await pins.set({
        matchKey,
        playlistId: candidate.playlistId,
        contentId: candidate.contentId,
        portalType: candidate.portalType,
    });
    return true;
}

/** Clears every alias, so unpinning is not undone by a stale row. */
export async function erasePin(
    pins: Pick<VodSourcePinService, 'clear'>,
    matchKeys: readonly string[]
): Promise<void> {
    if (matchKeys.length > 0) {
        await pins.clear([...matchKeys]);
    }
}
