# Server EPG 3a: Provider EPG in the PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Xtream and Stalker provider EPG in every browser PWA deployment, through the existing `/xtream` and `/stalker` proxy: channel-row programme lines, the live EPG panel, favorites/recent and dashboard previews. The PWA also gets the two EPG display settings (view mode and offset) in Settings → EPG, and loading skeletons that match their rows. Every XMLTV feature stays behind the XMLTV capabilities, and Xtream catch-up stays in the PWA only if a manual check proves it plays.

**Architecture:** One new getter, `RuntimeCapabilitiesService.supportsProviderEpg`, is true wherever the portal transport exists. That is always in the PWA, where `PwaService` forwards `XTREAM_REQUEST` and `STALKER_REQUEST` to the web backend. In Electron it requires both preload methods that `ElectronService.sendIpcEvent` calls, `xtreamRequest` and `stalkerRequest`.
- Every provider-EPG gate moves from `supportsEpg` / `supportsEpgProgramLookup` to the new getter.
- XMLTV call sites keep their gates: the Xtream XMLTV fallback, manual mapping, M3U guides, and the Settings source list and actions.
- Mixed surfaces decide per source: the collection resolver, the unified live tab, the favorites list and the collection loading skeleton.
- Settings → EPG renders its display rows on `supportsEpg || supportsProviderEpg`, and its XMLTV rows only with the import and data-management bridges.
- No transport, backend or mock-server change is needed: the proxy routes, the host guard and both mocks already handle the EPG actions.

A manual check against a real provider decides whether Xtream catch-up stays in the PWA. If it does not play, a conditional task hides the archive actions behind `supportsProviderCatchUp`.

**Tech Stack:** Angular 22 (signals, `inject`), `@ngrx/signals` 22 stores, Angular reactive forms, Jest 30 via `@nx/jest`, Playwright 1.64 (`web-e2e`, `electron-backend-e2e`), Express 5 (`web-backend`), Nx 23.

Spec: `docs/superpowers/specs/2026-10-15-server-epg-design.md` (sections 1, 4, 5.1, 9, 12 "3a", 13, 15 "Proxy load"). Overview: `.plans/2026-10-15-server-epg.md`.

Maintainer decisions folded in (15 Oct):
- Settings → EPG shows the two display settings in the PWA (Task 11).
- Xtream catch-up gets a manual check, and is hidden only if it does not play (Tasks 16-17).
- The loading skeleton follows the row rule (Task 9).
- The release note is a highlight (Task 15).
- Stalker EPG error snackbars stay as they are (see Out of scope).

---

## Contract deviations

None. The overview fixes only the name `supportsProviderEpg` for 3a ("a separate getter on `RuntimeCapabilitiesService` and does not use this token"), and this plan keeps it.

One refinement of spec section 9 ("true wherever the portal transport exists (Electron IPC or the PWA backend proxy)"): in Electron the getter requires **both** `xtreamRequest` and `stalkerRequest`. One flag gates both providers, so a partial bridge must not send a `STALKER_REQUEST` that `ElectronService.fetchStalkerData` (`apps/web/src/app/services/electron.service.ts:318`) cannot deliver.

Additions that the overview does not name:
- The settings-search requirement `'epg-display'` (Task 11).
- The conditional getter `RuntimeCapabilitiesService.supportsProviderCatchUp`, which exists only if Task 17 applies.

Neither is shared with another phase.

Spec section 9 (updated 15 Oct) lists Settings → EPG for "PWA, no server EPG" as "display settings only (time offset, view mode), from 3a"; Task 11 implements exactly that row.

## Out of scope

- **Stalker EPG error snackbars.** A failing Stalker EPG request shows the generic "Stalker request error" snackbar in both runtimes, because those requests are not `silent`. 3a keeps that parity; making portal EPG silent is a follow-up.
- **Catch-up badges on Xtream rows.** The history icon in the channel list, the favorites list and the live grid already showed in the PWA before 3a. If Task 17 applies, they keep showing; hiding them (`isXtreamCatchupAvailable` call sites) is a follow-up.
- **Wording of the "schedule only" notice.** If Task 17 applies, the PWA timeline shows the existing notice, which blames the provider. A PWA-specific wording would need new strings in every locale.

## Call-site decisions

Verified against `ea1ac41fc`. "Provider" sites move to `supportsProviderEpg`; "XMLTV" sites keep their gate.

