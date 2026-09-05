import { eq } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { buildPlaylistRow } from './playlist.operations';

export const PLAYLIST_MIGRATION_KEY = 'm3u-playlists-indexeddb-to-sqlite-v1';
export const LEGACY_PROFILE_MIGRATION_KEY =
    'playlists-electron-backend-profile-v1';

/** All rows and the receipt commit together; retries never replay a finished import. */
export function migrateAppPlaylists(
    db: AppDatabase,
    playlists: Record<string, unknown>[],
    key = PLAYLIST_MIGRATION_KEY
): { success: boolean; count: number } {
    try {
        return db.transaction((tx) => {
            if (
                tx
                    .select()
                    .from(schema.appState)
                    .where(eq(schema.appState.key, key))
                    .get()?.value === '1'
            ) {
                return { success: true, count: 0 };
            }
            if (!Array.isArray(playlists))
                throw new Error('Invalid legacy playlists');
            const ids = new Set<string>();
            let count = 0;
            for (const playlist of playlists) {
                const row = buildPlaylistRow(playlist);
                if (!row || ids.has(row.id))
                    throw new Error('Invalid legacy playlist');
                ids.add(row.id);
                const existing = tx
                    .select()
                    .from(schema.playlists)
                    .where(eq(schema.playlists.id, row.id))
                    .get();
                // A payload identifies an authoritative application source. A
                // v0.19 cache-only row can gain its legacy metadata without
                // replacing any catalog/favorite/history rows.
                if (existing?.payload) continue;
                const merged = {
                    ...row,
                    // Cache-only credentials can be stale: v0.19 edited the
                    // authoritative source in IndexedDB without updating SQLite.
                    dateCreated: existing?.dateCreated ?? row.dateCreated,
                    lastUpdated: row.lastUpdated ?? existing?.lastUpdated,
                };
                tx.insert(schema.playlists)
                    .values(merged)
                    .onConflictDoUpdate({
                        target: schema.playlists.id,
                        set: merged,
                    })
                    .run();
                count++;
            }
            tx.insert(schema.appState)
                .values({ key, value: '1' })
                .onConflictDoUpdate({
                    target: schema.appState.key,
                    set: { value: '1' },
                })
                .run();
            return { success: true, count };
        });
    } catch {
        // Drizzle errors can include SQL parameter values (portal credentials).
        throw new Error(
            'Legacy playlist migration failed; original data was retained'
        );
    }
}
