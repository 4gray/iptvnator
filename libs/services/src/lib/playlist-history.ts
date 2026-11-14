import {
    extractStalkerItemId,
    isM3uRecentlyViewedItem,
    normalizeStalkerDate,
    type Playlist,
    type PlaylistRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import { stalkerFavoriteReference } from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    HistoryPlaylistAction,
    HistoryPlaylistBridge,
} from '../history-events';
import { removePortalFavorite } from './playlist-favorites';

function normalizePortalRecentIdentity(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return raw.includes(':') ? raw.split(':')[0] : raw;
}

function getPlaylistRecentIdentity(item: PlaylistRecentlyViewedItem): string {
    if (isM3uRecentlyViewedItem(item))
        return String(item.url ?? item.id ?? '').trim();
    return normalizePortalRecentIdentity(extractStalkerItemId(item ?? {}));
}

function matchesPlaylistRecentIdentity(
    item: PlaylistRecentlyViewedItem,
    expectedIdentity: string | number
): boolean {
    const expectedRaw = String(expectedIdentity ?? '').trim();
    if (!expectedRaw) return false;
    return (
        getPlaylistRecentIdentity(item) ===
        (isM3uRecentlyViewedItem(item)
            ? expectedRaw
            : normalizePortalRecentIdentity(expectedRaw))
    );
}

/**
 * Portal ids repeat across kinds (a live channel and a movie can both be
 * "42"), so a touch only takes over a row of a compatible kind. A row whose
 * kind cannot be told (an older untyped snapshot) still matches by id alone.
 */
function samePortalRecentKind(
    left: PlaylistRecentlyViewedItem,
    right: PlaylistRecentlyViewedItem
): boolean {
    if (isM3uRecentlyViewedItem(left) || isM3uRecentlyViewedItem(right))
        return true;
    const leftKind = stalkerFavoriteReference(left)?.kind;
    const rightKind = stalkerFavoriteReference(right)?.kind;
    return !leftKind || !rightKind || leftKind === rightKind;
}

export function sortedPlaylistHistory(
    playlist: Playlist
): PlaylistRecentlyViewedItem[] {
    const items = playlist?.recentlyViewed;
    if (!Array.isArray(items)) return [];
    return [...items].sort(
        (a, b) =>
            new Date(normalizeStalkerDate(b.added_at ?? '')).getTime() -
            new Date(normalizeStalkerDate(a.added_at ?? '')).getTime()
    );
}

/** Called inside the playlist write queue; history actions load this module on demand. */
export async function mutatePlaylistHistory(
    playlist: Playlist,
    action: HistoryPlaylistAction,
    bridge: HistoryPlaylistBridge,
    persist: (playlist: Playlist) => Promise<Playlist>
): Promise<Playlist> {
    if (bridge.active()) {
        const synced = await bridge.mutate(playlist, action);
        if (synced) return synced;
    }
    let recentlyViewed: PlaylistRecentlyViewedItem[] | undefined;
    switch (action.kind) {
        case 'touch': {
            const nowIso = new Date().toISOString();
            const recentItems = Array.isArray(playlist.recentlyViewed)
                ? (playlist.recentlyViewed as PlaylistRecentlyViewedItem[])
                : [];
            const existingIndex = recentItems.findIndex(
                (recentItem) =>
                    matchesPlaylistRecentIdentity(
                        recentItem,
                        getPlaylistRecentIdentity(action.item)
                    ) && samePortalRecentKind(recentItem, action.item)
            );
            const existingItem =
                existingIndex >= 0 ? recentItems[existingIndex] : null;
            recentlyViewed = [
                {
                    ...(existingItem ?? {}),
                    ...action.item,
                    added_at: nowIso,
                },
                ...recentItems.filter((_, index) => index !== existingIndex),
            ];
            break;
        }
        case 'remove':
            recentlyViewed = (
                playlist.recentlyViewed as PlaylistRecentlyViewedItem[]
            )?.filter(
                (item) =>
                    !action.identities.some((identity) => {
                        if (typeof identity !== 'object')
                            return matchesPlaylistRecentIdentity(
                                item,
                                identity
                            );
                        if (isM3uRecentlyViewedItem(identity))
                            return (
                                isM3uRecentlyViewedItem(item) &&
                                item.url === identity.url
                            );
                        if (isM3uRecentlyViewedItem(item)) return false;
                        return (
                            removePortalFavorite(
                                [item],
                                extractStalkerItemId(identity),
                                identity
                            ).length === 0
                        );
                    })
            );
            break;
        case 'clear':
            recentlyViewed = [];
    }
    return persist({ ...playlist, recentlyViewed });
}
