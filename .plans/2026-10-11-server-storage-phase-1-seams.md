# Server Storage Phase 1: Storage Seams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the code for server-backed storage without changing any behavior: share the playlist row codec, let the database root come from `IPTVNATOR_DATA_DIR`, route `PlaylistsService` storage selection through one resolver, and route Xtream PWA user data through an injectable storage.

**Architecture:** Four independent refactors. (1) The `playlists` row codec moves from `apps/electron-backend` into `libs/shared/database`, re-exported from its old module. (2) `path-utils` learns `IPTVNATOR_DATA_DIR`. (3) A new `PlaylistStorageBackend` in `libs/services` decides between the Electron bridge and IndexedDB; `PlaylistsService` asks it instead of reading `window.electron` and `supportsSqlite`. (4) A `USER_DATA_STORAGE` injection token defaults to `localStorage`; `PwaCollectionStorage` and `PwaXtreamDataSource` use it.

**Tech Stack:** Angular 22 (signals, `inject`), Drizzle ORM 0.45 on better-sqlite3 13, Jest 30 via `@nx/jest`, Nx 23.

Spec: `docs/superpowers/specs/2026-10-08-server-storage-design.md`. Overview: `.plans/2026-10-11-server-storage.md`.

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/shared/database/src/lib/app-playlist-codec.ts` | create | `buildPlaylistRow`, `parseAppPlaylist`, type constants and JSON helpers |
| `libs/shared/database/src/lib/app-playlist-conflict.ts` | create | `playlistConflictUpdate`, `readPayloadServerTimezone` |
| `libs/shared/database/src/lib/app-playlist.ts` | create | Sub-entry barrel for the two modules |
| `libs/shared/database/src/lib/app-playlist-codec.spec.ts` | create | Codec round trip and type inference |
| `libs/shared/database/src/index.ts` | modify | Export the sub-entry |
| `tsconfig.base.json` | modify | Alias `@iptvnator/shared/database/app-playlist` |
| `apps/electron-backend/src/app/database/operations/playlist.operations.ts` | modify | Import the codec, drop the moved code |
| `apps/electron-backend/src/app/database/operations/playlist-server-timezone.operations.ts` | modify | Re-export moved functions |
| `libs/shared/database/src/lib/path-utils.ts` | modify | `IPTVNATOR_DATA_DIR` |
| `libs/shared/database/src/lib/path-utils.spec.ts` | modify | Cover the variable and its precedence |
| `libs/shared/database/README.md` | modify | Document the variable |
| `libs/services/src/lib/playlist-storage-backend.ts` | create | `PlaylistDocumentStore` type, `PlaylistStorageBackend` resolver |
| `libs/services/src/lib/playlist-storage-backend.spec.ts` | create | Resolver tests |
| `libs/services/src/lib/playlists.service.ts` | modify | Use the resolver |
| `libs/services/src/lib/playlists.service.spec.ts`, `playlists.service.inventory-read.spec.ts`, `playlist-migration.spec.ts` | modify | Stub the resolver instead of `runtime` |
| `libs/services/src/lib/user-data-storage.ts` | create | `USER_DATA_STORAGE` token |
| `libs/services/src/index.ts` | modify | Export the two new modules |
| `libs/portal/xtream/data-access/src/lib/data-sources/pwa-collection-storage.ts` | modify | Constructor takes the storage |
| `libs/portal/xtream/data-access/src/lib/data-sources/pwa-xtream-data-source.ts` | modify | Inject the token |
| `libs/portal/xtream/data-access/src/lib/data-sources/pwa-xtream-data-source.spec.ts` | modify | Prove the token is used |

---

### Task 1: Prepare the worktree

**Files:** none.

- [ ] **Step 1: Install and verify discovery**

Run from the worktree root:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects | grep -E '^(database|services|electron-backend|portal-xtream-data-access|web-backend)$'
node tools/testing/ensure-electron-binary.mjs
```

Expected: install finishes with exit 0, the grep prints all five project names, and the Electron binary check reports the pinned version.

- [ ] **Step 2: Record the baseline**

```bash
pnpm nx test database
pnpm nx test services --testPathPatterns=playlist
pnpm nx test electron-backend --testPathPatterns=playlist
```

Expected: all pass. If something fails before any change, stop and report it; do not fix unrelated failures in this branch.

---

### Task 2: Move the playlist row codec into `libs/shared/database`

**Files:**
- Create: `libs/shared/database/src/lib/app-playlist-codec.ts`
- Create: `libs/shared/database/src/lib/app-playlist-conflict.ts`
- Create: `libs/shared/database/src/lib/app-playlist.ts`
- Create: `libs/shared/database/src/lib/app-playlist-codec.spec.ts`
- Modify: `libs/shared/database/src/index.ts`
- Modify: `tsconfig.base.json` (paths block, next to `@iptvnator/shared/database/schema`)
- Modify: `apps/electron-backend/src/app/database/operations/playlist.operations.ts`
- Modify: `apps/electron-backend/src/app/database/operations/playlist-server-timezone.operations.ts`

- [ ] **Step 1: Write the failing codec spec**

Create `libs/shared/database/src/lib/app-playlist-codec.spec.ts`:

