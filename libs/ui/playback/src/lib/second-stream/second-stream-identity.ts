import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

export type SecondStreamIdentity = Pick<
    ResolvedPortalPlayback,
    'catalogIdentity' | 'contentInfo' | 'isLive'
>;

export function pickerStreamIdentity(
    item: UnifiedCollectionItem,
    episodeId?: string
): SecondStreamIdentity {
    const providerId =
        item.sourceType === 'stalker' ? item.stalkerId : item.xtreamId;
    if (item.contentType === 'live') {
        const channelId =
            item.sourceType === 'm3u' ? item.channelId : providerId;
        return channelId == null
            ? {}
            : {
                  catalogIdentity: {
                      playlistId: item.playlistId,
                      type: 'live',
                      id: channelId,
                  },
              };
    }

    if (item.contentType === 'series' && episodeId === undefined) return {};
    const id = String(episodeId ?? providerId ?? '').trim();
    if (!id) return {};
    if (!Number.isFinite(Number(id))) {
        return item.contentType === 'movie'
            ? {
                  catalogIdentity: {
                      playlistId: item.playlistId,
                      type: 'vod',
                      id,
                  },
              }
            : {};
    }
    return {
        contentInfo: {
            playlistId: item.playlistId,
            contentType: episodeId === undefined ? 'vod' : 'episode',
            contentXtreamId: Number(id),
        },
    };
}

export function sameStreamIdentity(
    left: SecondStreamIdentity | null | undefined,
    right: SecondStreamIdentity
): boolean {
    if (!left) return false;
    const a = left.catalogIdentity;
    const b = right.catalogIdentity;
    if (a && b) {
        const id = String(a.id).trim();
        return (
            Boolean(id) &&
            a.playlistId === b.playlistId &&
            a.type === b.type &&
            id === String(b.id).trim()
        );
    }

    const x = left.contentInfo;
    const y = right.contentInfo;
    return Boolean(
        !left.isLive &&
        !right.isLive &&
        x &&
        y &&
        x.playlistId === y.playlistId &&
        x.contentType === y.contentType &&
        x.contentXtreamId === y.contentXtreamId
    );
}
