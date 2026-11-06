# Server Storage Phase 2a: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `web-backend` an optional server storage (SQLite on a volume) and the `/v1` HTTP API the PWA will use in Phase 2b, plus the Docker changes that persist it.

**Architecture:** With `IPTVNATOR_STORAGE=server`, `main.ts` opens the shared database through `initDatabase()` (path from `IPTVNATOR_DATA_DIR`), adds one server-only table, and passes a `ServerStorage` object to `createWebBackendApp()`. New files under `apps/web-backend/src/app/storage/` hold the repositories (on the shared playlist codec from Phase 1), an in-memory ETag revision counter, an optional bearer-token guard and the Express routers. `web-backend-app.ts` gains one mounting call. The Docker image builds better-sqlite3 for the target platform, stores data under `/data` and raises nginx's body limit.

**Tech Stack:** Express 5, Drizzle ORM 0.45 with better-sqlite3 13 (Node-API), Jest 30, esbuild via `@nx/esbuild`, Docker (node:24-alpine + nginx).

Prerequisite: Phase 1 Tasks 2 and 3 are in the branch (`@iptvnator/shared/database/app-playlist`, `IPTVNATOR_DATA_DIR`).
Spec: `docs/superpowers/specs/2026-10-08-server-storage-design.md`, section 6.1.

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/shared/interfaces/src/lib/server-storage.contract.ts` | create | Shared HTTP contract types and the user-state namespace list |
| `libs/shared/interfaces/src/index.ts` | modify | Export the contract |
| `apps/web-backend/src/app/storage/storage-config.ts` | create | Read `IPTVNATOR_STORAGE`, `IPTVNATOR_ACCESS_TOKEN`, `IPTVNATOR_MAX_DOCUMENT_MB` |
| `apps/web-backend/src/app/storage/server-user-state.table.ts` | create | Drizzle table for `server_user_state` |
| `apps/web-backend/src/app/storage/server-database.ts` | create | Open the database, create the server table, instance id |
| `apps/web-backend/src/app/storage/playlist-revisions.ts` | create | ETag revisions |
| `apps/web-backend/src/app/storage/server-playlist-repository.ts` | create | Playlist documents on the shared codec |
| `apps/web-backend/src/app/storage/server-user-state-repository.ts` | create | Xtream user-state entries |
| `apps/web-backend/src/app/storage/server-storage.ts` | create | `openServerStorage()` aggregate |
| `apps/web-backend/src/app/storage/storage-route-errors.ts` | create | Error type, JSON error mapping, redacted logging |
| `apps/web-backend/src/app/storage/access-guard.ts` | create | Optional bearer-token guard |
| `apps/web-backend/src/app/storage/instance-router.ts` | create | `/v1/instance`, `/v1/instance/status` |
| `apps/web-backend/src/app/storage/playlists-router.ts` | create | `/v1/playlists` |
| `apps/web-backend/src/app/storage/user-state-router.ts` | create | `/v1/user-state`, `/v1/app-state` |
| `apps/web-backend/src/app/storage/mount-server-storage.ts` | create | Mount CORS, guard, routers, error handler |
| `apps/web-backend/src/app/storage/server-storage.spec-helpers.ts` | create | Temp-directory storage for specs |
| `apps/web-backend/src/app/storage/*.spec.ts` | create | Unit and route tests |
| `apps/web-backend/src/app/web-backend-app.ts` | modify | Options + one mount call |
| `apps/web-backend/src/main.ts` | modify | Open storage, graceful shutdown |
| `apps/web-backend/project.json` | modify | `external: ["better-sqlite3"]` |
| `docker/Dockerfile`, `docker/docker-compose.yml`, `docker/nginx.conf` | modify | Native stage, volume, env, body limit, gzip |
| `docker/README.md`, `docs/architecture/pwa-self-hosted.md`, `README.md` | modify | Document storage, token and volume |

---

### Task 1: Shared HTTP contract

**Files:**
- Create: `libs/shared/interfaces/src/lib/server-storage.contract.ts`
- Modify: `libs/shared/interfaces/src/index.ts`

- [ ] **Step 1: Create the contract**

```ts
/**
 * HTTP contract between the PWA and the self-hosted server storage. Routes
 * live under `/v1` of the web backend (`/api/v1` behind the Docker nginx).
 */
export const SERVER_STORAGE_API_VERSION = 1;

/** Xtream PWA user-data maps that the server stores per playlist id. */
export const SERVER_USER_STATE_NAMESPACES = [
    'xtream-favorites',
    'xtream-recent-items',
    'xtream-collection-items',
    'xtream-playback-positions',
] as const;

export type ServerUserStateNamespace =
    (typeof SERVER_USER_STATE_NAMESPACES)[number];

export function isServerUserStateNamespace(
    value: string
): value is ServerUserStateNamespace {
    return (SERVER_USER_STATE_NAMESPACES as readonly string[]).includes(value);
}

/**
 * Document fields that carry an M3U payload. An upsert with
 * `keepPayload=1` omits them and the server keeps the stored ones.
 */
export const SERVER_PAYLOAD_FIELDS = ['playlist', 'items', 'header'] as const;

export interface ServerInstanceInfo {
    readonly service: 'iptvnator';
    readonly apiVersion: number;
    /** Stable per database; `null` without server storage. */
    readonly instanceId: string | null;
    readonly storage: 'server' | 'none';
    readonly auth: 'none' | 'token';
}

export interface ServerStorageStatusResponse {
    readonly playlists: number;
    readonly databaseBytes: number;
    readonly databasePath: string;
    readonly startedAt: string;
}

export interface ServerUserStateResponse {
    readonly entries: Record<
        ServerUserStateNamespace,
        Record<string, unknown>
    >;
}

export interface ServerStorageErrorBody {
    readonly message: string;
    readonly status: number;
    readonly code?: string;
}
```

- [ ] **Step 2: Export it**

Append to `libs/shared/interfaces/src/index.ts`:

```ts
export * from './lib/server-storage.contract';
```

- [ ] **Step 3: Verify and commit**

```bash
pnpm nx lint shared-interfaces
pnpm run typecheck:web
git add libs/shared/interfaces/src/lib/server-storage.contract.ts libs/shared/interfaces/src/index.ts
git commit -m "feat(interfaces): add the server storage HTTP contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: no errors.

---

### Task 2: Storage configuration

**Files:**
- Create: `apps/web-backend/src/app/storage/storage-config.ts`
- Test: `apps/web-backend/src/app/storage/storage-config.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { readServerStorageConfig } from './storage-config';

describe('readServerStorageConfig', () => {
    it('keeps storage off and the API open by default', () => {
        expect(readServerStorageConfig({})).toEqual({
            enabled: false,
            accessToken: null,
            maxDocumentBytes: 64 * 1024 * 1024,
        });
    });

    it('enables storage only for IPTVNATOR_STORAGE=server', () => {
        expect(
            readServerStorageConfig({ IPTVNATOR_STORAGE: ' Server ' }).enabled
        ).toBe(true);
        expect(
            readServerStorageConfig({ IPTVNATOR_STORAGE: 'none' }).enabled
        ).toBe(false);
        expect(
            readServerStorageConfig({ IPTVNATOR_STORAGE: '1' }).enabled
        ).toBe(false);
    });

    it('reads a trimmed access token and ignores a blank one', () => {
        expect(
            readServerStorageConfig({ IPTVNATOR_ACCESS_TOKEN: ' s3cret ' })
                .accessToken
        ).toBe('s3cret');
        expect(
            readServerStorageConfig({ IPTVNATOR_ACCESS_TOKEN: '  ' })
                .accessToken
        ).toBeNull();
    });

    it('reads a positive document limit in megabytes', () => {
        expect(
            readServerStorageConfig({ IPTVNATOR_MAX_DOCUMENT_MB: '8' })
                .maxDocumentBytes
        ).toBe(8 * 1024 * 1024);
        expect(
            readServerStorageConfig({ IPTVNATOR_MAX_DOCUMENT_MB: '-1' })
                .maxDocumentBytes
        ).toBe(64 * 1024 * 1024);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=storage-config`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