```ts
import {
    buildPlaylistRow,
    parseAppPlaylist,
    PLAYLIST_TYPES,
} from './app-playlist-codec';
import type { NewPlaylist, Playlist as PlaylistRow } from './schema';

/** What SQLite hands back for a row written from `row`. */
function storedRow(row: NewPlaylist, payload?: string | null): PlaylistRow {
    const nullable = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value ?? null])
    );
    return {
        dateCreated: '2026-10-01 00:00:00',
        ...nullable,
        payload: payload === undefined ? (row.payload ?? null) : payload,
    } as PlaylistRow;
}

describe('app playlist codec', () => {
    const m3uDocument = {
        _id: 'm3u-1',
        title: 'Family',
        url: 'https://example.test/list.m3u',
        count: 1,
        importDate: '2026-10-01T00:00:00.000Z',
        lastUsage: '2026-10-02T00:00:00.000Z',
        favorites: ['https://example.test/a'],
        recentlyViewed: [],
        autoRefresh: true,
        hiddenGroupTitles: ['Adult'],
        playlist: {
            header: { raw: '#EXTM3U' },
            items: [
                {
                    id: 'a',
                    url: 'https://example.test/a',
                    raw: '#EXTINF:-1,A',
                },
            ],
        },
    };

    it('round-trips an M3U document through a stored row', () => {
        const row = buildPlaylistRow(m3uDocument);

        expect(row).toMatchObject({
            id: 'm3u-1',
            name: 'Family',
            type: PLAYLIST_TYPES.M3U_URL,
            url: 'https://example.test/list.m3u',
            autoRefresh: true,
            count: 1,
        });
        expect(parseAppPlaylist(storedRow(row!))).toMatchObject({
            _id: 'm3u-1',
            title: 'Family',
            favorites: ['https://example.test/a'],
            hiddenGroupTitles: ['Adult'],
            playlist: m3uDocument.playlist,
        });
    });

    it('reads metadata from columns when the payload is not selected', () => {
        const row = buildPlaylistRow(m3uDocument)!;
        const meta = parseAppPlaylist(storedRow(row, null));

        expect(meta).toMatchObject({
            _id: 'm3u-1',
            title: 'Family',
            count: 1,
            favorites: ['https://example.test/a'],
            url: 'https://example.test/list.m3u',
        });
        expect(meta['playlist']).toBeUndefined();
    });

    it('infers the provider type from the document', () => {
        expect(
            buildPlaylistRow({ _id: 'x', serverUrl: 'http://panel.test' })
                ?.type
        ).toBe(PLAYLIST_TYPES.XTREAM);
        expect(
            buildPlaylistRow({
                _id: 's',
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://portal.test/c',
            })
        ).toMatchObject({
            type: PLAYLIST_TYPES.STALKER,
            url: 'http://portal.test/c',
        });
        expect(
            buildPlaylistRow({ _id: 'f', filePath: '/tmp/list.m3u' })?.type
        ).toBe(PLAYLIST_TYPES.M3U_FILE);
        expect(buildPlaylistRow({ _id: 't' })?.type).toBe(
            PLAYLIST_TYPES.M3U_TEXT
        );
    });

    it('refuses a document without an id', () => {
        expect(buildPlaylistRow({ title: 'No id' })).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test database --testPathPatterns=app-playlist-codec`
Expected: FAIL, `Cannot find module './app-playlist-codec'`.

- [ ] **Step 3: Create the codec**

Create `libs/shared/database/src/lib/app-playlist-codec.ts`. The function bodies are moved unchanged from `playlist.operations.ts`; only `PlaylistType` is renamed `AppPlaylistType` and four symbols gain `export`.

