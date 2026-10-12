import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';

/**
 * User-data writes the server has not confirmed, kept in `localStorage`
 * per page load: a failed write, or a page-hide write whose answer the page
 * did not live to see, is sent again after a reload (by the same tab) or
 * after the tab closed (by another, see `orphanedPages`), instead of being
 * replaced by the server's older value.
 */
export const UNSENT_WRITES_KEY = 'iptvnator-server:unsent-writes';
/** Which server database the cached user data belongs to. */
export const CACHE_OWNER_KEY = 'iptvnator-server:cache-owner';
/** The tab's current page load, in the tab's own storage. */
export const PAGE_KEY = 'iptvnator-server:page';

const writesKey = (instanceId: string, page: string) =>
    `${UNSENT_WRITES_KEY}:${instanceId}:${page}`;
/**
 * Which entries each page load has not had confirmed yet, so a re-read in
 * one tab keeps the cache values another tab is still sending. A live tab
 * renews its record; one older than `UNCONFIRMED_TTL_MS` belongs to a tab
 * that is gone. The records also list whose saved writes exist.
 */
export const UNCONFIRMED_KEY = 'iptvnator-server:unconfirmed';
export const UNCONFIRMED_TTL_MS = 10 * 60 * 1000;
const unconfirmedKey = (instanceId: string) =>
    `${UNCONFIRMED_KEY}:${instanceId}`;

/** Edits made before the first read of a visit, kept as before → after. */
export const DEFERRED_EDITS_KEY = 'iptvnator-server:deferred-edits';
const deferredKey = (instanceId: string, page: string) =>
    `${DEFERRED_EDITS_KEY}:${instanceId}:${page}`;

/**
 * Another database behind this address (a new volume, another backend):
 * its cache and unsent writes belong to the old one and must not be sent
 * to or shown for this one.
 */
export function claimCache(local: UserDataStorage, instanceId: string): void {
    try {
        const owner = local.getItem(CACHE_OWNER_KEY);
        if (owner === instanceId) {
            return;
        }
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            local.removeItem(`iptvnator-server:${namespace}`);
        }
        if (owner) {
            for (const page of Object.keys(readRegistry(local, owner))) {
                local.removeItem(writesKey(owner, page));
                local.removeItem(deferredKey(owner, page));
            }
            local.removeItem(unconfirmedKey(owner));
        }
        local.setItem(CACHE_OWNER_KEY, instanceId);
    } catch {
        // Storage unavailable: nothing cached to mix up.
    }
}

/** Saved edits: JSON drops an undefined side, which reads back as such. */
type Steps = readonly { readonly before: unknown; readonly after: unknown }[];

export interface UnsentWrite {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
    /** The server version it is based on (see `PendingEntry.tag`). */
    readonly tag?: string | null;
    /** The edits since that version (see `PendingEntry.steps`). */
    readonly steps: Steps;
}

interface StoredWrite {
    readonly namespace: string;
    readonly playlistId: string;
    readonly value?: unknown;
    readonly remove?: true;
    readonly tag?: string | null;
    readonly steps?: unknown;
}

function readSteps(stored: unknown): Steps {
    return Array.isArray(stored)
        ? stored
              .filter((step) => step && typeof step === 'object')
              .map((step: { before?: unknown; after?: unknown }) => ({
                  before: step.before,
                  after: step.after,
              }))
        : [];
}

const saveSteps = (steps: Steps) =>
    steps.map(({ before, after }) => ({ before, after }));

/**
 * Records `page` as the tab's current page load and returns the one
 * before it: a reload, whose saved writes this page takes over.
 */
export function swapPage(
    tabStore: UserDataStorage,
    instanceId: string,
    page: string
): string | null {
    try {
        const previous = tabStore.getItem(`${PAGE_KEY}:${instanceId}`);
        tabStore.setItem(`${PAGE_KEY}:${instanceId}`, page);
        return previous;
    } catch {
        return null;
    }
}

/** Page loads whose record went stale: closed tabs nobody sends for. */
export function orphanedPages(
    local: UserDataStorage,
    instanceId: string,
    page: string,
    now = Date.now()
): string[] {
    return Object.entries(readRegistry(local, instanceId))
        .filter(
            ([owner, record]) =>
                owner !== page &&
                !(now - Number(record?.at) < UNCONFIRMED_TTL_MS)
        )
        .map(([owner]) => owner);
}

/** Forgets a page load's saved writes, early edits and record. */
export function removePage(
    local: UserDataStorage,
    instanceId: string,
    page: string
): void {
    try {
        local.removeItem(writesKey(instanceId, page));
        local.removeItem(deferredKey(instanceId, page));
    } catch {
        // Storage unavailable: nothing was saved there either.
    }
    markUnconfirmed(local, instanceId, page, []);
}

