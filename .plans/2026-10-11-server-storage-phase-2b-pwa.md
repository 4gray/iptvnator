# Server Storage Phase 2b: PWA Server Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the self-hosted backend reports server storage, the PWA keeps playlists and Xtream user data on the server, offers to move browser data once, and shows the connection in Settings, the rail and an offline banner.

**Architecture:** `main.ts` probes `GET /v1/instance` only when the deployment wrote a runtime `BACKEND_URL`. On `storage: 'server'` it dynamically imports `server-storage.providers.ts`, which registers the server session, the server-synced `USER_DATA_STORAGE`, an access-token interceptor and two app initializers. The session plugs `ServerPlaylistDocumentStore` (HTTP, ETag cache, `keepPayload`) into `PlaylistStorageBackend`, so `PlaylistsService` is unchanged. A tiny `ServerStorageStatusService` in the main `@iptvnator/services` barrel carries the connection state for the rail, banner, settings and guards. Everything else lives behind the sub-entry `@iptvnator/services/server-storage`.

**Tech Stack:** Angular 22 (signals, standalone components, `provideAppInitializer`), Angular Material, ngx-translate, ngx-indexed-db, Jest 30, Playwright.

Prerequisites: Phase 1 and Phase 2a merged (or rebased into this branch).
Spec: `docs/superpowers/specs/2026-10-08-server-storage-design.md`, sections 5–8.
Before any UI task (Tasks 9–12) read `.codex/skills/iptvnator-ui-design/SKILL.md`, `.codex/skills/iptvnator-theme-style/SKILL.md` and `docs/architecture/iptvnator-ui-guidelines.md` ("Settings Surfaces", "Shared Tokens").

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/services/src/lib/server-storage-status.service.ts` | create | Connection state signals (main barrel) |
| `libs/services/src/lib/server-access-token.ts` | create | Token persistence and `Authorization` header (main barrel) |
| `libs/services/src/lib/playlist-storage-backend.ts` | modify | `server` kind, temporary browser override |
| `libs/services/src/lib/server-storage/server-storage.config.ts` | create | `SERVER_STORAGE_CONFIG` token |
| `libs/services/src/lib/server-storage/server-api-client.ts` | create | `fetch` for `/v1`, errors, state reporting |
| `libs/services/src/lib/server-storage/server-playlist-document-store.ts` | create | `PlaylistDocumentStore` over HTTP |
| `libs/services/src/lib/server-storage/server-user-data-storage.ts` | create | Write-through `USER_DATA_STORAGE` |
| `libs/services/src/lib/server-storage/server-storage-session.ts` | create | Wires the above, refresh, flush, snackbar |
| `libs/services/src/lib/server-storage/server-access-token.interceptor.ts` | create | Adds the token to backend `HttpClient` calls |
| `libs/services/src/lib/server-storage/server-migration.service.ts` | create | Detect and move browser data |
| `libs/services/src/lib/server-storage/index.ts` | create | Sub-entry barrel |
| `tsconfig.base.json` | modify | Alias `@iptvnator/services/server-storage` |
| `apps/web/src/app/server-storage/server-instance-probe.ts` | create | Startup probe |
| `apps/web/src/app/server-storage/server-storage.providers.ts` | create | Providers (dynamic import) |
| `apps/web/src/app/server-storage/server-access.guard.ts` | create | Route guards |
| `apps/web/src/app/server-storage/server-sign-in.component.*` | create | Token page |
| `apps/web/src/app/server-storage/server-migration-prompt.service.ts` | create | Opens the migration dialog once |
| `apps/web/src/app/server-storage/server-migration-dialog.component.*` | create | Migration dialog |
| `apps/web/src/main.ts`, `apps/web/src/app/app.routes.ts` | modify | Probe and routes |
| `apps/web/src/app/services/pwa.service.ts` | modify | Token on the raw Stalker `fetch` |
| `apps/web/src/app/settings/settings-server-section.component.*` | create | Settings → Server |
| `apps/web/src/app/settings/settings-options.ts`, `settings.component.ts/.html`, `settings-delete-all-playlists-dialog.component.*` | modify | Section wiring, delete-all warning |
| `libs/workspace/shell/util/src/lib/settings-search/*` | modify | `server` section and requirement |
| `libs/workspace/shell/feature/.../workspace-shell-rail/*` | modify | Server indicator |
| `libs/workspace/shell/feature/.../workspace-shell-server-banner/*` | create | Offline banner |
| `libs/workspace/shell/feature/.../workspace-shell.component.ts/.html` | modify | Host the banner |
| `apps/web/src/assets/i18n/*.json` | modify | 19 locales |
| `apps/web-e2e/playwright.config.ts`, `apps/web-backend/src/app/project-config.spec.ts`, `apps/web-e2e/src/server-storage.e2e.ts` | modify/create | Storage backend for E2E |
| `.changes/self-hosted-server-storage.md` | create | Release note |
| `docs/architecture/pwa-self-hosted.md`, `docs/architecture/workspace-shell.md`, `docker/README.md`, `README.md` | modify | Docs |

---

### Task 1: Connection state and access token (main barrel)

**Files:**
- Create: `libs/services/src/lib/server-storage-status.service.ts`
- Create: `libs/services/src/lib/server-access-token.ts`
- Test: `libs/services/src/lib/server-storage-status.service.spec.ts`
- Test: `libs/services/src/lib/server-access-token.spec.ts`
- Modify: `libs/services/src/index.ts`

- [ ] **Step 1: Write the failing specs**

`server-storage-status.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import { ServerStorageStatusService } from './server-storage-status.service';

const instance: ServerInstanceInfo = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

describe('ServerStorageStatusService', () => {
    let status: ServerStorageStatusService;

    beforeEach(() => {
        status = TestBed.inject(ServerStorageStatusService);
    });

    it('stays inactive and ignores reports until activated', () => {
        status.reportOffline();
        status.reportUnauthorized();

        expect(status.state()).toBe('inactive');
        expect(status.isActive()).toBe(false);
    });

    it('tracks online, offline and unauthorized after activation', () => {
        const retry = jest.fn();
        status.activate(instance, retry);
        expect(status.state()).toBe('online');
        expect(status.instance()).toEqual(instance);

        status.reportOffline();
        expect(status.state()).toBe('offline');
        status.retry();
        expect(retry).toHaveBeenCalledTimes(1);

        status.reportSuccess();
        expect(status.state()).toBe('online');
        expect(status.lastSuccessAt()).toBeInstanceOf(Date);

        status.reportUnauthorized();
        expect(status.state()).toBe('unauthorized');
    });
});
```

`server-access-token.spec.ts`:

```ts
import {
    clearServerAccessToken,
    readServerAccessToken,
    SERVER_ACCESS_TOKEN_STORAGE_KEY,
    serverAuthorizationHeaders,
    writeServerAccessToken,
} from './server-access-token';

describe('server access token', () => {
    afterEach(() => localStorage.clear());

    it('has no header without a token', () => {
        expect(readServerAccessToken()).toBeNull();
        expect(serverAuthorizationHeaders()).toEqual({});
    });

    it('stores a trimmed token and builds the bearer header', () => {
        writeServerAccessToken('  s3cret ');

        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe('s3cret');
        expect(serverAuthorizationHeaders()).toEqual({
            Authorization: 'Bearer s3cret',
        });

        clearServerAccessToken();
        expect(readServerAccessToken()).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns="server-storage-status|server-access-token"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`server-storage-status.service.ts`:

```ts
import { computed, Injectable, signal } from '@angular/core';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';

export type ServerConnectionState =
    | 'inactive'
    | 'online'
    | 'offline'
    | 'unauthorized';

/**
 * Connection state of the self-hosted server storage. `inactive` in Electron
 * and in a PWA without server storage; the server session activates it.
 */
@Injectable({ providedIn: 'root' })
export class ServerStorageStatusService {
    private readonly stateSignal = signal<ServerConnectionState>('inactive');
    private readonly instanceSignal = signal<ServerInstanceInfo | null>(null);
    private readonly lastSuccessSignal = signal<Date | null>(null);
    private retryHandler: (() => void) | null = null;

    readonly state = this.stateSignal.asReadonly();
    readonly instance = this.instanceSignal.asReadonly();
    readonly lastSuccessAt = this.lastSuccessSignal.asReadonly();
    readonly isActive = computed(() => this.stateSignal() !== 'inactive');

    activate(instance: ServerInstanceInfo, retry: () => void): void {
        this.instanceSignal.set(instance);
        this.retryHandler = retry;
        this.stateSignal.set('online');
    }

    reportSuccess(): void {
        if (!this.isActive()) {
            return;
        }
        this.stateSignal.set('online');
        this.lastSuccessSignal.set(new Date());
    }

    reportOffline(): void {
        if (this.isActive()) {
            this.stateSignal.set('offline');
        }
    }

    reportUnauthorized(): void {
        if (this.isActive()) {
            this.stateSignal.set('unauthorized');
        }
    }

    retry(): void {
        this.retryHandler?.();
    }
}
```

`server-access-token.ts`:

```ts
export const SERVER_ACCESS_TOKEN_STORAGE_KEY = 'iptvnator-server:access-token';

export function readServerAccessToken(): string | null {
    try {
        const token = localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)?.trim();
        return token ? token : null;
    } catch {
        return null;
    }
}

export function writeServerAccessToken(token: string): void {
    try {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, token.trim());
    } catch {
        // Storage unavailable (private mode): the token cannot persist.
    }
}

export function clearServerAccessToken(): void {
    try {
        localStorage.removeItem(SERVER_ACCESS_TOKEN_STORAGE_KEY);
    } catch {
        // Nothing stored.
    }
}

/** `Authorization` header for calls to the self-hosted backend. */
export function serverAuthorizationHeaders(): Record<string, string> {
    const token = readServerAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
```

Append to `libs/services/src/index.ts`:

```ts
export * from './lib/server-storage-status.service';
export * from './lib/server-access-token';
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
pnpm nx test services --testPathPatterns="server-storage-status|server-access-token"
git add libs/services/src/lib/server-storage-status.service.ts libs/services/src/lib/server-storage-status.service.spec.ts libs/services/src/lib/server-access-token.ts libs/services/src/lib/server-access-token.spec.ts libs/services/src/index.ts
git commit -m "feat(services): server storage connection state and access token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests.

---

### Task 2: `PlaylistStorageBackend` learns the server kind

**Files:**
- Modify: `libs/services/src/lib/playlist-storage-backend.ts`
- Modify: `libs/services/src/lib/playlist-storage-backend.spec.ts`

- [ ] **Step 1: Add failing tests**

Append inside the `describe` of `playlist-storage-backend.spec.ts`:

```ts
    it('prefers the server store once it is set', () => {
        testWindow.electron = undefined;
        const backend = create(false);
        const store = { dbGetAppPlaylists: jest.fn() } as never;

        backend.useServerStore(store);

        expect(backend.kind()).toBe('server');
        expect(backend.documentStore()).toBe(store);
    });

    it('falls back to browser storage while an override task runs', async () => {
        testWindow.electron = undefined;
        const backend = create(false);
        backend.useServerStore({ dbGetAppPlaylists: jest.fn() } as never);

        const seen = await backend.runWithBrowserStorage(async () => [
            backend.kind(),
            backend.usesBrowserStorageOverride(),
        ]);

        expect(seen).toEqual(['indexeddb', true]);
        expect(backend.kind()).toBe('server');
        expect(backend.usesBrowserStorageOverride()).toBe(false);
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=playlist-storage-backend`
Expected: FAIL, `useServerStore` is not a function.

- [ ] **Step 3: Implement**

Replace the class and the kind type in `playlist-storage-backend.ts` (keep `PlaylistDocumentStore` as is):

```ts
export type PlaylistStorageKind = 'electron' | 'server' | 'indexeddb';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private serverStore: PlaylistDocumentStore | null = null;
    private browserOverrideDepth = 0;

    /** Server mode: set once by the server storage session at startup. */
    useServerStore(store: PlaylistDocumentStore): void {
        this.serverStore = store;
    }

    usesBrowserStorageOverride(): boolean {
        return this.browserOverrideDepth > 0;
    }

    /**
     * Runs `task` against browser storage although server mode is active.
     * Only the migration export uses it, inside a modal flow.
     */
    async runWithBrowserStorage<T>(task: () => Promise<T>): Promise<T> {
        this.browserOverrideDepth += 1;
        try {
            return await task();
        } finally {
            this.browserOverrideDepth -= 1;
        }
    }

    kind(): PlaylistStorageKind {
        if (this.serverStore && this.browserOverrideDepth === 0) {
            return 'server';
        }
        return this.runtime.supportsSqlite ? 'electron' : 'indexeddb';
    }

    /** The document store for `kind()`, or `null` for IndexedDB. */
    documentStore(): PlaylistDocumentStore | null {
        const kind = this.kind();
        if (kind === 'server') {
            return this.serverStore;
        }
        if (kind !== 'electron' || typeof window === 'undefined') {
            return null;
        }
        return (window.electron as PlaylistDocumentStore | undefined) ?? null;
    }
}
```

- [ ] **Step 4: Run, then commit**

```bash
pnpm nx test services --testPathPatterns="playlist-storage-backend|playlists.service|playlist-migration"
git add libs/services/src/lib/playlist-storage-backend.ts libs/services/src/lib/playlist-storage-backend.spec.ts
git commit -m "feat(services): server kind for the playlist storage backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS; the existing `PlaylistsService` specs are unaffected.

---

### Task 3: API client and the sub-entry

**Files:**
- Create: `libs/services/src/lib/server-storage/server-storage.config.ts`
- Create: `libs/services/src/lib/server-storage/server-api-client.ts`
- Create: `libs/services/src/lib/server-storage/index.ts`
- Test: `libs/services/src/lib/server-storage/server-api-client.spec.ts`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Write the failing spec**

```ts
import { SERVER_ACCESS_TOKEN_STORAGE_KEY } from '../server-access-token';
import { ServerApiClient, ServerApiError } from './server-api-client';

// jsdom has Headers but no Response or fetch.
function response(status: number, body?: unknown) {
    return {
        status,
        ok: status >= 200 && status < 300,
        statusText: '',
        headers: new Headers(),
        json: async () => body,
    } as unknown as Response;
}

describe('ServerApiClient', () => {
    const status = {
        reportSuccess: jest.fn(),
        reportOffline: jest.fn(),
        reportUnauthorized: jest.fn(),
    };
    const onWriteFailure = jest.fn();

    afterEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    function client(fetchFn: jest.Mock) {
        return new ServerApiClient({
            baseUrl: '/api/',
            status,
            onWriteFailure,
            fetchFn: fetchFn as unknown as typeof fetch,
        });
    }

    it('calls /v1 with the token and reports success', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 't');
        const fetchFn = jest.fn().mockResolvedValue(response(200, { ok: true }));

        await expect(client(fetchFn).getJson('/instance')).resolves.toEqual({ ok: true });

        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('/api/v1/instance');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer t' });
        expect(status.reportSuccess).toHaveBeenCalled();
    });

    it('reports offline on a network error and announces failed writes', async () => {
        const fetchFn = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(
            client(fetchFn).sendJson('PUT', '/playlists/a', {})
        ).rejects.toMatchObject({ status: 0, code: 'network' });
        expect(status.reportOffline).toHaveBeenCalled();
        expect(onWriteFailure).toHaveBeenCalledTimes(1);
    });

    it('clears the token and reports unauthorized on 401', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 'old');
        const fetchFn = jest.fn().mockResolvedValue(response(401, { code: 'unauthorized' }));

        await expect(client(fetchFn).getJson('/playlists')).rejects.toBeInstanceOf(ServerApiError);
        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
        expect(status.reportUnauthorized).toHaveBeenCalled();
    });

    it('passes 304 through and maps error bodies', async () => {
        const fetchFn = jest
            .fn()
            .mockResolvedValueOnce(response(304))
            .mockResolvedValueOnce(response(409, { message: 'x', code: 'payload_missing' }));
        const api = client(fetchFn);

        expect((await api.request('/playlists/a')).status).toBe(304);
        await expect(api.sendJson('PUT', '/playlists/a', {})).rejects.toMatchObject({
            status: 409,
            code: 'payload_missing',
        });
        expect(onWriteFailure).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-api-client`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`server-storage.config.ts`:

```ts
import { InjectionToken } from '@angular/core';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';

export interface ServerStorageConfig {
    readonly instance: ServerInstanceInfo;
    /** Backend base URL as the PWA resolves it, e.g. `/api`. */
    readonly baseUrl: string;
}

export const SERVER_STORAGE_CONFIG = new InjectionToken<ServerStorageConfig>(
    'SERVER_STORAGE_CONFIG'
);
```

`server-api-client.ts`:

```ts
import type { ServerStorageErrorBody } from '@iptvnator/shared/interfaces';
import {
    clearServerAccessToken,
    serverAuthorizationHeaders,
} from '../server-access-token';
import type { ServerStorageStatusService } from '../server-storage-status.service';

const REQUEST_TIMEOUT_MS = 20_000;

export class ServerApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | undefined,
        message: string
    ) {
        super(message);
        this.name = 'ServerApiError';
    }
}

