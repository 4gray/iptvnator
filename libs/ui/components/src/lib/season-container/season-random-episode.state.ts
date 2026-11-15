import {
    Signal,
    WritableSignal,
    computed,
    effect,
    signal,
    untracked,
} from '@angular/core';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    pickRandomEpisode,
    pickRandomEpisodeOrSeason,
} from './pick-random-episode.util';

export interface SeasonRandomEpisodeSources {
    readonly seasons: Signal<Record<string, XtreamSerieEpisode[]>>;
    /** Seasons whose episode lists are not loaded yet (Stalker lazy-VOD). */
    readonly unloadedSeasonKeys: Signal<readonly string[]>;
    /** Selecting a season makes the host load it when it is lazy. */
    readonly selectedSeason: WritableSignal<string | undefined>;
    /** Plays an episode through the host's ordinary episode path. */
    selectEpisode(episode: XtreamSerieEpisode): void;
    /**
     * The episode the host is opening or playing. Any playback started while
     * a shuffle waits for its season (the hero's Play or Next, a restart)
     * changes one of them, and the newer choice wins.
     */
    readonly openingEpisodeId: Signal<number | null>;
    readonly playingEpisodeId: Signal<number | null>;
    readonly activeEpisodeId: Signal<number | null>;
    /** Tells the host to load a season; it skips one already loading. */
    readonly seasonSelected: { emit(seasonKey: string): void };
}

export interface SeasonRandomEpisodeState {
    /**
     * Shuffle has its own visibility: it needs playable episodes somewhere in
     * the series (or seasons still to load), not the metadata the grid/list
     * toggle depends on.
     */
    readonly canPlay: Signal<boolean>;
    play(): void;
    /** Drops a shuffle still waiting for its season to load. */
    cancel(): void;
}

/**
 * The "play a random episode" action. When the pick lands on a season that is
 * not loaded yet, the season is selected so the host loads it, and a random
 * episode from it plays once its list arrives; a season that turns out empty
 * draws again from the rest. Moving to another season or starting any other
 * playback first drops the pending shuffle. Must be created in an injection
 * context.
 */
export function createSeasonRandomEpisodeState(
    sources: SeasonRandomEpisodeSources
): SeasonRandomEpisodeState {
    // A launch moves its id from opening to active (external players) or
    // playing, so the chain keeps naming the same episode across it.
    const playbackEpisodeId = computed(
        () =>
            sources.openingEpisodeId() ??
            sources.playingEpisodeId() ??
            sources.activeEpisodeId()
    );
    const pending = signal<{
        seasonKey: string;
        playbackEpisodeId: number | null;
    } | null>(null);

    effect(() => {
        const waiting = pending();
        if (!waiting) {
            return;
        }
        const { seasonKey } = waiting;
        // Only a newly started episode counts; playback ending is no choice.
        const playback = playbackEpisodeId();
        if (
            sources.selectedSeason() !== seasonKey ||
            (playback !== null && playback !== waiting.playbackEpisodeId)
        ) {
            untracked(() => pending.set(null));
            return;
        }
        if (sources.unloadedSeasonKeys().includes(seasonKey)) {
            return;
        }
        const episode = pickRandomEpisode({
            [seasonKey]: sources.seasons()[seasonKey] ?? [],
        });
        untracked(() => {
            pending.set(null);
            if (episode) {
                sources.selectEpisode(episode);
            } else {
                // The empty season no longer weighs in the next draw.
                play();
            }
        });
    });

    function play(): void {
        const pick = pickRandomEpisodeOrSeason(
            sources.seasons(),
            sources.unloadedSeasonKeys()
        );
        if (!pick) {
            return;
        }
        if (pick.kind === 'episode') {
            pending.set(null);
            sources.selectEpisode(pick.episode);
            return;
        }
        pending.set({
            seasonKey: pick.seasonKey,
            playbackEpisodeId: untracked(playbackEpisodeId),
        });
        if (untracked(sources.selectedSeason) === pick.seasonKey) {
            // Already selected but unloaded (a load that failed): selecting
            // it again changes nothing, so ask the host to load it again.
            sources.seasonSelected.emit(pick.seasonKey);
        } else {
            sources.selectedSeason.set(pick.seasonKey);
        }
    }

    return {
        canPlay: computed(
            () =>
                sources.unloadedSeasonKeys().length > 0 ||
                Object.values(sources.seasons() ?? {}).some(
                    (episodes) => (episodes?.length ?? 0) > 0
                )
        ),
        play,
        cancel() {
            pending.set(null);
        },
    };
}
