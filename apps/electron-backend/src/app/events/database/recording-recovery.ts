import { eq } from 'drizzle-orm';
import { statSync } from 'fs';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

function recordedFileSize(filePath: string): number | null {
    try {
        const stats = statSync(filePath);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
}

/**
 * Startup repair for recordings the previous app run left in status
 * 'recording' (hard kill, crash, power loss). mpv muxes MPEG-TS
 * continuously, so a file with real bytes is a playable partial recording
 * ('interrupted'); an absent or empty file means nothing usable was captured
 * ('failed').
 */
export async function reconcileStaleRecordings(): Promise<void> {
    try {
        const db = await getDatabase();
        const stale = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.status, 'recording'));

        for (const row of stale) {
            const fileSize = recordedFileSize(row.filePath);
            const playable = fileSize !== null && fileSize > 0;
            await db
                .update(schema.recordings)
                .set({
                    status: playable ? 'interrupted' : 'failed',
                    fileSizeBytes: playable ? fileSize : null,
                    endedAt: row.endedAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                })
                .where(eq(schema.recordings.id, row.id));
        }
    } catch (error) {
        console.error('[Recordings] Stale-recording repair failed:', error);
    }
}
