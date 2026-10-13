import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import { itemKey } from './server-migration-merge';
import type { EditStep } from './server-user-data-entries';

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
    const value: Record<string, unknown> = { ...server };
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
    return value;
}

/**
 * Applies one local edit (`before` → `after`, as the user made it against
 * an older or empty cache) to the server's current value: list items the
 * edit added or changed are set, items it removed are dropped, everything
 * else the server has stays. Maps work the same by key.
 */
export function applyEdit(
    server: unknown,
    before: unknown,
    after: unknown
): unknown {
    if (after === undefined) {
        return undefined;
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
            return !(was.has(key) && !now.has(key));
        });
        for (const [key, item] of now) {
            if (JSON.stringify(was.get(key)) === JSON.stringify(item)) {
                // Untouched by the edit: the server's state of it wins.
                continue;
            }
            const index = result.findIndex((entry) => itemKey(entry) === key);
            if (index < 0) {
                result.push(item);
            } else {
                result[index] = item;
            }
        }
        return result;
    }
    if (isMap(after) && isMapOrMissing(server) && isMapOrMissing(before)) {
        const result: Record<string, unknown> = { ...(server ?? {}) };
        for (const key of Object.keys(before ?? {})) {
            if (!(key in after)) {
                delete result[key];
            }
        }
        for (const [key, value] of Object.entries(after)) {
            if (JSON.stringify((before ?? {})[key]) !== JSON.stringify(value)) {
                result[key] = value;
            }
        }
        return result;
    }
    return after;
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
    steps: readonly { readonly before: unknown; readonly after: unknown }[]
): unknown {
    let value = server;
    for (const step of steps) {
        value = applyEdit(value, step.before, step.after);
    }
    return value;
}

/** The entries `next` changed against `read`, applied to `current`. */
export function mergeEdits(
    current: Record<string, unknown>,
    read: Record<string, unknown>,
    next: Record<string, unknown>
): Record<string, unknown> {
    const merged = { ...current };
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
 * `undefined` stands for every playlist).
 */
export function withoutDeleted(
    read: ServerUserStateResponse,
    deleted: readonly (string | undefined)[]
): ServerUserStateResponse {
    if (deleted.length === 0) {
        return read;
    }
    const keep = <T>(map: Record<string, T> = {}): Record<string, T> => {
        const kept: Record<string, T> = {};
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
