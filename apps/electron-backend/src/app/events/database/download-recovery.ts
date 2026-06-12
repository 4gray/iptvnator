import { inArray, sql } from 'drizzle-orm';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { cleanupStaleDownloadFiles } from './stale-download-files';

export async function resetStaleDownloads(): Promise<void> {
    try {
        const db = await getDatabase();
        const staleDownloads = await db
            .select({
                filePath: schema.downloads.filePath,
                id: schema.downloads.id,
            })
            .from(schema.downloads)
            .where(inArray(schema.downloads.status, ['queued', 'downloading']));
        const ownedReservations = staleDownloads.filter(
            (item) => item.filePath
        );

        cleanupStaleDownloadFiles(ownedReservations);
        await db
            .update(schema.downloads)
            .set({
                errorMessage: 'Download interrupted by application restart',
                status: 'failed',
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(inArray(schema.downloads.status, ['queued', 'downloading']));

        if (ownedReservations.length > 0) {
            await db
                .update(schema.downloads)
                .set({ filePath: null })
                .where(
                    inArray(
                        schema.downloads.id,
                        ownedReservations.map((item) => item.id)
                    )
                );
        }
        console.log('[Downloads] Reset stale downloads');
    } catch (error) {
        console.error('[Downloads] Error resetting stale downloads:', error);
    }
}
