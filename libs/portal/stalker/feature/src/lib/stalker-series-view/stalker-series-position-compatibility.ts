export { reconcileStalkerSeriesPositions } from '@iptvnator/portal/stalker/data-access';
import type { PortalPlaybackPositions } from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

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
        (!legacyPosition.playlistId || legacyPosition.playlistId === playlistId)
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
