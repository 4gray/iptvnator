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
    // Stalker ids repeat across content types; the category tells them apart.
    const category = item['category_id'];
    const scope =
        typeof category === 'string' || typeof category === 'number'
            ? `|category:${category}`
            : '';
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
 * M3U favorites name channels by stream URL (older ones by channel id),
 * and every import gives channels new random ids. A browser channel id is
 * translated to the server channel with the same URL; URLs and anything
 * the server cannot resolve are kept as they are, never dropped. M3U
 * history entries get the server's channel id; portal items pass through.
 */
export function remapChannelReferences<T>(
    references: readonly T[],
    browserChannels: readonly ChannelRef[],
    serverChannels: readonly ChannelRef[]
): T[] {
    const urlByBrowserId = new Map<unknown, unknown>(
        browserChannels.map((channel) => [channel.id, channel.url])
    );
    const serverIds = new Set(serverChannels.map((channel) => channel.id));
    const idByUrl = new Map<unknown, unknown>(
        serverChannels.map((channel) => [channel.url, channel.id])
    );
    return references.map((reference) => {
        if (typeof reference === 'string') {
            if (serverIds.has(reference) || idByUrl.has(reference)) {
                return reference;
            }
            const id = idByUrl.get(urlByBrowserId.get(reference));
            return (typeof id === 'string' ? id : reference) as T;
        }
        if (
            isPlainObject(reference) &&
            reference['source'] === 'm3u' &&
            typeof idByUrl.get(reference['url']) === 'string'
        ) {
            return { ...reference, id: idByUrl.get(reference['url']) } as T;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
