import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Playlist/source identifiers are snapshots rather than foreign keys: deleting
// a playlist must not remove already recorded files from the user's library.
export const recordings = sqliteTable(
    'recordings',
    {
        id: text('id').primaryKey(),
        playlistId: text('playlist_id').notNull(),
        sourceType: text('source_type', {
            enum: ['xtream', 'stalker', 'm3u'],
        }).notNull(),
        channelId: text('channel_id').notNull(),
        channelName: text('channel_name').notNull(),
        title: text('title').notNull(),
        description: text('description'),
        streamUrl: text('stream_url'),
        requestHeaders: text('request_headers'),
        recordingDirectory: text('recording_directory'),
        posterUrl: text('poster_url'),
        epgProgramId: integer('epg_program_id'),
        epgChannelId: text('epg_channel_id'),
        scheduledStartAt: text('scheduled_start_at').notNull(),
        scheduledEndAt: text('scheduled_end_at').notNull(),
        paddingBeforeSeconds: integer('padding_before_seconds')
            .notNull()
            .default(0),
        paddingAfterSeconds: integer('padding_after_seconds')
            .notNull()
            .default(0),
        status: text('status', {
            enum: [
                'scheduled',
                'recording',
                'completed',
                'failed',
                'canceled',
                'missed',
                'interrupted',
            ],
        })
            .notNull()
            .default('scheduled'),
        fileName: text('file_name'),
        filePath: text('file_path'),
        bytesRecorded: integer('bytes_recorded'),
        errorMessage: text('error_message'),
        startedAt: text('started_at'),
        completedAt: text('completed_at'),
        createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
        updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => ({
        playlistIdx: index('recordings_playlist_idx').on(table.playlistId),
        statusStartIdx: index('recordings_status_start_idx').on(
            table.status,
            table.scheduledStartAt
        ),
        completedIdx: index('recordings_completed_idx').on(table.completedAt),
    })
);

export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
