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
    private readonly deleteChannelsStmt: BetterSqlite3.Statement;

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
                source_url = excluded.source_url,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        `);

        this.insertProgramStmt = this.db.prepare(`
            INSERT INTO epg_programs (channel_id, start, stop, title, description, category, icon_url, rating, episode_num)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.deleteChannelsStmt = this.db.prepare(`
            DELETE FROM epg_channels WHERE source_url = ?
        `);
    }

    /**
     * Insert a batch of channels. When `clearFirst` is true, the existing rows
     * for `sourceUrl` are deleted inside the same transaction as the insert so
     * old data is preserved if the fetch/parse never produces any channels.
     */
    insertChannels(
        channels: ParsedChannel[],
        sourceUrl: string,
        clearFirst = false
    ): void {
        const insertMany = this.db.transaction((channels: ParsedChannel[]) => {
            if (clearFirst) {
                this.deleteChannelsStmt.run(sourceUrl);
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
    insertPrograms(programs: ParsedProgram[]): number {
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
                        episodeNum
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
