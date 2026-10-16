import type Database from 'better-sqlite3';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
    appState,
    buildPlaylistRow,
    categories,
    closeDatabase,
    content,
    epgChannels,
    epgChannelSources,
    epgPrograms,
    favorites,
    getDatabasePath,
    initDatabase,
    playbackPositions,
    playlists,
    recentlyViewed,
} from '@iptvnator/shared/database';

import {
    epgChannelRows,
    epgProgramRows,
    expectedRowCounts,
    favoriteRows,
    historyRows,
    LARGE_LIBRARY_MANIFEST_FILE_NAME,
    LARGE_LIBRARY_MANIFEST_PREFIX,
    LARGE_LIBRARY_PROFILE_VERSION,
    m3uPlaylistDocument,
    playbackPositionRows,
    portalCategories,
    portalContent,
    resolveLargeLibraryProfileSpec,
    stalkerPlaylistDocument,
    xtreamPlaylistDocument,
    xtreamPlaylistId,
    type LargeLibraryProfileManifest,
    type LargeLibraryProfileSpec,
} from './large-library-profile';

/**
 * Writes the large-library profile into the data directory named by
 * `IPTVNATOR_E2E_DATA_DIR`, through the app's own database code:
 * `initDatabase()` creates the schema and runs every migration exactly as a
 * launch does, and the rows go in through Drizzle with the app's table
 * definitions, so a renamed column fails here instead of producing a
 * profile the app would not have written. The last line on stdout is the
 * manifest as JSON, prefixed with `MANIFEST_PREFIX`.
 *
 * Runs under Electron as Node (`ELECTRON_RUN_AS_NODE=1 electron --import
 * tsx <this file> <cache key>`), because better-sqlite3 is built for
 * Electron's ABI; `large-library-profile-cache.ts` spawns it. Nothing
 * imports this module: loading it pulls the native module into the process.
 */
/** 500 rows at 7-11 columns stays far below SQLite's 32,766 parameters. */
const BATCH_ROWS = 500;