export interface ServerApiClientOptions {
    readonly baseUrl: string;
    readonly status: Pick<
        ServerStorageStatusService,
        'reportSuccess' | 'reportOffline' | 'reportUnauthorized'
    >;
    /** Failed writes the user should hear about: network, 413, 5xx. */
    readonly onWriteFailure?: (error: ServerApiError) => void;
    readonly fetchFn?: typeof fetch;
    readonly timeoutMs?: number;
}

/** `fetch` for `/v1`: token, timeout, error mapping, connection state. */
export class ServerApiClient {
    private readonly root: string;

    constructor(private readonly options: ServerApiClientOptions) {
        this.root = `${options.baseUrl.replace(/\/+$/, '')}/v1`;
    }

    url(path: string): string {
        return `${this.root}${path}`;
    }

    async request(path: string, init: RequestInit = {}): Promise<Response> {
        const isWrite = (init.method ?? 'GET') !== 'GET';
        let response: Response;
        try {
            response = await this.fetchFn()(this.url(path), {
                ...init,
                cache: 'no-store',
                headers: {
                    ...serverAuthorizationHeaders(),
                    ...(init.headers as Record<string, string> | undefined),
                },
                signal: init.signal ?? this.timeoutSignal(),
            });
        } catch {
            this.options.status.reportOffline();
            const error = new ServerApiError(0, 'network', 'The server is not reachable.');
            if (isWrite) {
                this.options.onWriteFailure?.(error);
            }
            throw error;
        }

        if (response.status === 401) {
            clearServerAccessToken();
            this.options.status.reportUnauthorized();
            throw new ServerApiError(401, 'unauthorized', 'The server needs an access token.');
        }

        if (!response.ok && response.status !== 304) {
            const body = await readErrorBody(response);
            const error = new ServerApiError(response.status, body.code, body.message);
            if (isWrite && (response.status === 413 || response.status >= 500)) {
                this.options.onWriteFailure?.(error);
            }
            throw error;
        }

        this.options.status.reportSuccess();
        return response;
    }

    async getJson<T>(path: string): Promise<T> {
        return (await this.request(path)).json() as Promise<T>;
    }