export interface ServerStorageConfig {
    /** `IPTVNATOR_STORAGE=server`; the Docker image sets it. */
    readonly enabled: boolean;
    /** `IPTVNATOR_ACCESS_TOKEN`; guards every non-public route when set. */
    readonly accessToken: string | null;
    /** Largest accepted playlist document (`IPTVNATOR_MAX_DOCUMENT_MB`). */
    readonly maxDocumentBytes: number;
}

const DEFAULT_MAX_DOCUMENT_MB = 64;
const BYTES_PER_MB = 1024 * 1024;

export function readServerStorageConfig(
    env: Record<string, string | undefined> = process.env
): ServerStorageConfig {
    const mode = env['IPTVNATOR_STORAGE']?.trim().toLowerCase();
    const token = env['IPTVNATOR_ACCESS_TOKEN']?.trim();
    const megabytes = Number(env['IPTVNATOR_MAX_DOCUMENT_MB']);

    return {
        enabled: mode === 'server',
        accessToken: token ? token : null,
        maxDocumentBytes:
            (Number.isFinite(megabytes) && megabytes > 0
                ? megabytes
                : DEFAULT_MAX_DOCUMENT_MB) * BYTES_PER_MB,
    };
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
pnpm nx test web-backend --testPathPatterns=storage-config
git add apps/web-backend/src/app/storage/storage-config.ts apps/web-backend/src/app/storage/storage-config.spec.ts
git commit -m "feat(web-backend): read server storage configuration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests.

---

### Task 3: Database bootstrap, revisions and spec helper

**Files:**
- Create: `apps/web-backend/src/app/storage/server-user-state.table.ts`
- Create: `apps/web-backend/src/app/storage/server-database.ts`
- Create: `apps/web-backend/src/app/storage/playlist-revisions.ts`
- Test: `apps/web-backend/src/app/storage/playlist-revisions.spec.ts`

- [ ] **Step 1: Write the failing revisions spec**

```ts
import { PlaylistRevisions } from './playlist-revisions';

describe('PlaylistRevisions', () => {
    it('keeps an ETag until the playlist is written', () => {
        const revisions = new PlaylistRevisions('boot');

        expect(revisions.etag('a')).toBe('"boot.0.0"');
        expect(revisions.etag('a')).toBe('"boot.0.0"');
        expect(revisions.bump('a')).toBe('"boot.0.1"');
        expect(revisions.etag('a')).toBe('"boot.0.1"');
        expect(revisions.etag('b')).toBe('"boot.0.0"');
    });

    it('invalidates every ETag on reset', () => {
        const revisions = new PlaylistRevisions('boot');
        revisions.bump('a');

        revisions.reset();

        expect(revisions.etag('a')).toBe('"boot.1.0"');
        expect(revisions.etag('b')).toBe('"boot.1.0"');
    });

    it('uses a random boot id by default', () => {
        expect(new PlaylistRevisions().etag('a')).not.toBe(
            new PlaylistRevisions().etag('a')
        );
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=playlist-revisions`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement revisions**

`apps/web-backend/src/app/storage/playlist-revisions.ts`:

```ts
import { randomUUID } from 'node:crypto';

/**
 * ETags for playlist documents. The server is the only writer of its
 * database, so an in-memory counter per playlist is exact. The boot id
 * invalidates every client cache after a restart; the generation does so
 * after "delete all".
 */
export class PlaylistRevisions {
    private readonly revisions = new Map<string, number>();
    private generation = 0;

    constructor(private readonly bootId = randomUUID().slice(0, 8)) {}

    etag(playlistId: string): string {
        const revision = this.revisions.get(playlistId) ?? 0;
        return `"${this.bootId}.${this.generation}.${revision}"`;
    }

    bump(playlistId: string): string {
        this.revisions.set(
            playlistId,
            (this.revisions.get(playlistId) ?? 0) + 1
        );
        return this.etag(playlistId);
    }

    reset(): void {
        this.revisions.clear();
        this.generation += 1;
    }
}
```

- [ ] **Step 4: Implement the table and database bootstrap**

`apps/web-backend/src/app/storage/server-user-state.table.ts`:

```ts
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Server-only table: one JSON value per Xtream user-data namespace and
 * playlist. Created by `openServerDatabase`, never by the desktop app.
 */
export const SERVER_USER_STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS server_user_state (
    namespace TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (namespace, playlist_id)
)`;

export const serverUserState = sqliteTable(
    'server_user_state',
    {
        namespace: text('namespace').notNull(),
        playlistId: text('playlist_id').notNull(),
        value: text('value').notNull(),
        updatedAt: text('updated_at').notNull(),
    },
    (table) => [primaryKey({ columns: [table.namespace, table.playlistId] })]
);
```

`apps/web-backend/src/app/storage/server-database.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import {
    appState,
    closeDatabase,
    getDatabasePath,
    initDatabase,
    type DatabaseInstance,
} from '@iptvnator/shared/database';
import { SERVER_USER_STATE_TABLE_SQL } from './server-user-state.table';

const INSTANCE_ID_KEY = 'server:instance-id';

export interface ServerDatabase {
    readonly db: DatabaseInstance;
    readonly instanceId: string;
    readonly path: string;
    sizeBytes(): number;
    close(): void;
}

/**
 * Opens the shared IPTVnator database (full schema and migrations, the
 * same as the desktop app) and adds the server-only table. The path comes
 * from `IPTVNATOR_DATA_DIR`.
 */
export async function openServerDatabase(): Promise<ServerDatabase> {
    const db = await initDatabase();
    db.run(sql.raw(SERVER_USER_STATE_TABLE_SQL));
    const path = getDatabasePath();

    return {
        db,
        instanceId: ensureInstanceId(db),
        path,
        sizeBytes: () => fileSize(path) + fileSize(`${path}-wal`),
        close: () => closeDatabase(),
    };
}

function ensureInstanceId(db: DatabaseInstance): string {
    const existing = db
        .select({ value: appState.value })
        .from(appState)
        .where(eq(appState.key, INSTANCE_ID_KEY))
        .get();
    if (existing?.value) {
        return existing.value;
    }

    const instanceId = randomUUID();
    db.insert(appState)
        .values({
            key: INSTANCE_ID_KEY,
            value: instanceId,
            updatedAt: new Date().toISOString(),
        })
        .run();
    return instanceId;
}

function fileSize(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}
```

- [ ] **Step 5: Run the revisions spec and typecheck**

```bash
pnpm nx test web-backend --testPathPatterns=playlist-revisions
pnpm nx build web-backend
```

Expected: PASS (3 tests); the build succeeds (it type-checks the new files).

- [ ] **Step 6: Commit**

```bash
git add apps/web-backend/src/app/storage/server-user-state.table.ts apps/web-backend/src/app/storage/server-database.ts apps/web-backend/src/app/storage/playlist-revisions.ts apps/web-backend/src/app/storage/playlist-revisions.spec.ts
git commit -m "feat(web-backend): open the server database and track revisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Repositories and the storage aggregate

**Files:**
- Create: `apps/web-backend/src/app/storage/server-playlist-repository.ts`
- Create: `apps/web-backend/src/app/storage/server-user-state-repository.ts`
- Create: `apps/web-backend/src/app/storage/server-storage.ts`
- Create: `apps/web-backend/src/app/storage/server-storage.spec-helpers.ts`
- Test: `apps/web-backend/src/app/storage/server-playlist-repository.spec.ts`
- Test: `apps/web-backend/src/app/storage/server-user-state-repository.spec.ts`

- [ ] **Step 1: Create the spec helper**

`server-storage.spec-helpers.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPTVNATOR_DATA_DIR_ENV } from '@iptvnator/shared/database';
import { openServerStorage, type ServerStorage } from './server-storage';

/** Real SQLite in a throwaway data directory, closed and removed afterwards. */
export async function withTempStorage<T>(
    run: (storage: ServerStorage) => Promise<T> | T
): Promise<T> {
    const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-server-storage-'));
    const previous = process.env[IPTVNATOR_DATA_DIR_ENV];
    process.env[IPTVNATOR_DATA_DIR_ENV] = dataDir;
    const storage = await openServerStorage();

    try {
        return await run(storage);
    } finally {
        storage.database.close();
        if (previous === undefined) {
            delete process.env[IPTVNATOR_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_DATA_DIR_ENV] = previous;
        }
        rmSync(dataDir, { recursive: true, force: true });
    }
}

export const m3uDocument = (id: string, title = 'Family') => ({
    _id: id,
    title,
    url: `https://example.test/${id}.m3u`,
    count: 1,
    importDate: '2026-10-01T00:00:00.000Z',
    lastUsage: '2026-10-01T00:00:00.000Z',
    favorites: [],
    recentlyViewed: [],
    autoRefresh: false,
    playlist: {
        header: { raw: '#EXTM3U' },
        items: [{ id: 'a', url: 'https://example.test/a', raw: '#EXTINF:-1,A' }],
    },
});
```

- [ ] **Step 2: Write the failing repository specs**

`server-playlist-repository.spec.ts`:

```ts
import { PlaylistPayloadMissingError } from './server-playlist-repository';
import { m3uDocument, withTempStorage } from './server-storage.spec-helpers';