export function readUnsentWrites(
    local: UserDataStorage,
    instanceId: string,
    page: string
): UnsentWrite[] {
    let stored: unknown;
    try {
        stored = JSON.parse(local.getItem(writesKey(instanceId, page)) ?? '[]');
    } catch {
        return [];
    }
    const writes: UnsentWrite[] = [];
    for (const write of Array.isArray(stored)
        ? (stored as StoredWrite[])
        : []) {
        if (
            write &&
            isServerUserStateNamespace(write.namespace) &&
            typeof write.playlistId === 'string'
        ) {
            writes.push({
                namespace: write.namespace,
                playlistId: write.playlistId,
                value: write.remove ? undefined : write.value,
                tag: write.tag,
                steps: readSteps(write.steps),
            });
        }
    }
    return writes;
}

export function saveUnsentWrites(
    local: UserDataStorage,
    instanceId: string,
    page: string,
    writes: readonly UnsentWrite[]
): boolean {
    try {
        if (writes.length === 0) {
            local.removeItem(writesKey(instanceId, page));
            return true;
        }
        const stored: StoredWrite[] = writes.map(
            ({ namespace, playlistId, value, tag, steps }) => ({
                namespace,
                playlistId,
                ...(value === undefined ? { remove: true } : { value }),
                ...(tag === undefined ? {} : { tag }),
                steps: saveSteps(steps),
            })
        );
        local.setItem(writesKey(instanceId, page), JSON.stringify(stored));
        return true;
    } catch {
        // Storage unavailable or full: the queue stays in memory only.
        return false;
    }
}

/** One write per entry, the newest by edit number. */
export function newestWrites<T extends UnsentWrite & { readonly edit: number }>(
    writes: readonly T[]
): T[] {
    const newest = new Map<string, T>();
    for (const write of writes) {
        const key = `${write.namespace}|${write.playlistId}`;
        const known = newest.get(key);
        if (!known || write.edit > known.edit) {
            newest.set(key, write);
        }
    }
    return [...newest.values()];
}

export interface SavedDeferredEdit {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    readonly steps: Steps;
}

export function readDeferredEdits(
    local: UserDataStorage,
    instanceId: string,
    page: string
): SavedDeferredEdit[] {
    let stored: unknown;
    try {
        stored = JSON.parse(
            local.getItem(deferredKey(instanceId, page)) ?? '[]'
        );
    } catch {
        return [];
    }
    const edits: SavedDeferredEdit[] = [];
    for (const edit of Array.isArray(stored)
        ? (stored as Record<string, unknown>[])
        : []) {
        const namespace = edit?.['namespace'];
        const playlistId = edit?.['playlistId'];
        if (
            typeof namespace === 'string' &&
            isServerUserStateNamespace(namespace) &&
            typeof playlistId === 'string'
        ) {
            edits.push({
                namespace,
                playlistId,
                steps: readSteps(edit['steps']),
            });
        }
    }
    return edits;
}

export function saveDeferredEdits(
    local: UserDataStorage,
    instanceId: string,
    page: string,
    edits: readonly SavedDeferredEdit[]
): boolean {
    try {
        if (edits.length === 0) {
            local.removeItem(deferredKey(instanceId, page));
            return true;
        }
        local.setItem(
            deferredKey(instanceId, page),
            JSON.stringify(
                edits.map((edit) => ({
                    namespace: edit.namespace,
                    playlistId: edit.playlistId,
                    steps: saveSteps(edit.steps),
                }))
            )
        );
        return true;
    } catch {
        // Storage unavailable or full: the edits stay in memory only.
        return false;
    }
}

type UnconfirmedRegistry = Record<string, { at: number; keys: string[] }>;

function readRegistry(
    local: UserDataStorage,
    instanceId: string
): UnconfirmedRegistry {
    try {
        const parsed: unknown = JSON.parse(
            local.getItem(unconfirmedKey(instanceId)) ?? '{}'
        );
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as UnconfirmedRegistry)
            : {};
    } catch {
        return {};
    }
}

/** Replaces only this tab's record. */
export function markUnconfirmed(
    local: UserDataStorage,
    instanceId: string,
    tabId: string,
    keys: readonly string[],
    now = Date.now()
): void {
    const registry = readRegistry(local, instanceId);
    if (keys.length === 0) {
        if (!(tabId in registry)) {
            return;
        }
        delete registry[tabId];
    } else {
        registry[tabId] = { at: now, keys: [...keys] };
    }
    try {
        local.setItem(unconfirmedKey(instanceId), JSON.stringify(registry));
    } catch {
        // Storage full: re-reads in other tabs lose this protection only.
    }
}

/** Entry keys other live tabs have not had confirmed yet. */
export function othersUnconfirmed(
    local: UserDataStorage,
    instanceId: string,
    tabId: string,
    now = Date.now()
): Set<string> {
    const keys = new Set<string>();
    for (const [owner, record] of Object.entries(
        readRegistry(local, instanceId)
    )) {
        if (
            owner !== tabId &&
            Array.isArray(record?.keys) &&
            now - Number(record.at) < UNCONFIRMED_TTL_MS
        ) {
            for (const key of record.keys) {
                keys.add(String(key));
            }
        }
    }
    return keys;
}