    sendJson(method: 'PUT' | 'POST', path: string, body: unknown): Promise<Response> {
        return this.request(path, {
            method,
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    /** Best effort while the page is hidden or closed; errors are ignored. */
    sendKeepalive(method: 'PUT' | 'DELETE', path: string, body?: unknown): void {
        void this.fetchFn()(this.url(path), {
            method,
            keepalive: true,
            headers: {
                ...serverAuthorizationHeaders(),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).catch(() => undefined);
    }

    private fetchFn(): typeof fetch {
        return this.options.fetchFn ?? globalThis.fetch.bind(globalThis);
    }

    private timeoutSignal(): AbortSignal | undefined {
        return typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(this.options.timeoutMs ?? REQUEST_TIMEOUT_MS)
            : undefined;
    }
}

async function readErrorBody(
    response: Response
): Promise<{ message: string; code?: string }> {
    try {
        const body = (await response.json()) as Partial<ServerStorageErrorBody>;
        return { message: body.message ?? response.statusText, code: body.code };
    } catch {
        return { message: response.statusText };
    }
}
```

`index.ts`:

```ts
export * from './server-storage.config';
export * from './server-api-client';
```

In `tsconfig.base.json`, after the `"@iptvnator/services/playlist-backup"` entry add:

```json
"@iptvnator/services/server-storage": [
    "libs/services/src/lib/server-storage/index.ts"
],
```

- [ ] **Step 4: Run, then commit**

```bash
pnpm nx test services --testPathPatterns=server-api-client
git add libs/services/src/lib/server-storage tsconfig.base.json
git commit -m "feat(services): server storage API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests.

---

### Task 4: `ServerPlaylistDocumentStore`

**Files:**
- Create: `libs/services/src/lib/server-storage/server-playlist-document-store.ts`
- Test: `libs/services/src/lib/server-storage/server-playlist-document-store.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import type { Playlist } from '@iptvnator/shared/interfaces';
import { ServerApiError } from './server-api-client';
import { ServerPlaylistDocumentStore } from './server-playlist-document-store';

function fakeResponse(status: number, body?: unknown, etag?: string) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Headers(etag ? { etag } : {}),
        json: async () => body,
    } as unknown as Response;
}

describe('ServerPlaylistDocumentStore', () => {
    const doc = {
        _id: 'p1',
        title: 'Family',
        favorites: [],
        playlist: { header: { raw: '#EXTM3U' }, items: [{ id: 'a' }] },
    } as unknown as Playlist;

    function setup() {
        const api = {
            request: jest.fn(),
            getJson: jest.fn(),
            sendJson: jest.fn(),
        };
        return { api, store: new ServerPlaylistDocumentStore(api as never) };
    }

    it('caches by ETag and serves a private copy on 304', async () => {
        const { api, store } = setup();
        api.request
            .mockResolvedValueOnce(fakeResponse(200, doc, '"b.0.1"'))
            .mockResolvedValueOnce(fakeResponse(304));

        const first = await store.dbGetAppPlaylist('p1');
        const second = await store.dbGetAppPlaylist('p1');

        expect(api.request.mock.calls[1][1]).toEqual({
            headers: { 'If-None-Match': '"b.0.1"' },
        });
        expect(second).toEqual(doc);
        expect(second).not.toBe(first);
    });

    it('returns null for an unknown playlist', async () => {
        const { api, store } = setup();
        api.request.mockRejectedValue(new ServerApiError(404, 'not_found', 'x'));

        await expect(store.dbGetAppPlaylist('zz')).resolves.toBeNull();
    });

    it('omits an unchanged payload and keeps it on the server', async () => {
        const { api, store } = setup();
        api.request.mockResolvedValueOnce(fakeResponse(200, doc, '"b.0.1"'));
        api.sendJson.mockResolvedValue(fakeResponse(200, { success: true }, '"b.0.2"'));
        const served = (await store.dbGetAppPlaylist('p1'))!;

        await store.dbUpsertAppPlaylist({ ...served, favorites: ['a'] });

        const [method, path, body] = api.sendJson.mock.calls[0];
        expect([method, path]).toEqual(['PUT', '/playlists/p1?keepPayload=1']);
        expect(body).toEqual({ _id: 'p1', title: 'Family', favorites: ['a'] });
    });

    it('uploads a new payload in full', async () => {
        const { api, store } = setup();
        api.sendJson.mockResolvedValue(fakeResponse(200, { success: true }, '"b.0.1"'));

        await store.dbUpsertAppPlaylist(doc);

        expect(api.sendJson.mock.calls[0][1]).toBe('/playlists/p1');
        expect(api.sendJson.mock.calls[0][2]).toBe(doc);
    });

    it('retries in full when the server has no payload to keep', async () => {
        const { api, store } = setup();
        api.request.mockResolvedValueOnce(fakeResponse(200, doc, '"b.0.1"'));
        const served = (await store.dbGetAppPlaylist('p1'))!;
        api.sendJson
            .mockRejectedValueOnce(new ServerApiError(409, 'payload_missing', 'x'))
            .mockResolvedValueOnce(fakeResponse(200, { success: true }, '"b.1.1"'));

        await store.dbUpsertAppPlaylist(served);

        expect(api.sendJson.mock.calls[1][1]).toBe('/playlists/p1');
        expect(api.sendJson.mock.calls[1][2]).toBe(served);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-playlist-document-store`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import {
    SERVER_PAYLOAD_FIELDS,
    type ElectronBridgeCountResult,
    type ElectronBridgeResult,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { ServerApiError, type ServerApiClient } from './server-api-client';

interface CachedDocument {
    readonly etag: string;
    readonly document: Playlist;
}

type ServerApi = Pick<ServerApiClient, 'request' | 'getJson' | 'sendJson'>;

/**
 * `PlaylistDocumentStore` over the server storage API. Full documents are
 * cached by ETag; every read hands out a private copy and remembers its
 * payload objects, so an upsert whose payload is one of them omits it
 * (`keepPayload=1`). `PlaylistsService` builds a new object per mutation,
 * so cached documents are never mutated in place.
 */
export class ServerPlaylistDocumentStore implements PlaylistDocumentStore {
    private readonly cache = new Map<string, CachedDocument>();
    private readonly servedPayloads = new WeakSet<object>();

    constructor(private readonly api: ServerApi) {}

    dbGetAppPlaylists(): Promise<Playlist[]> {
        return this.api.getJson<Playlist[]>('/playlists');
    }

    dbGetAppPlaylistMetas(): Promise<Playlist[]> {
        return this.api.getJson<Playlist[]>('/playlists?view=meta');
    }

    async dbGetAppPlaylist(playlistId: string): Promise<Playlist | null> {
        const cached = this.cache.get(playlistId);
        let response: Response;
        try {
            response = await this.api.request(
                `/playlists/${encodeURIComponent(playlistId)}`,
                cached ? { headers: { 'If-None-Match': cached.etag } } : {}
            );
        } catch (error) {
            if (error instanceof ServerApiError && error.status === 404) {
                this.cache.delete(playlistId);
                return null;
            }
            throw error;
        }

        if (response.status === 304 && cached) {
            return this.serve(cached.document);
        }
        const document = (await response.json()) as Playlist;
        this.remember(playlistId, response, document);
        return this.serve(document);
    }

    async dbUpsertAppPlaylist(playlist: Playlist): Promise<ElectronBridgeResult> {
        const path = `/playlists/${encodeURIComponent(playlist._id)}`;
        const keepPayload = this.carriesServedPayload(playlist);
        let response: Response;
        try {
            response = keepPayload
                ? await this.api.sendJson('PUT', `${path}?keepPayload=1`, withoutPayload(playlist))
                : await this.api.sendJson('PUT', path, playlist);
        } catch (error) {
            if (!(keepPayload && error instanceof ServerApiError && error.code === 'payload_missing')) {
                throw error;
            }
            response = await this.api.sendJson('PUT', path, playlist);
        }
        this.remember(playlist._id, response, playlist);
        return { success: true };
    }

    async dbUpsertAppPlaylists(playlists: Playlist[]): Promise<ElectronBridgeCountResult> {
        for (const playlist of playlists) {
            await this.dbUpsertAppPlaylist(playlist);
        }
        return { success: true, count: playlists.length };
    }

    async dbDeletePlaylist(playlistId: string): Promise<ElectronBridgeResult> {
        await this.api.request(`/playlists/${encodeURIComponent(playlistId)}`, {
            method: 'DELETE',
        });
        this.cache.delete(playlistId);
        return { success: true };
    }

    async dbDeleteAllPlaylists(): Promise<ElectronBridgeResult> {
        await this.api.request('/playlists', { method: 'DELETE' });
        this.cache.clear();
        return { success: true };
    }

    async dbGetAppState(key: string): Promise<string | null> {
        const body = await this.api.getJson<{ value: string | null }>(
            `/app-state/${encodeURIComponent(key)}`
        );
        return body.value;
    }

    async dbSetAppState(key: string, value: string): Promise<ElectronBridgeResult> {
        await this.api.sendJson('PUT', `/app-state/${encodeURIComponent(key)}`, { value });
        return { success: true };
    }

    private remember(id: string, response: Response, document: Playlist): void {
        const etag = response.headers.get('etag');
        if (etag) {
            this.cache.set(id, { etag, document });
        } else {
            this.cache.delete(id);
        }
    }

    private serve(document: Playlist): Playlist {
        const copy = structuredClone(document);
        const record = copy as unknown as Record<string, unknown>;
        for (const field of SERVER_PAYLOAD_FIELDS) {
            const value = record[field];
            if (value && typeof value === 'object') {
                this.servedPayloads.add(value);
            }
        }
        return copy;
    }

    private carriesServedPayload(playlist: Playlist): boolean {
        const record = playlist as unknown as Record<string, unknown>;
        const present = SERVER_PAYLOAD_FIELDS.filter(
            (field) => record[field] !== undefined && record[field] !== null
        );
        return (
            present.length > 0 &&
            present.every(
                (field) =>
                    typeof record[field] === 'object' &&
                    this.servedPayloads.has(record[field] as object)
            )
        );
    }
}

function withoutPayload(playlist: Playlist): Record<string, unknown> {
    const copy = { ...playlist } as Record<string, unknown>;
    for (const field of SERVER_PAYLOAD_FIELDS) {
        delete copy[field];
    }
    return copy;
}
```

Add to `server-storage/index.ts`:

```ts
export * from './server-playlist-document-store';
```

- [ ] **Step 4: Run, then commit**

```bash
pnpm nx test services --testPathPatterns=server-playlist-document-store
git add libs/services/src/lib/server-storage
git commit -m "feat(services): playlist document store over the server API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 5 tests.

---

### Task 5: `ServerUserDataStorage`

**Files:**
- Create: `libs/services/src/lib/server-storage/server-user-data-storage.ts`
- Test: `libs/services/src/lib/server-storage/server-user-data-storage.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { ServerUserDataStorage } from './server-user-data-storage';

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
    };
}

describe('ServerUserDataStorage', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function setup(useLocal = false) {
        const local = memoryStorage();
        const api = {
            getJson: jest.fn().mockResolvedValue({
                entries: {
                    'xtream-favorites': { p1: ['live:1'] },
                    'xtream-recent-items': {},
                    'xtream-collection-items': {},
                    'xtream-playback-positions': {},
                },
            }),
            sendJson: jest.fn().mockResolvedValue(undefined),
            request: jest.fn().mockResolvedValue(undefined),
            sendKeepalive: jest.fn(),
        };
        const onWriteFailure = jest.fn();
        const storage = new ServerUserDataStorage(
            api as never,
            local,
            () => useLocal,
            onWriteFailure
        );
        return { api, local, storage, onWriteFailure };
    }

    it('hydrates synced keys into a prefixed cache', async () => {
        const { local, storage } = setup();

        await storage.hydrate();

        expect(storage.getItem('xtream-favorites')).toBe('{"p1":["live:1"]}');
        expect(local.values.get('iptvnator-server:xtream-favorites')).toBe('{"p1":["live:1"]}');
        expect(local.values.has('xtream-favorites')).toBe(false);
    });

    it('sends only changed and removed playlist entries', async () => {
        const { api, storage } = setup();
        await storage.hydrate();

        storage.setItem('xtream-favorites', JSON.stringify({ p2: ['live:9'] }));
        await jest.runOnlyPendingTimersAsync();

        expect(api.sendJson).toHaveBeenCalledWith('PUT', '/user-state/xtream-favorites/p2', {
            value: ['live:9'],
        });
        expect(api.request).toHaveBeenCalledWith('/user-state/xtream-favorites/p1', {
            method: 'DELETE',
        });
        expect(api.sendJson).toHaveBeenCalledTimes(1);
    });

    it('passes other keys and the browser override to plain storage', () => {
        const { api, local, storage } = setup(true);

        storage.setItem('xtream-favorites', '{"legacy":[]}');
        storage.setItem('xtream-playlists', '[]');

        expect(local.values.get('xtream-favorites')).toBe('{"legacy":[]}');
        expect(local.values.get('xtream-playlists')).toBe('[]');
        expect(api.sendJson).not.toHaveBeenCalled();
    });

    it('flushes pending entries with keepalive', async () => {
        const { api, storage } = setup();
        await storage.hydrate();

        storage.setItem('xtream-recent-items', JSON.stringify({ p1: [] }));
        storage.flushWithKeepalive();

        expect(api.sendKeepalive).toHaveBeenCalledWith('PUT', '/user-state/xtream-recent-items/p1', {
            value: [],
        });
        await jest.runOnlyPendingTimersAsync();
        expect(api.sendJson).not.toHaveBeenCalled();
    });

    it('reports failed sends', async () => {
        const { api, storage, onWriteFailure } = setup();
        await storage.hydrate();
        api.sendJson.mockRejectedValueOnce(new Error('offline'));

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['live:2'] }));
        await jest.runOnlyPendingTimersAsync();

        expect(onWriteFailure).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-user-data-storage`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import type { ServerApiClient } from './server-api-client';

/** Server-mode cache keys; the legacy unprefixed keys are never touched. */
export const SERVER_CACHE_PREFIX = 'iptvnator-server:';
const FLUSH_DELAY_MS = 500;

interface PendingEntry {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
}

type ServerApi = Pick<ServerApiClient, 'getJson' | 'sendJson' | 'request' | 'sendKeepalive'>;

/**
 * Write-through `USER_DATA_STORAGE` for server mode. Synced namespaces are
 * maps keyed by playlist id; a write compares the new map with the last one
 * the server saw and sends only the playlist entries that changed. Other
 * keys, and every key while the browser override runs, use plain storage.
 */
export class ServerUserDataStorage implements UserDataStorage {
    private readonly synced = new Map<ServerUserStateNamespace, Record<string, unknown>>();
    private readonly pending = new Map<string, PendingEntry>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly api: ServerApi,
        private readonly local: UserDataStorage,
        private readonly useLocal: () => boolean,
        private readonly onWriteFailure: (error: unknown) => void
    ) {}

    getItem(key: string): string | null {
        return this.isSynced(key)
            ? this.local.getItem(SERVER_CACHE_PREFIX + key)
            : this.local.getItem(key);
    }

    setItem(key: string, value: string): void {
        if (!this.isSynced(key)) {
            this.local.setItem(key, value);
            return;
        }
        this.local.setItem(SERVER_CACHE_PREFIX + key, value);
        this.queueChanges(key, parseMap(value));
    }

    removeItem(key: string): void {
        if (!this.isSynced(key)) {
            this.local.removeItem(key);
            return;
        }
        this.local.removeItem(SERVER_CACHE_PREFIX + key);
        this.queueChanges(key, {});
    }

    /** Replaces the cache with the server's data, after sending pending writes. */
    async hydrate(): Promise<void> {
        await this.flush();
        const { entries } = await this.api.getJson<ServerUserStateResponse>('/user-state');
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const value = entries[namespace] ?? {};
            this.synced.set(namespace, value);
            this.local.setItem(SERVER_CACHE_PREFIX + namespace, JSON.stringify(value));
        }
    }

    async flush(): Promise<void> {
        const batch = this.takePending();
        await Promise.all(batch.map((entry) => this.send(entry)));
    }

    flushWithKeepalive(): void {
        for (const entry of this.takePending()) {
            const path = entryPath(entry);
            if (entry.value === undefined) {
                this.api.sendKeepalive('DELETE', path);
            } else {
                this.api.sendKeepalive('PUT', path, { value: entry.value });
            }
        }
    }

    private isSynced(key: string): key is ServerUserStateNamespace {
        return !this.useLocal() && isServerUserStateNamespace(key);
    }

    private queueChanges(
        namespace: ServerUserStateNamespace,
        next: Record<string, unknown>
    ): void {
        const previous = this.synced.get(namespace) ?? {};
        for (const [playlistId, value] of Object.entries(next)) {
            if (JSON.stringify(previous[playlistId]) !== JSON.stringify(value)) {
                this.pending.set(`${namespace}|${playlistId}`, { namespace, playlistId, value });
            }
        }
        for (const playlistId of Object.keys(previous)) {
            if (!(playlistId in next)) {
                this.pending.set(`${namespace}|${playlistId}`, {
                    namespace,
                    playlistId,
                    value: undefined,
                });
            }
        }
        this.synced.set(namespace, next);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== null || this.pending.size === 0) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, FLUSH_DELAY_MS);
    }

    private takePending(): PendingEntry[] {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        const batch = [...this.pending.values()];
        this.pending.clear();
        return batch;
    }

    private async send(entry: PendingEntry): Promise<void> {
        try {
            if (entry.value === undefined) {
                await this.api.request(entryPath(entry), { method: 'DELETE' });
            } else {
                await this.api.sendJson('PUT', entryPath(entry), { value: entry.value });
            }
        } catch (error) {
            this.onWriteFailure(error);
        }
    }
}

function entryPath(entry: PendingEntry): string {
    return `/user-state/${entry.namespace}/${encodeURIComponent(entry.playlistId)}`;
}

function parseMap(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}
```

Add to `server-storage/index.ts`:

```ts
export * from './server-user-data-storage';
```

- [ ] **Step 4: Run, then commit**

```bash
pnpm nx test services --testPathPatterns=server-user-data-storage
git add libs/services/src/lib/server-storage
git commit -m "feat(services): server-synced user data storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 5 tests.

---

### Task 6: Session and token interceptor

**Files:**
- Create: `libs/services/src/lib/server-storage/server-storage-session.ts`
- Create: `libs/services/src/lib/server-storage/server-access-token.interceptor.ts`
- Test: `libs/services/src/lib/server-storage/server-storage-session.spec.ts`
- Test: `libs/services/src/lib/server-storage/server-access-token.interceptor.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing specs**

`server-storage-session.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SERVER_ACCESS_TOKEN_STORAGE_KEY } from '../server-access-token';
import { ServerStorageStatusService } from '../server-storage-status.service';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';

describe('ServerStorageSession', () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        // start() arms a 3 s startup race and a 30 s retry interval.
        jest.useFakeTimers();
        (globalThis as { fetch: unknown }).fetch = fetchMock;
        fetchMock.mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => ({ entries: {} }),
        });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        fetchMock.mockReset();
        localStorage.clear();
        TestBed.resetTestingModule();
    });

    function setup(auth: 'none' | 'token') {
        TestBed.configureTestingModule({
            providers: [
                provideRouter([{ path: 'server-sign-in', children: [] }]),
                { provide: RuntimeCapabilitiesService, useValue: { supportsSqlite: false } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: TranslateService, useValue: { instant: (key: string) => key } },
                {
                    provide: SERVER_STORAGE_CONFIG,
                    useValue: {
                        baseUrl: '/api',
                        instance: {
                            service: 'iptvnator',
                            apiVersion: 1,
                            instanceId: 'i-1',
                            storage: 'server',
                            auth,
                        },
                    },
                },
            ],
        });
        return {
            session: TestBed.inject(ServerStorageSession),
            backend: TestBed.inject(PlaylistStorageBackend),
            status: TestBed.inject(ServerStorageStatusService),
        };
    }

    it('switches playlists to the server and hydrates user data', async () => {
        const { session, backend, status } = setup('none');

        await session.start();

        expect(backend.kind()).toBe('server');
        expect(status.state()).toBe('online');
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/user-state', expect.anything());
    });

    it('stops at unauthorized when a token is required but missing', async () => {
        const { session, status } = setup('token');

        await session.start();

        expect(status.state()).toBe('unauthorized');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('starts with a stored token', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 't');
        const { session, status } = setup('token');

        await session.start();

        expect(status.state()).toBe('online');
    });
});
```

`server-access-token.interceptor.spec.ts`:

```ts
import { HttpClient, provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_ACCESS_TOKEN_STORAGE_KEY } from '../server-access-token';
import { ServerAccessTokenInterceptor } from './server-access-token.interceptor';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

