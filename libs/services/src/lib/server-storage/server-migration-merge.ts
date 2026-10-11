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

/** Content ids or URLs identify favorites and history entries. */
function itemKey(item: unknown): string {
    if (!isPlainObject(item)) {
        return `value:${JSON.stringify(item)}`;
    }
    for (const field of ['id', 'stream_id', 'series_id', 'movie_id', 'url']) {
        const value = item[field];
        if (typeof value === 'string' || typeof value === 'number') {
            return `${field}:${value}`;
        }
    }
    return `json:${JSON.stringify(item)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
