import { PlaybackPositionData, XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { isPortalPlaybackInProgress } from './portal-playback-positions';
import {
    getSeriesNextUp,
    type SeriesEpisodeEntry,
    type SeriesProgressRequest,
} from './series-next-up';

export const SERIES_QUICK_START_ACTION_KIND = {
    PlayFirst: 'play-first',
    PlayRecent: 'play-recent',
    Resume: 'resume',
    PlayNext: 'play-next',
    Completed: 'completed',
} as const;

export type SeriesQuickStartActionKind =
    (typeof SERIES_QUICK_START_ACTION_KIND)[keyof typeof SERIES_QUICK_START_ACTION_KIND];

export interface SeriesQuickStartAction {
    kind: SeriesQuickStartActionKind;
    labelKey: string;
    labelParams?: Record<string, number>;
    episodeLabel: string;
    icon: string;
    episode: XtreamSerieEpisode;
    position: PlaybackPositionData | null;
    disabled: boolean;
}

/**
 * The series page's play button, for the episode the series goes on with
 * (`getSeriesNextUp`). A series caught up after its newest watched episode
 * offers the first one skipped before it, and completes when none is left.
 */
export function getSeriesQuickStartAction(
    request: SeriesProgressRequest
): SeriesQuickStartAction | null {
    const nextUp = getSeriesNextUp(request);
    if (!nextUp) {
        return null;
    }
    if (nextUp.kind === 'caught-up') {
        return nextUp.skipped
            ? continueAction(nextUp.skipped)
            : createQuickStartAction({
                  kind: SERIES_QUICK_START_ACTION_KIND.Completed,
                  labelKey: 'XTREAM.SERIES_WATCHED',
                  icon: 'check_circle',
                  episode: nextUp.last.episode,
                  position: nextUp.last.position,
                  disabled: true,
              });
    }
    if (nextUp.kind === 'next') {
        return continueAction(nextUp.entry);
    }
    const { episode, position } = nextUp.entry;
    if (nextUp.kind === 'start') {
        return createQuickStartAction({
            kind: SERIES_QUICK_START_ACTION_KIND.PlayFirst,
            labelKey: 'XTREAM.PLAY_FIRST_EPISODE',
            icon: 'play_arrow',
            episode,
            position,
            disabled: false,
        });
    }
    if (isPortalPlaybackInProgress(position)) {
        return resumeAction(nextUp.entry);
    }
    // Launched, with no progress saved yet.
    return createQuickStartAction({
        kind: SERIES_QUICK_START_ACTION_KIND.PlayRecent,
        labelKey: 'XTREAM.PLAY_EPISODE',
        labelParams: { episode: Number(episode.episode_num) },
        icon: 'play_arrow',
        episode,
        position,
        disabled: false,
    });
}

function continueAction(entry: SeriesEpisodeEntry): SeriesQuickStartAction {
    return isPortalPlaybackInProgress(entry.position)
        ? resumeAction(entry)
        : createQuickStartAction({
              kind: SERIES_QUICK_START_ACTION_KIND.PlayNext,
              labelKey: 'XTREAM.PLAY_NEXT_EPISODE',
              icon: 'play_arrow',
              episode: entry.episode,
              position: entry.position,
              disabled: false,
          });
}

function resumeAction(entry: SeriesEpisodeEntry): SeriesQuickStartAction {
    return createQuickStartAction({
        kind: SERIES_QUICK_START_ACTION_KIND.Resume,
        labelKey: 'XTREAM.RESUME_EPISODE',
        icon: 'play_arrow',
        episode: entry.episode,
        position: entry.position,
        disabled: false,
    });
}

function createQuickStartAction(
    action: Omit<SeriesQuickStartAction, 'episodeLabel'>
): SeriesQuickStartAction {
    return {
        ...action,
        episodeLabel: getEpisodeLabel(action.episode),
    };
}

function getEpisodeLabel(episode: XtreamSerieEpisode): string {
    const episodeCode = formatSeriesEpisodeCode(
        episode.season,
        episode.episode_num
    );
    const title = episode.title.trim();

    return title ? `${episodeCode} · ${title}` : episodeCode;
}

export function formatSeriesEpisodeCode(
    seasonNumber: number,
    episodeNumber: number
): string {
    const safeSeasonNumber = getPositiveInteger(seasonNumber) ?? 1;
    const safeEpisodeNumber = getPositiveInteger(episodeNumber) ?? 1;

    return `S${padEpisodePart(safeSeasonNumber)}E${padEpisodePart(
        safeEpisodeNumber
    )}`;
}

function getPositiveInteger(value: number): number | null {
    return Number.isInteger(value) && value > 0 ? value : null;
}

function padEpisodePart(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}
