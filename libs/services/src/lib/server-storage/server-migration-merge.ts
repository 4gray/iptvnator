import { isStalkerSeriesFlag } from '@iptvnator/shared/interfaces';

/**
 * How the move to the server combines user data that two places hold for
 * one playlist: the server's value comes first and wins, the browser only
 * adds. Lists are unioned, maps keep the first value of each key.
 */
export function combineUserData(values: readonly unknown[]): unknown {
    const present = values.filter((value) => value !== undefined);
    if (present.length === 0) {
        return undefined;
    }
    if (present.every(Array.isArray)) {
        return unionItems(...(present as unknown[][]));
    }
    if (present.every(isPlainObject)) {
        const merged: Record<string, unknown> = {};
        for (const value of present as Record<string, unknown>[]) {
            for (const [key, entry] of Object.entries(value)) {
                if (!(key in merged)) {
                    merged[key] = entry;
                }
            }
        }
        return merged;
    }
    return present[0];
}

/** Items in order of first appearance, without duplicates. */
export function unionItems<T>(...lists: readonly (readonly T[])[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const list of lists) {
        for (const item of list) {
            const key = itemKey(item);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(item);
            }
        }
    }
    return result;
}

/**
 * Content ids or URLs identify favorites and history entries; a playback
 * position is identified by its content type and Xtream id.
 */
export function itemKey(item: unknown): string {
    if (!isPlainObject(item)) {
        return `value:${JSON.stringify(item)}`;
    }
    if (
        typeof item['contentType'] === 'string' &&
        (typeof item['contentXtreamId'] === 'number' ||
            typeof item['contentXtreamId'] === 'string')
    ) {
        return `position:${item['contentType']}:${item['contentXtreamId']}`;
    }
    // Stalker ids repeat across content types; the category tells them
    // apart, and the series flag where a provider category holds both.
    const category = item['category_id'];
    const scope =
        (typeof category === 'string' || typeof category === 'number'
            ? `|category:${category}`
            : '') + (isStalkerSeriesFlag(item['is_series']) ? '|series' : '');
    for (const field of ['id', 'stream_id', 'series_id', 'movie_id', 'url']) {
        const value = item[field];
        if (typeof value === 'string' || typeof value === 'number') {
            return `${field}:${value}${scope}`;
        }
    }
    return `json:${JSON.stringify(item)}`;
}

interface ChannelRef {
    readonly id?: unknown;
    readonly url?: unknown;
}

/**
 * M3U favorites and history as the app reads them, moved to the server's
 * copy of a playlist. Favorites name channels by stream URL; older ones by
 * a channel id that every import makes up anew, which becomes that
 * channel's URL here (`ownChannels`: the playlist the favorite came from).
 * History entries keep their URL id and get the server's channel id as
 * `channel_id`. Anything else passes through, never dropped.
 */
export function remapChannelReferences<T>(
    references: readonly T[],
    ownChannels: readonly ChannelRef[],
    serverChannels: readonly ChannelRef[]
): T[] {
    const urlById = new Map<unknown, unknown>(
        ownChannels.map((channel) => [channel.id, channel.url])
    );
    const idByUrl = new Map<unknown, unknown>(
        serverChannels.map((channel) => [channel.url, channel.id])
    );
    return references.map((reference) => {
        if (typeof reference === 'string') {
            const url = urlById.get(reference);
            return (typeof url === 'string' ? url : reference) as T;
        }
        if (isPlainObject(reference) && reference['source'] === 'm3u') {
            const channelId = idByUrl.get(reference['url']);
            return (
                typeof channelId === 'string'
                    ? { ...reference, channel_id: channelId }
                    : reference
            ) as T;
        }
        return reference;
    });
}

/**
 * A browser value moved under another playlist id: list items that name
 * their playlist (playback positions do) name the server's instead.
 */
export function retargetUserData(
    value: unknown,
    browserId: string,
    serverId: string
): unknown {
    if (browserId === serverId || !Array.isArray(value)) {
        return value;
    }
    return value.map((item) =>
        isPlainObject(item) && item['playlistId'] === browserId
            ? { ...item, playlistId: serverId }
            : item
    );
}

/**
 * Recently viewed items as the app keeps them: newest first, since it cuts
 * the list at its limit from the end, and one per item, its newest view
 * with that view's artwork. Undated items follow the dated ones in order.
 */
export function combineRecentViews(values: readonly unknown[]): unknown {
    const present = values.filter((value) => value !== undefined);
    if (present.length === 0 || !present.every(Array.isArray)) {
        return combineUserData(values);
    }
    return unionItems(
        newestViewsFirst(([] as unknown[]).concat(...(present as unknown[][])))
    );
}

/**
 * Recently viewed items newest first, by `viewedAt` (Xtream maps) or
 * `added_at` (playlist documents: an ISO date or epoch milliseconds);
 * stable, undated items after dated ones.
 */
export function newestViewsFirst<T>(
    items: readonly T[],
    field: 'viewedAt' | 'added_at' = 'viewedAt'
): T[] {
    const viewedAt = (item: unknown) => {
        const value = isPlainObject(item) ? item[field] : undefined;
        const at =
            typeof value === 'number' ? value : Date.parse(String(value));
        return Number.isNaN(at) ? 0 : at;
    };
    return [...items].sort((a, b) => viewedAt(b) - viewedAt(a));
}

/** Whether a list holds recently viewed items, which stay newest first. */
export function isViewHistory(items: readonly unknown[]): boolean {
    return items.some((item) => isPlainObject(item) && 'viewedAt' in item);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