describe('ServerAccessTokenInterceptor', () => {
    beforeEach(() => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 't');
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptorsFromDi()),
                provideHttpClientTesting(),
                { provide: HTTP_INTERCEPTORS, useClass: ServerAccessTokenInterceptor, multi: true },
                { provide: SERVER_STORAGE_CONFIG, useValue: { baseUrl: '/api', instance: {} } },
            ],
        });
    });

    afterEach(() => localStorage.clear());

    it('adds the token to backend calls only', () => {
        const http = TestBed.inject(HttpClient);
        const controller = TestBed.inject(HttpTestingController);

        http.get('/api/parse').subscribe();
        http.get('https://provider.example/list.m3u').subscribe();

        expect(controller.expectOne('/api/parse').request.headers.get('Authorization')).toBe('Bearer t');
        expect(
            controller.expectOne('https://provider.example/list.m3u').request.headers.has('Authorization')
        ).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns="server-storage-session|server-access-token.interceptor"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`server-access-token.interceptor.ts`:

```ts
import {
    HttpEvent,
    HttpHandler,
    HttpInterceptor,
    HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { readServerAccessToken } from '../server-access-token';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';

/** Adds the server access token to `HttpClient` calls to the backend. */
@Injectable()
export class ServerAccessTokenInterceptor implements HttpInterceptor {
    private readonly baseUrl = inject(SERVER_STORAGE_CONFIG).baseUrl.replace(/\/+$/, '');

    intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
        const token = readServerAccessToken();
        if (!token || !request.url.startsWith(this.baseUrl)) {
            return next.handle(request);
        }
        return next.handle(
            request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        );
    }
}
```

`server-storage-session.ts`:

```ts
import { effect, inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import type { ServerStorageStatusResponse } from '@iptvnator/shared/interfaces';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { clearServerAccessToken, readServerAccessToken } from '../server-access-token';
import { ServerStorageStatusService } from '../server-storage-status.service';
import { ServerApiClient, type ServerApiError } from './server-api-client';
import { ServerPlaylistDocumentStore } from './server-playlist-document-store';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerUserDataStorage } from './server-user-data-storage';

const RETRY_INTERVAL_MS = 30_000;
const STARTUP_HYDRATE_WAIT_MS = 3_000;
export const SERVER_SIGN_IN_PATH = '/server-sign-in';

/** Server mode for this page: created only when the probe found server storage. */
@Injectable({ providedIn: 'root' })
export class ServerStorageSession {
    private readonly config = inject(SERVER_STORAGE_CONFIG);
    private readonly status = inject(ServerStorageStatusService);
    private readonly backend = inject(PlaylistStorageBackend);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly router = inject(Router);

    readonly api = new ServerApiClient({
        baseUrl: this.config.baseUrl,
        status: this.status,
        onWriteFailure: (error) => this.announceWriteFailure(error),
    });
    readonly documentStore = new ServerPlaylistDocumentStore(this.api);
    readonly userData = new ServerUserDataStorage(
        this.api,
        globalThis.localStorage,
        () => this.backend.usesBrowserStorageOverride(),
        () => this.announceWriteFailure()
    );

    constructor() {
        effect(() => {
            if (
                this.status.state() === 'unauthorized' &&
                !this.router.url.startsWith(SERVER_SIGN_IN_PATH)
            ) {
                void this.router.navigateByUrl(SERVER_SIGN_IN_PATH);
            }
        });
    }

    /** App initializer: must run before the first playlist read. */
    async start(): Promise<void> {
        this.backend.useServerStore(this.documentStore);
        this.status.activate(this.config.instance, () => void this.refresh());
        if (this.config.instance.auth === 'token' && !readServerAccessToken()) {
            this.status.reportUnauthorized();
            return;
        }
        await Promise.race([
            this.refresh(),
            new Promise((resolve) => setTimeout(resolve, STARTUP_HYDRATE_WAIT_MS)),
        ]);
        this.listen();
    }

    /** Re-reads synced user data; also the offline retry. */
    async refresh(): Promise<void> {
        try {
            await this.userData.hydrate();
        } catch {
            // The API client already reported offline or unauthorized.
        }
    }

    fetchStatus(): Promise<ServerStorageStatusResponse> {
        return this.api.getJson<ServerStorageStatusResponse>('/instance/status');
    }

    signOut(): void {
        clearServerAccessToken();
        this.status.reportUnauthorized();
    }

    private listen(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.userData.flushWithKeepalive();
            } else {
                void this.refresh();
            }
        });
        window.addEventListener('pagehide', () => this.userData.flushWithKeepalive());
        setInterval(() => {
            if (this.status.state() === 'offline') {
                void this.refresh();
            }
        }, RETRY_INTERVAL_MS);
    }

    private announceWriteFailure(error?: ServerApiError): void {
        const key =
            error?.status === 413 ? 'SERVER_STORAGE.TOO_LARGE' : 'SERVER_STORAGE.WRITE_FAILED';
        this.snackBar.open(this.translate.instant(key), undefined, { duration: 5000 });
    }
}
```

Add to `server-storage/index.ts`:

```ts
export * from './server-access-token.interceptor';
export * from './server-storage-session';
```

- [ ] **Step 4: Run, then commit**

```bash
pnpm nx test services --testPathPatterns="server-storage-session|server-access-token.interceptor"
git add libs/services/src/lib/server-storage
git commit -m "feat(services): server storage session and token interceptor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests.

---

### Task 7: Migration service

**Files:**
- Create: `libs/services/src/lib/server-storage/server-migration.service.ts`
- Test: `libs/services/src/lib/server-storage/server-migration.service.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { TestBed } from '@angular/core/testing';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { of } from 'rxjs';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { PlaylistBackupService } from '../playlist-backup.service';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';
import { ServerMigrationService } from './server-migration.service';

describe('ServerMigrationService', () => {
    const browserPlaylists = [
        { _id: 'm', title: 'Family' },
        { _id: 'x', title: 'Provider', serverUrl: 'http://panel.test' },
    ];
    let session: {
        fetchStatus: jest.Mock;
        documentStore: { dbUpsertAppPlaylist: jest.Mock };
        api: { sendJson: jest.Mock };
        userData: { hydrate: jest.Mock };
    };
    let backup: { exportBackup: jest.Mock; importBackup: jest.Mock };

    beforeEach(() => {
        session = {
            fetchStatus: jest.fn().mockResolvedValue({ playlists: 0 }),
            documentStore: { dbUpsertAppPlaylist: jest.fn().mockResolvedValue({ success: true }) },
            api: { sendJson: jest.fn().mockResolvedValue(undefined) },
            userData: { hydrate: jest.fn().mockResolvedValue(undefined) },
        };
        backup = {
            exportBackup: jest.fn().mockResolvedValue({ json: '{}' }),
            importBackup: jest.fn().mockResolvedValue({ imported: 1, merged: 1, skipped: 0, failed: 0, errors: [] }),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: NgxIndexedDBService, useValue: { getAll: () => of(browserPlaylists) } },
                { provide: ServerStorageSession, useValue: session },
                { provide: PlaylistBackupService, useValue: backup },
                {
                    provide: PlaylistStorageBackend,
                    useValue: { runWithBrowserStorage: (task: () => Promise<unknown>) => task() },
                },
                { provide: SERVER_STORAGE_CONFIG, useValue: { baseUrl: '/api', instance: { instanceId: 'i-1' } } },
            ],
        });
    });

    afterEach(() => {
        localStorage.clear();
        TestBed.resetTestingModule();
    });

    it('offers the move on an empty server and summarizes browser playlists', async () => {
        const offer = await TestBed.inject(ServerMigrationService).offerOnStartup();

        expect(offer).toEqual([
            { id: 'm', title: 'Family', kind: 'm3u' },
            { id: 'x', title: 'Provider', kind: 'xtream' },
        ]);
    });

    it('does not offer after a decision or when the server has playlists', async () => {
        const migration = TestBed.inject(ServerMigrationService);
        session.fetchStatus.mockResolvedValueOnce({ playlists: 3 });
        expect(await migration.offerOnStartup()).toBeNull();

        migration.skip();
        expect(await migration.offerOnStartup()).toBeNull();
    });

    it('copies playlists with their ids and their Xtream user data to an empty server', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ x: ['live:1'], other: ['live:2'] }));
        const migration = TestBed.inject(ServerMigrationService);

        const result = await migration.moveBrowserData();

        expect(result).toEqual({ imported: 2, merged: 0, failed: 0 });
        expect(session.documentStore.dbUpsertAppPlaylist).toHaveBeenCalledTimes(2);
        expect(session.api.sendJson).toHaveBeenCalledWith('PUT', '/user-state/xtream-favorites/x', {
            value: ['live:1'],
        });
        expect(session.api.sendJson).toHaveBeenCalledTimes(1);
        expect(migration.browserDataMoved()).toBe(true);
    });

    it('merges through the backup format when the server already has playlists', async () => {
        session.fetchStatus.mockResolvedValue({ playlists: 4 });

        const result = await TestBed.inject(ServerMigrationService).moveBrowserData();

        expect(backup.exportBackup).toHaveBeenCalled();
        expect(backup.importBackup).toHaveBeenCalledWith('{}');
        expect(result).toEqual({ imported: 1, merged: 1, failed: 0 });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-migration`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { inject, Injectable } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';
import {
    DbStores,
    SERVER_USER_STATE_NAMESPACES,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import { PlaylistBackupService } from '../playlist-backup.service';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';

const MARKER_PREFIX = 'iptvnator-server:migration:';

export interface ServerMigrationPlaylist {
    readonly id: string;
    readonly title: string;
    readonly kind: 'm3u' | 'xtream' | 'stalker';
}

export interface ServerMigrationResult {
    readonly imported: number;
    readonly merged: number;
    readonly failed: number;
}

/**
 * Moves this browser's playlists to the server. An empty server receives
 * them with their ids plus the legacy Xtream user-data maps; a server that
 * already has playlists goes through the backup export/import, whose
 * fingerprints merge duplicates. Browser data is never deleted.
 */
@Injectable({ providedIn: 'root' })
export class ServerMigrationService {
    private readonly dbService = inject(NgxIndexedDBService);
    private readonly session = inject(ServerStorageSession);
    private readonly backend = inject(PlaylistStorageBackend);
    private readonly backup = inject(PlaylistBackupService);
    private readonly instanceId = inject(SERVER_STORAGE_CONFIG).instance.instanceId;

    async browserPlaylists(): Promise<ServerMigrationPlaylist[]> {
        const playlists = await this.readBrowserPlaylists();
        return playlists.map((playlist) => ({
            id: playlist._id,
            title: playlist.title,
            kind: playlist.serverUrl ? 'xtream' : playlist.macAddress ? 'stalker' : 'm3u',
        }));
    }

    /** The startup offer: only for an empty server and an undecided browser. */
    async offerOnStartup(): Promise<ServerMigrationPlaylist[] | null> {
        if (this.readMarker() !== null) {
            return null;
        }
        const playlists = await this.browserPlaylists();
        if (playlists.length === 0) {
            return null;
        }
        const { playlists: serverCount } = await this.session.fetchStatus();
        return serverCount === 0 ? playlists : null;
    }

    browserDataMoved(): boolean {
        return this.readMarker() === 'done';
    }

    skip(): void {
        this.writeMarker('skipped');
    }

    async moveBrowserData(): Promise<ServerMigrationResult> {
        const { playlists: serverCount } = await this.session.fetchStatus();
        const result =
            serverCount === 0 ? await this.copyWithIds() : await this.mergeThroughBackup();
        this.writeMarker('done');
        return result;
    }

    private async copyWithIds(): Promise<ServerMigrationResult> {
        const playlists = await this.readBrowserPlaylists();
        let imported = 0;
        let failed = 0;
        for (const playlist of playlists) {
            try {
                await this.session.documentStore.dbUpsertAppPlaylist(playlist);
                imported += 1;
            } catch {
                failed += 1;
            }
        }
        await this.copyXtreamUserData(new Set(playlists.map((p) => p._id)));
        return { imported, merged: 0, failed };
    }

    private async copyXtreamUserData(playlistIds: ReadonlySet<string>): Promise<void> {
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const legacy = parseMap(localStorage.getItem(namespace));
            for (const [playlistId, value] of Object.entries(legacy)) {
                if (playlistIds.has(playlistId)) {
                    await this.session.api.sendJson(
                        'PUT',
                        `/user-state/${namespace}/${encodeURIComponent(playlistId)}`,
                        { value }
                    );
                }
            }
        }
        await this.session.userData.hydrate();
    }

    private async mergeThroughBackup(): Promise<ServerMigrationResult> {
        const { json } = await this.backend.runWithBrowserStorage(() =>
            this.backup.exportBackup()
        );
        const summary = await this.backup.importBackup(json);
        return { imported: summary.imported, merged: summary.merged, failed: summary.failed };
    }

    private readBrowserPlaylists(): Promise<Playlist[]> {
        return firstValueFrom(this.dbService.getAll<Playlist>(DbStores.Playlists));
    }

    private readMarker(): string | null {
        try {
            return localStorage.getItem(MARKER_PREFIX + this.instanceId);
        } catch {
            return null;
        }
    }

    private writeMarker(value: 'done' | 'skipped'): void {
        try {
            localStorage.setItem(MARKER_PREFIX + this.instanceId, value);
        } catch {
            // Without storage the offer simply returns next time.
        }
    }
}

function parseMap(value: string | null): Record<string, unknown> {
    try {
        const parsed: unknown = value ? JSON.parse(value) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}
```

Add to `server-storage/index.ts`:

```ts
export * from './server-migration.service';
```

- [ ] **Step 4: Run, lint the library, then commit**

```bash
pnpm nx test services --testPathPatterns=server-migration
pnpm nx lint services
git add libs/services/src/lib/server-storage
git commit -m "feat(services): move browser playlists to the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, 4 tests; no lint errors.

---

### Task 8: Startup probe, providers, routes and guards

**Files:**
- Create: `apps/web/src/app/server-storage/server-instance-probe.ts` (+ `.spec.ts`)
- Create: `apps/web/src/app/server-storage/server-storage.providers.ts`
- Create: `apps/web/src/app/server-storage/server-access.guard.ts` (+ `.spec.ts`)
- Create: `apps/web/src/app/server-storage/server-migration-prompt.service.ts`
- Modify: `apps/web/src/main.ts`, `apps/web/src/app/app.routes.ts`, `apps/web/src/app/services/pwa.service.ts`

- [ ] **Step 1: Write the failing specs**

`server-instance-probe.spec.ts`:

```ts
import { probeServerInstance } from './server-instance-probe';

const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

describe('probeServerInstance', () => {
    const ok = (body: unknown) =>
        jest.fn().mockResolvedValue({ ok: true, json: async () => body });

    it('skips the probe without a runtime backend URL', async () => {
        const fetchFn = ok(instance);
        await expect(
            probeServerInstance({ runtimeConfig: {}, fetchFn: fetchFn as never })
        ).resolves.toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('skips the probe in Electron', async () => {
        await expect(
            probeServerInstance({
                runtimeConfig: { BACKEND_URL: '/api' },
                isElectron: true,
                fetchFn: ok(instance) as never,
            })
        ).resolves.toBeNull();
    });

    it('returns the instance when it reports server storage', async () => {
        const fetchFn = ok(instance);
        await expect(
            probeServerInstance({ runtimeConfig: { BACKEND_URL: '/api/' }, fetchFn: fetchFn as never })
        ).resolves.toEqual(instance);
        expect(fetchFn.mock.calls[0][0]).toBe('/api/v1/instance');
    });

    it('returns null for storage none, bad bodies and failures', async () => {
        const config = { runtimeConfig: { BACKEND_URL: '/api' } };
        await expect(
            probeServerInstance({ ...config, fetchFn: ok({ ...instance, storage: 'none' }) as never })
        ).resolves.toBeNull();
        await expect(
            probeServerInstance({ ...config, fetchFn: ok({ hello: 1 }) as never })
        ).resolves.toBeNull();
        await expect(
            probeServerInstance({ ...config, fetchFn: jest.fn().mockRejectedValue(new Error('x')) as never })
        ).resolves.toBeNull();
    });
});
```

`server-access.guard.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { ServerStorageStatusService } from '@iptvnator/services';
import { serverAccessGuard, serverSignInGuard } from './server-access.guard';

describe('server access guards', () => {
    function run(guard: typeof serverAccessGuard, state: string) {
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: ServerStorageStatusService, useValue: { state: () => state } },
            ],
        });
        return TestBed.runInInjectionContext(() => guard({} as never, {} as never));
    }

    afterEach(() => TestBed.resetTestingModule());

    it('sends an unauthorized workspace visit to the sign-in page', () => {
        const result = run(serverAccessGuard, 'unauthorized') as UrlTree;
        expect(TestBed.inject(Router).serializeUrl(result)).toBe('/server-sign-in');
    });

    it('lets everyone else into the workspace', () => {
        expect(run(serverAccessGuard, 'online')).toBe(true);
        TestBed.resetTestingModule();
        expect(run(serverAccessGuard, 'inactive')).toBe(true);
    });

    it('opens the sign-in page only while unauthorized', () => {
        expect(run(serverSignInGuard, 'unauthorized')).toBe(true);
        TestBed.resetTestingModule();
        const result = run(serverSignInGuard, 'online') as UrlTree;
        expect(TestBed.inject(Router).serializeUrl(result)).toBe('/workspace');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web --testPathPatterns="server-instance-probe|server-access.guard"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the probe and the guards**

`server-instance-probe.ts`:

```ts
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type { IptvnatorRuntimeConfig } from '../services/runtime-config';

const PROBE_TIMEOUT_MS = 2_500;

export interface ServerInstanceProbeOptions {
    readonly runtimeConfig?: IptvnatorRuntimeConfig;
    readonly isElectron?: boolean;
    readonly fetchFn?: typeof fetch;
}

/**
 * Asks the backend whether it offers server storage. Runs only when the
 * deployment wrote a runtime `BACKEND_URL` (the Docker entrypoint does), so
 * hosted builds never call an external parser API for it.
 */
export async function probeServerInstance(
    options: ServerInstanceProbeOptions = {}
): Promise<ServerInstanceInfo | null> {
    const runtimeConfig = options.runtimeConfig ?? globalThis.window?.__IPTVNATOR_CONFIG__;
    const isElectron = options.isElectron ?? !!globalThis.window?.electron;
    const baseUrl = runtimeConfig?.BACKEND_URL?.trim();
    if (isElectron || !baseUrl) {
        return null;
    }

    try {
        const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
        const response = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/v1/instance`, {
            cache: 'no-store',
            signal:
                typeof AbortSignal.timeout === 'function'
                    ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
                    : undefined,
        });
        if (!response.ok) {
            return null;
        }
        const body: unknown = await response.json();
        return isServerInstance(body) && body.storage === 'server' ? body : null;
    } catch {
        return null;
    }
}

function isServerInstance(value: unknown): value is ServerInstanceInfo {
    const record = value as Partial<ServerInstanceInfo> | null;
    return (
        !!record &&
        record.service === 'iptvnator' &&
        typeof record.apiVersion === 'number' &&
        (record.storage === 'server' || record.storage === 'none') &&
        (record.auth === 'none' || record.auth === 'token')
    );
}
```

If `window.__IPTVNATOR_CONFIG__` is not typed on `Window`, check `apps/web/src/typings.d.ts`; it already declares it for `runtime-config.ts`. Do not add a second declaration.

`server-access.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ServerStorageStatusService } from '@iptvnator/services';