```ts
/**
 * Row codec for the `playlists` table. The whole renderer `Playlist`
 * document is stored as JSON in `payload`; the fields that metadata reads
 * need are projected into columns. The Electron database worker and the
 * self-hosted web backend both use this module, so both write the same rows.
 */
import * as schema from './schema';

export const PLAYLIST_TYPES = {
    XTREAM: 'xtream',
    STALKER: 'stalker',
    M3U_FILE: 'm3u-file',
    M3U_TEXT: 'm3u-text',
    M3U_URL: 'm3u-url',
} as const;

export type AppPlaylistType =
    (typeof PLAYLIST_TYPES)[keyof typeof PLAYLIST_TYPES];

const PLAYLIST_TYPE_VALUES = new Set<AppPlaylistType>(
    Object.values(PLAYLIST_TYPES)
);

function getStringValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function getNumericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

export function parseJsonValue<T>(
    value: string | null | undefined,
    fallback: T
): T {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value) as T;
    } catch (error) {
        console.warn('Failed to parse JSON value from DB:', error);
        return fallback;
    }
}

function getStringArrayValue(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
}

function inferPlaylistType(playlist: Record<string, unknown>): AppPlaylistType {
    const explicitType = getStringValue(playlist.type);
    if (
        explicitType &&
        PLAYLIST_TYPE_VALUES.has(explicitType as AppPlaylistType)
    ) {
        return explicitType as AppPlaylistType;
    }

    if (getStringValue(playlist.serverUrl)) {
        return PLAYLIST_TYPES.XTREAM;
    }

    if (getStringValue(playlist.macAddress)) {
        return PLAYLIST_TYPES.STALKER;
    }

    if (getStringValue(playlist.filePath)) {
        return PLAYLIST_TYPES.M3U_FILE;
    }

    if (getStringValue(playlist.url)) {
        return PLAYLIST_TYPES.M3U_URL;
    }

    return PLAYLIST_TYPES.M3U_TEXT;
}

export function buildPlaylistRow(
    playlist: Record<string, unknown>
): schema.NewPlaylist | null {
    const id = getStringValue(playlist._id) ?? getStringValue(playlist.id);
    if (!id) {
        return null;
    }

    const type = inferPlaylistType(playlist);
    const portalUrl = getStringValue(playlist.portalUrl);
    const url = getStringValue(playlist.url);
    const nowIso = new Date().toISOString();
    const updateDate = getNumericValue(playlist.updateDate);

    return {
        id,
        name:
            getStringValue(playlist.title) ??
            getStringValue(playlist.name) ??
            id,
        serverUrl: getStringValue(playlist.serverUrl),
        username: getStringValue(playlist.username),
        password: getStringValue(playlist.password),
        lastUpdated:
            typeof updateDate === 'number'
                ? new Date(updateDate).toISOString()
                : getStringValue(playlist.lastUpdated),
        type,
        userAgent: getStringValue(playlist.userAgent),
        origin: getStringValue(playlist.origin),
        referrer: getStringValue(playlist.referrer),
        filePath: getStringValue(playlist.filePath),
        epgUrls:
            playlist.epgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.epgUrls))
                : undefined,
        detectedEpgUrls:
            playlist.detectedEpgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.detectedEpgUrls))
                : undefined,
        manualEpgUrls:
            playlist.manualEpgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.manualEpgUrls))
                : undefined,
        disabledEpgUrls:
            playlist.disabledEpgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.disabledEpgUrls))
                : undefined,
        autoRefresh: Boolean(playlist.autoRefresh),
        macAddress: getStringValue(playlist.macAddress),
        url: type === PLAYLIST_TYPES.STALKER ? (portalUrl ?? url) : url,
        portalUrl,
        count: getNumericValue(playlist.count),
        importDate: getStringValue(playlist.importDate),
        updateDate,
        position: getNumericValue(playlist.position),
        favorites:
            playlist.favorites !== undefined
                ? JSON.stringify(playlist.favorites)
                : undefined,
        recentlyViewed:
            playlist.recentlyViewed !== undefined
                ? JSON.stringify(playlist.recentlyViewed)
                : undefined,
        payload: JSON.stringify(playlist),
        lastUsage: getStringValue(playlist.lastUsage) ?? nowIso,
    };
}

export function getPlaylistItemCount(
    playlist: Record<string, unknown>
): number | undefined {
    try {
        const value = playlist.playlist;
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const items = Reflect.get(value, 'items');
        return Array.isArray(items) ? items.length : undefined;
    } catch {
        return undefined;
    }
}

export function parseAppPlaylist(
    row: schema.Playlist
): Record<string, unknown> {
    const payload = parseJsonValue<Record<string, unknown> | null>(
        row.payload,
        null
    );
    const base = payload && typeof payload === 'object' ? payload : {};
    const favorites = parseJsonValue<unknown[]>(row.favorites, []);
    const recentlyViewed = parseJsonValue<unknown[]>(row.recentlyViewed, []);
    const epgUrls = getStringArrayValue(
        row.epgUrls ? parseJsonValue<unknown[]>(row.epgUrls, []) : base.epgUrls
    );
    const detectedEpgUrls = getStringArrayValue(
        row.detectedEpgUrls
            ? parseJsonValue<unknown[]>(row.detectedEpgUrls, [])
            : (base.detectedEpgUrls ?? epgUrls)
    );
    const manualEpgUrls = getStringArrayValue(
        row.manualEpgUrls
            ? parseJsonValue<unknown[]>(row.manualEpgUrls, [])
            : base.manualEpgUrls
    );
    const disabledEpgUrls = getStringArrayValue(
        row.disabledEpgUrls
            ? parseJsonValue<unknown[]>(row.disabledEpgUrls, [])
            : base.disabledEpgUrls
    );
    const importDate =
        row.importDate ?? row.dateCreated ?? new Date().toISOString();
    const portalUrl =
        row.portalUrl ?? (row.type === PLAYLIST_TYPES.STALKER ? row.url : null);
    const updateDate =
        row.updateDate ??
        (row.lastUpdated ? new Date(row.lastUpdated).getTime() : undefined);

    return {
        ...base,
        _id: row.id,
        title:
            getStringValue(base.title) ?? getStringValue(base.name) ?? row.name,
        count: row.count ?? getNumericValue(base.count) ?? 0,
        importDate: getStringValue(base.importDate) ?? importDate,
        lastUsage:
            row.lastUsage ??
            getStringValue(base.lastUsage) ??
            getStringValue(base.importDate) ??
            importDate,
        favorites,
        recentlyViewed,
        autoRefresh: row.autoRefresh ?? Boolean(base.autoRefresh),
        url:
            row.type === PLAYLIST_TYPES.M3U_URL
                ? (row.url ?? getStringValue(base.url))
                : getStringValue(base.url),
        filePath: row.filePath ?? getStringValue(base.filePath),
        epgUrls,
        detectedEpgUrls,
        manualEpgUrls,
        disabledEpgUrls,
        userAgent: row.userAgent ?? getStringValue(base.userAgent),
        referrer: row.referrer ?? getStringValue(base.referrer),
        origin: row.origin ?? getStringValue(base.origin),
        updateDate,
        position: row.position ?? getNumericValue(base.position),
        serverUrl: row.serverUrl ?? getStringValue(base.serverUrl),
        username: row.username ?? getStringValue(base.username),
        password: row.password ?? getStringValue(base.password),
        macAddress: row.macAddress ?? getStringValue(base.macAddress),
        portalUrl: portalUrl ?? getStringValue(base.portalUrl),
    };
}
```

