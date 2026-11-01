import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Playlist, SourceDefinition } from '@iptvnator/shared/interfaces';
import {
    sourceFingerprint,
    sourceFromPlaylist,
} from '@iptvnator/shared/interfaces/source-definition';
import type { PlaylistDocument } from './server-playlist-repository';

export function initializeActivitySources(sqlite: Database.Database): void {
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS activity_source_context (
            source_id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL, incarnation TEXT NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS activity_source_deleted AFTER DELETE ON playlists
            BEGIN DELETE FROM activity_source_context WHERE source_id = OLD.id; END;
    `);
}

export function activitySourceFingerprint(source: SourceDefinition): string {
    return createHash('sha256').update(sourceFingerprint(source)).digest('hex');
}

/** Called inside the source write transaction, including unobserved A → B → A changes. */
export function retireChangedActivitySource(
    sqlite: Database.Database,
    sourceId: string,
    read: () => PlaylistDocument | null
): void {
    const previous = sqlite
        .prepare(
            'SELECT fingerprint FROM activity_source_context WHERE source_id = ?'
        )
        .get(sourceId) as { fingerprint: string } | undefined;
    if (!previous) return;
    let fingerprint: string | undefined;
    try {
        const document = read();
        if (document) {
            const source = sourceFromPlaylist(
                document as unknown as Playlist,
                false
            );
            if (source.kind === 'xtream' || source.kind === 'stalker')
                fingerprint = activitySourceFingerprint(source);
        }
    } catch {
        // Invalid or unsupported replacement identities cannot retain an old activity scope.
    }
    if (fingerprint !== previous.fingerprint)
        sqlite
            .prepare('DELETE FROM activity_source_context WHERE source_id = ?')
            .run(sourceId);
}
