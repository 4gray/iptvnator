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
     * Auto-select and manual season picks both write to it.
     */
    readonly selectedSeason: WritableSignal<string | undefined>;
    readonly playlistId: Signal<string>;
    readonly seriesId: Signal<number>;
    readonly seasons: Signal<Record<string, XtreamSerieEpisode[]>>;
    /** Season keys in display order. */
    readonly sortedSeasonKeys: Signal<readonly string[]>;
    /** Season key of the inline-playing episode, if it is in the loaded set. */
    readonly playingSeasonKey: Signal<string | null>;
    readonly playbackPositions: Signal<
        ReadonlyMap<number, PlaybackPositionData>
    >;
    /** Stalker lazy-VOD: some seasons' episode lists are not loaded yet. */
    readonly hasUnloadedSeasons: Signal<boolean>;
    /** Stalker lazy-VOD: the seasons whose lists are not loaded yet. */
    readonly unloadedSeasonKeys: Signal<readonly string[]>;
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
    /**
     * Record that the user explicitly chose a season in the picker, so lazy
     * season hydration does not override their manual choice.
     */
    markManualSelection(): void;
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
 * Re-resolves selection when the series, season set or hydrated progress
 * changes. A manual pick or local watched toggle holds the selected season
 * while that series' progress loads.
 *
 * Registers two effects, so it must be called in an injection context (the
 * container's constructor).
 */
export function createSeasonAutoSelectState(
    sources: SeasonAutoSelectSources
): SeasonAutoSelectState {
    const seriesKey = computed(() =>
        JSON.stringify([sources.playlistId(), sources.seriesId()])
    );
    const seasonSetKey = computed(() =>
        JSON.stringify([seriesKey(), sources.sortedSeasonKeys()])
    );
    const autoSelectKey = computed(() => {
        const keys = sources.sortedSeasonKeys();
        const playbackPositions = sources.playbackPositions();
        const seasonsWithPositions = keys
            .filter((key) =>
                (sources.seasons()[key] ?? []).some((episode) =>
                    playbackPositions.has(Number(episode.id))
                )
            )
            .join('|');
        return JSON.stringify([
            seasonSetKey(),
            playbackPositions.size > 0,
            seasonsWithPositions,
            sources.hasUnloadedSeasons(),
            sources.unloadedSeasonKeys(),
        ]);
    });
    let lastAutoSelectKey: string | null = null;
    let lastAutoSelectSeasonSet: string | null = null;
    /**
     * True once this session toggled watched state itself. From then on an
     * empty↔loaded flip of the positions map is the echo of that action, not
     * an async initial load — re-resolving on it would yank the user off the
     * season they just marked (e.g. all-watched season 1 → jump to season 2).
     */
    let hasLocalWatchedMutation = false;
    let hasManualSelection = false;
    let lastEmittedSeason: string | undefined;

    /** Auto-select rules live in season-auto-select.util.ts. */
    const resolveAutoSeason = (): string | undefined =>
        resolveAutoSelectedSeason({
            keys: sources.sortedSeasonKeys(),
            playingSeasonKey: sources.playingSeasonKey(),
            seasons: sources.seasons(),
            playbackPositions: sources.playbackPositions(),
            hasUnloadedSeasons:
                sources.hasUnloadedSeasons() ||
                sources.unloadedSeasonKeys().length > 0,
            unloadedSeasonKeys: sources.unloadedSeasonKeys(),
            episodeCounts: sources.episodeCounts(),
            watchedCounts: sources.watchedCounts(),
        });

    effect(() => {
        const key = autoSelectKey();
        if (key === lastAutoSelectKey) {
            return;
        }
        const seasonSet = seasonSetKey();
        const seasonSetUnchanged = seasonSet === lastAutoSelectSeasonSet;
        lastAutoSelectKey = key;
        lastAutoSelectSeasonSet = seasonSet;
        if (!seasonSetUnchanged) {
            hasLocalWatchedMutation = false;
            hasManualSelection = false;
        }
        // A positions-emptiness flip after a local watched toggle or a manual
        // season pick keeps the current selection; only the async initial
        // positions/season hydration (or a season-set change) re-resolves.
        if (
            seasonSetUnchanged &&
            (hasLocalWatchedMutation || hasManualSelection)
        ) {
            return;
        }
        sources.selectedSeason.set(untracked(() => resolveAutoSeason()));
    });

    // Fire the lazy-load/enrichment hooks for auto-selected seasons too —
    // with tabs there is no initial "pick a season" click anymore.
    effect(() => {
        const selected = sources.selectedSeason();
        const emission = JSON.stringify([seriesKey(), selected]);
        if (selected && emission !== lastEmittedSeason) {
            lastEmittedSeason = emission;
            sources.emitSeasonSelected(selected);
        }
    });

    return {
        markLocalWatchedMutation: () => {
            hasLocalWatchedMutation = true;
        },
        markManualSelection: () => {
            hasManualSelection = true;
        },
    };
}