function chunk<T>(rows: Iterable<T>, size: number): T[][] {
    const batches: T[][] = [];
    let current: T[] = [];
    for (const row of rows) {
        current.push(row);
        if (current.length === size) {
            batches.push(current);
            current = [];
        }
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

async function generateLargeLibraryProfile(
    outputDirectory: string,
    cacheKey: string,
    spec: LargeLibraryProfileSpec
): Promise<LargeLibraryProfileManifest> {
    const startedAt = performance.now();
    const phasesMs: Record<string, number> = {};
    const timed = <T>(phase: string, work: () => T): T => {
        const at = performance.now();
        const result = work();
        phasesMs[phase] = Math.round(performance.now() - at);
        return result;
    };
    // The app's schema and migrations, as on a first launch.
    const db = await initDatabase();
    phasesMs['initDatabase'] = Math.round(performance.now() - startedAt);
    const sqlite = rawConnection(db);
    // Durability is restored before the checkpoint below; the template is
    // thrown away on any failure.
    sqlite.pragma('synchronous = OFF');
    const inTransaction = <T>(work: () => T): T => sqlite.transaction(work)();

    timed('playlists', () => {
        const documents = [
            ...Array.from({ length: spec.xtreamPortals }, (_, portal) =>
                xtreamPlaylistDocument(portal)
            ),
            ...Array.from({ length: spec.stalkerPortals }, (_, portal) =>
                stalkerPlaylistDocument(portal, spec)
            ),
        ];
        inTransaction(() => {
            for (const document of documents) {
                db.insert(playlists).values(rowOf(document)).run();
            }
        });
        // One transaction per M3U source: a large payload is one row.
        for (let playlist = 0; playlist < spec.m3uPlaylists; playlist += 1) {
            const document = m3uPlaylistDocument(playlist, spec);
            inTransaction(() => {
                db.insert(playlists).values(rowOf(document)).run();
            });
        }
    });

    timed('categories', () => {
        inTransaction(() => {
            for (let portal = 0; portal < spec.xtreamPortals; portal += 1) {
                for (const batch of chunk(
                    portalCategories(portal, spec),
                    BATCH_ROWS
                )) {
                    db.insert(categories).values(batch).run();
                }
            }
        });
    });

    timed('content', () => {
        for (let portal = 0; portal < spec.xtreamPortals; portal += 1) {
            inTransaction(() => {
                for (const batch of chunk(
                    portalContent(portal, spec),
                    BATCH_ROWS
                )) {
                    db.insert(content).values(batch).run();
                }
            });
            process.stderr.write(
                `[large-library] catalog ${portal + 1}/${spec.xtreamPortals}\n`
            );
        }
    });

    timed('activity', () => {
        inTransaction(() => {
            for (const batch of chunk(favoriteRows(spec), BATCH_ROWS)) {
                db.insert(favorites).values(batch).run();
            }
            for (const batch of chunk(historyRows(spec), BATCH_ROWS)) {
                db.insert(recentlyViewed)
                    .values(
                        batch.map(
                            ({ id, contentId, playlistId, viewedAt }) => ({
                                id,
                                contentId,
                                playlistId,
                                viewedAt,
                            })
                        )
                    )
                    .run();
            }
            for (const batch of chunk(playbackPositionRows(spec), BATCH_ROWS)) {
                db.insert(playbackPositions).values(batch).run();
            }
        });
    });

    timed('epg', () => {
        inTransaction(() => {
            for (const batch of chunk(epgChannelRows(spec), BATCH_ROWS)) {
                db.insert(epgChannels).values(batch).run();
                db.insert(epgChannelSources)
                    .values(
                        batch.map((channel, index) => ({
                            channelId: channel.id,
                            sourceUrl: channel.sourceUrl,
                            displayName: channel.displayName,
                            writeOrder: index,
                        }))
                    )
                    .run();
            }
            for (const batch of chunk(epgProgramRows(spec), BATCH_ROWS)) {
                db.insert(epgPrograms).values(batch).run();
            }
        });
    });

    timed('appState', () => {
        inTransaction(() => {
            const rows = [
                { key: 'm3u-playlists-indexeddb-to-sqlite-v1', value: '1' },
                { key: 'playlists-electron-backend-profile-v1', value: '1' },
            ];
            for (let portal = 0; portal < spec.xtreamPortals; portal += 1) {
                for (const type of ['live', 'movie', 'series']) {
                    rows.push({
                        key: `xtream-import-status:${xtreamPlaylistId(portal)}:${type}`,
                        value: 'completed',
                    });
                }
            }
            for (const batch of chunk(rows, BATCH_ROWS)) {
                db.insert(appState).values(batch).run();
            }
        });
    });

    const counts = timed('verify', () => countRows(sqlite, spec));
    sqlite.pragma('synchronous = NORMAL');
    timed('checkpoint', () => {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
    });
    const sqliteVersion = (
        sqlite.prepare('SELECT sqlite_version() AS version').get() as {
            version: string;
        }
    ).version;
    const databasePath = getDatabasePath();
    closeDatabase();
    const manifest: LargeLibraryProfileManifest = {
        cacheKey,
        counts,
        databaseBytes: statSync(databasePath).size,
        electron: process.versions.electron ?? 'unknown',
        generationMs: Math.round(performance.now() - startedAt),
        phasesMs,
        spec,
        sqlite: sqliteVersion,
        version: LARGE_LIBRARY_PROFILE_VERSION,
    };
    writeFileSync(
        join(outputDirectory, LARGE_LIBRARY_MANIFEST_FILE_NAME),
        `${JSON.stringify(manifest, null, 2)}\n`
    );
    return manifest;
}

/** Drizzle keeps the driver under `$client`; the shared type omits it. */
function rawConnection(db: unknown): Database.Database {
    const client = (db as { $client?: unknown }).$client as
        Database.Database | undefined;
    if (typeof client?.pragma !== 'function') {
        throw new Error('large-library-raw-connection-missing');
    }
    return client;
}

function rowOf(document: Record<string, unknown>) {
    const row = buildPlaylistRow(document);
    if (row === null) {
        throw new Error('large-library-playlist-row-invalid');
    }
    return row;
}

/** Fails loudly when the database does not hold exactly the rows described. */
function countRows(
    sqlite: { prepare(sql: string): { get(): unknown } },
    spec: LargeLibraryProfileSpec
): Record<string, number> {
    const expected = expectedRowCounts(spec);
    const counts: Record<string, number> = {};
    for (const table of Object.keys(expected)) {
        if (table === 'm3uChannels') continue;
        const row = sqlite
            .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
            .get() as { count: number };
        counts[table] = row.count;
        if (row.count !== expected[table]) {
            throw new Error(
                `large-library-row-count-${table}: ${row.count} !== ${expected[table]}`
            );
        }
    }
    counts['m3uChannels'] = expected['m3uChannels'] as number;
    return counts;
}

async function main(): Promise<void> {
    const cacheKey = process.argv[2];
    const outputDirectory = process.env['IPTVNATOR_E2E_DATA_DIR'];
    if (!cacheKey || !outputDirectory) {
        throw new Error(
            'usage: IPTVNATOR_E2E_DATA_DIR=<dir> large-library-profile-generator <cache key>'
        );
    }
    const manifest = await generateLargeLibraryProfile(
        outputDirectory,
        cacheKey,
        resolveLargeLibraryProfileSpec(process.env)
    );
    process.stdout.write(
        `${LARGE_LIBRARY_MANIFEST_PREFIX}${JSON.stringify(manifest)}\n`
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
