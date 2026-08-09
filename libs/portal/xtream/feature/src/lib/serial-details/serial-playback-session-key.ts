import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import type { SeriesPlaybackEpisodeState } from '@iptvnator/ui/playback';

export function createSerialPlaybackSessionKey(
    sourceId: string | undefined,
    seriesId: number | string | undefined,
    episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null
): string {
    const normalizedSeriesId = Number(seriesId);
    if (
        !sourceId ||
        !Number.isSafeInteger(normalizedSeriesId) ||
        normalizedSeriesId <= 0 ||
        !episodeState
    ) {
        return '';
    }

    return createPlaybackSessionKey({
        kind: 'episode',
        sourceId,
        contentId: episodeState.episode.id,
        seriesId: normalizedSeriesId,
        seasonNumber: episodeState.seasonNumber,
        episodeNumber: episodeState.episodeNumber,
    });
}