describe('ServerPlaylistRepository', () => {
    it('stores and reads a whole playlist document', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });

            expect(playlists.get('p1')).toMatchObject({
                _id: 'p1',
                title: 'Family',
                playlist: m3uDocument('p1').playlist,
            });
            expect(playlists.count()).toBe(1);
            expect(playlists.get('missing')).toBeNull();
        }));

    it('lists metadata without the payload', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });

            const [meta] = playlists.listMetas();

            expect(meta).toMatchObject({ _id: 'p1', title: 'Family' });
            expect(meta['playlist']).toBeUndefined();
            expect(playlists.listAll()[0]['playlist']).toEqual(
                m3uDocument('p1').playlist
            );
        }));

    it('keeps the stored payload when asked to', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });
            const { playlist: _payload, ...meta } = m3uDocument('p1');

            playlists.upsert(
                { ...meta, title: 'Renamed', favorites: ['https://example.test/a'] },
                { keepPayload: true }
            );

            expect(playlists.get('p1')).toMatchObject({
                title: 'Renamed',
                favorites: ['https://example.test/a'],
                playlist: m3uDocument('p1').playlist,
            });
        }));

    it('refuses keepPayload for an unknown playlist', () =>
        withTempStorage(({ playlists }) => {
            expect(() =>
                playlists.upsert({ _id: 'nope', title: 'x' }, { keepPayload: true })
            ).toThrow(PlaylistPayloadMissingError);
        }));

    it('deletes one or all playlists', () =>
        withTempStorage(({ playlists }) => {
            playlists.upsert(m3uDocument('p1'), { keepPayload: false });
            playlists.upsert(m3uDocument('p2'), { keepPayload: false });

            playlists.delete('p1');
            expect(playlists.listMetas().map((p) => p['_id'])).toEqual(['p2']);

            playlists.deleteAll();
            expect(playlists.count()).toBe(0);
        }));

    it('reads and writes app state', () =>
        withTempStorage(({ playlists }) => {
            expect(playlists.getAppState('flag')).toBeNull();
            playlists.setAppState('flag', '1');
            expect(playlists.getAppState('flag')).toBe('1');
        }));
});
```

`server-user-state-repository.spec.ts`:

```ts
import { withTempStorage } from './server-storage.spec-helpers';