| Site | Gate today | Gate after 3a | Kind |
| --- | --- | --- | --- |
| `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts:114,157,236` (`loadEpg`, `loadChannelEpg`) | `supportsEpg` | `supportsProviderEpg` | provider |
| same file `:188-203` (manual mapping via `window.electron.getEpgMapping`) | `supportsEpgMapping` | unchanged | XMLTV |
| `libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts` | bridge-method presence (`:52`, `:69`) | unchanged (empty in the PWA) | XMLTV |
| `libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts:195,292` (mapping batch) | `window.electron.getEpgMappingsBatch` presence | unchanged | XMLTV |
| same file `:443-470` (`requestPreviewWindow`) | none (callers gate) | unchanged | provider |
| `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts:141,143,291,357,387,455,510` + `.html:13,38,43,47` | `supportsEpg` | `supportsProviderEpg` | provider |
| same component `.html:52`, `.ts:780-800` (Map EPG menu, `readEpgMapping`) | `supportsEpgMapping` | unchanged | XMLTV |
| `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.ts:217` + `.html:178` | `supportsEpg` | `supportsProviderEpg` | provider |
| same component `:321-327` (`archivePlaybackAvailable`) | `tv_archive` / duration | plus `supportsProviderCatchUp` only if Task 17 applies | catch-up |
| `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts:123,175,233` (`fetchChannelEpg`, `ensureBulkItvEpg`) | `supportsEpg` | `supportsProviderEpg` | provider |
| same file `:307` (`applyMappedItvEpg`) | `supportsEpgMapping && supportsEpg` | `supportsEpgMapping && runtime.supportsEpg` | XMLTV |
| `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts:372,764,813,1019,1362,1516,1711` + `.html:172,209,232,294,325,332,338` | `supportsEpg` | `supportsProviderEpg` | provider |
| same component `.ts:373,777` + `.html:343` (mapping) | `supportsEpgMapping` | unchanged | XMLTV |
| `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.ts:204` (`loadEpgForItems`) | `supportsProgramLookup` for every source | M3U rows: `supportsProgramLookup`; Xtream/Stalker rows: `supportsProviderEpg` | mixed |
| same file `:283,317,1133,1275` (detail panels, `fetchXtreamEpgItems`, `fetchStalkerShortEpg`) | `supportsProgramLookup` | `supportsProviderEpg` | provider |
| same file `:714,725,791,892,922,999,1011,1469,1506` (`epg_channel_id` XMLTV, mappings, M3U) | `supportsProgramLookup` | unchanged | XMLTV |
| `libs/workspace/dashboard/data-access/src/lib/dashboard-portal-live-epg.service.ts:84-99` (Xtream/Stalker cards only) | `supportsEpgProgramLookup` | `supportsProviderEpg` | provider |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.ts:127,220,254` + `.html:14,81,196` | `supportsEpg` | rows and EPG map: `supportsEpg \|\| supportsProviderEpg`; panel: M3U selection `supportsEpg`, portal selection `supportsProviderEpg` | mixed |
| same component `:233` (`createUnifiedLiveSelection`, M3U programme hydration only) | `supportsEpg` | unchanged | XMLTV |
| `…/unified-collection/unified-live-epg-view.ts:96-107` (`timelineArchiveAvailable`, portal branch) | `tvArchive` / duration | plus `supportsProviderCatchUp` only if Task 17 applies | catch-up |
| `libs/portal/shared/ui/src/lib/components/global-favorites-list/global-favorites-list.component.ts:82` + `.html:38` | `showEpg` default `supportsEpg` | per row: M3U `supportsEpg`, Xtream/Stalker `supportsProviderEpg` | mixed |
| `…/unified-collection/unified-collection-page.component.ts:130` + `.html:24` (loading skeleton) | `supportsEpg` | the row rule for a one-playlist scope; any guide for "all playlists" | mixed |
| `apps/web/src/app/settings/settings-form.facade.ts:56-60`, `settings-form.utils.ts:59-136` (form controls) | `supportsImport && supportsDataManagement` for every EPG control | sources and `preferUploadedEpgOverXtream`: unchanged; `epgViewMode`, `epgOffsetMinutes`: display flag | mixed |
| `apps/web/src/app/settings/settings-options.ts:162-184` (nav), `settings.component.ts:236-240`, `libs/workspace/shell/util/src/lib/settings-search/settings-search-sections.ts:37-41` | `epg` requirement | `epg-display` requirement | display |
| `libs/workspace/shell/util/src/lib/settings-search/settings-search-entries.ts:88-127`, `settings-search.service.ts:57` | `epg` for all five rows | `epg-display` for view mode and offset; `epg` for sources, preference, clear | mixed |
| `apps/web/src/app/settings/settings-epg-section.component.html:107-331` (sources, Xtream preference, clear data) | rendered with the section | `@if (showsXmltvSources())` | XMLTV |
| `apps/web/src/app/settings/settings-change-tracking.ts:36-39` | `epgViewMode`/`epgOffsetMinutes` → `epg` | unchanged (already correct for the display-only form) | — |
| `channel-list-container`, `video-player`, `libs/epg/data-access` | XMLTV flags | unchanged | M3U / XMLTV |

## Host guard analysis (risk from spec section 15)

Provider EPG failures through the proxy cannot open the host circuit for the same host's playback or catalog requests, so no production fix is needed. Task 12 pins this with two regression tests.

- The proxy routes do not classify by action. `/xtream` (`apps/web-backend/src/app/web-backend-app.ts:267-345`) admits every action with `admitProviderRequest(hostGuard, url.href)` (`:294`) and reports with `reportProviderRequestFailure(hostGuard, guardToken, error, { requestUrl, connected })` (`:323-326`). `/stalker` (`:347-458`) does the same. Only `skipConnectionGuard` changes counting (`:358-359`), and `create_link` changes only the timeout (`:428-433`).
- `classifyHostRequestFailure` (`libs/shared/host-health/src/lib/host-connectivity-guard.ts:194-216`) counts only connection-level codes seen **before** the TCP connection was accepted. An HTTP answer of any status counts as `responded` and clears the record. That covers a panel without `get_short_epg` (404) and one whose `get_epg_info` fails (5xx). A timeout after the connection was accepted, such as a slow week-long bulk guide, is `inconclusive`. A single EPG request can therefore count only when the host refused the connection, and playback would fail on that host the same way.
- Electron behaves the same. `xtream.events.ts:105` (`beginGuardedHostRequest`), `:245`, `:269` (`reportGuardedHostFailure(…, { requestUrl, connected: socketConnected })`) and `stalker.events.ts:113-115`, `:241-242` use the same shared classifier and do not branch on the action either.
- Renderer error handling matches in both runtimes. `PwaService` lists `GetShortEpg`, `GetSimpleDataTable` and `GetSimpleDateTable` as silent (`apps/web/src/app/services/pwa.service.ts:95-103`), like `ElectronService` (`electron.service.ts:79-87`), so Xtream EPG failures show no snackbar. Stalker EPG requests are not `silent` in either runtime (`pwa.service.ts:723`, `electron.service.ts:342`); see Out of scope.
- The half-open trial (one request while the breaker probes a host) may be an EPG request. That is breaker design and the same on the desktop. A recovered host answers the trial and closes the breaker for everything.
- Load is bounded as on the desktop. `EpgQueueService` allows 2 requests in flight, 200 ms apart, with a 5 min cache and a 60 s failure cooldown (`epg-queue.service.ts:84-87`). Stalker loads the bulk guide once per playlist session and caps the fallback backlog at 30 rows. Dashboard cards allow 2 requests in flight; Xtream collection batches allow 3 (`stream-resolver.service.ts:977`). Stalker rows of one playlist are sent together (`Promise.all` in `loadStalkerEpgBatch`), as on the desktop.

## Mocks

No mock-server change is needed.

- The Xtream mock answers `get_short_epg` (`apps/xtream-mock-server/src/app/routes/dispatch.ts:54-56`, handler `handlers/get-short-epg.handler.ts`) and `get_simple_data_table` / `get_simple_date_table` (`:57-59`, `handlers/get-full-epg.handler.ts`), directly and through its `/xtream` proxy emulation (`server.ts:127-131`, `dispatchProxyAction`). In the `epg:epg` scenario (`scenarios.ts:190-202`, `data-store.ts:260-404`) "Timezone News" (stream 10000, category "EPG Focus") airs "Global Headlines" now, followed by "Market Wrap". `server.spec.ts` already covers both actions (`:115-140`, `:435-445`).
- The Stalker mock answers `get_short_epg` and `get_epg_info` (`apps/stalker-mock-server/src/app/routes/dispatch.ts:94-98`, `docs/architecture/stalker-mock-server.md:236-287`). Every programme title starts with `"<channel name>: "` (`data-generator.ts:614-643`).
- The mocks serve no playable archive, so Xtream catch-up is checked by hand (Task 16).

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/services/src/lib/runtime-capabilities.service.ts` | modify | `supportsProviderEpg` getter (+ `supportsProviderCatchUp` if Task 17 applies) |
| `libs/services/src/lib/runtime-capabilities.service.spec.ts` | modify | PWA, full and partial Electron bridges |
| `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts` | modify | Provider gate for `loadEpg` / `loadChannelEpg` |
| `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.spec.ts` | modify | PWA loads provider guide, no-transport case |
| `libs/portal/xtream/data-access/src/lib/stores/xtream.store.spec.ts` | modify | Runtime stub rename |
| `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.{ts,html}` | modify | Row previews on the provider gate |
| `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.spec.ts` | modify | PWA previews, no-transport case |
| `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.{ts,html}` | modify | EPG panel on the provider gate (+ catch-up gate if Task 17 applies) |
| `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.spec.ts`, `live-stream-auto-open-queue.component.spec.ts`, `live-stream-layout.sidebar-levels.spec.ts`, `live-stream-layout.catchup-timeline.spec.ts` | modify | Runtime stubs, PWA panel test (catch-up tests if Task 17 applies) |
| `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts` | modify | Provider gate for short and bulk EPG; mapping stays XMLTV |
| `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.spec.ts` | modify | PWA requests, no transport, mapping without XMLTV |
| `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.{ts,html}` | modify | Panel, rows, eager bulk load on the provider gate |
| `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.{component,panel-search,playback-session-key,remote-status,epg-races}.spec.ts` | modify | Runtime stubs; provider-only bulk load test |
| `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.ts` | modify | Split portal guides from XMLTV lookups |
| `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.provider-epg.spec.ts` | create | Resolver without the XMLTV bridge, without transport |
| `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.spec.ts`, `stream-resolver.service.epg-offset.spec.ts` | modify | Runtime stub; superseded PWA test removed |
| `libs/portal/shared/ui/src/lib/components/global-favorites-list/global-favorites-list.component.{ts,html}` | modify | Programme line per row source |
| `libs/portal/shared/ui/src/lib/components/global-favorites-list/global-favorites-list.component.spec.ts` | modify | Per-source rows |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.{ts,html}` | modify | Any-EPG map, per-selection panel |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.{component,fullscreen-panel,open-in-playlist}.spec.ts` | modify | Runtime stubs, PWA portal panel (catch-up test if Task 17 applies) |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-skeleton.ts` | create | Skeleton row rule (`collectionSkeletonShowsEpg`) |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-skeleton.spec.ts` | create | The rule per scope, source and runtime |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-page.component.{ts,html,spec.ts}` | modify | Skeleton follows the rule |
| `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-epg-view.ts` | modify | Only if Task 17 applies: portal archive gate |
| `libs/workspace/dashboard/data-access/src/lib/dashboard-portal-live-epg.service.ts` | modify | Cards on the provider gate |
| `libs/workspace/dashboard/data-access/src/lib/dashboard-portal-live-epg.service.spec.ts` | modify | Runtime stub, PWA case |
| `apps/web/src/app/settings/settings-form.utils.ts`, `settings-form.facade.ts` | modify | Display controls apart from the XMLTV controls |
| `apps/web/src/app/settings/settings-epg-section.component.{ts,html}` | modify | `showsXmltvSources` input; XMLTV block behind it |
| `apps/web/src/app/settings/settings.component.{ts,html}`, `settings-options.ts` | modify | Nav on the display flag; section binding |
| `apps/web/src/app/settings/settings-form.utils.spec.ts`, `settings-epg-section.component.spec.ts`, `settings.component.spec.ts` | modify | PWA display-only form and section; desktop unchanged |
| `libs/workspace/shell/util/src/lib/settings-search/settings-search.types.ts`, `settings-search-sections.ts`, `settings-search-entries.ts`, `settings-search.service.ts` | modify | `epg-display` requirement |
| `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.spec.ts` | modify | PWA finds only the display rows |
| `libs/shared/interfaces/src/lib/settings.interface.ts:276-281` | modify | Stale "Electron only in practice" comment |
| `apps/web-backend/src/app/web-backend-app.host-guard.spec.ts` | modify | EPG failures never fast-fail playback/catalog |
| `apps/web-e2e/src/xtream-provider-epg.e2e.ts` | create | Xtream row line and player EPG panel in the PWA |
| `apps/web-e2e/src/stalker.e2e.ts` | modify | Two PWA tests flip to "EPG shown / bulk once" |
| `apps/web-e2e/src/settings.e2e.ts` | modify | PWA EPG page offers the offset and view mode only |
| `apps/web-e2e/src/stalker-open-in-playlist.fixture.ts` | modify | Stale comment about "no EPG panel in the PWA" |
| `docs/architecture/stalker-epg.md`, `xtream-portal-compatibility.md`, `pwa-self-hosted.md`, `workspace-dashboard.md`, `host-connectivity-guard.md`, `m3u-playlist-module.md`, `docker/README.md` | modify | Provider EPG and EPG display settings in the PWA, XMLTV still off |
| `.changes/pwa-provider-epg.md` | create | Release note (highlight), closes #1683 |

`docs/architecture/validation-map.md` stays unchanged. The new spec uses the existing `@xtream` and `@epg` tags, and the Playwright plugin infers its atomized `e2e-ci--src/xtream-provider-epg.e2e.ts` target.

`apps/website/src/pages/download/docker.astro:95` already says "Portal schedules from Xtream and Stalker sources still work"; after this PR that sentence is true.

No i18n keys are added. The Stalker panel reuses `provider-no-epg`, and Settings reuses the existing EPG row labels.

No new component or stylesheet is added. The Settings change gates part of the existing `settings-epg-section` template, and the settings route is lazy, so the launch path does not change.

Line budgets, counted the way `max-lines` counts them (blank lines and comments skipped):

| File | Lines | Note |
| --- | --- | --- |
| `runtime-capabilities.service.ts` | 292 + 7 = 299 | 302 if Task 17 applies: over the 300 target, under the hard 400 |
| `global-favorites-list.component.ts` | 299 + 5 = 304 | Over the 300 target, under 400 |
| `unified-live-tab.component.ts` | 378 + 10 = 388 | Under 400 |
| `unified-collection-page.component.ts` | 344 + 5 = 349 | Under 400 |
| `settings.component.ts` | 386 | Unchanged: one property is replaced in place, and the new binding goes into the template |
| `settings-form.facade.ts` | 220 + 6 = 226 | |
| `settings-search.service.ts` | 179 + 3 = 182 | |
| `stalker-live-stream-layout.component.spec.ts` | 1200 of 1200 | Only renames and comments, so the new Stalker layout test goes into the epg-races spec |
| `live-stream-layout.component.spec.ts` | 1182 | Stays under 1200 with Task 17's stub line; Task 17's tests go into the catch-up-timeline spec |
| `stream-resolver.service.spec.ts` | 1191 | Loses a test; the new tests get their own file |

`with-epg.feature.ts`, `with-stalker-epg.feature.ts`, `portal-channels-list.component.ts`, `live-stream-layout.component.ts`, `stalker-live-stream-layout.component.ts` and `stream-resolver.service.ts` are baselined already. No baseline entry is added.

---

### Task 1: Prepare the worktree

**Files:** none.

- [ ] **Step 1: Create the branch and worktree from `claude/server-epg`**

```bash
git -C /Users/4gray/Code/iptvnator worktree add .claude/worktrees/server-epg-provider -b claude/server-epg-provider claude/server-epg
cd /Users/4gray/Code/iptvnator/.claude/worktrees/server-epg-provider
git fetch origin
git rev-list --count HEAD..origin/master
```

Expected: the worktree is created on `claude/server-epg-provider`. If the count is above 0, run `git merge --no-edit origin/master`. The branch adds only Markdown, so the merge has no conflicts. Never rebase this branch. Leave the main checkout `/Users/4gray/Code/iptvnator` alone.

- [ ] **Step 2: Install and verify discovery**

```bash
pnpm install --frozen-lockfile
pnpm nx show projects | grep -E '^(services|portal-xtream-data-access|portal-xtream-feature|portal-stalker-data-access|portal-stalker-feature|portal-shared-data-access|portal-shared-ui|workspace-dashboard-data-access|workspace-dashboard-feature|workspace-shell-util|workspace-shell-feature|web|web-backend|web-e2e|electron-backend-e2e)$' | sort
node tools/testing/ensure-electron-binary.mjs
```

Expected: the install exits 0, grep prints all 15 project names, and the Electron check reports the pinned version (Task 18 runs Electron E2E).

- [ ] **Step 3: Record the baseline and check for drift**

```bash
pnpm nx run-many -t test -p services portal-xtream-data-access portal-xtream-feature portal-stalker-data-access portal-stalker-feature portal-shared-data-access portal-shared-ui workspace-dashboard-data-access workspace-dashboard-feature workspace-shell-util web-backend
pnpm nx test web --testPathPatterns=settings
grep -rn "supportsEpg\b" libs/portal libs/workspace --include='*.ts' --include='*.html' | grep -v "\.spec\.ts" | wc -l
```

Expected: all tests pass. The grep prints `48`: the lines behind the call-site table, including the XMLTV-only uses in `unified-live-selection.ts` and `unified-live-epg-map.ts`, which stay unchanged, and the skeleton in `unified-collection-page` (Task 9). A different number means `master` moved those files: re-check the table against the code before going on. If a test fails before any change, stop and report it; do not fix unrelated failures here.

---

### Task 2: `supportsProviderEpg` capability

**Files:**
- Modify: `libs/services/src/lib/runtime-capabilities.service.ts:162-169` (insert after `supportsEpgMapping`)
- Test: `libs/services/src/lib/runtime-capabilities.service.spec.ts` (append a test after `'does not report guide support with only one of the two guide reads'`, line 409)

- [ ] **Step 1: Write the failing test**

Add to `runtime-capabilities.service.spec.ts` after the test `'does not report guide support with only one of the two guide reads'`:

```ts
    it('offers provider EPG wherever the portal transport exists, independently of XMLTV', () => {
        const service = new RuntimeCapabilitiesService();

        // PWA: PwaService forwards XTREAM_REQUEST and STALKER_REQUEST to the
        // backend proxy, so portal guides work without any XMLTV support.
        testWindow.electron = undefined;
        expect(service.supportsProviderEpg).toBe(true);
        expect(service.supportsEpg).toBe(false);

        // Electron: ElectronService sends both requests through these
        // preload methods; XMLTV is a separate surface.
        testWindow.electron = {
            xtreamRequest: jest.fn(),
            stalkerRequest: jest.fn(),
        };
        expect(service.supportsProviderEpg).toBe(true);
        expect(service.supportsEpg).toBe(false);

        // A partial bridge cannot reach both portal kinds.
        testWindow.electron = { xtreamRequest: jest.fn() };
        expect(service.supportsProviderEpg).toBe(false);
        testWindow.electron = {
            fetchEpg: jest.fn(),
            getChannelPrograms: jest.fn(),
        };
        expect(service.supportsProviderEpg).toBe(false);
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test services --testPathPatterns=runtime-capabilities.service`
Expected: FAIL in the new test, `expect(received).toBe(expected)` with `Expected: true`, `Received: undefined`.

- [ ] **Step 3: Add the getter**

In `runtime-capabilities.service.ts`, after the `supportsEpgMapping` getter (ends at line 169), insert:

```ts
    /**
     * Xtream and Stalker provider EPG (`get_short_epg`,
     * `get_simple_data_table`, `get_epg_info`). It needs only the portal
     * transport: the PWA's PwaService forwards to the web backend proxy,
     * Electron sends through both portal preload methods. Independent of
     * XMLTV (`supportsEpg` and its narrower flags).
     */
    get supportsProviderEpg(): boolean {
        return (
            this.isPwa ||
            (this.hasElectronMethod('xtreamRequest') &&
                this.hasElectronMethod('stalkerRequest'))
        );
    }
```

- [ ] **Step 4: Run the tests and lint**

```bash
pnpm nx test services --testPathPatterns=runtime-capabilities.service
pnpm nx lint services
```

Expected: PASS; lint clean (the file stays at 299 counted lines).

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/runtime-capabilities.service.ts libs/services/src/lib/runtime-capabilities.service.spec.ts
git commit -m "feat(services): add the supportsProviderEpg runtime capability

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Xtream store loads the provider guide on the transport gate

**Files:**
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts:114,157,236`
- Test: `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.spec.ts:45-101,187-201`
- Modify: `libs/portal/xtream/data-access/src/lib/stores/xtream.store.spec.ts:88-91`

- [ ] **Step 1: Write the failing tests**

In `with-epg.feature.spec.ts`:

1. Extend `TestStoreSetup` (line 45):

```ts
interface TestStoreSetup {
    appEnvironment?: 'electron' | 'pwa';
    /** Portal transport present (default true, as in both runtimes). */
    providerEpg?: boolean;
    selectedItem: { xtream_id: number; epg_channel_id?: string | null };
    preferUploaded?: boolean;
    epgOffsetMinutes?: number;
}
```

2. Replace the runtime stub in `configureStore` (lines 82-89):

```ts
            {
                provide: RuntimeCapabilitiesService,
                useValue: {
                    get supportsEpg() {
                        return (setup.appEnvironment ?? 'electron') !== 'pwa';
                    },
                },
            },
```

with

```ts
            {
                provide: RuntimeCapabilitiesService,
                useValue: {
                    // XMLTV exists only on the desktop; the portal transport
                    // exists in both runtimes unless a test removes it.
                    supportsEpg: (setup.appEnvironment ?? 'electron') !== 'pwa',
                    supportsProviderEpg: setup.providerEpg ?? true,
                },
            },
```

3. Replace the whole test `'does not load Xtream or XMLTV EPG in browser/PWA mode'` (lines 187-201) with:

```ts
    it('loads the Xtream provider guide in browser/PWA mode without XMLTV', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            appEnvironment: 'pwa',
            selectedItem: { xtream_id: 101, epg_channel_id: 'rtl.de' },
        });
        const now = Math.floor(Date.now() / 1000);
        const programs = [buildProgram('Provider Show', now - 600, now + 600)];
        xtreamApiService.getFullEpg.mockResolvedValue(programs);

        const result = await store.loadEpg();

        expect(xtreamApiService.getFullEpg).toHaveBeenCalledWith(
            {
                serverUrl: 'http://demo.example',
                username: 'demo',
                password: 'secret',
            },
            101,
            { suppressErrorLog: true }
        );
        expect(fallbackService.getProgramsForChannel).not.toHaveBeenCalled();
        expect(result).toEqual(programs);
        expect(store.currentEpgItem()).toEqual(programs[0]);
        expect(store.isLoadingEpg()).toBe(false);
    });

    it('loads a channel preview from get_short_epg in browser/PWA mode', async () => {
        const { store, xtreamApiService } = configureStore({
            appEnvironment: 'pwa',
            selectedItem: { xtream_id: 101 },
        });
        const now = Math.floor(Date.now() / 1000);
        const preview = [buildProgram('Preview Show', now - 60, now + 60)];
        xtreamApiService.getShortEpg.mockResolvedValue(preview);

        await expect(store.loadChannelEpg(202, null)).resolves.toEqual(
            preview
        );
        expect(xtreamApiService.getShortEpg).toHaveBeenCalledWith(
            expect.objectContaining({ serverUrl: 'http://demo.example' }),
            202,
            1,
            { suppressErrorLog: true }
        );
    });

    it('loads no EPG at all without a portal transport', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            providerEpg: false,
            selectedItem: { xtream_id: 101, epg_channel_id: 'rtl.de' },
        });

        const result = await store.loadEpg();
        const preview = await store.loadChannelEpg(101, 'rtl.de');

        expect(result).toEqual([]);
        expect(preview).toEqual([]);
        expect(store.epgItems()).toEqual([]);
        expect(store.isLoadingEpg()).toBe(false);
        expect(xtreamApiService.getFullEpg).not.toHaveBeenCalled();
        expect(xtreamApiService.getShortEpg).not.toHaveBeenCalled();
        expect(fallbackService.getProgramsForChannel).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm nx test portal-xtream-data-access --testPathPatterns=with-epg.feature`
Expected: 3 failures. The two PWA tests fail because `getFullEpg` / `getShortEpg` are never called (`Number of calls: 0`). The no-transport test fails because `getFullEpg` was called.

- [ ] **Step 3: Switch the gate**

In `with-epg.feature.ts` replace line 114

```ts
            const supportsEpg = (): boolean => runtime.supportsEpg;
```

with

```ts
            // Provider EPG needs only the portal transport (Electron IPC or
            // the PWA's backend proxy). The XMLTV parts — the manual mapping
            // lookup below and XtreamXmltvFallbackService — keep their own
            // capability checks and stay off in the PWA.
            const supportsProviderEpg = (): boolean =>
                runtime.supportsProviderEpg;
```

then rename the two calls (`loadEpg` line 157, `loadChannelEpg` line 236) and the store spec stub:

```bash
perl -pi -e 's/\bsupportsEpg\(\)/supportsProviderEpg()/g' libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts
perl -pi -e 's/useValue: \{ supportsEpg: false \}/useValue: { supportsProviderEpg: false }/' libs/portal/xtream/data-access/src/lib/stores/xtream.store.spec.ts
grep -n "supportsEpg\b\|supportsProviderEpg" libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts libs/portal/xtream/data-access/src/lib/stores/xtream.store.spec.ts
```

Expected grep: `with-epg.feature.ts` shows only `supportsProviderEpg` (the declaration and the two `if (!supportsProviderEpg())` lines), and `runtime.supportsEpgMapping` at line ~192 is still there. `xtream.store.spec.ts` shows `useValue: { supportsProviderEpg: false }`.

- [ ] **Step 4: Run the project tests and lint**

```bash
pnpm nx test portal-xtream-data-access
pnpm nx lint portal-xtream-data-access
```

Expected: PASS, including the existing XMLTV fallback tests (`preferUploaded` cases); lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/xtream/data-access/src/lib/stores
git commit -m "feat(xtream): load provider EPG wherever the portal transport exists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Xtream channel rows and live EPG panel in the PWA

**Files:**
- Modify: `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts:141,143,291,357,387,455,510`
- Modify: `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.html:13,38,43,47`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.ts:217`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.html:178`
- Test: `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.spec.ts:66-176,775-859`
- Test: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.spec.ts:221-238,345-361`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-auto-open-queue.component.spec.ts:137`, `live-stream-layout.sidebar-levels.spec.ts:183`

- [ ] **Step 1: Write the failing channel-list tests**

In `portal-channels-list.component.spec.ts`:

1. After the `epgQueueService` constant (ends line 75) add:

```ts
    let providerEpgAvailable = true;
```

2. At the top of `beforeEach` (line 77, before `Object.defineProperty(window, 'electron', …)`) add:

```ts
        providerEpgAvailable = true;
```

3. Replace the runtime provider (lines 138-145)

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                    },
                },
```

with

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsProviderEpg() {
                            return providerEpgAvailable;
                        },
                    },
                },
```

4. In the test `'does not derive or subscribe to row EPG previews in browser/PWA mode'` (line 775), replace its title and first statement

```ts
    it('does not derive or subscribe to row EPG previews in browser/PWA mode', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        selectedTypeContentLoading.set(false);
```

with

```ts
    it('does not derive or subscribe to row EPG previews without a portal transport', async () => {
        providerEpgAvailable = false;
        selectedTypeContentLoading.set(false);
```

and in the same test replace `expect(pwaComponent.supportsEpg).toBe(false);` with `expect(pwaComponent.supportsProviderEpg).toBe(false);`. Leave the rest of the test as it is: compact 52 px rows, no programmes, `showEpg()` false.

5. Directly after that test add:

```ts
    it('derives row EPG previews in browser/PWA mode through the portal transport', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        selectedTypeContentLoading.set(false);
        selectedChannels.set([{ title: 'Cartoon Network', xtream_id: 50 }]);

        fixture.destroy();
        fixture = TestBed.createComponent(PortalChannelsListComponent);
        fixture.detectChanges();
        await fixture.whenStable();

        epgResults$.next({
            streamId: 50,
            items: [
                buildEpgItem({
                    id: 'pwa-current',
                    title: 'PWA Current Show',
                    start: new Date(Date.now() - 60_000).toISOString(),
                    stop: new Date(Date.now() + 60_000).toISOString(),
                    startTimestamp: Math.floor((Date.now() - 60_000) / 1000),
                    stopTimestamp: Math.floor((Date.now() + 60_000) / 1000),
                }),
            ],
        });

        const component = fixture.componentInstance;
        expect(component.supportsProviderEpg).toBe(true);
        expect(component.channelItemSize).toBe(68);
        expect(component.epgPrograms.get(50)?.title).toBe('PWA Current Show');
    });
```

- [ ] **Step 2: Write the failing live-layout test**

In `live-stream-layout.component.spec.ts` replace in the runtime stub (lines 224-227)

```ts
                        supportsDownloads: true,
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
```

with

```ts
                        supportsDownloads: true,
                        // The portal transport exists in both runtimes.
                        supportsProviderEpg: true,
```

and replace the test `'hides the EPG panel in browser/PWA playback'` (lines 345-361) with:

```ts
    it('renders the provider EPG panel in browser/PWA playback', () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;

        component.playLive(sampleChannel);
        fixture.detectChanges();

        expect(component.isElectron).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-web-player-view')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.epg')).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-epg-timeline')
        ).not.toBeNull();
    });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm nx test portal-xtream-feature --testPathPatterns="portal-channels-list.component|live-stream-layout.component"`
Expected: FAIL. The components still read `runtime.supportsEpg`, which the stubs no longer define, so every EPG test reports `Received: undefined` or a `null` panel. That includes the new PWA tests and the existing Electron-mode ones such as `'renders the controlled epg list for electron playback'`.

- [ ] **Step 4: Switch both components and the remaining stubs**

Every `supportsEpg` in these four files is provider EPG (see the call-site table); `supportsEpgMapping` must stay. The `\b` boundary leaves `supportsEpgMapping` alone:

```bash
perl -pi -e 's/\bsupportsEpg\b/supportsProviderEpg/g' \
  libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts \
  libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.html \
  libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.ts \
  libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.html
perl -pi -e 's/\bsupportsEpg:/supportsProviderEpg:/g' \
  libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-auto-open-queue.component.spec.ts \
  libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.sidebar-levels.spec.ts
grep -rn "supportsEpg\b" libs/portal/xtream/feature/src
```

Expected: the final grep prints nothing. The results look like this, before → after:

