/**
 * EPG Database IPC event handlers
 *
 * Only the full-text programme search is exposed to the renderer
 * (`window.electron.searchEpgPrograms`). All other EPG persistence and
 * lookups run through the EPG worker (`workers/epg-database.ts`) and
 * `epg-query.service.ts` handlers registered in `epg.events.ts`.
 */

import { sql } from 'drizzle-orm';
import { ipcMain } from 'electron';
import type { ElectronBridgeEpgSearchProgram } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../../database/connection';

/** Raw `epg_programs` columns as `db.all` returns them, plus the joined channel name. */
interface EpgSearchRow {
    channel_id: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    icon_url: string | null;
    rating: string | null;
    episode_num: string | null;
    channel_name: string | null;
}

/**
 * `db.all` hands back snake_case columns; the bridge promises the public
 * `EpgProgram` shape (`channel`, `desc`, `iconUrl`, …), so map here or every
 * consumer sees `program.channel === undefined`.
 */
export function toSearchProgram(
    row: EpgSearchRow
): ElectronBridgeEpgSearchProgram {
    return {
        start: row.start,
        stop: row.stop,
        channel: row.channel_id,
        title: row.title,
        desc: row.description,
        category: row.category,
        iconUrl: row.icon_url,
        rating: row.rating,
        episodeNum: row.episode_num,
        channelName: row.channel_name ?? null,
    };
}

const loggerLabel = '[EPG DB]';

/**
 * Full-text search EPG programs using FTS5 with LIKE fallback
 * Handles Cyrillic and other Unicode text properly
 * Includes channel display name via JOIN
 */
ipcMain.handle(
    'EPG_DB_SEARCH_PROGRAMS',
    async (_event, searchTerm: string, limit = 50) => {
        try {
            const db = await getDatabase();
            const trimmedTerm = searchTerm.trim();

            if (!trimmedTerm) {
                return [];
            }

            // Use LIKE for substring matching (works better with Cyrillic)
            // This is more intuitive for users expecting exact substring matches
            const likePattern = `%${trimmedTerm}%`;

            // JOIN with epg_channels to get channel display name
            // Include all programs (past and future) for catchup/archive feature
            const results = (await db.all(sql`
                SELECT
                    p.*,
                    c.display_name as channel_name
                FROM epg_programs p
                LEFT JOIN epg_channels c ON p.channel_id = c.id
                WHERE (
                    p.title LIKE ${likePattern}
                    OR p.description LIKE ${likePattern}
                    OR p.category LIKE ${likePattern}
                )
                ORDER BY p.start
                LIMIT ${limit}
            `)) as EpgSearchRow[];

            return results.map(toSearchProgram);
        } catch (error) {
            console.error(loggerLabel, 'Error searching EPG programs:', error);
            throw error;
        }
    }
);
