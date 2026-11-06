import type { UnifiedCollectionItem } from './unified-collection-item.interface';

/** Result identity, distinct from the XMLTV lookup/mapping key. */
export function collectionEpgKey(
    item: Pick<
        UnifiedCollectionItem,
        | 'sourceType'
        | 'playlistId'
        | 'xtreamId'
        | 'stalkerId'
        | 'tvgId'
        | 'name'
    >
): string | null {
    if (item.sourceType === 'm3u') {
        return item.tvgId?.trim() || item.name?.trim() || null;
    }
    const id = item.sourceType === 'xtream' ? item.xtreamId : item.stalkerId;
    const channelId = String(id ?? '').trim();
    return channelId && item.playlistId
        ? JSON.stringify([item.sourceType, item.playlistId, channelId])
        : null;
}
