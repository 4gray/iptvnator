import { XTREAM_RESTORE_RECEIPTS } from '../xtream-user-data-keys';
import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import {
    isViewHistory,
    itemKey,
    newestViewsFirst,
} from './server-migration-merge';
import { type EditStep, idMap } from './server-user-data-entries';

/** Edits made before the first read, applied once the server's value is known. */
export interface DeferredEdit {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    readonly steps: readonly EditStep[];
}

/**
 * One namespace's cache after a read: the server's map, except entries the
 * server does not have yet (`keepCached`, from the cache) and edits made
 * before the first read (applied to the server's value).
 */
export function refreshedNamespace(
    server: Readonly<Record<string, unknown>>,
    cached: Readonly<Record<string, unknown>>,
    keepCached: ReadonlySet<string>,
    deferred: readonly DeferredEdit[],
    /** What an early edit was made on; the server's entry by default. */
    baseOf: (playlistId: string) => unknown = (playlistId) => server[playlistId]
): Record<string, unknown> {
    const value = idMap(server);
    for (const playlistId of keepCached) {
        if (playlistId in cached) {
            value[playlistId] = cached[playlistId];
        } else {
            delete value[playlistId];
        }
    }
    for (const edit of deferred) {
        const merged = replaySteps(baseOf(edit.playlistId), edit.steps);
        if (merged === undefined) {
            delete value[edit.playlistId];
        } else {
            value[edit.playlistId] = merged;
        }
    }
    if (XTREAM_RESTORE_RECEIPTS in cached)
        value[XTREAM_RESTORE_RECEIPTS] = cached[XTREAM_RESTORE_RECEIPTS];
    return value;
}

/**
 * Applies one local edit (`before` → `after`, as the user made it against
 * an older or empty cache) to the server's current value: list items the
 * edit added or changed are set, items it removed are dropped, everything
 * else the server has stays. Maps work the same by key. A `yields` edit
 * (a gone page's) changes only what is still as it was `before`.
 */
export function applyEdit(
    server: unknown,
    before: unknown,
    after: unknown,
    yields = false
): unknown {
    const free = (now: unknown, was: unknown) => !yields || same(now, was);
    if (after === undefined) {
        return free(server, before) ? undefined : server;
    }
    if (
        Array.isArray(after) &&
        isListOrMissing(server) &&
        isListOrMissing(before)
    ) {
        const was = new Map(
            (before ?? []).map((item) => [itemKey(item), item])
        );
        const now = new Map(after.map((item) => [itemKey(item), item]));
        const result = (server ?? []).filter((item) => {
            const key = itemKey(item);
            return !(was.has(key) && !now.has(key) && free(item, was.get(key)));
        });
        for (const [key, item] of now) {
            // Untouched by the edit: the server's state of it wins.
            if (same(was.get(key), item)) {
                continue;
            }
            const index = result.findIndex((entry) => itemKey(entry) === key);
            if (!free(index < 0 ? undefined : result[index], was.get(key))) {
                continue;
            }
            if (index < 0) {
                result.push(item);
            } else {
                result[index] = item;
            }
        }
        // History is cut at its limit from the end: a replayed view must
        // not land behind older ones.
        return isViewHistory(result) ? newestViewsFirst(result) : result;
    }
    if (isMap(after) && isMapOrMissing(server) && isMapOrMissing(before)) {
        const was = before ?? {};
        const result: Record<string, unknown> = { ...(server ?? {}) };
        for (const key of Object.keys(was)) {
            if (!(key in after) && free(result[key], was[key])) {
                delete result[key];
            }
        }
        for (const [key, value] of Object.entries(after)) {
            if (!same(was[key], value) && free(result[key], was[key])) {
                result[key] = value;
            }
        }
        return result;
    }
    return free(server, before) ? after : server;
}

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function isMap(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMapOrMissing(
    value: unknown
): value is Record<string, unknown> | undefined {
    return value === undefined || isMap(value);
}

function isListOrMissing(value: unknown): value is unknown[] | undefined {
    return value === undefined || Array.isArray(value);
}

/** Edits replayed on `server` in order. */
export function replaySteps(
    server: unknown,
    steps: readonly EditStep[]
): unknown {
    let value = server;
    for (const step of steps) {
        value = applyEdit(value, step.before, step.after, step.yields);
    }
    return value;
}

/** The playlist entries `next` changed against `previous`; removed ones as `undefined`. */
export function changedEntries(
    previous: Readonly<Record<string, unknown>>,
    next: Readonly<Record<string, unknown>>
): [string, unknown][] {
    const changed: [string, unknown][] = [];
    for (const [playlistId, value] of Object.entries(next)) {
        if (playlistId === XTREAM_RESTORE_RECEIPTS) continue;
        if (JSON.stringify(previous[playlistId]) !== JSON.stringify(value)) {
            changed.push([playlistId, value]);
        }
    }
    for (const playlistId of Object.keys(previous)) {
        if (playlistId === XTREAM_RESTORE_RECEIPTS) continue;
        if (!(playlistId in next)) {
            changed.push([playlistId, undefined]);
        }
    }
    return changed;
}

/** The entries `next` changed against `read`, applied to `current`. */
export function mergeEdits(
    current: Record<string, unknown>,
    read: Record<string, unknown>,
    next: Record<string, unknown>
): Record<string, unknown> {
    const merged = idMap(current);
    for (const id of new Set([...Object.keys(read), ...Object.keys(next)])) {
        if (JSON.stringify(read[id]) !== JSON.stringify(next[id])) {
            const value = applyEdit(current[id], read[id], next[id]);
            if (value === undefined) {
                delete merged[id];
            } else {
                merged[id] = value;
            }
        }
    }
    return merged;
}

/**
 * A server read without the playlists deleted after it was sent (an id of
 * `undefined` stands for every playlist), its maps as `idMap`s.
 */
export function withoutDeleted(
    read: ServerUserStateResponse,
    deleted: readonly (string | undefined)[]
): ServerUserStateResponse {
    const keep = <T>(map: Record<string, T> = {}): Record<string, T> => {
        const kept = idMap<T>();
        for (const [id, value] of Object.entries(map)) {
            if (!deleted.some((gone) => gone === undefined || gone === id)) {
                kept[id] = value;
            }
        }
        return kept;
    };
    const entries = {} as Record<string, Record<string, unknown>>;
    const tags = {} as Record<string, Record<string, string>>;
    for (const namespace of SERVER_USER_STATE_NAMESPACES) {
        entries[namespace] = keep(read.entries[namespace]);
        tags[namespace] = keep(read.tags?.[namespace]) as Record<
            string,
            string
        >;
    }
    return {
        entries: entries as ServerUserStateResponse['entries'],
        ...(read.tags ? { tags: tags as ServerUserStateResponse['tags'] } : {}),
    };
}
