import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import type { StalkerMappedEpisode } from './stalker-series.adapters';

export interface ReconciledStalkerSeriesPositions {
    positionsByTrackingId: Map<number, PlaybackPositionData>;
    legacyPositionByTrackingId: Map<number, PlaybackPositionData>;
}

function matchesMappedCoordinate(
    value: number | undefined,
    mappedValue: number
): boolean {
    return value == null || Number(value) === mappedValue;
}

function isCompatibleLegacyPosition(
    position: PlaybackPositionData,
    episode: XtreamSerieEpisode
): boolean {
    const providerSeason = (episode as StalkerMappedEpisode)
        .providerSeasonNumber;
    const matchesSeason =
        matchesMappedCoordinate(
            position.seasonNumber,
            Number(episode.season)
        ) ||
        (providerSeason !== undefined &&
            matchesMappedCoordinate(position.seasonNumber, providerSeason));
    return (
        matchesSeason &&
        matchesMappedCoordinate(
            position.episodeNumber,
            Number(episode.episode_num)
        )
    );
}

export function reconcileStalkerSeriesPositions(options: {
    seriesXtreamId: number;
    episodesBySeason: Readonly<Record<string, readonly XtreamSerieEpisode[]>>;
    seriesPositions: readonly PlaybackPositionData[];
}): ReconciledStalkerSeriesPositions {
    const positionsByTrackingId = new Map<number, PlaybackPositionData>();
    const legacyPositionByTrackingId = new Map<number, PlaybackPositionData>();
    const indexedPositions = new Map<number, PlaybackPositionData>();

    for (const position of options.seriesPositions) {
        if (
            position.contentType === 'episode' &&
            position.seriesXtreamId === options.seriesXtreamId
        ) {
            indexedPositions.set(position.contentXtreamId, position);
        }
    }

    for (const episodes of Object.values(options.episodesBySeason)) {
        for (const episode of episodes) {
            const trackingId = Number(episode.id);
            if (!Number.isFinite(trackingId)) {
                continue;
            }

            const exactPosition = indexedPositions.get(trackingId);
            if (exactPosition) {
                positionsByTrackingId.set(trackingId, exactPosition);
            }

            const legacyTrackingId = (episode as StalkerMappedEpisode)
                .legacyTrackingId;
            if (legacyTrackingId == null || legacyTrackingId === trackingId) {
                continue;
            }

            const legacyPosition = indexedPositions.get(legacyTrackingId);
            if (
                !legacyPosition ||
                !isCompatibleLegacyPosition(legacyPosition, episode)
            ) {
                continue;
            }

            legacyPositionByTrackingId.set(trackingId, legacyPosition);
            if (!exactPosition) {
                positionsByTrackingId.set(trackingId, {
                    ...legacyPosition,
                    contentXtreamId: trackingId,
                    seriesXtreamId: options.seriesXtreamId,
                    seasonNumber: Number(episode.season),
                    episodeNumber: Number(episode.episode_num),
                });
            }
        }
    }

    return {
        positionsByTrackingId,
        legacyPositionByTrackingId,
    };
}