```ts
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly supportsEpgMapping = this.runtime.supportsEpgMapping;
    readonly channelItemSize = this.supportsEpg ? 68 : 52;
```

```ts
    readonly supportsProviderEpg = this.runtime.supportsProviderEpg;
    readonly supportsEpgMapping = this.runtime.supportsEpgMapping;
    readonly channelItemSize = this.supportsProviderEpg ? 68 : 52;
```

`live-stream-layout.component.ts:217` becomes `readonly supportsProviderEpg = this.runtime.supportsProviderEpg;`, and `live-stream-layout.component.html:178` becomes `@if (supportsProviderEpg) {`. The "Map EPG channel" menu stays on `[showDetailsContextMenu]="supportsEpgMapping"` (`portal-channels-list.component.html:52`).

- [ ] **Step 5: Run the project tests and lint**

```bash
pnpm nx test portal-xtream-feature
pnpm nx lint portal-xtream-feature
```

Expected: PASS; lint clean.

- [ ] **Step 6: Commit**

```bash
git add libs/portal/xtream/feature/src/lib
git commit -m "feat(xtream): show provider EPG rows and the EPG panel in the PWA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stalker store requests portal EPG on the transport gate

**Files:**
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts:123,175,233,307`
- Test: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.spec.ts:46,58,76-83,127-137,200-`

- [ ] **Step 1: Write the failing tests**

In `with-stalker-epg.feature.spec.ts`:

1. After `let runtimeSupportsEpg: boolean;` (line 46) add `let runtimeSupportsProviderEpg: boolean;`. After `runtimeSupportsEpg = true;` (line 58) add `runtimeSupportsProviderEpg = true;`.

2. Replace the runtime stub (lines 76-83)

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return runtimeSupportsEpg;
                        },
                    },
                },
```

with

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return runtimeSupportsEpg;
                        },
                        get supportsProviderEpg() {
                            return runtimeSupportsProviderEpg;
                        },
                    },
                },
