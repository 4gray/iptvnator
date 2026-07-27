import type { VodMultiSourceController } from '@iptvnator/portal/shared/data-access';
import type {
    ResolvedPortalPlayback,
    VodSourceCandidate,
    VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';
import {
    buildSwitchNotice,
    type VodMultiSourceSwitchNotice,
} from './vod-multi-source-notice';

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

    if (!switchedTo) {
        controller.setSources([current, ...discovered], matchKind);
        controller.setActiveSource(current.id);
        return;
    }

    // The rerun can legitimately drop the playing row: enrichment supplies the
    // release year, and the year gate then rejects a copy that a yearless
    // search had admitted ("Dune" 1984 while watching the 2021 film). Dropping
    // it from the LIST is right — it is not the same film. Dropping it from
    // the SCREEN is not: it is what the user is watching, so it stays as a row
    // and keeps the playing badge rather than letting the caption name a
    // playlist that is not streaming anything.
    const isDiscovered = discovered.some(
        (source) => source.id === switchedTo.id
    );
    // Catalog rows only ever carry guesses parsed off the title, so the row
    // that a real resolve turned into facts wins over its rediscovered twin.
    const sources = isDiscovered
        ? discovered.map((source) =>
              source.id === switchedTo.id ? switchedTo : source
          )
        : [...discovered, switchedTo];

    controller.setSources([current, ...sources], matchKind);
    controller.setActiveSource(switchedTo.id);
}

/** What `switchToSource` needs from the host, without reaching into it. */
export interface SwitchDeps {
    controller: VodMultiSourceController;
    resolve: (
        candidate: VodSourceCandidate,
        options: { startTime: number }
    ) => Promise<{
        playback: ResolvedPortalPlayback;
        candidate: VodSourceCandidate;
    } | null>;
    startPlayback: (playback: ResolvedPortalPlayback) => void;
    /** False once a newer switch, or another movie, owns the screen. */
    isCurrent: () => boolean;
    setPreviousSource: (sourceId: string | null) => void;
    setNotice: (notice: VodMultiSourceSwitchNotice) => void;
    publish: () => void;
}

/**
 * Put one source on screen, carrying the timecode across.
 *
 * The controller is taken from `deps` rather than read live, because `load()`
 * swaps in a fresh one for a new movie and the continuation after the await
 * must never touch that one.
 */
export async function switchToSource(
    candidate: VodSourceCandidate,
    deps: SwitchDeps
): Promise<SwitchOutcome> {
    const { controller } = deps;

    // The LIVE position, not the persisted one: the stored value lags by up to
    // the save throttle and switching would visibly rewind.
    const resumeSeconds = Math.floor(controller.getResumeSeconds());
    const previous = controller.findSource(controller.activeSourceId() ?? '');

    const resolved = await deps.resolve(candidate, {
        startTime: resumeSeconds,
    });
    if (!deps.isCurrent()) {
        // Superseded mid-flight — dropping the result is the whole point.
        return 'superseded';
    }

    if (!resolved) {
        // Mark it tried without making it active: a source we cannot even
        // build a URL for must not be offered again by failover, but it never
        // started playing either.
        controller.markTried(candidate.id);
        deps.publish();
        return 'unresolvable';
    }

    controller.updateSource(resolved.candidate);
    deps.setPreviousSource(previous?.id ?? null);
    controller.setActiveSource(candidate.id);
    controller.setResumeSeconds(resumeSeconds);
    deps.startPlayback(resolved.playback);

    deps.setNotice(
        buildSwitchNotice(
            candidate,
            resolved.candidate,
            previous,
            resumeSeconds
        )
    );
    deps.publish();
    return 'switched';
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