describe('ServerUserStateRepository', () => {
    it('returns every namespace, empty by default', () =>
        withTempStorage(({ userState }) => {
            expect(userState.all()).toEqual({
                'xtream-favorites': {},
                'xtream-recent-items': {},
                'xtream-collection-items': {},
                'xtream-playback-positions': {},
            });
        }));

    it('stores, overwrites and deletes one entry', () =>
        withTempStorage(({ userState }) => {
            userState.put('xtream-favorites', 'p1', ['live:1']);
            userState.put('xtream-favorites', 'p1', ['live:2']);
            expect(userState.all()['xtream-favorites']).toEqual({
                p1: ['live:2'],
            });

            userState.delete('xtream-favorites', 'p1');
            expect(userState.all()['xtream-favorites']).toEqual({});
        }));

    it('deletes a playlist across namespaces', () =>
        withTempStorage(({ userState }) => {
            userState.put('xtream-favorites', 'p1', ['live:1']);
            userState.put('xtream-recent-items', 'p1', []);
            userState.put('xtream-favorites', 'p2', ['live:3']);

            userState.deleteForPlaylist('p1');

            const all = userState.all();
            expect(all['xtream-favorites']).toEqual({ p2: ['live:3'] });
            expect(all['xtream-recent-items']).toEqual({});
        }));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns="server-playlist-repository|server-user-state-repository"`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the playlist repository**

`server-playlist-repository.ts`:

```ts
import { eq, getTableColumns } from 'drizzle-orm';
import type { DatabaseInstance } from '@iptvnator/shared/database';
import {
    buildPlaylistRow,
    parseAppPlaylist,
    playlistConflictUpdate,
} from '@iptvnator/shared/database/app-playlist';
import { appState, playlists } from '@iptvnator/shared/database/schema';
import type { Playlist as PlaylistRow } from '@iptvnator/shared/database/schema';
import { SERVER_PAYLOAD_FIELDS } from '@iptvnator/shared/interfaces';

export type PlaylistDocument = Record<string, unknown>;

export class PlaylistPayloadMissingError extends Error {
    constructor() {
        super('No stored payload to keep');
        this.name = 'PlaylistPayloadMissingError';
    }
}

export class InvalidPlaylistDocumentError extends Error {
    constructor() {
        super('A playlist document needs an id');
        this.name = 'InvalidPlaylistDocumentError';
    }
}

const { payload: _payload, ...metaColumns } = getTableColumns(playlists);

/** Playlist documents in the shared `playlists` table, same rows as desktop. */
export class ServerPlaylistRepository {
    constructor(private readonly db: DatabaseInstance) {}

    count(): number {
        return this.db.select({ id: playlists.id }).from(playlists).all()
            .length;
    }

    listMetas(): PlaylistDocument[] {
        return this.db
            .select(metaColumns)
            .from(playlists)
            .all()
            .map((row) =>
                parseAppPlaylist({ ...row, payload: null } as PlaylistRow)
            );
    }

    listAll(): PlaylistDocument[] {
        return this.db
            .select()
            .from(playlists)
            .all()
            .map((row) => parseAppPlaylist(row));
    }

    get(playlistId: string): PlaylistDocument | null {
        const row = this.db
            .select()
            .from(playlists)
            .where(eq(playlists.id, playlistId))
            .get();
        return row ? parseAppPlaylist(row) : null;
    }

    upsert(
        document: PlaylistDocument,
        options: { readonly keepPayload: boolean }
    ): void {
        const next = options.keepPayload
            ? this.withStoredPayload(document)
            : document;
        const row = buildPlaylistRow(next);
        if (!row) {
            throw new InvalidPlaylistDocumentError();
        }

        this.db
            .insert(playlists)
            .values(row)
            .onConflictDoUpdate({
                target: playlists.id,
                set: playlistConflictUpdate(row, next),
            })
            .run();
    }

    delete(playlistId: string): void {
        this.db.delete(playlists).where(eq(playlists.id, playlistId)).run();
    }

    deleteAll(): void {
        this.db.delete(playlists).run();
    }

    getAppState(key: string): string | null {
        return (
            this.db
                .select({ value: appState.value })
                .from(appState)
                .where(eq(appState.key, key))
                .get()?.value ?? null
        );
    }

    setAppState(key: string, value: string): void {
        const updatedAt = new Date().toISOString();
        this.db
            .insert(appState)
            .values({ key, value, updatedAt })
            .onConflictDoUpdate({
                target: appState.key,
                set: { value, updatedAt },
            })
            .run();
    }

    /** Fills the payload fields the client left out from the stored row. */
    private withStoredPayload(document: PlaylistDocument): PlaylistDocument {
        const id = String(document['_id'] ?? '');
        const stored = this.db
            .select({ payload: playlists.payload })
            .from(playlists)
            .where(eq(playlists.id, id))
            .get();
        const parsed = parseStoredPayload(stored?.payload);
        if (!parsed) {
            throw new PlaylistPayloadMissingError();
        }

        const merged: PlaylistDocument = { ...document };
        for (const field of SERVER_PAYLOAD_FIELDS) {
            if (!(field in merged) && field in parsed) {
                merged[field] = parsed[field];
            }
        }
        return merged;
    }
}

function parseStoredPayload(
    payload: string | null | undefined
): PlaylistDocument | null {
    if (!payload) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(payload);
        return parsed && typeof parsed === 'object'
            ? (parsed as PlaylistDocument)
            : null;
    } catch {
        return null;
    }
}
```

- [ ] **Step 5: Implement the user-state repository**

`server-user-state-repository.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '@iptvnator/shared/database';
import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import { serverUserState } from './server-user-state.table';

/** Xtream PWA user data, one JSON value per namespace and playlist. */
export class ServerUserStateRepository {
    constructor(private readonly db: DatabaseInstance) {}

    all(): ServerUserStateResponse['entries'] {
        const entries = Object.fromEntries(
            SERVER_USER_STATE_NAMESPACES.map((namespace) => [namespace, {}])
        ) as ServerUserStateResponse['entries'];

        for (const row of this.db.select().from(serverUserState).all()) {
            const bucket =
                entries[row.namespace as ServerUserStateNamespace];
            if (bucket) {
                bucket[row.playlistId] = JSON.parse(row.value);
            }
        }
        return entries;
    }

    put(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ): void {
        const serialized = JSON.stringify(value ?? null);
        const updatedAt = new Date().toISOString();
        this.db
            .insert(serverUserState)
            .values({ namespace, playlistId, value: serialized, updatedAt })
            .onConflictDoUpdate({
                target: [serverUserState.namespace, serverUserState.playlistId],
                set: { value: serialized, updatedAt },
            })
            .run();
    }

    delete(namespace: ServerUserStateNamespace, playlistId: string): void {
        this.db
            .delete(serverUserState)
            .where(
                and(
                    eq(serverUserState.namespace, namespace),
                    eq(serverUserState.playlistId, playlistId)
                )
            )
            .run();
    }

    deleteForPlaylist(playlistId: string): void {
        this.db
            .delete(serverUserState)
            .where(eq(serverUserState.playlistId, playlistId))
            .run();
    }

    deleteAll(): void {
        this.db.delete(serverUserState).run();
    }
}
```

- [ ] **Step 6: Implement the aggregate**

`server-storage.ts`:

```ts
import { PlaylistRevisions } from './playlist-revisions';
import { openServerDatabase, type ServerDatabase } from './server-database';
import { ServerPlaylistRepository } from './server-playlist-repository';
import { ServerUserStateRepository } from './server-user-state-repository';

export interface ServerStorage {
    readonly database: ServerDatabase;
    readonly playlists: ServerPlaylistRepository;
    readonly userState: ServerUserStateRepository;
    readonly revisions: PlaylistRevisions;
    readonly startedAt: Date;
}

export async function openServerStorage(): Promise<ServerStorage> {
    const database = await openServerDatabase();
    return {
        database,
        playlists: new ServerPlaylistRepository(database.db),
        userState: new ServerUserStateRepository(database.db),
        revisions: new PlaylistRevisions(),
        startedAt: new Date(),
    };
}
```

- [ ] **Step 7: Run to verify it passes**

```bash
pnpm nx test web-backend --testPathPatterns="server-playlist-repository|server-user-state-repository"
```

Expected: PASS, 9 tests. If `initDatabase` fails to load better-sqlite3 under Node, run `node -e "new (require('better-sqlite3'))(':memory:')"`; it must succeed (Node-API binary). Do not switch the spec to the Electron runtime.

- [ ] **Step 8: Commit**

```bash
git add apps/web-backend/src/app/storage
git commit -m "feat(web-backend): playlist and user-state repositories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Errors and the access guard

**Files:**
- Create: `apps/web-backend/src/app/storage/storage-route-errors.ts`
- Create: `apps/web-backend/src/app/storage/access-guard.ts`
- Test: `apps/web-backend/src/app/storage/storage-route-errors.spec.ts`
- Test: `apps/web-backend/src/app/storage/access-guard.spec.ts`

- [ ] **Step 1: Write the failing specs**

`storage-route-errors.spec.ts`:

```ts
import {
    InvalidPlaylistDocumentError,
    PlaylistPayloadMissingError,
} from './server-playlist-repository';
import {
    describeStorageError,
    StorageRequestError,
    toStorageErrorBody,
} from './storage-route-errors';

describe('toStorageErrorBody', () => {
    it.each([
        [new StorageRequestError(404, 'not_found', 'Playlist not found.'), 404, 'not_found'],
        [new PlaylistPayloadMissingError(), 409, 'payload_missing'],
        [new InvalidPlaylistDocumentError(), 400, 'invalid_body'],
        [{ type: 'entity.too.large' }, 413, 'too_large'],
        [{ type: 'entity.parse.failed' }, 400, 'invalid_json'],
        [Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }), 503, 'storage_busy'],
        [new Error('SELECT secret FROM x'), 500, 'storage_error'],
    ])('maps %p to %i', (error, status, code) => {
        expect(toStorageErrorBody(error)).toMatchObject({ status, code });
    });

    it('never puts the raw error message into a 500 body or log line', () => {
        const error = new Error('password=hunter2');

        expect(JSON.stringify(toStorageErrorBody(error))).not.toContain(
            'hunter2'
        );
        expect(describeStorageError(error)).toBe('Error');
    });
});
```

`access-guard.spec.ts`:

```ts
import express from 'express';
import { withServer } from '../web-backend-app.spec-helpers';
import { createAccessGuard } from './access-guard';

function createApp() {
    const app = express();
    app.use(createAccessGuard('s3cret'));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/v1/instance', (_req, res) => res.json({ ok: true }));
    app.get('/v1/playlists', (_req, res) => res.json([]));
    return app;
}

describe('createAccessGuard', () => {
    it('lets public routes through', () =>
        withServer(createApp(), async (baseUrl) => {
            expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
            expect((await fetch(`${baseUrl}/v1/instance`)).status).toBe(200);
        }));

    it('rejects a missing or wrong token with a JSON 401', () =>
        withServer(createApp(), async (baseUrl) => {
            const missing = await fetch(`${baseUrl}/v1/playlists`);
            const wrong = await fetch(`${baseUrl}/v1/playlists`, {
                headers: { authorization: 'Bearer nope' },
            });

            expect(missing.status).toBe(401);
            await expect(missing.json()).resolves.toMatchObject({
                code: 'unauthorized',
            });
            expect(wrong.status).toBe(401);
        }));

    it('accepts the right token and lets preflight through', () =>
        withServer(createApp(), async (baseUrl) => {
            const ok = await fetch(`${baseUrl}/v1/playlists`, {
                headers: { authorization: 'Bearer s3cret' },
            });
            const preflight = await fetch(`${baseUrl}/v1/playlists`, {
                method: 'OPTIONS',
            });

            expect(ok.status).toBe(200);
            expect(preflight.status).not.toBe(401);
        }));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns="storage-route-errors|access-guard"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the errors module**

`storage-route-errors.ts`:

```ts
import type { ErrorRequestHandler } from 'express';
import type { ServerStorageErrorBody } from '@iptvnator/shared/interfaces';
import {
    InvalidPlaylistDocumentError,
    PlaylistPayloadMissingError,
} from './server-playlist-repository';

export class StorageRequestError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'StorageRequestError';
    }
}

