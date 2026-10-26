# Server EPG 3d: EPG for M3U Playlists from the Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the self-hosted instance reports `features.epg`, the PWA turns on the M3U EPG surfaces (channel-list programme line, player EPG panel, programme guide with search, Settings → EPG) and reads programmes, import progress and the shared source list from the server's `/v1/epg` API.

**Architecture:** `provideServerStorage()` adds `provideServerEpg()` from the `@iptvnator/services/server-storage` sub-entry when the probed (or remembered) instance has `features.epg`. It points `EPG_RUNTIME_BACKEND` (contract A) at `ServerEpgBackend`, which implements the XMLTV bridge methods over `ServerEpgClient` (one call per route of contract C, chunked to `SERVER_EPG_LIMITS`), and it provides `SHARED_EPG_SETTINGS`, through which `SettingsStore` loads `epgUrl` and the daily refresh time from the server and Settings → Save sends both in one `PUT`. `ServerEpgStatusPoller` feeds Settings → EPG with every import, turns the imports started on this page into the bridge's progress events and, on a new `revision`, tells the renderer caches to read again through the new `EpgDataChangesService`. Settings → EPG gains a server view on 3a's display/sources split (the refresh time is a form control saved with the Save bar); the desktop trust actions become hints; the source chips use the server's 24 h day; playlist EPG inputs take links only. All server EPG code stays in the lazily imported server-storage chunk and the lazy settings chunk.

**Tech Stack:** Angular 22 (standalone, signals, OnPush, `inject`), NgRx Signals (`SettingsStore`), ngx-translate, Angular Material, Jest 30 (jsdom; ESM runner for `web`, `ui-epg`, `components`), Playwright 1.62, Express (`web-backend`).

