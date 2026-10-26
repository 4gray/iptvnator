import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import { parseAppPlaylist } from '@iptvnator/shared/database/app-playlist';
import type { Playlist as PlaylistRow } from '@iptvnator/shared/database/schema';

/** Explicit read of the retained original profile; never changes/migrates it. */
export function readStandaloneSources() {
    const filename = join(getIptvnatorDataRoot(), 'databases', 'iptvnator.db');
    if (!existsSync(filename)) return [];
    const sqlite = new Database(filename, {
        readonly: true,
        fileMustExist: true,
    });
    try {
        const table = sqlite
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='playlists'"
            )
            .get();
        if (!table) return [];
        return (
            sqlite.prepare('SELECT * FROM playlists').all() as Record<
                string,
                unknown
            >[]
        ).map((row) =>
            parseAppPlaylist(
                Object.fromEntries(
                    Object.entries(row).map(([key, value]) => [
                        key.replace(/_([a-z])/g, (_match, letter: string) =>
                            letter.toUpperCase()
                        ),
                        value,
                    ])
                ) as PlaylistRow
            )
        );
    } finally {
        sqlite.close();
    }
}
