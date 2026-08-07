import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

export function createUnifiedLivePlaybackSessionKey(
    item: UnifiedCollectionItem | null
): string {
    const sourceId = item?.playlistId.trim() ?? '';
    const contentId = item ? getUnifiedLiveContentId(item) : '';
    return sourceId && contentId
        ? createPlaybackSessionKey({ kind: 'live', sourceId, contentId })
        : '';
}

function getUnifiedLiveContentId(item: UnifiedCollectionItem): string {
    switch (item.sourceType) {
        case 'm3u':
            return item.channelId?.trim() || item.m3uChannel?.id?.trim() || '';
        case 'xtream':
            return item.xtreamId == null ? '' : String(item.xtreamId);
        case 'stalker':
            return item.stalkerId == null ? '' : String(item.stalkerId).trim();
    }
}