- [ ] **Step 4: Create the conflict module**

Create `libs/shared/database/src/lib/app-playlist-conflict.ts`. Bodies move unchanged from `playlist-server-timezone.operations.ts`.

```ts
/**
 * The `DO UPDATE` half of an app-playlist upsert and the payload clock
 * reader. See `playlist-server-timezone.operations.ts` in the Electron
 * backend for the conditional writers that complete this contract
 * (issue #1562).
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';

export type PlaylistConflictUpdate = {
    [K in keyof schema.NewPlaylist]?: schema.NewPlaylist[K] | SQL;
};

const stored = schema.playlists;

/**
 * A full upsert is built from a snapshot the caller read earlier; when that
 * snapshot carries no panel clock while the stored row does, the stored
 * clock is carried over as long as the row still points at the same panel.
 * A snapshot that carries its own clock, or moves the source, wins as is.
 * Nested CASE, not AND: SQLite may reorder AND terms, and the json_* readers
 * raise on a malformed payload unless json_valid ran first.
 */
export function playlistConflictUpdate(
    row: schema.NewPlaylist,
    playlist: Record<string, unknown>
): PlaylistConflictUpdate {
    if (readString(playlist.serverTimezone)) {
        return row;
    }
    const excludedPayload = sql.raw(`excluded.${stored.payload.name}`);
    const payload = sql`CASE
        WHEN json_valid(${stored.payload})
        THEN CASE
            WHEN json_type(${stored.payload}, '$.serverTimezone') = 'text'
                AND ${stored.serverUrl} IS excluded.${sql.raw(stored.serverUrl.name)}
                AND ${stored.username} IS excluded.${sql.raw(stored.username.name)}
                AND ${stored.password} IS excluded.${sql.raw(stored.password.name)}
            THEN json_set(
                ${excludedPayload},
                '$.serverTimezone',
                json_extract(${stored.payload}, '$.serverTimezone')
            )
            ELSE ${excludedPayload}
        END
        ELSE ${excludedPayload}
    END`;
    return { ...row, payload };
}

/** The clock stored in a raw row's payload. */
export function readPayloadServerTimezone(
    payload: string | null | undefined
): string | undefined {
    if (!payload) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(payload);
        return parsed && typeof parsed === 'object'
            ? readString((parsed as Record<string, unknown>).serverTimezone)
            : undefined;
    } catch {
        return undefined;
    }
}

function readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}
```

- [ ] **Step 5: Create the sub-entry and wire the aliases**

Create `libs/shared/database/src/lib/app-playlist.ts`:

```ts
export * from './app-playlist-codec';
export * from './app-playlist-conflict';
```

Append to `libs/shared/database/src/index.ts`:

```ts
export * from './lib/app-playlist';
```

In `tsconfig.base.json`, add this entry directly after the `"@iptvnator/shared/database/schema"` entry:

```json
"@iptvnator/shared/database/app-playlist": [
    "libs/shared/database/src/lib/app-playlist.ts"
],
```

- [ ] **Step 6: Run the codec spec**

Run: `pnpm nx test database --testPathPatterns=app-playlist-codec`
Expected: PASS, 4 tests.

- [ ] **Step 7: Point the Electron operations at the shared codec**

In `apps/electron-backend/src/app/database/operations/playlist-server-timezone.operations.ts`:

1. Delete the `PlaylistConflictUpdate` type, `playlistConflictUpdate`, `readPayloadServerTimezone` and `readString` (with their doc comments).
2. Add below the imports:

```ts
export {
    playlistConflictUpdate,
    readPayloadServerTimezone,
    type PlaylistConflictUpdate,
} from '@iptvnator/shared/database/app-playlist';
```

3. If the `SQL` type import is now unused, change `import { sql, type SQL } from 'drizzle-orm';` to `import { sql } from 'drizzle-orm';`.

In `apps/electron-backend/src/app/database/operations/playlist.operations.ts`:

1. Delete the local `PLAYLIST_TYPES` constant, the `PlaylistType` alias, `PLAYLIST_TYPE_VALUES`, and the functions `getStringValue`, `getNumericValue`, `parseJsonValue`, `getStringArrayValue`, `inferPlaylistType`, `buildPlaylistRow`, `getPlaylistItemCount` and `parseAppPlaylist`. Keep `getFavoriteChannelMatch` and the two `*PhaseCapture` interfaces.
2. Add after the existing imports:

```ts
import {
    buildPlaylistRow,
    getPlaylistItemCount,
    parseAppPlaylist,
    parseJsonValue,
    PLAYLIST_TYPES,
    type AppPlaylistType,
} from '@iptvnator/shared/database/app-playlist';

// Kept for existing importers (specs, playlist-migration.operations.ts).
export {
    buildPlaylistRow,
    parseAppPlaylist,
} from '@iptvnator/shared/database/app-playlist';
```

3. In `createPlaylist`, change `type: playlist.type as PlaylistType,` to `type: playlist.type as AppPlaylistType,`.

- [ ] **Step 8: Verify nothing else referenced the deleted locals**

Run:

```bash
pnpm run typecheck:backend
pnpm nx lint electron-backend
pnpm nx lint database
```

