import type { CatchupDownloadMetadata } from '@iptvnator/shared/interfaces';
import { sql } from 'drizzle-orm';
import {
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Downloads table
export const downloads = sqliteTable(
    'downloads',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        playlistId: text('playlist_id').notNull(),
        // Content identifiers
        xtreamId: integer('xtream_id').notNull(),
        contentType: text('content_type', {
            enum: ['vod', 'episode', 'catchup'],
        }).notNull(),
        programmeStart: integer('programme_start').notNull().default(0),
        catchup: text('catchup', {
            mode: 'json',
        }).$type<CatchupDownloadMetadata>(),
        // For episodes: store series info
        seriesXtreamId: integer('series_xtream_id'),
        seasonNumber: integer('season_number'),
        episodeNumber: integer('episode_number'),
        episodeIdentityScope: text('episode_identity_scope'),
        // Download metadata
        title: text('title').notNull(),
        url: text('url').notNull(),
        fileName: text('file_name'),
        filePath: text('file_path'),
        posterUrl: text('poster_url'),
        requestHeaders: text('request_headers'),
        resumeValidator: text('resume_validator'),
        metadataSnapshot: text('metadata_snapshot'),
        // Download progress
        status: text('status', {
            enum: [
                'queued',
                'downloading',
                'paused',
                'completed',
                'failed',
                'canceled',
            ],
        })
            .notNull()
            .default('queued'),
        bytesDownloaded: integer('bytes_downloaded').default(0),
        totalBytes: integer('total_bytes'),
        errorMessage: text('error_message'),
        // Timestamps
        createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
        updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        playlistIdx: index('downloads_playlist_idx').on(table.playlistId),
        statusIdx: index('downloads_status_idx').on(table.status),
        xtreamPlaylistUnique: uniqueIndex('downloads_xtream_playlist_unique')
            .on(table.xtreamId, table.playlistId, table.contentType)
            .where(sql`${table.contentType} != 'catchup'`),
        catchupUnique: uniqueIndex('downloads_catchup_unique')
            .on(table.xtreamId, table.playlistId, table.programmeStart)
            .where(sql`${table.contentType} = 'catchup'`),
    })
);

export type Download = typeof downloads.$inferSelect;
export type NewDownload = typeof downloads.$inferInsert;

// Write-ahead archive promotion proof. It outlives process-local DownloadTask.
export const downloadArchiveFinalizations = sqliteTable(
    'download_archive_finalizations',
    {
        downloadId: integer('download_id')
            .primaryKey()
            .references(() => downloads.id, { onDelete: 'cascade' }),
        proof: text('proof').notNull(),
    }
);
