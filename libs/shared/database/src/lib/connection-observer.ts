import type Database from 'better-sqlite3';

export type DatabaseConnectionObserver = (
    connection: Database.Database
) => void;

let observer: DatabaseConnectionObserver | null = null;

/**
 * Registers a callback that `initDatabase` calls with each connection it
 * opens, before any statement runs on it; `null` removes it. The Electron
 * main process uses it with IPTVNATOR_PERF_CAPTURE=1 to count main-thread
 * SQL statements. This module has no runtime dependencies, so registering
 * the observer does not load better-sqlite3.
 */
export function setDatabaseConnectionObserver(
    next: DatabaseConnectionObserver | null
): void {
    observer = next;
}

export function notifyDatabaseConnectionOpened(
    connection: Database.Database
): void {
    observer?.(connection);
}