Expected: no errors. If ESLint reports an unused import in either Electron file, remove that import.

- [ ] **Step 9: Run the affected suites**

```bash
pnpm nx test database
pnpm nx test electron-backend --testPathPatterns="playlist|migration|timezone"
```

Expected: PASS, same counts as the Task 1 baseline plus the 4 new codec tests.

- [ ] **Step 10: Commit**

```bash
git add libs/shared/database tsconfig.base.json apps/electron-backend/src/app/database/operations/playlist.operations.ts apps/electron-backend/src/app/database/operations/playlist-server-timezone.operations.ts
git commit -m "refactor(database): share the playlist row codec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `IPTVNATOR_DATA_DIR`

**Files:**
- Modify: `libs/shared/database/src/lib/path-utils.ts`
- Modify: `libs/shared/database/src/lib/path-utils.spec.ts`
- Modify: `libs/shared/database/README.md`

- [ ] **Step 1: Write the failing tests**

In `path-utils.spec.ts`:

1. Add `IPTVNATOR_DATA_DIR_ENV` to the import list from `./path-utils`.
2. In `beforeEach`, after the E2E variable is saved and deleted, add:

```ts
        originalDataDirValue = process.env[IPTVNATOR_DATA_DIR_ENV];
        delete process.env[IPTVNATOR_DATA_DIR_ENV];
```

and declare `let originalDataDirValue: string | undefined;` next to `originalEnvValue`.
3. In `afterEach`, before `rmSync`, add:

```ts
        if (originalDataDirValue === undefined) {
            delete process.env[IPTVNATOR_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_DATA_DIR_ENV] = originalDataDirValue;
        }
