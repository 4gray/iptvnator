import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import { and, eq, sql } from 'drizzle-orm';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import {
    assertDownloadMetadataMatchesContentType,
    decodeDownloadMetadataSnapshot,
    encodeDownloadMetadataSnapshot,
} from './download-metadata-snapshot';

interface DownloadMetadataResult {
    success: boolean;
    error?: string;
}

const VALIDATION_ERRORS = new Set([
    'Invalid download metadata snapshot',
    'Download metadata snapshot is too large',
]);

function getSafeUpdateError(error: unknown): string {
    if (error instanceof Error && VALIDATION_ERRORS.has(error.message)) {
        return error.message;
    }
    return 'Could not update download metadata';
}

function isValidSeriesId(value: number | null): value is number {
    return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function getStoredEpisode(
    member: typeof schema.downloads.$inferSelect
): DownloadMetadataSnapshot['episode'] {
    const current = decodeDownloadMetadataSnapshot(member.metadataSnapshot);
    if (current?.episode) {
        return current.episode;
    }
    if (
        member.seasonNumber === null ||
        member.episodeNumber === null ||
        !Number.isSafeInteger(member.seasonNumber) ||
        !Number.isSafeInteger(member.episodeNumber)
    ) {
        return undefined;
    }
    return {
        episodeNumber: member.episodeNumber,
        seasonNumber: member.seasonNumber,
        title: member.title,
    };
}

export async function updateDownloadMetadataRequest(
    downloadId: number,
    metadataSnapshot: DownloadMetadataSnapshot
): Promise<DownloadMetadataResult> {
    try {
        const encoded = encodeDownloadMetadataSnapshot(metadataSnapshot);
        const normalizedMetadataSnapshot =
            decodeDownloadMetadataSnapshot(encoded);
        if (!normalizedMetadataSnapshot) {
            throw new Error('Invalid download metadata snapshot');
        }
        const db = await getDatabase();
        return db.transaction((tx) => {
            const row = tx
                .select()
                .from(schema.downloads)
                .where(eq(schema.downloads.id, downloadId))
                .limit(1)
                .get();
            if (!row) {
                return { error: 'Download not found', success: false };
            }
            assertDownloadMetadataMatchesContentType(
                normalizedMetadataSnapshot,
                row.contentType
            );

            if (
                row.contentType !== 'episode' ||
                !isValidSeriesId(row.seriesXtreamId)
            ) {
                tx.update(schema.downloads)
                    .set({
                        metadataSnapshot: encoded,
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    })
                    .where(eq(schema.downloads.id, row.id))
                    .run();
                return { success: true };
            }

            const members = tx
                .select()
                .from(schema.downloads)
                .where(
                    and(
                        eq(schema.downloads.playlistId, row.playlistId),
                        eq(schema.downloads.seriesXtreamId, row.seriesXtreamId),
                        eq(schema.downloads.contentType, row.contentType)
                    )
                )
                .all();
            const writes = members.map((member) => {
                const episode = getStoredEpisode(member);
                return {
                    id: member.id,
                    metadataSnapshot: encodeDownloadMetadataSnapshot({
                        ...normalizedMetadataSnapshot,
                        episode,
                    }),
                };
            });

            for (const write of writes) {
                tx.update(schema.downloads)
                    .set({
                        metadataSnapshot: write.metadataSnapshot,
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    })
                    .where(eq(schema.downloads.id, write.id))
                    .run();
            }
            return { success: true };
        });
    } catch (error) {
        const safeError = getSafeUpdateError(error);
        if (safeError === 'Could not update download metadata') {
            console.error('[Downloads] Error updating metadata:', error);
        }
        return { error: safeError, success: false };
    }
}
