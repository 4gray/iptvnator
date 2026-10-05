import {
    StalkerContentTypes,
    type StalkerVodSource,
    stalkerWithheldRowKey,
} from '@iptvnator/portal/stalker/data-access';
import type { ParentalLockService } from '@iptvnator/services';
import { ALL_CATEGORIES_WITHHELD } from '@iptvnator/shared/interfaces';

export type StalkerSearchContentType = 'vod' | 'series';

export interface StalkerSearchResponse {
    js?: {
        data?: StalkerVodSource[];
        total_items?: number;
    };
    message?: string;
    status?: number;
}

/** Portals can shift items between pages mid-append — drop duplicate ids. */
export function dedupeSearchResults(
    items: StalkerVodSource[]
): StalkerVodSource[] {
    const seenIds = new Set<string>();
    return items.filter((item) => {
        const id =
            item.id === undefined || item.id === null ? null : String(item.id);
        if (id === null) {
            return true;
        }
        if (seenIds.has(id)) {
            return false;
        }
        seenIds.add(id);
        return true;
    });
}

/**
 * The dedicated search route has no category guard, so it filters the
 * portal's rows itself: a locked genre's title must not reach the grid, its
 * detail or playback through search.
 */
export function resolveSearchWithheldCategoryIds(
    parentalLock: ParentalLockService,
    playlistId: string,
    contentType: StalkerSearchContentType
): ReadonlySet<string> {
    return !parentalLock.active()
        ? new Set<string>()
        : parentalLock.withholdsEverything?.()
          ? ALL_CATEGORIES_WITHHELD
          : new Set(parentalLock.lockedStalkerIds(playlistId, contentType));
}

/**
 * Mirror the catalog request shape: many Ministra portals return an empty
 * list for get_ordered_list without the category/genre/sortby params the STB
 * client always sends. `max_page_items` is a HINT — plenty of portals ignore
 * it and return their own page size, which is why paging cannot rely on it
 * (progress and `total_items` decide hasMore instead).
 */
export function buildStalkerSearchRequestParams(
    contentType: StalkerSearchContentType,
    search: string,
    page: number
): Record<string, string | number> {
    return {
        action: StalkerContentTypes[contentType].getContentAction,
        type: contentType,
        sortby: 'added',
        search,
        p: page,
        max_page_items: 100,
        category: '*',
        ...(contentType === 'vod' ? { genre: '0' } : {}),
    };
}

/**
 * Records the rows of `rawItems` the parental lock withheld (those missing
 * from `keptItems`) into `seenWithheldIds` and returns how many of them were
 * not seen before.
 */
export function recordNewWithheldRows(
    rawItems: StalkerVodSource[],
    keptItems: StalkerVodSource[],
    seenWithheldIds: Set<string>
): number {
    let newWithheldCount = 0;
    if (keptItems.length < rawItems.length) {
        const kept = new Set(keptItems);
        for (const item of rawItems) {
            const id = stalkerWithheldRowKey(item);
            if (!kept.has(item) && !seenWithheldIds.has(id)) {
                seenWithheldIds.add(id);
                newWithheldCount += 1;
            }
        }
    }
    return newWithheldCount;
}

/** Resolves a result row's portal-relative poster against the portal origin. */
export function withAbsoluteScreenshotUri(
    item: StalkerVodSource,
    portalUrl: string
): StalkerVodSource {
    const processed = { ...item };

    if (processed.screenshot_uri) {
        processed.screenshot_uri = makeAbsoluteUrl(
            portalUrl,
            processed.screenshot_uri
        );
    }

    return processed;
}

function makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
    if (!relativePath) return '';
    if (
        relativePath.startsWith('http://') ||
        relativePath.startsWith('https://')
    ) {
        return relativePath;
    }
    try {
        const url = new URL(baseUrl);
        const path = relativePath.startsWith('/')
            ? relativePath
            : `/${relativePath}`;
        return `${url.origin}${path}`;
    } catch {
        return relativePath;
    }
}
