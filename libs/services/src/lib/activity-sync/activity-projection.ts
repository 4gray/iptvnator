import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type {
    ActivityAddress,
    ActivityResume,
    ActivityState,
} from '@iptvnator/shared/interfaces/activity-sync';

export function projectActivity(
    address: ActivityAddress,
    state: ActivityState,
    alias?: Partial<PlaybackPositionData>
): PlaybackPositionData {
    const content = address.content;
    return {
        ...state.positionMetadata,
        ...(alias
            ? {
                  contentXtreamId: alias.contentXtreamId,
                  contentType: alias.contentType,
                  seriesXtreamId: alias.seriesXtreamId,
                  seasonNumber: alias.seasonNumber,
                  episodeNumber: alias.episodeNumber,
              }
            : {}),
        contentXtreamId:
            alias?.contentXtreamId ??
            state.positionMetadata?.contentXtreamId ??
            Number(content.id),
        contentType: content.kind,
        ...(content.kind === 'episode'
            ? {
                  seriesXtreamId:
                      alias?.seriesXtreamId ??
                      state.positionMetadata?.seriesXtreamId ??
                      Number(content.seriesId),
              }
            : {}),
        positionSeconds: state.resume?.positionSeconds ?? 0,
        ...(state.resume?.durationSeconds
            ? { durationSeconds: state.resume.durationSeconds }
            : {}),
        watched: state.watched,
        updatedAt: state.updatedAt,
        activityTitle: state.positionMetadata?.title,
        playlistId: address.sourceId,
        activityIdentity: content,
    };
}

export function activityIdentityKey(
    content: ActivityAddress['content']
): string {
    // Reuse the canonical serializer without leaking snapshots or key ordering.
    return JSON.stringify(
        content.kind === 'vod'
            ? [content.provider, content.kind, content.id]
            : content.provider === 'xtream'
              ? [content.provider, content.kind, content.seriesId, content.id]
              : [
                    content.provider,
                    content.kind,
                    content.seriesId,
                    content.id,
                    content.mode,
                    content.seasonKey,
                    content.episodeNumber,
                ]
    );
}

export function activityPositionMetadata(position: PlaybackPositionData) {
    return {
        contentXtreamId: position.contentXtreamId,
        ...(position.activityTitle
            ? { title: position.activityTitle.slice(0, 512) }
            : {}),
        ...(position.seriesXtreamId === undefined
            ? {}
            : { seriesXtreamId: position.seriesXtreamId }),
        ...(position.seasonNumber === undefined
            ? {}
            : { seasonNumber: position.seasonNumber }),
        ...(position.episodeNumber === undefined
            ? {}
            : { episodeNumber: position.episodeNumber }),
    };
}

/** Player snapshots use fractional seconds; the protocol stores whole seconds. */
export function activityResume(position: PlaybackPositionData): ActivityResume {
    const duration = Math.floor(position.durationSeconds ?? 0);
    return {
        positionSeconds: Math.max(0, Math.floor(position.positionSeconds)),
        ...(Number.isFinite(duration) && duration > 0
            ? { durationSeconds: duration }
            : {}),
    };
}

/** Exact zero rows mirror a cleared Stalker episode, not a playable resume point. */
export function activityImportResume(
    address: ActivityAddress,
    position: PlaybackPositionData
): ActivityResume | null {
    if (
        address.content.provider === 'stalker' &&
        address.content.kind === 'episode' &&
        position.positionSeconds === 0 &&
        position.durationSeconds === 0
    )
        return null;
    return activityResume(position);
}
