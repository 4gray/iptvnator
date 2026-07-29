/**
 * Drizzle ORM schema for VOD multi-source pins — the user's per-movie choice
 * of which playlist a film should play from.
 *
 * Split out of schema.ts to keep that file within the repository's
 * max-lines budget; re-exported from there so `import * as schema`
 * consumers keep seeing a single schema namespace.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Per-movie preferred source. Keyed by a portal-agnostic match key
// (`tmdb:{id}` or `title:{base}:{year}`) rather than by a provider id,
// because the same film has a different id in every portal.
//
// The playlist foreign key with ON DELETE CASCADE lives in the raw
// CREATE TABLE in connection.ts — which is what actually creates this table —
// rather than in a Drizzle `.references()`. Declaring it here would mean
// importing `playlists` from schema.ts, which re-exports this module, and that
// import cycle is exactly what `epg-mapping.schema.ts` avoids too.
export const vodSourcePins = sqliteTable(
    'vod_source_pins',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        matchKey: text('match_key').notNull().unique(),
        playlistId: text('playlist_id').notNull(),
        // Provider-side id within that playlist (Xtream `stream_id`).
        contentId: integer('content_id').notNull(),
        portalType: text('portal_type', {
            enum: ['xtream', 'stalker', 'm3u'],
        }).notNull(),
        updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        playlistIdx: index('idx_vod_source_pins_playlist').on(table.playlistId),
    })
);

export type VodSourcePinRow = typeof vodSourcePins.$inferSelect;
export type NewVodSourcePinRow = typeof vodSourcePins.$inferInsert;
