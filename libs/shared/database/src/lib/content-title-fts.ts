import type Database from 'better-sqlite3';

/**
 * The title FTS index (`content_title_fts`) and its upgrades.
 *
 * The tokenizer is fixed at CREATE time, so changing it means indexing the
 * whole catalog again: about 4 s per million titles. Startup does that only
 * for a small catalog. A larger one gets a second index built beside the
 * live one by the database worker after startup (see the README), while
 * search keeps using the live index.
 *
 * Only type imports from better-sqlite3 here: the database worker loads this
 * module before it has resolved the native module.
 */

type Sqlite = Database.Database;

export const CONTENT_TITLE_FTS_MIGRATION_KEY =
    'migration:content-title-fts-trigram:v1';
export const CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY =
    'migration:content-title-fts-remove-diacritics:v1';
/** Highest `content.id` the index under construction already holds. */
export const CONTENT_TITLE_FTS_BUILD_CURSOR_KEY =
    'migration:content-title-fts-build-cursor:v1';

const LIVE = 'content_title_fts';
const NEXT = 'content_title_fts_next';

/** Above this many titles the startup rebuild moves to the worker. */
export const CONTENT_TITLE_FTS_STARTUP_REBUILD_LIMIT = 50_000;

/**
 * The title index, folding diacritics when the runtime can.
 *
 * Cross-playlist matching compares NORMALIZED titles ("Amélie" -> "amelie"),
 * but the index holds the raw title, and the trigram tokenizer does not fold
 * diacritics by default. Every accented title was therefore invisible to it:
 * two identical `Amélie` entries produced no candidates at all.
 *
 * `remove_diacritics` needs SQLite 3.45+, so an older runtime keeps the plain
 * tokenizer rather than losing the index — accented titles stay unmatched
 * there, which is exactly the behaviour it had before.
 */
export function contentTitleFtsStatement(
    removeDiacritics: boolean,
    table: string = LIVE
): string {
    const tokenize = removeDiacritics
        ? `'trigram remove_diacritics 1'`
        : `'trigram'`;
    return `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(
      title,
      content='content',
      content_rowid='id',
      tokenize=${tokenize}
  )`;
}

/** Keep the live index in step with `content`. */
export const CONTENT_TITLE_FTS_TRIGGER_STATEMENTS: readonly string[] = [
    `CREATE TRIGGER IF NOT EXISTS content_title_fts_ai AFTER INSERT ON content BEGIN
      INSERT INTO content_title_fts(rowid, title)
      VALUES (new.id, new.title);
  END`,
    `CREATE TRIGGER IF NOT EXISTS content_title_fts_ad AFTER DELETE ON content BEGIN
      INSERT INTO content_title_fts(content_title_fts, rowid, title)
      VALUES ('delete', old.id, old.title);
  END`,
    `CREATE TRIGGER IF NOT EXISTS content_title_fts_au AFTER UPDATE ON content BEGIN
      INSERT INTO content_title_fts(content_title_fts, rowid, title)
      VALUES ('delete', old.id, old.title);
      INSERT INTO content_title_fts(rowid, title)
      VALUES (new.id, new.title);
  END`,
];

const LIVE_TRIGGERS = [
    'content_title_fts_ai',
    'content_title_fts_ad',
    'content_title_fts_au',
];
const NEXT_TRIGGERS = [`${NEXT}_ai`, `${NEXT}_ad`, `${NEXT}_au`];

const CURSOR = `(SELECT CAST(value AS INTEGER) FROM app_state
                 WHERE key = '${CONTENT_TITLE_FTS_BUILD_CURSOR_KEY}')`;

/**
 * The index under construction holds exactly the rows up to the cursor.
 * These triggers keep that true for writes during the build, from any
 * connection: a row past the cursor is left to the batch that reaches it,
 * and only a row the index holds is ever deleted from it (an external
 * content index trusts the values a `delete` names).
 */
const NEXT_TRIGGER_STATEMENTS = [
    `CREATE TRIGGER IF NOT EXISTS ${NEXT}_ai AFTER INSERT ON content
     WHEN new.id <= ${CURSOR} BEGIN
      INSERT INTO ${NEXT}(rowid, title) VALUES (new.id, new.title);
  END`,
    `CREATE TRIGGER IF NOT EXISTS ${NEXT}_ad AFTER DELETE ON content
     WHEN old.id <= ${CURSOR} BEGIN
      INSERT INTO ${NEXT}(${NEXT}, rowid, title)
      VALUES ('delete', old.id, old.title);
  END`,
    `CREATE TRIGGER IF NOT EXISTS ${NEXT}_au AFTER UPDATE ON content BEGIN
      INSERT INTO ${NEXT}(${NEXT}, rowid, title)
      SELECT 'delete', old.id, old.title WHERE old.id <= ${CURSOR};
      INSERT INTO ${NEXT}(rowid, title)
      SELECT new.id, new.title WHERE new.id <= ${CURSOR};
  END`,
];