```

4. Add these tests inside the `describe`:

```ts
    it('uses and creates IPTVNATOR_DATA_DIR as the data root', () => {
        const dataDir = join(tempRoot, 'volume');
        process.env[IPTVNATOR_DATA_DIR_ENV] = ` ${dataDir} `;

        expect(getIptvnatorDataRoot()).toBe(dataDir);
        expect(existsSync(dataDir)).toBe(true);
        expect(getIptvnatorDatabasePath()).toBe(
            join(dataDir, 'databases', 'iptvnator.db')
        );
    });

    it('lets the E2E override win over IPTVNATOR_DATA_DIR', () => {
        const e2eDir = join(tempRoot, 'e2e');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDir;
        process.env[IPTVNATOR_DATA_DIR_ENV] = join(tempRoot, 'volume');

        expect(getIptvnatorDataRoot()).toBe(e2eDir);
    });

    it('ignores a blank IPTVNATOR_DATA_DIR', () => {
        process.env[IPTVNATOR_DATA_DIR_ENV] = '   ';

        expect(getIptvnatorDataRoot()).toBe(
            join(tempRoot, 'home', '.iptvnator')
        );
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test database --testPathPatterns=path-utils`
Expected: FAIL, `IPTVNATOR_DATA_DIR_ENV` is not exported.

- [ ] **Step 3: Implement**

In `path-utils.ts`, add after `IPTVNATOR_E2E_DATA_DIR_ENV`:

```ts
/**
 * Data root for deployments that keep the database on a mounted volume, such
 * as the self-hosted web backend in Docker (`/data`). The E2E override wins.
 */
export const IPTVNATOR_DATA_DIR_ENV = 'IPTVNATOR_DATA_DIR';
```

Replace `getIptvnatorDataRoot` with:

```ts
export function getIptvnatorDataRoot(): string {
    const e2eDataDir = process.env[IPTVNATOR_E2E_DATA_DIR_ENV]?.trim();

    if (e2eDataDir) {
        return ensureDirectory(e2eDataDir);
    }

    const dataDir = process.env[IPTVNATOR_DATA_DIR_ENV]?.trim();

    if (dataDir) {
        return ensureDirectory(dataDir);
    }

    return ensureDirectory(join(homedir(), '.iptvnator'));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test database --testPathPatterns=path-utils`
Expected: PASS.

- [ ] **Step 5: Document**

In `libs/shared/database/README.md`, replace the "Database Location" section body with:

```markdown
The SQLite database is stored at `<data root>/databases/iptvnator.db`. The data
root is resolved in this order:

1. `IPTVNATOR_E2E_DATA_DIR` (E2E runs only)
2. `IPTVNATOR_DATA_DIR` (deployments with a mounted volume, such as the
   self-hosted web backend in Docker, which sets `/data`)
3. `~/.iptvnator`
```

- [ ] **Step 6: Commit**

```bash
git add libs/shared/database/src/lib/path-utils.ts libs/shared/database/src/lib/path-utils.spec.ts libs/shared/database/README.md
git commit -m "feat(database): read the data root from IPTVNATOR_DATA_DIR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `PlaylistStorageBackend` resolver

**Files:**
- Create: `libs/services/src/lib/playlist-storage-backend.ts`
- Create: `libs/services/src/lib/playlist-storage-backend.spec.ts`
- Modify: `libs/services/src/index.ts`

- [ ] **Step 1: Write the failing spec**

Create `libs/services/src/lib/playlist-storage-backend.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { PlaylistStorageBackend } from './playlist-storage-backend';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

describe('PlaylistStorageBackend', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        testWindow.electron = originalElectron;
        TestBed.resetTestingModule();
    });

    function create(supportsSqlite: boolean) {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsSqlite },
                },
            ],
        });
        return TestBed.inject(PlaylistStorageBackend);
    }

    it('uses the Electron bridge when the SQLite bridge is complete', () => {
        const bridge = { dbGetAppPlaylists: jest.fn() };
        testWindow.electron = bridge;

        const backend = create(true);

        expect(backend.kind()).toBe('electron');
        expect(backend.documentStore()).toBe(bridge);
    });

    it('uses IndexedDB without the SQLite bridge', () => {
        testWindow.electron = { dbGetAppPlaylists: jest.fn() };

        const backend = create(false);

        expect(backend.kind()).toBe('indexeddb');
        expect(backend.documentStore()).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=playlist-storage-backend`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `libs/services/src/lib/playlist-storage-backend.ts`:

```ts
import { inject, Injectable } from '@angular/core';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

/**
 * Whole-playlist document persistence. The Electron preload implements it
 * over the database worker; the self-hosted server storage implements the
 * same contract over HTTP (phase 2b).
 */
export type PlaylistDocumentStore = Pick<
    ElectronBridgeApi,
    | 'dbDeleteAllPlaylists'
    | 'dbDeletePlaylist'
    | 'dbGetAppPlaylist'
    | 'dbGetAppPlaylists'
    | 'dbGetAppState'
    | 'dbSetAppState'
    | 'dbUpsertAppPlaylist'
    | 'dbUpsertAppPlaylists'
> &
    Partial<
        Pick<
            ElectronBridgeApi,
            | 'dbGetAppPlaylistFavoriteChannels'
            | 'dbGetAppPlaylistMetas'
            | 'dbMigrateAppPlaylists'
            | 'dbRecoverLegacyPlaylists'
        >
    >;

export type PlaylistStorageKind = 'electron' | 'indexeddb';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);

    kind(): PlaylistStorageKind {
        return this.runtime.supportsSqlite ? 'electron' : 'indexeddb';
    }

    /** The document store for `kind()`, or `null` for IndexedDB. */
    documentStore(): PlaylistDocumentStore | null {
        if (this.kind() !== 'electron' || typeof window === 'undefined') {
            return null;
        }
        return (window.electron as PlaylistDocumentStore | undefined) ?? null;
    }
}
```

Add to `libs/services/src/index.ts`, after `export * from './lib/playlists.service';`:

```ts
export * from './lib/playlist-storage-backend';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test services --testPathPatterns=playlist-storage-backend`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/playlist-storage-backend.ts libs/services/src/lib/playlist-storage-backend.spec.ts libs/services/src/index.ts
git commit -m "refactor(services): add the playlist storage backend resolver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `PlaylistsService` asks the resolver

**Files:**
- Modify: `libs/services/src/lib/playlists.service.ts`
- Modify: `libs/services/src/lib/playlists.service.spec.ts`
- Modify: `libs/services/src/lib/playlists.service.inventory-read.spec.ts`
- Modify: `libs/services/src/lib/playlist-migration.spec.ts`

This is a rename plus three guard changes. Behavior is identical because the resolver only returns `electron` or `indexeddb` in this phase.

- [ ] **Step 1: Switch the three specs to a resolver stub (they fail first)**

In `playlists.service.spec.ts`, inside `describe('PlaylistsService', ...)` before `createService`, add:

```ts
    function hasSqliteBridge(): boolean {
        const electron = testWindow.electron as
            Record<string, unknown> | undefined;
        return (
            !!electron &&
            typeof electron['dbGetAppPlaylists'] === 'function' &&
            typeof electron['dbUpsertAppPlaylist'] === 'function' &&
            typeof electron['dbGetAppState'] === 'function' &&
            typeof electron['dbSetAppState'] === 'function'
        );
    }

    const testStorageBackend = {
        kind: () => (hasSqliteBridge() ? 'electron' : 'indexeddb'),
        documentStore: () => (hasSqliteBridge() ? testWindow.electron : null),
    };
```

In `createService`, replace the whole `runtime: { get supportsSqlite() { ... } },` property with:

```ts
            storageBackend: testStorageBackend,
```

In the test `owns one worker deletion and waits for cleanup before completion`, replace

```ts
        Object.defineProperties(service, {
            isElectronStorageAvailable: { value: true },
            electronApi: { value: { dbDeletePlaylist: jest.fn() } },
        });
```

with

```ts
        Object.assign(service, {
            storageBackend: {
                kind: () => 'electron',
                documentStore: () => ({ dbDeletePlaylist: jest.fn() }),
            },
        });
```

Then search the file for any other use of the old names and convert it the same way:

```bash
grep -n "isElectronStorageAvailable\|electronApi\|supportsSqlite" libs/services/src/lib/playlists.service.spec.ts
```

Expected after editing: no matches.

In `playlists.service.inventory-read.spec.ts` and `playlist-migration.spec.ts`, replace `runtime: { supportsSqlite: true },` with:

```ts
            storageBackend: {
                kind: () => 'electron',
                documentStore: () => window.electron,
            },
```

- [ ] **Step 2: Run the specs to verify they fail**

Run: `pnpm nx test services --testPathPatterns="playlists.service|playlist-migration"`
Expected: FAIL. The service still reads `this.runtime.supportsSqlite`, which the stubs no longer provide, so Electron-path tests take the IndexedDB branch.

- [ ] **Step 3: Apply the mechanical rename**

Run from the worktree root (Perl handles word boundaries the same on macOS and Linux):

```bash
perl -pi -e '
  s/const electron = this\.electronApi;/const store = this.documentStore;/g;
  s/this\.electronApi\b/this.documentStore/g;
  s/\belectron(\??\.db)/store$1/g;
  s/\(!electron\)/(!store)/g;
  s/\(electron\)/(store)/g;
  s/!electron \|\|/!store ||/g;
  s/= electron$/= store/;
  s/return electron$/return store/;
  s/this\.isElectronStorageAvailable\b/this.usesDocumentStore/g;
' libs/services/src/lib/playlists.service.ts
perl -ne 'print "$.: $_" if /\belectron\b/' libs/services/src/lib/playlists.service.ts
```

Expected output of the last command: only the import line `} from './database-electron.service';`, the `PlaylistStorageWindow` type lines and the old getter body (removed in Step 4).

- [ ] **Step 4: Replace the storage types and getters**

1. Delete the `PlaylistStorageElectronApi` type and the `PlaylistStorageWindow` type near the top of the file.
2. Add to the imports:

```ts
import {
    PlaylistDocumentStore,
    PlaylistStorageBackend,
} from './playlist-storage-backend';
```

3. Remove `import { RuntimeCapabilitiesService } from './runtime-capabilities.service';` and the field `private readonly runtime = inject(RuntimeCapabilitiesService);`, then add the field:

```ts
    private readonly storageBackend = inject(PlaylistStorageBackend);
```

4. Replace the old `electronApi` and `isElectronStorageAvailable` getters with:

```ts
    /** Electron bridge or server store; `null` means IndexedDB. */
    private get documentStore(): PlaylistDocumentStore | null {
        return this.storageBackend.documentStore();
    }

    private get usesDocumentStore(): boolean {
        return this.storageBackend.kind() !== 'indexeddb';
    }

    /** Desktop-only paths: legacy IndexedDB import, worker deletion. */
    private get usesElectronStorage(): boolean {
        return this.storageBackend.kind() === 'electron';
    }
```

- [ ] **Step 5: Narrow the three Electron-only guards**

1. In `ensureElectronPlaylistMigrations`, change the first guard to:

```ts
        if (!this.usesElectronStorage) {
            return;
        }
```

2. In `migrateIndexedDbPlaylistsToSqlite`, replace the first two lines of the body (`const store = this.documentStore;` and `if (!store) return;`) with:

```ts
        const store = this.documentStore;
        if (!store?.dbMigrateAppPlaylists) return;
```

3. In `deletePlaylist`, change `if (options) {` to:

```ts
                            if (options && this.usesElectronStorage) {
```

4. In `getM3uFavoriteChannels`, change the condition line `!this.usesDocumentStore ||` to:

```ts
            !this.usesElectronStorage ||
```

- [ ] **Step 6: Typecheck, lint and test**

```bash
pnpm run typecheck:web
pnpm nx lint services
pnpm nx test services
```

Expected: no type or lint errors; all `services` tests pass with the same count as the Task 1 baseline plus 2.

- [ ] **Step 7: Commit**

```bash
git add libs/services/src/lib/playlists.service.ts libs/services/src/lib/playlists.service.spec.ts libs/services/src/lib/playlists.service.inventory-read.spec.ts libs/services/src/lib/playlist-migration.spec.ts
git commit -m "refactor(services): resolve playlist storage through one backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `USER_DATA_STORAGE` for Xtream PWA user data

**Files:**
- Create: `libs/services/src/lib/user-data-storage.ts`
- Modify: `libs/services/src/index.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/data-sources/pwa-collection-storage.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/data-sources/pwa-xtream-data-source.ts`
- Modify: `libs/portal/xtream/data-access/src/lib/data-sources/pwa-xtream-data-source.spec.ts`

- [ ] **Step 1: Write the failing test**

In `pwa-xtream-data-source.spec.ts`, add `USER_DATA_STORAGE` to the `@iptvnator/services` import, then add this block at the end of the top-level `describe`:

```ts
    describe('with an injected user data storage', () => {
        it('reads and writes favorites through it, not localStorage', async () => {
            const values = new Map<string, string>();
            const storage = {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    values.set(key, value);
                },
                removeItem: (key: string) => {
                    values.delete(key);
                },
            };
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    PwaXtreamDataSource,
                    { provide: USER_DATA_STORAGE, useValue: storage },
                    { provide: ParentalLockService, useValue: parentalLock },
                    { provide: XtreamApiService, useValue: apiService },
                    { provide: PlaylistsService, useValue: playlistsService },
                ],
            });
            const source = TestBed.inject(PwaXtreamDataSource);

            values.set('xtream-favorites', JSON.stringify({ p1: ['live:1'] }));
            await source.deletePlaylist('p1');

            expect(JSON.parse(values.get('xtream-favorites') ?? '{}')).toEqual(
                {}
            );
            expect(localStorage.getItem('xtream-favorites')).toBeNull();
        });
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test portal-xtream-data-access --testPathPatterns=pwa-xtream-data-source`
Expected: FAIL, `USER_DATA_STORAGE` is not exported from `@iptvnator/services`.

- [ ] **Step 3: Create the token**

Create `libs/services/src/lib/user-data-storage.ts`:

```ts
import { InjectionToken } from '@angular/core';

/** The slice of the Web Storage API that PWA user-data stores rely on. */
export type UserDataStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Browser persistence for PWA user data such as Xtream favorites, recently
 * viewed items and playback positions. Defaults to `localStorage`; the
 * self-hosted server mode provides a server-synced implementation.
 */
export const USER_DATA_STORAGE = new InjectionToken<UserDataStorage>(
    'USER_DATA_STORAGE',
    { providedIn: 'root', factory: () => globalThis.localStorage }
);
```

Add to `libs/services/src/index.ts`:

```ts
export * from './lib/user-data-storage';
```

- [ ] **Step 4: Route `PwaCollectionStorage` through it**

In `pwa-collection-storage.ts`:

1. Add `import type { UserDataStorage } from '@iptvnator/services';`
2. Change the constructor to:

```ts
    constructor(
        private readonly resolveItems: (
            playlistId: string,
            ids: readonly CollectionKey[]
        ) => Map<CollectionKey, XtreamContentItem>,
        private readonly storage: UserDataStorage
    ) {}
```

3. Replace every `localStorage.getItem(` with `this.storage.getItem(` and every `localStorage.setItem(` with `this.storage.setItem(` in this file:

```bash
perl -pi -e 's/\blocalStorage\.(getItem|setItem|removeItem)\(/this.storage.$1(/g' libs/portal/xtream/data-access/src/lib/data-sources/pwa-collection-storage.ts
grep -n "localStorage" libs/portal/xtream/data-access/src/lib/data-sources/pwa-collection-storage.ts
```

Expected: the grep prints nothing.

- [ ] **Step 5: Route `PwaXtreamDataSource` through it**

In `pwa-xtream-data-source.ts`:

1. Change the services import to `import { ParentalLockService, PlaylistsService, USER_DATA_STORAGE } from '@iptvnator/services';`
2. Add the field before `collectionStorage`:

```ts
    private readonly userDataStorage = inject(USER_DATA_STORAGE);
```

3. Change the `collectionStorage` initializer to:

```ts
    private readonly collectionStorage = new PwaCollectionStorage(
        (playlistId, ids) => this.getCollectionItemsById(playlistId, ids),
        this.userDataStorage
    );
```

4. Replace the four direct calls and update the class comment:

```bash
perl -pi -e 's/\blocalStorage\.(getItem|setItem|removeItem)\(/this.userDataStorage.$1(/g; s/Favorites and recently viewed are stored in localStorage\./Favorites, recently viewed and positions are stored in USER_DATA_STORAGE./' libs/portal/xtream/data-access/src/lib/data-sources/pwa-xtream-data-source.ts
grep -n "localStorage" libs/portal/xtream/data-access/src/lib/data-sources/pwa-xtream-data-source.ts
```

Expected: the grep prints only section comments such as `// Playlist Operations (localStorage)`. Change those comments to `(user data storage)`.

- [ ] **Step 6: Run the data-access suite**

```bash
pnpm nx test portal-xtream-data-access
pnpm nx lint portal-xtream-data-access
pnpm nx test services --testPathPatterns=user-data
```

Expected: PASS, including the new test; existing tests still pass because the default factory returns `localStorage`.

- [ ] **Step 7: Commit**

```bash
git add libs/services/src/lib/user-data-storage.ts libs/services/src/index.ts libs/portal/xtream/data-access/src/lib/data-sources
git commit -m "refactor(xtream): store PWA user data through USER_DATA_STORAGE

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Phase gate and pull request

- [ ] **Step 1: Full checks for the touched projects**

```bash
pnpm run typecheck:ci
pnpm run typecheck:spec
pnpm nx run-many -t test -p database services electron-backend portal-xtream-data-access
pnpm nx run-many -t lint -p database services electron-backend portal-xtream-data-access
pnpm nx build web --configuration=pwa
pnpm nx run web-e2e:e2e -- --project=chromium --grep "@self-hosted|@pwa"
```

Expected: all pass. The E2E run proves IndexedDB-backed PWA flows still work.

- [ ] **Step 2: Docs**

Update `docs/architecture/pwa-self-hosted.md`, section "PWA Portal User Data": after the bullet list of keys add:

```markdown
`PwaXtreamDataSource` and `PwaCollectionStorage` reach these keys through the
`USER_DATA_STORAGE` token from `@iptvnator/services` (default:
`localStorage`), never through `localStorage` directly, so a deployment can
substitute a server-synced storage.
```

and in "Runtime Limitations", change the playlist bullet's second sentence to say that `PlaylistsService` selects IndexedDB through `PlaylistStorageBackend`.

- [ ] **Step 3: Local review gate, then push**

Follow `docs/development/agent-workflow.md#local-review-before-a-pull-request`. Then:

```bash
git push -u origin claude/server-storage
gh pr create --title "refactor(storage): seams for server-backed playlist storage" --label no-release-note --body "$(cat <<'EOF'
Prepares server-backed storage for the self-hosted PWA (#305) without changing behavior.

- Playlist row codec moves to `@iptvnator/shared/database/app-playlist`; Electron re-exports it.
- `IPTVNATOR_DATA_DIR` sets the database root after the E2E override.
- `PlaylistStorageBackend` is the single place that picks the Electron bridge or IndexedDB.
- Xtream PWA user data goes through the `USER_DATA_STORAGE` token (default `localStorage`).

Spec: docs/superpowers/specs/2026-10-08-server-storage-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report: checks run and results, the reviewed commit, docs changed, and that no release note is needed because behavior is unchanged.
