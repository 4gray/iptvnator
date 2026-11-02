import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { of } from 'rxjs';
import * as schema from '@iptvnator/shared/database/schema';
import {
    SqliteActivityLocalStore,
    SqliteActivityServerStore,
} from '@iptvnator/shared/database/activity-sync';
import { parseActivityOperation } from '@iptvnator/shared/interfaces/activity-sync';
import type {
    PlaybackPositionData,
    Playlist,
    StalkerPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { ActivitySyncClient } from './activity-sync-client';
import { createPlaylistBackupService } from '../playlist-backup.service.test-helpers';

function fixture() {
    const sqlite = new Database(':memory:');
    sqlite.exec(
        readFileSync(
            resolve(
                'libs/shared/database/src/lib/testing/fixtures/v0.24.0-schema.sql'
            ),
            'utf8'
        )
    );
    sqlite.exec(`INSERT INTO playlists (id, name, type) VALUES ('synthetic-source', 'Synthetic source', 'stalker');
        INSERT INTO playback_positions (playlist_id, content_xtream_id, content_type, position_seconds) VALUES ('synthetic-source', 42, 'vod', 45);
        INSERT INTO playback_positions (playlist_id, content_xtream_id, content_type, series_xtream_id, season_number, episode_number, position_seconds, duration_seconds)
        VALUES ('synthetic-source', 43, 'episode', 100, 1, 1, 45, NULL), ('synthetic-source', 44, 'episode', 100, 1, 2, 0, 0);`);
    const db = drizzle(sqlite, { schema });
    const rows = () => db.select().from(schema.playbackPositions).all();
    return { sqlite, db, rows };
}

describe('nullable positions from historical SQLite', () => {
    afterEach(() => localStorage.clear());
    it.each(['import', 'reset'] as const)(
        'delivers a native VOD %s and subsequent playback without nullable metadata',
        async (action) => {
            const f = fixture();
            try {
                const row = f.rows()[0];
                expect(row).toMatchObject({
                    durationSeconds: null,
                    seriesXtreamId: null,
                    seasonNumber: null,
                    episodeNumber: null,
                });
                const position = row as unknown as PlaybackPositionData;
                const context = {
                    sourceId: 'synthetic-source',
                    sourceIncarnation: 'synthetic-incarnation',
                    provider: 'xtream' as const,
                };
                const local = new SqliteActivityLocalStore(
                    f.sqlite,
                    'synthetic-nas'
                );
                const server = new SqliteActivityServerStore(
                    f.sqlite,
                    () => undefined
                );
                const client = new ActivitySyncClient(local, {
                    instanceId: 'synthetic-nas',
                    deviceId: 'synthetic-device',
                    contexts: [context],
                    consent: () => 'synthetic-consent',
                    changed: () => undefined,
                    status: () => undefined,
                    request: async (request) => {
                        if (request.operation !== 'activity-apply')
                            throw new Error('Unexpected synthetic request');
                        const operation = parseActivityOperation(
                            request.activity!.operation
                        );
                        expect(operation.positionMetadata).toEqual({
                            contentXtreamId: 42,
                        });
                        return {
                            status: 200,
                            body: server.apply(
                                request.activity!.address,
                                operation
                            ),
                        };
                    },
                });
                if (action === 'import')
                    await client.importPosition(context.sourceId, position);
                else await client.reset(context.sourceId, position);
                await client.flush();
                expect(await local.pending()).toEqual([]);
                const playing = {
                    ...position,
                    activitySessionId: 'synthetic-session',
                    positionSeconds: 55,
                };
                await client.begin(context.sourceId, playing);
                await client.save(context.sourceId, playing);
                await client.flush();
                expect(await local.pending()).toEqual([]);
                expect(
                    (await client.positions(context.sourceId))[0].position
                        .positionSeconds
                ).toBe(55);
            } finally {
                f.sqlite.close();
            }
        }
    );

    it('round-trips native Stalker unknown durations and reset barriers in a multi-source archive', async () => {
        const f = fixture();
        try {
            const sources: Playlist[] = [
                'synthetic-source',
                'synthetic-unrelated',
            ].map((id) => ({
                _id: id,
                title: 'Synthetic source',
                portalUrl: `https://${id}.invalid`,
                macAddress: '00:11:22:33:44:55',
                count: 0,
                importDate: '',
                lastUsage: '',
                autoRefresh: false,
            }));
            const service = createPlaylistBackupService({
                runtime: { supportsXtreamSqliteDataSource: true },
                playlistsService: {
                    getAllData: () => of(sources),
                    restorePlaylist: (playlist: Playlist) => of(playlist),
                },
                playbackPositionService: {
                    assertSupportsAtomicReplacement: () => undefined,
                    getAllPlaybackPositionsOrThrow: async (id: string) =>
                        f.db
                            .select()
                            .from(schema.playbackPositions)
                            .where(eq(schema.playbackPositions.playlistId, id))
                            .all(),
                    replaceAllPlaybackPositions: async (
                        id: string,
                        positions: PlaybackPositionData[]
                    ) =>
                        f.sqlite.transaction(() => {
                            f.db
                                .delete(schema.playbackPositions)
                                .where(
                                    eq(schema.playbackPositions.playlistId, id)
                                )
                                .run();
                            for (const position of positions)
                                f.db
                                    .insert(schema.playbackPositions)
                                    .values({ ...position, playlistId: id })
                                    .run();
                        })(),
                },
            });
            const archive = await service.exportBackup();
            const exported = archive.manifest
                .playlists[0] as StalkerPlaylistBackupEntry;
            expect(
                exported.userState.playbackPositions?.[0].durationSeconds
            ).toBeUndefined();
            expect(
                exported.userState.playbackPositions?.[2].durationSeconds
            ).toBe(0);
            f.db.delete(schema.playbackPositions).run();
            const result = await service.importBackup(archive.json);
            expect(result.failed).toBe(0);
            expect(
                f
                    .rows()
                    .map(
                        ({
                            contentXtreamId,
                            positionSeconds,
                            durationSeconds,
                        }) => ({
                            contentXtreamId,
                            positionSeconds,
                            durationSeconds,
                        })
                    )
            ).toEqual([
                {
                    contentXtreamId: 42,
                    positionSeconds: 45,
                    durationSeconds: null,
                },
                {
                    contentXtreamId: 43,
                    positionSeconds: 45,
                    durationSeconds: null,
                },
                { contentXtreamId: 44, positionSeconds: 0, durationSeconds: 0 },
            ]);
        } finally {
            f.sqlite.close();
        }
    });
});
