import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Manual user overrides for matching playlist channels to EPG channels.
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
