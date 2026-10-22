import type { UserDataStorage } from '../user-data-storage';

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

/** `closed`: the page unloaded (not into the back-forward cache). */
interface PageRecord {
    readonly at: number;
    readonly keys: string[];
    readonly closed?: boolean;
}

/** The page loads of keys that start with `prefix`. */
export function pagesUnder(local: UserDataStorage, prefix: string): string[] {
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
 * now stands for it. A closed record stays closed: a page-hide write that
 * fails after `pagehide` rewrites it, and the reload must still see a page
 * that unloaded, not one that seems to run.
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
        const closed = readRecord(local, instanceId, tabId)?.closed === true;
        local.setItem(
            recordKey(instanceId, tabId),
            JSON.stringify({
                at: now,
                keys: [...keys],
                ...(closed ? { closed } : {}),
            })
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
