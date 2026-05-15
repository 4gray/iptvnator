import { and, desc, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';

type PlaylistType = 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';

type PlaybackPositionPayload = {
    contentXtreamId: number;
    contentType: 'vod' | 'episode';
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    positionSeconds: number;
    durationSeconds?: number;
    playlistType?: PlaylistType;
};

async function ensurePlaylistExists(
    db: AppDatabase,
    playlistId: string,
    playlistType: PlaylistType = 'stalker'
): Promise<void> {
    const existing = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, playlistId))
        .limit(1);

    if (existing.length === 0) {
        await db.insert(schema.playlists).values({
            id: playlistId,
            name: 'Imported Playlist',
            type: playlistType,
        });
    }
}

export async function savePlaybackPosition(
    db: AppDatabase,
    playlistId: string,
    data: PlaybackPositionPayload
): Promise<{ success: boolean }> {
    await ensurePlaylistExists(db, playlistId, data.playlistType);

    const values = {
        playlistId,
        contentXtreamId: data.contentXtreamId,
        contentType: data.contentType,
        seriesXtreamId: data.seriesXtreamId,
        seasonNumber: data.seasonNumber,
        episodeNumber: data.episodeNumber,
        positionSeconds: data.positionSeconds,
        durationSeconds: data.durationSeconds,
        updatedAt: sql`CURRENT_TIMESTAMP`,
    };

    const existing = await db
        .select()
        .from(schema.playbackPositions)
        .where(
            and(
                eq(schema.playbackPositions.playlistId, playlistId),
                eq(
                    schema.playbackPositions.contentXtreamId,
                    data.contentXtreamId
                ),
                eq(schema.playbackPositions.contentType, data.contentType)
            )
        )
        .limit(1);

    if (existing.length > 0) {
        await db
            .update(schema.playbackPositions)
            .set(values)
            .where(eq(schema.playbackPositions.id, existing[0].id));
    } else {
        await db.insert(schema.playbackPositions).values(values);
    }

    return { success: true };
}

export async function getPlaybackPosition(
    db: AppDatabase,
    playlistId: string,
    contentXtreamId: number,
    contentType: 'vod' | 'episode'
) {
    const result = await db
        .select()
        .from(schema.playbackPositions)
        .where(
            and(
                eq(schema.playbackPositions.playlistId, playlistId),
                eq(schema.playbackPositions.contentXtreamId, contentXtreamId),
                eq(schema.playbackPositions.contentType, contentType)
            )
        )
        .limit(1);

    return result[0] || null;
}

export async function getSeriesPlaybackPositions(
    db: AppDatabase,
    playlistId: string,
    seriesXtreamId: number
) {
    return db
        .select()
        .from(schema.playbackPositions)
        .where(
            and(
                eq(schema.playbackPositions.playlistId, playlistId),
                eq(schema.playbackPositions.seriesXtreamId, seriesXtreamId),
                eq(schema.playbackPositions.contentType, 'episode')
            )
        );
}

export async function getRecentPlaybackPositions(
    db: AppDatabase,
    playlistId: string,
    limit = 20
) {
    return db
        .select()
        .from(schema.playbackPositions)
        .where(eq(schema.playbackPositions.playlistId, playlistId))
        .orderBy(desc(schema.playbackPositions.updatedAt))
        .limit(limit);
}

export async function getAllPlaybackPositions(
    db: AppDatabase,
    playlistId: string
) {
    return db
        .select()
        .from(schema.playbackPositions)
        .where(eq(schema.playbackPositions.playlistId, playlistId));
}

export async function clearAllPlaybackPositions(
    db: AppDatabase,
    playlistId: string
): Promise<{ success: boolean }> {
    await db
        .delete(schema.playbackPositions)
        .where(eq(schema.playbackPositions.playlistId, playlistId));

    return { success: true };
}

export async function clearPlaybackPosition(
    db: AppDatabase,
    playlistId: string,
    contentXtreamId: number,
    contentType: 'vod' | 'episode'
): Promise<{ success: boolean }> {
    await db
        .delete(schema.playbackPositions)
        .where(
            and(
                eq(schema.playbackPositions.playlistId, playlistId),
                eq(schema.playbackPositions.contentXtreamId, contentXtreamId),
                eq(schema.playbackPositions.contentType, contentType)
            )
        );

    return { success: true };
}
