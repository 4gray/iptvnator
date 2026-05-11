import {
    SERIES_QUICK_START_ACTION_KIND,
    formatSeriesEpisodeCode,
    getSeriesQuickStartAction,
    type SeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import {
    getVodSeriesSeasonKey,
    type VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from 'shared-interfaces';

export interface StalkerQuickStartButton {
    labelKey: string;
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
    const firstUnloadedSeason = getFirstUnloadedVodSeriesSeason(seasons);
    if (!action) {
        return firstUnloadedSeason;
    }

    if (
        !firstUnloadedSeason ||
        action.kind === SERIES_QUICK_START_ACTION_KIND.Resume
    ) {
        return null;
    }

    if (action.kind === SERIES_QUICK_START_ACTION_KIND.Completed) {
        return firstUnloadedSeason;
    }

    const unloadedSeasonIndex = seasons.findIndex(
        (season) => season.id === firstUnloadedSeason.id
    );
    const actionSeasonIndex = findVodSeriesSeasonIndexForEpisode(
        action.episode,
        seasons,
        mappedSeasons
    );

    return unloadedSeasonIndex !== -1 &&
        actionSeasonIndex !== -1 &&
        unloadedSeasonIndex < actionSeasonIndex
        ? firstUnloadedSeason
        : null;
}

function getFirstUnloadedVodSeriesSeason(
    seasons: ReadonlyArray<VodSeriesSeasonVm>
): VodSeriesSeasonVm | null {
    return seasons.find((season) => season.episodes.length === 0) ?? null;
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
    const seasonIndex = seasons.findIndex((item) => item.id === season.id);
    const parsedSeasonNumber = Number(season.season_number);
    const seasonNumber =
        Number.isInteger(parsedSeasonNumber) && parsedSeasonNumber > 0
            ? parsedSeasonNumber
            : getFallbackSeasonNumber(seasonIndex);

    return formatSeriesEpisodeCode(seasonNumber, 1);
}

function getFallbackSeasonNumber(seasonIndex: number): number {
    return seasonIndex >= 0 ? seasonIndex + 1 : 1;
}