export const serverAccessGuard: CanActivateFn = () =>
    inject(ServerStorageStatusService).state() === 'unauthorized'
        ? inject(Router).parseUrl('/server-sign-in')
        : true;

export const serverSignInGuard: CanActivateFn = () =>
    inject(ServerStorageStatusService).state() === 'unauthorized'
        ? true
        : inject(Router).parseUrl('/workspace');
```

- [ ] **Step 4: Implement the prompt service and providers**

`server-migration-prompt.service.ts`:

```ts
import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { ServerStorageStatusService } from '@iptvnator/services';
import { ServerMigrationService } from '@iptvnator/services/server-storage';

/** Opens the migration dialog once, after the first navigation settles. */
@Injectable({ providedIn: 'root' })
export class ServerMigrationPrompt {
    private readonly router = inject(Router);
    private readonly dialog = inject(MatDialog);
    private readonly status = inject(ServerStorageStatusService);
    private readonly migration = inject(ServerMigrationService);

    schedule(): void {
        this.router.events
            .pipe(
                filter((event) => event instanceof NavigationEnd),
                take(1)
            )
            .subscribe(() => void this.offer());
    }

    private async offer(): Promise<void> {
        if (this.status.state() !== 'online') {
            return;
        }
        let playlists;
        try {
            playlists = await this.migration.offerOnStartup();
        } catch {
            return; // IndexedDB or server unreadable: ask again next start.
        }
        if (!playlists) {
            return;
        }
        const { ServerMigrationDialogComponent } = await import(
            './server-migration-dialog.component'
        );
        this.dialog.open(ServerMigrationDialogComponent, {
            data: playlists,
            width: '540px',
            maxWidth: 'calc(100vw - 32px)',
            disableClose: true,
        });
    }
}
```

`server-storage.providers.ts`:

```ts
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import {
    EnvironmentProviders,
    inject,
    provideAppInitializer,
    Provider,
} from '@angular/core';
import { USER_DATA_STORAGE } from '@iptvnator/services';
import {
    SERVER_STORAGE_CONFIG,
    ServerAccessTokenInterceptor,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import { ServerMigrationPrompt } from './server-migration-prompt.service';

/** Loaded with a dynamic import from `main.ts`, only in server mode. */
export function provideServerStorage(
    instance: ServerInstanceInfo,
    baseUrl: string
): (Provider | EnvironmentProviders)[] {
    return [
        { provide: SERVER_STORAGE_CONFIG, useValue: { instance, baseUrl } },
        {
            provide: USER_DATA_STORAGE,
            useFactory: () => inject(ServerStorageSession).userData,
        },
        {
            provide: HTTP_INTERCEPTORS,
            useClass: ServerAccessTokenInterceptor,
            multi: true,
        },
        provideAppInitializer(() => inject(ServerStorageSession).start()),
        provideAppInitializer(() => inject(ServerMigrationPrompt).schedule()),
    ];
}
```

- [ ] **Step 5: Wire `main.ts`**

Replace the bootstrap chain in `apps/web/src/main.ts` (keep the restored-route block above it):

```ts
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { probeServerInstance } from './app/server-storage/server-instance-probe';
import { getRuntimeBackendUrl } from './app/services/runtime-config';

async function resolveAppConfig(): Promise<ApplicationConfig> {
    const instance = await probeServerInstance();
    if (!instance) {
        return appConfig;
    }
    const { provideServerStorage } = await import(
        './app/server-storage/server-storage.providers'
    );
    return mergeApplicationConfig(appConfig, {
        providers: provideServerStorage(instance, getRuntimeBackendUrl()),
    });
}

// Angular ships only English locale data; the preferred language's data is a
// lazy chunk. It is awaited before bootstrapping because the first route
// renders dates with that locale, and a locale without data throws. English
// (the default) resolves immediately. The server-storage probe runs in
// parallel and only when the deployment provides a runtime backend URL.
Promise.all([registerAppDateLocale(getInitialLanguage()), resolveAppConfig()])
    .then(([, config]) => bootstrapApplication(AppComponent, config))
    .then(() => {
        requestAnimationFrame(() => {
            document.getElementById('initial-splash')?.remove();
        });
    })
    .catch((err) => console.error(err));
```

Merge the new imports with the existing import block at the top of the file instead of adding a second block.

- [ ] **Step 6: Routes**

In `apps/web/src/app/app.routes.ts`:

1. Add `import { serverAccessGuard, serverSignInGuard } from './server-storage/server-access.guard';`
2. In the `path: 'workspace'` route, add after the `resolve: { ... }` block:

```ts
        canActivate: [serverAccessGuard],
```

3. Before the `path: 'settings'` redirect, add:

```ts
    {
        path: 'server-sign-in',
        canActivate: [serverSignInGuard],
        loadComponent: () =>
            import('./server-storage/server-sign-in.component').then(
                (c) => c.ServerSignInComponent
            ),
    },
```

(The component is created in Task 9; until then the route file compiles but the lazy chunk is missing. Run Task 9 before the build in Step 8.)

- [ ] **Step 7: Token on the raw Stalker `fetch`**

In `apps/web/src/app/services/pwa.service.ts`, add `serverAuthorizationHeaders` to the existing `@iptvnator/services` import (or add `import { serverAuthorizationHeaders } from '@iptvnator/services';`) and change

```ts
            const response = await fetch(requestUrl);
```

to

```ts
            const response = await fetch(requestUrl, {
                headers: serverAuthorizationHeaders(),
            });
```

All other backend calls go through `HttpClient` and get the header from the interceptor.

- [ ] **Step 8: Run and commit**

```bash
pnpm nx test web --testPathPatterns="server-instance-probe|server-access.guard|pwa.service|runtime-config"
git add apps/web/src/main.ts apps/web/src/app/app.routes.ts apps/web/src/app/services/pwa.service.ts apps/web/src/app/server-storage
git commit -m "feat(pwa): probe for server storage and wire server mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS. (`pnpm run typecheck:web` runs after Task 9 creates the components.)

---

### Task 9: Sign-in page and migration dialog

**Files:**
- Create: `apps/web/src/app/server-storage/server-sign-in.component.ts`, `.html`, `.scss`, `.spec.ts`
- Create: `apps/web/src/app/server-storage/server-migration-dialog.component.ts`, `.html`, `.scss`, `.spec.ts`

- [ ] **Step 1: Write the failing specs**

`server-sign-in.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ServerStorageSession } from '@iptvnator/services/server-storage';
import { ServerSignInComponent } from './server-sign-in.component';

describe('ServerSignInComponent', () => {
    let fixture: ComponentFixture<ServerSignInComponent>;
    const session = { fetchStatus: jest.fn() };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ServerSignInComponent, TranslateModule.forRoot()],
            providers: [{ provide: ServerStorageSession, useValue: session }],
        }).compileComponents();
        fixture = TestBed.createComponent(ServerSignInComponent);
        fixture.detectChanges();
    });

    afterEach(() => localStorage.clear());

    it('shows a rejection and clears the token when the server refuses it', async () => {
        session.fetchStatus.mockRejectedValue(new Error('401'));
        const component = fixture.componentInstance;

        component.token.set('wrong');
        await component.submit(new Event('submit'));
        fixture.detectChanges();

        expect(component.rejected()).toBe(true);
        expect(localStorage.getItem('iptvnator-server:access-token')).toBeNull();
        expect(fixture.nativeElement.querySelector('[data-test-id="server-sign-in-error"]')).not.toBeNull();
    });

    it('keeps an accepted token and reloads into the workspace', async () => {
        session.fetchStatus.mockResolvedValue({ playlists: 0 });
        const component = fixture.componentInstance;
        const navigate = jest.spyOn(component, 'openWorkspace').mockImplementation(() => undefined);

        component.token.set('right');
        await component.submit(new Event('submit'));

        expect(localStorage.getItem('iptvnator-server:access-token')).toBe('right');
        expect(navigate).toHaveBeenCalled();
    });
});
```

`server-migration-dialog.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { ServerMigrationService } from '@iptvnator/services/server-storage';
import { ServerMigrationDialogComponent } from './server-migration-dialog.component';

describe('ServerMigrationDialogComponent', () => {
    let fixture: ComponentFixture<ServerMigrationDialogComponent>;
    const migration = { skip: jest.fn(), moveBrowserData: jest.fn() };
    const dialogRef = { close: jest.fn() };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ServerMigrationDialogComponent, TranslateModule.forRoot()],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: [{ id: 'm', title: 'Family', kind: 'm3u' }] },
                { provide: ServerMigrationService, useValue: migration },
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(ServerMigrationDialogComponent);
        fixture.detectChanges();
    });

    it('lists the browser playlists', () => {
        expect(fixture.nativeElement.textContent).toContain('Family');
    });

    it('records "not now" and closes', () => {
        fixture.componentInstance.notNow();

        expect(migration.skip).toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('moves the data and shows the result', async () => {
        migration.moveBrowserData.mockResolvedValue({ imported: 1, merged: 0, failed: 0 });

        await fixture.componentInstance.move();
        fixture.detectChanges();

        expect(fixture.componentInstance.result()).toEqual({ imported: 1, merged: 0, failed: 0 });
        expect(fixture.nativeElement.querySelector('[data-test-id="server-migration-reload"]')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web --testPathPatterns="server-sign-in|server-migration-dialog"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the sign-in page**

`server-sign-in.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { clearServerAccessToken, writeServerAccessToken } from '@iptvnator/services';
import { ServerStorageSession } from '@iptvnator/services/server-storage';

@Component({
    selector: 'app-server-sign-in',
    imports: [MatButtonModule, MatFormFieldModule, MatInputModule, TranslatePipe],
    templateUrl: './server-sign-in.component.html',
    styleUrl: './server-sign-in.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerSignInComponent {
    private readonly session = inject(ServerStorageSession);

    readonly token = signal('');
    readonly busy = signal(false);
    readonly rejected = signal(false);

    async submit(event: Event): Promise<void> {
        event.preventDefault();
        const token = this.token().trim();
        if (!token || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.rejected.set(false);
        writeServerAccessToken(token);
        try {
            await this.session.fetchStatus();
            this.openWorkspace();
        } catch {
            clearServerAccessToken();
            this.rejected.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    /** Full reload so every service starts with the token. */
    openWorkspace(): void {
        window.location.assign(new URL('workspace', document.baseURI).href);
    }
}
```

`server-sign-in.component.html`:

```html
<main class="server-sign-in">
    <form class="server-sign-in__card" (submit)="submit($event)">
        <img
            class="server-sign-in__logo"
            src="./assets/icons/icon-tv-256.png"
            alt=""
            width="40"
            height="40"
        />
        <h1>{{ 'SERVER_STORAGE.SIGN_IN_TITLE' | translate }}</h1>
        <p>{{ 'SERVER_STORAGE.SIGN_IN_DESCRIPTION' | translate }}</p>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>{{ 'SERVER_STORAGE.SIGN_IN_TOKEN_LABEL' | translate }}</mat-label>
            <input
                matInput
                id="server-access-token"
                type="password"
                autocomplete="current-password"
                [value]="token()"
                (input)="token.set($any($event.target).value)"
                data-test-id="server-sign-in-token"
            />
            <mat-hint>{{ 'SERVER_STORAGE.SIGN_IN_HINT' | translate }}</mat-hint>
        </mat-form-field>

        @if (rejected()) {
            <p class="server-sign-in__error" role="alert" data-test-id="server-sign-in-error">
                {{ 'SERVER_STORAGE.SIGN_IN_REJECTED' | translate }}
            </p>
        }

        <button
            mat-flat-button
            type="submit"
            [disabled]="busy() || !token().trim()"
            data-test-id="server-sign-in-submit"
        >
            {{ 'SERVER_STORAGE.SIGN_IN_CONTINUE' | translate }}
        </button>
    </form>
</main>
```

`server-sign-in.component.scss`:

```scss
:host {
    display: block;
    min-height: 100%;
    background: var(--app-shell-bg);
}

.server-sign-in {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
}

.server-sign-in__card {
    width: min(100%, 420px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 28px;
    border-radius: 20px;
    background: var(--app-widget-bg);
    box-shadow: var(--app-widget-shadow);
    color: var(--app-on-surface);

    h1 {
        margin: 0;
        font-size: 1.3rem;
        font-weight: 650;
        color: var(--app-heading-color);
    }

    p {
        margin: 0;
        color: var(--app-body-color);
        font-size: 0.9rem;
        line-height: 1.45;
    }

    button {
        align-self: flex-end;
    }
}

.server-sign-in__logo {
    border-radius: 12px;
}

.server-sign-in__error {
    color: var(--app-expiry-expired-text) !important;
}
```

- [ ] **Step 4: Implement the migration dialog**

`server-migration-dialog.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ServerMigrationService,
    type ServerMigrationPlaylist,
    type ServerMigrationResult,
} from '@iptvnator/services/server-storage';
import { SOURCE_TYPE_ICONS } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-server-migration-dialog',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
    templateUrl: './server-migration-dialog.component.html',
    styleUrl: './server-migration-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerMigrationDialogComponent {
    private readonly migration = inject(ServerMigrationService);
    private readonly dialogRef = inject(MatDialogRef<ServerMigrationDialogComponent>);

    readonly playlists = inject<readonly ServerMigrationPlaylist[]>(MAT_DIALOG_DATA);
    readonly icons = SOURCE_TYPE_ICONS;
    readonly busy = signal(false);
    readonly failed = signal(false);
    readonly result = signal<ServerMigrationResult | null>(null);

    notNow(): void {
        this.migration.skip();
        this.dialogRef.close();
    }

    async move(): Promise<void> {
        this.busy.set(true);
        this.failed.set(false);
        try {
            this.result.set(await this.migration.moveBrowserData());
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    reload(): void {
        window.location.reload();
    }
}
```

`server-migration-dialog.component.html`:

```html
<h2 mat-dialog-title>
    {{ 'SERVER_STORAGE.MIGRATION_TITLE' | translate: { count: playlists.length } }}
</h2>

<mat-dialog-content class="server-migration">
    @if (result(); as done) {
        <p data-test-id="server-migration-result">
            {{ 'SERVER_STORAGE.MIGRATION_DONE' | translate: done }}
        </p>
    } @else {
        <p>{{ 'SERVER_STORAGE.MIGRATION_DESCRIPTION' | translate }}</p>
        <ul class="server-migration__list">
            @for (playlist of playlists; track playlist.id) {
                <li>
                    <mat-icon aria-hidden="true">{{ icons[playlist.kind] }}</mat-icon>
                    <span>{{ playlist.title }}</span>
                </li>
            }
        </ul>
        @if (failed()) {
            <p class="server-migration__error" role="alert">
                {{ 'SERVER_STORAGE.MIGRATION_FAILED' | translate }}
            </p>
        }
    }
</mat-dialog-content>

<mat-dialog-actions align="end">
    @if (result()) {
        <button mat-flat-button type="button" (click)="reload()" data-test-id="server-migration-reload">
            {{ 'SERVER_STORAGE.MIGRATION_RELOAD' | translate }}
        </button>
    } @else {
        <span class="server-migration__hint">{{ 'SERVER_STORAGE.MIGRATION_LATER_HINT' | translate }}</span>
        <button mat-button type="button" [disabled]="busy()" (click)="notNow()">
            {{ 'SERVER_STORAGE.MIGRATION_NOT_NOW' | translate }}
        </button>
        <button mat-flat-button type="button" [disabled]="busy()" (click)="move()" data-test-id="server-migration-move">
            @if (busy()) {
                <mat-progress-spinner diameter="16" mode="indeterminate" />
            }
            {{ 'SERVER_STORAGE.MIGRATION_MOVE' | translate }}
        </button>
    }
</mat-dialog-actions>
```

`server-migration-dialog.component.scss`:

```scss
.server-migration {
    p {
        margin: 0 0 12px;
        color: var(--app-body-color);
    }
}

.server-migration__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;

    li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--app-card-hover-bg);
        color: var(--app-heading-color);
    }
}

.server-migration__hint {
    margin-right: auto;
    color: var(--app-muted-color);
    font-size: 0.8rem;
}

.server-migration__error {
    color: var(--app-expiry-expired-text) !important;
}
```

- [ ] **Step 5: Run, typecheck, commit**

```bash
pnpm nx test web --testPathPatterns="server-sign-in|server-migration-dialog"
pnpm run typecheck:web
git add apps/web/src/app/server-storage
git commit -m "feat(pwa): server sign-in page and migration dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (5 tests); no type errors. The translation keys are added in Task 13.

---

### Task 10: Settings → Server

**Files:**
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search.types.ts`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search-sections.ts`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.ts`
- Modify: `apps/web/src/app/settings/settings-options.ts`, `settings-options.spec.ts`
- Create: `apps/web/src/app/settings/settings-server-section.component.ts`, `.html`, `.spec.ts`
- Modify: `apps/web/src/app/settings/settings.component.ts`, `settings.component.html`

- [ ] **Step 1: Write the failing tests**

In `settings-options.spec.ts`, add `supportsServerStorage: true` to the two "supported" calls and `supportsServerStorage: false` to the "unsupported" call, then add:

```ts
    it('shows the server section only with server storage', () => {
        const withServer = buildSettingsSectionNavItems({
            supportsEpg: false,
            supportsRemoteControl: false,
            supportsServerStorage: true,
        });
        const without = buildSettingsSectionNavItems({
            supportsEpg: false,
            supportsRemoteControl: false,
            supportsServerStorage: false,
        });

        expect(withServer.find((item) => item.id === 'server')).toMatchObject({
            visible: true,
            group: 'data',
            icon: 'dns',
        });
        expect(without.find((item) => item.id === 'server')?.visible).toBe(false);
    });
```

`settings-server-section.component.spec.ts`:

```ts
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import { ServerMigrationService, ServerStorageSession } from '@iptvnator/services/server-storage';
import { SettingsServerSectionComponent } from './settings-server-section.component';

describe('SettingsServerSectionComponent', () => {
    let fixture: ComponentFixture<SettingsServerSectionComponent>;
    const session = { fetchStatus: jest.fn(), signOut: jest.fn() };
    const migration = {
        browserPlaylists: jest.fn(),
        browserDataMoved: jest.fn(() => false),
        moveBrowserData: jest.fn(),
    };

    async function render(auth: 'none' | 'token') {
        session.fetchStatus.mockResolvedValue({
            playlists: 4,
            databaseBytes: 38 * 1024 * 1024,
            databasePath: '/data/databases/iptvnator.db',
            startedAt: '2026-10-11T08:00:00.000Z',
        });
        migration.browserPlaylists.mockResolvedValue([{ id: 'a', title: 'A', kind: 'm3u' }]);
        await TestBed.configureTestingModule({
            imports: [SettingsServerSectionComponent, TranslateModule.forRoot()],
            providers: [
                { provide: ServerStorageSession, useValue: session },
                { provide: ServerMigrationService, useValue: migration },
                {
                    provide: ServerStorageStatusService,
                    useValue: {
                        state: signal('online'),
                        instance: signal({ auth, instanceId: 'i-1' }),
                        lastSuccessAt: signal(null),
                    },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(SettingsServerSectionComponent);
        await fixture.componentInstance.load();
        fixture.detectChanges();
    }

    afterEach(() => TestBed.resetTestingModule());

    it('shows storage figures and offers the browser import', async () => {
        await render('none');
        const text = fixture.nativeElement.textContent;

        expect(text).toContain('/data/databases/iptvnator.db');
        expect(text).toContain('38.0 MB');
        expect(fixture.nativeElement.querySelector('[data-test-id="server-import-browser"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-test-id="server-sign-out"]')).toBeNull();
    });

    it('offers sign out when a token is in use', async () => {
        await render('token');

        fixture.nativeElement.querySelector('[data-test-id="server-sign-out"]').click();

        expect(session.signOut).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web --testPathPatterns="settings-options|settings-server-section"`
Expected: FAIL (unknown property `supportsServerStorage`, missing component).

- [ ] **Step 3: Settings search contract**

1. In `settings-search.types.ts`, add `| 'server-storage'` to `SettingsSearchRequirement` (after `'embedded-mpv-frame-copy'`, with the comment `/** The PWA runs against self-hosted server storage. */`).
2. In `settings-search-sections.ts`, insert before the `backup` entry:

```ts
        {
            id: 'server',
            navLabelKey: 'SETTINGS.NAV_SERVER',
            icon: 'dns',
            requires: ['server-storage'],
            group: 'data',
        },
```

3. In `settings-search.service.ts`, add `ServerStorageStatusService` to the `@iptvnator/services` import, the field `private readonly serverStorageStatus = inject(ServerStorageStatusService);`, and in `capabilities()` the entry:

```ts
            'server-storage': this.serverStorageStatus.isActive(),
```

- [ ] **Step 4: Settings page wiring**

In `settings-options.ts`, extend the visibility type and map:

```ts
export interface SettingsSectionVisibility {
    supportsEpg: boolean;
    supportsRemoteControl: boolean;
    supportsServerStorage: boolean;
}

export function buildSettingsSectionNavItems({
    supportsEpg,
    supportsRemoteControl,
    supportsServerStorage,
}: SettingsSectionVisibility): SettingsSection[] {
    const capabilities = {
        epg: supportsEpg,
        'remote-control': supportsRemoteControl,
        'server-storage': supportsServerStorage,
    };
```

(the `return` block is unchanged).

In `settings.component.ts`:

1. Add `ServerStorageStatusService` to the `@iptvnator/services` import and import `SettingsServerSectionComponent` from `./settings-server-section.component`; add it to the component `imports` array.
2. Add next to `supportsRemoteControl`:

```ts
    readonly supportsServerStorage = inject(ServerStorageStatusService).isActive();
```

3. Pass it in `buildSettingsSectionNavItems({ ... supportsServerStorage: this.supportsServerStorage })`.

In `settings.component.html`, directly before `@case ('backup') {` add:

```html
                @case ('server') {
                    <app-settings-server-section (exportData)="exportData()" />
                }
```

- [ ] **Step 5: The section component**

`settings-server-section.component.ts`:

```ts
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    output,
    signal,
    ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import {
    ServerMigrationService,
    ServerStorageSession,
    type ServerMigrationResult,
} from '@iptvnator/services/server-storage';
import type { ServerStorageStatusResponse } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-settings-server-section',
    imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
    templateUrl: './settings-server-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsServerSectionComponent {
    private readonly status = inject(ServerStorageStatusService);
    private readonly session = inject(ServerStorageSession);
    private readonly migration = inject(ServerMigrationService);

    readonly exportData = output<void>();

    readonly state = this.status.state;
    readonly usesToken = computed(() => this.status.instance()?.auth === 'token');
    readonly address = globalThis.location?.origin ?? '';
    readonly details = signal<ServerStorageStatusResponse | null>(null);
    readonly browserPlaylistCount = signal(0);
    readonly importing = signal(false);
    readonly importResult = signal<ServerMigrationResult | null>(null);
    readonly sizeLabel = computed(() =>
        formatMegabytes(this.details()?.databaseBytes ?? 0)
    );
    readonly canImportBrowser = computed(
        () => this.browserPlaylistCount() > 0 && !this.migration.browserDataMoved()
    );

    constructor() {
        void this.load();
    }

    async load(): Promise<void> {
        try {
            this.details.set(await this.session.fetchStatus());
        } catch {
            this.details.set(null);
        }
        try {
            this.browserPlaylistCount.set((await this.migration.browserPlaylists()).length);
        } catch {
            this.browserPlaylistCount.set(0);
        }
    }

    async importBrowserPlaylists(): Promise<void> {
        this.importing.set(true);
        try {
            this.importResult.set(await this.migration.moveBrowserData());
            await this.load();
        } finally {
            this.importing.set(false);
        }
    }

    signOut(): void {
        this.session.signOut();
    }
}

function formatMegabytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

`settings-server-section.component.html`:

```html
<section class="settings-group" id="server">
    <header class="settings-group__header">
        <h2>{{ 'SETTINGS.NAV_SERVER' | translate }}</h2>
        <p>{{ 'SETTINGS.SERVER_DESCRIPTION' | translate }}</p>
    </header>

    <div class="settings-card">
        <div class="setting-item" data-setting-id="server-connection">
            <div class="setting-item__meta">
                <h4>{{ 'SETTINGS.SERVER_CONNECTION' | translate }}</h4>
                <p>{{ address }}</p>
            </div>
            <div class="setting-item__control">
                <span class="server-state" [attr.data-state]="state()" data-test-id="server-state">
                    {{
                        (state() === 'online'
                            ? 'SETTINGS.SERVER_CONNECTED'
                            : 'SETTINGS.SERVER_OFFLINE') | translate
                    }}
                </span>
            </div>
        </div>

        <div class="setting-item" data-setting-id="server-storage">
            <div class="setting-item__meta">
                <h4>{{ 'SETTINGS.SERVER_STORAGE' | translate }}</h4>
                @if (details(); as info) {
                    <p>
                        {{
                            'SETTINGS.SERVER_STORAGE_SUMMARY'
                                | translate: { playlists: info.playlists, size: sizeLabel() }
                        }}
                    </p>
                    <p>{{ info.databasePath }}</p>
                }
            </div>
            <div class="setting-item__control inline-actions">
                <button mat-stroked-button type="button" (click)="exportData.emit()">
                    {{ 'SETTINGS.SERVER_EXPORT_BACKUP' | translate }}
                </button>
            </div>
        </div>

        @if (canImportBrowser()) {
            <div class="setting-item" data-setting-id="server-import-browser">
                <div class="setting-item__meta">
                    <h4>{{ 'SETTINGS.SERVER_IMPORT_BROWSER' | translate }}</h4>
                    <p>
                        {{
                            'SETTINGS.SERVER_IMPORT_BROWSER_DESCRIPTION'
                                | translate: { count: browserPlaylistCount() }
                        }}
                    </p>
                    @if (importResult(); as done) {
                        <p>{{ 'SERVER_STORAGE.MIGRATION_DONE' | translate: done }}</p>
                    }
                </div>
                <div class="setting-item__control">
                    <button
                        mat-flat-button
                        type="button"
                        [disabled]="importing()"
                        (click)="importBrowserPlaylists()"
                        data-test-id="server-import-browser"
                    >
                        @if (importing()) {
                            <mat-progress-spinner diameter="16" mode="indeterminate" />
                        }
                        {{ 'SERVER_STORAGE.MIGRATION_MOVE' | translate }}
                    </button>
                </div>
            </div>
        }

        <div class="setting-item" data-setting-id="server-access">
            <div class="setting-item__meta">
                <h4>{{ 'SETTINGS.SERVER_ACCESS' | translate }}</h4>
                <p>
                    {{
                        (usesToken()
                            ? 'SETTINGS.SERVER_ACCESS_TOKEN'
                            : 'SETTINGS.SERVER_ACCESS_OPEN_DESCRIPTION') | translate
                    }}
                </p>
            </div>
            @if (usesToken()) {
                <div class="setting-item__control">
                    <button mat-stroked-button type="button" (click)="signOut()" data-test-id="server-sign-out">
                        {{ 'SETTINGS.SERVER_SIGN_OUT' | translate }}
                    </button>
                </div>
            }
        </div>
    </div>
</section>
```

Add the state pill style to `apps/web/src/app/settings/settings.component.scss` (the settings section styles live there):

```scss
.server-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--app-selection-color);
    background: var(--app-selection-surface);

    &[data-state='offline'],
    &[data-state='unauthorized'] {
        color: var(--app-expiry-warn-text);
        background: var(--app-expiry-warn-surface);
    }
}
```

- [ ] **Step 6: Run, then commit**

```bash
pnpm nx test web --testPathPatterns="settings"
pnpm nx test workspace-shell-util
pnpm run typecheck:web
git add apps/web/src/app/settings libs/workspace/shell/util/src/lib/settings-search
git commit -m "feat(settings): server section for self-hosted storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS, including "every nav id renders a section page in the settings template".

---

### Task 11: Rail indicator and offline banner

**Files:**
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-rail/workspace-shell-rail.component.ts`, `.html`, `.scss`, `.spec.ts`
- Create: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-server-banner/workspace-shell-server-banner.component.ts`, `.scss`, `.spec.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.ts`, `.html`

- [ ] **Step 1: Write the failing tests**

Append to `workspace-shell-rail.component.spec.ts` (inside the `describe`; add `import { ServerStorageStatusService } from '@iptvnator/services';`):

```ts
    it('hides the server indicator without server storage', () => {
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('[data-test-id="rail-server-status"]')
        ).toBeNull();
    });

    it('shows the server state once server storage is active', () => {
        const status = TestBed.inject(ServerStorageStatusService);
        status.activate(
            { service: 'iptvnator', apiVersion: 1, instanceId: 'i', storage: 'server', auth: 'none' },
            () => undefined
        );
        status.reportOffline();
        fixture.detectChanges();

        const link = fixture.nativeElement.querySelector('[data-test-id="rail-server-status"]');
        expect(link.getAttribute('data-state')).toBe('offline');
        expect(link.textContent).toContain('cloud_off');
    });
```

`workspace-shell-server-banner.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import { WorkspaceShellServerBannerComponent } from './workspace-shell-server-banner.component';

describe('WorkspaceShellServerBannerComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellServerBannerComponent>;
    let status: ServerStorageStatusService;
    const retry = jest.fn();

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceShellServerBannerComponent, TranslateModule.forRoot()],
        }).compileComponents();
        status = TestBed.inject(ServerStorageStatusService);
        fixture = TestBed.createComponent(WorkspaceShellServerBannerComponent);
    });

    it('renders nothing while online', () => {
        status.activate({ service: 'iptvnator', apiVersion: 1, instanceId: 'i', storage: 'server', auth: 'none' }, retry);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-test-id="server-offline-banner"]')).toBeNull();
    });

    it('explains the offline state and retries', () => {
        status.activate({ service: 'iptvnator', apiVersion: 1, instanceId: 'i', storage: 'server', auth: 'none' }, retry);
        status.reportOffline();
        fixture.detectChanges();

        fixture.nativeElement.querySelector('[data-test-id="server-offline-retry"]').click();

        expect(retry).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test workspace-shell-feature --testPathPatterns="workspace-shell-rail|server-banner"`
Expected: FAIL.

- [ ] **Step 3: Rail**

In `workspace-shell-rail.component.ts`, change the Angular import to include `computed` and `inject`, add `import { ServerStorageStatusService } from '@iptvnator/services';`, and add to the class:

```ts
    private readonly serverStatus = inject(ServerStorageStatusService);
    readonly serverState = this.serverStatus.state;
    readonly serverIcon = computed(
        () =>
            ({ offline: 'cloud_off', unauthorized: 'lock' })[
                this.serverState() as 'offline' | 'unauthorized'
            ] ?? 'dns'
    );
    readonly serverTooltipKey = computed(() => {
        switch (this.serverState()) {
            case 'offline':
                return 'SERVER_STORAGE.STATUS_OFFLINE';
            case 'unauthorized':
                return 'SERVER_STORAGE.STATUS_UNAUTHORIZED';
            default:
                return 'SERVER_STORAGE.STATUS_ONLINE';
        }
    });
```

In `workspace-shell-rail.component.html`, inside `<div class="rail-footer">` before the settings `<a>`:

```html
        @if (serverState() !== 'inactive') {
            <a
                class="rail-shortcut nav-item rail-server"
                routerLink="/workspace/settings/server"
                [attr.data-state]="serverState()"
                [matTooltip]="serverTooltipKey() | translate"
                [matTooltipPosition]="'right'"
                [attr.aria-label]="serverTooltipKey() | translate"
                data-test-id="rail-server-status"
            >
                <mat-icon>{{ serverIcon() }}</mat-icon>
                <span class="rail-server__dot" aria-hidden="true"></span>
            </a>
        }
```

Append to `workspace-shell-rail.component.scss`:

```scss
.rail-server {
    mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
    }

    .rail-server__dot {
        position: absolute;
        right: 9px;
        bottom: 9px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        border: 2px solid var(--app-rail-bg);
        background: var(--app-selection-color);
    }

    &[data-state='offline'] {
        color: var(--app-expiry-warn-text);

        .rail-server__dot {
            background: var(--app-expiry-warn-text);
        }
    }

    &[data-state='unauthorized'] {
        color: var(--app-expiry-expired-text);

        .rail-server__dot {
            background: var(--app-expiry-expired-text);
        }
    }
}
```

- [ ] **Step 4: Banner**

`workspace-shell-server-banner.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';

@Component({
    selector: 'app-workspace-shell-server-banner',
    imports: [MatButtonModule, MatIcon, TranslatePipe],
    template: `
        @if (status.state() === 'offline') {
            <div class="server-banner" role="status" data-test-id="server-offline-banner">
                <mat-icon aria-hidden="true">cloud_off</mat-icon>
                <span>{{ 'SERVER_STORAGE.OFFLINE_BANNER' | translate }}</span>
                <button
                    mat-stroked-button
                    type="button"
                    (click)="status.retry()"
                    data-test-id="server-offline-retry"
                >
                    {{ 'SERVER_STORAGE.RETRY' | translate }}
                </button>
            </div>
        }
    `,
    styleUrl: './workspace-shell-server-banner.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellServerBannerComponent {
    readonly status = inject(ServerStorageStatusService);
}
```

`workspace-shell-server-banner.component.scss`:

```scss
:host {
    display: block;
    position: sticky;
    top: 0;
    z-index: 3;
}

.server-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 16px;
    background: var(--app-expiry-warn-surface);
    border-bottom: 1px solid var(--app-separator);
    color: var(--app-heading-color);
    font-size: 0.88rem;

    mat-icon {
        color: var(--app-expiry-warn-text);
    }

    button {
        margin-left: auto;
    }
}
```

In `workspace-shell.component.ts`, import `WorkspaceShellServerBannerComponent` from `./components/workspace-shell-server-banner/workspace-shell-server-banner.component` and add it to `imports`. In `workspace-shell.component.html`, inside `<main #workspaceContent class="workspace-content" ...>` put it before `<router-outlet />`:

```html
            <app-workspace-shell-server-banner />
            <router-outlet />
```

- [ ] **Step 5: Run, then commit**

```bash
pnpm nx test workspace-shell-feature
pnpm nx lint workspace-shell-feature
pnpm run styles:inputs:validate
git add libs/workspace/shell/feature
git commit -m "feat(workspace): server status in the rail and an offline banner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS.

---

### Task 12: Delete-all warning in server mode

**Files:**
- Modify: `apps/web/src/app/settings/settings-delete-all-playlists-dialog.component.ts`, `.html`, `.spec.ts`

- [ ] **Step 1: Failing test**

In `settings-delete-all-playlists-dialog.component.spec.ts`, add (import `ServerStorageStatusService` from `@iptvnator/services`):

```ts
    it('warns that server playlists disappear for every device', () => {
        TestBed.inject(ServerStorageStatusService).activate(
            { service: 'iptvnator', apiVersion: 1, instanceId: 'i', storage: 'server', auth: 'none' },
            () => undefined
        );
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('[data-test-id="delete-all-server-warning"]')
        ).not.toBeNull();
    });
```

(Use the spec's existing `fixture`; if it is created in `beforeEach` after `detectChanges`, call `fixture.detectChanges()` again as shown.)

- [ ] **Step 2: Implement**

In the component class add:

```ts
    readonly clearsServer = inject(ServerStorageStatusService).isActive;
```

with `import { ServerStorageStatusService } from '@iptvnator/services';`. In the template, directly after the lead paragraph:

```html
    @if (clearsServer()) {
        <p class="settings-delete-dialog__lead" data-test-id="delete-all-server-warning">
            {{ 'SERVER_STORAGE.DELETE_ALL_WARNING' | translate }}
        </p>
    }
```

- [ ] **Step 3: Run, then commit**

```bash
pnpm nx test web --testPathPatterns=settings-delete-all-playlists-dialog
git add apps/web/src/app/settings/settings-delete-all-playlists-dialog.component.*
git commit -m "feat(settings): warn that delete-all clears the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Translations

**Files:**
- Modify: `apps/web/src/assets/i18n/en.json` and the 18 other locale files in that folder.

- [ ] **Step 1: English source**

In `en.json`, inside the `SETTINGS` object after `"NAV_BACKUP"`, add:

```json
        "NAV_SERVER": "Server",
        "SERVER_DESCRIPTION": "Playlists, favorites and watch progress are stored on this server and shared by every device that opens it.",
        "SERVER_CONNECTION": "Connection",
        "SERVER_CONNECTED": "Connected",
        "SERVER_OFFLINE": "Unavailable",
        "SERVER_STORAGE": "Storage",
        "SERVER_STORAGE_SUMMARY": "{{playlists}} playlists · {{size}}",
        "SERVER_EXPORT_BACKUP": "Export backup",
        "SERVER_IMPORT_BROWSER": "Playlists in this browser",
        "SERVER_IMPORT_BROWSER_DESCRIPTION": "{{count}} playlists are stored only in this browser. Playlists the server already has are merged.",
        "SERVER_ACCESS": "Access",
        "SERVER_ACCESS_OPEN_DESCRIPTION": "Anyone who can reach this address can use it. Set IPTVNATOR_ACCESS_TOKEN on the server to require a token.",
        "SERVER_ACCESS_TOKEN": "This server requires an access token.",
        "SERVER_SIGN_OUT": "Sign out",
```

Add a new top-level object after `SETTINGS`:

```json
    "SERVER_STORAGE": {
        "STATUS_ONLINE": "Server connected",
        "STATUS_OFFLINE": "Server unavailable",
        "STATUS_UNAUTHORIZED": "Server needs an access token",
        "OFFLINE_BANNER": "Server unavailable. Changes cannot be saved until it is back.",
        "RETRY": "Retry",
        "WRITE_FAILED": "Could not save to the server. Check the connection and try again.",
        "TOO_LARGE": "This playlist is larger than the server accepts.",
        "MIGRATION_TITLE": "Found {{count}} playlists in this browser",
        "MIGRATION_DESCRIPTION": "They are stored only in this browser. Move them to the server so every device that opens this address sees them. Nothing is deleted from this browser.",
        "MIGRATION_LATER_HINT": "You can do this later in Settings → Server.",
        "MIGRATION_NOT_NOW": "Not now",
        "MIGRATION_MOVE": "Move to server",
        "MIGRATION_DONE": "Moved {{imported}}, merged {{merged}}, failed {{failed}}.",
        "MIGRATION_FAILED": "Moving failed. Your playlists are still in this browser; try again from Settings → Server.",
        "MIGRATION_RELOAD": "Reload",
        "SIGN_IN_TITLE": "Access token required",
        "SIGN_IN_DESCRIPTION": "This IPTVnator server asks for an access token before it shows your playlists.",
        "SIGN_IN_TOKEN_LABEL": "Access token",
        "SIGN_IN_HINT": "Find it in the server's IPTVNATOR_ACCESS_TOKEN setting.",
        "SIGN_IN_REJECTED": "Token rejected. Check it and try again.",
        "SIGN_IN_CONTINUE": "Continue",
        "DELETE_ALL_WARNING": "This removes the playlists from the server for every device."
    },
```

- [ ] **Step 2: Every other locale**

Add the same keys at the same positions in each of `ar, ary, by, de, el, es, fr, hu, it, ja, ko, nl, pl, pt, ru, tr, zh, zhtw`. Translate every value into that language, matching the tone of the existing strings in the file. Keep `IPTVnator`, `IPTVNATOR_ACCESS_TOKEN`, `{{…}}` placeholders and `→` unchanged.

- [ ] **Step 3: Check**

```bash
pnpm run i18n:check
```

Expected: pass. If a value is legitimately identical to English (for example `"Server"` in German), run `pnpm run i18n:baseline:update`, review that only those keys were added to `tools/i18n/identical-en-baseline.json`, and run the check again.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/assets/i18n tools/i18n/identical-en-baseline.json
git commit -m "feat(i18n): server storage strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: End-to-end coverage

**Files:**
- Modify: `apps/web-e2e/playwright.config.ts`
- Modify: `apps/web-backend/src/app/project-config.spec.ts`
- Create: `apps/web-e2e/src/server-storage.e2e.ts`

- [ ] **Step 1: A storage-enabled backend for the E2E run**

In `playwright.config.ts`, add at the top `import { tmpdir } from 'node:os';` and `import { join } from 'node:path';`, then below `const webBackendPort = ...`:

```ts
const storageBackendPort = process.env['STORAGE_BACKEND_PORT'] ?? '3334';
// Path only; the backend creates it. A new pid gives every run an empty store.
const storageBackendDataDir = join(
    tmpdir(),
    `iptvnator-web-e2e-storage-${process.pid}`
);
```

Append to the `webServer` array after the existing backend entry:

```ts
        /* A second backend with server storage, used only by
         * server-storage.e2e.ts; the specs above keep the stateless one. */
        {
            command: 'node --import tsx apps/web-backend/src/main.ts',
            env: {
                PORT: storageBackendPort,
                CLIENT_URL: `http://localhost:4200,http://localhost:${staticPwaPort}`,
                BACKEND_URL: '/api',
                IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: '1',
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_DATA_DIR: storageBackendDataDir,
            },
            url: `http://localhost:${storageBackendPort}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
        },
```

- [ ] **Step 2: Let the project-config spec accept exactly that second launch**

In `apps/web-backend/src/app/project-config.spec.ts`, replace

```ts
            expect(start).toBeGreaterThan(-1);
            expect(
                source.indexOf(launchCommand, start + launchCommand.length)
            ).toBe(-1);
```

with

```ts
            expect(start).toBeGreaterThan(-1);
            // One stateless backend, plus at most one storage-enabled one.
            const second = source.indexOf(
                `'${launchCommand}'`,
                start + launchCommand.length
            );
            if (second !== -1) {
                const storageEntry = source.slice(
                    second,
                    source.indexOf('url:', second)
                );
                expect(storageEntry).toContain(`IPTVNATOR_STORAGE: 'server'`);
                expect(storageEntry).toContain('PORT: storageBackendPort,');
                expect(
                    source.indexOf(
                        `'${launchCommand}'`,
                        second + launchCommand.length
                    )
                ).toBe(-1);
            }
```

Run: `pnpm nx test web-backend --testPathPatterns=project-config && pnpm run e2e:task-graphs:validate`
Expected: PASS.

- [ ] **Step 3: The spec**

`apps/web-e2e/src/server-storage.e2e.ts`:

```ts
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addM3uUrlPlaylist,
    openSources,
    sourceRowByTitle,
} from './sources-pwa.helpers';

const STORAGE_BACKEND_URL = `http://localhost:${
    process.env['STORAGE_BACKEND_PORT'] ?? '3334'
}`;

async function newServerPage(browser: Browser): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(STORAGE_BACKEND_URL)} };\n`,
        })
    );
    return page;
}

