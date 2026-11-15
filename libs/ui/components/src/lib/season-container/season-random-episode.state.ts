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
 * episode from it plays once its list arrives. Moving to another season or
 * starting any other playback first drops the pending shuffle. Must be
 * created in an injection context.
 */
export function createSeasonRandomEpisodeState(
    sources: SeasonRandomEpisodeSources
): SeasonRandomEpisodeState {
    const playbackEpisodeId = computed(
        () => sources.openingEpisodeId() ?? sources.playingEpisodeId()
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
        if (
            sources.selectedSeason() !== seasonKey ||
            playbackEpisodeId() !== waiting.playbackEpisodeId
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
            }
        });
    });

    return {
        canPlay: computed(
            () =>
                sources.unloadedSeasonKeys().length > 0 ||
                Object.values(sources.seasons() ?? {}).some(
                    (episodes) => (episodes?.length ?? 0) > 0
                )
        ),
        play() {
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
            sources.selectedSeason.set(pick.seasonKey);
        },
        cancel() {
            pending.set(null);
        },
    };
}
