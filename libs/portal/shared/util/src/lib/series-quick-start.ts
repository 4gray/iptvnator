import { PlaybackPositionData, XtreamSerieEpisode } from 'shared-interfaces';
import {
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
} from './portal-playback-positions';

export const SERIES_QUICK_START_ACTION_KIND = {
    PlayFirst: 'play-first',
    Resume: 'resume',
    PlayNext: 'play-next',
    Completed: 'completed',
} as const;

export type SeriesQuickStartActionKind =
    (typeof SERIES_QUICK_START_ACTION_KIND)[keyof typeof SERIES_QUICK_START_ACTION_KIND];

export interface SeriesQuickStartAction {
    kind: SeriesQuickStartActionKind;
    labelKey: string;
    episodeLabel: string;
    icon: string;
    episode: XtreamSerieEpisode;
    position: PlaybackPositionData | null;
    startTime?: number;
    disabled: boolean;
}

interface SeriesQuickStartRequest {
    seasons: Record<string, XtreamSerieEpisode[]>;
    playbackPositions: Map<number, PlaybackPositionData>;
}

interface OrderedEpisode {
    episode: XtreamSerieEpisode;
    position: PlaybackPositionData | null;
    order: number;
}

const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export function getSeriesQuickStartAction(
    request: SeriesQuickStartRequest
): SeriesQuickStartAction | null {
    const orderedEpisodes = getOrderedEpisodes(request);

    if (orderedEpisodes.length === 0) {
        return null;
    }

    const inProgress = orderedEpisodes
        .filter(({ position }) => isPortalPlaybackInProgress(position))
        .sort(compareInProgressPositions);

    const resumeEpisode = inProgress[inProgress.length - 1];
    if (resumeEpisode?.position) {
        return createQuickStartAction({
            kind: SERIES_QUICK_START_ACTION_KIND.Resume,
            labelKey: 'XTREAM.RESUME_EPISODE',
            icon: 'play_arrow',
            episode: resumeEpisode.episode,
            position: resumeEpisode.position,
            startTime: resumeEpisode.position.positionSeconds,
            disabled: false,
        });
    }

    const firstUnwatchedEpisode = orderedEpisodes.find(
        ({ position }) => !isPortalPlaybackWatched(position)
    );

    if (firstUnwatchedEpisode) {
        const hasWatchedEpisode = orderedEpisodes.some(({ position }) =>
            isPortalPlaybackWatched(position)
        );

        return createQuickStartAction({
            kind: hasWatchedEpisode
                ? SERIES_QUICK_START_ACTION_KIND.PlayNext
                : SERIES_QUICK_START_ACTION_KIND.PlayFirst,
            labelKey: hasWatchedEpisode
                ? 'XTREAM.PLAY_NEXT_EPISODE'
                : 'XTREAM.PLAY_FIRST_EPISODE',
            icon: 'play_arrow',
            episode: firstUnwatchedEpisode.episode,
            position: firstUnwatchedEpisode.position,
            startTime: undefined,
            disabled: false,
        });
    }

    const finalEpisode = orderedEpisodes[orderedEpisodes.length - 1];
    if (!finalEpisode) {
        return null;
    }

    return createQuickStartAction({
        kind: SERIES_QUICK_START_ACTION_KIND.Completed,
        labelKey: 'XTREAM.SERIES_WATCHED',
        icon: 'check_circle',
        episode: finalEpisode.episode,
        position: finalEpisode.position,
        startTime: undefined,
        disabled: true,
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

function getOrderedEpisodes(
    request: SeriesQuickStartRequest
): OrderedEpisode[] {
    const orderedEpisodes: OrderedEpisode[] = [];

    Object.entries(request.seasons)
        .sort(([seasonA], [seasonB]) =>
            naturalCollator.compare(seasonA, seasonB)
        )
        .forEach(([, episodes]) => {
            [...episodes].sort(compareEpisodes).forEach((episode) => {
                orderedEpisodes.push({
                    episode,
                    position:
                        request.playbackPositions.get(Number(episode.id)) ??
                        null,
                    order: orderedEpisodes.length,
                });
            });
        });

    return orderedEpisodes;
}

function compareEpisodes(
    episodeA: XtreamSerieEpisode,
    episodeB: XtreamSerieEpisode
): number {
    const episodeNumberDelta =
        Number(episodeA.episode_num) - Number(episodeB.episode_num);

    if (Number.isFinite(episodeNumberDelta) && episodeNumberDelta !== 0) {
        return episodeNumberDelta;
    }

    return naturalCollator.compare(episodeA.title ?? '', episodeB.title ?? '');
}

function compareInProgressPositions(
    episodeA: OrderedEpisode,
    episodeB: OrderedEpisode
): number {
    const timeA = getTimestamp(episodeA.position?.updatedAt);
    const timeB = getTimestamp(episodeB.position?.updatedAt);

    if (timeA !== timeB) {
        return timeA - timeB;
    }

    return episodeA.order - episodeB.order;
}

function getTimestamp(value: string | undefined): number {
    if (!value) {
        return 0;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getEpisodeLabel(episode: XtreamSerieEpisode): string {
    const seasonNumber = getPositiveInteger(episode.season) ?? 1;
    const episodeNumber = getPositiveInteger(episode.episode_num) ?? 1;
    const episodeCode = `S${padEpisodePart(seasonNumber)}E${padEpisodePart(
        episodeNumber
    )}`;
    const title = episode.title.trim();

    return title ? `${episodeCode} · ${title}` : episodeCode;
}

export function getPositiveInteger(value: number): number | null {
    return Number.isInteger(value) && value > 0 ? value : null;
}

export function padEpisodePart(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}