/** A legacy browser playlist, written before the app boots. */
async function seedBrowserPlaylist(page: Page, id: string, title: string): Promise<void> {
    await page.route('**/__indexeddb-seed__', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
    );
    await page.goto('/__indexeddb-seed__');
    await page.evaluate(
        ([playlistId, playlistTitle]) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator', 1);
                request.onerror = () => reject(request.error);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore('playlists', {
                        keyPath: '_id',
                        autoIncrement: false,
                    });
                    for (const name of [
                        '_id', 'filename', 'title', 'count', 'playlist', 'importDate',
                        'lastUsage', 'favorites', 'recentlyViewed', 'autoRefresh', 'url', 'filePath',
                    ]) {
                        store.createIndex(name, name, { unique: false });
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction('playlists', 'readwrite');
                    transaction.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    transaction.onabort = () => reject(transaction.error);
                    transaction.objectStore('playlists').add({
                        _id: playlistId,
                        title: playlistTitle,
                        importDate: '2026-01-01T00:00:00.000Z',
                        lastUsage: '2026-01-01T00:00:00.000Z',
                        count: 1,
                        autoRefresh: false,
                        favorites: [],
                        recentlyViewed: [],
                        playlist: {
                            header: { attrs: {}, raw: '#EXTM3U' },
                            items: [{ id: 'c1', name: 'Channel', url: 'https://example.invalid/c1.m3u8' }],
                        },
                    });
                };
            }),
        [id, title] as const
    );
}

