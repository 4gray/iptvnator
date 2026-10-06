import {
    type Signal,
    type WritableSignal,
    computed,
    effect,
    untracked,
} from '@angular/core';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { resolveAutoSelectedSeason } from './season-auto-select.util';

export interface SeasonAutoSelectSources {
    /**
     * The container's selection (see `SeasonContainerComponent.selectedSeason`).
     * Auto-select writes to it; user tab clicks write to it too and stick
     * until the auto-select key changes.
     */
    readonly selectedSeason: WritableSignal<string | undefined>;
    readonly seasons: Signal<Record<string, XtreamSerieEpisode[]>>;
    /** Season keys in display order. */
    readonly sortedSeasonKeys: Signal<readonly string[]>;
    /** Season key of the inline-playing episode, if it is in the loaded set. */
    readonly playingSeasonKey: Signal<string | null>;
    readonly playbackPositions: Signal<
        ReadonlyMap<number, PlaybackPositionData>
    >;
    readonly positionOf: (
        episode: XtreamSerieEpisode
    ) => PlaybackPositionData | undefined;
    /** Stalker lazy-VOD: some seasons' episode lists are not loaded yet. */
    readonly hasUnloadedSeasons: Signal<boolean>;
    readonly episodeCounts: Signal<Record<string, number>>;
    readonly watchedCounts: Signal<Record<string, number>>;
    readonly emitSeasonSelected: (seasonKey: string) => void;
}

export interface SeasonAutoSelectState {
    /**
     * Record that this session toggled watched state itself: the positions
     * flip that follows is then not treated as an initial load.
     */
    markLocalWatchedMutation(): void;
}

/** Key of the loaded season that holds the episode with this content id. */
export function findSeasonOfEpisode(
    seasons: Record<string, XtreamSerieEpisode[]>,
    episodeId: number
): string | null {
    for (const [key, episodes] of Object.entries(seasons)) {
        if (episodes?.some((episode) => Number(episode.id) === episodeId)) {
            return key;
        }
    }
    return null;
}

/**
 * Season auto-selection and `seasonSelected` emission of
 * `SeasonContainerComponent`. The selection re-resolves when the season key
 * set changes or when playback positions first arrive; ongoing position
 * saves do not reset it — only the empty→loaded transition of the positions
 * map does, and even that is ignored once this session toggled watched state
 * itself.
 *
 * Registers two effects, so it must be called in an injection context (the
 * container's constructor).
 */
export function createSeasonAutoSelectState(
    sources: SeasonAutoSelectSources
): SeasonAutoSelectState {
    const autoSelectKey = computed(
        () =>
            `${sources.sortedSeasonKeys().join('|')}::${
                sources.playbackPositions().size > 0 ? '1' : '0'
            }`
    );
    let lastAutoSelectKey: string | null = null;
    let lastAutoSelectSeasonSet: string | null = null;
    /**
     * True once this session toggled watched state itself. From then on an
     * empty↔loaded flip of the positions map is the echo of that action, not
     * an async initial load — re-resolving on it would yank the user off the
     * season they just marked (e.g. all-watched season 1 → jump to season 2).
     */
    let hasLocalWatchedMutation = false;
    let lastEmittedSeason: string | undefined;

    /** Auto-select rules live in season-auto-select.util.ts. */
    const resolveAutoSeason = (): string | undefined =>
        resolveAutoSelectedSeason({
            keys: sources.sortedSeasonKeys(),
            playingSeasonKey: sources.playingSeasonKey(),
            seasons: sources.seasons(),
            positionOf: sources.positionOf,
            hasUnloadedSeasons: sources.hasUnloadedSeasons(),
            episodeCounts: sources.episodeCounts(),
            watchedCounts: sources.watchedCounts(),
        });

    effect(() => {
        const key = autoSelectKey();
        if (key === lastAutoSelectKey) {
            return;
        }
        const seasonSet = untracked(() => sources.sortedSeasonKeys().join('|'));
        const seasonSetUnchanged = seasonSet === lastAutoSelectSeasonSet;
        lastAutoSelectKey = key;
        lastAutoSelectSeasonSet = seasonSet;
        // A positions-emptiness flip after a local watched toggle keeps
        // the current selection; only the async initial positions load
        // (or a season-set change) re-resolves the season.
        if (seasonSetUnchanged && hasLocalWatchedMutation) {
            return;
        }
        sources.selectedSeason.set(untracked(() => resolveAutoSeason()));
    });

    // Fire the lazy-load/enrichment hooks for auto-selected seasons too —
    // with tabs there is no initial "pick a season" click anymore.
    effect(() => {
        const selected = sources.selectedSeason();
        if (selected && selected !== lastEmittedSeason) {
            lastEmittedSeason = selected;
            sources.emitSeasonSelected(selected);
        }
    });

    return {
        markLocalWatchedMutation: () => {
            hasLocalWatchedMutation = true;
        },
    };
}