```

3. Replace the test `'does not request short EPG in browser/PWA mode'` (lines 127-137) with:

```ts
    it('requests short and bulk EPG in browser/PWA mode without XMLTV', async () => {
        runtimeSupportsEpg = false;
        dataService.sendIpcEvent.mockResolvedValueOnce({
            js: {
                data: [
                    buildEntry('10001', 'Current Show', 1744365600, 1744367400),
                ],
            },
        });
        dataService.sendIpcEvent.mockResolvedValueOnce({
            js: {
                data: {
                    '10001': [
                        buildEntry(
                            '10001',
                            'Current Show',
                            1744362000,
                            1744365600
                        ),
                    ],
                },
            },
        });

        const shortEpg = await store.fetchChannelEpg('10001');
        await store.ensureBulkItvEpg(168);

        expect(shortEpg).toEqual([
            buildEpgItem('10001', 'Current Show', 1744365600, 1744367400),
        ]);
        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: 'get_epg_info',
                    period: '168',
                }),
            })
        );
        expect(store.selectedItvEpgPrograms()).toEqual([
            buildProgram('10001', 'Current Show', 1744362000, 1744365600),
        ]);
    });

    it('does not request portal EPG without a portal transport', async () => {
        runtimeSupportsProviderEpg = false;

        const result = await store.fetchChannelEpg('10001');
        await store.ensureBulkItvEpg(168);

        expect(result).toEqual([]);
        expect(store.bulkItvEpgLoaded()).toBe(true);
        expect(store.bulkItvEpgByChannel()).toEqual({});
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(
            stalkerSessionService.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });
```

4. Inside `describe('applyMappedItvEpg', …)`, after `'checks each channel id only once per playlist session'`, add:

```ts
        it('skips manual mappings without XMLTV even when provider EPG is on', async () => {
            runtimeSupportsEpg = false;

            await store.applyMappedItvEpg(['10001']);

            expect(epgBridge.getEpgMappingsBatch).not.toHaveBeenCalled();
        });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm nx test portal-stalker-data-access --testPathPatterns=with-stalker-epg.feature`
Expected: 2 failures. `'requests short and bulk EPG in browser/PWA mode without XMLTV'` fails because `fetchChannelEpg` returned `[]`. `'does not request portal EPG without a portal transport'` fails because `sendIpcEvent` was called. The mapping test passes already; it guards Step 3.

- [ ] **Step 3: Split the gates**

In `with-stalker-epg.feature.ts` replace line 123

```ts
                const supportsEpg = (): boolean => runtime.supportsEpg;
```

with

```ts
                // Portal EPG needs only the Stalker transport (Electron IPC or
                // the PWA's backend proxy). Manual mappings read uploaded
                // XMLTV and keep the XMLTV gate in applyMappedItvEpg.
                const supportsProviderEpg = (): boolean =>
                    runtime.supportsProviderEpg;
```

replace in `applyMappedItvEpg` (line 307)

```ts
                        if (!epgBridge.supportsEpgMapping || !supportsEpg()) {
```

with

```ts
                        if (
                            !epgBridge.supportsEpgMapping ||
                            !runtime.supportsEpg
                        ) {
```

and rename the two remaining calls (`fetchShortEpg` line 175, `ensureBulkItvEpg` line 233):

```bash
perl -pi -e 's/\bsupportsEpg\(\)/supportsProviderEpg()/g' libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts
grep -n "supportsEpg\b\|supportsProviderEpg" libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts
```

Expected grep: the declaration, two `if (!supportsProviderEpg())` lines, and `!runtime.supportsEpg` in `applyMappedItvEpg`.

- [ ] **Step 4: Run the project tests and lint**

```bash
pnpm nx test portal-stalker-data-access
pnpm nx lint portal-stalker-data-access
```

Expected: PASS, including the existing `applyMappedItvEpg` tests (both flags true there); lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/stalker/data-access/src/lib/stores/features
git commit -m "feat(stalker): request portal EPG through any portal transport

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stalker ITV rows and EPG panel in the PWA

**Files:**
- Modify: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts:372,764,813,1019,1362,1516,1711`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.html:172,209,232,294,325,332,338`
- Test: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.epg-races.spec.ts:130-143,195-` (new test)
- Modify: `…/stalker-live-stream-layout.component.spec.ts:283,408-410`, `…panel-search.spec.ts:123`, `…playback-session-key.spec.ts:112`, `…remote-status.spec.ts:175`

- [ ] **Step 1: Write the failing test**

In `stalker-live-stream-layout.epg-races.spec.ts`:

1. In `beforeEach`, after `hasItvEpgMappingOverride.mockReturnValue(false);` (line 131) add:

```ts
        store.ensureBulkItvEpg.mockClear();
```

2. Replace the runtime stub (lines 136-143)

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: true,
                        isElectron: true,
                        supportsEpgMapping: false,
                    },
                },
```

with

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        // Provider EPG only, no XMLTV flag — as in the PWA.
                        supportsProviderEpg: true,
                        isElectron: true,
                        supportsEpgMapping: false,
                    },
                },
```

3. After `afterEach(() => fixture.destroy());` add:

```ts
    it('loads the bulk guide from provider EPG alone, as in the browser PWA', async () => {
        for (let i = 0; i < 3; i += 1) {
            fixture.detectChanges();
            await fixture.whenStable();
        }

        expect(store.ensureBulkItvEpg).toHaveBeenCalledWith(168);
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test portal-stalker-feature --testPathPatterns=stalker-live-stream-layout.epg-races`
Expected: FAIL. The new test reports `Number of calls: 0`, and the existing race tests fail too (for example, `activeEpgPrograms()` is missing `'Now channel-one'`). The component still reads `runtime.supportsEpg`, which the stub no longer defines.

- [ ] **Step 3: Switch the component and the other stubs**

Every `supportsEpg` in the component and its template is provider EPG; the mapping menu (`.html:343`) and the overlay call (`.ts:777`) use `supportsEpgMapping` and stay:

```bash
D=libs/portal/stalker/feature/src/lib/stalker-live-stream-layout
perl -pi -e 's/\bsupportsEpg\b/supportsProviderEpg/g' $D/stalker-live-stream-layout.component.ts $D/stalker-live-stream-layout.component.html
perl -pi -e 's/\bsupportsEpg(\(\)|:)/supportsProviderEpg$1/g' \
  $D/stalker-live-stream-layout.component.spec.ts \
  $D/stalker-live-stream-layout.panel-search.spec.ts \
  $D/stalker-live-stream-layout.playback-session-key.spec.ts \
  $D/stalker-live-stream-layout.remote-status.spec.ts
grep -rn "supportsEpg\b" $D
grep -c "supportsProviderEpg" $D/stalker-live-stream-layout.component.ts $D/stalker-live-stream-layout.component.html
```

Expected: the first grep prints nothing; both line counts are `7` (`.ts`: the field line, which renames two identifiers, and six uses; `.html`: seven bindings). For example, the field becomes

```ts
    readonly supportsProviderEpg = this.runtime.supportsProviderEpg;
    readonly supportsEpgMapping = this.runtime.supportsEpgMapping;
```

and the panel guard `@if (!isRadioMode() && supportsEpg) {` becomes `@if (!isRadioMode() && supportsProviderEpg) {`. The empty state `[emptyReason]="supportsProviderEpg ? 'none' : 'provider-no-epg'"` now reads "no transport", which is what `provider-no-epg` means.

- [ ] **Step 4: Retitle the no-transport test in the main spec**

`stalker-live-stream-layout.component.spec.ts` is at the 1200-line cap, so this step changes only a title and comments (comments do not count). The stub derives every flag from `window.electron`. Replace (line 408-410)

```ts
    it('does not request or render EPG in browser/PWA playback', async () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;
```

with

```ts
    it('does not request or render EPG without a portal transport', async () => {
        fixture.destroy();
        // This spec's runtime stub derives every flag from window.electron,
        // so clearing it removes the portal transport. The browser PWA has
        // one: see the provider-only test in the epg-races spec.
        window.electron = undefined as unknown as typeof window.electron;
```

- [ ] **Step 5: Run the project tests and lint**

```bash
pnpm nx test portal-stalker-feature
pnpm nx lint portal-stalker-feature
```

Expected: PASS (`'loads bulk EPG and shows row previews on category entry, before any playback'` and the radio test unchanged); lint clean, the main spec still at 1200 counted lines.

- [ ] **Step 6: Commit**

```bash
git add libs/portal/stalker/feature/src/lib/stalker-live-stream-layout
git commit -m "feat(stalker): show provider EPG rows and the EPG panel in the PWA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Collection resolver separates portal guides from XMLTV

**Files:**
- Modify: `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.ts:4-8,101,130-132,200-271,283,317,1133,1275`
- Create: `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.provider-epg.spec.ts`
- Modify: `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.spec.ts:12-16,82-86,302-334`
- Modify: `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.epg-offset.spec.ts:9-13,59-67`

- [ ] **Step 1: Write the failing spec**

Create `stream-resolver.service.provider-epg.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { StreamResolverService } from './stream-resolver.service';

/**
 * Portal guides without the desktop XMLTV bridge (browser PWA, #1683):
 * Xtream and Stalker lookups depend on `supportsProviderEpg`, XMLTV lookups
 * on `supportsProgramLookup`. Kept apart from `stream-resolver.service.spec.ts`,
 * which sits at the test line cap.
 */
describe('StreamResolverService provider EPG', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const xtreamItem = {
        uid: 'xtream::xtream-1::1',
        name: 'Xtream Live',
        contentType: 'live',
        sourceType: 'xtream',
        playlistId: 'xtream-1',
        playlistName: 'Xtream',
        xtreamId: 1,
        tvgId: 'xtream.tv',
        logo: 'xtream.png',
    } satisfies UnifiedCollectionItem;
    const stalkerItem = {
        uid: 'stalker::stalker-1::77',
        name: 'Stalker Channel',
        contentType: 'live',
        sourceType: 'stalker',
        playlistId: 'stalker-1',
        playlistName: 'Stalker',
        stalkerId: '77',
        tvgId: '77',
        stalkerCmd: 'ffmpeg http://stalker/77',
    } satisfies UnifiedCollectionItem;
    const m3uItem = {
        uid: 'm3u::m3u-1::news',
        name: 'M3U News',
        contentType: 'live',
        sourceType: 'm3u',
        playlistId: 'm3u-1',
        playlistName: 'M3U',
        tvgId: 'news.tv',
        streamUrl: 'https://m3u.example.com/news.m3u8',
    } satisfies UnifiedCollectionItem;
    const playlists: Record<string, Partial<Playlist>> = {
        'xtream-1': {
            _id: 'xtream-1',
            serverUrl: 'https://xtream.example.com',
            username: 'user',
            password: 'pass',
        },
        'stalker-1': {
            _id: 'stalker-1',
            portalUrl: 'https://stalker.example.com/portal.php',
            macAddress: '00:11:22:33:44:55',
            isFullStalkerPortal: false,
        },
    };
    const xtreamListing = (title: string) => ({
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: new Date((nowSeconds - 60) * 1000).toISOString(),
        end: new Date((nowSeconds + 60) * 1000).toISOString(),
        stop: new Date((nowSeconds + 60) * 1000).toISOString(),
        channel_id: '1',
        start_timestamp: String(nowSeconds - 60),
        stop_timestamp: String(nowSeconds + 60),
    });
    const stalkerShortEpg = {
        js: [
            {
                id: '10',
                name: 'Stalker Now',
                descr: 'Current Stalker program',
                time: '2026-03-26T11:00:00.000Z',
                time_to: '2026-03-26T12:00:00.000Z',
                ch_id: '77',
                start_timestamp: String(nowSeconds - 60),
                stop_timestamp: String(nowSeconds + 60),
            },
        ],
    };

    let service: StreamResolverService;
    let runtime: { supportsProviderEpg: boolean };
    let epgBridge: {
        supportsProgramLookup: boolean;
        getChannelPrograms: jest.Mock;
        getEpgMapping: jest.Mock;
        getEpgMappingsBatch: jest.Mock;
    };
    let xtreamApi: { getShortEpg: jest.Mock; getFullEpg: jest.Mock };
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(() => {
        runtime = { supportsProviderEpg: true };
        epgBridge = {
            supportsProgramLookup: false,
            getChannelPrograms: jest.fn().mockResolvedValue([]),
            getEpgMapping: jest.fn().mockResolvedValue(null),
            getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
        };
        xtreamApi = {
            getShortEpg: jest
                .fn()
                .mockResolvedValue([xtreamListing('Xtream Now')]),
            getFullEpg: jest.fn().mockResolvedValue([]),
        };
        dataService = {
            sendIpcEvent: jest.fn(
                async (_type: string, request: { params: { action: string } }) =>
                    request.params.action === 'create_link'
                        ? { js: { cmd: 'ffmpeg http://cdn.example.com/tmp/77.m3u8' } }
                        : stalkerShortEpg
            ),
        };

        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn((id: string) =>
                            of(playlists[id])
                        ),
                    },
                },
                { provide: XtreamApiService, useValue: xtreamApi },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructLiveUrl: jest.fn(
                            () => 'https://xtream.example.com/live/1'
                        ),
                    },
                },
                { provide: DataService, useValue: dataService },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: () => 0 },
                },
                { provide: EpgRuntimeBridgeService, useValue: epgBridge },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        getCachedToken: jest.fn(() => null),
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                        makeAuthenticatedRequest: jest.fn(),
                    },
                },
            ],
        });

        service = TestBed.inject(StreamResolverService);
    });

    it('loads Xtream and Stalker rows from the portal without the XMLTV bridge', async () => {
        const epgMap = await service.loadEpgForItems([
            xtreamItem,
            stalkerItem,
            m3uItem,
        ]);

        expect(epgMap.get('xtream.tv')?.title).toBe('Xtream Now');
        expect(epgMap.get('77')?.title).toBe('Stalker Now');
        // M3U rows need XMLTV, which this runtime does not have.
        expect(epgMap.has('news.tv')).toBe(false);
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
        expect(epgBridge.getEpgMappingsBatch).not.toHaveBeenCalled();
    });

    it('resolves the Xtream detail guide from the portal without the XMLTV bridge', async () => {
        xtreamApi.getFullEpg.mockResolvedValue([
            xtreamListing('Full Guide Now'),
        ]);

        const detail = await service.resolveLiveDetail(xtreamItem);

        expect(detail.epgMode).toBe('portal');
        expect(detail.epgItems?.map((item) => item.title)).toEqual([
            'Full Guide Now',
        ]);
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
    });

    it('resolves the Stalker detail guide from the portal without the XMLTV bridge', async () => {
        const detail = await service.resolveLiveDetail(stalkerItem);

        expect(detail.epgMode).toBe('portal');
        expect(detail.epgItems?.map((item) => item.title)).toEqual([
            'Stalker Now',
        ]);
        expect(epgBridge.getEpgMapping).not.toHaveBeenCalled();
    });

    it('asks no portal for EPG without a portal transport', async () => {
        runtime.supportsProviderEpg = false;
        epgBridge.supportsProgramLookup = true;

        const detail = await service.resolveLiveDetail(xtreamItem);
        const epgMap = await service.loadEpgForItems([
            xtreamItem,
            stalkerItem,
        ]);

        expect(detail.epgItems).toEqual([]);
        expect(epgMap.size).toBe(0);
        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(xtreamApi.getFullEpg).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test portal-shared-data-access --testPathPatterns=stream-resolver.service.provider-epg`
Expected: 4 failures. The two detail tests get `[]`. The rows test gets an empty map, because the early return at `:204` fires. The no-transport test sees `getShortEpg` called.

- [ ] **Step 3: Add the runtime and split the gates**

In `stream-resolver.service.ts`:

1. Import (lines 4-8): add `RuntimeCapabilitiesService` to the `@iptvnator/services` import:

```ts
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
```

2. After `private readonly epgBridge = inject(EpgRuntimeBridgeService);` (line 101) add:

```ts
    private readonly runtime = inject(RuntimeCapabilitiesService);
```

3. Replace the getter (lines 130-132)

```ts
    private get supportsProgramLookup(): boolean {
        return this.epgBridge.supportsProgramLookup;
    }
```

with

```ts
    /** Local XMLTV: M3U guides, `epg_channel_id` matches, manual mappings. */
    private get supportsProgramLookup(): boolean {
        return this.epgBridge.supportsProgramLookup;
    }

    /** Xtream and Stalker guides: only the portal transport is needed. */
    private get supportsProviderEpg(): boolean {
        return this.runtime.supportsProviderEpg;
    }
```

4. In `loadEpgForItems` replace

```ts
        const epgMap = new Map<string, EpgProgram | null>();
        if (!this.supportsProgramLookup) {
            return epgMap;
        }
```

with

```ts
        const epgMap = new Map<string, EpgProgram | null>();
        // M3U rows read XMLTV; Xtream and Stalker rows ask their portal.
        const loadsM3u = this.supportsProgramLookup;
        const loadsPortals = this.supportsProviderEpg;
        if (!loadsM3u && !loadsPortals) {
            return epgMap;
        }
```

then, in the grouping loop, replace

```ts
        for (const item of items) {
            if (item.contentType !== 'live') {
                continue;
            }
```

with

```ts
        for (const item of items) {
            if (!loadsPortals || item.contentType !== 'live') {
                continue;
            }
```

and in the M3U loop replace

```ts
            if (item.sourceType === 'm3u' && item.contentType === 'live') {
```

with

```ts
            if (
                loadsM3u &&
                item.sourceType === 'm3u' &&
                item.contentType === 'live'
            ) {
```

5. In `resolveXtreamDetail` replace

```ts
        const playback = await this.resolveXtream(item);
        if (!this.supportsProgramLookup) {
```

with

```ts
        const playback = await this.resolveXtream(item);
        if (!this.supportsProviderEpg) {
```

6. In `resolveStalkerDetail`, the second guard (after the radio branch) — replace

```ts
                epgItems: [],
            };
        }

        if (!this.supportsProgramLookup) {
            return {
                playback,
                epgMode: 'portal',
                epgItems: [],
            };
        }

        const epgItems = await this.withFallbackTimeout(
            this.loadStalkerEpgItems(item, 10),
```

with

```ts
                epgItems: [],
            };
        }

        if (!this.supportsProviderEpg) {
            return {
                playback,
                epgMode: 'portal',
                epgItems: [],
            };
        }

        const epgItems = await this.withFallbackTimeout(
            this.loadStalkerEpgItems(item, 10),
```

7. In `fetchXtreamEpgItems` replace

```ts
        clock = this.epgLoadClock()
    ): Promise<EpgItem[]> {
        if (!this.supportsProgramLookup) {
            return [];
        }

        const { offsetMinutes, wallNowMs } = clock;
```

with

```ts
        clock = this.epgLoadClock()
    ): Promise<EpgItem[]> {
        if (!this.supportsProviderEpg) {
            return [];
        }

        const { offsetMinutes, wallNowMs } = clock;
```

8. In `fetchStalkerShortEpg` replace

```ts
        size: number
    ): Promise<EpgItem[]> {
        if (!this.supportsProgramLookup) {
            return [];
        }

        const params = {
```

with

```ts
        size: number
    ): Promise<EpgItem[]> {
        if (!this.supportsProviderEpg) {
            return [];
        }

        const params = {
```

Verify the split:

```bash
grep -n "supportsProgramLookup\|supportsProviderEpg" libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.ts
```

Expected: `supportsProviderEpg` appears in its getter, `loadEpgForItems`, `resolveXtreamDetail`, `resolveStalkerDetail`, `fetchXtreamEpgItems` and `fetchStalkerShortEpg`. `supportsProgramLookup` is still used only for XMLTV: `loadsM3u`, `loadXtreamEpgItems` (XMLTV and mapping), `loadStalkerEpgItems` (mapping), `buildM3uDetail`, `fetchM3uPrograms`, `loadXtreamEpgBatch` (XMLTV and mapping), `prefetchEpgMappings` and `findCurrentInXmltv`.

- [ ] **Step 4: Point the existing specs at an explicit runtime**

In `stream-resolver.service.spec.ts`:
1. Add `RuntimeCapabilitiesService,` to the `@iptvnator/services` import (lines 12-16).
2. After the `EpgRuntimeBridgeService` provider (lines 82-85) add:

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsProviderEpg: true },
                },
```

3. Delete the whole test `'skips portal EPG lookups in browser/PWA mode'` (lines 302-334). It asserted that the PWA has no portal guides. The new spec's no-transport test replaces it, and the rows test covers the PWA case.

In `stream-resolver.service.epg-offset.spec.ts` add `RuntimeCapabilitiesService,` to the `@iptvnator/services` import and the same provider after its `EpgRuntimeBridgeService` provider.

- [ ] **Step 5: Run the resolver specs and lint**

```bash
pnpm nx test portal-shared-data-access --testPathPatterns=stream-resolver
pnpm nx lint portal-shared-data-access
```

Expected: PASS for all four `stream-resolver*` specs; lint clean.

- [ ] **Step 6: Commit**

```bash
git add libs/portal/shared/data-access/src/lib/collection
git commit -m "feat(collections): resolve portal EPG without the XMLTV bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Favorites and recent show portal guides in the PWA

**Files:**
- Modify: `libs/portal/shared/ui/src/lib/components/global-favorites-list/global-favorites-list.component.ts:82`
- Modify: `libs/portal/shared/ui/src/lib/components/global-favorites-list/global-favorites-list.component.html:38`
- Test: `libs/portal/shared/ui/src/lib/components/global-favorites-list/global-favorites-list.component.spec.ts:1-43,116-128,317-`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.ts:127,170-171,219-223,252-258`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.html:14,81,196`
- Test: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.spec.ts:107-114,229-290,839-873`
- Modify: `…/unified-live-tab.fullscreen-panel.spec.ts:81-88`, `…/unified-live-tab.open-in-playlist.spec.ts:72-75`

- [ ] **Step 1: Write the failing favorites-list tests**

In `global-favorites-list.component.spec.ts`:

1. Imports: change `import { Channel } from '@iptvnator/shared/interfaces';` to `import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';` and `import { SettingsStore } from '@iptvnator/services';` to `import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';`.

2. After `let dialog: { open: jest.Mock };` add:

```ts
    let runtime: { supportsEpg: boolean; supportsProviderEpg: boolean };

    /** The rendered row whose channel name is `name`. */
    function rowNamed(name: string): HTMLElement {
        const rows = Array.from(
            fixture.nativeElement.querySelectorAll(
                '.channel-list-item'
            ) as NodeListOf<HTMLElement>
        );
        const row = rows.find(
            (element) =>
                element.querySelector('.channel-name')?.textContent?.trim() ===
                name
        );
        if (!row) {
            throw new Error(`No row named ${name}`);
        }
        return row;
    }
```

3. At the top of `beforeEach` add `runtime = { supportsEpg: false, supportsProviderEpg: true };`, and add to `providers`:

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
```

4. After the test `'renders non-radio rows as compact when the host disables EPG'` add:

```ts
    it('gives Xtream and Stalker rows the provider programme line and keeps M3U rows compact without XMLTV', () => {
        fixture.componentRef.setInput('channels', [
            buildChannel('x', 'Xtream Live', {
                sourceType: 'xtream',
                xtreamId: 7,
                tvgId: '7',
            }),
            buildChannel('s', 'Stalker Live', {
                sourceType: 'stalker',
                stalkerId: '9',
                tvgId: '9',
            }),
            buildChannel('m', 'M3U Live'),
        ]);
        fixture.componentRef.setInput(
            'epgMap',
            new Map([
                ['7', airingProgram('Xtream Show')],
                ['9', airingProgram('Stalker Show')],
            ])
        );
        fixture.detectChanges();

        expect(
            rowNamed('Xtream Live').querySelector('.epg-title')?.textContent
        ).toContain('Xtream Show');
        expect(
            rowNamed('Stalker Live').querySelector('.epg-title')?.textContent
        ).toContain('Stalker Show');
        expect(rowNamed('M3U Live').classList.contains('compact')).toBe(true);
    });

    it('gives M3U rows their programme line when XMLTV is available', () => {
        runtime.supportsEpg = true;
        fixture = TestBed.createComponent(GlobalFavoritesListComponent);
        fixture.componentRef.setInput('channels', [
            buildChannel('m', 'M3U Live', { tvgId: 'm3u.tv' }),
        ]);
        fixture.componentRef.setInput(
            'epgMap',
            new Map([['m3u.tv', airingProgram('M3U Show')]])
        );
        fixture.detectChanges();

        expect(
            rowNamed('M3U Live').querySelector('.epg-title')?.textContent
        ).toContain('M3U Show');
    });
```

5. At the end of the file add:

```ts
function airingProgram(title: string): EpgProgram {
    const now = Date.now();
    return {
        start: new Date(now - 10 * 60_000).toISOString(),
        stop: new Date(now + 10 * 60_000).toISOString(),
        channel: 'test-channel',
        title,
        desc: null,
        category: null,
    };
}
```

- [ ] **Step 2: Write the failing live-tab tests**

In `unified-live-tab.component.spec.ts`:

1. In the runtime stub (lines 107-114) add the provider flag:

```ts
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsProviderEpg: true,
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                    },
                },
```

2. In the test `'skips EPG loading and hides the EPG panel in browser/PWA playback'` (line 229):
   - title → `'asks only portals for EPG and hides the M3U EPG panel in browser/PWA playback'`
   - replace `expect(streamResolver.loadEpgForItems).not.toHaveBeenCalled();` (the line just before `expect(streamResolver.loadM3uProgramsForItem).not.toHaveBeenCalled();` in this test) with `expect(streamResolver.loadEpgForItems).toHaveBeenCalledWith([item]);`
   - replace `expect(list.showEpg()).toBe(false);` with:

```ts
        // The list decides each row by its source; M3U rows stay compact.
        expect(list.showEpg()).toBe(true);
```

   The M3U selection still has no `.epg` panel and no `app-epg-timeline`; keep those assertions.

3. After the test `'renders shared EPG view for Xtream items and records recent history'` (ends line 872) add:

```ts
    it('renders the Xtream provider guide in browser/PWA playback without XMLTV', async () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildEpgItem('Xtream Show')],
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.supportsEpg).toBe(false);
        expect(streamResolver.loadEpgForItems).toHaveBeenCalledWith([item]);
        const timeline = fixture.debugElement.query(
            By.directive(StubEpgTimelineComponent)
        ).componentInstance as StubEpgTimelineComponent;
        expect(timeline.programs()).toEqual([
            expect.objectContaining({ title: 'Xtream Show' }),
        ]);
    });
```

4. Keep the sibling specs on the same contract: in `unified-live-tab.fullscreen-panel.spec.ts` add `supportsProviderEpg: true,` as the first property of the runtime stub's `useValue` (lines 81-88); in `unified-live-tab.open-in-playlist.spec.ts` change `useValue: { supportsEpg: true },` (line 74) to `useValue: { supportsEpg: true, supportsProviderEpg: true },`, because its chip lives in the Xtream/Stalker EPG panel.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm nx test portal-shared-ui --testPathPatterns="global-favorites-list|unified-live-tab"`
Expected failures:
- the Xtream/Stalker row test (no `.epg-title`: the rows are compact because `showEpg` defaults to `supportsEpg`)
- `'asks only portals for EPG…'` (`loadEpgForItems` not called)
- `'renders the Xtream provider guide…'` (`Cannot read properties of null (reading 'componentInstance')`, no panel)
- the open-in-playlist chip tests are still green, because they run with `supportsEpg: true`

- [ ] **Step 4: Gate the favorites list per row**

In `global-favorites-list.component.ts` replace line 82

```ts
    readonly showEpg = input(this.runtime.supportsEpg);
```

with

```ts
    /** Host switch for programme lines; each row also needs its guide. */
    readonly showEpg = input(true);
    /**
     * Which rows can carry a programme line: M3U rows need XMLTV, Xtream
     * and Stalker rows read their provider's guide (also in the PWA).
     */
    protected readonly guideBySource = {
        m3u: this.runtime.supportsEpg,
        xtream: this.runtime.supportsProviderEpg,
        stalker: this.runtime.supportsProviderEpg,
    };
```

In `global-favorites-list.component.html` replace line 38

```html
            [showEpg]="showEpg() && ch.radio !== 'true'"
```

with

```html
            [showEpg]="
                showEpg() && ch.radio !== 'true' && guideBySource[ch.sourceType]
            "
```

- [ ] **Step 5: Split the live tab's gates**

In `unified-live-tab.component.ts`:

1. Replace line 127

```ts
    readonly supportsEpg = this.runtime.supportsEpg;
```

with

```ts
    readonly supportsEpg = this.runtime.supportsEpg;
    private readonly supportsProviderEpg = this.runtime.supportsProviderEpg;
    /** Some row can carry a programme: XMLTV for M3U, the portal guide otherwise. */
    protected readonly supportsAnyEpg =
        this.supportsEpg || this.supportsProviderEpg;
```

2. After `readonly playbackSessionKey = this.view.playbackSessionKey;` (line 171) add:

```ts
    /** M3U selections need XMLTV; Xtream and Stalker ones read the portal guide. */
    readonly showsEpgPanel = computed(
        () =>
            !this.isRadioSelection() &&
            (this.view.isM3uSelection()
                ? this.supportsEpg
                : this.supportsProviderEpg)
    );
```

3. Replace (lines 219-223)

```ts
    private readonly epgPrograms = createUnifiedLiveEpgMap({
        supportsEpg: this.supportsEpg,
        items: this.items,
```

with

```ts
    private readonly epgPrograms = createUnifiedLiveEpgMap({
        supportsEpg: this.supportsAnyEpg,
        items: this.items,
```

Leave `supportsEpg: this.supportsEpg,` in `createUnifiedLiveSelection` (line 233) as it is: it only hydrates M3U programmes.

4. In the constructor effect replace

```ts
            const items = this.items();
            if (this.supportsEpg) {
                this.epgPrograms.load(items);
```

with

```ts
            const items = this.items();
            if (this.supportsAnyEpg) {
                this.epgPrograms.load(items);
```

In `unified-live-tab.component.html`:
- lines 14 and 196: `[showEpg]="supportsEpg"` → `[showEpg]="supportsAnyEpg"`
- line 81: `@if (!isRadioSelection() && supportsEpg) {` → `@if (showsEpgPanel()) {`

```bash
grep -n "supportsEpg\|supportsAnyEpg\|showsEpgPanel" libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.html
```

Expected: two `supportsAnyEpg` bindings, one `showsEpgPanel()`, no `supportsEpg`.

- [ ] **Step 6: Run the tests, lint and the line budgets**

```bash
pnpm nx test portal-shared-ui
pnpm nx lint portal-shared-ui
```

Expected: PASS. Lint is clean, with `unified-live-tab.component.ts` at 388 and `global-favorites-list.component.ts` at 304 counted lines, both under 400.

- [ ] **Step 7: Commit**

```bash
git add libs/portal/shared/ui/src/lib/components
git commit -m "feat(collections): show portal EPG in favorites and recent in the PWA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Collection loading skeleton follows the row rule

**Files:**
- Create: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-skeleton.ts`
- Create: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-skeleton.spec.ts`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-page.component.ts:68,130,161`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-page.component.html:24`
- Test: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-page.component.spec.ts` (after `'uses compact loading rows when the runtime has no EPG support'`, line 326)

Today the skeleton reserves the programme line only on `supportsEpg`, so in the PWA an Xtream or Stalker list jumps from 52 to 68 px rows when it arrives (Task 8 gives those rows their line). The skeleton now uses the rows' rule.
- A collection scoped to one playlist knows its source: `portalType` and the effective scope `'playlist'`.
- A collection across all playlists may hold any source, so it reserves the line whenever any guide exists. In the PWA an M3U-only "all playlists" list therefore still shrinks from 68 to 52 px. The page cannot know the sources before the rows arrive, so this is the smaller of the two jumps.

- [ ] **Step 1: Write the failing tests**

Create `unified-collection-skeleton.spec.ts`:

```ts
import { collectionSkeletonShowsEpg } from './unified-collection-skeleton';

describe('collectionSkeletonShowsEpg', () => {
    const pwa = { xmltv: false, provider: true };
    const desktop = { xmltv: true, provider: true };
    const none = { xmltv: false, provider: false };

    it('reserves the programme line for one portal playlist with a provider guide (browser PWA)', () => {
        expect(collectionSkeletonShowsEpg('xtream', 'playlist', pwa)).toBe(
            true
        );
        expect(collectionSkeletonShowsEpg('stalker', 'playlist', pwa)).toBe(
            true
        );
    });

    it('keeps one M3U playlist compact without XMLTV', () => {
        expect(collectionSkeletonShowsEpg('m3u', 'playlist', pwa)).toBe(false);
    });

    it('reserves the line across all playlists whenever any guide exists', () => {
        expect(collectionSkeletonShowsEpg(undefined, 'all', pwa)).toBe(true);
        expect(collectionSkeletonShowsEpg('m3u', 'all', pwa)).toBe(true);
        expect(collectionSkeletonShowsEpg(undefined, 'all', none)).toBe(false);
        expect(collectionSkeletonShowsEpg('xtream', 'playlist', none)).toBe(
            false
        );
    });

    it('reserves the line everywhere on the desktop', () => {
        for (const portalType of ['m3u', 'xtream', 'stalker', undefined]) {
            expect(
                collectionSkeletonShowsEpg(portalType, 'playlist', desktop)
            ).toBe(true);
            expect(collectionSkeletonShowsEpg(portalType, 'all', desktop)).toBe(
                true
            );
        }
    });
});
```

In `unified-collection-page.component.spec.ts`, after the test `'uses compact loading rows when the runtime has no EPG support'`, add:

```ts
    it('reserves the programme line while an Xtream playlist loads in the browser PWA', () => {
        // The stub has no XMLTV; the portal transport gives Xtream rows
        // their programme line, so the skeleton must not be compact.
        Object.assign(TestBed.inject(RuntimeCapabilitiesService), {
            supportsProviderEpg: true,
        });
        setRouteParams({ id: 'playlist-1' });
        fixture.componentRef.setInput('portalType', 'xtream');
        fixture.componentRef.setInput('defaultScope', 'playlist');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '.channel-list-item-skeleton:not(.compact)'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '.channel-list-item-skeleton.compact'
            )
        ).toBeNull();
    });
```

`setRouteParams` is the spec's own route helper, which the scope tests already use (line 372).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm nx test portal-shared-ui --testPathPatterns="unified-collection-skeleton|unified-collection-page.component"`
Expected: FAIL. The skeleton spec fails with `Cannot find module './unified-collection-skeleton'`. The page test finds only compact skeleton rows, because the page still binds `supportsEpg`, which is `false` in the stub.

- [ ] **Step 3: Add the rule**

Create `unified-collection-skeleton.ts`:

```ts
import { CollectionScope } from '@iptvnator/portal/shared/util';

/** The guides this runtime offers; see `RuntimeCapabilitiesService`. */
export interface CollectionGuideSupport {
    /** XMLTV guides for M3U channels (`supportsEpg`). */
    readonly xmltv: boolean;
    /** Xtream and Stalker provider guides (`supportsProviderEpg`). */
    readonly provider: boolean;
}

/**
 * Whether the collection's loading skeleton reserves the programme line.
 * Same rule as the rows (`GlobalFavoritesListComponent.guideBySource`): M3U
 * rows need XMLTV, Xtream and Stalker rows their provider's guide. A
 * collection scoped to one playlist knows its source; one across all
 * playlists may hold any, so it reserves the line whenever a guide exists.
 */
export function collectionSkeletonShowsEpg(
    portalType: string | undefined,
    scope: CollectionScope,
    guides: CollectionGuideSupport
): boolean {
    if (scope === 'playlist' && portalType === 'm3u') {
        return guides.xmltv;
    }
    if (
        scope === 'playlist' &&
        (portalType === 'xtream' || portalType === 'stalker')
    ) {
        return guides.provider;
    }
    return guides.xmltv || guides.provider;
}
```

In `unified-collection-page.component.ts`:

1. Add the import after `import { createCollectionScopeState } from './unified-collection-scope';`:

```ts
import { collectionSkeletonShowsEpg } from './unified-collection-skeleton';
```

2. Delete line 130

```ts
    readonly supportsEpg = this.runtime.supportsEpg;
```

3. After `readonly effectiveScope = this.scopeState.effective;` (line 161) add:

```ts
    /** Skeleton rows reserve the programme line like the rows they stand for. */
    readonly skeletonShowsEpg = computed(() =>
        collectionSkeletonShowsEpg(this.portalType(), this.effectiveScope(), {
            xmltv: this.runtime.supportsEpg,
            provider: this.runtime.supportsProviderEpg,
        })
    );
```

In `unified-collection-page.component.html` replace line 24

```html
                [showEpg]="supportsEpg"
```

with

```html
                [showEpg]="skeletonShowsEpg()"
```

```bash
grep -rn "supportsEpg\b" libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-page.component.*
```

Expected: only the spec's stub (`supportsEpg: false`) remains.

- [ ] **Step 4: Run the tests and lint**

```bash
pnpm nx test portal-shared-ui --testPathPatterns="unified-collection"
pnpm nx lint portal-shared-ui
```

Expected: PASS, including `'uses compact loading rows when the runtime has no EPG support'`, where the stub has no guide at all. Lint is clean, with the page at 349 counted lines.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/shared/ui/src/lib/components/unified-collection
git commit -m "fix(collections): size loading rows like the rows that replace them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Dashboard live cards ask portals in the PWA

**Files:**
- Modify: `libs/workspace/dashboard/data-access/src/lib/dashboard-portal-live-epg.service.ts:80-100`
- Test: `libs/workspace/dashboard/data-access/src/lib/dashboard-portal-live-epg.service.spec.ts:51,85,121-128,312-325`

- [ ] **Step 1: Write the failing test**

Rename the stub flag, then add the PWA case:

```bash
perl -pi -e 's/\bsupportsEpgProgramLookup\b/supportsProviderEpg/g' libs/workspace/dashboard/data-access/src/lib/dashboard-portal-live-epg.service.spec.ts
```

In the same spec replace the last test's first lines

```ts
    it('does nothing at all without the local EPG program-lookup capability', async () => {
        // PWA: the collection resolver is gated on the desktop XMLTV bridge
        // and answers nothing, so no request is worth queuing.
        supportsProviderEpg = false;
```

with

```ts
    it('does nothing at all without a portal transport', async () => {
        // Without the portal transport the collection resolver answers
        // nothing, so no request is worth queuing.
        supportsProviderEpg = false;
```

and insert before it:

```ts
    it('answers portal cards from the provider transport alone, as in the browser PWA', async () => {
        // The runtime stub carries no XMLTV flag: a portal card needs only
        // the portal transport, which the PWA has through the backend proxy.
        expect(service.answersPortals).toBe(true);

        service.sync([entry(1)]);
        await settle('xtream::p::1', program('Provider guide'));

        expect(loadEpgForItems).toHaveBeenCalledTimes(1);
        expect(service.programs().get('xtream::p::1')?.title).toBe(
            'Provider guide'
        );
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test workspace-dashboard-data-access --testPathPatterns=dashboard-portal-live-epg.service`
Expected: FAIL. The service still reads `supportsEpgProgramLookup`, which the stub no longer defines, so `sync()` returns early: `answersPortals` is `undefined` and the `settle(...)` calls throw `no request in flight for xtream::p::1`. Only the no-transport test passes.

- [ ] **Step 3: Switch the service**

In `dashboard-portal-live-epg.service.ts` replace

```ts
    /**
     * False where portals are never asked (no local XMLTV bridge), so no
     * card there ever gets an answer to wait for.
     */
    get answersPortals(): boolean {
        return this.runtime.supportsEpgProgramLookup;
    }
```

with

```ts
    /**
     * False where portals are never asked (no portal transport), so no card
     * there ever gets an answer to wait for.
     */
    get answersPortals(): boolean {
        return this.runtime.supportsProviderEpg;
    }
```

and in `sync()` replace

```ts
        // The collection resolver this queue asks through is gated on the
        // local XMLTV bridge (`supportsProgramLookup`, desktop only) and
        // answers nothing without it, so the PWA never queues at all rather
        // than filing an empty answer for every card.
        if (!this.runtime.supportsEpgProgramLookup) {
            return;
        }
```

with

```ts
        // The collection resolver answers portal cards only where the portal
        // transport exists (Electron IPC or the PWA's backend proxy); without
        // it nothing is queued rather than filing an empty answer per card.
        if (!this.runtime.supportsProviderEpg) {
            return;
        }
```

- [ ] **Step 4: Run the dashboard tests and lint**

```bash
pnpm nx test workspace-dashboard-data-access
pnpm nx test workspace-dashboard-feature --testPathPatterns=dashboard-portal-live-epg.presenter
pnpm nx lint workspace-dashboard-data-access
```

Expected: PASS (the presenter spec stubs `answersPortals` directly and stays unchanged); lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/workspace/dashboard/data-access/src/lib
git commit -m "feat(dashboard): ask portals for live card EPG in the PWA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Settings → EPG display settings in the PWA

**Files:**
- Modify: `apps/web/src/app/settings/settings-form.utils.ts:59-62,125-136`
- Modify: `apps/web/src/app/settings/settings-form.facade.ts:56-60`
- Modify: `apps/web/src/app/settings/settings-epg-section.component.ts:60`
- Modify: `apps/web/src/app/settings/settings-epg-section.component.html:105-107,331-332`
- Modify: `apps/web/src/app/settings/settings.component.ts:236-240`
- Modify: `apps/web/src/app/settings/settings.component.html:78`
- Modify: `apps/web/src/app/settings/settings-options.ts:162-178`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search.types.ts:6-19`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search-sections.ts:40`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search-entries.ts:94,102`
- Modify: `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.ts:53-57`
- Modify: `libs/shared/interfaces/src/lib/settings.interface.ts:276-281` (comment only)
- Test: `apps/web/src/app/settings/settings-form.utils.spec.ts` (new `describe` at the end)
- Test: `apps/web/src/app/settings/settings-epg-section.component.spec.ts` (two tests at the end of the `describe`)
- Test: `apps/web/src/app/settings/settings.component.spec.ts` (in `describe('Runtime capabilities')`, after `'hides external player path settings when the Electron bridge is incomplete'`)
- Test: `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.spec.ts:26-58,114`

Today every EPG setting hides behind `supportsImport && supportsDataManagement` (`settings-form.facade.ts:56-57`), which is false in the PWA.

After this task, two flags apply:
- **XMLTV flag (`supportsEpg`):** keeps its meaning and gates the XMLTV part: the source list, Refresh/Refresh all, Clear EPG data, the file picker and `preferUploadedEpgOverXtream`.
- **Display flag (`supportsEpgDisplay` = XMLTV sources `|| runtime.supportsEpg || runtime.supportsProviderEpg`):** gates the section itself, plus `epgViewMode` and `epgOffsetMinutes`. Both settings shape every guide on screen, a portal's own included. The flag includes the XMLTV-sources term, so the section can never hide rows the XMLTV flag shows.

Every place that hides the section follows the display flag:
- the form controls (`settings-form.utils.ts`)
- the nav (`settings-options.ts`, through `settings.component.ts`)
- the section's template, whose XMLTV block moves behind a new input
- the settings search section and the two display rows (`settings-search-*`)

`settings-change-tracking.ts` already maps `epgViewMode` and `epgOffsetMinutes` to `epg` (lines 37-38) and needs no change. The search registry spec (`settings-search-registry.spec.ts`) keeps passing, because every row stays in `settings-epg-section.component.html` with its entry. The form's `epgUrl` getter keeps returning `null` where XMLTV is absent, and the section only reads it inside the XMLTV block.

- [ ] **Step 1: Write the failing form tests**

Append to `apps/web/src/app/settings/settings-form.utils.spec.ts`:

```ts
describe('settings form utils — EPG display without XMLTV sources', () => {
    const formBuilder = new FormBuilder();

    it('builds only the display controls where a portal guide is the only guide (browser PWA)', () => {
        const form = createSettingsForm(formBuilder, false, true);

        expect(form.get('epgViewMode')?.value).toBe('timeline');
        expect(form.get('epgOffsetMinutes')?.value).toBe(0);
        expect(form.get('epgUrl')).toBeNull();
        expect(form.get('preferUploadedEpgOverXtream')).toBeNull();
    });

    it('saves the display settings and keeps the stored XMLTV ones', () => {
        const form = createSettingsForm(formBuilder, false, true);
        form.patchValue({ epgViewMode: 'list', epgOffsetMinutes: 60 });

        const settings = createSettingsFromFormValue(form, {
            epgUrl: ['https://example.org/guide.xml'],
            preferUploadedEpgOverXtream: true,
        } as Settings);

        expect(settings.epgViewMode).toBe('list');
        expect(settings.epgOffsetMinutes).toBe(60);
        expect(settings.epgUrl).toEqual(['https://example.org/guide.xml']);
        expect(settings.preferUploadedEpgOverXtream).toBe(true);
    });

    it('keeps every EPG control where XMLTV sources exist (desktop)', () => {
        const form = createSettingsForm(formBuilder, true);

        expect(form.get('epgUrl')).not.toBeNull();
        expect(form.get('preferUploadedEpgOverXtream')).not.toBeNull();
        expect(form.get('epgViewMode')).not.toBeNull();
        expect(form.get('epgOffsetMinutes')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Write the failing section tests**

Append inside the `describe` of `apps/web/src/app/settings/settings-epg-section.component.spec.ts`, after `'offers Add in the empty state and in the header once a source exists'`:

```ts
    it('renders only the display settings without XMLTV sources (browser PWA)', () => {
        const form = new FormGroup({
            epgViewMode: new FormControl('timeline'),
            epgOffsetMinutes: new FormControl<number>(0),
        });
        fixture.componentRef.setInput('form', form);
        // The settings form has no `epgUrl` array without XMLTV sources.
        fixture.componentRef.setInput('epgUrl', null);
        fixture.componentRef.setInput('showsXmltvSources', false);
        fixture.componentRef.setInput(
            'epgViewModeOptions',
            SETTINGS_EPG_VIEW_MODE_OPTIONS
        );
        fixture.detectChanges();

        expect(query('[data-test-id="select-epg-view-mode"]')).not.toBeNull();
        expect(query('[data-test-id="epg-offset-minutes"]')).not.toBeNull();
        expect(query('[data-setting-id="epg-sources"]')).toBeNull();
        expect(query('[data-setting-id="prefer-uploaded-epg"]')).toBeNull();
        expect(query('[data-setting-id="epg-clear-data"]')).toBeNull();
    });

    it('keeps the XMLTV sources, preference and clear action by default (desktop)', () => {
        configure(createForm());

        expect(query('[data-setting-id="epg-view-mode"]')).not.toBeNull();
        expect(query('[data-setting-id="epg-offset"]')).not.toBeNull();
        expect(query('[data-setting-id="epg-sources"]')).not.toBeNull();
        expect(query('[data-setting-id="prefer-uploaded-epg"]')).not.toBeNull();
        expect(query('[data-setting-id="epg-clear-data"]')).not.toBeNull();
    });
```

- [ ] **Step 3: Write the failing page test**

In `apps/web/src/app/settings/settings.component.spec.ts`, inside `describe('Runtime capabilities', …)`, after the test `'hides external player path settings when the Electron bridge is incomplete'`, add:

```ts
        it('shows the EPG page with only its display settings in the browser PWA', () => {
            fixture.destroy();
            epgBridge.supportsImport = false;
            epgBridge.supportsDataManagement = false;
            window.electron = undefined as unknown as typeof window.electron;

            const pwaFixture = TestBed.createComponent(SettingsComponent);
            const pwaComponent = pwaFixture.componentInstance;
            stubSettingsSideEffects(pwaComponent);
            pwaFixture.detectChanges();

            expect(pwaComponent.supportsEpg).toBe(false);
            expect(pwaComponent.form.supportsEpgDisplay).toBe(true);
            expect(
                pwaComponent.sectionNav.map((section) => section.id)
            ).toContain('epg');
            expect(
                pwaComponent.settingsForm.get('epgOffsetMinutes')
            ).not.toBeNull();
            expect(pwaComponent.settingsForm.get('epgViewMode')).not.toBeNull();
            expect(pwaComponent.settingsForm.get('epgUrl')).toBeNull();
            expect(
                pwaComponent.settingsForm.get('preferUploadedEpgOverXtream')
            ).toBeNull();
        });
```

The spec's `afterEach` restores `window.electron`, and `beforeEach` recreates `epgBridge`. The real `RuntimeCapabilitiesService` reports the PWA, so `supportsProviderEpg` is true there.

- [ ] **Step 4: Write the failing search test**

In `libs/workspace/shell/util/src/lib/settings-search/settings-search.service.spec.ts`:

1. Add two fields to `interface RuntimeStub` (after `supportsEpgDataManagement: boolean;`):

```ts
    supportsEpg: boolean;
    supportsProviderEpg: boolean;
```

2. In `setup`, add the defaults after `supportsEpgDataManagement: false,`:

```ts
                    supportsEpg: false,
                    supportsProviderEpg: false,
```

3. After the test `'hides sections and rows the runtime cannot render'` add:

```ts
    it('offers only the EPG display rows where a portal guide exists without XMLTV', () => {
        const { service } = setup({ supportsProviderEpg: true });

        const sections = service.visibleSections().map(({ id }) => id);
        const entries = service.visibleEntries().map(({ id }) => id);

        expect(sections).toContain('epg');
        expect(entries).toEqual(
            expect.arrayContaining(['epg-view-mode', 'epg-offset'])
        );
        expect(entries).not.toContain('epg-sources');
        expect(entries).not.toContain('prefer-uploaded-epg');
        expect(entries).not.toContain('epg-clear-data');
    });
```

- [ ] **Step 5: Run them to verify they fail**

```bash
pnpm nx test web --testPathPatterns="settings-form.utils|settings-epg-section|settings.component.spec"
pnpm nx test workspace-shell-util --testPathPatterns=settings-search.service
```

Expected failures:
- The display-only form tests fail: `createSettingsForm` ignores its third argument, so `epgViewMode` is `undefined`.
- The PWA section test fails on `setInput('showsXmltvSources', …)` (NG0303: no such input).
- The page test fails: `supportsEpgDisplay` is `undefined`, and the nav has no `epg`.
- The search test fails: `sections` lacks `epg`.
- The desktop tests stay green.

- [ ] **Step 6: Split the form controls**

In `settings-form.utils.ts` replace the signature (lines 59-62)

```ts
export function createSettingsForm(
    formBuilder: FormBuilder,
    supportsEpg: boolean
) {
```

with

```ts
export function createSettingsForm(
    formBuilder: FormBuilder,
    supportsEpg: boolean,
    supportsEpgDisplay = supportsEpg
) {
```

and replace the EPG spread (lines 125-136)

```ts
        ...(supportsEpg
            ? {
                  preferUploadedEpgOverXtream: false,
                  epgViewMode: 'timeline' as EpgViewMode,
                  epgOffsetMinutes: new FormControl<number>(0, [
                      Validators.required,
                      Validators.min(-720),
                      Validators.max(720),
                      Validators.pattern(/^-?\d+$/),
                  ]),
              }
            : {}),
```

with

```ts
        ...(supportsEpg ? { preferUploadedEpgOverXtream: false } : {}),
        // View mode and offset shape every guide, a portal's own included.
        ...(supportsEpgDisplay
            ? {
                  epgViewMode: 'timeline' as EpgViewMode,
                  epgOffsetMinutes: new FormControl<number>(0, [
                      Validators.required,
                      Validators.min(-720),
                      Validators.max(720),
                      Validators.pattern(/^-?\d+$/),
                  ]),
              }
            : {}),
```

`createSettingsFromFormValue` needs no change. It already falls back to the stored `epgUrl` and `preferUploadedEpgOverXtream` when the form lacks them (lines 172-174, 220-223).

In `settings-form.facade.ts` replace (lines 56-60)

```ts
    readonly supportsEpg =
        this.epgBridge.supportsImport && this.epgBridge.supportsDataManagement;

    /** Settings form object */
    readonly form = createSettingsForm(this.formBuilder, this.supportsEpg);
```

with

```ts
    /** XMLTV sources: the source list, its actions and the Xtream preference. */
    readonly supportsEpg =
        this.epgBridge.supportsImport && this.epgBridge.supportsDataManagement;

    /**
     * The EPG page's display settings (view mode, offset). They shape every
     * guide on screen, so they show wherever one exists: XMLTV, or a
     * portal's own guide (the browser PWA).
     */
    readonly supportsEpgDisplay =
        this.supportsEpg ||
        this.runtime.supportsEpg ||
        this.runtime.supportsProviderEpg;

    /** Settings form object */
    readonly form = createSettingsForm(
        this.formBuilder,
        this.supportsEpg,
        this.supportsEpgDisplay
    );
```

- [ ] **Step 7: Put the section's XMLTV block behind an input**

In `settings-epg-section.component.ts`, after `readonly epgViewModeOptions = input.required<EpgViewModeOption[]>();` (line 60) add:

```ts
    /**
     * The XMLTV part: source list, its refresh and clear actions, and the
     * Xtream XMLTV preference. Off where only a portal guide exists (the
     * browser PWA); the guide display settings above it always render.
     */
    readonly showsXmltvSources = input(true);
```

In `settings-epg-section.component.html` open the block before the sources section (lines 105-107):

```html
    </section>

    <section class="settings-section">
        <div class="settings-section__header">
            <h3>{{ 'SETTINGS.CARD_SOURCES' | translate }}</h3>
```

becomes

```html
    </section>

    @if (showsXmltvSources()) {
    <section class="settings-section">
        <div class="settings-section__header">
            <h3>{{ 'SETTINGS.CARD_SOURCES' | translate }}</h3>
```

and close it before the outer section ends (lines 328-332):

```html
                </div>
            </div>
        </div>
    </section>
</section>
```

becomes

```html
                </div>
            </div>
        </div>
    </section>
    }
</section>
```

Then re-indent the wrapped block and check the result:

```bash
pnpm exec prettier --write apps/web/src/app/settings/settings-epg-section.component.html
git diff --stat -- apps/web/src/app/settings/settings-epg-section.component.html
grep -n "showsXmltvSources\|data-setting-id" apps/web/src/app/settings/settings-epg-section.component.html
```

Expected: the diff touches only this template, mostly as indentation. The grep shows `epg-view-mode` and `epg-offset` before `@if (showsXmltvSources())`, and `epg-sources`, `prefer-uploaded-epg` and `epg-clear-data` inside it. Prettier on this app template is fine; the "no whole-file Prettier" rule covers only AGENTS.md, CLAUDE.md and `docs/**`.

In `settings.component.html` (line 78) bind it after `[canBrowseFiles]="epg.supportsFilePicker"`:

```html
                            [canBrowseFiles]="epg.supportsFilePicker"
                            [showsXmltvSources]="supportsEpg"
```

- [ ] **Step 8: Show the section on the display flag**

In `settings.component.ts` replace (lines 236-240)

```ts
    readonly sectionNavItems: SettingsSection[] = buildSettingsSectionNavItems({
        supportsEpg: this.supportsEpg,
        supportsRemoteControl: this.supportsRemoteControl,
        supportsServerStorage: this.supportsServerStorage,
    });
```

with

```ts
    readonly sectionNavItems: SettingsSection[] = buildSettingsSectionNavItems({
        supportsEpg: this.form.supportsEpgDisplay,
        supportsRemoteControl: this.supportsRemoteControl,
        supportsServerStorage: this.supportsServerStorage,
    });
```

`readonly supportsEpg = this.form.supportsEpg;` (line 165) keeps meaning "XMLTV sources", and the new template binding uses it. The redirect effect (`isNavigableSection`) follows the nav, so `/workspace/settings/epg` stays reachable in the PWA.

In `settings-options.ts` replace (lines 162-178)

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

with

```ts
export interface SettingsSectionVisibility {
    /** The EPG page renders: its display settings at least. */
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
        'epg-display': supportsEpg,
        'remote-control': supportsRemoteControl,
        'server-storage': supportsServerStorage,
    };
```

- [ ] **Step 9: Index only the display rows without XMLTV**

In `settings-search.types.ts` replace

```ts
    | 'desktop'
    | 'epg'
    | 'remote-control'
```

with

```ts
    | 'desktop'
    /** XMLTV sources: import and data management (desktop today). */
    | 'epg'
    /** Any guide, XMLTV or a portal's own: the EPG page's display rows. */
    | 'epg-display'
    | 'remote-control'
```

In `settings-search-sections.ts` replace the EPG section's requirement (line 40)

```ts
            icon: 'calendar_month',
            requires: ['epg'],
```

with

```ts
            icon: 'calendar_month',
            requires: ['epg-display'],
```

In `settings-search-entries.ts`, change the requirement of the two display rows only: `epg-view-mode` (line 94) and `epg-offset` (line 102).

```ts
        keywords: ['epg', 'tv guide', 'timeline', 'grid', 'programme'],
        requires: ['epg'],
```

becomes

```ts
        keywords: ['epg', 'tv guide', 'timeline', 'grid', 'programme'],
        requires: ['epg-display'],
```

and

```ts
        keywords: ['epg', 'timezone', 'time shift', 'offset', 'hours'],
        requires: ['epg'],
```

becomes

```ts
        keywords: ['epg', 'timezone', 'time shift', 'offset', 'hours'],
        requires: ['epg-display'],
```

`epg-sources`, `prefer-uploaded-epg` and `epg-clear-data` keep `requires: ['epg']`.

In `settings-search.service.ts` replace (lines 53-57)

```ts
    capabilities(): SettingsSearchCapabilities {
        const runtime = this.runtime;
        return {
            desktop: runtime.isElectron,
            epg: runtime.supportsEpgImport && runtime.supportsEpgDataManagement,
```

with

```ts
    capabilities(): SettingsSearchCapabilities {
        const runtime = this.runtime;
        const epgSources =
            runtime.supportsEpgImport && runtime.supportsEpgDataManagement;
        return {
            desktop: runtime.isElectron,
            epg: epgSources,
            // Same rule as SettingsFormFacade.supportsEpgDisplay.
            'epg-display':
                epgSources || runtime.supportsEpg || runtime.supportsProviderEpg,
```

`SettingsSearchCapabilities` is `Record<SettingsSearchRequirement, boolean>`, so the compiler rejects any capabilities object without the new key. `capabilities()` is the only one in production code: `grep -rn "SettingsSearchCapabilities" libs apps --include='*.ts'` lists only the types file and the service.

- [ ] **Step 10: Fix the stale interface comment**

In `libs/shared/interfaces/src/lib/settings.interface.ts` replace (lines 279-280)

```ts
     * documented in `epg-display-offset.util.ts`. Electron only in practice
     * (the control is gated behind `supportsEpg`, like `epgViewMode`).
```

with

```ts
     * documented in `epg-display-offset.util.ts`. Shown wherever a guide
     * exists, XMLTV or a portal's own (`SettingsFormFacade.supportsEpgDisplay`),
     * like `epgViewMode`.
```

- [ ] **Step 11: Run the tests and lint**

```bash
pnpm nx test web --testPathPatterns=settings
pnpm nx test workspace-shell-util
pnpm nx test workspace-shell-feature --testPathPatterns="command-palette|workspace-shell.facade"
pnpm nx lint web
pnpm nx lint workspace-shell-util
```

Expected: PASS. That includes `settings-options.spec.ts`, whose desktop cases pass `supportsEpg: true` and now reach `'epg-display'`, and `settings-search-registry.spec.ts`. The desktop count test (`SETTINGS_SEARCH_ENTRIES.length - 8`) is unchanged, because the desktop stub has XMLTV sources. Lint is clean, with `settings.component.ts` still at 386 counted lines.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/app/settings libs/workspace/shell/util/src/lib/settings-search libs/shared/interfaces/src/lib/settings.interface.ts
git commit -m "feat(pwa): EPG view mode and time offset in the browser settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Host guard regression tests for provider EPG

**Files:**
- Test: `apps/web-backend/src/app/web-backend-app.host-guard.spec.ts` (append after `'keeps talking to a host that answers, whatever the status says'`, line 377)

No production change: see "Host guard analysis". These tests pin that EPG actions stay unspecial, so a future action-based exemption or a breaker change that counted slow bulk guides fails here.

- [ ] **Step 1: Write the regression tests**

Add after the test `'keeps talking to a host that answers, whatever the status says'`:

```ts
    it('keeps playback going out after slow provider EPG requests on a live portal', async () => {
        // A busy portal can take longer than the 15 s Stalker budget to build
        // a week-long `get_epg_info`. It accepted both connections, so the
        // timeouts say nothing about reachability: create_link still goes out.
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure('ECONNABORTED'), {
            connected: true,
        });
        httpClient.queueNetworkError(hostLevelFailure('ECONNABORTED'), {
            connected: true,
        });
        httpClient.queueResponse({
            js: { cmd: 'http://cdn.example/live.m3u8' },
        });
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/portal.php'
                );
                const call = (query: string) =>
                    fetch(
                        `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&type=itv&${query}`
                    );

                await call('action=get_epg_info&period=168');
                await call('action=get_epg_info&period=168');
                const playback = await call(
                    'action=create_link&cmd=ffrt4%3A%2F%2Fitv%2F1'
                );

                expect(httpClient.requests).toHaveLength(3);
                expect(await playback.json()).toEqual({
                    action: 'create_link',
                    payload: { js: { cmd: 'http://cdn.example/live.m3u8' } },
                });
            }
        );
    });

    it('keeps catalog requests going out after provider EPG answers with error statuses', async () => {
        // Panels without the EPG actions answer 404 or 500. Any HTTP answer
        // proves the host alive, so failing row previews never open the
        // breaker for the catalog or playback of the same host.
        const httpClient = new StubHttpClient();
        httpClient.queueFailure(404, 'Not Found');
        httpClient.queueFailure(500, 'Internal Server Error');
        httpClient.queueFailure(404, 'Not Found');
        httpClient.queueResponse([{ stream_id: 1, name: 'News' }]);
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = (query: string) =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&password=secret&${query}`
                    );

                await call('action=get_short_epg&stream_id=1&limit=3');
                await call('action=get_simple_data_table&stream_id=1');
                await call('action=get_short_epg&stream_id=2&limit=3');
                const catalog = await call('action=get_live_streams');

                expect(httpClient.requests).toHaveLength(4);
                expect(await catalog.json()).toEqual({
                    action: 'get_live_streams',
                    payload: [{ stream_id: 1, name: 'News' }],
                });
            }
        );
    });
```

- [ ] **Step 2: Run them**

Run: `pnpm nx test web-backend --testPathPatterns=host-guard`
Expected: PASS on the first run. Behaviour is already correct, and these are guard rails. As a sanity check that they bite, temporarily change `connected: true` to `connected: false` in the first test: the third request is then refused (`requests` has length 2). Revert the change before committing.

- [ ] **Step 3: Lint**

Run: `pnpm nx lint web-backend`
Expected: clean (the spec stays below 1200 counted lines).

- [ ] **Step 4: Commit**

```bash
git add apps/web-backend/src/app/web-backend-app.host-guard.spec.ts
git commit -m "test(web-backend): provider EPG failures never fast-fail playback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: PWA E2E for provider EPG and the EPG settings page

**Files:**
- Create: `apps/web-e2e/src/xtream-provider-epg.e2e.ts`
- Modify: `apps/web-e2e/src/stalker.e2e.ts:245-283,427-463`
- Modify: `apps/web-e2e/src/stalker-open-in-playlist.fixture.ts:7-10`
- Modify: `apps/web-e2e/src/settings.e2e.ts` (after `'@settings @web Deep links open one section page and unknown sections redirect'`, which starts at line 139)

- [ ] **Step 1: Write the Xtream spec**

Create `apps/web-e2e/src/xtream-provider-epg.e2e.ts`:

```ts
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

/**
 * Provider EPG in the browser PWA (#1683). Xtream `get_short_epg` (row
 * previews) and `get_simple_data_table` (player panel) reach the portal
 * through the backend `/xtream` proxy. The mock's `epg:epg` scenario pins
 * the guide: "Timezone News" in "EPG Focus" airs "Global Headlines" now.
 */
const EPG_PORTAL = { name: 'EPG Portal', username: 'epg', password: 'epg' };

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
});

test('@xtream @epg PWA shows the provider guide in the channel list and beside the player', async ({
    page,
}) => {
    const proxiedActions: string[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        const action = url.searchParams.get('action');
        if (url.pathname.endsWith('/xtream') && action) {
            proxiedActions.push(action);
        }
    });

    await addXtreamPortal(page, EPG_PORTAL);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('.context-panel .category-item')
        .filter({ hasText: 'EPG Focus' })
        .click();

    const channel = page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .filter({ hasText: 'Timezone News' });
    await expect(channel.locator('.epg-title')).toHaveText(
        'Global Headlines',
        { timeout: 20_000 }
    );
    expect(proxiedActions).toContain('get_short_epg');

    await channel.click();
    await expect(page.locator('app-web-player-view')).toBeVisible({
        timeout: 20_000,
    });
    await expect(
        page
            .locator(
                'app-live-stream-layout app-epg-timeline .epg-timeline__block'
            )
            .filter({ hasText: 'Global Headlines' })
            .first()
    ).toBeVisible({ timeout: 20_000 });
    expect(proxiedActions).toContain('get_simple_data_table');
});
```

- [ ] **Step 2: Flip the two Stalker PWA tests**

In `apps/web-e2e/src/stalker.e2e.ts` replace the whole test `'@stalker PWA hides EPG for ITV channel'` (lines 245-283) with:

```ts
test('@stalker @epg PWA shows provider EPG for ITV channels', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const epgInfoRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('action=get_epg_info')) {
            epgInfoRequests.push(request.url());
        }
    });

    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    // ITV view requires an explicit category selection before channels render
    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    // The bulk guide comes through the backend proxy and fills the row line;
    // the mock titles every programme "<channel name>: …".
    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    const channelName = (
        await channels.first().locator('.channel-name').innerText()
    ).trim();
    await expect(channels.first().locator('.epg-title')).toContainText(
        `${channelName}:`,
        { timeout: 20_000 }
    );
    expect(epgInfoRequests.length).toBeGreaterThan(0);

    await channels.first().click();
    await expect(channels.first()).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-web-player-view')).toBeVisible({
        timeout: 20_000,
    });
    await expect(
        page.locator('app-epg-timeline .epg-timeline__block.is-now')
    ).toContainText(`${channelName}:`, { timeout: 20_000 });
});
```

and replace the whole test `'@stalker PWA skips bulk EPG across channel switches'` (lines 427-463) with:

```ts
test('@stalker @epg PWA reuses the bulk guide across channel switches', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const epgInfoRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('action=get_epg_info')) {
            epgInfoRequests.push(request.url());
        }
    });

    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.nth(1)).toBeVisible({ timeout: 20_000 });

    await channels.first().click();
    await expect(channels.first()).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-epg-timeline')).toBeVisible({
        timeout: 20_000,
    });

    await channels.nth(1).click();
    await expect(channels.nth(1)).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-epg-timeline')).toBeVisible({
        timeout: 20_000,
    });

    // Fetched once per playlist session, never per channel switch.
    expect(epgInfoRequests).toHaveLength(1);
});
```

The radio test (`'@stalker radio — stations use the inline audio player without EPG'`) stays as it is and must keep `epgRequests` at 0: radio mode skips EPG regardless of the runtime.

- [ ] **Step 3: Fix the stale fixture comment**

In `apps/web-e2e/src/stalker-open-in-playlist.fixture.ts` replace

```ts
 * Runs against the PWA, where the collection tab renders no EPG panel and
 * therefore no toolbar chip, so the row context menu is the entry point. The
 * mock portal answers `get_all_channels`, so the layout locates the channel
 * through the full ITV list and lands in its genre.
```

with

```ts
 * The row context menu is the entry point: it works without selecting the
 * row, unlike the EPG panel's "Open in" chip. The mock portal answers
 * `get_all_channels`, so the layout locates the channel through the full ITV
 * list and lands in its genre.
```

- [ ] **Step 4: Assert the PWA EPG settings page**

`apps/web-e2e/src/settings.e2e.ts` is the existing PWA settings spec. Inside `test.describe('Settings', …)`, after the test `'@settings @web Deep links open one section page and unknown sections redirect'`, add:

```ts
    test('@settings @web @epg PWA EPG page offers the display settings without XMLTV sources', async ({
        page,
    }) => {
        await openSettings(page);
        await openSettingsSection(page, 'epg');

        const offset = page.locator('[data-test-id="epg-offset-minutes"]');
        await expect(offset).toBeVisible();
        await expect(
            page.locator('[data-test-id="select-epg-view-mode"]')
        ).toBeVisible();
        // XMLTV needs the desktop app (or server EPG later).
        await expect(page.locator('[data-setting-id="epg-sources"]')).toHaveCount(
            0
        );
        await expect(
            page.locator('[data-test-id="toggle-prefer-uploaded-epg"]')
        ).toHaveCount(0);
        await expect(
            page.locator('[data-setting-id="epg-clear-data"]')
        ).toHaveCount(0);

        // Staged and saved like every other setting, per browser.
        await offset.fill('60');
        await saveSettings(page);
        await page.reload();
        await expect(
            page.locator('[data-test-id="epg-offset-minutes"]')
        ).toHaveValue('60', { timeout: 20_000 });
    });
```

`openSettings`, `openSettingsSection` and `saveSettings` are the spec's own helpers (lines 6-34).

- [ ] **Step 5: Run the EPG E2E, both portal spec files and the settings spec**

```bash
pnpm nx run web-e2e:e2e -- --project=chromium --grep "@epg"
pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts -- --project=chromium
pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts -- --project=chromium
pnpm nx run web-e2e:e2e-ci--src/xtream-live-format.e2e.ts -- --project=chromium
pnpm nx run web-e2e:e2e-ci--src/settings.e2e.ts -- --project=chromium
pnpm nx lint web-e2e
```

Expected: the `@epg` run passes 4 tests: Xtream, two Stalker tests and the settings test. All other tests in the Stalker, Xtream and settings files pass as well; the portal tests now issue EPG requests that the mocks answer. Lint is clean. A failure in an unrelated Stalker or Xtream test means it assumed the PWA has no EPG panel: fix it in this task, never by skipping it.

- [ ] **Step 6: Commit**

```bash
git add apps/web-e2e/src/xtream-provider-epg.e2e.ts apps/web-e2e/src/stalker.e2e.ts apps/web-e2e/src/stalker-open-in-playlist.fixture.ts apps/web-e2e/src/settings.e2e.ts
git commit -m "test(e2e): provider EPG and EPG display settings in the PWA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Documentation

**Files:**
- Modify: `docs/architecture/stalker-epg.md:292-302,360-361`
- Modify: `docs/architecture/xtream-portal-compatibility.md:214-216`
- Modify: `docs/architecture/pwa-self-hosted.md:168,412-414,597-598`
- Modify: `docs/architecture/workspace-dashboard.md:420-425`
- Modify: `docs/architecture/host-connectivity-guard.md:71,415-416`
- Modify: `docs/architecture/m3u-playlist-module.md:733-736,790-791`
- Modify: `docker/README.md:20`

Edit only these lines; never run whole-file `prettier --write` on `docs/**`.

- [ ] **Step 1: `stalker-epg.md` — transport and runtime gate**

Replace

```markdown
| Simple Stalker portal | generic IPC request path via Electron              |

No EPG-specific backend transport was needed; the Electron Stalker request
handler forwards portal params directly.
```

with

```markdown
| Simple Stalker portal | `DataService.sendIpcEvent(STALKER_REQUEST)`        |

No EPG-specific transport exists. `STALKER_REQUEST` goes through the Electron
Stalker request handler on the desktop and through `PwaService` and the web
backend's `/stalker` proxy in the browser PWA. EPG actions are not treated
differently from catalog requests, including by the per-host
[connectivity guard](./host-connectivity-guard.md).

## Runtime gating

Portal EPG needs only the Stalker transport, so it is gated on
`RuntimeCapabilitiesService.supportsProviderEpg`: true in the browser PWA and
in Electron when the `xtreamRequest` and `stalkerRequest` preload methods
exist. The gate covers `fetchChannelEpg`, `ensureBulkItvEpg`, the layout's
eager bulk load, row previews, the EPG panel and its empty state
(`provider-no-epg` means "no transport"), and the collection resolver's
`loadStalkerEpgItems` / `loadStalkerEpgBatch`. Manual mapping overlays read
uploaded XMLTV and stay behind `supportsEpgMapping` and `supportsEpg`, so the
PWA shows the portal EPG without mapping.
```

and replace

```markdown
- Everything is gated behind `supportsEpgMapping`, so the PWA never shows
  the menu entry.
```

with

```markdown
- Everything is gated behind `supportsEpgMapping` (the store overlay also
  behind `supportsEpg`), so the PWA never shows the menu entry.
```

- [ ] **Step 2: `xtream-portal-compatibility.md` — provider EPG section**

Replace

```markdown
and private-network checks.

## User-Agent
```

with

```markdown
and private-network checks.

## Provider EPG

Xtream EPG comes from the portal itself. `get_short_epg` feeds the
channel-row previews (`EpgQueueService`: three items, two requests in flight)
and the collection previews (`StreamResolverService`). `get_simple_data_table`,
falling back to the legacy `get_simple_date_table`, feeds the live EPG panel
(`withEpg().loadEpg()`) and the collection detail panel. All of them use the
ordinary `XTREAM_REQUEST` transport, so they are gated on
`RuntimeCapabilitiesService.supportsProviderEpg`. It is true in the browser
PWA, where `PwaService` forwards to the backend `/xtream` proxy, and in
Electron when the `xtreamRequest` and `stalkerRequest` preload methods exist.
Both runtimes send the EPG actions as silent background requests (no error
snackbar) through the same per-host connectivity guard as the catalog. Only
connection-level failures count, so a panel that answers EPG requests slowly
or with an error status cannot fast-fail playback.

The local XMLTV parts keep the XMLTV capabilities and stay off in the PWA:
the `epg_channel_id` fallback and `preferUploadedEpgOverXtream`
(`XtreamXmltvFallbackService`), and manual EPG mapping (`supportsEpgMapping`).
With the provider guide on screen, the PWA also offers catch-up from the EPG
panel for channels with `tv_archive`, using the REST MPEG-TS URL described
under Catch-Up Playback URLs.

## User-Agent
```

- [ ] **Step 3: `pwa-self-hosted.md` — capabilities, limitations, smoke test**

Replace line 168

```markdown
search. `supportsPlaylistRefresh` requires the native playlist
```

with

```markdown
search; all of them describe XMLTV. `supportsProviderEpg` is separate: Xtream
and Stalker provider EPG needs only the portal transport, so it is true in the
PWA (`PwaService` forwards `XTREAM_REQUEST` and `STALKER_REQUEST` to the
`/xtream` and `/stalker` proxy routes) and in Electron when both the
`xtreamRequest` and `stalkerRequest` preload methods exist. Gate portal guides
on it and keep the XMLTV parts of portal views (the Xtream XMLTV fallback,
manual EPG mapping) on the XMLTV capabilities. `supportsPlaylistRefresh`
requires the native playlist
```

Replace (lines 412-414)

```markdown
- EPG/XMLTV is not supported in the PWA yet. Do not render live EPG panels,
  programme-guide entry points, or EPG-fetching flows in browser/PWA mode, and
  do not use EPG as the readiness signal for Docker.
```

with

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

Replace (lines 597-598)

```markdown
add sources, play an item, toggle favorites, populate global favorites,
populate recently viewed, and appear on the dashboard rails.
```

with

```markdown
add sources, play an item, toggle favorites, populate global favorites,
populate recently viewed, and appear on the dashboard rails, and that Xtream
and Stalker live channels show their provider's programme guide.
```

- [ ] **Step 4: `workspace-dashboard.md` — the portal card queue**

Replace (lines 420-425)

```markdown
        - Desktop only in practice: the shared collection resolver is gated on
          the local XMLTV bridge (`supportsProgramLookup`) and answers nothing
          without it, so `sync()` returns immediately in the PWA rather than
          filing an empty answer for every card. Lifting that gate for portal
          lookups would change the collection pages too and is deliberately
          out of scope here.
```

with

```markdown
        - Gated on the portal transport (`supportsProviderEpg`), like the
          collection resolver's portal lookups: it works in the PWA through
          the backend proxy, and `sync()` returns immediately only where no
          portal transport exists, rather than filing an empty answer for
          every card. The XMLTV overlays inside the resolver
          (`epg_channel_id`, manual mappings) stay behind
          `supportsProgramLookup`.
```

- [ ] **Step 5: `host-connectivity-guard.md` — EPG requests are portal calls**

After line 71 (`  that path the way portal Retry has one.`) insert a blank line and:

```markdown
Provider EPG actions (`get_short_epg`, `get_simple_data_table`,
`get_epg_info`) are portal calls like any other, in both runtimes. They are
admitted and counted by the same rules, so only a refused connection counts:
a slow bulk guide after an accepted connection is inconclusive, and any
4xx/5xx answer clears the record.
```

and in the Tests list replace

```markdown
  and that playlist/EPG downloads are never fast-failed. The per-route timeouts
```

with

```markdown
  that playlist/EPG downloads are never fast-failed, and that failing provider
  EPG requests (slow bulk guides, error statuses) never fast-fail playback or
  catalog requests. The per-route timeouts
```

- [ ] **Step 6: `docker/README.md` — limitations list**

Replace line 20

```markdown
- EPG/XMLTV panels and multi-EPG views are not available in the self-hosted PWA.
```

with

```markdown
- Xtream and Stalker sources show their provider's programme guide: the
  current show under each live channel and the guide beside the player.
  Settings → EPG offers the guide layout and a time offset. XMLTV guides (M3U
  EPG sources, the programme guide and EPG channel mapping) are not available
  in the self-hosted PWA yet.
```

- [ ] **Step 7: `m3u-playlist-module.md` — the two "Electron-only" display settings**

Replace (lines 733-736)

```markdown
`settings-epg-section`) and needs no backend change. The control is
**Electron-only in practice** — the EPG settings section (and the form control)
is gated behind `supportsEpg`, which is false in PWA; there the stored value
simply stays at the `'timeline'` default.
```

with

```markdown
`settings-epg-section`) and needs no backend change. The control and the
offset below are the EPG page's display rows: they render wherever a guide
exists (`SettingsFormFacade.supportsEpgDisplay`, XMLTV or a portal's own),
including the browser PWA, while the page's XMLTV rows (sources, Xtream
preference, clear data) need the import and data-management bridges.
```

and replace (lines 790-791)

```markdown
the offset they were fetched for. Like the view mode, the control is Electron-only in practice —
it sits behind `supportsEpg`.
```

with

```markdown
the offset they were fetched for. Like the view mode, the control renders
wherever a guide exists, the browser PWA's provider guides included.
```

- [ ] **Step 8: Check links and commit**

```bash
pnpm run agents:validate
git add docs/architecture/stalker-epg.md docs/architecture/xtream-portal-compatibility.md docs/architecture/pwa-self-hosted.md docs/architecture/workspace-dashboard.md docs/architecture/host-connectivity-guard.md docs/architecture/m3u-playlist-module.md docker/README.md
git commit -m "docs(epg): document provider EPG and EPG display settings in the PWA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `agents:validate` passes (guidance links and anchors intact).

---

### Task 15: Release note

**Files:**
- Create: `.changes/pwa-provider-epg.md`

- [ ] **Step 1: Write the note**

Create `.changes/pwa-provider-epg.md`:

```markdown
---
type: feature
area: pwa
issues: [1683]
highlight: Programme guide in the browser
---

The browser and Docker versions now show the programme guide that Xtream and Stalker providers send: the current show under each live channel, the guide beside the player, and what is on in favorites, recently viewed and on the dashboard. Settings → EPG offers the guide layout and a time offset. Guides from XMLTV sources remain a desktop feature for now.
```

- [ ] **Step 2: Validate**

Run: `pnpm run release:notes:validate`
Expected: exit 0, and no error mentions `pwa-provider-epg.md`. The body is 356 characters (cap 400). `highlight` is 30 characters (cap 60) and allowed for `type: feature` (`.changes/README.md`, "Writing the body"); the maintainer asked for it. No `screenshot` is set. Release screenshots are captured from the built desktop app (`.changes/README.md`, "Screenshots"), so an existing slug such as `guide-xtream-live` would show the desktop app, not the browser.

- [ ] **Step 3: Commit**

```bash
git add .changes/pwa-provider-epg.md
git commit -m "docs(pwa): add the provider EPG release note (highlight)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Manual check — Xtream catch-up in the PWA's browser players

**Files:** none. The result goes into the PR body (Task 20).

**Why this is manual.** Before 3a the PWA never showed the Xtream EPG panel, so its catch-up path was unreachable; Task 4 makes it reachable. The PWA builds the archive URL without a probe: `probeCatchupUrl` returns 0 without `window.electron.xtreamProbeUrl` (`libs/portal/xtream/data-access/src/lib/services/xtream-url.service.ts:325-339`), so the variant falls back to REST MPEG-TS `/timeshift/…/.ts` (`:310-321`). The browser player then fetches that URL directly from the provider, not through the backend proxy. Whether that plays depends on a real panel's answer (format, redirects, CORS) and on each browser's player, which the mocks do not model.

**Prerequisites:**
- Tasks 1-15 are committed.
- The maintainer's own Xtream account has at least one live channel with the catch-up badge (history icon; `tv_archive = 1`, `tv_archive_duration > 0`).
- The maintainer types the server URL, user name and password into the browser. They never go into chat, files, commands, screenshots or the PR.
- Chrome (desktop) and Safari (macOS) are installed.

- [ ] **Step 1: Start the backend and the PWA**

In one terminal, from the worktree root:

```bash
PORT=3000 CLIENT_URL=http://localhost:4200 TSX_TSCONFIG_PATH=tsconfig.base.json node --import tsx apps/web-backend/src/main.ts
```

In a second terminal:

```bash
pnpm run serve:frontend
```

The development frontend talks to `http://localhost:3000` (`apps/web/src/environments/environment.ts`, `environment.dev.ts`). The backend line is the one `apps/web-e2e/playwright.config.ts` uses, without the private-network switch, which a public provider does not need.

To check the shipped image instead, run `docker compose -f docker/docker-compose.yml up --build -d` and open <http://localhost:4333>. Use plain HTTP either way: an HTTPS page blocks an HTTP provider's streams as mixed content, live playback included, so that is no catch-up verdict.

- [ ] **Step 2: Reach an archived programme**

Do this in Chrome with DevTools open (Network filtered by `timeshift`, plus Console):
1. Open <http://localhost:4200>.
2. The maintainer adds the Xtream portal.
3. Open Live TV, pick a category and play a channel that shows the history badge. Wait until the EPG panel beside the player shows the day's programmes.

- [ ] **Step 3: Play the archive with every web player in Chrome**

For each player in turn, set Settings → Playback → Video player and Save, then return to the channel:
1. Video.js player (the default)
2. HTML5 video player
3. ArtPlayer

Each time, click a programme block in the EPG panel that ended at least 30 minutes ago and lies inside the archive window. A pass needs all four:
- Within 30 seconds the picture moves and the player clock advances.
- The seek bar shows the programme as a segment.
- The Network tab shows the `/timeshift/` request answered `200` or `206`.
- No playback diagnostic banner appears.

Note the console error text of any failure; leave out URLs, host names and credentials.

- [ ] **Step 4: Play the archive in Safari**

Repeat Steps 2-3 in Safari, with the Video.js player only.

- [ ] **Step 5: Decide and record**

The verdict is "plays" when Chrome + Video.js **and** Safari + Video.js both pass. Otherwise it is "does not play". The other two players are recorded, but they do not decide: users get the default.

Save this record outside the repository, as `${TMPDIR:-/tmp}/iptvnator-3a-catchup.txt`, filled in from Steps 3-4 (Task 20 puts it into the PR body):

```text
Catch-up check (real Xtream provider, run on <date>):
- Chrome <version>: Video.js <pass | fail + error>, HTML5 <pass | fail + error>, ArtPlayer <pass | fail + error>
- Safari <version>: Video.js <pass | fail + error>
- Archive URL: REST MPEG-TS (.ts), HTTP <status>
- Verdict: plays | does not play
```

- **Plays:** skip Task 17. Task 20 uses the "plays" text in the PR body.
- **Does not play:** do Task 17.

Stop both servers (`Ctrl+C`), or run `docker compose -f docker/docker-compose.yml down`.

---

### Task 17: Hide Xtream catch-up in the PWA (only if Task 16 says "does not play")

**Files:**
- Modify: `libs/services/src/lib/runtime-capabilities.service.ts` (after `supportsProviderEpg`, added in Task 2)
- Test: `libs/services/src/lib/runtime-capabilities.service.spec.ts` (after the Task 2 test)
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.ts:321-327`
- Test: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.catchup-timeline.spec.ts:82,111-112,215`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.spec.ts` (runtime stub from Task 4)
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-epg-view.ts:20,81,96-107`
- Test: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.spec.ts` (runtime stub; one test after `'keeps the archive gate closed when the provider has no archive'`)
- Modify: `docs/architecture/xtream-portal-compatibility.md` (the Provider EPG section from Task 14), `docs/architecture/pwa-self-hosted.md` (the Runtime Limitations bullet from Task 14)

If Task 16's verdict is "plays", skip this task. Its line stays "Skipped" in the PR body (Task 20).

The gate sits in the two places that feed every archive action: `archivePlaybackAvailable` (Xtream Live TV) and `timelineArchiveAvailable` (Favorites/Recent).
- Both bind `[archivePlaybackAvailable]` on the timeline and list views.
- `EpgTimelineComponent.canCatchUp` derives "Watch from start", "Copy archive URL" and "Download" from it (`libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.ts:383-399`).
- `archiveDownloadsAvailable` depends on it (`live-stream-layout.component.ts:173-175`).

M3U catch-up (`isM3uCatchupPlaybackSupported`) and the row badges stay unchanged (see Out of scope).

- [ ] **Step 1: Write the failing tests**

In `runtime-capabilities.service.spec.ts`, after the test `'offers provider EPG wherever the portal transport exists, independently of XMLTV'`, add:

```ts
    it('offers provider catch-up playback only in the desktop app', () => {
        const service = new RuntimeCapabilitiesService();

        testWindow.electron = undefined;
        expect(service.supportsProviderCatchUp).toBe(false);

        testWindow.electron = {};
        expect(service.supportsProviderCatchUp).toBe(true);
    });
```

In `live-stream-layout.catchup-timeline.spec.ts`:

1. Replace line 82

```ts
    const runtime = { supportsXtreamSqliteDataSource: false };
```

with

```ts
    const runtime = {
        supportsXtreamSqliteDataSource: false,
        supportsProviderCatchUp: true,
    };
```

2. In `beforeEach`, after `epgItems.set([]);` (line 111) add:

```ts
        runtime.supportsProviderCatchUp = true;
```

3. Before the test `'draws the archive window programmes until live playback resumes'` (line 215) add:

```ts
    it('offers archive playback where provider catch-up can play', () => {
        expect(component.archivePlaybackAvailable()).toBe(true);
    });

    it('offers no archive playback or download where provider catch-up cannot play', () => {
        // The computed reads the flag once; build the layout after the flip.
        runtime.supportsProviderCatchUp = false;
        fixture.destroy();
        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.archivePlaybackAvailable()).toBe(false);
        expect(component.archiveDownloadsAvailable()).toBe(false);
    });
```

`sampleChannel` (the store's selected item here) carries `tv_archive: 1` and `tv_archive_duration: 3` (`live-stream-layout-stubs.spec-data.ts:104-110`).

In `live-stream-layout.component.spec.ts`, keep its archive tests on the desktop path. In the runtime stub, after the Task 4 lines

```ts
                        // The portal transport exists in both runtimes.
                        supportsProviderEpg: true,
```

add

```ts
                        supportsProviderCatchUp: true,
```

In `unified-live-tab.component.spec.ts`, after `supportsProviderEpg: true,` in the runtime stub (Task 8), add `supportsProviderCatchUp: true,`. After the test `'keeps the archive gate closed when the provider has no archive'`, add:

```ts
        it('keeps the archive gate closed where provider catch-up cannot play', async () => {
            Object.assign(TestBed.inject(RuntimeCapabilitiesService), {
                supportsProviderCatchUp: false,
            });
            await selectXtreamArchiveChannel({
                tvArchive: 1,
                tvArchiveDuration: 5,
            });

            const timeline = queryTimeline();
            expect(timeline.archivePlaybackAvailable()).toBe(false);
            expect(timeline.archiveDays()).toBe(0);
        });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm nx test services --testPathPatterns=runtime-capabilities.service
pnpm nx test portal-xtream-feature --testPathPatterns=live-stream-layout.catchup-timeline
pnpm nx test portal-shared-ui --testPathPatterns=unified-live-tab.component
```

Expected failures:
- `supportsProviderCatchUp` is `undefined` (`Expected: false`, `Received: undefined`).
- In the layout, `archivePlaybackAvailable()` is still `true` with the flag off.
- In the live tab, `archivePlaybackAvailable()` is still `true` with the flag off.

The "can play" test and the existing archive tests pass.

- [ ] **Step 3: Add the capability**

In `runtime-capabilities.service.ts`, after the `supportsProviderEpg` getter, add:

```ts
    /**
     * Xtream catch-up (timeshift) from the EPG panel: watch, copy, download.
     * The browser PWA's players did not play the provider's archive URL in
     * the server EPG 3a check, so only the desktop app offers it.
     */
    get supportsProviderCatchUp(): boolean {
        return this.isElectron;
    }
```

- [ ] **Step 4: Gate the two archive sources**

In `live-stream-layout.component.ts` replace (lines 321-327)

```ts
    readonly archivePlaybackAvailable = computed(() => {
        const selectedItem = this.selectedLiveItem();
        return (
            Number(selectedItem?.tv_archive ?? 0) === 1 &&
            this.controlledArchiveDays() > 0
        );
    });
```

with

```ts
    readonly archivePlaybackAvailable = computed(() => {
        const selectedItem = this.selectedLiveItem();
        return (
            this.runtime.supportsProviderCatchUp &&
            Number(selectedItem?.tv_archive ?? 0) === 1 &&
            this.controlledArchiveDays() > 0
        );
    });
```

In `unified-live-epg-view.ts` replace the import (line 20)

```ts
import { SettingsStore } from '@iptvnator/services';
```

with

```ts
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
```

then after `const settingsStore = inject(SettingsStore);` (line 81) add

```ts
    const runtime = inject(RuntimeCapabilitiesService);
```

and in `timelineArchiveAvailable` replace

```ts
        const item = options.activeItem();
        return (
            Number(item?.tvArchive ?? 0) === 1 &&
            Number(item?.tvArchiveDuration ?? 0) > 0
        );
```

with

```ts
        const item = options.activeItem();
        return (
            runtime.supportsProviderCatchUp &&
            Number(item?.tvArchive ?? 0) === 1 &&
            Number(item?.tvArchiveDuration ?? 0) > 0
        );
```

Both computeds read their signal (`selectedLiveItem()`, `activeItem()`) before the flag, so a later selection always re-evaluates them.

- [ ] **Step 5: Run the project tests and lint**

```bash
pnpm nx test services
pnpm nx test portal-xtream-feature
pnpm nx test portal-shared-ui
pnpm nx lint services
pnpm nx lint portal-xtream-feature
pnpm nx lint portal-shared-ui
```

Expected: PASS. `unified-live-catchup-timeline.spec.ts` asserts no portal archive window, so the real `RuntimeCapabilitiesService` it injects does not change its results. Lint is clean, with `runtime-capabilities.service.ts` at 302 counted lines (over the 300 target, under 400).

- [ ] **Step 6: Document the gate**

In `docs/architecture/xtream-portal-compatibility.md` (the Provider EPG section from Task 14), replace

```markdown
With the provider guide on screen, the PWA also offers catch-up from the EPG
panel for channels with `tv_archive`, using the REST MPEG-TS URL described
under Catch-Up Playback URLs.
```

with

```markdown
The PWA offers no catch-up from the EPG panel:
`RuntimeCapabilitiesService.supportsProviderCatchUp` is false there, because
the browser players did not play the provider's REST MPEG-TS archive URL in
the server EPG 3a check. It gates `archivePlaybackAvailable` (Live TV) and
`timelineArchiveAvailable` (Favorites/Recent), and with them watch, copy and
download; the desktop app keeps all three.
```

In `docs/architecture/pwa-self-hosted.md` (the Runtime Limitations bullet from Task 14), replace

```markdown
  stored per browser like other settings.
```

with

```markdown
  stored per browser like other settings. Xtream catch-up from the EPG panel
  is desktop-only (`supportsProviderCatchUp`); the PWA timeline shows past
  programmes without archive actions.
```

- [ ] **Step 7: Commit**

```bash
git add libs/services/src/lib libs/portal/xtream/feature/src/lib/live-stream-layout libs/portal/shared/ui/src/lib/components/unified-collection docs/architecture/xtream-portal-compatibility.md docs/architecture/pwa-self-hosted.md
git commit -m "fix(pwa): hide Xtream catch-up the browser players cannot play

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Full validation

**Files:** none (fix-ups go into the task they belong to, as a new commit).

- [ ] **Step 1: Unit tests and lint of every touched project**

```bash
pnpm nx run-many -t test -p services portal-xtream-data-access portal-xtream-feature portal-stalker-data-access portal-stalker-feature portal-shared-data-access portal-shared-ui workspace-dashboard-data-access workspace-dashboard-feature workspace-shell-util workspace-shell-feature web-backend
pnpm nx test web --testPathPatterns=settings
pnpm nx run-many -t lint -p services portal-xtream-data-access portal-xtream-feature portal-stalker-data-access portal-stalker-feature portal-shared-data-access portal-shared-ui workspace-dashboard-data-access workspace-shell-util web web-backend web-e2e
```

Expected: all pass. The `web` tests are limited to the settings specs this PR touches; CI runs the whole `web` suite.

- [ ] **Step 2: Types, templates, i18n, budgets**

```bash
pnpm run typecheck:ci
pnpm run typecheck:spec
pnpm nx build web --configuration=pwa
pnpm run i18n:check
git diff --stat origin/master...HEAD -- tools/eslint/max-lines-baseline.mjs
```

Expected:
- the type checks pass
- the PWA build compiles the changed templates under strict templates: `guideBySource[ch.sourceType]`, `showsEpgPanel()`, `skeletonShowsEpg()`, and the `@if (showsXmltvSources())` block with its `[showsXmltvSources]` binding
- `i18n:check` passes with no new keys
- the baseline diff is empty

- [ ] **Step 3: E2E**

```bash
pnpm nx run web-e2e:e2e -- --project=chromium
pnpm nx run electron-backend-e2e:e2e-ci--src/epg-timeline-interaction.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-catchup-timeline.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-epg.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/settings.e2e.ts
```

Expected: the full Chromium web suite passes, including `@self-hosted`, `@pwa` and `@settings`. The four Electron specs pass (EPG timeline, Xtream catch-up, Xtream EPG, Settings with its EPG page). In real Electron builds every flag involved is true (`supportsProviderEpg`, the EPG display flag and, if Task 17 applied, `supportsProviderCatchUp`), so the desktop Xtream and Stalker guides, rows, Settings → EPG and catch-up must be unchanged.

- [ ] **Step 4: Release note and tree state**

```bash
pnpm run release:notes:validate
git status --short
```

Expected: valid; working tree clean.

---

### Task 19: Local review gate

**Files:** whatever the reviewers' accepted findings touch.

Follow `docs/development/agent-workflow.md#local-review-before-a-pull-request`. Do not push before both reviewers are clean on the same commit.

- [ ] **Step 1: Review the committed branch**

```bash
git fetch origin
REVIEW_DIR=$(mktemp -d)
codex review --base origin/master -c model_reasoning_effort=high > "$REVIEW_DIR/codex-round-1.txt" 2> "$REVIEW_DIR/codex-round-1.log" &
greptile review --json > "$REVIEW_DIR/greptile-round-1.json"
wait
tail -n 60 "$REVIEW_DIR/codex-round-1.txt"
node -e "const r=require(process.argv[1]); console.log('confidence', r.confidence, 'comments', (r.comments||[]).length)" "$REVIEW_DIR/greptile-round-1.json"
```

Expected: both runs complete. Greptile counts as clean when `confidence` is 5 and there are 0 comments. Codex counts as clean when its final message reports no findings. A non-zero Greptile exit means the review did not run; report that and do not install or sign in on the maintainer's behalf.

- [ ] **Step 2: Fix, re-commit, repeat**

Check every finding against the code. Fix the real ones in a new commit, for example `git commit -m "fix(epg): address local review round 1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`, and note a one-line reason for each declined one. Re-run Task 18 Step 1 for the touched projects, then repeat Step 1 with `round-2`, `round-3` and so on. Stop when both reviewers are clean on the same commit. If findings repeat, or after five rounds, stop and ask the maintainer instead of pushing.

---

### Task 20: Push and open the pull request

**Files:** none.

- [ ] **Step 1: Push once**

```bash
git push -u origin claude/server-epg-provider
```

- [ ] **Step 2: Write the PR body**

```bash
BODY=$(mktemp)
cat > "$BODY" <<'EOF'
## What changed

- New capability `RuntimeCapabilitiesService.supportsProviderEpg`: true in the PWA (PwaService → `/xtream`, `/stalker` proxy) and in Electron when both `xtreamRequest` and `stalkerRequest` exist.
- Xtream: the store (`withEpg`), channel-row previews and the live EPG panel use it instead of the XMLTV flag `supportsEpg`.
- Stalker: short and bulk EPG, row previews and the EPG panel use it; manual mapping overlays stay behind `supportsEpg` + `supportsEpgMapping`.
- Favorites/recent: `StreamResolverService` asks portals on the new flag and keeps XMLTV lookups (M3U, `epg_channel_id`, mappings) on `supportsProgramLookup`; the list decides each row by its source and the EPG panel by the selection; the loading skeleton follows the same rule, so portal rows no longer jump from 52 to 68 px.
- Dashboard: Xtream/Stalker live cards are answered in the PWA.
- Settings → EPG in the PWA: the guide layout and the time offset (display flag `supportsEpg || supportsProviderEpg`); the XMLTV source list, refresh/clear, file picker and `preferUploadedEpgOverXtream` keep the XMLTV gate. Nav, form, section template and settings search (`epg-display` requirement) follow.
- web-backend host-guard tests pin that failing provider EPG (slow bulk guide, 4xx/5xx) never fast-fails playback or catalog requests; no production change was needed.
- E2E: a new Xtream PWA spec (row line + player panel on the mock's `epg:epg` scenario); the two Stalker PWA tests now assert EPG is shown and the bulk guide is fetched once; the PWA settings spec checks the EPG page's display rows and that the offset is saved.
- Docs: Stalker EPG, Xtream compatibility, PWA self-hosted, dashboard, host guard, M3U module (display settings), Docker README. This PR also carries the phase 3 design spec and plans.

## Why

The browser and Docker versions showed no EPG at all, although the proxy already carried the provider calls: every gate was the Electron XMLTV capability. Closes #1683. XMLTV in the PWA follows in 3c/3d (`docs/superpowers/specs/2026-10-15-server-epg-design.md`).

## Catch-up check

CATCHUP_SECTION

## Release note

`.changes/pwa-provider-epg.md` — feature, area `pwa`, highlight "Programme guide in the browser", closes #1683.

## Checks

- `pnpm nx run-many -t test` for services, portal-xtream-data-access, portal-xtream-feature, portal-stalker-data-access, portal-stalker-feature, portal-shared-data-access, portal-shared-ui, workspace-dashboard-data-access/feature, workspace-shell-util/feature, web-backend; `pnpm nx test web --testPathPatterns=settings`; `-t lint` for those and web, web-e2e: pass
- `pnpm run typecheck:ci`, `pnpm run typecheck:spec`, `pnpm nx build web --configuration=pwa`, `pnpm run i18n:check`, `pnpm run release:notes:validate`: pass
- `pnpm nx run web-e2e:e2e -- --project=chromium`: pass
- Electron: `epg-timeline-interaction.e2e.ts`, `xtream-catchup-timeline.e2e.ts`, `xtream-epg.e2e.ts`, `settings.e2e.ts`: pass
- Local review: Codex and Greptile clean on REVIEWED_COMMIT

Out of scope (follow-ups): Stalker EPG error snackbars stay as on the desktop (portal EPG requests are not `silent`); Xtream catch-up badges on rows are unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 3: Fill in the catch-up section from Task 16**

Write the verdict text that matches Task 16, then add Task 16's record, indented four spaces so it renders as a code block. Then splice both into the body.

If Task 16 says **plays** (Task 17 skipped):

```bash
CATCHUP=$(mktemp)
cat > "$CATCHUP" <<'EOF'
Manual check against a real Xtream provider (REST MPEG-TS `/timeshift/…/.ts`, no probe in the browser): archived programmes play from the EPG panel in Chrome and Safari with the default Video.js player, so the PWA keeps catch-up (watch, copy archive URL). Task 17 of the plan (hide catch-up behind `supportsProviderCatchUp`) was skipped.
EOF
```

If Task 16 says **does not play** (Task 17 applied):

```bash
CATCHUP=$(mktemp)
cat > "$CATCHUP" <<'EOF'
Manual check against a real Xtream provider (REST MPEG-TS `/timeshift/…/.ts`, no probe in the browser): archived programmes did not play from the EPG panel with the default Video.js player in the browsers below, so the PWA hides catch-up behind `RuntimeCapabilitiesService.supportsProviderCatchUp` (false in the PWA, true in Electron); the desktop keeps watch, copy and download.
EOF
```

Then, for either variant:

```bash
printf '\n' >> "$CATCHUP"
sed 's/^/    /' "${TMPDIR:-/tmp}/iptvnator-3a-catchup.txt" >> "$CATCHUP"
CATCHUP="$CATCHUP" perl -0pi -e 'BEGIN { local $/; open my $h, "<", $ENV{CATCHUP} or die $!; $c = <$h>; chomp $c; } s/CATCHUP_SECTION/$c/' "$BODY"
sed -i '' "s/REVIEWED_COMMIT/$(git rev-parse --short HEAD)/" "$BODY"
grep -c "CATCHUP_SECTION\|REVIEWED_COMMIT\|<date>\|<version>" "$BODY"
```

Expected: the final grep prints `0`. Every slot of the Task 16 record must be filled in, and the record must name no URL, host or credential.

- [ ] **Step 4: Open the PR**

Before running the command, edit the Checks lines if any result in Task 18 or 19 differed: list a skipped check with its reason, and any declined review findings.

```bash
gh pr create --base master --head claude/server-epg-provider --title "feat(pwa): show Xtream and Stalker EPG in the browser version" --body-file "$BODY"
```

- [ ] **Step 5: Report**

Report:
- the PR URL and the reviewed commit
- the checks and results, and any skipped check with its reason
- the catch-up verdict, and whether Task 17 ran
- the docs changed (Task 14, plus Task 17 Step 6 if it ran)
- that `.changes/pwa-provider-epg.md` was added as a highlight

Later updates to the PR arrive as merges of `origin/master`, never as a rebase or force-push, and each one passes Task 19 again before its single push. 3b-1 (`claude/server-epg-seam`) also touches `runtime-capabilities.service.ts` (its EPG flags become delegates to `epg-runtime-capabilities.ts`; `supportsProviderEpg` stays a plain getter there), `with-epg.feature.ts` and `portal-channels-list.component.ts`. It merges `origin/master` after this PR lands.

---

## Open questions for the maintainer

1. **One flag for both providers in Electron.** `supportsProviderEpg` requires both `xtreamRequest` and `stalkerRequest`. Any shipped preload has both, so this affects only partial test bridges. The alternative is two flags (`supportsXtreamProviderEpg`, `supportsStalkerProviderEpg`), which the overview does not name.
2. **"All playlists" skeleton in the PWA.** For collections across all playlists, the skeleton reserves the programme line whenever any guide exists (Task 9). An M3U-only global list in the PWA therefore shrinks from 68 to 52 px when its rows arrive. Avoiding that would need the source mix before loading, for example from the previous load.
