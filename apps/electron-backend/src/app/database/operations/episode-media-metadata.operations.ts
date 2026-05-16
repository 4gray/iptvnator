import { and, eq } from 'drizzle-orm';
import * as schema from 'database-schema';
import type { MediaStreamMetadata } from 'shared-interfaces';
import type { AppDatabase } from '../database.types';

export interface EpisodeMediaMetadataPayload {
    playlistId: string;
    seriesXtreamId: number;
    episodeXtreamId: number;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    metadata: MediaStreamMetadata;
}

export interface EpisodeMediaMetadataRow {
    playlistId: string;
    seriesXtreamId: number;
    episodeXtreamId: number;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    mediaMetadata: MediaStreamMetadata;
    mediaMetadataUpdatedAt: number;
}

function normalizeNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function parseMediaMetadata(value: unknown): MediaStreamMetadata | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    try {
        return JSON.parse(value) as MediaStreamMetadata;
    } catch {
        return null;
    }
}

function mapRow(row: typeof schema.episodeMediaMetadata.$inferSelect) {
    const mediaMetadata = parseMediaMetadata(row.mediaMetadata);
    if (!mediaMetadata) {
        return null;
    }

    return {
        playlistId: row.playlistId,
        seriesXtreamId: row.seriesXtreamId,
        episodeXtreamId: row.episodeXtreamId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        mediaMetadata,
        mediaMetadataUpdatedAt: row.mediaMetadataUpdatedAt,
    } satisfies EpisodeMediaMetadataRow;
}

export async function setEpisodeMediaMetadata(
    db: AppDatabase,
    payload: EpisodeMediaMetadataPayload
): Promise<{ success: boolean }> {
    const seriesXtreamId = normalizeNumber(payload.seriesXtreamId);
    const episodeXtreamId = normalizeNumber(payload.episodeXtreamId);
    if (!payload.playlistId || !seriesXtreamId || !episodeXtreamId) {
        return { success: false };
    }

    const now = Date.now();
    const row = {
        playlistId: payload.playlistId,
        seriesXtreamId,
        episodeXtreamId,
        seasonNumber: normalizeNumber(payload.seasonNumber),
        episodeNumber: normalizeNumber(payload.episodeNumber),
        mediaMetadata: JSON.stringify(payload.metadata),
        mediaMetadataUpdatedAt: now,
    };

    await db
        .insert(schema.episodeMediaMetadata)
        .values(row)
        .onConflictDoUpdate({
            target: [
                schema.episodeMediaMetadata.playlistId,
                schema.episodeMediaMetadata.seriesXtreamId,
                schema.episodeMediaMetadata.episodeXtreamId,
            ],
            set: {
                seasonNumber: row.seasonNumber,
                episodeNumber: row.episodeNumber,
                mediaMetadata: row.mediaMetadata,
                mediaMetadataUpdatedAt: row.mediaMetadataUpdatedAt,
            },
        });

    return { success: true };
}

export async function getEpisodeMediaMetadataForSeries(
    db: AppDatabase,
    playlistId: string,
    seriesXtreamId: number
): Promise<EpisodeMediaMetadataRow[]> {
    const seriesId = normalizeNumber(seriesXtreamId);
    if (!playlistId || !seriesId) {
        return [];
    }

    const rows = await db
        .select()
        .from(schema.episodeMediaMetadata)
        .where(
            and(
                eq(schema.episodeMediaMetadata.playlistId, playlistId),
                eq(schema.episodeMediaMetadata.seriesXtreamId, seriesId)
            )
        );

    const mappedRows: EpisodeMediaMetadataRow[] = [];
    for (const row of rows) {
        const mapped = mapRow(row);
        if (mapped) {
            mappedRows.push(mapped);
        }
    }

    return mappedRows;
}

export async function clearEpisodeMediaMetadata(
    db: AppDatabase
): Promise<{ success: boolean }> {
    await db.delete(schema.episodeMediaMetadata).run();
    return { success: true };
}
