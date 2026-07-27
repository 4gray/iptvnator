import type { VodMultiSourceController } from '@iptvnator/portal/shared/data-access';
import type {
    VodSourceCandidate,
    VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';

/**
 * Session mechanics for one open movie: how a discovery folds into the state
 * that is already there, and how failover walks the ranked candidates.
 *
 * Pure functions over the controller — no I/O, no signals — so the host
 * service stays the wiring layer and these stay testable on their own.
 */

/**
 * Why a switch attempt ended. `unresolvable` is the only outcome failover may
 * continue past — `superseded` means something newer already owns the screen.
 */
export type SwitchOutcome = 'switched' | 'unresolvable' | 'superseded';

/**
 * Put a discovery result into the controller without losing the session.
 *
 * Discovery runs again for the SAME movie when metadata enrichment finally
 * supplies its year and TMDB id, and by then the user may have switched to
 * another playlist. Re-listing the sources must not quietly hand the film
 * back to the route's own playlist: the player would keep streaming the
 * source it switched to while every caption named a different one, and
 * failover would see the playing source as untried.
 */
export function applyDiscoveredSources(
    controller: VodMultiSourceController,
    current: VodSourceCandidate,
    discovered: VodSourceCandidate[],
    matchKind: VodSourceMatchKind
): void {
    const activeId = controller.activeSourceId();
    // Only a source the user actually switched to needs protecting. When the
    // route's own row is playing, the refreshed one supersedes it — it is the
    // same row, now carrying the enriched title and year.
    const switchedTo =
        activeId && activeId !== current.id
            ? controller.findSource(activeId)
            : null;

    controller.setSources([current, ...discovered], matchKind);

    const playing = switchedTo && controller.findSource(switchedTo.id);
    if (!playing) {
        controller.setActiveSource(current.id);
        return;
    }

    // Catalog rows only ever carry guesses parsed off the title. Whatever the
    // resolve turned into facts for the playing source stays fact.
    controller.updateSource(switchedTo);
    controller.setActiveSource(switchedTo.id);
}

/**
 * Move to the best untried source after a playback failure.
 *
 * Keeps going past candidates that cannot be resolved at all: a dead account
 * or a failing `get_vod_info` on the top-ranked source must not end the
 * attempt, because production calls this once — on the original failure — so
 * giving up here would strand a healthy lower-ranked source. Every attempt is
 * marked tried, which is what makes the loop terminate.
 */
export async function runFailover(
    controller: VodMultiSourceController,
    switchTo: (candidate: VodSourceCandidate) => Promise<SwitchOutcome>
): Promise<boolean> {
    for (;;) {
        const target = controller.pickFailoverTarget();
        if (!target) {
            return false;
        }

        const outcome = await switchTo(target);
        if (outcome === 'switched') {
            return true;
        }
        if (outcome === 'superseded') {
            // A newer switch or another movie already owns the screen.
            return false;
        }
        // 'unresolvable': the candidate is now marked tried, so the next pick
        // is strictly a different source and the loop terminates.
    }
}
