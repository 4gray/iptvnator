import {
    SERIES_QUICK_START_ACTION_KIND,
    formatSeriesEpisodeCode,
    getSeriesQuickStartAction,
    isExtrasSeason,
    type SeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import {
    getVodSeriesSeasonKey,
    getVodSeriesSeasonNumber,
    isVodSeasonHydrationPending,
    type VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';

export interface StalkerQuickStartButton {
    labelKey: string;
    labelParams?: Record<string, number>;
    episodeLabel: string | null;
    icon: string;
    disabled: boolean;
    action: SeriesQuickStartAction | null;
    lazySeason: VodSeriesSeasonVm | null;
}

interface StalkerQuickStartRequest {
    isVodSeries: boolean;
    mappedSeasons: Record<string, XtreamSerieEpisode[]>;
    playbackPositions: Map<number, PlaybackPositionData>;
    vodSeriesSeasons: ReadonlyArray<VodSeriesSeasonVm>;
}

const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export function getStalkerSeriesQuickStartButton(
    request: StalkerQuickStartRequest
): StalkerQuickStartButton | null {
    const action = getSeriesQuickStartAction({
        seasons: request.mappedSeasons,
        playbackPositions: request.playbackPositions,
    });
    const orderedVodSeriesSeasons = getOrderedVodSeriesSeasons(
        request.vodSeriesSeasons
    );
    const lazySeason = request.isVodSeries
        ? getQuickStartLazyVodSeriesSeason(
              action,
              request.mappedSeasons,
              orderedVodSeriesSeasons
          )
        : null;

    if (lazySeason) {
        return {
            labelKey: getLazyVodSeriesLabelKey(action),
            episodeLabel: getLazyVodSeriesEpisodeLabel(
                lazySeason,
                orderedVodSeriesSeasons
            ),
            icon: 'play_arrow',
            disabled: lazySeason.isLoading,
            action: null,
            lazySeason,
        };
    }

    if (!action) {
        return null;
    }

    return {
        labelKey: action.labelKey,
        labelParams: action.labelParams,
        episodeLabel: action.episodeLabel,
        icon: action.icon,
        disabled: action.disabled,
        action,
        lazySeason: null,
    };
}

function getOrderedVodSeriesSeasons(
    seasons: ReadonlyArray<VodSeriesSeasonVm>
): VodSeriesSeasonVm[] {
    return [...seasons].sort((seasonA, seasonB) =>
        naturalCollator.compare(
            getVodSeriesSeasonKey(seasonA),
            getVodSeriesSeasonKey(seasonB)
        )
    );
}

function getQuickStartLazyVodSeriesSeason(
    action: SeriesQuickStartAction | null,
    mappedSeasons: Record<string, XtreamSerieEpisode[]>,
    seasons: ReadonlyArray<VodSeriesSeasonVm>
): VodSeriesSeasonVm | null {
    const firstUnloadedSeason = getFirstUnloadedVodSeriesSeason(
        seasons,
        mappedSeasons
    );
    if (!action) {
        return firstUnloadedSeason;
    }
    if (!firstUnloadedSeason) {
        return null;
    }

    const actionSeasonIndex = findVodSeriesSeasonIndexForEpisode(
        action.episode,
        seasons,
        mappedSeasons
    );
    // Only extras loaded while a regular season is pending: they stand in
    // for the run until it loads, never decide what plays.
    const actionSeason = seasons[actionSeasonIndex];
    if (
        actionSeason &&
        isExtrasVodSeason(actionSeason, mappedSeasons) &&
        !isExtrasVodSeason(firstUnloadedSeason, mappedSeasons)
    ) {
        return firstUnloadedSeason;
    }

    if (action.kind === SERIES_QUICK_START_ACTION_KIND.Resume) {
        return null;
    }

    if (action.kind === SERIES_QUICK_START_ACTION_KIND.Completed) {
        return firstUnloadedSeason;
    }

    const unloadedSeasonIndex = seasons.findIndex(
        (season) => season.id === firstUnloadedSeason.id
    );

    return unloadedSeasonIndex !== -1 &&
        actionSeasonIndex !== -1 &&
        unloadedSeasonIndex < actionSeasonIndex
        ? firstUnloadedSeason
        : null;
}

/**
 * The first season the portal has not answered for yet (an empty answer is
 * loaded, not pending). Extras (season 0) are passed over while the series
 * has other seasons that hold, or may still hold, episodes: as with its next
 * episode (`getSeriesNextUp`), they never decide what plays.
 */
function getFirstUnloadedVodSeriesSeason(
    seasons: ReadonlyArray<VodSeriesSeasonVm>,
    mappedSeasons: Record<string, XtreamSerieEpisode[]>
): VodSeriesSeasonVm | null {
    const hasRun = seasons.some(
        (season) =>
            !isExtrasVodSeason(season, mappedSeasons) &&
            (season.episodes.length > 0 || isVodSeasonHydrationPending(season))
    );
    return (
        seasons.find(
            (season) =>
                isVodSeasonHydrationPending(season) &&
                !(hasRun && isExtrasVodSeason(season, mappedSeasons))
        ) ?? null
    );
}

function isExtrasVodSeason(
    season: VodSeriesSeasonVm,
    mappedSeasons: Record<string, XtreamSerieEpisode[]>
): boolean {
    const key = getVodSeriesSeasonKey(season);
    return isExtrasSeason(key, mappedSeasons[key]);
}

function findVodSeriesSeasonIndexForEpisode(
    episode: XtreamSerieEpisode,
    seasons: ReadonlyArray<VodSeriesSeasonVm>,
    mappedSeasons: Record<string, XtreamSerieEpisode[]>
): number {
    return seasons.findIndex((season) =>
        (mappedSeasons[getVodSeriesSeasonKey(season)] ?? []).some(
            (mappedEpisode) => mappedEpisode.id === episode.id
        )
    );
}

function getLazyVodSeriesLabelKey(
    action: SeriesQuickStartAction | null
): string {
    return action && action.kind !== SERIES_QUICK_START_ACTION_KIND.PlayFirst
        ? 'XTREAM.PLAY_NEXT_EPISODE'
        : 'XTREAM.PLAY_FIRST_EPISODE';
}

function getLazyVodSeriesEpisodeLabel(
    season: VodSeriesSeasonVm,
    seasons: ReadonlyArray<VodSeriesSeasonVm>
): string {
    return formatSeriesEpisodeCode(
        getVodSeriesSeasonNumber(season, seasons),
        1
    );
}
