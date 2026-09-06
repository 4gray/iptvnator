import type { StalkerMappedEpisode } from '@iptvnator/portal/stalker/data-access';
import type { PortalPlaybackPositions } from '@iptvnator/portal/shared/util';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';

export interface ReconciledStalkerSeriesPositions {
    positionsByTrackingId: Map<number, PlaybackPositionData>;
    legacyPositionByTrackingId: Map<number, PlaybackPositionData>;
}

export class StalkerSeriesPositionPartialSaveError extends Error {
    readonly cause: unknown;
    readonly scopedPositionSaved = true as const;

    constructor(cause: unknown) {
        super(
            'Scoped Stalker series position was saved, but legacy cleanup failed'
        );
        this.name = 'StalkerSeriesPositionPartialSaveError';
        this.cause = cause;
    }
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
    episodesBySeason: Readonly<
        Record<string, readonly XtreamSerieEpisode[]>
    >;
    seriesPositions: readonly PlaybackPositionData[];
}): ReconciledStalkerSeriesPositions {
    const positionsByTrackingId = new Map<number, PlaybackPositionData>();
    const legacyPositionByTrackingId = new Map<
        number,
        PlaybackPositionData
    >();
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
            if (
                legacyTrackingId == null ||
                legacyTrackingId === trackingId
            ) {
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

function ownsLegacyPosition(
    playlistId: string,
    position: PlaybackPositionData,
    legacyPosition: PlaybackPositionData | undefined
): legacyPosition is PlaybackPositionData {
    return (
        position.contentType === 'episode' &&
        legacyPosition?.contentType === 'episode' &&
        position.contentXtreamId !== legacyPosition.contentXtreamId &&
        position.seriesXtreamId != null &&
        legacyPosition.seriesXtreamId != null &&
        position.seriesXtreamId === legacyPosition.seriesXtreamId &&
        (!position.playlistId || position.playlistId === playlistId) &&
        (!legacyPosition.playlistId ||
            legacyPosition.playlistId === playlistId)
    );
}

export async function saveStalkerSeriesPosition(options: {
    repository: Pick<
        PortalPlaybackPositions,
        'savePlaybackPosition' | 'clearPlaybackPosition'
    >;
    playlistId: string;
    position: PlaybackPositionData;
    legacyPosition?: PlaybackPositionData;
}): Promise<boolean> {
    await options.repository.savePlaybackPosition(
        options.playlistId,
        options.position
    );

    if (
        !ownsLegacyPosition(
            options.playlistId,
            options.position,
            options.legacyPosition
        )
    ) {
        return false;
    }

    try {
        await options.repository.clearPlaybackPosition(
            options.playlistId,
            options.legacyPosition.contentXtreamId,
            options.legacyPosition.contentType
        );
    } catch (cause) {
        throw new StalkerSeriesPositionPartialSaveError(cause);
    }
    return true;
}

export async function clearStalkerSeriesPosition(options: {
    repository: Pick<PortalPlaybackPositions, 'clearPlaybackPosition'>;
    playlistId: string;
    position: PlaybackPositionData;
    legacyPosition?: PlaybackPositionData;
}): Promise<boolean> {
    if (
        ownsLegacyPosition(
            options.playlistId,
            options.position,
            options.legacyPosition
        )
    ) {
        await options.repository.clearPlaybackPosition(
            options.playlistId,
            options.legacyPosition.contentXtreamId,
            options.legacyPosition.contentType
        );
        await options.repository.clearPlaybackPosition(
            options.playlistId,
            options.position.contentXtreamId,
            options.position.contentType
        );
        return true;
    }

    await options.repository.clearPlaybackPosition(
        options.playlistId,
        options.position.contentXtreamId,
        options.position.contentType
    );
    return false;
}
