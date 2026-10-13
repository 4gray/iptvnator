import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import { cacheKey } from './server-user-data-cache';

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
 * one tab keeps the cache values another tab is still sending. Each page
 * load writes only its own key, so tabs never overwrite each other's
 * record. A live tab renews it; one older than `UNCONFIRMED_TTL_MS`
 * belongs to a tab that is gone.
 */
export const UNCONFIRMED_KEY = 'iptvnator-server:unconfirmed';
export const UNCONFIRMED_TTL_MS = 10 * 60 * 1000;
const recordKey = (instanceId: string, page: string) =>
    `${UNCONFIRMED_KEY}:${instanceId}:${page}`;

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
            // Also the unscoped keys of earlier builds.
            local.removeItem(`iptvnator-server:${namespace}`);
            if (owner) {
                local.removeItem(cacheKey(owner, namespace));
            }
        }
        if (owner) {
            for (const prefix of PAGE_PREFIXES) {
                for (const page of pagesUnder(local, `${prefix}:${owner}:`)) {
                    local.removeItem(`${prefix}:${owner}:${page}`);
                }
            }
        }
        local.setItem(CACHE_OWNER_KEY, instanceId);
    } catch {
        // Storage unavailable: nothing cached to mix up.
    }
}

/** Saved edits: JSON drops an undefined side, which reads back as such. */
type Steps = readonly {
    readonly before: unknown;
    readonly after: unknown;
    readonly yields?: true;
}[];

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
              .map(
                  (step: {
                      before?: unknown;
                      after?: unknown;
                      yields?: unknown;
                  }) => ({
                      before: step.before,
                      after: step.after,
                      ...(step.yields === true
                          ? { yields: true as const }
                          : {}),
                  })
              )
        : [];
}

const saveSteps = (steps: Steps) =>
    steps.map(({ before, after, yields }) => ({ before, after, yields }));

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

/**
 * Page loads whose record went stale: closed tabs nobody sends for. Saved
 * writes without any record are left alone: a tab that could save them but
 * not its record may still run, and only its own reload takes them over.
 */
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
                !(now - Number(record.at) < UNCONFIRMED_TTL_MS)
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

/** `closed`: the page unloaded (not into the back-forward cache). */
interface PageRecord {
    readonly at: number;
    readonly keys: string[];
    readonly closed?: boolean;
}

/** Key prefixes of what a page load keeps, each followed by `:<instance>:<page>`. */
const PAGE_PREFIXES = [UNCONFIRMED_KEY, UNSENT_WRITES_KEY, DEFERRED_EDITS_KEY];

/** The page loads of keys that start with `prefix`. */
function pagesUnder(local: UserDataStorage, prefix: string): string[] {
    try {
        return (local.keys?.() ?? [])
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(prefix.length));
    } catch {
        return [];
    }
}

function readRecord(
    local: UserDataStorage,
    instanceId: string,
    page: string
): PageRecord | null {
    try {
        const parsed = JSON.parse(
            local.getItem(recordKey(instanceId, page)) ?? 'null'
        ) as PageRecord | null;
        return parsed && Array.isArray(parsed.keys) ? parsed : null;
    } catch {
        return null;
    }
}

function readRegistry(
    local: UserDataStorage,
    instanceId: string
): Record<string, PageRecord> {
    const registry: Record<string, PageRecord> = Object.create(null);
    for (const page of pagesUnder(local, `${UNCONFIRMED_KEY}:${instanceId}:`)) {
        const record = readRecord(local, instanceId, page);
        if (record) {
            registry[page] = record;
        }
    }
    return registry;
}

/** Marks a page load's record as unloaded: a reload may take it over. */
export function markClosed(
    local: UserDataStorage,
    instanceId: string,
    page: string
): void {
    const record = readRecord(local, instanceId, page);
    if (!record) {
        return;
    }
    try {
        local.setItem(
            recordKey(instanceId, page),
            JSON.stringify({ ...record, closed: true })
        );
    } catch {
        // Storage full: the record goes stale instead.
    }
}

/**
 * Whether a page load still runs: it has a fresh record and did not
 * unload. A duplicated tab copies the tab's page load but must not take
 * over its saved writes.
 */
export function pageIsLive(
    local: UserDataStorage,
    instanceId: string,
    page: string,
    now = Date.now()
): boolean {
    const record = readRecord(local, instanceId, page);
    return (
        !!record &&
        !record.closed &&
        now - Number(record.at) < UNCONFIRMED_TTL_MS
    );
}

/**
 * Writes only this page load's record (none without keys); true when one
 * now stands for it.
 */
export function markUnconfirmed(
    local: UserDataStorage,
    instanceId: string,
    tabId: string,
    keys: readonly string[],
    now = Date.now()
): boolean {
    try {
        if (keys.length === 0) {
            local.removeItem(recordKey(instanceId, tabId));
            return false;
        }
        local.setItem(
            recordKey(instanceId, tabId),
            JSON.stringify({ at: now, keys: [...keys] })
        );
        return true;
    } catch {
        // Storage full: re-reads in other tabs lose this protection only.
        return false;
    }
}

/** Whether a page load's record still stands (another tab may remove it). */
export function hasRecord(
    local: UserDataStorage,
    instanceId: string,
    page: string
): boolean {
    try {
        return local.getItem(recordKey(instanceId, page)) !== null;
    } catch {
        return true;
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
        if (owner !== tabId && now - Number(record.at) < UNCONFIRMED_TTL_MS) {
            for (const key of record.keys) {
                keys.add(String(key));
            }
        }
    }
    return keys;
}
