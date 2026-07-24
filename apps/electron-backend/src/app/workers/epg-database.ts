import type BetterSqlite3 from 'better-sqlite3';
import { getIptvnatorDatabasePath } from '@iptvnator/shared/database/path-utils';
import type { ParsedChannel, ParsedProgram } from './epg-streaming-parser';

/**
 * Database helper for worker-owned EPG operations.
 * Creates its own connection to avoid blocking the main thread.
 */
export class EpgDatabase {
    private readonly db: BetterSqlite3.Database;
    private readonly knownChannelIds = new Set<string>();
    private readonly insertChannelStmt: BetterSqlite3.Statement;
    private readonly insertProgramStmt: BetterSqlite3.Statement;
    private readonly deleteOrphanChannelsForSourceStmt: BetterSqlite3.Statement;
    private readonly deleteTodayAndFutureStmt: BetterSqlite3.Statement;

    constructor(Database: typeof BetterSqlite3) {
        this.db = new Database(getIptvnatorDatabasePath());
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');

        this.insertChannelStmt = this.db.prepare(`
            INSERT INTO epg_channels (id, display_name, icon_url, url, source_url, updated_at)
            VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                icon_url = excluded.icon_url,
                url = excluded.url,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        `);

        // Guard against duplicate entries when the clearFirst logic misses old
        // rows. The same channel + start + title + source is treated as the
        // same programme — a later import with a corrected stop time simply
        // updates the earlier row. `source_url` is part of the key so that
        // programmes imported from different EPG sources that happen to share
        // channel_id/start/title stay isolated: the query layer scopes by
        // source_url, and source-scoped deletes must not clobber another
        // source's rows.
        // The upsert (instead of INSERT OR REPLACE) keeps the epg_programs_fts
        // triggers consistent: REPLACE deletes rows without firing the delete
        // trigger unless recursive_triggers is enabled, leaving ghost FTS rows.
        const dedupIndexReady = this.ensureProgramDedupIndex();

        this.insertProgramStmt = this.db.prepare(
            dedupIndexReady
                ? `INSERT INTO epg_programs (channel_id, start, stop, title, description, category, icon_url, rating, episode_num, source_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(channel_id, start, title, source_url) DO UPDATE SET
                       stop = excluded.stop,
                       description = excluded.description,
                       category = excluded.category,
                       icon_url = excluded.icon_url,
                       rating = excluded.rating,
                       episode_num = excluded.episode_num`
                : `INSERT INTO epg_programs (channel_id, start, stop, title, description, category, icon_url, rating, episode_num, source_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        this.deleteOrphanChannelsForSourceStmt = this.db.prepare(`
            DELETE FROM epg_channels
            WHERE source_url = ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM epg_programs
                  WHERE epg_programs.channel_id = epg_channels.id
              )
        `);

        this.deleteTodayAndFutureStmt = this.db.prepare(`
            DELETE FROM epg_programs
            WHERE source_url = ?
              AND (start >= date('now') OR start < date('now', '-7 days'))
        `);
    }

    /**
     * Insert a batch of channels. When `clearTodayAndFuture` is true, the
     * selective delete (today+future and older-than-7-days) runs inside the
     * same transaction so a parse failure after the delete atomically rolls
     * back both — no gap left in the schedule.
     */
    insertChannels(
        channels: ParsedChannel[],
        sourceUrl: string,
        clearTodayAndFuture = false
    ): void {
        const insertMany = this.db.transaction((channels: ParsedChannel[]) => {
            if (clearTodayAndFuture) {
                this.deleteTodayAndFutureStmt.run(sourceUrl);
                this.deleteOrphanChannelsForSourceStmt.run(sourceUrl);
                this.knownChannelIds.clear();
            }

            for (const channel of channels) {
                const displayName =
                    channel.displayName?.[0]?.value || channel.id;
                const iconUrl = channel.icon?.[0]?.src || null;
                const url = channel.url?.[0] || null;

                this.insertChannelStmt.run(
                    channel.id,
                    displayName,
                    iconUrl,
                    url,
                    sourceUrl
                );
                this.knownChannelIds.add(channel.id);
            }
        });

        insertMany(channels);
    }

    /**
     * Insert programs for channels already seen during the current parse.
     */
    insertPrograms(programs: ParsedProgram[], sourceUrl: string): number {
        let insertedCount = 0;

        const insertMany = this.db.transaction((programs: ParsedProgram[]) => {
            for (const program of programs) {
                if (!this.knownChannelIds.has(program.channel)) continue;

                const title = program.title?.[0]?.value || 'Unknown';
                const description = program.desc?.[0]?.value || null;
                const category = program.category?.[0]?.value || null;
                const iconUrl = program.icon?.[0]?.src || null;
                const rating = program.rating?.[0]?.value || null;
                const episodeNum = program.episodeNum?.[0]?.value || null;

                try {
                    this.insertProgramStmt.run(
                        program.channel,
                        program.start,
                        program.stop,
                        title,
                        description,
                        category,
                        iconUrl,
                        rating,
                        episodeNum,
                        sourceUrl
                    );
                    insertedCount++;
                } catch {
                    // Skip individual failures such as FK constraint errors.
                }
            }
        });

        insertMany(programs);
        return insertedCount;
    }

    close(): void {
        this.db.close();
    }

    /**
     * Create the unique (channel_id, start, title, source_url) dedup index.
     *
     * Databases that predate the index may already contain duplicate rows —
     * exactly the situation the index is meant to prevent — so those are
     * removed first; a plain `CREATE UNIQUE INDEX` would otherwise throw in
     * this constructor and permanently break EPG imports for upgrading users.
     *
     * The `_v2` name migrates users off the earlier source-blind index
     * (`idx_epg_programs_dedup` on `channel_id, start, title`), which
     * collapsed programmes imported from different EPG sources that shared
     * those three columns. The old index is dropped so it can no longer
     * enforce the source-blind uniqueness.
     *
     * Returns false when the index could not be created, in which case the
     * insert statement falls back to the previous plain-INSERT behaviour.
     */
    private ensureProgramDedupIndex(): boolean {
        try {
            const exists = this.db
                .prepare(
                    `SELECT 1 FROM sqlite_master
                     WHERE type = 'index' AND name = 'idx_epg_programs_dedup_v2'`
                )
                .get();
            if (!exists) {
                this.db
                    .prepare(`DROP INDEX IF EXISTS idx_epg_programs_dedup`)
                    .run();
                this.db
                    .prepare(
                        `DELETE FROM epg_programs
                         WHERE id NOT IN (
                             SELECT MIN(id) FROM epg_programs
                             GROUP BY channel_id, start, title, source_url
                         )`
                    )
                    .run();
                this.db
                    .prepare(
                        `CREATE UNIQUE INDEX idx_epg_programs_dedup_v2
                         ON epg_programs(channel_id, start, title, source_url)`
                    )
                    .run();
            }
            return true;
        } catch {
            return false;
        }
    }
}

export class EpgDatabaseClearOperation {
    private readonly db: BetterSqlite3.Database;

    constructor(Database: typeof BetterSqlite3) {
        this.db = new Database(getIptvnatorDatabasePath());
        this.db.pragma('busy_timeout = 5000');
    }

    run(): void {
        this.db.exec('BEGIN');
        try {
            this.db.exec('DELETE FROM epg_programs');
            this.db.exec('DELETE FROM epg_channels');
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    close(): void {
        this.db.close();
    }
}

export class EpgDatabaseSourceClearOperation {
    private readonly db: BetterSqlite3.Database;
    private readonly deleteProgramsForSourceStmt: BetterSqlite3.Statement;
    private readonly deleteOrphanChannelsForSourceStmt: BetterSqlite3.Statement;

    constructor(Database: typeof BetterSqlite3) {
        this.db = new Database(getIptvnatorDatabasePath());
        this.db.pragma('busy_timeout = 5000');

        this.deleteProgramsForSourceStmt = this.db.prepare(`
            DELETE FROM epg_programs WHERE source_url = ?
        `);

        this.deleteOrphanChannelsForSourceStmt = this.db.prepare(`
            DELETE FROM epg_channels
            WHERE source_url = ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM epg_programs
                  WHERE epg_programs.channel_id = epg_channels.id
              )
        `);
    }

    run(sourceUrl: string): void {
        const normalizedSourceUrl = sourceUrl.trim();
        if (!normalizedSourceUrl) {
            return;
        }

        const clearSource = this.db.transaction((url: string) => {
            this.deleteProgramsForSourceStmt.run(url);
            this.deleteOrphanChannelsForSourceStmt.run(url);
        });

        clearSource(normalizedSourceUrl);
    }

    close(): void {
        this.db.close();
    }
}
