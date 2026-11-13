import type { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import type { UnifiedRecentDataService } from '@iptvnator/portal/shared/data-access';
import type { MultiviewPickerResult } from './multiview-picker-context';

/**
 * R10, Q3: a tile the viewer added enters recently viewed like a normal
 * playback start. Deferred under the tile's own session key, the tile's
 * player confirms it once the stream advances, so a tile that never plays
 * is not history (the gate's contract).
 */
export function recordWhenPlaying(
    history: Pick<PlaybackHistoryGate, 'defer'>,
    recent: Pick<UnifiedRecentDataService, 'recordLivePlayback'>,
    { source, item }: MultiviewPickerResult
): void {
    history.defer(
        {
            sourceId: item.playlistId,
            sessionKey: source.playbackSessionKey,
            streamUrls: [source.playback.streamUrl],
        },
        () => void recent.recordLivePlayback(item).catch(() => null)
    );
}
