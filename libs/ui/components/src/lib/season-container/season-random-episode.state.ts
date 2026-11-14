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
    readonly playEpisode: (episode: XtreamSerieEpisode) => void;
}

export interface SeasonRandomEpisodeState {
    /**
     * Shuffle has its own visibility: it needs playable episodes somewhere in
     * the series (or seasons still to load), not the metadata the grid/list
     * toggle depends on.
     */
    readonly canPlay: Signal<boolean>;
    play(): void;
}

/**
 * The "play a random episode" action. When the pick lands on a season that is
 * not loaded yet, the season is selected so the host loads it, and a random
 * episode from it plays once its list arrives. Moving to another season first
 * drops the pending shuffle. Must be created in an injection context.
 */
export function createSeasonRandomEpisodeState(
    sources: SeasonRandomEpisodeSources
): SeasonRandomEpisodeState {
    const pendingSeason = signal<string | null>(null);

    effect(() => {
        const seasonKey = pendingSeason();
        if (!seasonKey) {
            return;
        }
        if (sources.selectedSeason() !== seasonKey) {
            untracked(() => pendingSeason.set(null));
            return;
        }
        if (sources.unloadedSeasonKeys().includes(seasonKey)) {
            return;
        }
        const episode = pickRandomEpisode({
            [seasonKey]: sources.seasons()[seasonKey] ?? [],
        });
        untracked(() => {
            pendingSeason.set(null);
            if (episode) {
                sources.playEpisode(episode);
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
                pendingSeason.set(null);
                sources.playEpisode(pick.episode);
                return;
            }
            pendingSeason.set(pick.seasonKey);
            sources.selectedSeason.set(pick.seasonKey);
        },
    };
}
