import { PlaylistMeta } from './playlist-meta.type';
import { PortalRecentItem } from './portal-activity-item.interface';
import {
    extractStalkerItemId,
    extractStalkerItemPoster,
    extractStalkerItemTitle,
    extractStalkerItemType,
    normalizeStalkerDate,
} from './stalker-item.normalizer';
import {
    PlaylistRecentlyViewedItem,
    isM3uRecentlyViewedItem,
} from './playlist-recently-viewed.interface';

interface PlaylistRecentLabels {
    stalker: string;
    m3u: string;
}

function getPlaylistRecentItems(
    playlist: PlaylistMeta
): PlaylistRecentlyViewedItem[] {
    return Array.isArray(playlist.recentlyViewed)
        ? (playlist.recentlyViewed as PlaylistRecentlyViewedItem[])
        : [];
}

function mapStalkerPlaylistRecentItems(
    playlist: PlaylistMeta,
    defaultPlaylistName: string
): PortalRecentItem[] {
    return getPlaylistRecentItems(playlist).reduce<PortalRecentItem[]>(
        (acc, rawItem, index) => {
            if (isM3uRecentlyViewedItem(rawItem)) {
                return acc;
            }

            const item = (rawItem ?? {}) as Record<string, unknown>;
            const id = extractStalkerItemId(item, playlist._id, index);

            acc.push({
                id,
                title: extractStalkerItemTitle(item),
                type: extractStalkerItemType(item),
                playlist_id: playlist._id,
                playlist_name: playlist.title || defaultPlaylistName,
                viewed_at: normalizeStalkerDate(item['added_at']),
                category_id: String(item['category_id'] ?? ''),
                xtream_id: id,
                poster_url: extractStalkerItemPoster(item),
                source: 'stalker',
                stalker_item: rawItem,
            });

            return acc;
        },
        []
    );
}

function mapM3uPlaylistRecentItems(
    playlist: PlaylistMeta,
    defaultPlaylistName: string
): PortalRecentItem[] {
    return getPlaylistRecentItems(playlist).reduce<PortalRecentItem[]>(
        (acc, rawItem) => {
            if (!isM3uRecentlyViewedItem(rawItem)) {
                return acc;
            }

            const channelUrl = rawItem.url.trim();
            if (!channelUrl) {
                return acc;
            }

            acc.push({
                id: rawItem.id || channelUrl,
                title:
                    rawItem.title?.trim() ||
                    rawItem.tvg_name?.trim() ||
                    rawItem.channel_id ||
                    channelUrl,
                type: 'live',
                playlist_id: playlist._id,
                playlist_name: playlist.title || defaultPlaylistName,
                viewed_at: normalizeStalkerDate(rawItem.added_at),
                category_id: rawItem.category_id || 'live',
                xtream_id: channelUrl,
                poster_url: rawItem.poster_url || undefined,
                source: 'm3u',
            });

            return acc;
        },
        []
    );
}

export function buildPlaylistRecentItems(
    playlists: PlaylistMeta[],
    labels: PlaylistRecentLabels
): PortalRecentItem[] {
    return playlists.reduce<PortalRecentItem[]>((acc, playlist) => {
        if (playlist.macAddress) {
            acc.push(
                ...mapStalkerPlaylistRecentItems(playlist, labels.stalker)
            );
            return acc;
        }

        if (!playlist.serverUrl) {
            acc.push(...mapM3uPlaylistRecentItems(playlist, labels.m3u));
        }

        return acc;
    }, []);
}
