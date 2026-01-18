/**
 * Drizzle ORM schema for IPTVnator database
 * This schema defines the structure for Xtream Codes API data storage
 *
 * Single source of truth for database schema - used by:
 * - electron-backend (full read-write access)
 * - agent-backend (read-only access for AI queries)
 */

import { sql } from 'drizzle-orm';
import {
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Playlists table
export const playlists = sqliteTable('playlists', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    serverUrl: text('serverUrl'),
    username: text('username'),
    password: text('password'),
    dateCreated: text('date_created').default(sql`CURRENT_TIMESTAMP`),
    lastUpdated: text('last_updated'),
    type: text('type', {
        enum: ['xtream', 'stalker', 'm3u-file', 'm3u-text', 'm3u-url'],
    }).notNull(),
    userAgent: text('userAgent'),
    origin: text('origin'),
    referrer: text('referrer'),
    filePath: text('filePath'),
    autoRefresh: integer('autoRefresh', { mode: 'boolean' }).default(false),
    macAddress: text('macAddress'),
    url: text('url'),
    lastUsage: text('last_usage'),
});

// Categories table
export const categories = sqliteTable(
    'categories',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        playlistId: text('playlist_id')
            .notNull()
            .references(() => playlists.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        type: text('type', { enum: ['live', 'movies', 'series'] }).notNull(),
        xtreamId: integer('xtream_id').notNull(),
        hidden: integer('hidden', { mode: 'boolean' }).default(false),
    },
    (table) => ({
        playlistIdx: index('idx_categories_playlist').on(table.playlistId),
        typeIdx: index('idx_categories_type').on(table.type),
    })
);

// Content table (streams/VODs/series)
export const content = sqliteTable(
    'content',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        categoryId: integer('category_id')
            .notNull()
            .references(() => categories.id, { onDelete: 'cascade' }),
        title: text('title').notNull(),
        rating: text('rating'),
        added: text('added'),
        posterUrl: text('poster_url'),
        xtreamId: integer('xtream_id').notNull(),
        type: text('type', { enum: ['live', 'movie', 'series'] }).notNull(),
    },
    (table) => ({
        typeIdx: index('idx_content_type').on(table.type),
        categoryIdx: index('idx_content_category').on(table.categoryId),
        titleIdx: index('idx_content_title').on(table.title),
        xtreamIdx: index('idx_content_xtream').on(table.xtreamId),
    })
);

// Recently viewed table
export const recentlyViewed = sqliteTable(
    'recently_viewed',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        contentId: integer('content_id')
            .notNull()
            .references(() => content.id, { onDelete: 'cascade' }),
        playlistId: text('playlist_id')
            .notNull()
            .references(() => playlists.id, { onDelete: 'cascade' }),
        viewedAt: text('viewed_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        contentPlaylistUnique: uniqueIndex(
            'recently_viewed_content_playlist_unique'
        ).on(table.contentId, table.playlistId),
        playlistIdx: index('recently_viewed_playlist_idx').on(table.playlistId),
        viewedAtIdx: index('recently_viewed_viewed_at_idx').on(table.viewedAt),
    })
);

// Favorites table
export const favorites = sqliteTable(
    'favorites',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        contentId: integer('content_id')
            .notNull()
            .references(() => content.id, { onDelete: 'cascade' }),
        playlistId: text('playlist_id')
            .notNull()
            .references(() => playlists.id, { onDelete: 'cascade' }),
        addedAt: text('added_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        contentPlaylistUnique: uniqueIndex(
            'favorites_content_playlist_unique'
        ).on(table.contentId, table.playlistId),
        playlistIdx: index('favorites_playlist_idx').on(table.playlistId),
        contentIdx: index('favorites_content_idx').on(table.contentId),
    })
);

// EPG Channels table
export const epgChannels = sqliteTable(
    'epg_channels',
    {
        id: text('id').primaryKey(), // Channel ID from EPG source
        displayName: text('display_name').notNull(),
        iconUrl: text('icon_url'),
        url: text('url'),
        sourceUrl: text('source_url').notNull(), // Which EPG URL this came from
        updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        sourceIdx: index('idx_epg_channels_source').on(table.sourceUrl),
        nameIdx: index('idx_epg_channels_name').on(table.displayName),
    })
);

// EPG Programs table
export const epgPrograms = sqliteTable(
    'epg_programs',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        channelId: text('channel_id')
            .notNull()
            .references(() => epgChannels.id, { onDelete: 'cascade' }),
        start: text('start').notNull(), // ISO datetime
        stop: text('stop').notNull(), // ISO datetime
        title: text('title').notNull(),
        description: text('description'),
        category: text('category'),
        iconUrl: text('icon_url'),
        rating: text('rating'),
        episodeNum: text('episode_num'),
    },
    (table) => ({
        channelIdx: index('idx_epg_programs_channel').on(table.channelId),
        startIdx: index('idx_epg_programs_start').on(table.start),
        timeRangeIdx: index('idx_epg_programs_time_range').on(
            table.channelId,
            table.start,
            table.stop
        ),
    })
);

// Playback Positions table
export const playbackPositions = sqliteTable(
    'playback_positions',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        playlistId: text('playlist_id')
            .notNull()
            .references(() => playlists.id, { onDelete: 'cascade' }),
        // For VOD: store xtream_id of the movie
        // For Series: store episode ID (from XtreamSerieEpisode.id)
        contentXtreamId: integer('content_xtream_id').notNull(),
        // 'vod' | 'episode'
        contentType: text('content_type', {
            enum: ['vod', 'episode'],
        }).notNull(),
        // For episodes: store series xtream_id for grouping
        seriesXtreamId: integer('series_xtream_id'),
        // For episodes: store season and episode numbers for display
        seasonNumber: integer('season_number'),
        episodeNumber: integer('episode_number'),
        // Playback position in seconds
        positionSeconds: integer('position_seconds').notNull().default(0),
        // Total duration in seconds (for percentage calculation)
        durationSeconds: integer('duration_seconds'),
        // Last updated timestamp
        updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        // Unique constraint: one position per content per playlist
        contentPlaylistUnique: uniqueIndex(
            'playback_positions_content_playlist_unique'
        ).on(table.contentXtreamId, table.playlistId, table.contentType),
        playlistIdx: index('playback_positions_playlist_idx').on(
            table.playlistId
        ),
        seriesIdx: index('playback_positions_series_idx').on(
            table.seriesXtreamId
        ),
        updatedIdx: index('playback_positions_updated_idx').on(table.updatedAt),
    })
);

// Type exports for TypeScript
export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;

export type RecentlyViewed = typeof recentlyViewed.$inferSelect;
export type NewRecentlyViewed = typeof recentlyViewed.$inferInsert;

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;

export type EpgChannel = typeof epgChannels.$inferSelect;
export type NewEpgChannel = typeof epgChannels.$inferInsert;

export type EpgProgramDb = typeof epgPrograms.$inferSelect;
export type NewEpgProgramDb = typeof epgPrograms.$inferInsert;

export type PlaybackPosition = typeof playbackPositions.$inferSelect;
export type NewPlaybackPosition = typeof playbackPositions.$inferInsert;