function tableSql(sqlite: Sqlite, table: string): string | null {
    const row = sqlite
        .prepare(
            `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
        )
        .get(table) as { sql?: unknown } | undefined;
    return typeof row?.sql === 'string' ? row.sql : null;
}

/**
 * Whether an index folds diacritics, read from its own stored DDL rather
 * than from the migration record. A missing table answers `false`.
 */
function foldsDiacritics(sqlite: Sqlite, table: string): boolean {
    return tableSql(sqlite, table)?.includes('remove_diacritics') ?? false;
}

function supportsTrigramDiacriticFolding(sqlite: Sqlite): boolean {
    try {
        sqlite.exec(
            `CREATE VIRTUAL TABLE temp.content_title_fts_probe USING fts5(
                title, tokenize='trigram remove_diacritics 1'
            )`
        );
        sqlite.exec(`DROP TABLE temp.content_title_fts_probe`);
        return true;
    } catch {
        return false;
    }
}

function migrationDone(sqlite: Sqlite, key: string): boolean {
    const row = sqlite
        .prepare(`SELECT value FROM app_state WHERE key = ?`)
        .get(key) as { value?: unknown } | undefined;
    return row?.value === 'done';
}

function markDone(sqlite: Sqlite, folded: boolean): void {
    const mark = sqlite.prepare(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (?, 'done', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`
    );
    // Not marked when the runtime cannot fold: a later app version ships a
    // newer SQLite, and the index should upgrade itself then.
    if (folded) mark.run(CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY);
    mark.run(CONTENT_TITLE_FTS_MIGRATION_KEY);
}

function dropTriggers(sqlite: Sqlite, names: readonly string[]): void {
    for (const name of names) sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);
}

function discardBuild(sqlite: Sqlite): void {
    dropTriggers(sqlite, NEXT_TRIGGERS);
    sqlite.exec(`DROP TABLE IF EXISTS ${NEXT}`);
    sqlite
        .prepare(`DELETE FROM app_state WHERE key = ?`)
        .run(CONTENT_TITLE_FTS_BUILD_CURSOR_KEY);
}

