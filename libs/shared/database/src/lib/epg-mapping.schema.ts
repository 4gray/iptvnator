/**
 * Drizzle ORM schema for manual EPG-to-channel mappings.
 *
 * Split out of schema.ts to keep that file within the repository's
 * max-lines budget; re-exported from there so `import * as schema`
 * consumers keep seeing a single schema namespace.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// EPG channel mappings (manual user overrides)
export const epgChannelMappings = sqliteTable(
    'epg_channel_mappings',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        channelKey: text('channel_key').notNull().unique(),
        epgChannelId: text('epg_channel_id').notNull(),
        playlistId: text('playlist_id'),
        updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        playlistIdx: index('idx_epg_channel_mappings_playlist').on(
            table.playlistId
        ),
    })
);

export type EpgChannelMapping = typeof epgChannelMappings.$inferSelect;
export type NewEpgChannelMapping = typeof epgChannelMappings.$inferInsert;