export function toStorageErrorBody(error: unknown): ServerStorageErrorBody {
    if (error instanceof StorageRequestError) {
        return { message: error.message, status: error.status, code: error.code };
    }
    if (error instanceof PlaylistPayloadMissingError) {
        return {
            message: 'The server has no stored payload for this playlist.',
            status: 409,
            code: 'payload_missing',
        };
    }
    if (error instanceof InvalidPlaylistDocumentError) {
        return {
            message: 'A playlist needs an id.',
            status: 400,
            code: 'invalid_body',
        };
    }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === 'entity.too.large') {
        return {
            message: 'The request is larger than the server allows.',
            status: 413,
            code: 'too_large',
        };
    }
    if (type === 'entity.parse.failed') {
        return {
            message: 'The request body is not valid JSON.',
            status: 400,
            code: 'invalid_json',
        };
    }
    if ((error as { code?: unknown } | null)?.code === 'SQLITE_BUSY') {
        return {
            message: 'Storage is busy, try again.',
            status: 503,
            code: 'storage_busy',
        };
    }
    return { message: 'Storage request failed.', status: 500, code: 'storage_error' };
}

/**
 * Error name and code only: Drizzle and SQLite messages can carry bound
 * values such as portal credentials, which must never reach a log.
 */
export function describeStorageError(error: unknown): string {
    const name = error instanceof Error ? error.name : typeof error;
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? `${name} (${code})` : name;
}

export function storageErrorHandler(
    log: (message: string) => void = console.error
): ErrorRequestHandler {
    return (error, req, res, _next) => {
        const body = toStorageErrorBody(error);
        if (body.status >= 500) {
            const route = `${req.baseUrl}${req.route?.path ?? ''}`;
            log(
                `[web-backend] storage ${req.method} ${route} failed: ${describeStorageError(error)}`
            );
        }
        res.status(body.status).json(body);
    };
}
```

- [ ] **Step 4: Implement the guard**

`access-guard.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Routes a browser must reach before it has a token. */
const PUBLIC_PATHS = new Set(['/', '/health', '/config.js', '/v1/instance']);

/**
 * Optional shared-token protection for every other route, including the
 * provider proxy routes. Tokens are compared as SHA-256 digests so the
 * comparison is constant-time regardless of length.
 */
export function createAccessGuard(token: string): RequestHandler {
    const expected = digest(token);

    return (req, res, next) => {
        if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(req.path)) {
            next();
            return;
        }

        const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
        if (match && timingSafeEqual(digest(match[1].trim()), expected)) {
            next();
            return;
        }

        res.status(401).json({
            message: 'This IPTVnator server requires an access token.',
            status: 401,
            code: 'unauthorized',
        });
    };
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value).digest();
}
```

- [ ] **Step 5: Run to verify, then commit**

```bash
pnpm nx test web-backend --testPathPatterns="storage-route-errors|access-guard"
git add apps/web-backend/src/app/storage
git commit -m "feat(web-backend): storage error mapping and access token guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS.

---

### Task 6: Routers and mounting

**Files:**
- Create: `apps/web-backend/src/app/storage/instance-router.ts`
- Create: `apps/web-backend/src/app/storage/playlists-router.ts`
- Create: `apps/web-backend/src/app/storage/user-state-router.ts`
- Create: `apps/web-backend/src/app/storage/mount-server-storage.ts`
- Modify: `apps/web-backend/src/app/web-backend-app.ts`
- Test: `apps/web-backend/src/app/storage/storage-routes.spec.ts`

- [ ] **Step 1: Write the failing route spec**

`storage-routes.spec.ts`:

```ts
import { createWebBackendApp } from '../web-backend-app';
import {
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from '../web-backend-app.spec-helpers';
import { m3uDocument, withTempStorage } from './server-storage.spec-helpers';
import type { ServerStorage } from './server-storage';

function app(
    storage: ServerStorage | null,
    extra: { accessToken?: string; maxDocumentBytes?: number } = {}
) {
    return createWebBackendApp({
        clientOrigins: ['http://localhost:4200'],
        httpClient: new StubHttpClient(),
        resolveHostname: resolvePublicHost,
        storage,
        ...extra,
    });
}

const json = (body: unknown, init: RequestInit = {}): RequestInit => ({
    ...init,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
});

describe('server storage routes', () => {
    it('reports no storage when it is disabled', () =>
        withServer(app(null), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/v1/instance`);
            await expect(response.json()).resolves.toEqual({
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: null,
                storage: 'none',
                auth: 'none',
            });
            expect((await fetch(`${baseUrl}/v1/playlists`)).status).toBe(404);
        }));

    it('reports server storage and its status', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const instance = await (await fetch(`${baseUrl}/v1/instance`)).json();
                expect(instance).toMatchObject({
                    storage: 'server',
                    instanceId: storage.database.instanceId,
                });
                const status = await (
                    await fetch(`${baseUrl}/v1/instance/status`)
                ).json();
                expect(status).toMatchObject({ playlists: 0 });
                expect(status.databaseBytes).toBeGreaterThan(0);
            })
        ));

    it('stores a document, serves it with an ETag and answers 304', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const put = await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                expect(put.status).toBe(200);
                const etag = put.headers.get('etag');
                expect(etag).toBeTruthy();

                const get = await fetch(`${baseUrl}/v1/playlists/p1`);
                expect(get.headers.get('etag')).toBe(etag);
                await expect(get.json()).resolves.toMatchObject({ _id: 'p1' });

                const cached = await fetch(`${baseUrl}/v1/playlists/p1`, {
                    headers: { 'if-none-match': etag! },
                });
                expect(cached.status).toBe(304);
            })
        ));

    it('keeps the payload on keepPayload and refuses it for unknown ids', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                const { playlist: _payload, ...meta } = m3uDocument('p1');

                const keep = await fetch(
                    `${baseUrl}/v1/playlists/p1?keepPayload=1`,
                    json({ ...meta, title: 'Renamed' }, { method: 'PUT' })
                );
                const missing = await fetch(
                    `${baseUrl}/v1/playlists/zz?keepPayload=1`,
                    json({ title: 'x' }, { method: 'PUT' })
                );

                expect(keep.status).toBe(200);
                await expect(
                    (await fetch(`${baseUrl}/v1/playlists/p1`)).json()
                ).resolves.toMatchObject({
                    title: 'Renamed',
                    playlist: m3uDocument('p1').playlist,
                });
                expect(missing.status).toBe(409);
                await expect(missing.json()).resolves.toMatchObject({
                    code: 'payload_missing',
                });
            })
        ));

    it('lists metadata and deletes documents with their user state', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json(m3uDocument('p1'), { method: 'PUT' })
                );
                await fetch(
                    `${baseUrl}/v1/user-state/xtream-favorites/p1`,
                    json({ value: ['live:1'] }, { method: 'PUT' })
                );

                const metas = await (
                    await fetch(`${baseUrl}/v1/playlists?view=meta`)
                ).json();
                expect(metas[0].playlist).toBeUndefined();

                await fetch(`${baseUrl}/v1/playlists/p1`, { method: 'DELETE' });

                expect((await fetch(`${baseUrl}/v1/playlists/p1`)).status).toBe(404);
                const state = await (await fetch(`${baseUrl}/v1/user-state`)).json();
                expect(state.entries['xtream-favorites']).toEqual({});
            })
        ));

    it('validates user-state namespaces and stores app state', () =>
        withTempStorage((storage) =>
            withServer(app(storage), async (baseUrl) => {
                const bad = await fetch(
                    `${baseUrl}/v1/user-state/settings/p1`,
                    json({ value: 1 }, { method: 'PUT' })
                );
                expect(bad.status).toBe(400);

                await fetch(
                    `${baseUrl}/v1/app-state/flag`,
                    json({ value: '1' }, { method: 'PUT' })
                );
                await expect(
                    (await fetch(`${baseUrl}/v1/app-state/flag`)).json()
                ).resolves.toEqual({ value: '1' });
            })
        ));

    it('answers 413 above the document limit', () =>
        withTempStorage((storage) =>
            withServer(app(storage, { maxDocumentBytes: 512 }), async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/v1/playlists/p1`,
                    json({ ...m3uDocument('p1'), padding: 'x'.repeat(2048) }, { method: 'PUT' })
                );
                expect(response.status).toBe(413);
            })
        ));

    it('requires the token for storage and proxy routes when one is set', () =>
        withTempStorage((storage) =>
            withServer(app(storage, { accessToken: 's3cret' }), async (baseUrl) => {
                const instance = await (await fetch(`${baseUrl}/v1/instance`)).json();
                expect(instance.auth).toBe('token');

                expect((await fetch(`${baseUrl}/v1/playlists`)).status).toBe(401);
                expect(
                    (
                        await fetch(
                            `${baseUrl}/provider-targets`,
                            json({ url: 'http://example.test' }, { method: 'POST' })
                        )
                    ).status
                ).toBe(401);
                expect(
                    (
                        await fetch(`${baseUrl}/v1/playlists`, {
                            headers: { authorization: 'Bearer s3cret' },
                        })
                    ).status
                ).toBe(200);
            })
        ));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=storage-routes`
Expected: FAIL, the `storage` option does not exist on `WebBackendAppOptions`.

- [ ] **Step 3: Implement the routers**

`instance-router.ts`:

```ts
import { Router } from 'express';
import {
    SERVER_STORAGE_API_VERSION,
    type ServerInstanceInfo,
    type ServerStorageStatusResponse,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

export function createInstanceRouter(deps: {
    readonly storage: ServerStorage | null;
    readonly accessTokenRequired: boolean;
}): Router {
    const router = Router();

    router.get('/instance', (_req, res) => {
        const body: ServerInstanceInfo = {
            service: 'iptvnator',
            apiVersion: SERVER_STORAGE_API_VERSION,
            instanceId: deps.storage?.database.instanceId ?? null,
            storage: deps.storage ? 'server' : 'none',
            auth: deps.accessTokenRequired ? 'token' : 'none',
        };
        res.set('Cache-Control', 'no-store').json(body);
    });

    router.get('/instance/status', (_req, res) => {
        const storage = deps.storage;
        if (!storage) {
            throw new StorageRequestError(
                404,
                'storage_disabled',
                'Server storage is not enabled.'
            );
        }
        const body: ServerStorageStatusResponse = {
            playlists: storage.playlists.count(),
            databaseBytes: storage.database.sizeBytes(),
            databasePath: storage.database.path,
            startedAt: storage.startedAt.toISOString(),
        };
        res.set('Cache-Control', 'no-store').json(body);
    });

    return router;
}
```

`playlists-router.ts`:

```ts
import express, { Router, type Response } from 'express';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

export function createPlaylistsRouter(
    storage: ServerStorage,
    maxDocumentBytes: number
): Router {
    const router = Router();
    const json = express.json({ limit: maxDocumentBytes });
    const { playlists, userState, revisions } = storage;

    router.get('/playlists', (req, res) => {
        res.set('Cache-Control', 'no-store').json(
            req.query['view'] === 'meta'
                ? playlists.listMetas()
                : playlists.listAll()
        );
    });

    router.get('/playlists/:id', (req, res) => {
        const id = req.params.id;
        const etag = revisions.etag(id);
        withEtag(res, etag);
        if (req.get('if-none-match') === etag) {
            res.status(304).end();
            return;
        }
        const document = playlists.get(id);
        if (!document) {
            throw new StorageRequestError(404, 'not_found', 'Playlist not found.');
        }
        res.json(document);
    });

    router.put('/playlists/:id', json, (req, res) => {
        const id = req.params.id;
        playlists.upsert(
            { ...requireDocument(req.body), _id: id },
            { keepPayload: req.query['keepPayload'] === '1' }
        );
        withEtag(res, revisions.bump(id)).json({ success: true });
    });

    router.delete('/playlists/:id', (req, res) => {
        const id = req.params.id;
        playlists.delete(id);
        userState.deleteForPlaylist(id);
        revisions.bump(id);
        res.json({ success: true });
    });

    router.delete('/playlists', (_req, res) => {
        playlists.deleteAll();
        userState.deleteAll();
        revisions.reset();
        res.json({ success: true });
    });

    return router;
}

function withEtag(res: Response, etag: string): Response {
    return res
        .set('ETag', etag)
        .set('Access-Control-Expose-Headers', 'ETag')
        .set('Cache-Control', 'no-cache');
}

function requireDocument(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new StorageRequestError(
            400,
            'invalid_body',
            'Expected a playlist object.'
        );
    }
    return value as Record<string, unknown>;
}
```

`user-state-router.ts`:

```ts
import express, { Router } from 'express';
import {
    isServerUserStateNamespace,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

const USER_STATE_BODY_LIMIT = '8mb';

export function createUserStateRouter(storage: ServerStorage): Router {
    const router = Router();
    const json = express.json({ limit: USER_STATE_BODY_LIMIT });

    router.get('/user-state', (_req, res) => {
        res.set('Cache-Control', 'no-store').json({
            entries: storage.userState.all(),
        });
    });

    router.put('/user-state/:namespace/:playlistId', json, (req, res) => {
        const body = req.body as { value?: unknown } | undefined;
        if (!body || typeof body !== 'object' || !('value' in body)) {
            throw new StorageRequestError(400, 'invalid_body', 'Expected { value }.');
        }
        storage.userState.put(
            requireNamespace(req.params.namespace),
            req.params.playlistId,
            body.value
        );
        res.json({ success: true });
    });

    router.delete('/user-state/:namespace/:playlistId', (req, res) => {
        storage.userState.delete(
            requireNamespace(req.params.namespace),
            req.params.playlistId
        );
        res.json({ success: true });
    });

    router.get('/app-state/:key', (req, res) => {
        res.json({ value: storage.playlists.getAppState(req.params.key) });
    });

    router.put('/app-state/:key', json, (req, res) => {
        const value = (req.body as { value?: unknown } | undefined)?.value;
        if (typeof value !== 'string') {
            throw new StorageRequestError(400, 'invalid_body', 'Expected { value: string }.');
        }
        storage.playlists.setAppState(req.params.key, value);
        res.json({ success: true });
    });

    return router;
}

function requireNamespace(value: string): ServerUserStateNamespace {
    if (!isServerUserStateNamespace(value)) {
        throw new StorageRequestError(400, 'invalid_namespace', 'Unknown user-state namespace.');
    }
    return value;
}
```

`mount-server-storage.ts`:

```ts
import type { Express, RequestHandler } from 'express';
import { createAccessGuard } from './access-guard';
import { createInstanceRouter } from './instance-router';
import { createPlaylistsRouter } from './playlists-router';
import type { ServerStorage } from './server-storage';
import { storageErrorHandler } from './storage-route-errors';
import { createUserStateRouter } from './user-state-router';

export const DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ServerStorageMountOptions {
    readonly corsMiddleware: RequestHandler;
    readonly storage: ServerStorage | null;
    readonly accessToken: string | null;
    readonly maxDocumentBytes: number;
}

/**
 * Mounts `/v1` and the optional token guard. Call it before the provider
 * proxy routes are registered so the guard also covers them. With a token
 * the CORS headers apply to every route, so a cross-origin 401 stays
 * readable for the PWA in development.
 */
export function mountServerStorage(
    app: Express,
    options: ServerStorageMountOptions
): void {
    app.use('/v1', options.corsMiddleware);
    if (options.accessToken) {
        app.use(options.corsMiddleware);
        app.use(createAccessGuard(options.accessToken));
    }

    app.use(
        '/v1',
        createInstanceRouter({
            storage: options.storage,
            accessTokenRequired: !!options.accessToken,
        })
    );
    if (options.storage) {
        app.use(
            '/v1',
            createPlaylistsRouter(options.storage, options.maxDocumentBytes)
        );
        app.use('/v1', createUserStateRouter(options.storage));
    }
    app.use('/v1', storageErrorHandler());
}
```

- [ ] **Step 4: Mount it in `web-backend-app.ts`**

1. Add the import:

```ts
import {
    DEFAULT_MAX_DOCUMENT_BYTES,
    mountServerStorage,
} from './storage/mount-server-storage';
import type { ServerStorage } from './storage/server-storage';
```

2. Add to `WebBackendAppOptions`:

```ts
    /** Optional bearer token for every non-public route. */
    readonly accessToken?: string | null;
    /** Largest accepted playlist document in bytes. */
    readonly maxDocumentBytes?: number;
    /** Server storage; `null` or absent keeps the backend stateless. */
    readonly storage?: ServerStorage | null;
```

3. Directly after the `app.get('/config.js', ...)` route block and before `app.options('/provider-targets', corsMiddleware);`, add:

```ts
    mountServerStorage(app, {
        corsMiddleware,
        storage: options.storage ?? null,
        accessToken: options.accessToken ?? null,
        maxDocumentBytes:
            options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
    });
```

- [ ] **Step 5: Run the route spec and the existing suite**

```bash
pnpm nx test web-backend
pnpm nx lint web-backend
```

Expected: all pass, including the unchanged `/health` and proxy specs.

- [ ] **Step 6: Commit**

```bash
git add apps/web-backend/src/app
git commit -m "feat(web-backend): serve the /v1 server storage API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Startup, shutdown and the bundle

**Files:**
- Modify: `apps/web-backend/src/main.ts`
- Modify: `apps/web-backend/project.json`

- [ ] **Step 1: Replace `main.ts`**

```ts
import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
} from '@iptvnator/shared/host-health';
import { createWebBackendApp } from './app/web-backend-app';
import { readServerStorageConfig } from './app/storage/storage-config';
import { openServerStorage, type ServerStorage } from './app/storage/server-storage';
import { describeStorageError } from './app/storage/storage-route-errors';

async function start(): Promise<void> {
    const attemptTimeout = applyDefaultAutoSelectFamilyAttemptTimeout();
    if (attemptTimeout !== null) {
        console.log(
            `[web-backend] connection attempt timeout set to ${attemptTimeout} ms for IPv6->IPv4 fallback; pass ${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG} via NODE_OPTIONS to override`
        );
    }

    const config = readServerStorageConfig();
    let storage: ServerStorage | null = null;
    if (config.enabled) {
        try {
            storage = await openServerStorage();
            console.log(
                `[web-backend] server storage at ${storage.database.path}`
            );
        } catch (error) {
            console.error(
                `[web-backend] server storage could not open: ${describeStorageError(error)}. Check that IPTVNATOR_DATA_DIR is a writable volume.`
            );
            process.exit(1);
        }
    }

    const port = Number(process.env['PORT'] ?? 3000);
    const app = createWebBackendApp({
        storage,
        accessToken: config.accessToken,
        maxDocumentBytes: config.maxDocumentBytes,
    });
    const server = app.listen(port, () => {
        console.log(
            `IPTVnator web backend listening on http://localhost:${port}`
        );
    });

    const shutdown = () => {
        server.close(() => {
            storage?.database.close();
            process.exit(0);
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

void start();
```

- [ ] **Step 2: Keep the native module out of the bundle**

In `apps/web-backend/project.json`, `targets.build.options`, add after `"generatePackageJson": true`:

```json
                "external": ["better-sqlite3"]
```

(add the comma after `true`).

- [ ] **Step 3: Build and smoke-test the bundle**

```bash
pnpm nx build web-backend --skip-nx-cache
grep -c "require(\"better-sqlite3\")" dist/apps/web-backend/main.cjs
export TMPDATA="$(mktemp -d)"
IPTVNATOR_STORAGE=server IPTVNATOR_DATA_DIR="$TMPDATA" PORT=3399 NODE_PATH="$PWD/node_modules" node dist/apps/web-backend/main.cjs &
sleep 2
curl -s http://localhost:3399/v1/instance
curl -s -X PUT -H 'content-type: application/json' -d '{"title":"Smoke"}' http://localhost:3399/v1/playlists/smoke
curl -s "http://localhost:3399/v1/playlists?view=meta"
kill %1
ls "$TMPDATA/databases"
```

Expected: the grep prints at least `1`; `/v1/instance` reports `"storage":"server"`; the PUT answers `{"success":true}`; the list contains `"_id":"smoke"`; `iptvnator.db` exists in the temp directory.

- [ ] **Step 4: Dev server**

```bash
IPTVNATOR_STORAGE=server IPTVNATOR_DATA_DIR="$TMPDATA" pnpm nx serve web-backend &
sleep 4
curl -s http://localhost:3333/v1/instance
kill %1
```

Expected: `"storage":"server"`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-backend/src/main.ts apps/web-backend/project.json
git commit -m "feat(web-backend): open server storage on start and close on shutdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docker image, compose and nginx

**Files:**
- Modify: `docker/Dockerfile`
- Modify: `docker/docker-compose.yml`
- Modify: `docker/nginx.conf`

- [ ] **Step 1: Native build stage and runtime settings**

In `docker/Dockerfile`, insert this stage between the build stage and `FROM node:24-alpine` (the runtime stage):

```Dockerfile
# better-sqlite3 is a native addon. This stage is NOT pinned to
# $BUILDPLATFORM, so multi-arch builds produce it for each target platform.
# prebuild-install downloads a musl binary when one exists and otherwise
# compiles with the toolchain below.
FROM node:24-alpine AS native

RUN apk add --no-cache python3 make g++

WORKDIR /opt/native

COPY package.json ./root-package.json

RUN BETTER_SQLITE3_VERSION="$(node -p 'require("./root-package.json").dependencies["better-sqlite3"]')" \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "better-sqlite3@${BETTER_SQLITE3_VERSION}"
```

In the runtime stage:

1. After `ENV CLIENT_URL=http://localhost:4333` add:

```Dockerfile
ENV IPTVNATOR_STORAGE=server
ENV IPTVNATOR_DATA_DIR=/data
```

2. After `COPY --from=build /usr/src/app/dist/apps/web-backend ./web-backend` add:

```Dockerfile
COPY --from=native /opt/native/node_modules ./web-backend/node_modules
```

3. Replace `RUN chmod +x /usr/local/bin/iptvnator-entrypoint` with:

```Dockerfile
RUN chmod +x /usr/local/bin/iptvnator-entrypoint && mkdir -p /data

VOLUME ["/data"]
```

- [ ] **Step 2: Compose**

Replace `docker/docker-compose.yml` with:

```yaml
---
services:
  iptvnator:
    image: 4gray/iptvnator:latest
    build:
      context: ..
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    ports:
      - "4333:80"
    environment:
      BACKEND_URL: /api
      CLIENT_URL: http://localhost:4333
      PORT: "3000"
      IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: "0"
      # Playlists and watch data live on the server for every device.
      # Set to "none" to keep data only in each browser.
      IPTVNATOR_STORAGE: server
      # Uncomment to require a shared token before anyone can use this server.
      # IPTVNATOR_ACCESS_TOKEN: change-me
    volumes:
      - iptvnator-data:/data
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  iptvnator-data: {}
```

- [ ] **Step 3: nginx body limit and compression**

In `docker/nginx.conf`, inside `location /api/ { ... }` after `proxy_set_header X-Forwarded-Proto $scheme;`, add:

```nginx
        # Playlist documents carry whole M3U payloads (default backend
        # limit IPTVNATOR_MAX_DOCUMENT_MB=64).
        client_max_body_size 64m;
        proxy_read_timeout 120s;
        gzip on;
        gzip_proxied any;
        gzip_types application/json;
        gzip_min_length 1024;
```

- [ ] **Step 4: Validate**

```bash
docker compose -f docker/docker-compose.yml config >/dev/null && echo compose-ok
docker build -t iptvnator:server-storage-test -f docker/Dockerfile .
docker run -d --name iptvnator-storage-test -p 4334:80 -v iptvnator-storage-test:/data iptvnator:server-storage-test
sleep 8
curl -s http://localhost:4334/api/v1/instance
docker restart iptvnator-storage-test && sleep 8
curl -s http://localhost:4334/api/v1/instance
docker rm -f iptvnator-storage-test && docker volume rm iptvnator-storage-test
```

Expected: `compose-ok`; the image builds; both `/api/v1/instance` calls report `"storage":"server"` with the same `instanceId` (the volume persisted the database). If no Docker daemon is available, report the skipped steps and rely on `docker.yml` in CI (`gh workflow run docker.yml --ref <branch> -f push=false`).

- [ ] **Step 5: Commit**

```bash
git add docker
git commit -m "feat(docker): persist server storage on a volume

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation and the pull request

**Files:**
- Modify: `docker/README.md`
- Modify: `docs/architecture/pwa-self-hosted.md`
- Modify: `README.md`

- [ ] **Step 1: `docker/README.md`**

1. In the runtime variables table, add rows:

```markdown
| `IPTVNATOR_STORAGE`         | `server` in the image   | `server` keeps playlists and watch data in SQLite under `IPTVNATOR_DATA_DIR`; `none` keeps the backend stateless.                           |
| `IPTVNATOR_DATA_DIR`        | `/data` in the image    | Data root; the database is `<root>/databases/iptvnator.db`. Mount a volume here.                                                              |
| `IPTVNATOR_ACCESS_TOKEN`    | unset                   | When set, every route except `/`, `/health`, `/config.js` and `/v1/instance` requires `Authorization: Bearer <token>`, proxy routes included. |
| `IPTVNATOR_MAX_DOCUMENT_MB` | `64`                    | Largest playlist document the backend accepts. Keep nginx `client_max_body_size` in step.                                                    |
```

2. Add a section "Server storage" after "Runtime Configuration":

```markdown
## Server storage

The image stores playlists, M3U and Stalker favorites and history, and Xtream
favorites, history and playback positions in SQLite on the `/data` volume, so
every device that opens the instance sees the same library. Provider
credentials are stored unencrypted in that database, like the desktop app
does. Do not expose an instance with server storage to the internet without
`IPTVNATOR_ACCESS_TOKEN` or authentication in your reverse proxy.

Back up the volume like any database: stop the container or copy
`databases/iptvnator.db` together with its `-wal` file.
```

3. In "PWA Limitations", change the bullet about IndexedDB to: "Without server storage (`IPTVNATOR_STORAGE=none`), playlist metadata stays in each browser's IndexedDB and Xtream user data in its localStorage."

- [ ] **Step 2: `docs/architecture/pwa-self-hosted.md`**

1. In "Web Backend", add the `/v1` routes from spec section 6.1 to the route list and a paragraph: "Server storage lives in `apps/web-backend/src/app/storage/`. It reuses `initDatabase()` and the shared playlist codec; `server_user_state` is the only server-only table. Storage errors are logged by error name and route only."
2. In "Docker Runtime", list the new defaults `IPTVNATOR_STORAGE=server` and `IPTVNATOR_DATA_DIR=/data` and the native build stage.
3. In "Validation", add `pnpm nx test web-backend --testPathPatterns=storage`.

- [ ] **Step 3: `README.md`**

In "Self-hosted PWA", add one sentence after the compose command: "The container keeps playlists and watch progress on its `/data` volume, so every device that opens it shares one library; see `docker/README.md` for the access token."

- [ ] **Step 4: Gate and push**

```bash
pnpm nx run-many -t test,lint -p web-backend shared-interfaces database
pnpm nx build web-backend
pnpm run typecheck:ci
pnpm run typecheck:spec
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
```

Expected: all pass. Then run the local review gate, push and open the PR:

```bash
git push -u origin claude/server-storage-backend
gh pr create --title "feat(self-hosted): server storage API in web-backend" --label no-release-note --body "$(cat <<'EOF'
Adds optional server storage to web-backend (#305), not yet used by the PWA (phase 2b).

- `IPTVNATOR_STORAGE=server` opens the shared SQLite database under `IPTVNATOR_DATA_DIR`.
- `/v1` API: instance, playlists (ETag, keepPayload), user-state, app-state.
- Optional `IPTVNATOR_ACCESS_TOKEN` guards every non-public route, proxy included.
- Docker: native better-sqlite3 stage per target platform, `/data` volume, nginx body limit and gzip.

No release note yet: nothing user-visible until the PWA uses it in the next PR.

Spec: docs/superpowers/specs/2026-10-08-server-storage-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
