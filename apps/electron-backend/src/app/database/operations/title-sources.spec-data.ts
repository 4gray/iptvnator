import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { AppDatabase } from '../database.types';

/**
 * Shared scaffolding for the title-source suites, so the query-shape tests and
 * the match-confirmation tests can live in separate files without each
 * carrying its own copy.
 */

export function createDbMock(rows: unknown[] = []) {
    const all = jest.fn().mockResolvedValue(rows);
    return { db: { all } as unknown as AppDatabase, all };
}

/**
 * The statement as SQLite will actually see it.
 *
 * `better-sqlite3` is built against the Electron ABI and cannot be loaded by
 * Jest, so the row-shaping tests below run against a mock that returns rows
 * whatever the query says. What rows the DATABASE is asked for is therefore
 * only observable here — and it is exactly what the window-crowding fixes
 * changed.
 */
export function compiledQuery(all: jest.Mock, call = 0) {
    return new SQLiteSyncDialect().sqlToQuery(all.mock.calls[call][0] as SQL);
}

export function createFailingDbMock() {
    const all = jest.fn().mockRejectedValue(new Error('fts syntax'));
    return { db: { all } as unknown as AppDatabase, all };
}

export const duneRow = {
    content_id: 1,
    title: 'Dune',
    xtream_id: 501,
    poster_url: 'https://cdn.example.com/dune.jpg',
    category_xtream_id: 12,
    playlist_id: 'playlist-1',
    playlist_name: 'Portal One',
};