Spec: `docs/superpowers/specs/2026-10-15-server-epg-design.md` (sections 5, 6.3, 7, 9, 10, 12 "3d").
Overview and shared contracts: `.plans/2026-10-15-server-epg.md` (contracts A and C are authoritative; D for the environment).
Style reference: `.plans/2026-10-11-server-storage-phase-2b-pwa.md`.
Branch: `claude/server-epg-pwa` from `origin/master` after 3a, 3b-1 and 3c are merged. PR title: `feat(self-hosted): EPG for M3U playlists from the server`. Release note `.changes/self-hosted-server-epg.md` (closes #444).

Before any UI task (Tasks 13–15) read `docs/architecture/iptvnator-ui-guidelines.md` (sections "Settings Surfaces", "Forms", "Translated Text", "Icon-Only Buttons", "Phone Layout"), `.codex/skills/iptvnator-ui-design/SKILL.md` and `.codex/skills/iptvnator-theme-style/SKILL.md`.

---

## Contract deviations

1. **A, the resolver is lazy.** Contract A says `provideServerStorage()` provides `EPG_RUNTIME_BACKEND` with `() => serverEpgBackend`. This plan provides a resolver that creates the backend on its first call (`Injector.get(ServerEpgBackend)`), and `ServerEpgClient` reads `ServerStorageSession.api` through its injector on each call. Reason: `RuntimeCapabilitiesService` resolves the token when it is constructed, and that happens inside `ServerStorageSession`'s constructor (session → `PlaylistStorageBackend` → `RuntimeCapabilitiesService`); creating the backend eagerly there is a DI cycle (NG0200). The token type (`EpgRuntimeBackendResolver`) and the capability rule (method present) are unchanged.
2. **A, import semantics of the server backend.** `fetchEpg`/`forceFetchEpg` resolve when the requested imports finished (as Electron's do), so `EpgService` clears its cache after the new data exists. `fetchEpg` skips sources the server imported within 24 h (the server's own rule for unforced imports and catch-up, so no request goes out for them; Electron uses 12 h) and URLs the server does not own. `clearEpgData` also sends `POST /v1/epg/import { force: true }` after the clear, so playlist-owned sources do not stay empty until the nightly run. `checkEpgFreshness` honours the caller's `maxAgeHours` (default 12).
3. **C, no contract change; the phase 2 client grows.** `ServerApiClient.request()` takes `{ read: true }` and gains `queryJson()`: the `/v1/epg` reads are `POST`s (contract C) but must not be held while writes are held, nor raise the write-failure snackbar.
4. **New shared names** (additive, available to 3e): in the `@iptvnator/services` main barrel `EpgDataChangesService` (explicit cache-reset hook), `SHARED_EPG_SETTINGS` / `SharedEpgSettings` (`read`, `save`) with `loadSharedEpgSettings()`, `waitAtMost()` and `SHARED_EPG_FRESH_HOURS`, `ServerStorageStatusService.epgEnabled`, and `SettingsStore.sharedEpgRefreshTime` / `reloadSharedEpgSettings()` / `saveSharedEpgSettings()`; in `@iptvnator/shared/interfaces` `validateRemoteEpgSourceControl` (http(s) without credentials), used by Settings and playlist info.
5. **Spec 6.3, offline start.** "The device copy of `epgUrl` is not used in server mode": when the server list cannot be read at start, `SettingsStore.epgUrl` is `[]`, not the device copy, and `reconcileEpgSources` refuses to `PUT` until this page has read the list once, so a stale or empty list can never replace the server's. Settings → EPG then shows the empty list with the offline banner and a disabled refresh-time field.
6. **Spec 9, per-source status (maintainer).** The per-source state, last import, counts and errors are shown in a separate "On the server" list covering every source the server imports (the shared list and the playlists' sources); the editable rows keep their status chip. The chips count a source as fresh for 24 h in server mode (`SHARED_EPG_FRESH_HOURS`, the daily schedule), 12 h on a device.
7. **Spec 6.3, progress events (decision).** The spec has the poller feed `EpgProgressService` and the chips with every change. The import panel now shows only imports started on this page (Refresh, a new source, Retry, Clear); imports already running when the page opens, such as the nightly run, show in Settings → EPG's server list only. A chip shows "loading" only for an import started here.
8. **Spec 6.3/7, the refresh time (maintainer).** It is not saved on its own: it is a form control of Settings → EPG (`epgRefreshTime`, `HH:MM`, change tracking, Discard) and Settings → Save sends the changed list and refresh time in one `PUT /v1/epg/settings` (`SHARED_EPG_SETTINGS.save`) before the device settings; the following reconciliation finds the list unchanged and sends nothing. `reconcileEpgSources` stays the path for list changes outside Settings (playlist info, backup restore).
9. **Playlist info (decision).** In server mode a playlist's new EPG sources must be `http(s)` links without credentials; a typed local path is refused with `SETTINGS.EPG_SERVER_URL_ERROR`.
10. **Spec 4 ("consumers stay unchanged").** `ChannelListContainerComponent` read `epgUrl` straight from `StorageMap`, so it would never see the server list; it now reads `SettingsStore.epgUrl`. `AppComponent` skips its startup freshness fetch in server mode (the server catches up after it starts).
11. **D, quiet default.** With `IPTVNATOR_EPG` on by default, 3c's `openServerEpg()` would log "needs IPTVNATOR_STORAGE=server" on every start of a stateless backend; it now logs that only when the variable was set (contract D: "ignored without `IPTVNATOR_STORAGE=server`"). An unknown value such as `yes` now counts as on; only `off`, `0` and `false` turn it off.
12. **E2E isolation.** `server-storage.e2e.ts` and the new `server-epg.e2e.ts` share one storage backend and Playwright runs files in parallel workers; both take a file lock for their describe block (`storage-backend.helpers.ts`, which also hosts the shared `newServerPage`).

## Assumptions about the merged 3a, 3b-1 and 3c (checked in Task 1)

- 3a follows Task 11 of `.plans/2026-10-15-server-epg-3a-provider-epg.md` ("Settings → EPG display settings in the PWA"): `createSettingsForm(formBuilder, supportsEpg, supportsEpgDisplay = supportsEpg)` builds `epgViewMode` and `epgOffsetMinutes` on the display flag and `epgUrl` and `preferUploadedEpgOverXtream` on the XMLTV flag; `SettingsFormFacade` has `supportsEpg` (XMLTV sources) and `supportsEpgDisplay` (`supportsEpg || runtime.supportsEpg || runtime.supportsProviderEpg`); `SettingsEpgSectionComponent` has the input `showsXmltvSources` (bound to `supportsEpg` in `settings.component.html`) with the Sources, Xtream and Data sections inside `@if (showsXmltvSources()) { … }`, re-indented by Prettier; the nav and the settings search use the requirement `'epg-display'` for the page and its two display rows. 3d does not touch the display part; Tasks 14–16 edit the files as 3a left them.
- Contract A files exist as written in the overview: `libs/shared/interfaces/src/lib/epg-runtime-backend.ts` (`EpgRuntimeBackend`), `libs/services/src/lib/epg-runtime-backend.token.ts` (`EPG_RUNTIME_BACKEND`, `EpgRuntimeBackendResolver`), both exported from their barrels; the EPG flags live in the internal `EpgRuntimeCapabilities` (`libs/services/src/lib/epg-runtime-capabilities.ts`), which keeps the resolver and calls it on every check, and `RuntimeCapabilitiesService` keeps its `supportsEpg*` getters as one-line delegates (`.plans/2026-10-15-server-epg-3b1-renderer-seam.md`); `EpgRuntimeBridgeService` and `EpgSourceSettingsService` also call the resolver at use time; the start-up probe uses `isElectronRuntime()` instead of `new RuntimeCapabilitiesService()`. `Injector.create` specs must provide the token themselves (it has no root scope). This plan only reads the public getters; it changes neither file.
- Contract C file `libs/shared/interfaces/src/lib/server-epg.contract.ts` exists with the names in the overview (`SERVER_EPG_ROUTES`, `SERVER_EPG_LIMITS`, `SERVER_EPG_ERROR_CODES` including `Network`, `ServerEpgStatus`, `ServerEpgSourceStatus`, request types), `ServerInstanceInfo.features?.epg` exists, and the barrel exports both.
- 3c's `POST /v1/epg/import` ignores URLs the server does not own, coalesces duplicates and answers `202` with the status after queueing; `revision` increases after every publish and clear; `lastSuccessAt` changes on every successful import.
- 3c follows its plan `.plans/2026-10-15-server-epg-3c-backend.md`: `readServerEpgConfig(env)` in `apps/web-backend/src/app/epg/epg-config.ts` (`enabled`, `allowPrivateNetworks`, `maxDecompressedBytes`), `openServerEpg()` in `open-server-epg.ts`, a commented EPG block in `docker/docker-compose.yml`, the `IPTVNATOR_EPG` row and a `## Server EPG` section in `docker/README.md`, and a `## Server EPG` section (backend) in `pwa-self-hosted.md`. An unforced import there queues only sources without a success in 24 h. Tasks 20 and 22 edit those texts; if the merged code differs, Task 1 Step 6 records it and those tasks use the merged text.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `apps/web/src/app/server-storage/server-instance-probe.ts` | modify | Keep `features` (booleans only) on the probed instance |
| `libs/services/src/lib/server-storage-status.service.ts` | modify | `epgEnabled` |
| `libs/services/src/lib/server-storage/server-api-client.ts` | modify | `POST` reads (`queryJson`, `{ read: true }`) |
| `libs/services/src/lib/epg-data-changes.service.ts` | create | Explicit "imported data changed" hook (main barrel) |
| `libs/services/src/lib/shared-epg-settings.ts` | create | `SHARED_EPG_SETTINGS`, `loadSharedEpgSettings`, `waitAtMost`, `SHARED_EPG_FRESH_HOURS` (main barrel) |
| `libs/services/src/lib/settings-store.service.ts` | modify | Load, re-read and save the server list and refresh time |
| `libs/shared/interfaces/src/lib/epg-source-reference.util.ts` | modify | `validateRemoteEpgSourceControl` |
| `libs/services/src/lib/server-storage/server-epg-client.ts` | create | `/v1/epg` calls, chunking, merging |
| `libs/services/src/lib/server-storage/server-epg-progress.ts` | create | Status diff → progress events, error keys, freshness |
| `libs/services/src/lib/server-storage/server-epg-status-poller.ts` | create | Polling, visibility, waiters, revision → cache reset |
| `libs/services/src/lib/server-storage/server-epg-backend.ts` | create | `EpgRuntimeBackend` methods + `SharedEpgSettings` |
| `libs/services/src/lib/server-storage/server-epg.providers.ts` | create | `provideServerEpg()` |
| `libs/services/src/lib/server-storage/index.ts`, `libs/services/src/index.ts` | modify | Exports |
| `apps/web/src/app/server-storage/server-storage.providers.ts` | modify | Add `provideServerEpg()` with `features.epg` |
| `libs/epg/data-access/src/lib/epg.service.ts` | modify | Read again on data changes |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts` | modify | Guide reloads on data changes |
| `libs/epg/data-access/src/lib/epg-progress.service.ts` | modify | `trustActionsAvailable` |
| `libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel-view.component.*` | modify | Hint instead of trust button |
| `libs/ui/epg/src/lib/epg-source-status/epg-source-status.component.ts` | modify | 24 h freshness in server mode |
| `libs/ui/epg/src/index.ts` | modify | Export `formatEpgImportDisplayUrl` |
| `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts` | modify | Global sources from `SettingsStore` |
| `apps/web/src/app/app.component.ts` | modify | No client startup import in server mode |
| `apps/web/src/app/settings/settings-form.utils.ts`, `settings-form.facade.ts`, `settings.component.ts` | modify | Refresh-time control, links-only validator, re-read on open, one `PUT` on Save, save-failure text |
| `apps/web/src/app/settings/settings-epg-section.component.{ts,html,scss}` | modify | Server view inside 3a's XMLTV block, time field |
| `apps/web/src/app/settings/settings-epg-server-rows.ts` | create | Row view model (pure) |
| `apps/web/src/app/settings/settings-epg-server-imports.component.{ts,html,scss}` | create | Imported sources list |
| `apps/web/src/app/settings/settings-epg-server-form.ts` | create | `epgRefreshTime` control, the Save update (pure) |
| `apps/web/src/app/settings/settings-change-tracking.ts` | modify | `epgRefreshTime` on the EPG page |
| `apps/web/src/app/settings/settings-epg-server-schedule.component.ts` | create | Server time zone and next run |
| `apps/web/src/app/settings/test-stubs/settings-test-harness.stub.ts` | modify | Shared EPG members on the mock store |
| `libs/workspace/shell/util/src/lib/settings-search/*` | modify/create | `server-epg` requirement and two entries |
| `apps/web/src/assets/i18n/*.json`, `tools/i18n/identical-en-baseline.json` | modify | 35 new keys in 19 locales |
| `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.{ts,html}` (+ `playlist-info-epg-sources.component.spec.ts`) | modify | Links only in server mode; Refresh pinned |
| `apps/web-backend/src/app/web-backend-app.ts` (+ spec) | modify | `/parse` uses the shared `createPlaylistObject` |
| `apps/web-backend/src/app/epg/epg-config.ts`, `open-server-epg.ts` (+ specs), `docker/docker-compose.yml` | modify | `IPTVNATOR_EPG` on by default, quiet without storage |
| `apps/web-e2e/playwright.config.ts`, `apps/web-backend/src/app/project-config.spec.ts` | modify | `IPTVNATOR_EPG: 'on'` for the storage backend |
| `apps/web-e2e/src/storage-backend.helpers.ts` | create | `newServerPage`, storage backend lock |
| `apps/web-e2e/src/server-storage.e2e.ts` | modify | Shared helpers, lock |
| `apps/web-e2e/src/server-epg.e2e.ts` | create | `@server-epg @self-hosted` |
| `docs/architecture/pwa-self-hosted.md`, `docs/architecture/m3u-playlist-module.md`, `docs/architecture/validation-map.md`, `docker/README.md` | modify | Docs |
| `.changes/self-hosted-server-epg.md` | create | Release note |

---

### Task 1: Worktree, install, discovery, upstream check

**Files:** none changed.

- [ ] **Step 1: Create the worktree from an up-to-date master**

```bash
cd /Users/4gray/Code/iptvnator
git fetch origin
git worktree add .claude/worktrees/server-epg-pwa -b claude/server-epg-pwa origin/master
cd .claude/worktrees/server-epg-pwa
pnpm install --frozen-lockfile
pnpm nx show projects | sort | tr '\n' ' '
```

Expected: the install finishes; the project list contains `services`, `web`, `web-backend`, `web-e2e`, `epg-data-access`, `ui-epg`, `components`, `workspace-shell-util`, `playlist-shared-ui`. Run every later command from this worktree.

- [ ] **Step 2: Check contract A (3b-1)**

```bash
grep -n "EPG_RUNTIME_BACKEND_METHODS\|export type EpgRuntimeBackend\b" libs/shared/interfaces/src/lib/epg-runtime-backend.ts
grep -n "export const EPG_RUNTIME_BACKEND\|EpgRuntimeBackendResolver" libs/services/src/lib/epg-runtime-backend.token.ts
grep -n "epg-runtime-backend" libs/shared/interfaces/src/index.ts libs/services/src/index.ts
grep -n "EPG_RUNTIME_BACKEND" libs/services/src/lib/runtime-capabilities.service.ts libs/services/src/lib/epg-source-settings.service.ts libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts
grep -n "export class EpgRuntimeCapabilities\|get supportsEpg" libs/services/src/lib/epg-runtime-capabilities.ts
grep -n "get supportsEpg" -A2 libs/services/src/lib/runtime-capabilities.service.ts
pnpm nx test web --testPathPatterns=server-instance-probe
```

Expected: every grep prints at least one line; `EpgRuntimeCapabilities` holds the flag logic and the service's `supportsEpg*` getters are one-line delegates to it (this plan reads only those public getters, so it needs no change either way); the probe spec passes (3b-1 replaced its `new RuntimeCapabilitiesService()` with `isElectronRuntime()`, because the service now injects the token). If anything is missing, stop: 3b-1 is not merged as contract A describes. Adapt the imports of Tasks 8–9 (`EpgRuntimeBackend`, `EPG_RUNTIME_BACKEND`) to the merged names before going on.

- [ ] **Step 3: Check contract C (3c)**

```bash
grep -n "SERVER_EPG_ROUTES\|SERVER_EPG_LIMITS\|SERVER_EPG_ERROR_CODES\|Network: 'epg_network'\|interface ServerEpgStatus\b\|interface ServerEpgSourceStatus\|interface ServerEpgCurrentRequest" libs/shared/interfaces/src/lib/server-epg.contract.ts
grep -n "server-epg.contract" libs/shared/interfaces/src/index.ts
grep -n "features\|ServerInstanceFeatures" libs/shared/interfaces/src/lib/server-storage.contract.ts
```

Expected: all names found. If a name differs, use the merged name everywhere this plan uses the contract one.

- [ ] **Step 4: Check 3a's split of Settings → EPG**

```bash
grep -n "supportsEpgDisplay" apps/web/src/app/settings/settings-form.utils.ts apps/web/src/app/settings/settings-form.facade.ts apps/web/src/app/settings/settings.component.ts
grep -n "showsXmltvSources" apps/web/src/app/settings/settings-epg-section.component.ts apps/web/src/app/settings/settings-epg-section.component.html apps/web/src/app/settings/settings.component.html
grep -rn "'epg-display'" apps/web/src/app/settings/settings-options.ts libs/workspace/shell/util/src/lib/settings-search/
pnpm exec prettier --check apps/web/src/app/settings/settings-epg-section.component.html
pnpm nx test web --testPathPatterns="settings-form.utils|settings-epg-section"
```

Expected: `createSettingsForm(` has the third parameter `supportsEpgDisplay = supportsEpg`; the facade defines `supportsEpgDisplay` and passes it as the third argument; the section declares `readonly showsXmltvSources = input(true);` and its template opens `@if (showsXmltvSources()) {` before the Sources section and closes it after the Data section; `'epg-display'` is in the nav capabilities, the search types, the EPG search section and the view-mode and offset entries; Prettier reports the template as formatted; the specs pass. If 3a is not merged, stop: 3d builds on it. If a name differs, use the merged name in Tasks 14–16, and if the template is formatted differently, take the before-snippets of Task 15 Step 7 from the merged file (the after-snippets follow from running Prettier on it).

- [ ] **Step 5: Check the 3c import semantics this plan relies on**

```bash
grep -rn "force" apps/web-backend/src/app/epg/epg-import-router.ts apps/web-backend/src/app/epg/epg-import-queue.ts | head -20
grep -rn "revision" apps/web-backend/src/app/epg/epg-status.ts | head -10
```

Expected: the import route takes `{ urls?, force? }`, ignores unowned URLs and answers `202` with the status; the status keeps a `revision` that increases after publish and clear. Note any difference in the PR description; the client tolerates both an ignored URL (settles as `cancelled`) and an immediate answer.

- [ ] **Step 6: Record the 3c config names**

```bash
grep -n "export\|ENABLED_VALUES\|IPTVNATOR_EPG" apps/web-backend/src/app/epg/epg-config.ts
grep -n "it('" apps/web-backend/src/app/epg/epg-config.spec.ts apps/web-backend/src/app/epg/open-server-epg.spec.ts
grep -n "IPTVNATOR_STORAGE=server; server EPG stays off" apps/web-backend/src/app/epg/open-server-epg.ts
grep -rn "IPTVNATOR_EPG" docker/ apps/web-backend/project.json docs/architecture/pwa-self-hosted.md
```

Expected: the names and texts Task 20 and Task 22 quote (`readServerEpgConfig`, `ENABLED_VALUES`, the tests `'keeps server EPG off by default'`, `'turns server EPG on only for on, 1 or true'`, `'stays off unless IPTVNATOR_EPG is on'`, the commented compose block, the README row and the two "off by default" sentences). Note every difference for those tasks.

- [ ] **Step 7: Confirm the Jest invocations**

```bash
pnpm nx test services --testPathPatterns=server-api-client
pnpm nx test web --testPathPatterns=settings-options
pnpm nx test ui-epg --testPathPatterns=epg-progress-panel
pnpm nx test components --testPathPatterns=channel-list-container.component
```

Expected: each run reports only the matching spec files. `ui-epg` and `components` run through `tools/testing/run-web-esm-lib-tests.mjs`; if that runner ignores the pattern and runs the whole suite, use plain `pnpm nx test ui-epg` / `pnpm nx test components` wherever this plan filters them.

---

### Task 2: Instance features

**Files:**
- Modify: `apps/web/src/app/server-storage/server-instance-probe.ts:69-92`
- Modify: `libs/services/src/lib/server-storage-status.service.ts:29`
- Test: `apps/web/src/app/server-storage/server-instance-probe.spec.ts`
- Test: `apps/web/src/app/server-storage/server-storage-start.spec.ts`
- Test: `libs/services/src/lib/server-storage-status.service.spec.ts`

- [ ] **Step 1: Write the failing specs**

Append inside `describe('probeServerInstance', …)` in `server-instance-probe.spec.ts`:

```ts
    it('keeps the EPG feature flag as a boolean and drops a malformed one', async () => {
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: answer({
                    ...instance,
                    features: { epg: true },
                    unknownField: 1,
                }) as never,
            })
        ).resolves.toEqual({
            kind: 'server',
            instance: { ...instance, features: { epg: true } },
        });
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: answer({ ...instance, features: 'epg' }) as never,
            })
        ).resolves.toEqual({ kind: 'server', instance });
        await expect(
            probeServerInstance({
                ...config,
                fetchFn: answer({
                    ...instance,
                    features: { epg: 'yes' },
                }) as never,
            })
        ).resolves.toEqual({
            kind: 'server',
            instance: { ...instance, features: { epg: false } },
        });
    });
```

Append inside `describe('resolveServerStorageStart', …)` in `server-storage-start.spec.ts`:

```ts
    it('keeps the instance features for a start from memory', () => {
        const withEpg: ServerInstanceInfo = {
            ...instance,
            features: { epg: true },
        };
        resolveServerStorageStart(
            { kind: 'server', instance: withEpg },
            '/api'
        );

        // An offline start must turn the same EPG surfaces on.
        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/api')
        ).toEqual({ instance: withEpg, startedOffline: true });
    });
```

Append inside `describe('ServerStorageStatusService', …)` in `server-storage-status.service.spec.ts`:

```ts
    it('reports server EPG from the instance features', () => {
        expect(status.epgEnabled()).toBe(false);

        status.activate({ ...instance, features: { epg: true } }, jest.fn());
        expect(status.epgEnabled()).toBe(true);

        status.activate({ ...instance, features: { epg: false } }, jest.fn());
        expect(status.epgEnabled()).toBe(false);

        status.activate(instance, jest.fn());
        expect(status.epgEnabled()).toBe(false);
    });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm nx test web --testPathPatterns="server-instance-probe|server-storage-start"
pnpm nx test services --testPathPatterns=server-storage-status
```

Expected: the probe test FAILS (the unknown field is kept and the malformed `features` passes through); the start test PASSES already (it pins that the remembered copy keeps `features`); the status test FAILS with `status.epgEnabled is not a function`.

- [ ] **Step 3: Implement**

In `server-instance-probe.ts`, replace

```ts
    try {
        const body: unknown = await response.json();
        return isServerInstance(body) && body.storage === 'server'
            ? { kind: 'server', instance: body }
            : { kind: 'none' };
    } catch (error) {
```

with

```ts
    try {
        const instance = parseServerInstance(await response.json());
        return instance?.storage === 'server'
            ? { kind: 'server', instance }
            : { kind: 'none' };
    } catch (error) {
```

and replace the whole `function isServerInstance(…) { … }` at the end of the file with

```ts
/**
 * The instance as this client keeps it: the known fields, with `features`
 * reduced to booleans, so a malformed value cannot turn EPG on and the
 * remembered copy carries the flags into a start from memory.
 */
function parseServerInstance(value: unknown): ServerInstanceInfo | null {
    const record = value as Partial<ServerInstanceInfo> | null;
    if (
        !record ||
        record.service !== 'iptvnator' ||
        typeof record.apiVersion !== 'number' ||
        typeof record.instanceId !== 'string' ||
        (record.storage !== 'server' && record.storage !== 'none') ||
        (record.auth !== 'none' && record.auth !== 'token')
    ) {
        return null;
    }
    const features: unknown = record.features;
    return {
        service: record.service,
        apiVersion: record.apiVersion,
        instanceId: record.instanceId,
        storage: record.storage,
        auth: record.auth,
        ...(features && typeof features === 'object'
            ? {
                  features: {
                      epg: (features as { epg?: unknown }).epg === true,
                  },
              }
            : {}),
    };
}
```

In `server-storage-status.service.ts`, replace

```ts
    readonly isActive = computed(() => this.stateSignal() !== 'inactive');
```

with

```ts
    readonly isActive = computed(() => this.stateSignal() !== 'inactive');
    /** The instance imports XMLTV and answers `/v1/epg` (`features.epg`). */
    readonly epgEnabled = computed(
        () => this.instanceSignal()?.features?.epg === true
    );
```

`server-storage-start.ts` needs no change: it already stores and returns the probed instance object, which now carries the parsed `features`.

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test web --testPathPatterns="server-instance-probe|server-storage-start"
pnpm nx test services --testPathPatterns=server-storage-status
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/server-storage/server-instance-probe.ts apps/web/src/app/server-storage/server-instance-probe.spec.ts apps/web/src/app/server-storage/server-storage-start.spec.ts libs/services/src/lib/server-storage-status.service.ts libs/services/src/lib/server-storage-status.service.spec.ts
git commit -m "feat(self-hosted): keep the instance's EPG feature flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `POST` reads in `ServerApiClient`

**Files:**
- Modify: `libs/services/src/lib/server-storage/server-api-client.ts:72-73`, after `getJson` (`:137`)
- Test: `libs/services/src/lib/server-storage/server-api-client.spec.ts`

- [ ] **Step 1: Write the failing spec**

Append inside `describe('ServerApiClient', …)`:

```ts
    it('sends a POST read with its JSON body', async () => {
        const fetchFn = jest.fn().mockResolvedValue(response(200, []));

        await expect(
            client(fetchFn).queryJson('/epg/search', { term: 'news' })
        ).resolves.toEqual([]);

        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('/api/v1/epg/search');
        expect(init).toMatchObject({
            method: 'POST',
            body: JSON.stringify({ term: 'news' }),
        });
        expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
        });
    });

    it('lets POST reads through while writes are held, without the write notice', async () => {
        const held = new ServerApiClient({
            baseUrl: '/api',
            status,
            onWriteFailure,
            fetchFn: jest
                .fn()
                .mockResolvedValue(
                    response(200, { a: null })
                ) as unknown as typeof fetch,
            accessToken: () => token,
            holdWrites: () => true,
        });
        await expect(
            held.queryJson('/epg/current', { channelIds: ['a'] })
        ).resolves.toEqual({ a: null });

        const failing = jest
            .fn()
            .mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(
            client(failing).queryJson('/epg/current', { channelIds: [] })
        ).rejects.toMatchObject({ status: 0, code: 'network' });
        expect(status.reportOffline).toHaveBeenCalled();
        expect(onWriteFailure).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-api-client`
Expected: FAIL with `queryJson is not a function`.

- [ ] **Step 3: Implement**

In `server-api-client.ts`, replace

```ts
    async request(path: string, init: RequestInit = {}): Promise<Response> {
        const isWrite = (init.method ?? 'GET') !== 'GET';
```

with

```ts
    /**
     * `read` marks a `POST` that only reads (key lists and source URLs
     * travel in the body, as for `/v1/epg`): it goes out while writes are
     * held and never raises the write-failure notice.
     */
    async request(
        path: string,
        init: RequestInit = {},
        options: { readonly read?: boolean } = {}
    ): Promise<Response> {
        const isWrite = !options.read && (init.method ?? 'GET') !== 'GET';
```

and after the `getJson` method add

```ts
    /** A read sent as `POST` with a JSON body. */
    async queryJson<T>(path: string, body: unknown): Promise<T> {
        return this.readJson<T>(
            await this.request(
                path,
                {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers: { 'Content-Type': 'application/json' },
                },
                { read: true }
            )
        );
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test services --testPathPatterns=server-api-client`
Expected: PASS (all existing tests too).

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/server-storage/server-api-client.ts libs/services/src/lib/server-storage/server-api-client.spec.ts
git commit -m "feat(services): POST reads in the server API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: `ServerEpgClient`

**Files:**
- Create: `libs/services/src/lib/server-storage/server-epg-client.ts`
- Test: `libs/services/src/lib/server-storage/server-epg-client.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { TestBed } from '@angular/core/testing';
import type { ElectronBridgeEpgGuideWindow } from '@iptvnator/shared/interfaces';
import { ServerEpgClient } from './server-epg-client';
import { ServerStorageSession } from './server-storage-session';

function fakeApi() {
    const api = {
        getJson: jest.fn(),
        queryJson: jest.fn(),
        sendJson: jest.fn().mockResolvedValue({ status: 200 } as Response),
        readJson: jest.fn(),
    };
    TestBed.configureTestingModule({
        providers: [{ provide: ServerStorageSession, useValue: { api } }],
    });
    return { api, client: TestBed.inject(ServerEpgClient) };
}

/** Answers every key it was asked about, as the server does. */
function echoKeys(value: unknown) {
    return async (_path: string, body: { channelIds: string[] }) =>
        Object.fromEntries(body.channelIds.map((id) => [id, value]));
}

const keys = (count: number) =>
    Array.from({ length: count }, (_, index) => `ch-${index}`);

describe('ServerEpgClient', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('reads and saves the shared settings', async () => {
        const { api, client } = fakeApi();
        api.getJson.mockResolvedValue({
            urls: ['https://epg.example/a.xml'],
            refreshTime: '04:00',
        });
        api.readJson.mockResolvedValue({ urls: [], refreshTime: '05:30' });

        await expect(client.getSettings()).resolves.toEqual({
            urls: ['https://epg.example/a.xml'],
            refreshTime: '04:00',
        });
        await expect(
            client.putSettings({ refreshTime: '05:30' })
        ).resolves.toEqual({ urls: [], refreshTime: '05:30' });

        expect(api.getJson).toHaveBeenCalledWith('/epg/settings');
        expect(api.sendJson).toHaveBeenCalledWith('PUT', '/epg/settings', {
            refreshTime: '05:30',
        });
    });

    it('reads the status, starts imports and clears as writes', async () => {
        const { api, client } = fakeApi();
        const status = { revision: 3, sources: [] };
        api.getJson.mockResolvedValue(status);
        api.readJson.mockResolvedValue(status);

        await expect(client.getStatus()).resolves.toBe(status);
        await expect(
            client.startImport({ urls: ['u'], force: true })
        ).resolves.toBe(status);
        await client.clear({ url: 'u' });

        expect(api.getJson).toHaveBeenCalledWith('/epg/status');
        expect(api.sendJson).toHaveBeenCalledWith('POST', '/epg/import', {
            urls: ['u'],
            force: true,
        });
        expect(api.sendJson).toHaveBeenCalledWith('POST', '/epg/clear', {
            url: 'u',
        });
        expect(api.queryJson).not.toHaveBeenCalled();
    });

    it('splits current-programme keys at 500 and merges the answers', async () => {
        const { api, client } = fakeApi();
        api.queryJson.mockImplementation(echoKeys(null));
        const ids = keys(1_200);

        const answer = await client.current(ids, ['https://epg.example/a.xml'], 1_000);

        expect(
            api.queryJson.mock.calls.map(([, body]) => body.channelIds.length)
        ).toEqual([500, 500, 200]);
        expect(api.queryJson.mock.calls[0]).toEqual([
            '/epg/current',
            {
                channelIds: ids.slice(0, 500),
                sourceUrls: ['https://epg.example/a.xml'],
                nowMs: 1_000,
            },
        ]);
        expect(Object.keys(answer)).toHaveLength(1_200);
    });

    it('splits metadata at 500 and guide windows at 100 keys', async () => {
        const { api, client } = fakeApi();
        api.queryJson.mockImplementation(echoKeys([]));
        const guide: ElectronBridgeEpgGuideWindow = {
            channelIds: keys(250),
            fromMs: 1,
            toMs: 2,
        };

        const metadata = await client.metadata(keys(501));
        const programs = await client.window(guide);

        const routes = api.queryJson.mock.calls.map(([route, body]) => [
            route,
            body.channelIds.length,
        ]);
        expect(routes).toEqual([
            ['/epg/metadata', 500],
            ['/epg/metadata', 1],
            ['/epg/window', 100],
            ['/epg/window', 100],
            ['/epg/window', 50],
        ]);
        expect(api.queryJson.mock.calls[2][1]).toEqual({
            channelIds: keys(100),
            fromMs: 1,
            toMs: 2,
        });
        expect(Object.keys(metadata)).toHaveLength(501);
        expect(Object.keys(programs)).toHaveLength(250);
    });

    it('unions coverage answers of 2000-key chunks', async () => {
        const { api, client } = fakeApi();
        api.queryJson
            .mockResolvedValueOnce(['ch-1', 'ch-2'])
            .mockResolvedValueOnce(['ch-2', 'ch-2500']);

        await expect(
            client.coverage({ channelIds: keys(2_600), fromMs: 1, toMs: 2 })
        ).resolves.toEqual(['ch-1', 'ch-2', 'ch-2500']);
        expect(api.queryJson).toHaveBeenCalledTimes(2);
    });

    it('asks nothing for an empty key list', async () => {
        const { api, client } = fakeApi();

        await expect(client.current([])).resolves.toEqual({});
        await expect(client.metadata([])).resolves.toEqual({});
        await expect(
            client.coverage({ channelIds: [], fromMs: 1, toMs: 2 })
        ).resolves.toEqual([]);
        expect(api.queryJson).not.toHaveBeenCalled();
    });

    it('reads one channel and caps the search limit at 50', async () => {
        const { api, client } = fakeApi();
        api.queryJson.mockResolvedValue([]);

        await client.channelPrograms('news', ['https://epg.example/a.xml']);
        await client.search('news', 500);
        await client.search('sport');

        expect(api.queryJson.mock.calls).toEqual([
            [
                '/epg/channel-programs',
                {
                    channelId: 'news',
                    sourceUrls: ['https://epg.example/a.xml'],
                },
            ],
            ['/epg/search', { term: 'news', limit: 50 }],
            ['/epg/search', { term: 'sport', limit: 50 }],
        ]);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-epg-client`
Expected: FAIL, `Cannot find module './server-epg-client'`.

- [ ] **Step 3: Implement**

`server-epg-client.ts`:

```ts
import { inject, Injectable, Injector } from '@angular/core';
import {
    SERVER_EPG_LIMITS,
    SERVER_EPG_ROUTES,
    type ElectronBridgeEpgGuideWindow,
    type ElectronBridgeEpgSearchProgram,
    type EpgChannelMetadata,
    type EpgProgram,
    type ServerEpgChannelProgramsRequest,
    type ServerEpgClearRequest,
    type ServerEpgCurrentRequest,
    type ServerEpgImportRequest,
    type ServerEpgMetadataRequest,
    type ServerEpgSearchRequest,
    type ServerEpgSettings,
    type ServerEpgSettingsUpdate,
    type ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import type { ServerApiClient } from './server-api-client';
import { ServerStorageSession } from './server-storage-session';

/** What the EPG client uses of the storage API client. */
export type ServerEpgApi = Pick<
    ServerApiClient,
    'getJson' | 'queryJson' | 'sendJson' | 'readJson'
>;

type ServerEpgRoute = keyof typeof SERVER_EPG_ROUTES;

/** The routes name `/v1/…`; the API client adds `/v1` itself. */
function path(route: ServerEpgRoute): string {
    return SERVER_EPG_ROUTES[route].replace(/^\/v1(?=\/)/, '');
}

function chunk<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let start = 0; start < items.length; start += size) {
        chunks.push(items.slice(start, start + size));
    }
    return chunks;
}

function scope(sourceUrls: readonly string[] | undefined): {
    sourceUrls?: readonly string[];
} {
    return sourceUrls && sourceUrls.length > 0 ? { sourceUrls } : {};
}

/**
 * The `/v1/epg` routes through the storage API client: token, timeouts,
 * offline and 401 handling as for playlists. Key lists above a route's cap
 * go out in chunks whose answers are merged, so callers keep the bridge's
 * shape. Errors propagate; `ServerEpgBackend` turns them into "no data".
 */
@Injectable({ providedIn: 'root' })
export class ServerEpgClient {
    private readonly injector = inject(Injector);

    /**
     * Read on each call, not injected: the backend can be created while
     * the storage session itself is still being constructed (capability
     * flags are read in its injector).
     */
    private api(): ServerEpgApi {
        return this.injector.get(ServerStorageSession).api;
    }

    getSettings(): Promise<ServerEpgSettings> {
        return this.api().getJson<ServerEpgSettings>(path('settings'));
    }

    async putSettings(
        update: ServerEpgSettingsUpdate
    ): Promise<ServerEpgSettings> {
        const api = this.api();
        return api.readJson<ServerEpgSettings>(
            await api.sendJson('PUT', path('settings'), update)
        );
    }

    getStatus(): Promise<ServerEpgStatus> {
        return this.api().getJson<ServerEpgStatus>(path('status'));
    }

    /** `202` with the status right after the request was queued. */
    async startImport(request: ServerEpgImportRequest): Promise<ServerEpgStatus> {
        const api = this.api();
        return api.readJson<ServerEpgStatus>(
            await api.sendJson('POST', path('import'), request)
        );
    }

    async clear(request: ServerEpgClearRequest): Promise<void> {
        await this.api().sendJson('POST', path('clear'), request);
    }

    current(
        channelIds: readonly string[],
        sourceUrls?: readonly string[],
        nowMs?: number
    ): Promise<Record<string, EpgProgram | null>> {
        return this.merge(
            chunk(channelIds, SERVER_EPG_LIMITS.currentKeys).map((ids) => {
                const body: ServerEpgCurrentRequest = {
                    channelIds: ids,
                    ...scope(sourceUrls),
                    ...(nowMs === undefined ? {} : { nowMs }),
                };
                return this.api().queryJson<Record<string, EpgProgram | null>>(
                    path('current'),
                    body
                );
            })
        );
    }

    metadata(
        channelIds: readonly string[],
        sourceUrls?: readonly string[]
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        return this.merge(
            chunk(channelIds, SERVER_EPG_LIMITS.metadataKeys).map((ids) => {
                const body: ServerEpgMetadataRequest = {
                    channelIds: ids,
                    ...scope(sourceUrls),
                };
                return this.api().queryJson<
                    Record<string, EpgChannelMetadata | null>
                >(path('metadata'), body);
            })
        );
    }

    channelPrograms(
        channelId: string,
        sourceUrls?: readonly string[]
    ): Promise<EpgProgram[]> {
        const body: ServerEpgChannelProgramsRequest = {
            channelId,
            ...scope(sourceUrls),
        };
        return this.api().queryJson<EpgProgram[]>(
            path('channelPrograms'),
            body
        );
    }

    window(
        guide: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]>> {
        return this.merge(
            chunk(guide.channelIds, SERVER_EPG_LIMITS.windowKeys).map((ids) =>
                this.api().queryJson<Record<string, EpgProgram[]>>(
                    path('window'),
                    { ...guide, channelIds: ids }
                )
            )
        );
    }

    async coverage(guide: ElectronBridgeEpgGuideWindow): Promise<string[]> {
        const answers = await Promise.all(
            chunk(guide.channelIds, SERVER_EPG_LIMITS.coverageKeys).map(
                (ids) =>
                    this.api().queryJson<string[]>(path('coverage'), {
                        ...guide,
                        channelIds: ids,
                    })
            )
        );
        return [...new Set(answers.flat())];
    }

    search(
        term: string,
        limit?: number
    ): Promise<ElectronBridgeEpgSearchProgram[]> {
        const cap = SERVER_EPG_LIMITS.searchLimit;
        const body: ServerEpgSearchRequest = {
            term,
            limit: Math.min(Math.max(1, Math.floor(limit ?? cap)), cap),
        };
        return this.api().queryJson<ElectronBridgeEpgSearchProgram[]>(
            path('search'),
            body
        );
    }

    private async merge<T>(
        requests: Promise<Record<string, T>>[]
    ): Promise<Record<string, T>> {
        return Object.assign({}, ...(await Promise.all(requests)));
    }
}
```

Append to `libs/services/src/lib/server-storage/index.ts`:

```ts
export * from './server-epg-client';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test services --testPathPatterns=server-epg-client`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/server-storage/server-epg-client.ts libs/services/src/lib/server-storage/server-epg-client.spec.ts libs/services/src/lib/server-storage/index.ts
git commit -m "feat(services): server EPG API client with chunked key lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: EPG data changes and the shared EPG settings (main barrel)

**Files:**
- Create: `libs/services/src/lib/epg-data-changes.service.ts`
- Create: `libs/services/src/lib/shared-epg-settings.ts`
- Test: `libs/services/src/lib/epg-data-changes.service.spec.ts`
- Test: `libs/services/src/lib/shared-epg-settings.spec.ts`
- Modify: `libs/services/src/index.ts:26`

`SHARED_EPG_SETTINGS` is the main-barrel seam through which `SettingsStore` and Settings → EPG reach the server's shared list and refresh time without importing the server-storage sub-entry; only `provideServerEpg()` (Task 9) provides it.

- [ ] **Step 1: Write the failing specs**

`epg-data-changes.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { EpgDataChangesService } from './epg-data-changes.service';

describe('EpgDataChangesService', () => {
    it('counts changes and tells subscribers', () => {
        const changes = TestBed.inject(EpgDataChangesService);
        const seen = jest.fn();
        changes.changed$.subscribe(seen);

        expect(changes.revision()).toBe(0);
        changes.notify();
        changes.notify();

        expect(changes.revision()).toBe(2);
        expect(seen).toHaveBeenCalledTimes(2);
    });
});
```

`shared-epg-settings.spec.ts`:

```ts
import type { ServerEpgSettings } from '@iptvnator/shared/interfaces';
import {
    loadSharedEpgSettings,
    type SharedEpgSettings,
    type SharedEpgSettingsTarget,
    waitAtMost,
} from './shared-epg-settings';

function source(answer: ServerEpgSettings | null): SharedEpgSettings {
    return { read: async () => answer, save: jest.fn() };
}

function target(current: string[] = []) {
    const state = { urls: current, refreshTime: null as string | null };
    const synchronize = jest.fn().mockResolvedValue(undefined);
    const value: SharedEpgSettingsTarget = {
        current: () => state.urls,
        apply: (urls) => {
            state.urls = urls;
        },
        applyRefreshTime: (refreshTime) => {
            state.refreshTime = refreshTime;
        },
        synchronize,
    };
    return { state, synchronize, value };
}

describe('loadSharedEpgSettings', () => {
    it('applies and reconciles the list at start, even unchanged', async () => {
        const { state, synchronize, value } = target([]);

        await loadSharedEpgSettings(
            source({ urls: [], refreshTime: '04:00' }),
            value,
            true
        );

        expect(state).toEqual({ urls: [], refreshTime: '04:00' });
        expect(synchronize).toHaveBeenCalledWith([]);
    });

    it('takes the refresh time always, the list only when another device changed it', async () => {
        const { state, synchronize, value } = target([
            'https://epg.example/a.xml',
        ]);

        await loadSharedEpgSettings(
            source({
                urls: [' https://epg.example/a.xml'],
                refreshTime: '05:30',
            }),
            value,
            false
        );
        expect(state.refreshTime).toBe('05:30');
        expect(synchronize).not.toHaveBeenCalled();

        const changed = [
            'https://epg.example/a.xml',
            'https://epg.example/b.xml',
        ];
        await loadSharedEpgSettings(
            source({ urls: changed, refreshTime: '05:30' }),
            value,
            false
        );
        expect(state.urls).toEqual(changed);
        expect(synchronize).toHaveBeenCalledWith(changed);
    });

    it('keeps the current values when the server cannot be read', async () => {
        const { state, synchronize, value } = target([
            'https://epg.example/a.xml',
        ]);

        await loadSharedEpgSettings(source(null), value, true);

        expect(state).toEqual({
            urls: ['https://epg.example/a.xml'],
            refreshTime: null,
        });
        expect(synchronize).not.toHaveBeenCalled();
    });

    it('logs a failed reconciliation instead of throwing', async () => {
        const warn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        const { synchronize, value } = target([]);
        synchronize.mockRejectedValue(new Error('offline'));

        await expect(
            loadSharedEpgSettings(
                source({
                    urls: ['https://epg.example/a.xml'],
                    refreshTime: '04:00',
                }),
                value,
                true
            )
        ).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('waitAtMost', () => {
    afterEach(() => jest.useRealTimers());

    it('resolves with the work or at the timeout, whichever comes first', async () => {
        jest.useFakeTimers();
        let finished = false;
        const slow = waitAtMost(new Promise(() => undefined), 3_000).then(
            () => {
                finished = true;
            }
        );

        await jest.advanceTimersByTimeAsync(2_999);
        expect(finished).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        await slow;
        expect(finished).toBe(true);

        await expect(
            waitAtMost(Promise.reject(new Error('x')), 3_000)
        ).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns="epg-data-changes|shared-epg-settings"`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`epg-data-changes.service.ts`:

```ts
import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Imported XMLTV data changed without a settings edit: a server import
 * published, or a clear ran on another device. A settings edit goes through
 * `EpgSourceSettingsService.changed$`, which also fences running lookups;
 * this hook only tells the caches to read again.
 */
@Injectable({ providedIn: 'root' })
export class EpgDataChangesService {
    private readonly revisionSignal = signal(0);
    private readonly changes = new Subject<void>();

    /** Increases with every change, for signal consumers (the guide). */
    readonly revision = this.revisionSignal.asReadonly();
    readonly changed$ = this.changes.asObservable();

    notify(): void {
        this.revisionSignal.update((revision) => revision + 1);
        this.changes.next();
    }
}
```

`shared-epg-settings.ts`:

```ts
import { InjectionToken } from '@angular/core';
import type {
    ServerEpgSettings,
    ServerEpgSettingsUpdate,
} from '@iptvnator/shared/interfaces';
import { epgSourceUrlsChanged } from './epg-source-settings.service';

/**
 * The global XMLTV list and the daily refresh time every device of a server
 * shares (server EPG).
 */
export interface SharedEpgSettings {
    /** The server's settings; null when they cannot be read now. */
    read(): Promise<ServerEpgSettings | null>;
    /**
     * Settings → Save: the changed fields in one `PUT`. Null when the
     * server did not take them, or this page never read the list.
     */
    save(update: ServerEpgSettingsUpdate): Promise<ServerEpgSettings | null>;
}

/**
 * Provided only in server mode with server EPG (`provideServerEpg()` in the
 * server-storage sub-entry). `SettingsStore` then loads `epgUrl` from it and
 * leaves this device's stored copy unused.
 */
export const SHARED_EPG_SETTINGS = new InjectionToken<SharedEpgSettings>(
    'SHARED_EPG_SETTINGS'
);

/** How long settings load waits for the server settings before going on. */
export const SHARED_EPG_SETTINGS_WAIT_MS = 3_000;

/**
 * A server refreshes every source once a day: a source counts as fresh for
 * that long there (12 h on a device).
 */
export const SHARED_EPG_FRESH_HOURS = 24;

export interface SharedEpgSettingsTarget {
    readonly current: () => string[];
    readonly apply: (urls: string[]) => void;
    readonly applyRefreshTime: (refreshTime: string) => void;
    readonly synchronize: (urls: string[]) => Promise<void>;
}

/**
 * Reads the server's settings into the settings store. The refresh time is
 * always taken. `initial` reconciles even an unchanged list (start-up
 * always reconciles, as on the desktop); later reads act on the list only
 * when another device changed it.
 */
export async function loadSharedEpgSettings(
    source: SharedEpgSettings,
    target: SharedEpgSettingsTarget,
    initial: boolean
): Promise<void> {
    const settings = await source.read();
    if (!settings) {
        return;
    }
    target.applyRefreshTime(settings.refreshTime);
    const urls = [...settings.urls];
    if (!initial && !epgSourceUrlsChanged(target.current(), urls)) {
        return;
    }
    target.apply(urls);
    await target.synchronize(urls).catch((error: unknown) => {
        console.warn('Could not reconcile the server EPG sources.', error);
    });
}

/** Resolves when `work` settles or after `ms`, whichever comes first. */
export function waitAtMost(work: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        const done = () => {
            clearTimeout(timer);
            resolve();
        };
        void work.then(done, done);
    });
}
```

In `libs/services/src/index.ts`, replace

```ts
export * from './lib/epg-source-settings.service';
```

with

```ts
export * from './lib/epg-source-settings.service';
export * from './lib/epg-data-changes.service';
export * from './lib/shared-epg-settings';
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm nx test services --testPathPatterns="epg-data-changes|shared-epg-settings"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/epg-data-changes.service.ts libs/services/src/lib/epg-data-changes.service.spec.ts libs/services/src/lib/shared-epg-settings.ts libs/services/src/lib/shared-epg-settings.spec.ts libs/services/src/index.ts
git commit -m "feat(services): EPG data change hook and shared EPG settings token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Status diff and error texts

**Files:**
- Create: `libs/services/src/lib/server-storage/server-epg-progress.ts`
- Test: `libs/services/src/lib/server-storage/server-epg-progress.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import type {
    ServerEpgSourceStatus,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import {
    diffServerEpgStatus,
    serverEpgErrorHost,
    serverEpgErrorKey,
    settledEvent,
    splitByFreshness,
} from './server-epg-progress';

const URL_A = 'https://epg.example/a.xml';
const URL_B = 'http://nas.local/b.xml';
const T1 = '2026-10-15T04:00:00.000Z';
const T2 = '2026-10-15T10:00:00.000Z';

function source(
    overrides: Partial<ServerEpgSourceStatus> = {}
): ServerEpgSourceStatus {
    return {
        url: URL_A,
        owners: { global: true, playlists: 0 },
        state: 'idle',
        ...overrides,
    };
}

function status(
    sources: ServerEpgSourceStatus[],
    revision = 1
): ServerEpgStatus {
    return {
        revision,
        refreshTime: '04:00',
        timeZone: 'UTC',
        nextRunAt: null,
        sources,
        totals: { programmes: 0, databaseBytes: 0 },
    };
}

/** Stand-in for the translated message: key and host. */
const text = (item: Pick<ServerEpgSourceStatus, 'url' | 'errorCode' | 'errorHost'>) =>
    `${serverEpgErrorKey(item.errorCode)}|${serverEpgErrorHost(item)}`;

describe('diffServerEpgStatus', () => {
    it('reports only running imports from a first status', () => {
        const diff = diffServerEpgStatus(
            null,
            status([
                source({ state: 'queued', queuePosition: 2 }),
                source({ url: URL_B, lastSuccessAt: T1 }),
            ]),
            text
        );

        expect(diff.events).toEqual([
            { url: URL_A, status: 'queued', queuePosition: 2 },
        ]);
        expect(diff.revisionChanged).toBe(false);
    });

    it('follows an import from queued to complete', () => {
        const queued = status([source({ state: 'queued', queuePosition: 1 })]);
        const stats = { totalChannels: 4, totalPrograms: 40 };
        const loading = status([source({ state: 'loading', stats })]);
        const done = status(
            [
                source({
                    lastSuccessAt: T2,
                    lastAttemptAt: T2,
                    channels: 8,
                    programmes: 64,
                }),
            ],
            2
        );

        expect(diffServerEpgStatus(queued, loading, text).events).toEqual([
            { url: URL_A, status: 'loading', stats },
        ]);
        expect(diffServerEpgStatus(loading, loading, text).events).toEqual(
            []
        );
        const finished = diffServerEpgStatus(loading, done, text);
        expect(finished.events).toEqual([
            {
                url: URL_A,
                status: 'complete',
                stats: { totalChannels: 8, totalPrograms: 64 },
            },
        ]);
        expect(finished.revisionChanged).toBe(true);
    });

    it('keeps the security code and turns other codes into text', () => {
        const loading = status([
            source({ state: 'loading' }),
            source({ url: URL_B, state: 'loading' }),
        ]);
        const failed = status([
            source({ state: 'error', errorCode: 'epg_timeout' }),
            source({
                url: URL_B,
                state: 'error',
                errorCode: 'epg-private-network-blocked',
                errorHost: 'nas.local',
            }),
        ]);

        expect(diffServerEpgStatus(loading, failed, text).events).toEqual([
            {
                url: URL_A,
                status: 'error',
                error: 'SERVER_EPG.ERROR_TIMEOUT|epg.example',
            },
            {
                url: URL_B,
                status: 'error',
                error: 'SERVER_EPG.ERROR_PRIVATE_NETWORK|nas.local',
                errorCode: 'epg-private-network-blocked',
                errorHost: 'nas.local',
            },
        ]);
    });

    it('stays quiet about imports this page did not see run', () => {
        expect(
            diffServerEpgStatus(
                status([source({ lastSuccessAt: T1 })]),
                status([source({ lastSuccessAt: T2 })]),
                text
            ).events
        ).toEqual([]);
    });

    it('cancels an import that vanished or ended without a new success', () => {
        const running = status([
            source({ state: 'loading', lastSuccessAt: T1 }),
            source({ url: URL_B, state: 'queued' }),
        ]);

        expect(
            diffServerEpgStatus(
                running,
                status([source({ lastSuccessAt: T1 })]),
                text
            ).events
        ).toEqual([
            { url: URL_A, status: 'cancelled' },
            { url: URL_B, status: 'cancelled' },
        ]);
    });
});

describe('settledEvent', () => {
    it('completes an idle source with data and cancels one without', () => {
        expect(
            settledEvent(
                undefined,
                source({ lastSuccessAt: T1, channels: 1, programmes: 2 }),
                text
            )
        ).toEqual({
            url: URL_A,
            status: 'complete',
            stats: { totalChannels: 1, totalPrograms: 2 },
        });
        expect(settledEvent(undefined, source(), text)).toEqual({
            url: URL_A,
            status: 'cancelled',
        });
    });
});

describe('splitByFreshness', () => {
    it('derives fresh and stale from the last successful import', () => {
        const now = Date.parse('2026-10-15T12:00:00.000Z');
        const current = status([
            source({ url: 'fresh', lastSuccessAt: '2026-10-15T10:00:00.000Z' }),
            source({ url: 'old', lastSuccessAt: '2026-10-14T06:00:00.000Z' }),
            source({ url: 'never' }),
            // Server clock ahead of this device.
            source({ url: 'ahead', lastSuccessAt: '2026-10-15T12:05:00.000Z' }),
        ]);

        expect(
            splitByFreshness(
                current,
                ['fresh', 'old', 'never', 'ahead', 'unknown'],
                12,
                now
            )
        ).toEqual({
            freshUrls: ['fresh', 'ahead'],
            staleUrls: ['old', 'never', 'unknown'],
        });
    });
});

describe('server EPG error texts', () => {
    it('maps codes to keys and names the host', () => {
        expect(serverEpgErrorKey('epg_too_large')).toBe(
            'SERVER_EPG.ERROR_TOO_LARGE'
        );
        expect(serverEpgErrorKey('invalid-tls-certificate')).toBe(
            'SERVER_EPG.ERROR_TLS'
        );
        expect(serverEpgErrorKey('something_new')).toBe(
            'SERVER_EPG.ERROR_UNKNOWN'
        );
        expect(serverEpgErrorKey(undefined)).toBe('SERVER_EPG.ERROR_UNKNOWN');
        expect(serverEpgErrorHost({ url: URL_B })).toBe('nas.local');
        expect(serverEpgErrorHost({ url: URL_B, errorHost: '10.0.0.2' })).toBe(
            '10.0.0.2'
        );
        expect(serverEpgErrorHost({ url: 'not a url' })).toBe('');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-epg-progress`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`server-epg-progress.ts`:

```ts
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    SERVER_EPG_ERROR_CODES,
    type ElectronBridgeEpgFreshnessResult,
    type ElectronBridgeEpgProgress,
    type ElectronBridgeSecurityErrorCode,
    type ServerEpgSourceStatus,
    type ServerEpgStatus,
} from '@iptvnator/shared/interfaces';

type ErrorSource = Pick<ServerEpgSourceStatus, 'url' | 'errorCode' | 'errorHost'>;

/** Turns a source's import error into the text the panel shows. */
export type DescribeServerEpgError = (source: ErrorSource) => string;

const ERROR_KEYS: Readonly<Record<string, string>> = {
    [SERVER_EPG_ERROR_CODES.HttpStatus]: 'SERVER_EPG.ERROR_HTTP_STATUS',
    [SERVER_EPG_ERROR_CODES.Network]: 'SERVER_EPG.ERROR_NETWORK',
    [SERVER_EPG_ERROR_CODES.Timeout]: 'SERVER_EPG.ERROR_TIMEOUT',
    [SERVER_EPG_ERROR_CODES.TooLarge]: 'SERVER_EPG.ERROR_TOO_LARGE',
    [SERVER_EPG_ERROR_CODES.ParseFailed]: 'SERVER_EPG.ERROR_PARSE_FAILED',
    [SERVER_EPG_ERROR_CODES.Empty]: 'SERVER_EPG.ERROR_EMPTY',
    [SERVER_EPG_ERROR_CODES.TooManySources]:
        'SERVER_EPG.ERROR_TOO_MANY_SOURCES',
    [ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked]:
        'SERVER_EPG.ERROR_PRIVATE_NETWORK',
    [ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate]:
        'SERVER_EPG.ERROR_TLS',
};

const SECURITY_CODES: ReadonlySet<string> = new Set(
    Object.values(ELECTRON_BRIDGE_SECURITY_ERROR_CODES)
);

/**
 * Translation key of an import error. The two security keys name the
 * server setting that allows the source (`IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS`,
 * `NODE_EXTRA_CA_CERTS`): a server has no trust action.
 */
export function serverEpgErrorKey(code: string | undefined): string {
    return (code && ERROR_KEYS[code]) || 'SERVER_EPG.ERROR_UNKNOWN';
}

/** The host an error names: the server's, else the source URL's. */
export function serverEpgErrorHost(
    source: Pick<ServerEpgSourceStatus, 'url' | 'errorHost'>
): string {
    if (source.errorHost) {
        return source.errorHost;
    }
    try {
        return new URL(source.url).hostname;
    } catch {
        return '';
    }
}

export function isRunning(source: Pick<ServerEpgSourceStatus, 'state'>): boolean {
    return source.state === 'queued' || source.state === 'loading';
}

function errorEvent(
    source: ServerEpgSourceStatus,
    describe: DescribeServerEpgError
): ElectronBridgeEpgProgress {
    const code = source.errorCode;
    return {
        url: source.url,
        status: 'error',
        error: describe(source),
        ...(code && SECURITY_CODES.has(code)
            ? { errorCode: code as ElectronBridgeSecurityErrorCode }
            : {}),
        ...(source.errorHost ? { errorHost: source.errorHost } : {}),
    };
}

/**
 * The event a source that stopped running ends with: `complete` only with
 * a new successful import, `error` with its message, `cancelled` otherwise
 * (aborted, restarted, or never queued).
 */
export function settledEvent(
    previous: ServerEpgSourceStatus | undefined,
    next: ServerEpgSourceStatus,
    describe: DescribeServerEpgError
): ElectronBridgeEpgProgress {
    if (next.state === 'error') {
        return errorEvent(next, describe);
    }
    if (next.lastSuccessAt && next.lastSuccessAt !== previous?.lastSuccessAt) {
        return {
            url: next.url,
            status: 'complete',
            stats: {
                totalChannels: next.channels ?? 0,
                totalPrograms: next.programmes ?? 0,
            },
        };
    }
    return { url: next.url, status: 'cancelled' };
}

function sourceEvent(
    previous: ServerEpgSourceStatus | undefined,
    next: ServerEpgSourceStatus,
    describe: DescribeServerEpgError
): ElectronBridgeEpgProgress | null {
    if (next.state === 'queued') {
        return previous?.state === 'queued' &&
            previous.queuePosition === next.queuePosition
            ? null
            : {
                  url: next.url,
                  status: 'queued',
                  ...(next.queuePosition === undefined
                      ? {}
                      : { queuePosition: next.queuePosition }),
              };
    }
    if (next.state === 'loading') {
        const same =
            previous?.state === 'loading' &&
            previous.stats?.totalChannels === next.stats?.totalChannels &&
            previous.stats?.totalPrograms === next.stats?.totalPrograms;
        return same
            ? null
            : {
                  url: next.url,
                  status: 'loading',
                  ...(next.stats ? { stats: next.stats } : {}),
              };
    }
    // Idle or failed: worth an event only for an import this page saw run.
    return previous && isRunning(previous)
        ? settledEvent(previous, next, describe)
        : null;
}

export interface ServerEpgStatusDiff {
    readonly events: readonly ElectronBridgeEpgProgress[];
    /** Data was published or cleared since the previous status. */
    readonly revisionChanged: boolean;
}

/** What changed between two status reads, as bridge progress events. */
export function diffServerEpgStatus(
    previous: ServerEpgStatus | null,
    next: ServerEpgStatus,
    describe: DescribeServerEpgError
): ServerEpgStatusDiff {
    const before = new Map(
        (previous?.sources ?? []).map((source) => [source.url, source])
    );
    const events: ElectronBridgeEpgProgress[] = [];
    for (const source of next.sources) {
        const event = sourceEvent(before.get(source.url), source, describe);
        before.delete(source.url);
        if (event) {
            events.push(event);
        }
    }
    for (const gone of before.values()) {
        if (isRunning(gone)) {
            events.push({ url: gone.url, status: 'cancelled' });
        }
    }
    return {
        events,
        revisionChanged:
            previous !== null && previous.revision !== next.revision,
    };
}

/** Fresh: imported successfully less than `maxAgeHours` ago. */
export function splitByFreshness(
    status: Pick<ServerEpgStatus, 'sources'>,
    urls: readonly string[],
    maxAgeHours: number,
    nowMs: number
): ElectronBridgeEpgFreshnessResult {
    const lastSuccess = new Map(
        status.sources.map((source) => [source.url, source.lastSuccessAt])
    );
    const maxAgeMs = maxAgeHours * 3_600_000;
    const freshUrls: string[] = [];
    const staleUrls: string[] = [];
    for (const url of urls) {
        // A server clock ahead of this device gives a negative age: fresh.
        const age = nowMs - Date.parse(lastSuccess.get(url) ?? '');
        (age < maxAgeMs ? freshUrls : staleUrls).push(url);
    }
    return { staleUrls, freshUrls };
}
```

Append to `libs/services/src/lib/server-storage/index.ts`:

```ts
export * from './server-epg-progress';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test services --testPathPatterns=server-epg-progress`
Expected: PASS, 8 tests. (`Date.parse('')` is `NaN`, and `NaN < x` is false, so a source without a success is stale.)

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/server-storage/server-epg-progress.ts libs/services/src/lib/server-storage/server-epg-progress.spec.ts libs/services/src/lib/server-storage/index.ts
git commit -m "feat(services): turn server EPG status changes into progress events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `ServerEpgStatusPoller`

**Files:**
- Create: `libs/services/src/lib/server-storage/server-epg-status-poller.ts`
- Test: `libs/services/src/lib/server-storage/server-epg-status-poller.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import type {
    ElectronBridgeEpgProgress,
    ServerEpgSourceStatus,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import { EpgDataChangesService } from '../epg-data-changes.service';
import { ServerEpgClient } from './server-epg-client';
import {
    SERVER_EPG_OFFLINE_RETRY_MS,
    SERVER_EPG_POLL_MS,
    ServerEpgStatusPoller,
} from './server-epg-status-poller';

const URL_A = 'https://epg.example/a.xml';
const DONE = '2026-10-15T10:00:00.000Z';

function source(
    overrides: Partial<ServerEpgSourceStatus> = {}
): ServerEpgSourceStatus {
    return {
        url: URL_A,
        owners: { global: true, playlists: 0 },
        state: 'idle',
        ...overrides,
    };
}

function status(
    sources: ServerEpgSourceStatus[],
    revision = 1
): ServerEpgStatus {
    return {
        revision,
        refreshTime: '04:00',
        timeZone: 'UTC',
        nextRunAt: null,
        sources,
        totals: { programmes: 0, databaseBytes: 0 },
    };
}

describe('ServerEpgStatusPoller', () => {
    let getStatus: jest.Mock;
    let poller: ServerEpgStatusPoller;
    let events: ElectronBridgeEpgProgress[];

    beforeEach(() => {
        jest.useFakeTimers();
        events = [];
        getStatus = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: ServerEpgClient, useValue: { getStatus } },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string, params?: { host?: string }) =>
                            `${key}:${params?.host ?? ''}`,
                    },
                },
            ],
        });
        poller = TestBed.inject(ServerEpgStatusPoller);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        TestBed.resetTestingModule();
    });

    it('polls while an import runs, without reporting one this page did not start', async () => {
        getStatus
            .mockResolvedValueOnce(
                status([
                    source({
                        state: 'loading',
                        stats: { totalChannels: 1, totalPrograms: 10 },
                    }),
                ])
            )
            .mockResolvedValueOnce(
                status(
                    [source({ lastSuccessAt: DONE, channels: 2, programmes: 20 })],
                    2
                )
            );

        poller.onProgress((event) => events.push(event));
        await jest.advanceTimersByTimeAsync(0);
        // The nightly run: Settings → EPG lists it, the panel stays quiet.
        expect(poller.status()?.sources[0].state).toBe('loading');

        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS);
        expect(poller.status()?.sources[0].state).toBe('idle');
        expect(events).toEqual([]);

        // Nothing runs any more: no further reads.
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS * 5);
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('reports an import this page started, from queued to complete', async () => {
        getStatus
            .mockResolvedValueOnce(status([source()]))
            .mockResolvedValue(
                status(
                    [source({ lastSuccessAt: DONE, channels: 2, programmes: 20 })],
                    2
                )
            );
        poller.onProgress((event) => events.push(event));
        await jest.advanceTimersByTimeAsync(0);

        const settled = poller.settle(
            [URL_A],
            status([source({ state: 'queued', queuePosition: 1 })])
        );
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS);

        const complete = {
            url: URL_A,
            status: 'complete',
            stats: { totalChannels: 2, totalPrograms: 20 },
        };
        expect(events).toEqual([
            { url: URL_A, status: 'queued', queuePosition: 1 },
            complete,
        ]);
        await expect(settled).resolves.toEqual([complete]);
    });

    it('reports every import a clear on this page started', async () => {
        const urlB = 'https://epg.example/b.xml';
        getStatus.mockResolvedValue(
            status(
                [
                    source({ lastSuccessAt: DONE, channels: 1, programmes: 5 }),
                    source({ url: urlB, state: 'error', errorCode: 'epg_timeout' }),
                ],
                2
            )
        );
        poller.onProgress((event) => events.push(event));
        await jest.advanceTimersByTimeAsync(0);

        poller.follow(
            status([
                source({ state: 'queued', queuePosition: 1 }),
                source({ url: urlB, state: 'queued', queuePosition: 2 }),
            ])
        );
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS);

        expect(events).toEqual([
            { url: URL_A, status: 'queued', queuePosition: 1 },
            { url: urlB, status: 'queued', queuePosition: 2 },
            {
                url: URL_A,
                status: 'complete',
                stats: { totalChannels: 1, totalPrograms: 5 },
            },
            {
                url: urlB,
                status: 'error',
                error: 'SERVER_EPG.ERROR_TIMEOUT:epg.example',
            },
        ]);
    });

    it('tells the EPG caches when the revision changes', async () => {
        const notify = jest.spyOn(TestBed.inject(EpgDataChangesService), 'notify');
        getStatus
            .mockResolvedValueOnce(status([], 1))
            .mockResolvedValueOnce(status([], 1))
            .mockResolvedValueOnce(status([], 2));

        await poller.refresh();
        await poller.refresh();
        expect(notify).not.toHaveBeenCalled();
        await poller.refresh();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('keeps polling while Settings watches, and stops after the release', async () => {
        getStatus.mockResolvedValue(status([]));

        // One shared start read, then one read per interval.
        const release = poller.watch();
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS * 2);
        expect(getStatus).toHaveBeenCalledTimes(3);

        // The timer armed before the release fires once more, then stops.
        release();
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS * 3);
        expect(getStatus).toHaveBeenCalledTimes(4);
    });

    it('settles an import with its final event', async () => {
        getStatus.mockResolvedValue(
            status([
                source({
                    state: 'error',
                    errorCode: 'epg-private-network-blocked',
                    errorHost: 'nas.local',
                }),
            ])
        );

        const settled = poller.settle(
            [URL_A],
            status([source({ state: 'queued', queuePosition: 1 })])
        );
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS);

        await expect(settled).resolves.toEqual([
            {
                url: URL_A,
                status: 'error',
                error: 'SERVER_EPG.ERROR_PRIVATE_NETWORK:nas.local',
                errorCode: 'epg-private-network-blocked',
                errorHost: 'nas.local',
            },
        ]);
    });

    it('settles at once what the server did not queue', async () => {
        await expect(
            poller.settle(
                [URL_A, 'https://foreign.example/x.xml'],
                status([source({ lastSuccessAt: DONE, channels: 1, programmes: 5 })])
            )
        ).resolves.toEqual([
            {
                url: URL_A,
                status: 'complete',
                stats: { totalChannels: 1, totalPrograms: 5 },
            },
            { url: 'https://foreign.example/x.xml', status: 'cancelled' },
        ]);
        expect(getStatus).not.toHaveBeenCalled();
    });

    it('retries less often while the server does not answer', async () => {
        getStatus.mockRejectedValue(new Error('offline'));

        // watch() starts the poller; its own read joins the start read.
        poller.watch();
        await jest.advanceTimersByTimeAsync(0);
        expect(getStatus).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS);
        expect(getStatus).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(SERVER_EPG_OFFLINE_RETRY_MS);
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('reads again when the tab is shown and never while it is hidden', async () => {
        getStatus.mockResolvedValue(
            status([source({ state: 'queued', queuePosition: 1 })])
        );
        const visibility = jest
            .spyOn(document, 'visibilityState', 'get')
            .mockReturnValue('hidden');

        poller.onProgress(jest.fn());
        await jest.advanceTimersByTimeAsync(SERVER_EPG_POLL_MS * 3);
        expect(getStatus).toHaveBeenCalledTimes(1);

        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await jest.advanceTimersByTimeAsync(0);
        expect(getStatus).toHaveBeenCalledTimes(2);
        visibility.mockRestore();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-epg-status-poller`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`server-epg-status-poller.ts`:

```ts
import { inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type {
    ElectronBridgeEpgProgress,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import { EpgDataChangesService } from '../epg-data-changes.service';
import { ServerEpgClient } from './server-epg-client';
import {
    type DescribeServerEpgError,
    diffServerEpgStatus,
    isRunning,
    serverEpgErrorHost,
    serverEpgErrorKey,
    settledEvent,
} from './server-epg-progress';

export const SERVER_EPG_POLL_MS = 2_000;
export const SERVER_EPG_OFFLINE_RETRY_MS = 10_000;
/** The server recomputes its sources about 2 s after a playlist write. */
export const SERVER_EPG_REGISTRY_SETTLE_MS = 3_000;
/** Longer than the server's 60 min wall clock for one import. */
export const SERVER_EPG_SETTLE_TIMEOUT_MS = 65 * 60_000;

type ProgressListener = (progress: ElectronBridgeEpgProgress) => void;

/**
 * Reads `/v1/epg/status` once when the first progress listener registers,
 * every 2 s while a source is queued or loading, while Settings → EPG
 * watches or an import request waits, and when the tab is shown again;
 * every 10 s instead while the server does not answer, and never while the
 * tab is hidden. `status` feeds Settings → EPG with every import. Only the
 * imports this page started (refresh, add, retry, clear) become the
 * bridge's progress events for the import panel; the nightly run and other
 * devices' imports stay out of it. A new `revision` tells the EPG caches to
 * read again.
 */
@Injectable({ providedIn: 'root' })
export class ServerEpgStatusPoller {
    private readonly client = inject(ServerEpgClient);
    private readonly translate = inject(TranslateService);
    private readonly dataChanges = inject(EpgDataChangesService);
    private readonly statusSignal = signal<ServerEpgStatus | null>(null);
    private readonly listeners = new Set<ProgressListener>();
    private readonly waiters = new Map<string, ProgressListener[]>();
    /** URLs whose import this page started and that have not ended yet. */
    private readonly requested = new Set<string>();
    private watchers = 0;
    private started = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private inFlight: Promise<ServerEpgStatus | null> | undefined;

    /** The last status read; null until the first answer. */
    readonly status = this.statusSignal.asReadonly();

    private readonly describe: DescribeServerEpgError = (source) =>
        this.translate.instant(serverEpgErrorKey(source.errorCode), {
            host: serverEpgErrorHost(source),
        });

    onProgress(listener: ProgressListener): void {
        this.listeners.add(listener);
        this.start();
    }

    /** Settings → EPG is open: keep the status current. Returns the release. */
    watch(): () => void {
        this.watchers += 1;
        this.start();
        void this.refresh();
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.watchers -= 1;
            }
        };
    }

    /** One status read now; concurrent callers share it. Null when unreachable. */
    refresh(): Promise<ServerEpgStatus | null> {
        this.inFlight ??= this.client
            .getStatus()
            .then(
                (next) => {
                    this.ingest(next);
                    return next;
                },
                () => {
                    this.schedule(SERVER_EPG_OFFLINE_RETRY_MS);
                    return null;
                }
            )
            .finally(() => {
                this.inFlight = undefined;
            });
        return this.inFlight;
    }

    /** A playlist was just saved: read again once the server queued its sources. */
    pollSoon(): void {
        this.schedule(SERVER_EPG_REGISTRY_SETTLE_MS, true);
    }

    /**
     * Each URL's final event once it left `queued`/`loading`. `accepted` is
     * the import request's answer: a URL it does not list was ignored by the
     * server; one it lists as idle or failed had nothing left to do.
     */
    settle(
        urls: readonly string[],
        accepted: ServerEpgStatus
    ): Promise<ElectronBridgeEpgProgress[]> {
        const sources = new Map(
            accepted.sources.map((source) => [source.url, source])
        );
        const results = urls.map((url): Promise<ElectronBridgeEpgProgress> => {
            const source = sources.get(url);
            if (!source) {
                return Promise.resolve({ url, status: 'cancelled' });
            }
            if (!isRunning(source)) {
                return Promise.resolve(
                    settledEvent(undefined, source, this.describe)
                );
            }
            this.requested.add(url);
            return new Promise((resolve) => this.addWaiter(url, resolve));
        });
        this.ingest(accepted);
        return Promise.all(results);
    }

    /**
     * Imports this page started without waiting for them (a clear that
     * imports every source again): the panel shows them as for a refresh.
     */
    follow(accepted: ServerEpgStatus): void {
        for (const source of accepted.sources) {
            if (isRunning(source)) {
                this.requested.add(source.url);
            }
        }
        this.ingest(accepted);
    }

    private ingest(next: ServerEpgStatus): void {
        const diff = diffServerEpgStatus(
            this.statusSignal(),
            next,
            this.describe
        );
        this.statusSignal.set(next);
        diff.events.forEach((event) => this.report(event));
        if (diff.revisionChanged) {
            this.dataChanges.notify();
        }
        this.schedule(SERVER_EPG_POLL_MS);
    }

    /** Progress of an import this page started; it ends with its final event. */
    private report(event: ElectronBridgeEpgProgress): void {
        if (!this.requested.has(event.url)) {
            return;
        }
        this.listeners.forEach((listener) => listener(event));
        if (event.status === 'queued' || event.status === 'loading') {
            return;
        }
        this.requested.delete(event.url);
        [...(this.waiters.get(event.url) ?? [])].forEach((finish) =>
            finish(event)
        );
    }

    private addWaiter(url: string, resolve: ProgressListener): void {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish: ProgressListener = (progress) => {
            clearTimeout(timeout);
            const rest = (this.waiters.get(url) ?? []).filter(
                (item) => item !== finish
            );
            if (rest.length > 0) {
                this.waiters.set(url, rest);
            } else {
                this.waiters.delete(url);
            }
            resolve(progress);
        };
        timeout = setTimeout(
            () => finish({ url, status: 'cancelled' }),
            SERVER_EPG_SETTLE_TIMEOUT_MS
        );
        this.waiters.set(url, [...(this.waiters.get(url) ?? []), finish]);
    }

    private start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                void this.refresh();
            }
        });
        void this.refresh();
    }

    private get active(): boolean {
        return (
            this.watchers > 0 ||
            this.waiters.size > 0 ||
            (this.statusSignal()?.sources.some(isRunning) ?? false)
        );
    }

    /** One timer; `force` arms it although nothing runs (a registry about to queue). */
    private schedule(delayMs: number, force = false): void {
        if (!force && !this.active) {
            return;
        }
        if (document.visibilityState === 'hidden') {
            return;
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.refresh();
        }, delayMs);
    }
}
```

Append to `libs/services/src/lib/server-storage/index.ts`:

```ts
export * from './server-epg-status-poller';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test services --testPathPatterns=server-epg-status-poller`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/server-storage/server-epg-status-poller.ts libs/services/src/lib/server-storage/server-epg-status-poller.spec.ts libs/services/src/lib/server-storage/index.ts
git commit -m "feat(services): poll the server EPG status; report imports started here

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: `ServerEpgBackend`

**Files:**
- Create: `libs/services/src/lib/server-storage/server-epg-backend.ts`
- Test: `libs/services/src/lib/server-storage/server-epg-backend.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`

Method signatures follow `libs/shared/interfaces/src/lib/electron-api.interface.ts:870-927` and `:1217` (`onEpgProgress`). The trust options parameter of `fetchEpg`/`forceFetchEpg` is left out: a server decides trust through its environment.

- [ ] **Step 1: Write the failing spec**

```ts
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import type {
    ServerEpgSourceStatus,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import { ServerEpgBackend } from './server-epg-backend';
import { ServerEpgClient } from './server-epg-client';
import { ServerEpgStatusPoller } from './server-epg-status-poller';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const FRESH = 'https://epg.example/fresh.xml';
const STALE = 'https://epg.example/stale.xml';
const FOREIGN = 'https://other.example/guide.xml';

function source(url: string, lastSuccessAt?: string): ServerEpgSourceStatus {
    return {
        url,
        owners: { global: true, playlists: 0 },
        state: 'idle',
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
    };
}

function status(sources: ServerEpgSourceStatus[]): ServerEpgStatus {
    return {
        revision: 1,
        refreshTime: '04:00',
        timeZone: 'UTC',
        nextRunAt: null,
        sources,
        totals: { programmes: 0, databaseBytes: 0 },
    };
}

interface ClientStub {
    getSettings: jest.Mock;
    putSettings: jest.Mock;
    startImport: jest.Mock;
    clear: jest.Mock;
    current: jest.Mock;
    metadata: jest.Mock;
    channelPrograms: jest.Mock;
    window: jest.Mock;
    coverage: jest.Mock;
    search: jest.Mock;
}

describe('ServerEpgBackend', () => {
    let client: ClientStub;
    let poller: {
        refresh: jest.Mock;
        settle: jest.Mock;
        follow: jest.Mock;
        pollSoon: jest.Mock;
        onProgress: jest.Mock;
    };
    let backend: ServerEpgBackend;

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        client = {
            getSettings: jest.fn(),
            putSettings: jest.fn(),
            startImport: jest.fn(),
            clear: jest.fn().mockResolvedValue(undefined),
            current: jest.fn(),
            metadata: jest.fn(),
            channelPrograms: jest.fn(),
            window: jest.fn(),
            coverage: jest.fn(),
            search: jest.fn(),
        };
        poller = {
            refresh: jest.fn(),
            settle: jest.fn(),
            follow: jest.fn(),
            pollSoon: jest.fn(),
            onProgress: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: ServerEpgClient, useValue: client },
                { provide: ServerEpgStatusPoller, useValue: poller },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        backend = TestBed.inject(ServerEpgBackend);
    });

    afterEach(() => {
        jest.useRealTimers();
        TestBed.resetTestingModule();
    });

    it('has the XMLTV bridge methods, but no file picker and no mapping', () => {
        for (const method of [
            'fetchEpg',
            'forceFetchEpg',
            'clearEpgData',
            'clearEpgDataForSource',
            'reconcileEpgSources',
            'getChannelPrograms',
            'getCurrentProgramsBatch',
            'getEpgChannelMetadata',
            'checkEpgFreshness',
            'getEpgProgramsForChannels',
            'getEpgProgramCoverage',
            'searchEpgPrograms',
            'onEpgProgress',
        ] as const) {
            expect(typeof backend[method]).toBe('function');
        }
        for (const method of [
            'openEpgFileDialog',
            'getEpgMapping',
            'getEpgMappingsBatch',
            'setEpgMapping',
            'deleteEpgMapping',
            'searchEpgChannels',
        ]) {
            expect(method in backend).toBe(false);
        }
    });

    it('imports only stale sources the server owns and waits for them', async () => {
        const accepted = status([
            { ...source(STALE), state: 'queued', queuePosition: 1 },
        ]);
        poller.refresh.mockResolvedValue(
            status([
                source(FRESH, '2026-10-15T08:00:00.000Z'),
                source(STALE, '2026-10-14T06:00:00.000Z'),
            ])
        );
        client.startImport.mockResolvedValue(accepted);
        poller.settle.mockResolvedValue([{ url: STALE, status: 'complete' }]);

        await expect(
            backend.fetchEpg([FRESH, ` ${STALE}`, FOREIGN, ''])
        ).resolves.toEqual({ success: true, skipped: [FRESH] });

        expect(client.startImport).toHaveBeenCalledWith({
            urls: [STALE],
            force: false,
        });
        expect(poller.settle).toHaveBeenCalledWith([STALE], accepted);
        // A foreign URL may be a playlist's that the server queues itself.
        expect(poller.pollSoon).toHaveBeenCalled();
    });

    it('forces one source and reports its error', async () => {
        const accepted = status([]);
        client.startImport.mockResolvedValue(accepted);
        poller.settle.mockResolvedValue([
            { url: STALE, status: 'error', error: 'The download took too long.' },
        ]);

        await expect(backend.forceFetchEpg(` ${STALE} `)).resolves.toEqual({
            success: false,
            message: 'The download took too long.',
            skipped: [],
        });
        expect(client.startImport).toHaveBeenCalledWith({
            urls: [STALE],
            force: true,
        });
    });

    it('says when the server did not import a forced source', async () => {
        client.startImport.mockResolvedValue(status([]));
        poller.settle.mockResolvedValue([
            { url: FOREIGN, status: 'cancelled' },
        ]);

        await expect(backend.forceFetchEpg(FOREIGN)).resolves.toEqual({
            success: false,
            message: 'SERVER_EPG.NOT_IMPORTED',
            skipped: [],
        });
    });

    it('answers with no data while the server is unreachable', async () => {
        const offline = new Error('offline');
        for (const method of [
            'current',
            'metadata',
            'channelPrograms',
            'window',
            'coverage',
            'search',
            'startImport',
        ] as const) {
            client[method].mockRejectedValue(offline);
        }
        poller.refresh.mockResolvedValue(null);
        const guide = { channelIds: ['news'], fromMs: 1, toMs: 2 };

        await expect(backend.getChannelPrograms('news')).resolves.toEqual([]);
        await expect(backend.getCurrentProgramsBatch(['news'])).resolves.toEqual(
            {}
        );
        await expect(backend.getEpgChannelMetadata(['news'])).resolves.toEqual(
            {}
        );
        await expect(backend.getEpgProgramsForChannels(guide)).resolves.toEqual(
            {}
        );
        await expect(backend.getEpgProgramCoverage(guide)).resolves.toEqual([]);
        await expect(backend.searchEpgPrograms('news')).resolves.toEqual([]);
        await expect(backend.checkEpgFreshness([STALE])).resolves.toEqual({
            staleUrls: [],
            freshUrls: [],
        });
        // Nothing failed on this device: the server imports on its own.
        await expect(backend.fetchEpg([STALE])).resolves.toEqual({
            success: true,
            skipped: [STALE],
        });
        await expect(backend.forceFetchEpg(STALE)).resolves.toEqual({
            success: false,
            message: 'SERVER_EPG.UNREACHABLE',
            skipped: [],
        });
    });

    it('passes only the source scope and the clock to the server', async () => {
        client.current.mockResolvedValue({ news: null });
        client.metadata.mockResolvedValue({ news: null });
        client.channelPrograms.mockResolvedValue([]);

        await backend.getCurrentProgramsBatch(['news'], {
            sourceUrls: [STALE],
            nowMs: 5,
            anySourceFallback: true,
        } as never);
        await backend.getEpgChannelMetadata(['news'], { sourceUrls: [STALE] });
        await backend.getChannelPrograms('news', { sourceUrls: [STALE] });

        expect(client.current).toHaveBeenCalledWith(['news'], [STALE], 5);
        expect(client.metadata).toHaveBeenCalledWith(['news'], [STALE]);
        expect(client.channelPrograms).toHaveBeenCalledWith('news', [STALE]);
    });

    it('commits the shared list only after reading it, and only a change', async () => {
        client.getSettings.mockResolvedValue({
            urls: [STALE],
            refreshTime: '04:00',
        });
        client.putSettings.mockResolvedValue({
            urls: [STALE, FRESH],
            refreshTime: '04:00',
        });

        // Never read on this page: refuse rather than overwrite blind.
        await expect(backend.reconcileEpgSources([STALE])).resolves.toEqual({
            success: false,
        });
        await expect(backend.read()).resolves.toEqual({
            urls: [STALE],
            refreshTime: '04:00',
        });
        await expect(
            backend.reconcileEpgSources([` ${STALE}`])
        ).resolves.toEqual({ success: true });
        expect(client.putSettings).not.toHaveBeenCalled();

        await expect(
            backend.reconcileEpgSources([STALE, FRESH])
        ).resolves.toEqual({ success: true });
        expect(client.putSettings).toHaveBeenCalledWith({
            urls: [STALE, FRESH],
        });
        expect(poller.refresh).toHaveBeenCalled();

        client.putSettings.mockRejectedValue(new Error('offline'));
        await expect(backend.reconcileEpgSources([FRESH])).resolves.toEqual({
            success: false,
        });
    });

    it('drops a read that a save overtook', async () => {
        client.getSettings.mockResolvedValueOnce({
            urls: [STALE],
            refreshTime: '04:00',
        });
        await backend.read();
        let answer!: (value: { urls: string[]; refreshTime: string }) => void;
        client.getSettings.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        client.putSettings.mockResolvedValue({
            urls: [STALE, FRESH],
            refreshTime: '04:00',
        });

        const reading = backend.read();
        await backend.reconcileEpgSources([STALE, FRESH]);
        answer({ urls: [STALE], refreshTime: '04:00' });

        await expect(reading).resolves.toBeNull();
        await expect(
            backend.reconcileEpgSources([STALE, FRESH])
        ).resolves.toEqual({ success: true });
        expect(client.putSettings).toHaveBeenCalledTimes(1);
    });

    it('clears every source and imports them again, shown as started here', async () => {
        const accepted = status([
            { ...source(STALE), state: 'queued', queuePosition: 1 },
        ]);
        client.startImport.mockResolvedValue(accepted);

        await expect(backend.clearEpgData()).resolves.toEqual({ success: true });
        expect(client.clear).toHaveBeenCalledWith({});
        expect(client.startImport).toHaveBeenCalledWith({ force: true });
        expect(poller.follow).toHaveBeenCalledWith(accepted);

        client.clear.mockRejectedValueOnce(new Error('offline'));
        client.startImport.mockClear();
        await expect(backend.clearEpgData()).resolves.toEqual({
            success: false,
        });
        expect(client.startImport).not.toHaveBeenCalled();

        await expect(backend.clearEpgDataForSource(STALE)).resolves.toEqual({
            success: true,
        });
        expect(client.clear).toHaveBeenLastCalledWith({ url: STALE });
    });

    it('derives freshness from the last successful import', async () => {
        poller.refresh.mockResolvedValue(
            status([
                source(FRESH, '2026-10-15T08:00:00.000Z'),
                source(STALE, '2026-10-14T06:00:00.000Z'),
            ])
        );

        await expect(
            backend.checkEpgFreshness([FRESH, STALE])
        ).resolves.toEqual({ freshUrls: [FRESH], staleUrls: [STALE] });
        await expect(
            backend.checkEpgFreshness([FRESH, STALE], 2)
        ).resolves.toEqual({ freshUrls: [], staleUrls: [FRESH, STALE] });
    });

    it('saves the changed settings in one request, only after reading them', async () => {
        const listener = jest.fn();
        client.putSettings.mockResolvedValue({
            urls: [STALE],
            refreshTime: '05:30',
        });
        await expect(backend.save({ refreshTime: '05:30' })).resolves.toBeNull();
        expect(client.putSettings).not.toHaveBeenCalled();

        client.getSettings.mockResolvedValue({ urls: [], refreshTime: '04:00' });
        await backend.read();
        await expect(
            backend.save({ urls: [` ${STALE}`, STALE], refreshTime: '05:30' })
        ).resolves.toEqual({ urls: [STALE], refreshTime: '05:30' });
        expect(client.putSettings).toHaveBeenCalledWith({
            urls: [STALE],
            refreshTime: '05:30',
        });
        expect(poller.refresh).toHaveBeenCalled();
        // The saved list is what the following reconciliation compares with.
        await expect(backend.reconcileEpgSources([STALE])).resolves.toEqual({
            success: true,
        });
        expect(client.putSettings).toHaveBeenCalledTimes(1);

        client.putSettings.mockRejectedValue(new Error('offline'));
        await expect(backend.save({ refreshTime: '06:00' })).resolves.toBeNull();

        backend.onEpgProgress(listener);
        expect(poller.onProgress).toHaveBeenCalledWith(listener);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=server-epg-backend`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`server-epg-backend.ts`:

```ts
import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type {
    ElectronBridgeCurrentProgramsOptions,
    ElectronBridgeEpgFetchResult,
    ElectronBridgeEpgFreshnessResult,
    ElectronBridgeEpgGuideWindow,
    ElectronBridgeEpgLookupOptions,
    ElectronBridgeEpgProgress,
    ElectronBridgeEpgSearchProgram,
    ElectronBridgeResult,
    EpgChannelMetadata,
    EpgProgram,
    EpgRuntimeBackend,
    ServerEpgSettings,
    ServerEpgSettingsUpdate,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import {
    SHARED_EPG_FRESH_HOURS,
    type SharedEpgSettings,
} from '../shared-epg-settings';
import { ServerEpgClient } from './server-epg-client';
import { splitByFreshness } from './server-epg-progress';
import { ServerEpgStatusPoller } from './server-epg-status-poller';

const DEFAULT_FRESHNESS_HOURS = 12;
const NO_VALID_URLS = 'No valid URLs provided';

/** The bridge methods a server implements; file picker and mapping stay absent. */
export type ServerEpgBridge = Required<
    Pick<
        EpgRuntimeBackend,
        | 'fetchEpg'
        | 'forceFetchEpg'
        | 'clearEpgData'
        | 'clearEpgDataForSource'
        | 'reconcileEpgSources'
        | 'getChannelPrograms'
        | 'getCurrentProgramsBatch'
        | 'getEpgChannelMetadata'
        | 'checkEpgFreshness'
        | 'getEpgProgramsForChannels'
        | 'getEpgProgramCoverage'
        | 'searchEpgPrograms'
        | 'onEpgProgress'
    >
>;

function sameUrls(a: readonly string[], b: readonly string[]): boolean {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/**
 * The renderer's EPG backend in server mode (`EPG_RUNTIME_BACKEND`), and the
 * shared list and refresh time (`SHARED_EPG_SETTINGS`). Reads that fail
 * answer "no data" in the shape the caller expects: no throw, no snackbar.
 */
@Injectable({ providedIn: 'root' })
export class ServerEpgBackend implements ServerEpgBridge, SharedEpgSettings {
    private readonly client = inject(ServerEpgClient);
    private readonly poller = inject(ServerEpgStatusPoller);
    private readonly translate = inject(TranslateService);
    /** The server's list as last read or saved; null until a read succeeded. */
    private knownUrls: readonly string[] | null = null;
    /** Counts list saves, so a read they overtook is dropped. */
    private settingsWrites = 0;

    async read(): Promise<ServerEpgSettings | null> {
        const writes = this.settingsWrites;
        try {
            const settings = await this.client.getSettings();
            if (writes !== this.settingsWrites) {
                return null;
            }
            this.knownUrls = [...settings.urls];
            return settings;
        } catch {
            return null;
        }
    }

    /**
     * Settings → Save: the changed list and refresh time ("HH:MM", server
     * time zone) in one `PUT`. Refused, like a reconciliation, until this
     * page read the settings once.
     */
    async save(
        update: ServerEpgSettingsUpdate
    ): Promise<ServerEpgSettings | null> {
        if (this.knownUrls === null) {
            return null;
        }
        this.settingsWrites += 1;
        try {
            const saved = await this.client.putSettings(
                update.urls
                    ? { ...update, urls: normalizeEpgUrls(update.urls) }
                    : update
            );
            this.knownUrls = [...saved.urls];
            void this.poller.refresh();
            return saved;
        } catch {
            return null;
        }
    }

    /**
     * Commits the shared list (`PUT /v1/epg/settings`). Refused until this
     * page read the list once: a list it never saw must not replace the
     * server's. An unchanged list sends nothing.
     */
    async reconcileEpgSources(urls: string[]): Promise<ElectronBridgeResult> {
        const known = this.knownUrls;
        if (known === null) {
            return { success: false };
        }
        const next = normalizeEpgUrls(urls);
        if (sameUrls(next, known)) {
            return { success: true };
        }
        this.settingsWrites += 1;
        try {
            const saved = await this.client.putSettings({ urls: next });
            this.knownUrls = [...saved.urls];
            void this.poller.refresh();
            return { success: true };
        } catch {
            return { success: false };
        }
    }

    /**
     * As on the desktop, resolves once the imports finished, so callers
     * clear their caches when the data is there. Sources imported within
     * 24 h and URLs the server does not own are skipped, and so is
     * everything while the server does not answer: it imports on its own
     * schedule.
     */
    async fetchEpg(urls: string[]): Promise<ElectronBridgeEpgFetchResult> {
        const requested = normalizeEpgUrls(urls);
        if (requested.length === 0) {
            return { success: false, message: NO_VALID_URLS };
        }
        const current = await this.poller.refresh();
        if (!current) {
            return { success: true, skipped: requested };
        }
        const { staleUrls, freshUrls } = splitByFreshness(
            current,
            requested,
            SHARED_EPG_FRESH_HOURS,
            Date.now()
        );
        const owned = new Set(current.sources.map((source) => source.url));
        const stale = staleUrls.filter((url) => owned.has(url));
        if (stale.length < staleUrls.length) {
            // Likely a playlist saved a moment ago: the server queues its
            // sources itself once its registry settles.
            this.poller.pollSoon();
        }
        return stale.length === 0
            ? { success: true, skipped: freshUrls }
            : this.importAndWait(stale, false, freshUrls);
    }

    async forceFetchEpg(url: string): Promise<ElectronBridgeEpgFetchResult> {
        const source = url.trim();
        return source
            ? this.importAndWait([source], true, [])
            : { success: false, message: NO_VALID_URLS };
    }

    /**
     * Clears the data of every device, then imports every source again; the
     * import panel shows those imports as started on this page.
     */
    async clearEpgData(): Promise<ElectronBridgeResult> {
        if (!(await this.attempt(() => this.client.clear({})))) {
            return { success: false };
        }
        try {
            this.poller.follow(
                await this.client.startImport({ force: true })
            );
        } catch {
            // The nightly run imports them; the clear itself succeeded.
            void this.poller.refresh();
        }
        return { success: true };
    }

    async clearEpgDataForSource(sourceUrl: string): Promise<ElectronBridgeResult> {
        const success = await this.attempt(() =>
            this.client.clear({ url: sourceUrl })
        );
        if (success) {
            void this.poller.refresh();
        }
        return { success };
    }

    async checkEpgFreshness(
        urls: string[],
        maxAgeHours = DEFAULT_FRESHNESS_HOURS
    ): Promise<ElectronBridgeEpgFreshnessResult> {
        const current = await this.poller.refresh();
        return current
            ? splitByFreshness(current, urls, maxAgeHours, Date.now())
            : { staleUrls: [], freshUrls: [] };
    }

    getChannelPrograms(
        channelId: string,
        options?: ElectronBridgeEpgLookupOptions
    ): Promise<EpgProgram[]> {
        return this.orEmpty(
            () => this.client.channelPrograms(channelId, options?.sourceUrls),
            []
        );
    }

    getCurrentProgramsBatch(
        channelIds: string[],
        options?: ElectronBridgeCurrentProgramsOptions
    ): Promise<Record<string, EpgProgram | null>> {
        return this.orEmpty(
            () =>
                this.client.current(
                    channelIds,
                    options?.sourceUrls,
                    options?.nowMs
                ),
            {}
        );
    }

    getEpgChannelMetadata(
        channelIds: string[],
        options?: ElectronBridgeEpgLookupOptions
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        return this.orEmpty(
            () => this.client.metadata(channelIds, options?.sourceUrls),
            {}
        );
    }

    getEpgProgramsForChannels(
        guideWindow: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]>> {
        return this.orEmpty(() => this.client.window(guideWindow), {});
    }

    getEpgProgramCoverage(
        guideWindow: ElectronBridgeEpgGuideWindow
    ): Promise<string[]> {
        return this.orEmpty(() => this.client.coverage(guideWindow), []);
    }

    searchEpgPrograms(
        searchTerm: string,
        limit?: number
    ): Promise<ElectronBridgeEpgSearchProgram[]> {
        return this.orEmpty(() => this.client.search(searchTerm, limit), []);
    }

    onEpgProgress(callback: (data: ElectronBridgeEpgProgress) => void): void {
        this.poller.onProgress(callback);
    }

    private async importAndWait(
        urls: string[],
        force: boolean,
        skipped: string[]
    ): Promise<ElectronBridgeEpgFetchResult> {
        let accepted: ServerEpgStatus;
        try {
            accepted = await this.client.startImport({ urls, force });
        } catch {
            return {
                success: false,
                message: this.translate.instant('SERVER_EPG.UNREACHABLE'),
                skipped,
            };
        }
        const settled = await this.poller.settle(urls, accepted);
        const errors = settled.flatMap((event) => {
            if (event.status === 'error') {
                return [event.error ?? ''];
            }
            return event.status === 'cancelled'
                ? [this.translate.instant('SERVER_EPG.NOT_IMPORTED')]
                : [];
        });
        return errors.length === 0
            ? { success: true, skipped }
            : {
                  success: errors.length < urls.length,
                  message: errors.join('; '),
                  skipped,
              };
    }

    private async orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
        try {
            return await read();
        } catch {
            return empty;
        }
    }

    private async attempt(work: () => Promise<unknown>): Promise<boolean> {
        try {
            await work();
            return true;
        } catch {
            return false;
        }
    }
}
```

Append to `libs/services/src/lib/server-storage/index.ts`:

```ts
export * from './server-epg-backend';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test services --testPathPatterns=server-epg-backend`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/server-storage/server-epg-backend.ts libs/services/src/lib/server-storage/server-epg-backend.spec.ts libs/services/src/lib/server-storage/index.ts
git commit -m "feat(services): EPG runtime backend for the self-hosted server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Providers

**Files:**
- Create: `libs/services/src/lib/server-storage/server-epg.providers.ts`
- Test: `libs/services/src/lib/server-storage/server-epg.providers.spec.ts`
- Modify: `libs/services/src/lib/server-storage/index.ts`
- Modify: `apps/web/src/app/server-storage/server-storage.providers.ts`
- Test: `apps/web/src/app/server-storage/server-storage.providers.spec.ts` (create)

- [ ] **Step 1: Write the failing specs**

`libs/services/src/lib/server-storage/server-epg.providers.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { EPG_RUNTIME_BACKEND } from '../epg-runtime-backend.token';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SHARED_EPG_SETTINGS } from '../shared-epg-settings';
import { ServerEpgBackend } from './server-epg-backend';
import { provideServerEpg } from './server-epg.providers';

describe('provideServerEpg', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('turns the XMLTV flags on, without the file picker and mapping', () => {
        TestBed.configureTestingModule({
            providers: [
                provideServerEpg(),
                // The class's methods only: flags test their presence.
                {
                    provide: ServerEpgBackend,
                    useValue: Object.create(ServerEpgBackend.prototype),
                },
            ],
        });
        const runtime = TestBed.inject(RuntimeCapabilitiesService);

        expect(runtime.isElectron).toBe(false);
        expect(runtime.supportsEpg).toBe(true);
        expect(runtime.supportsEpgProgress).toBe(true);
        expect(runtime.supportsEpgCurrentProgramBatch).toBe(true);
        expect(runtime.supportsEpgChannelMetadata).toBe(true);
        expect(runtime.supportsEpgDataManagement).toBe(true);
        expect(runtime.supportsEpgFilePicker).toBe(false);
        expect(runtime.supportsEpgMapping).toBe(false);
    });

    it('creates the backend on first use and shares it with the settings', async () => {
        const settings = {
            urls: ['https://epg.example/a.xml'],
            refreshTime: '04:00',
        };
        const backend = {
            read: jest.fn().mockResolvedValue(settings),
            save: jest.fn().mockResolvedValue(settings),
        };
        const factory = jest.fn(() => backend);
        TestBed.configureTestingModule({
            providers: [
                provideServerEpg(),
                { provide: ServerEpgBackend, useFactory: factory },
            ],
        });

        const resolve = TestBed.inject(EPG_RUNTIME_BACKEND);
        const shared = TestBed.inject(SHARED_EPG_SETTINGS);
        expect(factory).not.toHaveBeenCalled();

        expect(resolve()).toBe(backend);
        await expect(shared.read()).resolves.toBe(settings);
        await expect(shared.save({ refreshTime: '04:00' })).resolves.toBe(
            settings
        );
        expect(backend.save).toHaveBeenCalledWith({ refreshTime: '04:00' });
        expect(factory).toHaveBeenCalledTimes(1);
    });
});
```

`apps/web/src/app/server-storage/server-storage.providers.spec.ts`:

```ts
import { EPG_RUNTIME_BACKEND, SHARED_EPG_SETTINGS } from '@iptvnator/services';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import { provideServerStorage } from './server-storage.providers';

const instance: ServerInstanceInfo = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

function provides(providers: unknown[], token: unknown): boolean {
    return providers.some(
        (provider) =>
            (provider as { provide?: unknown } | null)?.provide === token
    );
}

describe('provideServerStorage', () => {
    it('installs the server EPG backend only for an instance with features.epg', () => {
        const withEpg = provideServerStorage(
            {
                instance: { ...instance, features: { epg: true } },
                startedOffline: true,
            },
            '/api'
        );
        const without = provideServerStorage(
            { instance, startedOffline: false },
            '/api'
        );
        const off = provideServerStorage(
            {
                instance: { ...instance, features: { epg: false } },
                startedOffline: false,
            },
            '/api'
        );

        expect(provides(withEpg, EPG_RUNTIME_BACKEND)).toBe(true);
        expect(provides(withEpg, SHARED_EPG_SETTINGS)).toBe(true);
        for (const providers of [without, off]) {
            expect(provides(providers, EPG_RUNTIME_BACKEND)).toBe(false);
            expect(provides(providers, SHARED_EPG_SETTINGS)).toBe(false);
        }
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm nx test services --testPathPatterns=server-epg.providers
pnpm nx test web --testPathPatterns=server-storage.providers
```

Expected: FAIL, `./server-epg.providers` not found; the web spec fails because no provider for `EPG_RUNTIME_BACKEND` is returned.

- [ ] **Step 3: Implement**

`server-epg.providers.ts`:

```ts
import { inject, Injector, type Provider } from '@angular/core';
import { EPG_RUNTIME_BACKEND } from '../epg-runtime-backend.token';
import {
    SHARED_EPG_SETTINGS,
    type SharedEpgSettings,
} from '../shared-epg-settings';
import { ServerEpgBackend } from './server-epg-backend';

/**
 * Server EPG for an instance that reports `features.epg`: the renderer's
 * EPG backend and the shared EPG settings. Both create the backend on first
 * use, never while providers are being resolved: capability flags are read
 * while the storage session itself is still being constructed.
 */
export function provideServerEpg(): Provider[] {
    return [
        {
            provide: EPG_RUNTIME_BACKEND,
            useFactory: () => {
                const injector = inject(Injector);
                let backend: ServerEpgBackend | undefined;
                return () => (backend ??= injector.get(ServerEpgBackend));
            },
        },
        {
            provide: SHARED_EPG_SETTINGS,
            useFactory: (): SharedEpgSettings => {
                const injector = inject(Injector);
                const backend = () => injector.get(ServerEpgBackend);
                return {
                    read: () => backend().read(),
                    save: (update) => backend().save(update),
                };
            },
        },
    ];
}
```

Append to `libs/services/src/lib/server-storage/index.ts`:

```ts
export * from './server-epg.providers';
```

In `apps/web/src/app/server-storage/server-storage.providers.ts`, replace

```ts
import {
    SERVER_STORAGE_CONFIG,
    ServerAccessTokenInterceptor,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
```

with

```ts
import {
    provideServerEpg,
    SERVER_STORAGE_CONFIG,
    ServerAccessTokenInterceptor,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
```

and replace

```ts
        provideAppInitializer(() => inject(ServerStorageSession).start()),
        provideAppInitializer(() => inject(ServerMigrationPrompt).schedule()),
    ];
```

with

```ts
        provideAppInitializer(() => inject(ServerStorageSession).start()),
        provideAppInitializer(() => inject(ServerMigrationPrompt).schedule()),
        // XMLTV from the server, only where the instance imports it; also
        // for a start from memory, which carries the remembered features.
        ...(start.instance.features?.epg ? provideServerEpg() : []),
    ];
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test services --testPathPatterns=server-epg.providers
pnpm nx test web --testPathPatterns=server-storage.providers
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/server-storage/server-epg.providers.ts libs/services/src/lib/server-storage/server-epg.providers.spec.ts libs/services/src/lib/server-storage/index.ts apps/web/src/app/server-storage/server-storage.providers.ts apps/web/src/app/server-storage/server-storage.providers.spec.ts
git commit -m "feat(self-hosted): provide the server EPG backend with features.epg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `SettingsStore` loads the server settings

**Files:**
- Modify: `libs/services/src/lib/settings-store.service.ts:1-4`, `:52`, `:66-68`, `:109-116`, `:192-193`, `:340-344`
- Test: `libs/services/src/lib/settings-store.shared-epg.spec.ts` (create)

The store keeps the server's refresh time next to `epgUrl` (`sharedEpgRefreshTime`, not persisted on the device: `getSettings()` lists the persisted fields explicitly) so Settings → EPG can show and diff it, and it sends Settings → Save's server fields (Task 14).

- [ ] **Step 1: Write the failing spec**

```ts
import { Injector } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { EPG_RUNTIME_BACKEND } from './epg-runtime-backend.token';
import { EpgSourceSettingsService } from './epg-source-settings.service';
import { SettingsStore } from './settings-store.service';
import {
    SHARED_EPG_SETTINGS,
    SHARED_EPG_SETTINGS_WAIT_MS,
} from './shared-epg-settings';

const SERVER_LIST = ['https://server.example/guide.xml'];
const DEVICE_LIST = ['https://device.example/old.xml'];

describe('SettingsStore with the server EPG settings', () => {
    let read: jest.Mock;
    let save: jest.Mock;
    let synchronize: jest.SpyInstance;
    let injector: Injector;

    beforeEach(() => {
        read = jest
            .fn()
            .mockResolvedValue({ urls: SERVER_LIST, refreshTime: '04:00' });
        save = jest.fn();
        injector = Injector.create({
            providers: [
                SettingsStore,
                EpgSourceSettingsService,
                // `Injector.create` has no root scope (see the 3b-1 specs).
                { provide: EPG_RUNTIME_BACKEND, useValue: () => undefined },
                {
                    provide: StorageMap,
                    useValue: {
                        get: jest.fn(() => of({ epgUrl: DEVICE_LIST })),
                        set: jest.fn(() => of(undefined)),
                    },
                },
                { provide: SHARED_EPG_SETTINGS, useValue: { read, save } },
            ],
        });
        synchronize = jest
            .spyOn(injector.get(EpgSourceSettingsService), 'synchronize')
            .mockResolvedValue(undefined);
    });

    afterEach(() => jest.useRealTimers());

    it('loads the server list and refresh time instead of the device copy', async () => {
        const store = injector.get(SettingsStore);
        await store.loadSettings();

        expect(store.epgUrl()).toEqual(SERVER_LIST);
        expect(store.sharedEpgRefreshTime()).toBe('04:00');
        expect(synchronize).toHaveBeenCalledWith(SERVER_LIST);
        expect(synchronize).not.toHaveBeenCalledWith(DEVICE_LIST);
    });

    it('starts without global sources while the server does not answer', async () => {
        read.mockResolvedValue(null);
        const store = injector.get(SettingsStore);
        await store.loadSettings();

        expect(store.epgUrl()).toEqual([]);
        expect(store.sharedEpgRefreshTime()).toBeNull();
        expect(synchronize).not.toHaveBeenCalled();
    });

    it('waits for a slow server only briefly and applies its answer later', async () => {
        jest.useFakeTimers();
        let answer!: (settings: { urls: string[]; refreshTime: string }) => void;
        read.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const store = injector.get(SettingsStore);
        const loading = store.loadSettings();

        await jest.advanceTimersByTimeAsync(SHARED_EPG_SETTINGS_WAIT_MS);
        await loading;
        expect(store.epgUrl()).toEqual([]);

        answer({ urls: SERVER_LIST, refreshTime: '04:00' });
        await jest.advanceTimersByTimeAsync(0);
        expect(store.epgUrl()).toEqual(SERVER_LIST);
    });

    it('reads the settings again when the tab is shown and applies only a changed list', async () => {
        const store = injector.get(SettingsStore);
        await store.loadSettings();
        synchronize.mockClear();

        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        await Promise.resolve();
        expect(read).toHaveBeenCalledTimes(2);
        expect(synchronize).not.toHaveBeenCalled();

        const changed = [...SERVER_LIST, 'https://other.example/guide.xml'];
        read.mockResolvedValue({ urls: changed, refreshTime: '05:00' });
        await store.reloadSharedEpgSettings();

        expect(store.epgUrl()).toEqual(changed);
        expect(store.sharedEpgRefreshTime()).toBe('05:00');
        expect(synchronize).toHaveBeenCalledWith(changed);
    });

    it('saves changed server settings in one request and keeps the saved time', async () => {
        const store = injector.get(SettingsStore);
        await store.loadSettings();
        save.mockResolvedValue({ urls: SERVER_LIST, refreshTime: '05:30' });

        await expect(
            store.saveSharedEpgSettings({ refreshTime: '05:30' })
        ).resolves.toBe(true);
        expect(save).toHaveBeenCalledWith({ refreshTime: '05:30' });
        expect(store.sharedEpgRefreshTime()).toBe('05:30');

        save.mockResolvedValue(null);
        await expect(
            store.saveSharedEpgSettings({ refreshTime: '06:00' })
        ).resolves.toBe(false);
        expect(store.sharedEpgRefreshTime()).toBe('05:30');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test services --testPathPatterns=settings-store`
Expected: the new spec FAILS (the device list is loaded; `sharedEpgRefreshTime`, `reloadSharedEpgSettings` and `saveSharedEpgSettings` do not exist); the existing `settings-store.service.spec.ts` and `settings-store.embedded-mpv.spec.ts` pass.

- [ ] **Step 3: Implement**

In `settings-store.service.ts`, replace

```ts
import {
    EpgSourceSettingsService,
    epgSourceUrlsChanged,
} from './epg-source-settings.service';
```

with

```ts
import {
    EpgSourceSettingsService,
    epgSourceUrlsChanged,
} from './epg-source-settings.service';
import {
    loadSharedEpgSettings,
    SHARED_EPG_SETTINGS,
    SHARED_EPG_SETTINGS_WAIT_MS,
    waitAtMost,
} from './shared-epg-settings';
```

add `ServerEpgSettingsUpdate,` to the `@iptvnator/shared/interfaces` import (after `normalizeStartupWindowMode,`), and replace

```ts
    withState<SettingsStorageState>({ storageFailure: null }),
```

with

```ts
    withState<SettingsStorageState>({ storageFailure: null }),
    // Server mode: the server's daily EPG refresh time ("HH:MM"); null
    // elsewhere and while it could not be read. Not stored on the device.
    withState<{ sharedEpgRefreshTime: string | null }>({
        sharedEpgRefreshTime: null,
    }),
```

Replace

```ts
    withMethods((store, storage = inject(StorageMap)) => {
        const epgSources = inject(EpgSourceSettingsService);
        let settingsLoadPromise: Promise<void> | undefined;
```

with

```ts
    withMethods((store, storage = inject(StorageMap)) => {
        const epgSources = inject(EpgSourceSettingsService);
        // Server mode with server EPG: the list and refresh time are the server's.
        const sharedEpg = inject(SHARED_EPG_SETTINGS, { optional: true });
        let settingsLoadPromise: Promise<void> | undefined;
```

Replace

```ts
                    await epgSources
                        .synchronize(this.getSettings().epgUrl)
                        .catch((error) => {
```

with

```ts
                    if (sharedEpg) {
                        // This device's copy is not used. A slow server's
                        // answer still lands, after the wait.
                        patchState(store, { epgUrl: [] });
                        await waitAtMost(
                            this.reloadSharedEpgSettings(true),
                            SHARED_EPG_SETTINGS_WAIT_MS
                        );
                        return;
                    }
                    await epgSources
                        .synchronize(this.getSettings().epgUrl)
                        .catch((error) => {
```

Between the end of `updateSettings` and `getSettings`, replace

```ts
            },

            getSettings() {
```

with

```ts
            },

            /**
             * Server mode: reads the shared list and refresh time (at start,
             * when the tab is shown again, when Settings opens). Elsewhere a
             * no-op.
             */
            reloadSharedEpgSettings(initial = false): Promise<void> {
                if (!sharedEpg) {
                    return Promise.resolve();
                }
                return loadSharedEpgSettings(
                    sharedEpg,
                    {
                        current: () => store.epgUrl(),
                        apply: (urls) => patchState(store, { epgUrl: urls }),
                        applyRefreshTime: (refreshTime) =>
                            patchState(store, {
                                sharedEpgRefreshTime: refreshTime,
                            }),
                        synchronize: (urls) => epgSources.synchronize(urls),
                    },
                    initial
                );
            },

            /**
             * Server mode, Settings → Save: the changed list and refresh
             * time in one `PUT`. False when the server did not take them.
             */
            async saveSharedEpgSettings(
                update: ServerEpgSettingsUpdate
            ): Promise<boolean> {
                const saved = await sharedEpg?.save(update);
                if (!saved) {
                    return false;
                }
                patchState(store, { sharedEpgRefreshTime: saved.refreshTime });
                return true;
            },

            getSettings() {
```

Replace

```ts
    withHooks({
        onInit(store) {
            store.loadSettings();
        },
    })
```

with

```ts
    withHooks({
        onInit(store) {
            store.loadSettings();
            // Server mode: another device may have changed the shared settings.
            if (inject(SHARED_EPG_SETTINGS, { optional: true })) {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        void store.reloadSharedEpgSettings();
                    }
                });
            }
        },
    })
```

`reconcileEpgSources` of the server backend sends nothing for the list it just read, so the start-up reconciliation costs no write.

- [ ] **Step 4: Run to verify it passes, and the line budget**

```bash
pnpm nx test services --testPathPatterns=settings-store
pnpm nx lint services
```

Expected: PASS; lint reports no `max-lines` error (the store stays under 400 counted lines; the loading logic lives in `shared-epg-settings.ts`).

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/settings-store.service.ts libs/services/src/lib/settings-store.shared-epg.spec.ts
git commit -m "feat(services): load and save the shared EPG settings in server mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Caches follow imported data

**Files:**
- Modify: `libs/epg/data-access/src/lib/epg.service.ts:12`, `:35-49`, `:150-151`
- Test: `libs/epg/data-access/src/lib/epg.service.data-changes.spec.ts` (create)
- Modify: `libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts:1`, `:41-80`, `:105-106`, before `:204`
- Test: `libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.spec.ts`

The caches that hold imported programmes: `EpgProgramCache` (60 s "now" answers, behind every channel-list row, dashboard rail and Xtream fallback lookup), the player's schedule (`EpgService.currentEpgPrograms`), the channel list's row and icon maps (refreshed through `epgAvailable$`) and the guide's per-day programmes and coverage (`EpgGuideProgramsService`). Channel metadata has no cache of its own (`EpgChannelMetadataLookup` reads through). `EpgDataChangesService.notify()` reaches all of them through the two consumers below.

- [ ] **Step 1: Write the failing specs**

`epg.service.data-changes.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    EpgDataChangesService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { EpgService } from './epg.service';

describe('EpgService when imported data changes', () => {
    let getChannelPrograms: jest.Mock;
    let service: EpgService;

    beforeEach(() => {
        getChannelPrograms = jest.fn().mockResolvedValue([]);
        TestBed.configureTestingModule({
            providers: [
                EpgService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        supportsProgramLookup: true,
                        getChannelPrograms,
                    },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        loadSettings: jest.fn().mockResolvedValue(undefined),
                        getSettings: () => ({ epgUrl: [] }),
                        getTrustOptions: () => ({}),
                        resolvedEpgOffsetMinutes: () => 0,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists: () => of([]) },
                },
            ],
        });
        service = TestBed.inject(EpgService);
    });

    it('drops the cache, refreshes rows and reloads the shown schedule', () => {
        const clearCache = jest.spyOn(service, 'clearCache');
        const availability: boolean[] = [];
        service.epgAvailable$.subscribe((value) => availability.push(value));
        service.getChannelPrograms('news');

        TestBed.inject(EpgDataChangesService).notify();

        expect(clearCache).toHaveBeenCalledTimes(1);
        expect(availability.at(-1)).toBe(true);
        expect(getChannelPrograms).toHaveBeenCalledTimes(2);
        expect(getChannelPrograms).toHaveBeenLastCalledWith('news');
    });

    it('loads no schedule when none is shown', () => {
        TestBed.inject(EpgDataChangesService).notify();

        expect(getChannelPrograms).not.toHaveBeenCalled();
    });
});
```

Append inside `describe('EpgGuideProgramsService', …)` in `epg-guide-programs.service.spec.ts` (add `import { EpgDataChangesService } from '@iptvnator/services';` to its imports):

```ts
    it('reloads coverage and the visible rows when imported data changes', async () => {
        loadPrograms.mockResolvedValue(new Map([['a', [programFor('a')]]]));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.programsFor('a')).toHaveLength(1);
        loadPrograms.mockClear();
        loadCoverage.mockClear();
        loadPrograms.mockResolvedValue(
            new Map([['a', [programFor('a'), programFor('a')]]])
        );

        TestBed.inject(EpgDataChangesService).notify();
        TestBed.flushEffects();
        await flush();

        expect(loadCoverage).toHaveBeenCalledTimes(1);
        expect(loadPrograms).toHaveBeenCalledTimes(1);
        expect(service.programsFor('a')).toHaveLength(2);
    });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm nx test epg-data-access --testPathPatterns=epg.service.data-changes
pnpm nx test ui-epg --testPathPatterns=epg-guide-programs
```

Expected: both new tests FAIL (nothing listens to `EpgDataChangesService`).

- [ ] **Step 3: Implement**

In `epg.service.ts`, replace

```ts
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';
```

with

```ts
import {
    EpgDataChangesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';
```

Replace

```ts
    private readonly sourceSettings = inject(EpgSourceSettingsService);

    constructor() {
        this.sourceSettings.changed$.subscribe(() => {
            this.clearCache();
            this.currentEpgPrograms.next([]);
            this.epgAvailable.next(true);
        });
    }
```

with

```ts
    private readonly sourceSettings = inject(EpgSourceSettingsService);
    /** Channel whose schedule the player shows (`getChannelPrograms`). */
    private programsChannelId: string | null = null;

    constructor() {
        this.sourceSettings.changed$.subscribe(() => {
            this.clearCache();
            this.currentEpgPrograms.next([]);
            this.epgAvailable.next(true);
        });
        // New programmes without a settings edit (a server import finished):
        // read again instead of blanking what is on screen.
        inject(EpgDataChangesService).changed$.subscribe(() => {
            this.clearCache();
            this.epgAvailable.next(true);
            if (this.programsChannelId) {
                this.getChannelPrograms(this.programsChannelId);
            }
        });
    }
```

Replace

```ts
    getChannelPrograms(channelId: string): void {
        if (!this.epgBridge.supportsProgramLookup) return;
```

with

```ts
    getChannelPrograms(channelId: string): void {
        if (!this.epgBridge.supportsProgramLookup) return;
        this.programsChannelId = channelId;
```

In `epg-guide-programs.service.ts`, replace

```ts
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { createDevLogger, EpgProgram } from '@iptvnator/shared/interfaces';
```

with

```ts
import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import { EpgDataChangesService } from '@iptvnator/services';
import { createDevLogger, EpgProgram } from '@iptvnator/shared/interfaces';
```

Replace

```ts
    /** Last channel reference seen by the constructor effect (see below). */
    private seenChannels: readonly EpgGuideChannel[] | null = null;
```

with

```ts
    /** Last channel reference seen by the constructor effect (see below). */
    private seenChannels: readonly EpgGuideChannel[] | null = null;
    /** Rows the viewport last asked for; reloaded after a data change. */
    private lastRequested: readonly EpgGuideChannel[] = [];
```

At the end of the constructor, after the existing `effect(() => { … });` block, add

```ts
        // Imported programmes changed (a server import finished): the loaded
        // days and the coverage are stale, the visible rows load again.
        const dataChanges = inject(EpgDataChangesService);
        let seenRevision = dataChanges.revision();
        effect(() => {
            const revision = dataChanges.revision();
            if (revision === seenRevision) {
                return;
            }
            seenRevision = revision;
            untracked(() => this.reload());
        });
```

Replace

```ts
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        const range = this.range;
```

with

```ts
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        this.lastRequested = channels;
        const range = this.range;
```

and add before `private invalidate(): void {`:

```ts
    private reload(): void {
        this.invalidate();
        this.requestCoverage();
        this.ensureLoaded(this.lastRequested);
    }

```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test epg-data-access
pnpm nx test ui-epg --testPathPatterns=epg-guide
```

Expected: PASS, including the existing `epg.service.spec.ts` (the real `EpgDataChangesService` is root-provided and never notifies there) and the guide component spec.

- [ ] **Step 5: Commit**

```bash
git add libs/epg/data-access/src/lib/epg.service.ts libs/epg/data-access/src/lib/epg.service.data-changes.spec.ts libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.spec.ts
git commit -m "feat(epg): read programmes again when imported EPG data changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Channel list reads the store; startup import left to the server

**Files:**
- Modify: `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:20`, `:59-60`, `:121`, `:148-149`, `:477-492`
- Test: `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.spec.ts`
- Modify: `apps/web/src/app/app.component.ts:28-34`, `:82`, `:181-188`
- Test: `apps/web/src/app/app.component.spec.ts`

`channel-list-container.component.ts` is in the max-lines baseline: this change removes lines only.

- [ ] **Step 1: Update the channel-list spec to the store and add the failing test**

In `channel-list-container.component.spec.ts`:

1. Delete `import { StorageMap } from '@ngx-pwa/local-storage';`.
2. Replace `    let storageGet: jest.Mock;` with `    let settingsEpgUrl: ReturnType<typeof signal<string[]>>;`.
3. Replace `        storageGet = jest.fn().mockReturnValue(of({}));` with `        settingsEpgUrl = signal<string[]>([]);`.
4. Replace the `SettingsStore` and `StorageMap` providers

```ts
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: StorageMap,
                    useValue: {
                        get: storageGet,
                    },
                },
```

with

```ts
                {
                    provide: SettingsStore,
                    useValue: {
                        epgUrl: settingsEpgUrl,
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
```

5. In "does not enable EPG rows when runtime EPG support is unavailable", replace

```ts
        storageGet.mockReturnValue(
            of({ epgUrl: ['https://example.com/epg.xml'] })
        );

        fixture.detectChanges();

        expect(fixture.componentInstance.shouldShowEpg()).toBe(false);
        expect(fixture.componentInstance.itemSize()).toBe(52);
        expect(storageGet).not.toHaveBeenCalled();
```

with

```ts
        settingsEpgUrl.set(['https://example.com/epg.xml']);

        fixture.detectChanges();

        expect(fixture.componentInstance.shouldShowEpg()).toBe(false);
        expect(fixture.componentInstance.itemSize()).toBe(52);
```

6. In "enables EPG rows when runtime EPG support and an EPG URL are available", replace

```ts
        storageGet.mockReturnValue(
            of({ epgUrl: ['https://example.com/epg.xml'] })
        );

        fixture.detectChanges();

        expect(storageGet).toHaveBeenCalled();
        expect(fixture.componentInstance.shouldShowEpg()).toBe(true);
```

with

```ts
        settingsEpgUrl.set(['https://example.com/epg.xml']);

        fixture.detectChanges();

        expect(fixture.componentInstance.shouldShowEpg()).toBe(true);
```

7. Replace both occurrences of `        storageGet.mockReturnValue(of({ epgUrl: [] }));` with `        settingsEpgUrl.set([]);`.
8. In "drops a superseded EPG refresh that completes after the newer one", replace

```ts
        storageGet.mockReturnValue(
            of({ epgUrl: ['https://global.example.com/guide.xml'] })
        );
```

with

```ts
        settingsEpgUrl.set(['https://global.example.com/guide.xml']);
```

9. Add after the "enables EPG rows when runtime EPG support and an EPG URL are available" test:

```ts
    it('follows global EPG sources the settings store loads later (server mode)', () => {
        runtimeCapabilities.supportsEpg = true;
        fixture.detectChanges();
        expect(fixture.componentInstance.shouldShowEpg()).toBe(false);

        settingsEpgUrl.set(['https://server.example/guide.xml']);
        fixture.detectChanges();

        expect(fixture.componentInstance.shouldShowEpg()).toBe(true);
        expect(fixture.componentInstance.itemSize()).toBe(68);
    });
```

In `app.component.spec.ts`, add `ServerStorageStatusService` to the `@iptvnator/services` import and append inside `describe('AppComponent', …)`:

```ts
    it('leaves the startup import to a server that imports EPG itself', async () => {
        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i-1',
                storage: 'server',
                auth: 'none',
                features: { epg: true },
            },
            jest.fn()
        );
        settingsService.getValueFromLocalStorage.mockReturnValue(
            of({ ...DEFAULT_SETTINGS, epgUrl: ['https://example.com/epg.xml'] })
        );

        component.initSettings();
        await fixture.whenStable();

        expect(epgBridge.checkFreshness).not.toHaveBeenCalled();
        expect(epgService.fetchEpg).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm nx test components --testPathPatterns=channel-list-container.component
pnpm nx test web --testPathPatterns=app.component
```

Expected: the channel-list EPG tests FAIL (the component still reads `StorageMap`, which is no longer provided: `NullInjectorError: No provider for StorageMap`); the new app test FAILS (`checkFreshness` was called).

- [ ] **Step 3: Implement**

In `channel-list-container.component.ts`:

- Delete `import { StorageMap } from '@ngx-pwa/local-storage';`.
- In the `@iptvnator/shared/interfaces` import, delete the lines `    Settings,` and `    STORE_KEY,`.
- Delete `    private readonly storage = inject(StorageMap);`.
- Replace

```ts
    /** Whether to show EPG data in channel items */
    private readonly globalEpgUrls = signal<string[]>([]);
```

with

```ts
    /**
     * Global XMLTV sources as the settings store holds them: this device's
     * list on the desktop, the server's shared list in server mode.
     */
    private readonly globalEpgUrls = computed(() =>
        this.runtime.supportsEpg
            ? normalizeEpgUrls(this.settingsStore.epgUrl() ?? [])
            : []
    );
```

- Replace

```ts
    ngOnInit(): void {
        // Check if EPG should be shown (only in Electron with configured EPG URL)
        if (this.runtime.supportsEpg) {
            this.storage
                .get(STORE_KEY.Settings)
                .subscribe((settings: unknown) => {
                    if (
                        settings &&
                        Object.keys(settings as Settings).length > 0
                    ) {
                        const epgUrl = (settings as Settings).epgUrl;
                        this.globalEpgUrls.set(normalizeEpgUrls(epgUrl));
                    }
                });
        } else {
            this.globalEpgUrls.set([]);
        }

        this.epgAvailabilitySubscription = this.epgService.epgAvailable$
```

with

```ts
    ngOnInit(): void {
        this.epgAvailabilitySubscription = this.epgService.epgAvailable$
```

In `app.component.ts`, replace

```ts
import {
    DataService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
    EpgSourceSettingsService,
} from '@iptvnator/services';
```

with

```ts
import {
    DataService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    ServerStorageStatusService,
    SettingsStore,
    EpgSourceSettingsService,
} from '@iptvnator/services';
```

replace

```ts
    private readonly epgSources = inject(EpgSourceSettingsService);
```

with

```ts
    private readonly epgSources = inject(EpgSourceSettingsService);
    private readonly serverStatus = inject(ServerStorageStatusService);
```

and replace

```ts
                    // Fetch EPG if URLs are configured (only fetch stale data)
                    if (
                        this.epgBridge.supportsImport &&
                        settings.epgUrl?.length > 0 &&
```

with

```ts
                    // Fetch EPG if URLs are configured (only fetch stale
                    // data). A server with EPG imports on its own schedule
                    // and catches up after it starts.
                    if (
                        this.epgBridge.supportsImport &&
                        !this.serverStatus.epgEnabled() &&
                        settings.epgUrl?.length > 0 &&
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test components --testPathPatterns=channel-list-container.component
pnpm nx test web --testPathPatterns=app.component
pnpm nx lint components
```

Expected: PASS; lint clean (no unused `signal`/`inject` imports: both are still used elsewhere in the component).

- [ ] **Step 5: Commit**

```bash
git add libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts libs/ui/components/src/lib/channel-list-container/channel-list-container.component.spec.ts apps/web/src/app/app.component.ts apps/web/src/app/app.component.spec.ts
git commit -m "fix(m3u): read global EPG sources from the settings store

The channel list read them from device storage, which in server mode
never holds the server's shared list. The startup freshness import is
left to a server that imports EPG itself.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Trust hints and the server's freshness window

**Files:**
- Modify: `libs/epg/data-access/src/lib/epg-progress.service.ts:1-16`, `:63-70`, `:72-80`, `:130-137`
- Test: `libs/epg/data-access/src/lib/epg-progress.service.spec.ts`
- Modify: `libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel-view.component.ts:85-91`, `epg-progress-panel-view.component.html:85-95`
- Test: `libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel.component.spec.ts`
- Modify: `libs/ui/epg/src/lib/epg-source-status/epg-source-status.component.ts:1-20`, `:38-41`, `:73-83`
- Test: `libs/ui/epg/src/lib/epg-source-status/epg-source-status.component.spec.ts`

The status chips on the editable source rows ask `checkFreshness([url], 12)`. A server refreshes every source once a day, so in server mode they use `SHARED_EPG_FRESH_HOURS` (24) instead: a source imported last night is up to date, not "needs refresh". The import panel itself only shows imports started on this page (Task 7).

In server mode the poller's error event carries the hint text (`SERVER_EPG.ERROR_PRIVATE_NETWORK`, `SERVER_EPG.ERROR_TLS`, Task 6) in `error`, and the panel already shows `item.error` when there are no stats. What changes: no trust button, and the trust methods do nothing. Security errors stay sticky in both modes (`isActionableError`): on the desktop they wait for the trust action, on a server for the user to read the hint.

- [ ] **Step 1: Write the failing specs**

In `epg-progress.service.spec.ts`, add `import { signal } from '@angular/core';`, add `ServerStorageStatusService` to the `@iptvnator/services` import, and append inside the describe:

```ts
    it('offers no trust action for a server and keeps its hint on screen', async () => {
        jest.useFakeTimers();
        epgBridge.supportsDataManagement = true;
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ServerStorageStatusService,
                    useValue: { epgEnabled: signal(true) },
                },
            ],
        });
        const service = configureService();
        errorRow();

        expect(service.trustActionsAvailable()).toBe(false);
        await service.trustPrivateNetworkSourceAndRetry(url);
        await service.trustInsecureTlsHostAndRetry(url, 'playlist.local');
        expect(settingsStore.updateSettings).not.toHaveBeenCalled();
        expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();

        jest.advanceTimersByTime(10_000);
        expect(service.isVisible()).toBe(true);
    });

    it('offers the trust actions on the desktop', () => {
        expect(configureService().trustActionsAvailable()).toBe(true);
    });
```

In `epg-progress-panel.component.spec.ts`, add `const trustActionsAvailable = signal(true);` next to the other signals, add `trustActionsAvailable,` to the `EpgProgressService` stub, add `trustActionsAvailable.set(true);` at the start of the first `beforeEach`, and append:

```ts
    it('shows the server hint instead of a trust action', async () => {
        trustActionsAvailable.set(false);
        setImports([
            {
                url: 'http://nas.local/guide.xml',
                status: 'error',
                errorCode: 'epg-private-network-blocked',
                error: 'nas.local is in a private network. Set IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1 on the server to allow it.',
            },
        ]);
        await settle();
        const host = fixture.nativeElement as HTMLElement;

        expect(host.querySelector('.trust-btn')).toBeNull();
        expect(host.querySelector('.error-text')?.textContent).toContain(
            'IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS'
        );
        expect(host.querySelector('.retry-btn')).not.toBeNull();
    });

    it('offers the trust action on the desktop', async () => {
        setImports([
            {
                url: 'http://nas.local/guide.xml',
                status: 'error',
                errorCode: 'epg-private-network-blocked',
            },
        ]);
        await settle();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.trust-btn')
        ).not.toBeNull();
    });
```

In `epg-source-status.component.spec.ts`, add `import { ServerStorageStatusService } from '@iptvnator/services';` and append inside the describe:

```ts
    it('counts a source as fresh for a day on a server, which refreshes daily', async () => {
        const url = 'https://example.com/epg.xml';
        epgBridge.supportsSourceFreshness = true;
        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i-1',
                storage: 'server',
                auth: 'none',
                features: { epg: true },
            },
            jest.fn()
        );
        createComponent(url);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(epgBridge.checkFreshness).toHaveBeenCalledWith([url], 24);
        expect(component.status()).toBe('fresh');
    });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm nx test epg-data-access --testPathPatterns=epg-progress.service
pnpm nx test ui-epg --testPathPatterns="epg-progress-panel|epg-source-status"
```

Expected: FAIL (`trustActionsAvailable is not a function`; the panel still renders `.trust-btn`; the chip asks with `12`).

- [ ] **Step 3: Implement**

In `epg-progress.service.ts`, replace

```ts
import { SettingsStore, EpgSourceSettingsService } from '@iptvnator/services';
```

with

```ts
import {
    EpgSourceSettingsService,
    ServerStorageStatusService,
    SettingsStore,
} from '@iptvnator/services';
```

replace

```ts
    private readonly sources = inject(EpgSourceSettingsService);
```

with

```ts
    private readonly sources = inject(EpgSourceSettingsService);
    private readonly serverStatus = inject(ServerStorageStatusService);
```

add after `readonly isVisible = computed(() => this.imports().length > 0);`

```ts
    /**
     * The desktop can trust a blocked private-network source or an invalid
     * certificate from the panel. A server decides that through its
     * environment, which its error message names; it has no trust action.
     */
    readonly trustActionsAvailable = computed(
        () => !this.serverStatus.epgEnabled()
    );
```

replace the first line of the body of both trust methods,

```ts
        const progress = this.importsMap().get(url);
        if (progress?.status !== 'error') return;
        const settings = this.settingsStore.getSettings();
```

with

```ts
        const progress = this.importsMap().get(url);
        if (progress?.status !== 'error' || !this.trustActionsAvailable())
            return;
        const settings = this.settingsStore.getSettings();
```

(in `trustPrivateNetworkSourceAndRetry`), and

```ts
        const progress = this.importsMap().get(url);
        if (progress?.status !== 'error') return;
        const trustedHost = host ?? this.getHostname(url);
```

with

```ts
        const progress = this.importsMap().get(url);
        if (progress?.status !== 'error' || !this.trustActionsAvailable())
            return;
        const trustedHost = host ?? this.getHostname(url);
```

(in `trustInsecureTlsHostAndRetry`), and replace

```ts
    private isActionableError(progress: EpgImportProgress): boolean {
```

with

```ts
    /**
     * Security errors stay until dismissed: the desktop offers a trust
     * action, a server's message names the setting to change.
     */
    private isActionableError(progress: EpgImportProgress): boolean {
```

In `epg-source-status.component.ts`, replace

```ts
import {
    EpgProgressService,
    EpgRuntimeBridgeService,
} from '@iptvnator/epg/data-access';
```

with

```ts
import {
    EpgProgressService,
    EpgRuntimeBridgeService,
} from '@iptvnator/epg/data-access';
import {
    SHARED_EPG_FRESH_HOURS,
    ServerStorageStatusService,
} from '@iptvnator/services';

/** On a device a source counts as fresh for half a day. */
const DEVICE_FRESH_HOURS = 12;
```

replace

```ts
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
```

with

```ts
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly serverStatus = inject(ServerStorageStatusService);
```

and replace

```ts
        const result = await this.epgBridge.checkFreshness([url], 12);
```

with

```ts
        // A server refreshes every source daily: fresh for a day there.
        const result = await this.epgBridge.checkFreshness(
            [url],
            this.serverStatus.epgEnabled()
                ? SHARED_EPG_FRESH_HOURS
                : DEVICE_FRESH_HOURS
        );
```

In `epg-progress-panel-view.component.ts`, replace

```ts
    readonly minimized = signal(false);
```

with

```ts
    readonly minimized = signal(false);
    readonly trustActionsAvailable = this.epgProgress.trustActionsAvailable;
```

In `epg-progress-panel-view.component.html`, replace

```html
                                @if (isActionableSecurityError(item)) {
```

with

```html
                                @if (
                                    isActionableSecurityError(item) &&
                                    trustActionsAvailable()
                                ) {
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test epg-data-access --testPathPatterns=epg-progress.service
pnpm nx test ui-epg --testPathPatterns="epg-progress-panel|epg-source-status"
```

Expected: PASS (the existing chip test still sees `12` on the desktop).

- [ ] **Step 5: Commit**

```bash
git add libs/epg/data-access/src/lib/epg-progress.service.ts libs/epg/data-access/src/lib/epg-progress.service.spec.ts libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel-view.component.ts libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel-view.component.html libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel.component.spec.ts libs/ui/epg/src/lib/epg-source-status/epg-source-status.component.ts libs/ui/epg/src/lib/epg-source-status/epg-source-status.component.spec.ts
git commit -m "feat(epg): server EPG hints instead of trust actions, daily freshness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Settings form in server mode

**Files:**
- Modify: `libs/shared/interfaces/src/lib/epg-source-reference.util.ts` (append)
- Test: `libs/shared/interfaces/src/lib/epg-source-reference.util.spec.ts`
- Create: `apps/web/src/app/settings/settings-epg-server-form.ts`
- Test: `apps/web/src/app/settings/settings-epg-server-form.spec.ts`
- Modify: `apps/web/src/app/settings/settings-form.utils.ts` (imports, `createSettingsForm` signature as 3a left it, `:50-57`, `:73-75`, `:152-165`)
- Modify: `apps/web/src/app/settings/settings-change-tracking.ts:36`
- Modify: `apps/web/src/app/settings/settings-form.facade.ts` (as 3a left it: imports, fields, `loadSettings`, `hydrateFromStore`, `setEpgUrls`, `addEpgSource`, `save`)
- Modify: `apps/web/src/app/settings/settings.component.ts:451-455`
- Modify: `apps/web/src/app/settings/test-stubs/settings-test-harness.stub.ts:209`
- Modify: `apps/web/src/assets/i18n/en.json` (three keys; Task 17 translates them)
- Test: `apps/web/src/app/settings/settings-form.utils.spec.ts`, `settings-change-tracking.spec.ts`
- Test: `apps/web/src/app/settings/settings.component.server-epg.spec.ts` (create)

The maintainer's rule: the daily refresh time is a setting like any other. It is a control of the settings form (`epgRefreshTime`, server mode only, never stored on the device), mapped to the EPG page in change tracking, validated as `HH:MM`, reset by Discard, and saved by the Save bar. While the page could not read the server settings (offline start) the control is disabled: there is no time to show or change, and a disabled control neither blocks Save nor reaches the request. Save sends the changed list and refresh time to the server in one `PUT /v1/epg/settings` (`SettingsStore.saveSharedEpgSettings`, Task 10) before it saves the device settings; when the server refuses, nothing is saved, the form stays dirty and the page says so. The following reconciliation of the list then finds it unchanged on the backend and sends nothing.

The snippets of `settings-form.utils.ts`, `settings-form.facade.ts` and their specs are the files as 3a's Task 11 ("Settings → EPG display settings in the PWA") leaves them: `createSettingsForm(formBuilder, supportsEpg, supportsEpgDisplay = supportsEpg)`, `supportsEpg` (XMLTV sources) and `supportsEpgDisplay` (any guide) on the facade.

- [ ] **Step 1: The shared links-only validator (failing test first)**

Append to `libs/shared/interfaces/src/lib/epg-source-reference.util.spec.ts` (add `validateRemoteEpgSourceControl` to its import from `./epg-source-reference.util`):

```ts
describe('validateRemoteEpgSourceControl', () => {
    it.each([
        '',
        '   ',
        'https://epg.example.org/guide.xml.gz',
        'http://192.168.1.20/guide.xml',
        'https://epg.example.org/guide.xml?token=abc',
    ])('accepts %p', (value) => {
        expect(validateRemoteEpgSourceControl({ value })).toBeNull();
    });

    it.each([
        '/home/user/epg/guide.xml',
        'file:///home/user/epg/guide.xml',
        'C:\\epg\\guide.xml.gz',
        'https://user:secret@epg.example.org/guide.xml',
        'https://user@epg.example.org/guide.xml',
        'ftp://epg.example.org/guide.xml',
    ])('refuses %p, which a server cannot download', (value) => {
        expect(validateRemoteEpgSourceControl({ value })).toEqual({
            epgSourceReference: true,
        });
    });
});
```

Run: `pnpm nx test shared-interfaces --testPathPatterns=epg-source-reference`
Expected: FAIL, `validateRemoteEpgSourceControl is not a function`.

Append to `libs/shared/interfaces/src/lib/epg-source-reference.util.ts`:

```ts
/**
 * Validator for a source a self-hosted server downloads (server EPG): a
 * remote link only, never a file on this device, and without a user name or
 * password in it (the server refuses those). Empty is valid, as above.
 */
export function validateRemoteEpgSourceControl(control: {
    value: unknown;
}): Record<typeof EPG_SOURCE_REFERENCE_ERROR, true> | null {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (value === '') {
        return null;
    }
    if (isRemoteEpgSourceUrl(value)) {
        try {
            const url = new URL(value);
            if (!url.username && !url.password) {
                return null;
            }
        } catch {
            // Matched the pattern but is no URL: refused below.
        }
    }
    return { [EPG_SOURCE_REFERENCE_ERROR]: true };
}
```

Run: `pnpm nx test shared-interfaces --testPathPatterns=epg-source-reference`
Expected: PASS.

- [ ] **Step 2: The server form helpers (failing test first)**

`apps/web/src/app/settings/settings-epg-server-form.spec.ts`:

```ts
import {
    applySharedEpgRefreshTime,
    buildSharedEpgUpdate,
    createEpgRefreshTimeControl,
} from './settings-epg-server-form';

describe('server EPG settings form', () => {
    it('accepts HH:MM from 00:00 to 23:59 only', () => {
        for (const value of ['00:00', '04:00', '23:59']) {
            expect(createEpgRefreshTimeControl(value).valid).toBe(true);
        }
        for (const value of [
            '',
            '24:00',
            '4:00',
            '12:60',
            'noon',
            '04:00:00',
        ]) {
            expect(createEpgRefreshTimeControl(value).valid).toBe(false);
        }
    });

    it('shows the server time, and nothing to edit while it is unknown', () => {
        const control = createEpgRefreshTimeControl();

        applySharedEpgRefreshTime(control, null);
        expect(control.value).toBe('');
        expect(control.disabled).toBe(true);

        applySharedEpgRefreshTime(control, '04:00');
        expect(control.value).toBe('04:00');
        expect(control.enabled).toBe(true);

        // The desktop form has no such control.
        expect(() => applySharedEpgRefreshTime(null, '04:00')).not.toThrow();
    });

    it('sends only the fields that changed', () => {
        const saved = {
            savedUrls: ['https://epg.example/a.xml'],
            savedRefreshTime: '04:00',
        };

        expect(
            buildSharedEpgUpdate({
                ...saved,
                urls: [' https://epg.example/a.xml'],
                refreshTime: '04:00',
            })
        ).toBeNull();
        expect(
            buildSharedEpgUpdate({
                ...saved,
                urls: ['https://epg.example/a.xml'],
                refreshTime: '05:30',
            })
        ).toEqual({ refreshTime: '05:30' });
        expect(
            buildSharedEpgUpdate({
                ...saved,
                urls: ['https://epg.example/b.xml', ''],
                refreshTime: '04:00',
            })
        ).toEqual({ urls: ['https://epg.example/b.xml'] });
        expect(
            buildSharedEpgUpdate({ ...saved, urls: [], refreshTime: '06:15' })
        ).toEqual({ urls: [], refreshTime: '06:15' });
    });

    it('never sends an empty or invalid time', () => {
        const saved = { savedUrls: [], savedRefreshTime: null };

        expect(
            buildSharedEpgUpdate({ ...saved, urls: [], refreshTime: '' })
        ).toBeNull();
        expect(
            buildSharedEpgUpdate({ ...saved, urls: [], refreshTime: '25:00' })
        ).toBeNull();
    });
});
```

Run: `pnpm nx test web --testPathPatterns=settings-epg-server-form`
Expected: FAIL, module not found.

`apps/web/src/app/settings/settings-epg-server-form.ts`:

```ts
import { AbstractControl, FormControl, Validators } from '@angular/forms';
import { epgSourceUrlsChanged } from '@iptvnator/services';
import type { ServerEpgSettingsUpdate } from '@iptvnator/shared/interfaces';

/** Settings form control of the server's daily EPG refresh time. */
export const EPG_REFRESH_TIME_CONTROL = 'epgRefreshTime';

const REFRESH_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM", 24 h, in the server's time zone. */
export function createEpgRefreshTimeControl(
    value = ''
): FormControl<string | null> {
    return new FormControl(value, [
        Validators.required,
        Validators.pattern(REFRESH_TIME),
    ]);
}

/**
 * Puts the server's refresh time into the form. Unknown (the server
 * settings could not be read): empty and disabled, so the field neither
 * blocks Save nor sends a time nobody saw.
 */
export function applySharedEpgRefreshTime(
    control: AbstractControl | null,
    refreshTime: string | null
): void {
    if (!control) {
        return;
    }
    control.setValue(refreshTime ?? '');
    if (refreshTime) {
        control.enable();
    } else {
        control.disable();
    }
}

/** Trimmed, non-empty, first occurrence only (the server's own rule). */
function cleanUrls(urls: readonly string[]): string[] {
    return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

export interface SharedEpgFormState {
    readonly savedUrls: readonly string[];
    readonly urls: readonly string[];
    readonly savedRefreshTime: string | null;
    readonly refreshTime: string | null | undefined;
}

/** What Settings → Save sends to the server: the changed fields, or null. */
export function buildSharedEpgUpdate(
    state: SharedEpgFormState
): ServerEpgSettingsUpdate | null {
    const urls = cleanUrls(state.urls);
    const urlsChanged = epgSourceUrlsChanged([...state.savedUrls], urls);
    const refreshTime = state.refreshTime?.trim() ?? '';
    const timeChanged =
        REFRESH_TIME.test(refreshTime) &&
        refreshTime !== state.savedRefreshTime;
    if (!urlsChanged && !timeChanged) {
        return null;
    }
    return {
        ...(urlsChanged ? { urls } : {}),
        ...(timeChanged ? { refreshTime } : {}),
    };
}
```

Run: `pnpm nx test web --testPathPatterns=settings-epg-server-form`
Expected: PASS, 4 tests.

- [ ] **Step 3: Write the failing settings specs**

In `settings-form.utils.spec.ts`, change the first import to `import { FormArray, FormBuilder, FormControl } from '@angular/forms';`, add `applyEpgUrlsToFormArray,` as the first name of the `./settings-form.utils` import, and append after 3a's `describe('settings form utils — EPG display without XMLTV sources', …)` at the end of the file:

```ts
describe('settings form utils — server EPG', () => {
    const valid = (value: string) => createEpgUrlControl(value, true).valid;

    it('accepts only http(s) links without credentials on a server', () => {
        expect(valid('https://epg.example/guide.xml.gz')).toBe(true);
        expect(valid('http://192.168.1.20/guide.xml')).toBe(true);
        expect(valid('')).toBe(true);
        expect(valid('/home/you/epg/guide.xml')).toBe(false);
        expect(valid('file:///guide.xml')).toBe(false);
        expect(valid('https://user:secret@epg.example/guide.xml')).toBe(false);
        // The desktop keeps local files.
        expect(createEpgUrlControl('/home/you/epg/guide.xml').valid).toBe(true);
    });

    it('applies the server rule to restored rows', () => {
        const array = new FormArray<FormControl<string | null>>([]);

        applyEpgUrlsToFormArray(
            array,
            ['https://epg.example/a.xml', 'C:\\epg\\guide.xml'],
            true
        );

        expect(array.controls.map((control) => control.valid)).toEqual([
            true,
            false,
        ]);
    });

    it('adds the refresh time only on a server and never stores it on the device', () => {
        const server = createSettingsForm(new FormBuilder(), true, true, true);

        expect(server.get('epgRefreshTime')).not.toBeNull();
        expect(
            createSettingsForm(new FormBuilder(), true).get('epgRefreshTime')
        ).toBeNull();
        server.get('epgRefreshTime')?.setValue('05:30');
        expect(
            createSettingsFromFormValue(server, {} as Settings)
        ).not.toHaveProperty('epgRefreshTime');
    });
});
```

In `settings-change-tracking.spec.ts`, replace

```ts
    it('maps every control of the settings form to a page', () => {
        const form = createSettingsForm(new FormBuilder(), true);
```

with

```ts
    it('maps every control of the settings form to a page', () => {
        // Server mode has every control, the server's refresh time included.
        const form = createSettingsForm(new FormBuilder(), true, true, true);
```

Create `settings.component.server-epg.spec.ts`:

```ts
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServerStorageStatusService } from '@iptvnator/services';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsComponent } from './settings.component';
import {
    configureSettingsComponentTestBed,
    createEpgBridgeStub,
    MatSnackBarStub,
    MockSettingsStore,
    stubSettingsSideEffects,
} from './test-stubs/settings-test-harness.stub';

const SAVED_URL = 'https://epg.example/a.xml';

describe('SettingsComponent with server EPG', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let settingsStore: MockSettingsStore;
    let snackBar: MatSnackBarStub;

    beforeEach(waitForAsync(() => {
        configureSettingsComponentTestBed(createEpgBridgeStub());
    }));

    beforeEach(async () => {
        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i-1',
                storage: 'server',
                auth: 'none',
                features: { epg: true },
            },
            jest.fn()
        );
        settingsStore = TestBed.inject(
            SettingsStore
        ) as unknown as MockSettingsStore;
        settingsStore._setSettings({ epgUrl: [SAVED_URL] });
        settingsStore.sharedEpgRefreshTime.set('04:00');
        fixture = TestBed.createComponent(SettingsComponent);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;
        component = fixture.componentInstance;
        stubSettingsSideEffects(component);
        jest.spyOn(component.epg, 'fetchConfiguredEpg').mockImplementation();
        fixture.detectChanges();
        await component.ngOnInit();
    });

    const refreshTime = () => component.settingsForm.get('epgRefreshTime');

    it('reads the shared settings again when Settings opens and shows the refresh time', () => {
        expect(settingsStore.reloadSharedEpgSettings).toHaveBeenCalled();
        expect(refreshTime()?.value).toBe('04:00');
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('stages the refresh time like any other setting, validates and discards it', () => {
        refreshTime()?.setValue('05:30');
        refreshTime()?.markAsDirty();
        component.settingsForm.markAsDirty();
        expect(component.form.changedPaths()).toEqual(['epgRefreshTime']);

        refreshTime()?.setValue('25:00');
        expect(component.settingsForm.valid).toBe(false);

        component.discardChanges();
        expect(refreshTime()?.value).toBe('04:00');
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('saves the list and the refresh time in one request before the device settings', async () => {
        component.form.addEpgSource();
        component.form.epgUrl.at(1).setValue('https://epg.example/b.xml');
        refreshTime()?.setValue('05:30');
        component.settingsForm.markAsDirty();

        component.onSubmit();
        await fixture.whenStable();

        expect(settingsStore.saveSharedEpgSettings).toHaveBeenCalledTimes(1);
        expect(settingsStore.saveSharedEpgSettings).toHaveBeenCalledWith({
            urls: [SAVED_URL, 'https://epg.example/b.xml'],
            refreshTime: '05:30',
        });
        expect(
            settingsStore.saveSharedEpgSettings.mock.invocationCallOrder[0]
        ).toBeLessThan(
            settingsStore.updateSettings.mock.invocationCallOrder[0]
        );
    });

    it('sends nothing to the server when its fields did not change', async () => {
        component.settingsForm.patchValue({ showCaptions: true });
        component.settingsForm.markAsDirty();

        component.onSubmit();
        await fixture.whenStable();

        expect(settingsStore.saveSharedEpgSettings).not.toHaveBeenCalled();
        expect(settingsStore.updateSettings).toHaveBeenCalled();
    });

    it('keeps everything staged and says so when the server refuses', async () => {
        settingsStore.saveSharedEpgSettings.mockResolvedValue(false);
        refreshTime()?.setValue('05:30');
        component.settingsForm.markAsDirty();

        component.onSubmit();
        await fixture.whenStable();

        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.EPG_SERVER_SAVE_FAILED',
            undefined,
            expect.anything()
        );
        expect(settingsStore.updateSettings).not.toHaveBeenCalled();
        expect(component.settingsForm.dirty).toBe(true);
    });

    it('keeps the refresh time read-only while the server settings are unknown', async () => {
        settingsStore.sharedEpgRefreshTime.set(null);
        await component.ngOnInit();

        expect(refreshTime()?.disabled).toBe(true);
        expect(component.settingsForm.valid).toBe(true);
    });

    it('accepts only links the server can download', () => {
        component.form.setEpgUrls([
            'https://epg.example/b.xml',
            '/home/me/guide.xml',
            'https://user:pw@epg.example/guide.xml',
        ]);

        expect(
            component.form.epgUrl.controls.map((control) => control.valid)
        ).toEqual([true, true, false, false]);
    });
});
```

(`setEpgUrls` appends to the hydrated row of `SAVED_URL`, hence four controls.)

- [ ] **Step 4: Run to verify failure**

Run: `pnpm nx test web --testPathPatterns="settings-form.utils|settings-change-tracking|settings.component.server-epg"`
Expected: FAIL (`createSettingsForm` ignores a fourth argument, so there is no `epgRefreshTime`; local paths are valid with `remoteOnly`; the mock store has no `sharedEpgRefreshTime`, `reloadSharedEpgSettings` or `saveSharedEpgSettings`; the snackbar says `SETTINGS.EPG_DATA_CLEAR_FAILED`).

- [ ] **Step 5: Implement**

In `settings-form.utils.ts`, add `validateRemoteEpgSourceControl,` to the `@iptvnator/shared/interfaces` import (after `validateEpgSourceReferenceControl,`), add after the imports

```ts
import { createEpgRefreshTimeControl } from './settings-epg-server-form';
```

replace the signature 3a left

```ts
export function createSettingsForm(
    formBuilder: FormBuilder,
    supportsEpg: boolean,
    supportsEpgDisplay = supportsEpg
) {
```

with

```ts
export function createSettingsForm(
    formBuilder: FormBuilder,
    supportsEpg: boolean,
    supportsEpgDisplay = supportsEpg,
    serverEpg = false
) {
```

replace

```ts
        ...(supportsEpg
            ? { epgUrl: new FormArray<FormControl<string | null>>([]) }
            : {}),
```

with

```ts
        ...(supportsEpg
            ? { epgUrl: new FormArray<FormControl<string | null>>([]) }
            : {}),
        // Server EPG: the server's daily refresh time, saved with the rest
        // but never stored on the device (createSettingsFromFormValue
        // lists the device settings by name).
        ...(serverEpg ? { epgRefreshTime: createEpgRefreshTimeControl() } : {}),
```

replace

```ts
export function createEpgUrlControl(value = ''): FormControl<string | null> {
    return new FormControl(value, [validateEpgSourceReferenceControl]);
}
```

with

```ts
export function createEpgUrlControl(
    value = '',
    remoteOnly = false
): FormControl<string | null> {
    // A server downloads links only; it cannot read files on this device.
    return new FormControl(value, [
        remoteOnly
            ? validateRemoteEpgSourceControl
            : validateEpgSourceReferenceControl,
    ]);
}
```

and replace

```ts
export function applyEpgUrlsToFormArray(
    epgUrl: FormArray,
    epgUrls: string[] | string
): void {
```

with

```ts
export function applyEpgUrlsToFormArray(
    epgUrl: FormArray,
    epgUrls: string[] | string,
    remoteOnly = false
): void {
```

and inside it `        epgUrl.push(createEpgUrlControl(url));` with `        epgUrl.push(createEpgUrlControl(url, remoteOnly));`.

In `settings-change-tracking.ts`, replace

```ts
    epgUrl: 'epg',
```

with

```ts
    epgUrl: 'epg',
    epgRefreshTime: 'epg',
```

In `settings-form.facade.ts`, replace

```ts
import {
    EpgSourceReconciliationError,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
```

with

```ts
import {
    EpgSourceReconciliationError,
    RuntimeCapabilitiesService,
    ServerStorageStatusService,
} from '@iptvnator/services';
```

add after the `./settings-form.utils` import

```ts
import {
    applySharedEpgRefreshTime,
    buildSharedEpgUpdate,
    EPG_REFRESH_TIME_CONTROL,
} from './settings-epg-server-form';
```

replace

```ts
    private readonly settingsStore = inject(SettingsStore);
```

with

```ts
    private readonly settingsStore = inject(SettingsStore);
    /** Server EPG: the list and refresh time are the server's; links only. */
    private readonly serverEpg = inject(
        ServerStorageStatusService
    ).epgEnabled();
```

replace (3a's form creation)

```ts
    readonly form = createSettingsForm(
        this.formBuilder,
        this.supportsEpg,
        this.supportsEpgDisplay
    );
```

with

```ts
    readonly form = createSettingsForm(
        this.formBuilder,
        this.supportsEpg,
        this.supportsEpgDisplay,
        this.serverEpg
    );
```

replace

```ts
    async loadSettings(): Promise<void> {
        await this.settingsStore.loadSettings();

```

with

```ts
    async loadSettings(): Promise<void> {
        await this.settingsStore.loadSettings();
        // Server mode: show the list and refresh time as the server has them.
        await this.settingsStore.reloadSharedEpgSettings();

```

replace

```ts
        const currentSettings = this.settingsStore.getSettings();
        this.form.patchValue(currentSettings);
```

with

```ts
        const currentSettings = this.settingsStore.getSettings();
        this.form.patchValue(currentSettings);
        // Server mode: the refresh time is the server's, not a device setting.
        applySharedEpgRefreshTime(
            this.form.get(EPG_REFRESH_TIME_CONTROL),
            this.settingsStore.sharedEpgRefreshTime()
        );
```

replace

```ts
    setEpgUrls(epgUrls: string[] | string): void {
        applyEpgUrlsToFormArray(this.epgUrl, epgUrls);
    }
```

with

```ts
    setEpgUrls(epgUrls: string[] | string): void {
        applyEpgUrlsToFormArray(this.epgUrl, epgUrls, this.serverEpg);
    }

    /** A failed source sync: cleanup on the desktop, the save on a server. */
    get epgSyncFailedKey(): string {
        return this.serverEpg
            ? 'SETTINGS.EPG_SERVER_SAVE_FAILED'
            : 'SETTINGS.EPG_DATA_CLEAR_FAILED';
    }
```

replace

```ts
        this.epgUrl.insert(this.epgUrl.length, createEpgUrlControl());
```

with

```ts
        this.epgUrl.insert(
            this.epgUrl.length,
            createEpgUrlControl('', this.serverEpg)
        );
```

replace

```ts
        const settings = createSettingsFromFormValue(
            this.form,
            this.settingsStore.getSettings()
        );
        let cleanupError: EpgSourceReconciliationError | undefined;
```

with

```ts
        const settings = createSettingsFromFormValue(
            this.form,
            this.settingsStore.getSettings()
        );
        // Server EPG: the changed list and refresh time go to the server
        // first, in one request; when it refuses, nothing is saved here.
        await this.saveSharedEpgSettings(settings.epgUrl);
        let cleanupError: EpgSourceReconciliationError | undefined;
```

and add before `    private takeSavedSnapshot(): void {`:

```ts
    private async saveSharedEpgSettings(urls: string[]): Promise<void> {
        if (!this.serverEpg) {
            return;
        }
        const update = buildSharedEpgUpdate({
            savedUrls: this.settingsStore.getSettings().epgUrl,
            urls,
            savedRefreshTime: this.settingsStore.sharedEpgRefreshTime(),
            refreshTime: this.form.get(EPG_REFRESH_TIME_CONTROL)?.value,
        });
        if (
            update &&
            !(await this.settingsStore.saveSharedEpgSettings(update))
        ) {
            throw new EpgSourceReconciliationError();
        }
    }

```

In `settings.component.ts`, replace

```ts
                this.settingsSnackbar.open(
                    this.translate.instant('SETTINGS.EPG_DATA_CLEAR_FAILED')
                );
```

with

```ts
                this.settingsSnackbar.open(
                    this.translate.instant(this.form.epgSyncFailedKey)
                );
```

(the line count of `settings.component.ts` does not change; it is close to the 400-line limit).

In `test-stubs/settings-test-harness.stub.ts` (it already imports `signal`), replace

```ts
    loadSettings = jest.fn().mockResolvedValue(undefined);
```

with

```ts
    loadSettings = jest.fn().mockResolvedValue(undefined);

    reloadSharedEpgSettings = jest.fn().mockResolvedValue(undefined);

    saveSharedEpgSettings = jest.fn().mockResolvedValue(true);

    sharedEpgRefreshTime = signal<string | null>(null);
```

In `apps/web/src/assets/i18n/en.json`, inside `SETTINGS` after `"EPG_VIEW_MODE_LIST": "List",`, add (Task 17 adds the rest and translates all):

```json
        "EPG_SERVER_URL_ERROR": "Enter an http(s) link. The server cannot read files on this device or links with a user name or password.",
        "EPG_SERVER_SAVE_FAILED": "Could not save the EPG sources on the server. Check the connection and the links, then try again.",
        "EPG_SERVER_REFRESH_TIME_ERROR": "Enter a time from 00:00 to 23:59.",
```

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm nx test shared-interfaces --testPathPatterns=epg-source-reference
pnpm nx test web --testPathPatterns="settings"
pnpm nx lint web
```

Expected: PASS (all settings specs, including `settings.component.storage-failure.spec.ts`, which still expects `SETTINGS.EPG_DATA_CLEAR_FAILED` on the desktop, and 3a's display-only tests); lint clean; `settings-form.facade.ts` about 270 counted lines (220 on master, 226 after 3a) and `settings-form.utils.ts` about 240, both under 300.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/interfaces/src/lib/epg-source-reference.util.ts libs/shared/interfaces/src/lib/epg-source-reference.util.spec.ts apps/web/src/app/settings/settings-epg-server-form.ts apps/web/src/app/settings/settings-epg-server-form.spec.ts apps/web/src/app/settings/settings-form.utils.ts apps/web/src/app/settings/settings-form.utils.spec.ts apps/web/src/app/settings/settings-change-tracking.ts apps/web/src/app/settings/settings-change-tracking.spec.ts apps/web/src/app/settings/settings-form.facade.ts apps/web/src/app/settings/settings.component.ts apps/web/src/app/settings/settings.component.server-epg.spec.ts apps/web/src/app/settings/test-stubs/settings-test-harness.stub.ts apps/web/src/assets/i18n/en.json
git commit -m "feat(settings): server EPG list and refresh time saved with the Save bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Settings → EPG server view

**Files:**
- Modify: `libs/ui/epg/src/index.ts`
- Create: `apps/web/src/app/settings/settings-epg-server-rows.ts`
- Test: `apps/web/src/app/settings/settings-epg-server-rows.spec.ts`
- Create: `apps/web/src/app/settings/settings-epg-server-imports.component.ts`, `.html`, `.scss`
- Test: `apps/web/src/app/settings/settings-epg-server-imports.component.spec.ts`
- Create: `apps/web/src/app/settings/settings-epg-server-schedule.component.ts`
- Test: `apps/web/src/app/settings/settings-epg-server-schedule.component.spec.ts`
- Modify: `apps/web/src/app/settings/settings-epg-section.component.ts`, `.html`, `.scss`
- Test: `apps/web/src/app/settings/settings-epg-section.component.spec.ts`

This view builds on 3a's split of the page (Task 11 of `.plans/2026-10-15-server-epg-3a-provider-epg.md`): the Guide section (view mode, offset) renders wherever a guide exists, and everything after it sits inside `@if (showsXmltvSources()) { … }`, which `settings.component.html` binds to `supportsEpg`. Server EPG has XMLTV sources (the server backend imports and manages data), so the block renders in server mode, and this task changes only what is inside it. 3a ran Prettier over the template, so the snippets below are the block as 3a left it, four spaces deeper than on today's master; the Guide section is not touched.

Layout (UI guidelines, Settings Surfaces): in server mode the Sources section description says the list is shared by every device and the format examples drop the local-file ones; the editable rows keep their status chip. A new section "On the server" has two rows: "Daily refresh" (the form's time field from Task 14 in the control column, its error, and the server's time zone and next run under it) and "Imported sources" (full-width list: display URL without query string, owner, state chip, last import and counts, error text with the hint). The time field is an ordinary form control, so Save, Discard and the unsaved-changes guard handle it like the rows above it. The row shells (`setting-item`, `data-setting-id`, `h4`, first `p`) live in `settings-epg-section.component.html`, because the settings-search registry spec reads only `settings-*-section.component.html` files; the dynamic parts are two child components that inject server-only services and are created only inside `@if (serverEpg())`.

- [ ] **Step 1: Export the display-URL helper**

Append to `libs/ui/epg/src/index.ts`:

```ts
export * from './lib/epg-progress-panel/epg-import-display-url';
```

- [ ] **Step 2: Write the failing specs**

`settings-epg-server-rows.spec.ts`:

```ts
import type { ServerEpgStatus } from '@iptvnator/shared/interfaces';
import {
    buildServerEpgRows,
    buildServerEpgTotals,
    type ServerEpgRowText,
} from './settings-epg-server-rows';

const text: ServerEpgRowText = {
    translate: (key, params) =>
        params ? `${key} ${JSON.stringify(params)}` : key,
    date: (iso) => `date(${iso})`,
    count: (value) => `#${value}`,
};

const STATUS: ServerEpgStatus = {
    revision: 4,
    refreshTime: '04:00',
    timeZone: 'Europe/Berlin',
    nextRunAt: '2026-10-16T02:00:00.000Z',
    totals: { programmes: 1_000, databaseBytes: 3 * 1024 * 1024 },
    sources: [
        {
            url: 'http://nas.local/guide.xml',
            owners: { global: false, playlists: 2 },
            state: 'error',
            errorCode: 'epg-private-network-blocked',
        },
        {
            url: 'https://epg.example/a/guide.xml.gz?token=secret',
            owners: { global: true, playlists: 1 },
            state: 'idle',
            lastSuccessAt: '2026-10-15T02:00:00.000Z',
            channels: 8,
            programmes: 64,
        },
        {
            url: 'https://epg.example/new.xml',
            owners: { global: true, playlists: 0 },
            state: 'loading',
            stats: { totalChannels: 3, totalPrograms: 30 },
        },
    ],
};

describe('buildServerEpgRows', () => {
    it('lists this list first, hides query strings and describes each state', () => {
        const rows = buildServerEpgRows(STATUS, text);

        expect(rows.map((row) => row.label)).toEqual([
            'epg.example/…/guide.xml.gz',
            'epg.example/new.xml',
            'nas.local/guide.xml',
        ]);
        expect(rows.map((row) => row.state)).toEqual([
            'fresh',
            'loading',
            'error',
        ]);
        expect(rows[0]).toMatchObject({
            owner: 'SETTINGS.EPG_SERVER_OWNER_LIST · SETTINGS.EPG_SERVER_OWNER_PLAYLISTS {"count":1}',
            stateLabel: 'SETTINGS.EPG_STATUS_FRESH',
            detail: 'SETTINGS.EPG_SERVER_LAST_IMPORT {"date":"date(2026-10-15T02:00:00.000Z)"} · SETTINGS.EPG_SERVER_COUNTS {"channels":"#8","programmes":"#64"}',
            error: null,
        });
        expect(rows[1].detail).toBe(
            'SETTINGS.EPG_SERVER_COUNTS {"channels":"#3","programmes":"#30"}'
        );
        expect(rows[2]).toMatchObject({
            owner: 'SETTINGS.EPG_SERVER_OWNER_PLAYLISTS {"count":2}',
            stateLabel: 'SETTINGS.EPG_STATUS_ERROR',
            detail: '',
            error: 'SERVER_EPG.ERROR_PRIVATE_NETWORK {"host":"nas.local"}',
        });
        expect(JSON.stringify(rows)).not.toContain('secret');
    });

    it('marks a source never imported', () => {
        const [row] = buildServerEpgRows(
            {
                ...STATUS,
                sources: [
                    {
                        url: 'https://epg.example/x.xml',
                        owners: { global: true, playlists: 0 },
                        state: 'idle',
                    },
                ],
            },
            text
        );

        expect(row.state).toBe('never');
        expect(row.stateLabel).toBe('SETTINGS.EPG_SERVER_NOT_IMPORTED');
    });

    it('sums up the programmes and the database size', () => {
        expect(buildServerEpgTotals(STATUS, text)).toBe(
            'SETTINGS.EPG_SERVER_TOTALS {"programmes":"#1000","size":"3.0 MB"}'
        );
    });
});
```

`settings-epg-server-imports.component.spec.ts`:

```ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ServerEpgStatusPoller } from '@iptvnator/services/server-storage';
import type { ServerEpgStatus } from '@iptvnator/shared/interfaces';
import { SettingsEpgServerImportsComponent } from './settings-epg-server-imports.component';

describe('SettingsEpgServerImportsComponent', () => {
    const status = signal<ServerEpgStatus | null>(null);
    const release = jest.fn();
    const watch = jest.fn(() => release);

    beforeEach(() => {
        status.set(null);
        TestBed.configureTestingModule({
            imports: [
                SettingsEpgServerImportsComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: ServerEpgStatusPoller, useValue: { status, watch } },
            ],
        });
    });

    it('watches the status while open and lists every imported source', () => {
        const fixture = TestBed.createComponent(
            SettingsEpgServerImportsComponent
        );
        const host = fixture.nativeElement as HTMLElement;
        fixture.detectChanges();
        expect(watch).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain(
            'SETTINGS.EPG_SERVER_IMPORTS_UNAVAILABLE'
        );

        status.set({
            revision: 1,
            refreshTime: '04:00',
            timeZone: 'UTC',
            nextRunAt: null,
            totals: { programmes: 64, databaseBytes: 1024 * 1024 },
            sources: [
                {
                    url: 'https://epg.example/guide.xml?token=secret',
                    owners: { global: true, playlists: 0 },
                    state: 'idle',
                    lastSuccessAt: '2026-10-15T04:00:00.000Z',
                    channels: 8,
                    programmes: 64,
                },
                {
                    url: 'http://nas.local/guide.xml',
                    owners: { global: false, playlists: 1 },
                    state: 'error',
                    errorCode: 'epg-private-network-blocked',
                },
            ],
        });
        fixture.detectChanges();

        const rows = host.querySelectorAll(
            '[data-test-id="epg-server-source"]'
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('epg.example/guide.xml');
        expect(host.textContent).not.toContain('secret');
        expect(
            rows[1].querySelector('.server-epg-imports__error')?.textContent
        ).toContain('SERVER_EPG.ERROR_PRIVATE_NETWORK');

        fixture.destroy();
        expect(release).toHaveBeenCalledTimes(1);
    });
});
```

`settings-epg-server-schedule.component.spec.ts`:

```ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ServerEpgStatusPoller } from '@iptvnator/services/server-storage';
import type { ServerEpgStatus } from '@iptvnator/shared/interfaces';
import { SettingsEpgServerScheduleComponent } from './settings-epg-server-schedule.component';

const STATUS: ServerEpgStatus = {
    revision: 1,
    refreshTime: '04:00',
    timeZone: 'Europe/Berlin',
    nextRunAt: '2026-10-16T02:00:00.000Z',
    sources: [],
    totals: { programmes: 0, databaseBytes: 0 },
};

describe('SettingsEpgServerScheduleComponent', () => {
    const status = signal<ServerEpgStatus | null>(null);

    function render(value: ServerEpgStatus | null) {
        status.set(value);
        TestBed.configureTestingModule({
            imports: [
                SettingsEpgServerScheduleComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: ServerEpgStatusPoller, useValue: { status } },
            ],
        });
        const fixture = TestBed.createComponent(
            SettingsEpgServerScheduleComponent
        );
        const instant = jest.spyOn(TestBed.inject(TranslateService), 'instant');
        fixture.detectChanges();
        return { host: fixture.nativeElement as HTMLElement, instant };
    }

    it('names the server time zone and the next run in that zone', () => {
        const { host, instant } = render(STATUS);

        expect(host.textContent).toContain('SETTINGS.EPG_SERVER_SCHEDULE');
        // 02:00 UTC is 04:00 in Berlin (CEST) on 16 October.
        expect(instant).toHaveBeenCalledWith('SETTINGS.EPG_SERVER_SCHEDULE', {
            zone: 'Europe/Berlin',
            next: expect.stringContaining('04:00'),
        });
    });

    it('names only the time zone when no run is planned', () => {
        const { host } = render({ ...STATUS, nextRunAt: null });

        expect(host.textContent).toContain('SETTINGS.EPG_SERVER_TIME_ZONE');
        expect(host.textContent).not.toContain('SETTINGS.EPG_SERVER_SCHEDULE');
    });

    it('stays empty while the status cannot be read', () => {
        expect(render(null).host.textContent?.trim()).toBe('');
    });
});
```

In `settings-epg-section.component.spec.ts`, add these imports:

```ts
import { signal } from '@angular/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import { ServerEpgStatusPoller } from '@iptvnator/services/server-storage';
import { createEpgRefreshTimeControl } from './settings-epg-server-form';
```

append inside the existing `describe`, after 3a's `'keeps the XMLTV sources, preference and clear action by default (desktop)'`:

```ts
    it('keeps the desktop view without server EPG', () => {
        configure(createForm());

        expect(query('[data-test-id="epg-server-section"]')).toBeNull();
        expect(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '[data-test-id="epg-source-formats"] code'
            )
        ).toHaveLength(4);
    });
```

and append a second `describe` at the end of the file:

```ts
describe('SettingsEpgSectionComponent with server EPG', () => {
    let fixture: ComponentFixture<SettingsEpgSectionComponent>;
    let form: FormGroup;

    const host = () => fixture.nativeElement as HTMLElement;
    const timeInput = () =>
        host().querySelector(
            '[data-test-id="epg-server-refresh-time"]'
        ) as HTMLInputElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SettingsEpgSectionComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: ServerEpgStatusPoller,
                    useValue: {
                        status: signal(null),
                        watch: () => () => undefined,
                    },
                },
            ],
        }).compileComponents();
        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i-1',
                storage: 'server',
                auth: 'none',
                features: { epg: true },
            },
            jest.fn()
        );
        fixture = TestBed.createComponent(SettingsEpgSectionComponent);
        form = createForm();
        // The server settings form carries the refresh time (Task 14).
        form.addControl('epgRefreshTime', createEpgRefreshTimeControl('04:00'));
        fixture.componentRef.setInput('form', form);
        fixture.componentRef.setInput('epgUrl', form.get('epgUrl'));
        fixture.componentRef.setInput(
            'epgViewModeOptions',
            SETTINGS_EPG_VIEW_MODE_OPTIONS
        );
        fixture.detectChanges();
    });

    it('labels the list as shared and shows links only as examples', () => {
        expect(
            host().querySelector('[data-test-id="epg-sources-hint"]')
                ?.textContent
        ).toContain('SETTINGS.EPG_SERVER_SOURCES_HINT');
        expect(
            host().querySelectorAll('[data-test-id="epg-source-formats"] code')
        ).toHaveLength(1);
    });

    it('binds the daily refresh time to the settings form', () => {
        expect(timeInput().value).toBe('04:00');

        timeInput().value = '05:30';
        timeInput().dispatchEvent(new Event('input'));

        expect(form.get('epgRefreshTime')?.value).toBe('05:30');
        expect(form.get('epgRefreshTime')?.dirty).toBe(true);
        expect(
            host().querySelector('app-settings-epg-server-schedule')
        ).not.toBeNull();
    });

    it('shows the time error under the field, and none while it is read-only', () => {
        form.get('epgRefreshTime')?.setValue('25:00');
        fixture.detectChanges();

        expect(
            host().querySelector('.settings-time-input--invalid')
        ).not.toBeNull();
        expect(host().textContent).toContain(
            'SETTINGS.EPG_SERVER_REFRESH_TIME_ERROR'
        );

        form.get('epgRefreshTime')?.disable();
        fixture.detectChanges();

        expect(host().querySelector('.settings-field-error')).toBeNull();
        expect(timeInput().disabled).toBe(true);
    });

    it('shows the imported sources and what clearing does on a server', () => {
        expect(
            host().querySelector('[data-setting-id="epg-server-refresh-time"]')
        ).not.toBeNull();
        expect(
            host().querySelector('[data-setting-id="epg-server-imports"]')
        ).not.toBeNull();
        expect(
            host().querySelector('app-settings-epg-server-imports')
        ).not.toBeNull();
        expect(host().textContent).toContain(
            'SETTINGS.CLEAR_EPG_DATA_SERVER_NOTE'
        );
    });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm nx test web --testPathPatterns="settings-epg-server|settings-epg-section"`
Expected: FAIL, the new modules are missing and the section has no server view.

- [ ] **Step 4: Implement the row model**

`settings-epg-server-rows.ts`:

```ts
import {
    serverEpgErrorHost,
    serverEpgErrorKey,
} from '@iptvnator/services/server-storage';
import type {
    ServerEpgSourceStatus,
    ServerEpgStatus,
} from '@iptvnator/shared/interfaces';
import { formatEpgImportDisplayUrl } from '@iptvnator/ui/epg';

export type ServerEpgRowState =
    'fresh' | 'never' | 'queued' | 'loading' | 'error';

export interface ServerEpgSourceRow {
    readonly url: string;
    /** Host and file name; never the query string (it may hold credentials). */
    readonly label: string;
    readonly owner: string;
    readonly state: ServerEpgRowState;
    readonly stateLabel: string;
    readonly detail: string;
    readonly error: string | null;
}

export interface ServerEpgRowText {
    readonly translate: (
        key: string,
        params?: Record<string, unknown>
    ) => string;
    readonly date: (iso: string) => string;
    readonly count: (value: number) => string;
}

const STATE_KEYS: Readonly<Record<ServerEpgRowState, string>> = {
    fresh: 'SETTINGS.EPG_STATUS_FRESH',
    never: 'SETTINGS.EPG_SERVER_NOT_IMPORTED',
    queued: 'EPG.QUEUED',
    loading: 'EPG.LOADING',
    error: 'SETTINGS.EPG_STATUS_ERROR',
};

function rowState(source: ServerEpgSourceStatus): ServerEpgRowState {
    if (source.state !== 'idle') {
        return source.state;
    }
    return source.lastSuccessAt ? 'fresh' : 'never';
}

function owner(source: ServerEpgSourceStatus, text: ServerEpgRowText): string {
    return [
        ...(source.owners.global
            ? [text.translate('SETTINGS.EPG_SERVER_OWNER_LIST')]
            : []),
        ...(source.owners.playlists > 0
            ? [
                  text.translate('SETTINGS.EPG_SERVER_OWNER_PLAYLISTS', {
                      count: source.owners.playlists,
                  }),
              ]
            : []),
    ].join(' · ');
}

function counts(
    channels: number,
    programmes: number,
    text: ServerEpgRowText
): string {
    return text.translate('SETTINGS.EPG_SERVER_COUNTS', {
        channels: text.count(channels),
        programmes: text.count(programmes),
    });
}

function detail(source: ServerEpgSourceStatus, text: ServerEpgRowText): string {
    if (source.state === 'loading' && source.stats) {
        return counts(
            source.stats.totalChannels,
            source.stats.totalPrograms,
            text
        );
    }
    if (!source.lastSuccessAt) {
        return '';
    }
    return [
        text.translate('SETTINGS.EPG_SERVER_LAST_IMPORT', {
            date: text.date(source.lastSuccessAt),
        }),
        counts(source.channels ?? 0, source.programmes ?? 0, text),
    ].join(' · ');
}

/** Every source the server imports: this list first, then by address. */
export function buildServerEpgRows(
    status: ServerEpgStatus,
    text: ServerEpgRowText
): ServerEpgSourceRow[] {
    return [...status.sources]
        .sort(
            (a, b) =>
                Number(b.owners.global) - Number(a.owners.global) ||
                a.url.localeCompare(b.url)
        )
        .map((source) => {
            const state = rowState(source);
            return {
                url: source.url,
                label: formatEpgImportDisplayUrl(source.url),
                owner: owner(source, text),
                state,
                stateLabel: text.translate(STATE_KEYS[state]),
                detail: detail(source, text),
                error:
                    source.state === 'error'
                        ? text.translate(serverEpgErrorKey(source.errorCode), {
                              host: serverEpgErrorHost(source),
                          })
                        : null,
            };
        });
}

export function buildServerEpgTotals(
    status: ServerEpgStatus,
    text: ServerEpgRowText
): string {
    return text.translate('SETTINGS.EPG_SERVER_TOTALS', {
        programmes: text.count(status.totals.programmes),
        size: `${(status.totals.databaseBytes / (1024 * 1024)).toFixed(1)} MB`,
    });
}
```

- [ ] **Step 5: Implement the imports list**

`settings-epg-server-imports.component.ts`:

```ts
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes/date-format';
import { injectTranslationTick } from '@iptvnator/services';
import { ServerEpgStatusPoller } from '@iptvnator/services/server-storage';
import {
    buildServerEpgRows,
    buildServerEpgTotals,
    type ServerEpgRowText,
} from './settings-epg-server-rows';

/**
 * Settings → EPG → On the server → Imported sources. Created only in
 * server mode with server EPG; keeps the status polled while it is open.
 */
@Component({
    selector: 'app-settings-epg-server-imports',
    imports: [TranslatePipe],
    templateUrl: './settings-epg-server-imports.component.html',
    styleUrl: './settings-epg-server-imports.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEpgServerImportsComponent {
    private readonly poller = inject(ServerEpgStatusPoller);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();

    readonly status = this.poller.status;
    readonly rows = computed(() => {
        this.languageTick();
        const current = this.status();
        return current ? buildServerEpgRows(current, this.text()) : [];
    });
    readonly totals = computed(() => {
        this.languageTick();
        const current = this.status();
        return current ? buildServerEpgTotals(current, this.text()) : '';
    });

    constructor() {
        inject(DestroyRef).onDestroy(this.poller.watch());
    }

    private text(): ServerEpgRowText {
        const locale = normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
        const dates = new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
        const numbers = new Intl.NumberFormat(locale);
        return {
            translate: (key, params) => this.translate.instant(key, params),
            date: (iso) => {
                const time = Date.parse(iso);
                return Number.isNaN(time) ? iso : dates.format(time);
            },
            count: (value) => numbers.format(value),
        };
    }
}
```

`settings-epg-server-imports.component.html`:

```html
@if (status()) {
    @if (rows().length === 0) {
        <p class="server-epg-imports__note">
            {{ 'SETTINGS.EPG_SERVER_IMPORTS_EMPTY' | translate }}
        </p>
    } @else {
        <ul class="server-epg-imports">
            @for (row of rows(); track row.url) {
                <li
                    class="server-epg-imports__row"
                    data-test-id="epg-server-source"
                >
                    <div class="server-epg-imports__head">
                        <span class="server-epg-imports__label">{{
                            row.label
                        }}</span>
                        <span
                            class="server-state server-epg-imports__state"
                            [attr.data-state]="row.state"
                            >{{ row.stateLabel }}</span
                        >
                    </div>
                    <p class="server-epg-imports__note">
                        {{ row.owner }}
                        @if (row.detail) {
                            · {{ row.detail }}
                        }
                    </p>
                    @if (row.error) {
                        <p class="server-epg-imports__error">{{ row.error }}</p>
                    }
                </li>
            }
        </ul>
        <p class="server-epg-imports__note server-epg-imports__totals">
            {{ totals() }}
        </p>
    }
} @else {
    <p class="server-epg-imports__note">
        {{ 'SETTINGS.EPG_SERVER_IMPORTS_UNAVAILABLE' | translate }}
    </p>
}
```

`settings-epg-server-imports.component.scss`:

```scss
// Imported sources on the server (Settings → EPG). Row and chip tokens come
// from the settings theme (`_settings-theme.scss`); `.server-state` is the
// Settings → Server chip in settings.component.scss.
:host {
    display: block;
    width: 100%;
    min-width: 0;
}

.server-epg-imports {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--settings-item-border);
    border-radius: 10px;
}

.server-epg-imports__row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 10px 12px;

    & + & {
        border-top: 1px solid var(--settings-item-border);
    }
}

.server-epg-imports__head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.server-epg-imports__label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--app-heading-color);
    font-size: 13px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.server-epg-imports__state {
    flex-shrink: 0;
    font-size: 0.72rem;

    &[data-state='never'],
    &[data-state='queued'],
    &[data-state='loading'] {
        color: var(--settings-muted);
        background: var(--settings-chip-bg);
    }

    &[data-state='error'] {
        color: var(--app-expiry-warn-text);
        background: var(--app-expiry-warn-surface);
    }
}

.server-epg-imports__note,
.server-epg-imports__error {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.server-epg-imports__note {
    color: var(--settings-muted);
}

.server-epg-imports__error {
    color: var(--mat-sys-error);
}

.server-epg-imports__totals {
    margin-top: 8px;
}
```

- [ ] **Step 6: Implement the schedule line**

`settings-epg-server-schedule.component.ts`:

```ts
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes/date-format';
import { injectTranslationTick } from '@iptvnator/services';
import { ServerEpgStatusPoller } from '@iptvnator/services/server-storage';

/** The next run in the server's own time zone, which the time field uses. */
function formatInZone(iso: string, timeZone: string, locale: string): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) {
        return iso;
    }
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
    };
    try {
        return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
            time
        );
    } catch {
        // An unknown zone name: the browser's own zone is still a hint.
        return new Intl.DateTimeFormat(locale, options).format(time);
    }
}

/**
 * Settings → EPG → On the server → Daily refresh: the server's time zone
 * and next run, under the form's time field. Server mode only; the status
 * is the one the imports list keeps polled.
 */
@Component({
    selector: 'app-settings-epg-server-schedule',
    template: `
        @if (schedule()) {
            <p class="server-epg-schedule">{{ schedule() }}</p>
        }
    `,
    styles: `
        :host {
            display: block;
        }

        .server-epg-schedule {
            max-width: 34ch;
            margin: 0;
            color: var(--settings-muted);
            font-size: 12px;
            line-height: 1.4;
            text-align: right;
        }

        @container (max-width: 600px) {
            .server-epg-schedule {
                text-align: left;
            }
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEpgServerScheduleComponent {
    private readonly poller = inject(ServerEpgStatusPoller);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();

    readonly schedule = computed(() => {
        this.languageTick();
        const status = this.poller.status();
        if (!status) {
            return '';
        }
        if (!status.nextRunAt) {
            return this.translate.instant('SETTINGS.EPG_SERVER_TIME_ZONE', {
                zone: status.timeZone,
            });
        }
        const locale = normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
        return this.translate.instant('SETTINGS.EPG_SERVER_SCHEDULE', {
            zone: status.timeZone,
            next: formatInZone(status.nextRunAt, status.timeZone, locale),
        });
    });
}
```

- [ ] **Step 7: Wire the section**

In `settings-epg-section.component.ts`, replace

```ts
import {
    Component,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
```

with

```ts
import {
    Component,
    inject,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import { SettingsEpgServerImportsComponent } from './settings-epg-server-imports.component';
import { SettingsEpgServerScheduleComponent } from './settings-epg-server-schedule.component';
```

replace

```ts
        ReactiveFormsModule,
        TranslateModule,
    ],
```

with

```ts
        ReactiveFormsModule,
        SettingsEpgServerImportsComponent,
        SettingsEpgServerScheduleComponent,
        TranslateModule,
    ],
```

replace

```ts
export class SettingsEpgSectionComponent {
    readonly form = input.required<FormGroup>();
```

with

```ts
export class SettingsEpgSectionComponent {
    readonly form = input.required<FormGroup>();
    /** Server mode: the list is the server's, shared by every device. */
    readonly serverEpg = inject(ServerStorageStatusService).epgEnabled;
```

and replace

```ts
    get offsetControl(): AbstractControl | null {
        return this.form().get('epgOffsetMinutes');
    }
```

with

```ts
    get offsetControl(): AbstractControl | null {
        return this.form().get('epgOffsetMinutes');
    }

    /** Server EPG: the server's daily refresh time; absent elsewhere. */
    get refreshTimeControl(): AbstractControl | null {
        return this.form().get('epgRefreshTime');
    }
```

In `settings-epg-section.component.html` (the XMLTV block as 3a's Prettier run left it):


Replace the Sources description

```html
            <p class="settings-section__desc">
                {{ 'SETTINGS.EPG_SOURCE_FORMATS_HINT' | translate }}
            </p>
```

with

```html
            <p class="settings-section__desc" data-test-id="epg-sources-hint">
                {{
                    (serverEpg()
                        ? 'SETTINGS.EPG_SERVER_SOURCES_HINT'
                        : 'SETTINGS.EPG_SOURCE_FORMATS_HINT'
                    ) | translate
                }}
            </p>
```

Replace the empty-state hint

```html
                                <p class="epg-sources-empty__hint">
                                    {{ 'SETTINGS.EPG_EMPTY_HINT' | translate }}
                                </p>
```

with

```html
                                <p class="epg-sources-empty__hint">
                                    {{
                                        (serverEpg()
                                            ? 'SETTINGS.EPG_SERVER_EMPTY_HINT'
                                            : 'SETTINGS.EPG_EMPTY_HINT'
                                        ) | translate
                                    }}
                                </p>
```

Replace the row input's placeholder, label and error

```html
                                                [placeholder]="
                                                    'SETTINGS.EPG_URL_PLACEHOLDER'
                                                        | translate
                                                "
                                                [attr.aria-label]="
                                                    'SETTINGS.EPG_URL_LABEL'
                                                        | translate
                                                "
                                                #epgField
                                            />
                                            <mat-error>{{
                                                'SETTINGS.EPG_URL_ERROR'
                                                    | translate
                                            }}</mat-error>
```

with

```html
                                                [placeholder]="
                                                    (serverEpg()
                                                        ? 'SETTINGS.EPG_SERVER_URL_PLACEHOLDER'
                                                        : 'SETTINGS.EPG_URL_PLACEHOLDER'
                                                    ) | translate
                                                "
                                                [attr.aria-label]="
                                                    (serverEpg()
                                                        ? 'SETTINGS.EPG_SERVER_URL_LABEL'
                                                        : 'SETTINGS.EPG_URL_LABEL'
                                                    ) | translate
                                                "
                                                #epgField
                                            />
                                            <mat-error>{{
                                                (serverEpg()
                                                    ? 'SETTINGS.EPG_SERVER_URL_ERROR'
                                                    : 'SETTINGS.EPG_URL_ERROR'
                                                ) | translate
                                            }}</mat-error>
```

Replace the format examples

```html
                        <code>https://example.org/guide.xml.gz</code>
                        <code>/home/you/epg/guide.xml</code>
                        <code>C:\epg\guide.xml.gz</code>
                        <code>file:///…/guide.xml</code>
```

with

```html
                        <code>https://example.org/guide.xml.gz</code>
                        @if (!serverEpg()) {
                            <code>/home/you/epg/guide.xml</code>
                            <code>C:\epg\guide.xml.gz</code>
                            <code>file:///…/guide.xml</code>
                        }
```

Insert the server section between the Sources and the Xtream sections, inside the XMLTV block: replace

```html
        </section>

        <section class="settings-section">
            <div class="settings-section__header">
                <h3>{{ 'SETTINGS.CARD_XTREAM_PLAYLISTS' | translate }}</h3>
```

with

```html
        </section>

        @if (serverEpg()) {
            <section class="settings-section" data-test-id="epg-server-section">
                <div class="settings-section__header">
                    <h3>{{ 'SETTINGS.CARD_SERVER_IMPORTS' | translate }}</h3>
                </div>
                <div class="settings-card">
                    @if (refreshTimeControl; as refreshTime) {
                        <div
                            class="setting-item"
                            data-setting-id="epg-server-refresh-time"
                        >
                            <div class="setting-item__meta">
                                <h4 id="epg-server-refresh-time-label">
                                    {{
                                        'SETTINGS.EPG_SERVER_REFRESH_TIME'
                                            | translate
                                    }}
                                </h4>
                                <p>
                                    {{
                                        'SETTINGS.EPG_SERVER_REFRESH_TIME_DESCRIPTION'
                                            | translate
                                    }}
                                </p>
                            </div>
                            <div
                                class="setting-item__control setting-item__control--stack"
                            >
                                <input
                                    type="time"
                                    class="settings-time-input"
                                    [class.settings-time-input--invalid]="
                                        refreshTime.invalid
                                    "
                                    formControlName="epgRefreshTime"
                                    aria-labelledby="epg-server-refresh-time-label"
                                    data-test-id="epg-server-refresh-time"
                                />
                                @if (refreshTime.invalid) {
                                    <p
                                        class="settings-field-error"
                                        role="alert"
                                    >
                                        {{
                                            'SETTINGS.EPG_SERVER_REFRESH_TIME_ERROR'
                                                | translate
                                        }}
                                    </p>
                                }
                                <app-settings-epg-server-schedule />
                            </div>
                        </div>
                    }
                    <div
                        class="setting-item setting-item--full-control"
                        data-setting-id="epg-server-imports"
                    >
                        <div class="setting-item__meta">
                            <h4>
                                {{ 'SETTINGS.EPG_SERVER_IMPORTS' | translate }}
                            </h4>
                            <p>
                                {{
                                    'SETTINGS.EPG_SERVER_IMPORTS_DESCRIPTION'
                                        | translate
                                }}
                            </p>
                        </div>
                        <div class="setting-item__control">
                            <app-settings-epg-server-imports />
                        </div>
                    </div>
                </div>
            </section>
        }

        <section class="settings-section">
            <div class="settings-section__header">
                <h3>{{ 'SETTINGS.CARD_XTREAM_PLAYLISTS' | translate }}</h3>
```

In the `epg-clear-data` row, replace

```html
                <div class="setting-item" data-setting-id="epg-clear-data">
                    <div class="setting-item__meta">
                        <h4>{{ 'SETTINGS.CLEAR_EPG_DATA' | translate }}</h4>
                        <p>
                            {{
                                'SETTINGS.CLEAR_EPG_DATA_DESCRIPTION'
                                    | translate
                            }}
                        </p>
                    </div>
```

with

```html
                <div class="setting-item" data-setting-id="epg-clear-data">
                    <div class="setting-item__meta">
                        <h4>{{ 'SETTINGS.CLEAR_EPG_DATA' | translate }}</h4>
                        <p>
                            {{
                                'SETTINGS.CLEAR_EPG_DATA_DESCRIPTION'
                                    | translate
                            }}
                        </p>
                        @if (serverEpg()) {
                            <p class="server-detail">
                                {{
                                    'SETTINGS.CLEAR_EPG_DATA_SERVER_NOTE'
                                        | translate
                                }}
                            </p>
                        }
                    </div>
```

(The first `<p>` of `epg-clear-data` stays the same: the search registry spec compares it with the index entry.) Check the result:

```bash
pnpm exec prettier --check apps/web/src/app/settings/settings-epg-section.component.html
grep -n "showsXmltvSources\|serverEpg()\|data-setting-id" apps/web/src/app/settings/settings-epg-section.component.html
```

Expected: Prettier reports no change; the grep shows `epg-view-mode` and `epg-offset` before `@if (showsXmltvSources())`, then `epg-sources`, `@if (serverEpg())` with `epg-server-refresh-time` and `epg-server-imports`, then `prefer-uploaded-epg` and `epg-clear-data`.

In `settings-epg-section.component.scss`, replace

```scss
.settings-field-error {
    margin: 0;
    color: var(--mat-sys-error);
    font-size: 12px;
    line-height: 1.4;
    text-align: right;
}
```

with

```scss
.settings-field-error {
    margin: 0;
    color: var(--mat-sys-error);
    font-size: 12px;
    line-height: 1.4;
    text-align: right;
}

// Time field (server EPG: daily refresh), drawn like the stepper.
.settings-time-input {
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--settings-control-border);
    border-radius: 8px;
    background: var(--settings-control-bg);
    color: var(--app-heading-color);
    font: inherit;
    font-size: 13px;
    font-variant-numeric: tabular-nums;

    &:focus-visible {
        @include focus-ring.focus-ring-declarations($offset: 1px);
    }

    &:disabled {
        opacity: 0.6;
    }
}

.settings-time-input--invalid {
    border-color: var(--mat-sys-error);
}
```

- [ ] **Step 8: Run to verify they pass**

```bash
pnpm nx test web --testPathPatterns="settings-epg-server|settings-epg-section"
pnpm nx lint web
pnpm run a11y:icon-buttons:validate
pnpm run styles:theme-references:validate
pnpm run styles:font-weights:validate
pnpm run ui:form-field-defaults:validate
```

Expected: PASS. The settings-search registry spec now FAILS (`epg-server-refresh-time`, `epg-server-imports` are anchored but not registered); Task 16 registers them. Do not commit until Task 16 Step 4 passes, or commit both tasks together there.

- [ ] **Step 9: Commit (together with Task 16)**

Continue with Task 16; its commit includes these files.

---

### Task 16: Settings search

**Files:**
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search.types.ts:17-18`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.ts:68`
- Create: `libs/workspace/shell/util/src/lib/settings-search/settings-search-entries-server-epg.ts`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search-entries.ts:1`, `:121-127`
- Test: `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.spec.ts`
- Test (existing, now passing again): `apps/web/src/app/settings/settings-search-registry.spec.ts`

The search files are as 3a's Task 11 left them: `RuntimeStub` in the spec has `supportsEpg` and `supportsProviderEpg`, `capabilities()` has `'epg-display'`, and the EPG section and its view-mode and offset rows require `'epg-display'`. None of the lines below is one 3a changed. The new rows require `'epg'` (XMLTV sources) and `'server-epg'`, so they appear exactly where the template renders them: inside 3a's XMLTV block, in server mode with server EPG.

- [ ] **Step 1: Write the failing spec changes**

In `settings-search.service.spec.ts`, replace

```ts
function setup(runtime: Partial<RuntimeStub> = {}, serverStorage = false) {
```

with

```ts
function setup(
    runtime: Partial<RuntimeStub> = {},
    serverStorage = false,
    serverEpg = false
) {
```

replace

```ts
                useValue: { isActive: () => serverStorage },
```

with

```ts
                useValue: {
                    isActive: () => serverStorage,
                    epgEnabled: () => serverEpg,
                },
```

replace

```ts
        expect(entries.length).toBe(SETTINGS_SEARCH_ENTRIES.length - 8);
```

with

```ts
        // Server EPG rows need a server that imports EPG.
        expect(entries).not.toContain('epg-server-refresh-time');
        expect(entries.length).toBe(SETTINGS_SEARCH_ENTRIES.length - 10);
```

and append after the "offers the server section and rows with server storage" test:

```ts
    it('offers the server EPG rows only when the server imports EPG', () => {
        const pwaEpg = {
            supportsEpgImport: true,
            supportsEpgDataManagement: true,
        };
        const withoutEpg = setup(pwaEpg, true)
            .service.visibleEntries()
            .map(({ id }) => id);
        TestBed.resetTestingModule();
        const withEpg = setup(pwaEpg, true, true)
            .service.visibleEntries()
            .map(({ id }) => id);

        expect(withoutEpg).not.toContain('epg-server-refresh-time');
        expect(withoutEpg).not.toContain('epg-server-imports');
        expect(withEpg).toEqual(
            expect.arrayContaining([
                'epg-sources',
                'epg-server-refresh-time',
                'epg-server-imports',
            ])
        );
    });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm nx test workspace-shell-util --testPathPatterns=settings-search
pnpm nx test web --testPathPatterns=settings-search-registry
```

Expected: FAIL (count, and the rows are not in the index).

- [ ] **Step 3: Implement**

In `settings-search.types.ts`, replace

```ts
    /** The PWA runs against self-hosted server storage. */
    | 'server-storage';
```

with

```ts
    /** The PWA runs against self-hosted server storage. */
    | 'server-storage'
    /** That server imports XMLTV (`features.epg`). */
    | 'server-epg';
```

In `settings-search.service.ts`, replace

```ts
            'server-storage': this.serverStorageStatus.isActive(),
```

with

```ts
            'server-storage': this.serverStorageStatus.isActive(),
            'server-epg': this.serverStorageStatus.epgEnabled(),
```

Create `settings-search-entries-server-epg.ts`:

```ts
import { SettingsSearchEntry } from './settings-search.types';

const SERVER_EPG_KEYWORDS = [
    'epg',
    'xmltv',
    'tv guide',
    'server',
    'self-hosted',
    'docker',
];

/** Settings → EPG rows only a server with EPG renders. */
export const SERVER_EPG_SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] =
    [
        {
            id: 'epg-server-refresh-time',
            section: 'epg',
            labelKey: 'SETTINGS.EPG_SERVER_REFRESH_TIME',
            descriptionKey: 'SETTINGS.EPG_SERVER_REFRESH_TIME_DESCRIPTION',
            keywords: [
                ...SERVER_EPG_KEYWORDS,
                'schedule',
                'refresh',
                'time',
                'nightly',
            ],
            requires: ['epg', 'server-epg'],
        },
        {
            id: 'epg-server-imports',
            section: 'epg',
            labelKey: 'SETTINGS.EPG_SERVER_IMPORTS',
            descriptionKey: 'SETTINGS.EPG_SERVER_IMPORTS_DESCRIPTION',
            keywords: [...SERVER_EPG_KEYWORDS, 'import', 'status', 'error'],
            requires: ['epg', 'server-epg'],
        },
    ];
```

In `settings-search-entries.ts`, replace

```ts
import { PLAYBACK_SETTINGS_SEARCH_ENTRIES } from './settings-search-entries-playback';
```

with

```ts
import { PLAYBACK_SETTINGS_SEARCH_ENTRIES } from './settings-search-entries-playback';
import { SERVER_EPG_SETTINGS_SEARCH_ENTRIES } from './settings-search-entries-server-epg';
```

and replace

```ts
        keywords: ['epg', 'clear', 'delete', 'programme', 'cache', 'reset'],
        requires: ['epg'],
    },
```

with

```ts
        keywords: ['epg', 'clear', 'delete', 'programme', 'cache', 'reset'],
        requires: ['epg'],
    },
    ...SERVER_EPG_SETTINGS_SEARCH_ENTRIES,
```

Add the English texts the registry spec checks to `apps/web/src/assets/i18n/en.json` now (all Task 17 keys; Task 17 then translates them). Do Task 17 Step 1 at this point.

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test workspace-shell-util
pnpm nx test web --testPathPatterns="settings"
pnpm nx lint workspace-shell-util
```

Expected: PASS, including `settings-search-registry.spec.ts` ("anchors every titled settings row", "indexes the same title and description", "uses translation keys that exist in English").

- [ ] **Step 5: Commit Tasks 15 and 16**

```bash
git add libs/ui/epg/src/index.ts apps/web/src/app/settings/settings-epg-server-rows.ts apps/web/src/app/settings/settings-epg-server-rows.spec.ts apps/web/src/app/settings/settings-epg-server-imports.component.ts apps/web/src/app/settings/settings-epg-server-imports.component.html apps/web/src/app/settings/settings-epg-server-imports.component.scss apps/web/src/app/settings/settings-epg-server-imports.component.spec.ts apps/web/src/app/settings/settings-epg-server-schedule.component.ts apps/web/src/app/settings/settings-epg-server-schedule.component.spec.ts apps/web/src/app/settings/settings-epg-section.component.ts apps/web/src/app/settings/settings-epg-section.component.html apps/web/src/app/settings/settings-epg-section.component.scss apps/web/src/app/settings/settings-epg-section.component.spec.ts libs/workspace/shell/util/src/lib/settings-search apps/web/src/assets/i18n/en.json
git commit -m "feat(settings): server view for Settings → EPG

Shared-list label, the daily refresh time field (saved with the Save
bar) with the server's time zone and next run, and every source the
server imports with its state, last import, counts and errors;
searchable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 17: Translations

**Files:**
- Modify: `apps/web/src/assets/i18n/en.json` and the 18 other locale files in that folder (`ar, ary, by, de, el, es, fr, hu, it, ja, ko, nl, pl, pt, ru, tr, zh, zhtw`)
- Modify (only if Step 3 needs it): `tools/i18n/identical-en-baseline.json`

- [ ] **Step 1: English source**

In `en.json`, inside `SETTINGS`, replace the three lines Task 14 added after `"EPG_VIEW_MODE_LIST": "List",` (`EPG_SERVER_URL_ERROR`, `EPG_SERVER_SAVE_FAILED`, `EPG_SERVER_REFRESH_TIME_ERROR`) with the block below, which contains them with the same texts, so every locale gets the keys in this order.

```json
        "EPG_SERVER_SOURCES_HINT": "Shared by every device of this server. The server downloads XMLTV links (http or https), as plain .xml or gzip-compressed .xml.gz.",
        "EPG_SERVER_EMPTY_HINT": "Add an XMLTV link. The server downloads it and keeps the guide for every device.",
        "EPG_SERVER_URL_LABEL": "EPG source link (*.xml or *.xml.gz)",
        "EPG_SERVER_URL_PLACEHOLDER": "Enter an http or https link",
        "EPG_SERVER_URL_ERROR": "Enter an http(s) link. The server cannot read files on this device or links with a user name or password.",
        "EPG_SERVER_SAVE_FAILED": "Could not save the EPG sources on the server. Check the connection and the links, then try again.",
        "CARD_SERVER_IMPORTS": "On the server",
        "EPG_SERVER_REFRESH_TIME": "Daily refresh",
        "EPG_SERVER_REFRESH_TIME_DESCRIPTION": "The server downloads every source again once a day at this time, in its own time zone.",
        "EPG_SERVER_REFRESH_TIME_ERROR": "Enter a time from 00:00 to 23:59.",
        "EPG_SERVER_SCHEDULE": "Server time zone: {{zone}}. Next refresh: {{next}}.",
        "EPG_SERVER_TIME_ZONE": "Server time zone: {{zone}}.",
        "EPG_SERVER_IMPORTS": "Imported sources",
        "EPG_SERVER_IMPORTS_DESCRIPTION": "Every source the server keeps a guide for: this list and the EPG sources of the playlists on the server.",
        "EPG_SERVER_IMPORTS_EMPTY": "No sources yet.",
        "EPG_SERVER_IMPORTS_UNAVAILABLE": "The import status cannot be read right now.",
        "EPG_SERVER_TOTALS": "{{programmes}} programmes · {{size}} on the server",
        "EPG_SERVER_OWNER_LIST": "This list",
        "EPG_SERVER_OWNER_PLAYLISTS": "Playlists: {{count}}",
        "EPG_SERVER_LAST_IMPORT": "Last import {{date}}",
        "EPG_SERVER_COUNTS": "{{channels}} channels · {{programmes}} programmes",
        "EPG_SERVER_NOT_IMPORTED": "Not imported yet",
        "CLEAR_EPG_DATA_SERVER_NOTE": "With server storage this clears the guide on the server for every device, then imports every source again.",
```

After the `SERVER_STORAGE` object (`"DELETE_ALL_WARNING": …` then `},`), add a new top-level object:

```json
    "SERVER_EPG": {
        "UNREACHABLE": "The server is not reachable.",
        "NOT_IMPORTED": "The server did not import this source. It imports saved sources only.",
        "ERROR_HTTP_STATUS": "The source answered with an error.",
        "ERROR_NETWORK": "The server could not connect to the source.",
        "ERROR_TIMEOUT": "The download took too long.",
        "ERROR_TOO_LARGE": "The guide is larger than the server accepts. Raise IPTVNATOR_EPG_MAX_MB on the server to allow it.",
        "ERROR_PARSE_FAILED": "The file is not a readable XMLTV guide.",
        "ERROR_EMPTY": "The guide contains no channels or programmes.",
        "ERROR_TOO_MANY_SOURCES": "The server imports at most 100 sources, so it skipped this one.",
        "ERROR_PRIVATE_NETWORK": "{{host}} is in a private network. Set IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1 on the server to allow it.",
        "ERROR_TLS": "The server does not trust the certificate of {{host}}. Give it the certificate authority with NODE_EXTRA_CA_CERTS.",
        "ERROR_UNKNOWN": "The import failed."
    },
```

That is 23 `SETTINGS` keys and 12 `SERVER_EPG` keys.

- [ ] **Step 2: Every other locale**

Add the same keys at the same positions in each of `ar.json, ary.json, by.json, de.json, el.json, es.json, fr.json, hu.json, it.json, ja.json, ko.json, nl.json, pl.json, pt.json, ru.json, tr.json, zh.json, zhtw.json`. Translate every value into that language, matching the tone and terms of the file's existing EPG and server strings (for example its `SETTINGS.EPG_STATUS_FRESH`, `SETTINGS.SERVER_DESCRIPTION`, `EPG.QUEUED`). Keep unchanged: `XMLTV`, `EPG`, `http`, `https`, `.xml`, `.xml.gz`, `IPTVNATOR_EPG_MAX_MB`, `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS=1`, `NODE_EXTRA_CA_CERTS`, the placeholders `{{zone}}`, `{{next}}`, `{{programmes}}`, `{{size}}`, `{{count}}`, `{{date}}`, `{{channels}}`, `{{host}}`, and the `·` separator.

- [ ] **Step 3: Check**

```bash
pnpm run i18n:check
```

Expected: pass. If a value is legitimately identical to English in a locale (for example `"EPG_SERVER_URL_LABEL"` where a language keeps the technical words), run `pnpm run i18n:baseline:update`, check with `git diff tools/i18n/identical-en-baseline.json` that only such new keys were added, and run the check again.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/assets/i18n tools/i18n/identical-en-baseline.json
git commit -m "feat(i18n): server EPG strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Playlist info → EPG sources in server mode

**Files:**
- Modify: `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.ts:36-50`, `:196`, `:902-907`
- Modify: `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.html:328-339`
- Test: `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info-epg-sources.component.spec.ts`

Two things in server mode. Refresh: `canRefreshPlaylistEpg` (`playlist-info.component.ts:233-235`) is `epgBridge.supportsDataManagement`, which the server backend has (Task 9 asserts it), and `refreshPlaylistEpgSource` (`:639-660`) shows `EPG.FETCH_SUCCESS`/`EPG.ERROR` once the backend resolves, i.e. after the import finished; no production change, a test pins it. New sources: the server cannot read files on this device, so the playlist's EPG inputs take `http(s)` links only (`validateRemoteEpgSourceControl`, Task 14) and say why with `SETTINGS.EPG_SERVER_URL_ERROR`; the file picker is already hidden (no `openEpgFileDialog`). `playlist-info.component.ts` is in the max-lines baseline; it grows by three lines.

- [ ] **Step 1: Write the failing tests**

In the spec, add `import { ServerStorageStatusService } from '@iptvnator/services';` to the existing `@iptvnator/services` import, change `function render() {` to `function render(options: { serverEpg?: boolean } = {}) {`, add `forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),` to the `EpgRuntimeBridgeService` value, replace

```ts
                    useValue: { getSettings: jest.fn(() => ({ epgUrl: [] })) },
```

with

```ts
                    useValue: {
                        getSettings: jest.fn(() => ({ epgUrl: [] })),
                        getTrustOptions: jest.fn(() => ({})),
                    },
```

and replace, at the end of `render()`,

```ts
        const fixture = TestBed.createComponent(PlaylistInfoComponent);
        fixture.detectChanges();
        return fixture;
```

with

```ts
        if (options.serverEpg) {
            TestBed.inject(ServerStorageStatusService).activate(
                {
                    service: 'iptvnator',
                    apiVersion: 1,
                    instanceId: 'i-1',
                    storage: 'server',
                    auth: 'none',
                    features: { epg: true },
                },
                jest.fn()
            );
        }
        const fixture = TestBed.createComponent(PlaylistInfoComponent);
        fixture.detectChanges();
        return fixture;
```

Append inside the describe:

```ts
    it('refreshes a source on whichever backend manages EPG data', async () => {
        const fixture = render({ serverEpg: true });
        fixture.autoDetectChanges();
        await fixture.whenStable();
        const bridge = TestBed.inject(
            EpgRuntimeBridgeService
        ) as unknown as { forceFetchEpg: jest.Mock };
        const snackBar = TestBed.inject(MatSnackBar) as unknown as {
            open: jest.Mock;
        };
        const refresh = (
            fixture.nativeElement as HTMLElement
        ).querySelector<HTMLButtonElement>(
            '.playlist-epg-source-row button[aria-label="SETTINGS.REFRESH_EPG"]'
        );

        expect(refresh?.disabled).toBe(false);
        refresh?.click();
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));

        expect(bridge.forceFetchEpg).toHaveBeenCalledWith(keepUrl, {});
        expect(snackBar.open).toHaveBeenCalledWith(
            'EPG.FETCH_SUCCESS',
            'CLOSE',
            { duration: 3000 }
        );
    });

    it('refuses local files in server mode and says why', () => {
        const fixture = render({ serverEpg: true });
        const host = fixture.nativeElement as HTMLElement;
        const control =
            fixture.componentInstance.playlistEpgSourceInputs.at(0);

        expect(
            host.querySelector('.playlist-epg-source-form mat-label')
                ?.textContent
        ).toContain('SETTINGS.EPG_SERVER_URL_LABEL');

        control.setValue('/home/me/epg/guide.xml');
        control.markAsTouched();
        fixture.componentRef.changeDetectorRef.markForCheck();
        fixture.detectChanges();

        expect(control.invalid).toBe(true);
        expect(
            host.querySelector('.playlist-epg-source-form mat-error')
                ?.textContent
        ).toContain('SETTINGS.EPG_SERVER_URL_ERROR');

        control.setValue('https://epg.example/guide.xml');
        expect(control.valid).toBe(true);
    });

    it('keeps local files on the desktop', () => {
        const fixture = render();
        const control =
            fixture.componentInstance.playlistEpgSourceInputs.at(0);

        control.setValue('/home/me/epg/guide.xml');

        expect(control.valid).toBe(true);
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test playlist-shared-ui --testPathPatterns=playlist-info-epg-sources`
Expected: the Refresh test and the desktop test PASS (they pin today's behaviour); "refuses local files in server mode" FAILS (the local path is valid, the label is `SETTINGS.EPG_URL_LABEL`).

- [ ] **Step 3: Implement**

In `playlist-info.component.ts`, replace

```ts
import {
    createXtreamConnectionTestState,
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
```

with

```ts
import {
    createXtreamConnectionTestState,
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    ServerStorageStatusService,
    SettingsStore,
} from '@iptvnator/services';
```

in the `@iptvnator/shared/interfaces` import replace `    validateEpgSourceReferenceControl,` with

```ts
    validateEpgSourceReferenceControl,
    validateRemoteEpgSourceControl,
```

replace

```ts
    private readonly settingsStore = inject(SettingsStore);
```

with

```ts
    private readonly settingsStore = inject(SettingsStore);
    /** Server EPG: the server downloads links only, never files here. */
    readonly serverEpg = inject(ServerStorageStatusService).epgEnabled();
```

and replace

```ts
    private createPlaylistEpgSourceControl(value = ''): FormControl<string> {
        return new FormControl(value, {
            nonNullable: true,
            validators: [validateEpgSourceReferenceControl],
        });
    }
```

with

```ts
    private createPlaylistEpgSourceControl(value = ''): FormControl<string> {
        return new FormControl(value, {
            nonNullable: true,
            validators: [
                this.serverEpg
                    ? validateRemoteEpgSourceControl
                    : validateEpgSourceReferenceControl,
            ],
        });
    }
```

In `playlist-info.component.html`, inside the `playlist-epg-source-form` block, replace

```html
                                    <mat-label>{{
                                        'SETTINGS.EPG_URL_LABEL' | translate
                                    }}</mat-label>
                                    <input
                                        matInput
                                        [formControlName]="$index"
                                    />
                                    @if (control.invalid && control.touched) {
                                        <mat-error>{{
                                            'SETTINGS.EPG_URL_ERROR' | translate
                                        }}</mat-error>
                                    }
```

with

```html
                                    <mat-label>{{
                                        (serverEpg
                                            ? 'SETTINGS.EPG_SERVER_URL_LABEL'
                                            : 'SETTINGS.EPG_URL_LABEL'
                                        ) | translate
                                    }}</mat-label>
                                    <input
                                        matInput
                                        [formControlName]="$index"
                                    />
                                    @if (control.invalid && control.touched) {
                                        <mat-error>{{
                                            (serverEpg
                                                ? 'SETTINGS.EPG_SERVER_URL_ERROR'
                                                : 'SETTINGS.EPG_URL_ERROR'
                                            ) | translate
                                        }}</mat-error>
                                    }
```

(the read-only rows above it keep `SETTINGS.EPG_URL_LABEL`: they show stored sources).

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test playlist-shared-ui --testPathPatterns=playlist-info
pnpm nx lint playlist-shared-ui
```

Expected: PASS; lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.ts libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.html libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info-epg-sources.component.spec.ts
git commit -m "feat(playlist): server EPG sources of a playlist are http(s) links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: `/parse` keeps header EPG URLs

**Files:**
- Modify: `apps/web-backend/src/app/web-backend-app.ts:11-17`, `:637-683`
- Test: `apps/web-backend/src/app/web-backend-app.spec.ts`

`web-backend-app.ts` is in the max-lines baseline; this change removes more lines than it adds.

- [ ] **Step 1: Write the failing test**

Append after "extracts KODIPROP ClearKey DRM on the /parse URL-import path" in `web-backend-app.spec.ts`:

```ts
    it('keeps the header EPG sources of a playlist imported by URL', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueResponse(`#EXTM3U x-tvg-url="https://epg.example/guide.xml.gz" url-tvg="https://epg.example/extra.xml"
#EXTINF:-1 tvg-id="news",News
https://stream.example/news.m3u8`);

        await withServer(
            createWebBackendApp({
                guid: () => 'fixed-id',
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/list.m3u'
                );
                const response = await fetch(
                    `${baseUrl}/parse?targetId=${targetId}`
                );
                const body = (await response.json()) as {
                    epgUrls?: string[];
                    detectedEpgUrls?: string[];
                };

                expect(response.status).toBe(200);
                expect(body.detectedEpgUrls).toEqual([
                    'https://epg.example/guide.xml.gz',
                    'https://epg.example/extra.xml',
                ]);
                expect(body.epgUrls).toEqual(body.detectedEpgUrls);
            }
        );
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns=web-backend-app.spec`
Expected: FAIL, `detectedEpgUrls` is `undefined`.

- [ ] **Step 3: Implement**

In `web-backend-app.ts`, replace

```ts
import {
    buildStalkerIdentityRequestContext,
    buildStalkerRequestUrl,
    normalizeXtreamServerUrl,
    describeXtreamConnectionFailure,
} from '@iptvnator/shared/interfaces';
import { extractDrmFromRaw } from '@iptvnator/shared/m3u-utils';
```

with

```ts
import {
    buildStalkerIdentityRequestContext,
    buildStalkerRequestUrl,
    normalizeXtreamServerUrl,
    describeXtreamConnectionFailure,
    type ParsedPlaylist,
} from '@iptvnator/shared/interfaces';
import { createPlaylistObject as createSharedPlaylistObject } from '@iptvnator/shared/m3u-utils';
```

and replace the two functions

```ts
function parsePlaylist(playlist: string): {
    items: Array<Record<string, unknown>>;
} {
    return parser.parse(playlist) as unknown as {
        items: Array<Record<string, unknown>>;
    };
}

function createPlaylistObject(options: {
    readonly guid: () => string;
    readonly now: () => Date;
    readonly playlist: { items: Array<Record<string, unknown>> };
    readonly title: string;
    readonly url: string;
}): Record<string, unknown> {
    const timestamp = options.now().toISOString();
    const id = options.guid();
    return {
        id,
        _id: id,
        filename: options.title,
        title: options.title,
        count: options.playlist.items.length,
        playlist: {
            ...options.playlist,
            items: options.playlist.items.map((item) => {
                // Keep this builder aligned with the shared
                // createPlaylistObject() in @iptvnator/shared/m3u-utils:
                // KODIPROP ClearKey DRM must survive the /parse URL-import
                // path too.
                const drm = extractDrmFromRaw(
                    typeof item['raw'] === 'string' ? item['raw'] : undefined
                );
                return {
                    id: options.guid(),
                    ...item,
                    ...(drm ? { drm } : {}),
                };
            }),
        },
        importDate: timestamp,
        lastUsage: timestamp,
        favorites: [],
        autoRefresh: false,
        url: options.url,
    };
}
```

with

```ts
function parsePlaylist(playlist: string): ParsedPlaylist {
    return parser.parse(playlist) as unknown as ParsedPlaylist;
}

/**
 * The shared builder, as a file import in the PWA uses it: the header's
 * `x-tvg-url`/`url-tvg` sources and KODIPROP ClearKey DRM survive. Ids and
 * dates come from the injected `guid` and `now`.
 */
function createPlaylistObject(options: {
    readonly guid: () => string;
    readonly now: () => Date;
    readonly playlist: ParsedPlaylist;
    readonly title: string;
    readonly url: string;
}): Record<string, unknown> {
    const shared = createSharedPlaylistObject(
        options.title,
        options.playlist,
        options.url,
        'URL'
    );
    const items = (shared.playlist as { items: Record<string, unknown>[] })
        .items;
    const timestamp = options.now().toISOString();
    const id = options.guid();
    return {
        ...shared,
        id,
        _id: id,
        importDate: timestamp,
        lastUsage: timestamp,
        playlist: {
            ...shared.playlist,
            items: items.map((item) => ({ ...item, id: options.guid() })),
        },
    };
}
```

`handlePlaylistParse` keeps calling `parsePlaylist(response.data)` and `createPlaylistObject({ … playlist: parsedPlaylist … })` unchanged.

- [ ] **Step 4: Run to verify it passes, and the baseline**

```bash
pnpm nx test web-backend --testPathPatterns=web-backend-app
pnpm nx lint web-backend
git diff --stat apps/web-backend/src/app/web-backend-app.ts
```

Expected: PASS (the existing shape test still sees `_id`/`id` `fixed-id-1`, item `id` `fixed-id-2`, the injected dates and the URL; the DRM test passes through the shared builder); the diff stat shows more deletions than insertions.

- [ ] **Step 5: Commit**

```bash
git add apps/web-backend/src/app/web-backend-app.ts apps/web-backend/src/app/web-backend-app.spec.ts
git commit -m "fix(web-backend): keep header EPG sources of URL-imported playlists

/parse built playlists with its own copy of createPlaylistObject, which
dropped x-tvg-url and url-tvg. It now uses the shared builder.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Server EPG on by default

**Files:**
- Modify: `apps/web-backend/src/app/epg/epg-config.ts` (from 3c)
- Test: `apps/web-backend/src/app/epg/epg-config.spec.ts` (from 3c)
- Modify: `apps/web-backend/src/app/epg/open-server-epg.ts` (from 3c)
- Test: `apps/web-backend/src/app/epg/open-server-epg.spec.ts` (from 3c)
- Modify: `docker/docker-compose.yml` (the commented EPG block 3c added)
- Modify: `apps/web-e2e/playwright.config.ts:141-150`
- Modify: `apps/web-backend/src/app/project-config.spec.ts:51-52`

The snippets below are 3c's code as `.plans/2026-10-15-server-epg-3c-backend.md` writes it (tasks "epg-config", "openServerEpg", "Docker"). Task 1 Step 6 compared them with the merged code; use the merged text where it differs.

- [ ] **Step 1: Write the failing tests**

In `epg-config.spec.ts`, replace the two tests

```ts
    it('keeps server EPG off by default', () => {
        expect(readServerEpgConfig({})).toEqual({
            enabled: false,
            allowPrivateNetworks: false,
            maxDecompressedBytes: GIB,
        });
    });

    it('turns server EPG on only for on, 1 or true', () => {
        for (const value of ['on', ' ON ', '1', 'true']) {
            expect(readServerEpgConfig({ IPTVNATOR_EPG: value }).enabled).toBe(
                true
            );
        }
        for (const value of ['off', '0', 'yes', '']) {
            expect(readServerEpgConfig({ IPTVNATOR_EPG: value }).enabled).toBe(
                false
            );
        }
    });
```

with

```ts
    it('turns server EPG on by default', () => {
        expect(readServerEpgConfig({})).toEqual({
            enabled: true,
            allowPrivateNetworks: false,
            maxDecompressedBytes: GIB,
        });
    });

    it('turns server EPG off only for off, 0 or false', () => {
        for (const value of ['off', ' OFF ', '0', 'false']) {
            expect(readServerEpgConfig({ IPTVNATOR_EPG: value }).enabled).toBe(
                false
            );
        }
        for (const value of ['on', '1', 'true', '']) {
            expect(readServerEpgConfig({ IPTVNATOR_EPG: value }).enabled).toBe(
                true
            );
        }
    });
```

In `open-server-epg.spec.ts`, replace

```ts
    it('stays off unless IPTVNATOR_EPG is on', () =>
        withTempStorage((storage) => {
            for (const env of [{}, { IPTVNATOR_EPG: 'off' }]) {
```

with

```ts
    it('stays off when IPTVNATOR_EPG is off', () =>
        withTempStorage((storage) => {
            for (const env of [
                { IPTVNATOR_EPG: 'off' },
                { IPTVNATOR_EPG: '0' },
            ]) {
```

and add after the test `'stays off without server storage and says why'`:

```ts
    it('stays off quietly without server storage when only the default turns it on', () => {
        const logs: string[] = [];

        expect(
            openServerEpg({
                storage: null,
                rootDir: WORKER_ROOT,
                env: {},
                logger: silentLogger(logs),
            })
        ).toBeNull();
        // A stateless backend (IPTVNATOR_STORAGE=none) must not complain.
        expect(logs).toEqual([]);
    });
```

In `project-config.spec.ts`, replace

```ts
                expect(storageEntry).toContain(`IPTVNATOR_STORAGE: 'server'`);
                expect(storageEntry).toContain('PORT: storageBackendPort,');
```

with

```ts
                expect(storageEntry).toContain(`IPTVNATOR_STORAGE: 'server'`);
                expect(storageEntry).toContain(`IPTVNATOR_EPG: 'on'`);
                expect(storageEntry).toContain('PORT: storageBackendPort,');
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test web-backend --testPathPatterns="epg-config|open-server-epg|project-config"`
Expected: the two `epg-config` tests and the `project-config` test FAIL. The new `open-server-epg` test passes already (with the old default nothing is enabled); it guards the quiet start once Step 3 flips the default.

- [ ] **Step 3: Implement**

In `epg-config.ts`, replace

```ts
    /** `IPTVNATOR_EPG=on`; `off` by default until the PWA uses it (3d). */
    readonly enabled: boolean;
```

with

```ts
    /**
     * `IPTVNATOR_EPG`: on by default (used only with server storage);
     * `off`, `0` or `false` turn it off.
     */
    readonly enabled: boolean;
```

replace

```ts
const ENABLED_VALUES = new Set(['on', '1', 'true']);
```

with

```ts
const DISABLED_VALUES = new Set(['off', '0', 'false']);
```

and replace

```ts
        enabled: ENABLED_VALUES.has(
            env['IPTVNATOR_EPG']?.trim().toLowerCase() ?? ''
        ),
```

with

```ts
        enabled: !DISABLED_VALUES.has(
            env['IPTVNATOR_EPG']?.trim().toLowerCase() ?? ''
        ),
```

In `open-server-epg.ts`, replace

```ts
    const logger = options.logger ?? consoleEpgLogger;
    const config = readServerEpgConfig(options.env);
    if (!config.enabled) {
        return null;
    }
    if (!options.storage) {
        logger.error(
            '[web-backend] IPTVNATOR_EPG=on needs IPTVNATOR_STORAGE=server; server EPG stays off.'
        );
        return null;
    }
```

with

```ts
    const logger = options.logger ?? consoleEpgLogger;
    const env = options.env ?? process.env;
    const config = readServerEpgConfig(env);
    if (!config.enabled) {
        return null;
    }
    if (!options.storage) {
        // On by default: only an explicit request without storage is news.
        if (env['IPTVNATOR_EPG']?.trim()) {
            logger.error(
                '[web-backend] IPTVNATOR_EPG=on needs IPTVNATOR_STORAGE=server; server EPG stays off.'
            );
        }
        return null;
    }
```

In `docker/docker-compose.yml`, replace

```yaml
      # Server-side XMLTV guides (needs IPTVNATOR_STORAGE=server). Off until
      # the browser app uses them; see docker/README.md#server-epg.
      # IPTVNATOR_EPG: "on"
```

with

```yaml
      # Server-side XMLTV guides, on by default with server storage; see
      # docker/README.md#server-epg.
      # IPTVNATOR_EPG: "off"
```

In `apps/web-e2e/playwright.config.ts`, replace

```ts
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_DATA_DIR: storageBackendDataDir,
```

with

```ts
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_DATA_DIR: storageBackendDataDir,
                // The default, spelled out: server-epg.e2e.ts needs it, and
                // the proxy flag above lets it import from the local mock.
                IPTVNATOR_EPG: 'on',
```

and in the comment above that `webServer` entry replace

```ts
        /* A second backend with server storage, used only by
         * server-storage.e2e.ts; the specs above keep the stateless one.
```

with

```ts
        /* A second backend with server storage and server EPG, used by
         * server-storage.e2e.ts and server-epg.e2e.ts; the specs above keep
         * the stateless one.
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm nx test web-backend --testPathPatterns="epg-config|open-server-epg|project-config"
pnpm nx test web-backend
pnpm run e2e:task-graphs:validate
docker compose -f docker/docker-compose.yml config > /dev/null
```

Expected: PASS. If another 3c test relied on the old default (it creates server storage without an `IPTVNATOR_EPG` env and expects no EPG), give it `IPTVNATOR_EPG: 'off'` explicitly; do not weaken its assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/web-backend/src/app/epg/epg-config.ts apps/web-backend/src/app/epg/epg-config.spec.ts apps/web-backend/src/app/epg/open-server-epg.ts apps/web-backend/src/app/epg/open-server-epg.spec.ts apps/web-backend/src/app/project-config.spec.ts apps/web-e2e/playwright.config.ts docker/docker-compose.yml
git commit -m "feat(self-hosted): server EPG on by default with server storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: End-to-end coverage

**Files:**
- Create: `apps/web-e2e/src/storage-backend.helpers.ts`
- Modify: `apps/web-e2e/src/server-storage.e2e.ts:1-25`, `:110-118`
- Create: `apps/web-e2e/src/server-epg.e2e.ts`
- Modify: `docs/architecture/validation-map.md` (E2E table, tag list)

The xtream mock serves `/demo/guide.xml` (`apps/xtream-mock-server/src/app/demo-xmltv.ts`): eight 30-minute programmes per marketing channel from an hour before the request to three hours after, channel ids `<slug>.fictional`, display names equal to `MARKETING_LIVE_CHANNELS` names. The playlist below carries those names without `tvg-id`, so the lookup key is the name and the server matches it to the display name. The storage backend allows the loopback mock through `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1`, which implies the EPG switch (contract D).

- [ ] **Step 1: Shared helpers and the storage-backend lock**

`storage-backend.helpers.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';

const STORAGE_BACKEND_PORT = process.env['STORAGE_BACKEND_PORT'] ?? '3334';

/** The storage-enabled backend from playwright.config.ts. */
export const STORAGE_BACKEND_URL = `http://localhost:${STORAGE_BACKEND_PORT}`;

/** A fresh browser profile (a "device") whose runtime config points at it. */
export async function newServerPage(browser: Browser): Promise<Page> {
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

const LOCK_DIR = join(
    tmpdir(),
    `iptvnator-web-e2e-storage-${STORAGE_BACKEND_PORT}.lock`
);
const LOCK_PID_FILE = join(LOCK_DIR, 'pid');
const LOCK_TIMEOUT_MS = 10 * 60_000;
const LOCK_POLL_MS = 250;

/**
 * Specs that reset the storage backend's one database hold this lock for
 * their describe block: Playwright runs spec files in parallel workers, and
 * one file's reset must not land in another file's test. A lock whose
 * worker process is gone is taken over.
 */
export async function lockStorageBackend(): Promise<() => Promise<void>> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
        try {
            await mkdir(LOCK_DIR);
            await writeFile(LOCK_PID_FILE, String(process.pid));
            return () => rm(LOCK_DIR, { recursive: true, force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
        }
        if (await holderIsGone()) {
            await rm(LOCK_DIR, { recursive: true, force: true });
            continue;
        }
        if (Date.now() > deadline) {
            throw new Error(
                `Storage backend lock still held; remove ${LOCK_DIR} if no E2E run is active.`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
}

async function holderIsGone(): Promise<boolean> {
    let pid: number;
    try {
        pid = Number(await readFile(LOCK_PID_FILE, 'utf8'));
    } catch {
        // Created a moment ago; its pid follows.
        return false;
    }
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
}
```

In `server-storage.e2e.ts`, replace

```ts
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addM3uUrlPlaylist,
    openSources,
    sourceRowByTitle,
} from './sources-pwa.helpers';

/** The storage-enabled backend from playwright.config.ts. */
const STORAGE_BACKEND_URL = `http://localhost:${
    process.env['STORAGE_BACKEND_PORT'] ?? '3334'
}`;

/** A fresh browser profile (a "device") whose runtime config points at it. */
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
```

with

```ts
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addM3uUrlPlaylist,
    openSources,
    sourceRowByTitle,
} from './sources-pwa.helpers';
import {
    lockStorageBackend,
    newServerPage,
    STORAGE_BACKEND_URL,
} from './storage-backend.helpers';
```

and replace

```ts
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'One shared server database'
    );

    test.beforeEach(async ({ request }) => {
```

with

```ts
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'One shared server database'
    );

    let release: (() => Promise<void>) | undefined;
    test.beforeAll(async ({ browserName }) => {
        if (browserName === 'chromium') {
            release = await lockStorageBackend();
        }
    });
    test.afterAll(async () => {
        await release?.();
    });

    test.beforeEach(async ({ request }) => {
```

- [ ] **Step 2: The spec**

`server-epg.e2e.ts`:

```ts
import { Buffer } from 'node:buffer';
import type { APIRequestContext, Page } from '@playwright/test';
import { MARKETING_LIVE_CHANNELS } from '@iptvnator/shared/marketing-fixtures';
import { expect, test } from './fixtures';
import { XTREAM_MOCK_SERVER } from './sources-pwa.helpers';
import {
    lockStorageBackend,
    newServerPage,
    STORAGE_BACKEND_URL,
} from './storage-backend.helpers';

/** The Xtream mock's XMLTV for the marketing channels, times relative to now. */
const GUIDE_URL = `${XTREAM_MOCK_SERVER}/demo/guide.xml`;
const [AURORA] = MARKETING_LIVE_CHANNELS;
/** Whichever of its titles is on air: the guide is rendered at import time. */
const AURORA_TITLES = new RegExp(AURORA.epgTitles.join('|'));
/** Aired in three of the eight slots, so one is always in the guide. */
const SEARCH_TITLE = AURORA.epgTitles[0];

/**
 * Marketing channel names without `tvg-id`: the guide's channel ids
 * (`aurora-news.fictional`) match no playlist id, so the lookup key is the
 * name and the server matches it to the guide's display name.
 */
function marketingPlaylist(): string {
    return [
        '#EXTM3U',
        ...MARKETING_LIVE_CHANNELS.flatMap((channel, index) => [
            `#EXTINF:-1 tvg-name="${channel.name}" group-title="Server EPG",${channel.name}`,
            `https://streams.example.test/server-epg/${index + 1}.m3u8`,
        ]),
        '',
    ].join('\n');
}

/** Programmes the server imported from the guide; 0 until it finished. */
async function importedProgrammes(
    request: APIRequestContext
): Promise<number> {
    const response = await request.get(`${STORAGE_BACKEND_URL}/v1/epg/status`);
    if (!response.ok()) {
        return 0;
    }
    const body = (await response.json()) as {
        sources: { url: string; lastSuccessAt?: string; programmes?: number }[];
    };
    const source = body.sources.find((item) => item.url === GUIDE_URL);
    return source?.lastSuccessAt ? (source.programmes ?? 0) : 0;
}

async function openEpgSettings(page: Page): Promise<void> {
    await page.goto('/workspace/settings/epg');
    await page.waitForURL(/\/workspace\/settings\/epg$/);
    await expect(page.locator('app-settings-epg-section')).toBeVisible({
        timeout: 15_000,
    });
}

async function saveSettings(page: Page): Promise<void> {
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click();
    // A successful save marks the form pristine and hides the bar.
    await expect(save).toBeHidden({ timeout: 15_000 });
}

async function uploadMarketingPlaylist(page: Page): Promise<void> {
    await page.goto('/workspace/sources');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /M3U file/i }).click();
    await page.setInputFiles('input[type="file"]', {
        name: 'server-epg.m3u',
        mimeType: 'audio/x-mpegurl',
        buffer: Buffer.from(marketingPlaylist()),
    });
    const add = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(add).toBeEnabled();
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        add.click(),
    ]);
}

test.describe('server EPG @self-hosted @server-epg @epg', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'One shared server database'
    );

    let release: (() => Promise<void>) | undefined;
    test.beforeAll(async ({ browserName }) => {
        if (browserName === 'chromium') {
            release = await lockStorageBackend();
        }
    });
    test.afterAll(async () => {
        await release?.();
    });

    test.beforeEach(async ({ request }) => {
        const playlists = await request.delete(
            `${STORAGE_BACKEND_URL}/v1/playlists`
        );
        expect(playlists.ok()).toBe(true);
        const settings = await request.put(
            `${STORAGE_BACKEND_URL}/v1/epg/settings`,
            { data: { urls: [], refreshTime: '04:00' } }
        );
        expect(settings.ok()).toBe(true);
    });

    test('imports a source added in Settings and shows it on the M3U surfaces', async ({
        browser,
        request,
    }) => {
        test.setTimeout(150_000);
        const page = await newServerPage(browser);
        // The demo stream URLs are unreachable; the player still mounts.
        await page.route(/^https:\/\/streams\.example\.test\//, (route) =>
            route.abort()
        );

        await openEpgSettings(page);
        await expect(
            page.locator('[data-test-id="epg-sources-hint"]')
        ).toContainText('Shared by every device');
        await page.getByRole('button', { name: 'Add EPG source' }).click();
        await page.locator('.epg-source-row input').fill(GUIDE_URL);
        await saveSettings(page);

        await expect
            .poll(() => importedProgrammes(request), { timeout: 60_000 })
            .toBeGreaterThan(0);
        await expect(
            page
                .locator('[data-test-id="epg-server-source"]')
                .filter({ hasText: 'guide.xml' })
        ).toContainText('programmes', { timeout: 15_000 });

        await uploadMarketingPlaylist(page);
        const row = page.locator('[data-test-id="channel-item"]').filter({
            has: page.locator('.channel-name', { hasText: AURORA.name }),
        });
        await expect(row.locator('.epg-title')).toHaveText(AURORA_TITLES, {
            timeout: 20_000,
        });

        await row.click();
        const timeline = page.locator('app-epg-timeline');
        await expect(
            timeline.locator(
                '.epg-timeline__block.is-now .epg-timeline__block-title'
            )
        ).toHaveText(AURORA_TITLES, { timeout: 20_000 });

        await timeline.locator('.epg-timeline__guide').click();
        const guide = page.locator('app-epg-guide');
        await expect(guide).toBeVisible();
        await expect(
            guide
                .locator('app-epg-guide-row')
                .filter({ hasText: AURORA.name })
                .locator('.epg-guide-row__block.is-now')
        ).toBeVisible({ timeout: 20_000 });

        await guide
            .locator('.guide-toolbar__input--search input')
            .fill(SEARCH_TITLE);
        await expect(
            guide.locator('.epg-guide__search-result').first()
        ).toContainText(SEARCH_TITLE, { timeout: 10_000 });

        // Another device sees the same, server-wide list.
        const second = await newServerPage(browser);
        await openEpgSettings(second);
        await expect(second.locator('.epg-source-row input')).toHaveValue(
            GUIDE_URL
        );

        await page.context().close();
        await second.context().close();
    });

    test('saves the daily refresh time with the Save bar for every device', async ({
        browser,
    }) => {
        const first = await newServerPage(browser);
        await openEpgSettings(first);
        const time = first.locator('[data-test-id="epg-server-refresh-time"]');
        await expect(time).toHaveValue('04:00', { timeout: 15_000 });
        await time.fill('05:30');
        // Staged like every other setting until Save.
        await expect(
            first.locator('[data-test-id="settings-unsaved-bar"]')
        ).toBeVisible();
        await saveSettings(first);

        const second = await newServerPage(browser);
        await openEpgSettings(second);
        await expect(
            second.locator('[data-test-id="epg-server-refresh-time"]')
        ).toHaveValue('05:30', { timeout: 15_000 });

        await first.context().close();
        await second.context().close();
    });
});
```

- [ ] **Step 3: Register the spec**

In `docs/architecture/validation-map.md`, in the `## E2E` table, add after the "Web app browser flows" row:

```markdown
| Self-hosted server storage and EPG | `pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted` |
```

and in the tag sentence replace `` `@persistence`, `@settings`, `@pwa`, and `@self-hosted`. `` with `` `@persistence`, `@settings`, `@pwa`, `@self-hosted`, and `@server-epg`. ``. Edit only those lines (no Prettier run on `docs/**`).

- [ ] **Step 4: Run**

```bash
pnpm nx lint web-e2e
pnpm nx run web-e2e:e2e -- --project=chromium --grep "@server-epg|@self-hosted"
```

Expected: lint clean; both `@server-epg` tests pass, and the existing `server-storage.e2e.ts` and `self-hosted.e2e.ts` tests stay green. On a failure, open the HTML report (`dist/playwright-report/web-e2e`) before changing anything.

- [ ] **Step 5: Commit**

```bash
git add apps/web-e2e/src/storage-backend.helpers.ts apps/web-e2e/src/server-storage.e2e.ts apps/web-e2e/src/server-epg.e2e.ts docs/architecture/validation-map.md
git commit -m "test(e2e): server EPG from Settings to channel list, player and guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Docs and release note

**Files:**
- Modify: `docs/architecture/pwa-self-hosted.md` (3c's `## Server EPG` section; a new `## Server EPG Client` section before `## Runtime Limitations`; that section's EPG bullet; `## Validation`)
- Modify: `docs/architecture/m3u-playlist-module.md` (after `### XMLTV source lifecycle`, before `## Desktop source health`)
- Modify: `docker/README.md` (`## PWA Limitations And Playback Troubleshooting`, the `IPTVNATOR_EPG` row and the `## Server EPG` section 3c added)
- Create: `.changes/self-hosted-server-epg.md`

Edit only the lines named; never run Prettier on `docs/**`.

- [ ] **Step 1: `pwa-self-hosted.md`**

In 3c's `## Server EPG` section (before `## Server Storage Mode`), replace

```markdown
the service only with `IPTVNATOR_EPG=on` (default `off` until the PWA uses
it) and logs and continues without it when `epg.db` or the worker bundle
```

with

```markdown
the service unless `IPTVNATOR_EPG=off` (on by default; without server
storage it stays off, and says so only when `IPTVNATOR_EPG` was set) and
logs and continues without it when `epg.db` or the worker bundle
```

and append to that section, after its `Validation:` line, `The browser side is [Server EPG Client](#server-epg-client).`

Insert before `## Runtime Limitations`:

```markdown
## Server EPG Client

With [server EPG](#server-epg), `GET /v1/instance` reports `features.epg`
(`IPTVNATOR_EPG`, on by default). The start-up probe keeps `features`
(booleans only) with the remembered instance, so a start from memory turns
the same surfaces on. `provideServerStorage()` then adds
`provideServerEpg()` from the `@iptvnator/services/server-storage`
sub-entry; without the feature nothing changes and the PWA keeps XMLTV off.

- **Backend.** `EPG_RUNTIME_BACKEND` resolves `ServerEpgBackend`, created on
  first use (the storage session may still be under construction when the
  capability flags are first read). It has every XMLTV bridge method except
  the file picker and the mapping methods, so `supportsEpg` is true while
  `supportsEpgFilePicker` and `supportsEpgMapping` stay false.
  `ServerEpgClient` sends one request per route through `ServerApiClient`
  (token, timeouts, offline and 401 handling as for playlists); key lists
  above a route's cap (`SERVER_EPG_LIMITS`) go out in chunks whose answers
  are merged. Reads that carry keys or source URLs are `POST`s sent as reads
  (`queryJson`): they go out while writes are held and never raise the
  write-failure snackbar. A read that fails answers "no data" in the shape
  the caller expects.
- **Imports.** `fetchEpg` skips sources the server imported in the last
  24 h (its own rule for unforced imports) and URLs it does not own (a
  playlist saved a moment ago: the server queues those itself, and the
  poller looks again 3 s later), posts the rest with `force: false` and, as
  on the desktop, resolves once they finished. `forceFetchEpg` posts
  `force: true`. `clearEpgData` clears the data of every device and asks the
  server to import every source again. `checkEpgFreshness` compares
  `lastSuccessAt` with the requested age; the source status chips ask for
  24 h in server mode (`SHARED_EPG_FRESH_HOURS`, the daily schedule) and
  12 h on a device. `AppComponent` does not run its start-up freshness
  import in server mode: the server catches up after it starts.
- **Progress.** `ServerEpgStatusPoller` reads `/v1/epg/status` when the
  first progress listener registers, every 2 s while a source is queued or
  loading, while Settings → EPG is open or an import request waits, and when
  the tab becomes visible; every 10 s instead while the server does not
  answer, and never while the tab is hidden. Its `status` feeds Settings →
  EPG with every import. Only the imports this page started (Refresh, a new
  source, Retry, Clear) become the bridge's progress events for
  `EpgProgressService` and the import panel; the nightly run and other
  devices' imports show in Settings → EPG only. An error carries a
  translated message, and the two security codes keep `errorCode`. A new
  `revision` calls `EpgDataChangesService.notify()`: `EpgService` drops its
  programme cache, refreshes the channel-list rows and reloads the player's
  schedule, and an open guide reloads its rows and coverage.
- **Shared settings.** With `SHARED_EPG_SETTINGS`, `SettingsStore` loads
  `epgUrl` and the refresh time (`sharedEpgRefreshTime`) from
  `GET /v1/epg/settings` instead of the device copy (settings load waits 3 s
  for them; a slower answer lands later; an unreachable server leaves the
  list empty, with the offline banner) and reads them again when the tab
  becomes visible and when Settings opens. Settings → Save sends the changed
  fields of the list and the refresh time in one `PUT /v1/epg/settings`
  before it saves the device settings; when the server refuses, nothing is
  saved, the form stays dirty and the page says so
  (`SETTINGS.EPG_SERVER_SAVE_FAILED`). Other changes of the list (playlist
  info's "add to settings", a backup restore) go through
  `EpgSourceSettingsService` to the backend's `reconcileEpgSources`, which
  sends `PUT` only for a changed list. Both refuse until the page read the
  settings once, so a page that never saw the server's list cannot
  overwrite it; a read a save overtook is dropped. The channel list reads
  the global sources from the store. Another device's change shows on the
  next visibility change, Settings visit or reload.
- **Settings → EPG.** The list is labelled as shared by every device and
  accepts `http(s)` links without credentials only; so do a playlist's EPG
  inputs in playlist info. "On the server" shows the daily refresh time
  (an `HH:MM` form control in the server's time zone, staged and saved with
  the Save bar like every other setting, read-only while the server's
  settings could not be read, with the next run) and every
  source the server imports, from this list and from the playlists, with
  its state, last import, counts and error. The desktop trust actions are
  hints instead: a private-network block names
  `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS`, an untrusted certificate
  `NODE_EXTRA_CA_CERTS`.

Display offset, guide view mode and `preferUploadedEpgOverXtream` stay
device settings. Playlist info → EPG sources → Refresh forces an import of
that source on the server.
```

In `## Runtime Limitations`, replace 3a's bullet

```markdown
- XMLTV is not supported in the PWA yet. That rules out M3U guides, the
  XMLTV part of Settings → EPG (sources, refresh and clear, the Xtream XMLTV
  preference), the programme guide and its search, the Xtream XMLTV fallback
  and manual EPG mapping. Gate those flows on the XMLTV capabilities
  (`supportsEpg` and its narrower flags), which are false in browser/PWA mode,
  and do not use EPG as the readiness signal for Docker. Xtream and Stalker
  provider EPG (channel-row programme lines, the live EPG panel, favorites,
  recent and dashboard previews) works through the `/xtream` and `/stalker`
  proxy routes and is gated on `supportsProviderEpg`. The display settings of
  Settings → EPG (view mode, time offset) render wherever a guide exists
  (`SettingsFormFacade.supportsEpgDisplay`), so the PWA shows them; they are
  stored per browser like other settings.
```

with

```markdown
- XMLTV (M3U guides, the XMLTV part of Settings → EPG, the programme guide
  and its search, the Xtream XMLTV fallback) runs only with server storage
  and server EPG (see [Server EPG Client](#server-epg-client)); a hosted PWA
  and Docker with `IPTVNATOR_STORAGE=none` or `IPTVNATOR_EPG=off` keep it
  off. Gate those flows on the XMLTV capabilities (`supportsEpg` and its
  narrower flags), which the server EPG backend turns on; the local file
  picker and manual EPG mapping stay off there. Do not use EPG as the
  readiness signal for Docker. Xtream and Stalker provider EPG (channel-row
  programme lines, the live EPG panel, favorites, recent and dashboard
  previews) works through the `/xtream` and `/stalker` proxy routes and is
  gated on `supportsProviderEpg`. The display settings of Settings → EPG
  (view mode, time offset) render wherever a guide exists
  (`SettingsFormFacade.supportsEpgDisplay`), so the PWA shows them; they are
  stored per browser like other settings, server mode included.
```

In `## Validation`, after `pnpm nx test web-backend --testPathPatterns=storage`, add:

```bash
pnpm nx test services --testPathPatterns=server-epg
```

- [ ] **Step 2: `m3u-playlist-module.md`**

Insert before `## Desktop source health`:

```markdown
### Server source lifecycle (self-hosted PWA)

In server mode with `features.epg` the global list is the server's
(`GET|PUT /v1/epg/settings`), not this device's `Settings.epgUrl`:
`SettingsStore` loads it, with the server's daily refresh time, through
`SHARED_EPG_SETTINGS`. Settings → Save sends a changed list and refresh time
in one `PUT`; other changes reach the server through the same
`EpgSourceSettingsService` reconciliation, whose backend method sends `PUT`
only for a changed list. Both refuse before the page has read the list once. The server owns the rest of
the lifecycle: it imports the union of that list and the enabled `epg_urls`
of every M3U playlist on the server, clears sources nobody owns after a
settings or playlist change, refreshes daily at the configured time and
catches up after it starts. The renderer's lookup scopes (playlist sources,
then global sources, then the optional any-source fallback) and the matching
ladder are unchanged; the server runs the shared
`@iptvnator/shared/epg-store` queries. A finished import changes the status
`revision`; the renderer then drops its programme caches through
`EpgDataChangesService` instead of fencing lookups as a settings change does.
URL imports through `/parse` keep the header's `x-tvg-url`/`url-tvg`
sources, as file imports do.
```

- [ ] **Step 3: `docker/README.md`**

In `## PWA Limitations And Playback Troubleshooting`, replace 3a's bullet

```markdown
- Xtream and Stalker sources show their provider's programme guide: the
  current show under each live channel and the guide beside the player.
  Settings → EPG offers the guide layout and a time offset. XMLTV guides (M3U
  EPG sources, the programme guide and EPG channel mapping) are not available
  in the self-hosted PWA yet.
```

with

```markdown
- Xtream and Stalker sources show their provider's programme guide: the
  current show under each live channel and the guide beside the player.
  Settings → EPG offers the guide layout and a time offset. With server
  storage the server also imports XMLTV guides (`IPTVNATOR_EPG=on`, the
  default): M3U playlists get the programme line, the player EPG panel and
  the guide with search, and Settings → EPG edits one source list and the
  daily refresh time for every device. Without server storage, or with
  `IPTVNATOR_EPG=off`, XMLTV stays off; EPG channel mapping is not available
  in the PWA yet.
```

In the Runtime Configuration table, replace 3c's row

```markdown
| `IPTVNATOR_EPG`                          | `off`                   | `on` imports XMLTV guides on the server (needs `IPTVNATOR_STORAGE=server`) and serves `/api/v1/epg`. See [Server EPG](#server-epg).   |
```

with

```markdown
| `IPTVNATOR_EPG`                          | `on`                    | With `IPTVNATOR_STORAGE=server` the server imports XMLTV guides and serves `/api/v1/epg`; `off` turns both off. See [Server EPG](#server-epg). |
```

In 3c's `## Server EPG` section, replace

```markdown
start for sources without a fresh import, and on demand. It is off by
default (`IPTVNATOR_EPG=off`) until the browser app uses it; `on` starts
the import and serves the `/api/v1/epg` routes.
```

with

```markdown
start for sources without a fresh import, and on demand. It is on by
default; `IPTVNATOR_EPG=off` turns the import and the `/api/v1/epg` routes
off. In the browser, Settings → EPG lists the sources every device shares,
the daily refresh time and the state of every import, and M3U playlists
show the guide in the channel list, the player and the programme guide.
```

- [ ] **Step 4: Release note**

Create `.changes/self-hosted-server-epg.md`:

```markdown
---
type: feature
area: self-hosted
issues: [444]
highlight: TV guide on your server
---

With server storage the Docker version now imports XMLTV guides itself, every night and whenever you add a source, so M3U playlists show what is on in the channel list, the player and the programme guide with search on every device. Settings → EPG edits one source list for the whole server.
```

Run: `pnpm run release:notes:validate`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/pwa-self-hosted.md docs/architecture/m3u-playlist-module.md docker/README.md .changes/self-hosted-server-epg.md
git commit -m "docs(self-hosted): server EPG client, limitations and release note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Full validation

**Files:** none (fixes go into the task they belong to, as new commits).

- [ ] **Step 1: Unit tests, lint, types**

```bash
pnpm nx run-many -t test -p services epg-data-access ui-epg components web workspace-shell-util playlist-shared-ui web-backend
pnpm nx run-many -t lint -p services epg-data-access ui-epg components web workspace-shell-util playlist-shared-ui web-backend web-e2e
pnpm run typecheck:ci
pnpm run typecheck:spec
```

Expected: all pass, no `max-lines` errors, `tools/eslint/max-lines-baseline.mjs` unchanged (`git diff --quiet origin/master -- tools/eslint/max-lines-baseline.mjs` exits 0).

- [ ] **Step 2: Repository checks**

```bash
pnpm run i18n:check
pnpm run styles:icon-ligatures:validate
pnpm run styles:theme-references:validate
pnpm run styles:font-weights:validate
pnpm run styles:inputs:validate
pnpm run a11y:icon-buttons:validate
pnpm run ui:form-field-defaults:validate
pnpm run e2e:task-graphs:validate
pnpm run release:notes:validate
pnpm run agents:validate
```

Expected: all pass.

- [ ] **Step 3: Launch path**

With everything committed:

```bash
mkdir -p dist/performance
git switch --detach origin/master
pnpm nx build web --skip-nx-cache
grep -o 'rel="modulepreload"' dist/apps/web/index.html | wc -l > dist/performance/preloads-master.txt
git switch claude/server-epg-pwa
pnpm nx build web --skip-nx-cache
grep -o 'rel="modulepreload"' dist/apps/web/index.html | wc -l
cat dist/performance/preloads-master.txt
pnpm run perf:initial-bytes:check
pnpm nx build web --configuration=pwa --skip-nx-cache
```

Expected: the same number of `modulepreload` links on master and on the branch (no new chunk or stylesheet on the launch path, so `renderer.domMutationsToFirstCard` in `launch.journey.ts` is unaffected); `perf:initial-bytes:check` passes within the 4 KiB slack (the startup path gains only `EpgDataChangesService`, `SHARED_EPG_SETTINGS` with its helpers, `validateRemoteEpgSourceControl`, `epgEnabled` and a few lines in `EpgService`, `EpgProgressService`, `AppComponent` and `SettingsStore`). If the preload count changed, run `pnpm run perf:journeys` and compare `renderer.domMutationsToFirstCard`; if initial bytes exceed the slack, move the offending import off the startup path before considering a baseline change with a note, as #1903 did. Confirm the server EPG code is lazy: `grep -l "ServerEpgStatusPoller" dist/apps/web/browser/*.js dist/apps/web/*.js 2>/dev/null` names only lazy chunks, never the `main-*.js` file.

- [ ] **Step 4: E2E**

```bash
pnpm nx run web-e2e:e2e -- --project=chromium --grep "@self-hosted|@server-epg|@settings|@pwa|@epg"
```

Expected: pass. The Electron EPG suite is not affected by this PR (no Electron code changes); state that in the PR.

- [ ] **Step 5: Look at it**

```bash
export TMPDATA="$(mktemp -d)"
IPTVNATOR_STORAGE=server IPTVNATOR_DATA_DIR="$TMPDATA" PORT=3334 CLIENT_URL=http://localhost:4200 IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1 pnpm nx serve web-backend &
pnpm nx serve xtream-mock-server &
printf 'window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: "http://localhost:3334" };\n' > apps/web/src/assets/app-config.js
pnpm run serve:frontend
```

In the browser, in light and dark theme and at phone width (375 px): Settings → EPG, add `http://localhost:3211/demo/guide.xml`, save, watch the import panel and the "On the server" rows; change the refresh time and check that the save bar appears, Discard restores it and Save keeps it after a reload; add `http://192.168.1.1/guide.xml` and confirm the error row and the panel show the `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS` hint without a trust button (restart the backend without `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS` for this one); in playlist info, type a local path as an EPG source and check the error text; upload a marketing M3U and check the channel list, the player EPG panel and the guide; stop the backend and confirm the EPG surfaces show no data and no EPG snackbar, and that a reload opens Settings → EPG with an empty list, the offline banner and a disabled refresh-time field. Take screenshots for the PR. Afterwards:

```bash
git checkout apps/web/src/assets/app-config.js
kill %1 %2
```

When a Docker daemon is available, also run `docker build -t iptvnator:server-epg-test -f docker/Dockerfile .`, start it with a volume, add the mock guide as above and check that `databases/epg.db` appears on the volume.

---

### Task 24: Local review, push, PR

- [ ] **Step 1: Local review gate (AGENTS.md, overview gate 6)**

```bash
git fetch origin
git merge origin/master   # only if master moved; resolve, re-run Task 23 Steps 1-2
codex review --base origin/master -c model_reasoning_effort=high > /tmp/codex-review-3d.txt 2>/tmp/codex-review-3d.log
greptile review --json > /tmp/greptile-review-3d.json
```

Run both on the same commit. Check every finding against the code; fix real ones in a new commit with a conventional message ending in the `Co-Authored-By` line, and note a one-line reason for each declined one. Repeat until Codex has no findings and Greptile reports `confidence` 5 with no `comments`, or a round repeats the previous findings, at most five rounds; then stop and report to the maintainer instead of pushing. A reviewer whose CLI is missing or signed out does not block the other; say which one did not run.

- [ ] **Step 2: Push once**

```bash
git push -u origin claude/server-epg-pwa
```

- [ ] **Step 3: Open the PR**

Attach the Task 23 Step 5 screenshots (light, dark, phone width) to the description after creating it.

```bash
gh pr create --base master --title "feat(self-hosted): EPG for M3U playlists from the server" --body "$(cat <<'EOF'
Closes #444.

## What changed

- When the self-hosted instance reports `features.epg` (kept with the remembered instance, so an offline start keeps it), the PWA turns on the M3U EPG surfaces: the channel-list programme line, the player EPG panel, the programme guide with search, and Settings → EPG.
- `ServerEpgBackend` implements the renderer's EPG bridge over `/v1/epg` (`ServerEpgClient`: key lists chunked to the route caps and merged, POST reads that are not held with writes, "no data" answers when offline). No file picker and no mapping (3e).
- `ServerEpgStatusPoller` feeds Settings → EPG with every import, shows the imports started on this device in the import panel and, on a new `revision`, tells the renderer's EPG caches to read again (`EpgDataChangesService`).
- The global XMLTV list and the daily refresh time are the server's: `SettingsStore` loads them through `SHARED_EPG_SETTINGS`; Settings → Save sends the changed fields in one `PUT /v1/epg/settings`, other list changes go through `reconcileEpgSources`, never before the page read the list.
- Settings → EPG in server mode, on 3a's display/sources split: shared-list label, http(s)-only links, the daily refresh time as a staged setting, every imported source with state, last import, counts and errors; source chips count a day as fresh; the trust actions become hints naming `IPTVNATOR_EPG_ALLOW_PRIVATE_NETWORKS` and `NODE_EXTRA_CA_CERTS`. Playlist info takes http(s) EPG links only in server mode.
- The channel list reads the global sources from the settings store (it read device storage); the client start-up import is left to the server.
- `/parse` uses the shared `createPlaylistObject`, so URL imports keep `x-tvg-url`/`url-tvg`.
- `IPTVNATOR_EPG` defaults to `on`. New strings in all 19 locales.

## Why

Phase 3d of `docs/superpowers/specs/2026-10-15-server-epg-design.md`: 3c made the server import XMLTV; this lets every browser of the instance use it. Plan: `.plans/2026-10-15-server-epg-3d-pwa.md`.

## Release note

`.changes/self-hosted-server-epg.md`

## Checks

- `pnpm nx run-many -t test` and `-t lint` for services, epg-data-access, ui-epg, components, web, workspace-shell-util, playlist-shared-ui, web-backend (+ lint web-e2e): passed
- `pnpm run typecheck:ci`, `pnpm run typecheck:spec`: passed
- `pnpm run i18n:check`, styles/a11y/form-field validators, `pnpm run e2e:task-graphs:validate`, `pnpm run release:notes:validate`, `pnpm run agents:validate`: passed
- Launch path: same modulepreload count as master; `pnpm run perf:initial-bytes:check` passed
- `pnpm nx run web-e2e:e2e -- --project=chromium --grep "@self-hosted|@server-epg|@settings|@pwa|@epg"`: passed
- Electron EPG E2E not run: no Electron code changed
- Local review: Codex and Greptile clean on the pushed commit

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Adjust the Checks list to what actually ran (a skipped check with its reason, the reviewed commit, any declined finding) before creating the PR.