function catalogIsSmall(sqlite: Sqlite, limit: number): boolean {
    if (!Number.isFinite(limit)) return true;
    const row = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM content LIMIT ?)`)
        .get(limit + 1) as { n: number };
    return row.n <= limit;
}

export type ContentTitleFtsStartup =
    'current' | 'rebuilt' | 'deferred' | 'failed';

export interface ContentTitleFtsStartupOptions {
    /** Largest catalog rebuilt at startup; `Infinity` always rebuilds. */
    readonly startupRebuildLimit?: number;
}

/**
 * Startup half of the index upgrade, run inside `initDatabase()`.
 *
 * - `current`: the live index already has the tokenizer this runtime wants
 *   (read from its DDL, not only from the marker) and is built.
 * - `rebuilt`: a small catalog was re-indexed here, in one transaction.
 * - `deferred`: the index under construction and its triggers exist; the
 *   worker fills it with `buildContentTitleFtsBatch`. A build an earlier
 *   session left unfinished is resumed, not restarted.
 *
 * Every write is transactional, so a failure leaves the working index.
 */
export function prepareContentTitleFts(
    sqlite: Sqlite,
    options: ContentTitleFtsStartupOptions = {}
): ContentTitleFtsStartup {
    const limit =
        options.startupRebuildLimit ?? CONTENT_TITLE_FTS_STARTUP_REBUILD_LIMIT;
    try {
        // `createTables` declares the live table too, with the plain
        // tokenizer, so a table recreated after the marker was written would
        // be silently unfolded. The live DDL decides, not the marker alone.
        // Checked before the probe: this is every launch after the upgrade.
        const folded =
            migrationDone(sqlite, CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY) &&
            foldsDiacritics(sqlite, LIVE);
        const built = migrationDone(sqlite, CONTENT_TITLE_FTS_MIGRATION_KEY);
        const fold = !folded && supportsTrigramDiacriticFolding(sqlite);
        const current = folded || (!fold && built);

        if (current) {
            if (tableSql(sqlite, NEXT) !== null) {
                sqlite.transaction(() => discardBuild(sqlite))();
            }
            return 'current';
        }

        if (catalogIsSmall(sqlite, limit)) {
            sqlite.transaction(() => {
                discardBuild(sqlite);
                sqlite.exec(`DROP TABLE IF EXISTS ${LIVE}`);
                sqlite.exec(contentTitleFtsStatement(fold));
                sqlite
                    .prepare(`INSERT INTO ${LIVE}(${LIVE}) VALUES ('rebuild')`)
                    .run();
                markDone(sqlite, fold);
            })();
            return 'rebuilt';
        }

        sqlite.transaction(() => {
            const pending = tableSql(sqlite, NEXT);
            if (
                pending !== null &&
                pending.includes('remove_diacritics') !== fold
            ) {
                discardBuild(sqlite);
            }
            sqlite.exec(contentTitleFtsStatement(fold, NEXT));
            sqlite
                .prepare(
                    `INSERT INTO app_state (key, value, updated_at)
                     VALUES (?, '0', datetime('now'))
                     ON CONFLICT(key) DO NOTHING`
                )
                .run(CONTENT_TITLE_FTS_BUILD_CURSOR_KEY);
            for (const statement of NEXT_TRIGGER_STATEMENTS) {
                sqlite.exec(statement);
            }
            // A profile from before 0.22 has never filled the live index.
            // Its triggers would `delete` rows it does not hold, which an
            // external content index cannot detect; until the swap it stays
            // empty instead. `createTables` restores them on every start,
            // so they are dropped again here.
            if (!built) dropTriggers(sqlite, LIVE_TRIGGERS);
        })();
        return 'deferred';
    } catch (error) {
        console.warn(
            `Content title FTS upgrade failed (continuing): ${errorMessage(error)}`
        );
        return 'failed';
    }
}

/** Whether an index build is waiting for the worker. */
export function isContentTitleFtsBuildPending(sqlite: Sqlite): boolean {
    return tableSql(sqlite, NEXT) !== null;
}

export type ContentTitleFtsBatch = 'pending' | 'done' | 'idle';

/**
 * Indexes the next `batchSize` titles past the cursor, or, when none are
 * left, swaps the finished index in. One IMMEDIATE transaction per call, so
 * the cursor is read under the write lock, a terminated worker loses at
 * most the batch in flight, and the swap is all or nothing. Returns `idle`
 * when there is nothing to build.
 */
export function buildContentTitleFtsBatch(
    sqlite: Sqlite,
    batchSize: number
): ContentTitleFtsBatch {
    return sqlite
        .transaction((): ContentTitleFtsBatch => {
            if (tableSql(sqlite, NEXT) === null) return 'idle';
            const cursorRow = sqlite
                .prepare(`SELECT ${CURSOR} AS cursor`)
                .get() as { cursor: number | null };
            if (cursorRow.cursor === null) {
                // Without a cursor no trigger fed the index: start over on
                // the next launch rather than swap in an incomplete one.
                discardBuild(sqlite);
                return 'idle';
            }
            const cursor = cursorRow.cursor;
            const upper =
                (
                    sqlite
                        .prepare(
                            `SELECT id FROM content WHERE id > ?
                             ORDER BY id LIMIT 1 OFFSET ?`
                        )
                        .get(cursor, batchSize - 1) as
                        { id: number } | undefined
                )?.id ??
                (
                    sqlite
                        .prepare(
                            `SELECT MAX(id) AS id FROM content WHERE id > ?`
                        )
                        .get(cursor) as { id: number | null }
                ).id;
            if (upper === null) {
                swapInBuiltIndex(sqlite);
                return 'done';
            }
            sqlite
                .prepare(
                    `INSERT INTO ${NEXT}(rowid, title)
                     SELECT id, title FROM content WHERE id > ? AND id <= ?`
                )
                .run(cursor, upper);
            sqlite
                .prepare(`UPDATE app_state SET value = ? WHERE key = ?`)
                .run(String(upper), CONTENT_TITLE_FTS_BUILD_CURSOR_KEY);
            return 'pending';
        })
        .immediate();
}

function swapInBuiltIndex(sqlite: Sqlite): void {
    const folded = foldsDiacritics(sqlite, NEXT);
    dropTriggers(sqlite, NEXT_TRIGGERS);
    dropTriggers(sqlite, LIVE_TRIGGERS);
    sqlite.exec(`DROP TABLE IF EXISTS ${LIVE}`);
    sqlite.exec(`ALTER TABLE ${NEXT} RENAME TO ${LIVE}`);
    for (const statement of CONTENT_TITLE_FTS_TRIGGER_STATEMENTS) {
        sqlite.exec(statement);
    }
    sqlite
        .prepare(`DELETE FROM app_state WHERE key = ?`)
        .run(CONTENT_TITLE_FTS_BUILD_CURSOR_KEY);
    markDone(sqlite, folded);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
