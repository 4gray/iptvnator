import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import {
    markUnconfirmed,
    pagesUnder,
    UNCONFIRMED_KEY,
} from './server-page-registry';
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

const writesKey = (instanceId: string, page: string) =>
    `${UNSENT_WRITES_KEY}:${instanceId}:${page}`;

/** Edits made before the first read of a visit, kept as before → after. */
export const DEFERRED_EDITS_KEY = 'iptvnator-server:deferred-edits';
const deferredKey = (instanceId: string, page: string) =>
    `${DEFERRED_EDITS_KEY}:${instanceId}:${page}`;

/** Key prefixes of what a page load keeps, each followed by `:<instance>:<page>`. */
const PAGE_PREFIXES = [UNCONFIRMED_KEY, UNSENT_WRITES_KEY, DEFERRED_EDITS_KEY];

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
