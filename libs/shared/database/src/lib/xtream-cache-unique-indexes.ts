import type Database from 'better-sqlite3';

export const XTREAM_CACHE_UNIQUE_INDEXES = [
    'categories_playlist_type_xtream_unique',
    'content_category_type_xtream_unique',
] as const;

/**
 * Both unique indexes of INDEX_MIGRATION_STATEMENTS exist, so the Xtream
 * cache cannot hold the duplicates `deduplicateXtreamCache` repairs.
 */
export function xtreamCacheUniqueIndexesExist(
    sqliteDb: Database.Database
): boolean {
    const row = sqliteDb
        .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master
             WHERE type = 'index' AND name IN (${XTREAM_CACHE_UNIQUE_INDEXES.map(
                 (name) => `'${name}'`
             ).join(', ')})`
        )
        .get() as { count?: number } | undefined;
    return row?.count === XTREAM_CACHE_UNIQUE_INDEXES.length;
}
