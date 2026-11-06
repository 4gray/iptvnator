import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    getAllPlaybackPositions,
    replaceAllPlaybackPositions,
    savePlaybackPosition,
} from './playback-position.operations';

describe('atomic playback-position replacement against SQLite', () => {
    let sqlite: Database.Database;
    let db: AppDatabase;
    const replacement = [
        {
            contentXtreamId: 42,
            contentType: 'vod' as const,
            positionSeconds: 120,
            durationSeconds: 3600,
        },
        {
            contentXtreamId: 42,
            contentType: 'episode' as const,
            positionSeconds: 90,
            seriesXtreamId: 2,
            seasonNumber: 1,
            episodeNumber: 3,
        },
    ];

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        sqlite.exec(`
            CREATE TABLE playlists (${Object.values(
                getTableColumns(schema.playlists)
            )
                .map(
                    (column) =>
                        `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`
                )
                .join(', ')});
            INSERT INTO playlists (id) VALUES ('target'), ('other');
            CREATE TABLE playback_positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                content_xtream_id INTEGER NOT NULL,
                content_type TEXT NOT NULL,
                series_xtream_id INTEGER,
                season_number INTEGER,
                episode_number INTEGER,
                position_seconds INTEGER NOT NULL DEFAULT 0,
                duration_seconds INTEGER,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(content_xtream_id, playlist_id, content_type)
            );
            INSERT INTO playback_positions (playlist_id, content_xtream_id, content_type, position_seconds)
                VALUES ('target', 1, 'vod', 50), ('other', 1, 'vod', 80);
        `);
        db = drizzle(sqlite, { schema });
    });

    afterEach(() => sqlite.close());

    it('replaces only the requested playlist and keeps typed identities distinct', async () => {
        await expect(
            replaceAllPlaybackPositions(db, 'target', replacement)
        ).resolves.toEqual({ success: true });
        expect(await getAllPlaybackPositions(db, 'target')).toEqual([
            expect.objectContaining({
                ...replacement[0],
                playlistId: 'target',
            }),
            expect.objectContaining({
                ...replacement[1],
                playlistId: 'target',
            }),
        ]);
        expect(await getAllPlaybackPositions(db, 'other')).toEqual([
            expect.objectContaining({
                contentXtreamId: 1,
                positionSeconds: 80,
            }),
        ]);
        await replaceAllPlaybackPositions(db, 'target', []);
        expect(await getAllPlaybackPositions(db, 'target')).toEqual([]);
        expect(await getAllPlaybackPositions(db, 'other')).toHaveLength(1);
    });

    it('rejects restoring rows for an unregistered playlist without creating placeholder metadata', async () => {
        await expect(
            replaceAllPlaybackPositions(db, 'missing', replacement)
        ).rejects.toThrow();
        expect(
            sqlite
                .prepare("SELECT id FROM playlists WHERE id = 'missing'")
                .all()
        ).toEqual([]);
        expect(await getAllPlaybackPositions(db, 'target')).toHaveLength(1);
    });

    it('preserves last-write-wins for repeated identities in older snapshots', async () => {
        await replaceAllPlaybackPositions(db, 'target', [
            ...replacement,
            { ...replacement[0], positionSeconds: 600 },
        ]);
        expect(await getAllPlaybackPositions(db, 'target')).toEqual([
            expect.objectContaining({
                contentXtreamId: 42,
                contentType: 'vod',
                positionSeconds: 600,
            }),
            expect.objectContaining({
                contentXtreamId: 42,
                contentType: 'episode',
                positionSeconds: 90,
            }),
        ]);
    });

    it('preserves earlier episode metadata when a duplicate only updates position', async () => {
        const items = [
            { ...replacement[1], durationSeconds: 2400 },
            {
                contentXtreamId: 42,
                contentType: 'episode' as const,
                positionSeconds: 600,
            },
        ];
        // Compare with the former restore loop's actual SQLite update behavior.
        for (const item of items) await savePlaybackPosition(db, 'other', item);
        await replaceAllPlaybackPositions(db, 'target', items);
        const [restored] = await getAllPlaybackPositions(db, 'target');
        const prior = (await getAllPlaybackPositions(db, 'other')).find(
            (item) => item.contentType === 'episode'
        );
        expect(restored).toEqual(
            expect.objectContaining({
                contentXtreamId: prior?.contentXtreamId,
                contentType: 'episode',
                positionSeconds: 600,
                seriesXtreamId: prior?.seriesXtreamId,
                seasonNumber: prior?.seasonNumber,
                episodeNumber: prior?.episodeNumber,
                durationSeconds: prior?.durationSeconds,
            })
        );
        expect(prior?.seriesXtreamId).toBe(2);
    });

    it('rolls back both deletion and earlier inserts when a later insert fails', async () => {
        const before = await getAllPlaybackPositions(db, 'target');
        sqlite.exec(`CREATE TRIGGER reject_episode BEFORE INSERT ON playback_positions
            WHEN NEW.content_type = 'episode' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;`);
        await expect(
            replaceAllPlaybackPositions(db, 'target', replacement)
        ).rejects.toThrow();
        expect(await getAllPlaybackPositions(db, 'target')).toEqual(before);
        expect(await getAllPlaybackPositions(db, 'other')).toHaveLength(1);
        sqlite.exec('DROP TRIGGER reject_episode');
        await replaceAllPlaybackPositions(db, 'target', replacement);
        expect(await getAllPlaybackPositions(db, 'target')).toHaveLength(2);
    });
});