test.describe('server storage @self-hosted @server-storage @persistence', () => {
    test.beforeEach(async ({ request }) => {
        await request.delete(`${STORAGE_BACKEND_URL}/v1/playlists`);
    });

    test('a playlist added on one device appears on another', async ({ browser }) => {
        const first = await newServerPage(browser);
        await openSources(first);
        await addM3uUrlPlaylist(first, 'Shared M3U');

        const second = await newServerPage(browser);
        await openSources(second);
        await expect(sourceRowByTitle(second, 'Shared M3U')).toBeVisible();

        await first.context().close();
        await second.context().close();
    });

    test('moves browser playlists to an empty server', async ({ browser, request }) => {
        const page = await newServerPage(browser);
        await seedBrowserPlaylist(page, 'browser-only', 'Browser only');

        await page.goto('/workspace/sources');
        const dialog = page.locator('mat-dialog-container');
        await expect(dialog).toContainText('Browser only');
        await dialog.locator('[data-test-id="server-migration-move"]').click();
        await expect(dialog.locator('[data-test-id="server-migration-reload"]')).toBeVisible();

        const metas = (await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/playlists?view=meta`)
        ).json()) as { _id: string; title: string }[];
        expect(metas).toEqual(
            expect.arrayContaining([expect.objectContaining({ _id: 'browser-only', title: 'Browser only' })])
        );

        await page.context().close();
    });
});
```

- [ ] **Step 4: Run**

```bash
pnpm nx run web-e2e:e2e -- --project=chromium --grep "@server-storage|@self-hosted"
```

Expected: both new tests pass and the existing self-hosted tests stay green. The token page is covered by unit tests (Tasks 8–9); an E2E run would need a third backend.

- [ ] **Step 5: Commit**

```bash
git add apps/web-e2e apps/web-backend/src/app/project-config.spec.ts
git commit -m "test(e2e): server storage across browsers and the migration dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Visual check, docs, release note, PR

- [ ] **Step 1: Look at it**

```bash
export TMPDATA="$(mktemp -d)"
IPTVNATOR_STORAGE=server IPTVNATOR_DATA_DIR="$TMPDATA" PORT=3334 CLIENT_URL=http://localhost:4200 IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1 pnpm nx serve web-backend &
printf 'window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: "http://localhost:3334" };\n' > apps/web/src/assets/app-config.js
pnpm run serve:frontend
```

In the browser, in light and dark theme and at phone width (375 px): add a playlist; open Settings → Server; stop the backend and confirm the rail icon turns to `cloud_off` and the banner appears; restart it and press Retry. Take screenshots for the PR. Afterwards restore the placeholder and stop the servers:

```bash
git checkout apps/web/src/assets/app-config.js
kill %1
```

- [ ] **Step 2: Docs**

- `docs/architecture/pwa-self-hosted.md`: add a section "Server storage mode" covering the probe rule (runtime `BACKEND_URL` only), `provideServerStorage`, `PlaylistStorageBackend` kinds, the document store (ETag, `keepPayload`), `USER_DATA_STORAGE` with the `iptvnator-server:` cache prefix, migration rules (empty server: ids + Xtream maps; otherwise backup merge; browser data kept), the sign-in route, and what stays per device (settings, parental locks, global favorites order, UI preferences). Update "Runtime Limitations" accordingly.
- `docs/architecture/workspace-shell.md`, "Shell Structure" → left rail: add "Server status shortcut above Settings, rendered only in server storage mode; offline banner at the top of the content outlet."
- `docker/README.md`, "PWA Limitations": state that with server storage the PWA keeps playlists and Xtream user data on the server, and list what stays per device.
- `README.md`, "Self-hosted PWA": one sentence that the first browser that opens an updated instance offers to move its playlists.

- [ ] **Step 3: Release note**

Create `.changes/self-hosted-server-storage.md`:

```markdown
---
type: feature
area: self-hosted
issues: [305]
highlight: Playlists on your server
---

The Docker version now keeps playlists, favorites and watch progress on the server, so every phone, TV and computer that opens it shares one library. Playlists already in a browser move over with one click.
```

Run: `pnpm run release:notes:validate`
Expected: pass.

- [ ] **Step 4: Full gate**

```bash
pnpm run typecheck:ci
pnpm run typecheck:spec
pnpm nx run-many -t test -p services web workspace-shell-feature workspace-shell-util portal-xtream-data-access web-backend
pnpm nx run-many -t lint -p services web workspace-shell-feature workspace-shell-util web-backend
pnpm run i18n:check
pnpm run styles:inputs:validate
pnpm nx build web --configuration=pwa
pnpm nx run web-e2e:e2e -- --project=chromium --grep "@self-hosted|@pwa|@settings"
pnpm run agents:validate
```

Expected: all pass. Check `renderer.initialBytes` did not grow beyond the probe (the server-storage code must be in a lazy chunk): `pnpm nx build web --configuration=pwa --stats-json` and confirm `server-storage-session` is not in `main-*.js`.

- [ ] **Step 5: Local review, push, PR**

Follow the local review gate. Then push and open the PR, and add the Step 1 screenshots (light, dark, phone width) to its description:

```bash
git push -u origin claude/server-storage-pwa
gh pr create --title "feat(self-hosted): keep playlists on the server for every device" --body "$(cat <<'EOF'
Closes #305 (and #514).

When the Docker backend reports server storage, the PWA keeps playlists, M3U/Stalker favorites and history, and Xtream favorites, history and playback positions on the server.

- Startup probe only when the deployment writes a runtime `BACKEND_URL`; server code loads lazily.
- `PlaylistsService` is unchanged: `PlaylistStorageBackend` plugs in an HTTP document store with ETag caching and `keepPayload` uploads.
- Xtream user data syncs per playlist through `USER_DATA_STORAGE`; legacy browser keys are never overwritten.
- First browser on an empty server: one-click move with ids and Xtream data. Later browsers: Settings → Server merges through the backup format.
- Settings → Data → Server, rail status, offline banner, sign-in page for `IPTVNATOR_ACCESS_TOKEN`, delete-all warning.
- 19 locales translated.

Spec: docs/superpowers/specs/2026-10-08-server-storage-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
