/**
 * Drizzle ORM schema for IPTVnator database
 * This schema defines the structure for Xtream Codes API data storage
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
export const recentlyViewed = sqliteTable('recently_viewed', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contentId: integer('content_id')
        .notNull()
        .references(() => content.id, { onDelete: 'cascade' }),
    playlistId: text('playlist_id')
        .notNull()
        .references(() => playlists.id, { onDelete: 'cascade' }),
    viewedAt: text('viewed_at').default(sql`CURRENT_TIMESTAMP`),
});

// Favorites table
export const favorites = sqliteTable('favorites', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contentId: integer('content_id')
        .notNull()
        .references(() => content.id, { onDelete: 'cascade' }),
    playlistId: text('playlist_id')
        .notNull()
        .references(() => playlists.id, { onDelete: 'cascade' }),
    addedAt: text('added_at').default(sql`CURRENT_TIMESTAMP`),
});

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
