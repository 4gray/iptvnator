# Idle work audit (2026-09)

One-off investigation for plan item D3 ("hidden work audit") of the
performance journeys plan. The question: what does IPTVnator do while the
user does nothing? This document records the measurement and the findings.
Nothing was changed. Every row marked **own thread** is a candidate for a
separate, benchmarked follow-up under the
[performance journeys](performance-journeys.md) process.

**Historical results.** The capture ran on `8ebb7e342` (2026-09-26). The
cinematic rotating dashboard hero (#1725, `887ac64`) landed afterwards, so the
measured counts and the "all dashboard idle work" conclusions below describe
the dashboard without it. The hero is accounted for separately, from code
reading, under
[Added after the measurement](#added-after-the-measurement-rotating-hero).

## Result in brief

- **The main process starts no periodic work at idle.** Across four
  two-minute windows its probes saw zero timers fired, zero outbound HTTP
  requests and zero file writes. With a fresh profile they also saw zero IPC
  and zero SQL. With recent live channels, the dashboard's renderer timers
  caused 1–2 IPC calls and 2–4 SQL statements per window (see the table
  below). Workers were not probed directly: the SQL trace covers the
  database worker, and reading the code found worker timers only inside
  running operations. The EPG refresh, download manager, source health
  probe, auto-updater, remote-control server and connectivity guard are all
  demand-driven or off by default.
- **All idle work is in the renderer, on the dashboard.** With a fresh
  profile, two RxJS intervals (30 s and 60 s) cause 12 app-wide Angular
  change-detection passes per two minutes. With recently watched live
  channels, a third interval adds an IPC and SQL lookup about every
  minute. It also triggers a 24-frame, full-document layout animation every
  30 s.
- **A minimized window does exactly the same work as a visible one.** The
  main window sets `backgroundThrottling: false`
  ([app.ts:125](../../apps/electron-backend/src/app/app.ts)). Chromium
  therefore neither throttles timers nor reports the page as hidden. No
  renderer code can pause itself when the window is minimized, because
  `document.visibilityState` stays `visible`.

The three worst offenders, in order:

1. `backgroundThrottling: false` on the main window: every renderer timer,
   rAF and CSS transition keeps running when minimized, and the page
   visibility API is blind to minimization.
2. The dashboard live-EPG 30 s heartbeat with recent live cards: an IPC and
   SQL batch about every minute, rebuilt rails, and a 0.4 s `width`
   transition on progress bars. Each tick costs about 24 full-document
   layouts plus GPU frames. This state has 17–76× the GPU time of the fresh
   profile.
3. The always-on 30 s portal live-EPG heartbeat plus the 60 s source-expiry
   tick: 12 app-wide change-detection passes per two minutes, even when there
   is nothing to update. The 60 s tick also rebuilds the sources rail, which
   schedules a scroll reset and re-observes every card.

## Method

- **Build.** `pnpm nx run electron-backend:build-e2e` on `8ebb7e342`. It
  is unoptimized, with source maps and Angular dev mode. Dev mode runs every
  change detection twice (the `checkNoChanges` pass), so per-firing
  renderer costs below are upper bounds for a production build. Timer, rAF,
  IPC, SQL, HTTP, layout and DOM-mutation counts do not depend on dev mode.
  The Angular change-detection and template-update counts are dev-build
  counts: a production build skips the `checkNoChanges` pass, so it performs
  fewer template updates per tick.
- **Servers.** The Xtream mock ran on loopback port 3411 with its control
  plane enabled. A second E2E worktree already held 3310. A throwaway loopback
  HTTP server served a 60-channel M3U with `url-tvg` and logo URLs, and it
  logged every request.
- **Profile.** A fresh data directory seeded through the E2E fixture
  helpers: one M3U URL source and one Xtream source (mock `user1`). The
  "recent live" variant also opened two M3U and two Xtream live channels
  during seeding.
- **Measurement launch.** The app was relaunched against the seeded profile
  with `IPTVNATOR_TRACE_STARTUP=1`, `IPTVNATOR_TRACE_IPC=1` and
  `--remote-debugging-port=9422`, because port 9222 was held by another
  Electron. The app landed on `/workspace/dashboard`. After a 20 s settle
  window came 120 s visible and focused, then 120 s minimized. The measured
  state was `isMinimized() === true` and `isVisible() === false`.
- **Main-process probe.** A bootstrap entry point, the same pattern as
  `playlist-refresh-write-gate.ts`, wrapped these before requiring
  `dist/apps/electron-backend/main.js`:
  - `ipcMain.handle/on`
  - `webContents.send/postMessage`
  - global `setTimeout/setInterval/setImmediate`
  - `http(s).request/get`, `fetch`, `net.request/fetch`
  - `fs` write and rename calls
  - `Worker.postMessage`

  SQL came from the existing trace channel on stdout.
- **Renderer probe.** Injected before any page script with
  `Page.addScriptToEvaluateOnNewDocument`. It wrapped timers, rAF,
  IndexedDB writes, `localStorage`/`sessionStorage`, fetch and XHR. It also
  counted `Zone.prototype.runTask` per zone and source, and change-detection
  ticks through `ng.ɵsetProfiler` (event `ChangeDetectionStart`). DOM
  mutations came from a document-wide `MutationObserver`. Separately, a CDP
  `Tracing` profile and `Performance.getMetrics` covered each window, and
  `app.getAppMetrics()` gave per-process CPU.
- **Two passes.** An instrumented pass collected traces and a 1 kHz
  main-process CPU profile. A light pass left the profiler, tracing and
  network capture off, so its per-process CPU numbers are not inflated by the
  instruments. The instrumented pass had browser-process CPU of about 2.5 s
  per window and 550 wakeups/s, almost all of it the sampling profiler.

Playwright pins every page it attaches to as visible: `Emulation.setFocusEmulationEnabled`
raises the page's capturer count. The minimized windows above were measured
through Playwright. That is faithful for this build, because
`backgroundThrottling: false` keeps the page visible anyway. Measuring a build
where the window can become hidden needs a launch without Playwright over raw
CDP. The follow-up PRs do that.

Harness artifacts that were excluded:

- The E2E fixture's own 60 Hz rAF frame counter (`startRendererFrameCapture`),
  which was cancelled after launch.
- An extra `about:blank` navigation before the app URL, used to register
  the renderer probe.
- The probe's own stdout tee.
- Playwright `evaluate` round-trips at window boundaries.

The harness was a one-off and is deliberately not committed, so the figures
below cannot be rerun from the repository as is. They are observations from
this run, and the method above describes how to rebuild the harness. The
maintained way to measure is the journey harness in
[performance journeys](performance-journeys.md); an idle journey there is the
path to making these counters reproducible and guarded.

## Measurements

Counts per 120 s window. CPU is the light pass, taken from
`getAppMetrics().cpu.cumulativeCPUUsage` deltas.

| Counter | Fresh, visible | Fresh, minimized | Recent live, visible | Recent live, minimized |
| --- | --- | --- | --- | --- |
| Renderer timer firings | 6 | 6 | 10 | 10 |
| Renderer rAF callbacks | 4 | 4 | 12 | 12 |
| Angular CD ticks | 12 | 12 | 29 | 30 |
| DOM mutation records | 0 | 0 | 12 | 12 |
| Layouts (`LayoutCount`) | 0 | 0 | 139 | 129 |
| IndexedDB / Storage writes | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Renderer fetch/XHR, CDP network | 0 | 0 | 0 | 0 |
| IPC renderer→main (excluding trace echo) | 0 | 0 | 1 | 2 |
| IPC main→renderer | 0 | 0 | 0 | 0 |
| SQL statements (main) | 0 | 0 | 2 | 4 |
| Main timers fired / HTTP / fs writes | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Renderer process CPU | 158 ms¹ | 11 ms | 308 ms | 463 ms |
| GPU process CPU | 19 ms | 7 ms | 332 ms | 530 ms |
| Browser (main) process CPU | 214 ms¹ | 67 ms | 180 ms | 281 ms |

¹ The visible window came first, so it also absorbed a one-time post-startup
V8 incremental major GC and Playwright's evaluate calls. The trace shows 798
`V8.GC_MC_INCREMENTAL` steps in the visible window and none in the minimized
one. Steady-state renderer cost for the fresh profile is closer to the
minimized figure.

Per-firing costs, taken from the renderer trace (dev build):

- Each 30 s or 60 s `TimerFire` is 1.6–2.2 ms, with rare outliers of 11–13 ms.
- The rail scroll-reset rAF pair is 0.4–1.5 ms.
- In the recent-live state, each 30 s tick adds about 24 consecutive frames,
  each with a full-document `Layout` (30 dirty of 541 objects), `HitTest`,
  `UpdateLayer` and two `IntersectionObserver` computations. That is about
  0.8–2 ms of renderer main-thread time per frame, or about 25–40 ms per tick.
  The GPU adds 45–130 ms per tick.

## Findings

"Evidence" says whether the row was measured at idle or found by reading the
code. Costs are for the dev build unless noted.

### Periodic work observed at idle

| Source | What it does | Period | Cost per firing | Justified | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| [app.ts:125](../../apps/electron-backend/src/app/app.ts) `backgroundThrottling: false` | Disables Chromium background throttling and page-visibility changes for the main window. It was added without a stated reason in #1123. | Continuous (amplifier) | Makes every renderer row below cost the same while minimized. Minimized windows still ran 6–10 timers, 4–12 rAF and 129 layouts per 2 min. | **No.** Nothing on the idle path needs full-rate timers while minimized, and it defeats the keep-awake visibility gate (see the next section). | Measured: `isMinimized()` is true while `visibilityState` stays `visible` | **Own thread.** Find the playback or radio case that needed it, then enable throttling or toggle it per active playback through `webContents.setBackgroundThrottling`. Add a minimized idle counter to the journeys. |
| [dashboard-portal-live-epg.presenter.ts:52](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-portal-live-epg.presenter.ts) `interval(LIVE_EPG_TICK_MS)` feeding the effect at :86 | Heartbeat that calls `DashboardPortalLiveEpgService.sync(wanted)` for Xtream and Stalker live cards | 30 s, always on while the dashboard is mounted | One app-wide CD tick, about 2 ms. With no portal live cards `wanted` is empty, so there is no IPC. | **No** when `wanted` is empty. The tick has nothing to do but still runs a full zone CD pass. | Measured: 4 per 2 min in every state | **Own thread.** Run the interval only while `wanted` is non-empty, outside the Angular zone, and pause on hidden. |
| [workspace-dashboard-rails.component.ts:345](../../libs/workspace/dashboard/feature/src/lib/rails/workspace-dashboard-rails.component.ts) `interval(SOURCE_EXPIRY_TICK_MS)`, read at :753 | Minute heartbeat for source-expiry badges. It recomputes `sourceCards`, which returns a new array. | 60 s, whenever the dashboard is mounted: `toSignal(interval(...))` subscribes at construction, so it also ticks with no recent sources or with that rail disabled; the rail rebuild only follows when recent sources exist | One CD tick of about 2 ms. The new `items` input also fires the rail effects: two chained rAF CD ticks and a `scrollTo(0)` from `scheduleResetToStart` ([dashboard-rail.component.ts:176–187, :317](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-rail.component.ts)), and an IntersectionObserver re-observe of every card. | **Partly.** Badges must cross day boundaries, but a minute tick for day-granular badges is excessive. Returning a new array each time also resets a user-scrolled rail. | Measured: 2 timer and 4 rAF per 2 min | **Own thread** (#1722). Schedule the next badge boundary instead of polling, arm nothing when no badge can change, give `sourceCards` a structural `equal`, and reset the rail scroll only when card identity changes. |
| [dashboard-live-epg.presenter.ts:116–132](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-live-epg.presenter.ts) `interval(LIVE_EPG_TICK_MS)` with `forkJoin(askScope…)` | "Now on air" lookup for hero, live-favourite and recent-live cards | 30 s, only when live cards exist | `GET_CURRENT_PROGRAMS_BATCH` IPC about every second tick, because of the 60 s program cache, running 2 SQL `SELECT`s. Every emission is a new `Map`, so the live rails rebuild. That adds rAF scroll resets, IO re-observe, and new progress widths (next row). | **Partly.** Progress and "now" titles are a feature. Rebuilding the rails when the programme did not change is not. | Measured: 1–2 IPC and 2–4 SQL per 2 min | **Own thread.** Emit only on programme change, tick on the next programme boundary instead of every 30 s, and pause on hidden. |
| [dashboard-rail.component.scss:256–271](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-rail.component.scss) `.rail__art-progress i { transition: width 0.4s ease }` | Animates the live-programme progress bar each time its width binding changes | Every 30 s tick with live cards | About 24 full-document layouts and paints over 0.4 s: about 25–40 ms renderer and 45–130 ms GPU per tick. Twelve `<i>` attribute mutations per 2 min. | **No.** A sub-pixel progress change does not need a layout-driven animation, and it runs while minimized. | Measured: trace shows one rAF, then 24 frames of Layout, HitTest and IO every 30 s | **Own thread.** Animate `transform: scaleX()` (compositor-only), or drop the transition for tick updates. |
| Eager components on every tick: [app.component.ts:54](../../apps/web/src/app/app.component.ts), [workspace-shell.component.ts:52](../../libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.ts), [epg-progress-panel.component.ts:67](../../libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel.component.ts), [app-update-notification-panel.component.ts:106](../../apps/web/src/app/app-update-notification-panel.component.ts) | `ChangeDetectionStrategy.Eager` roots re-render their templates on every zone tick | Every tick above | Each of the four templates updated 24 times over the 12 ticks: twice per tick, because dev mode adds the `checkNoChanges` pass | **No** for idle. Nothing in them changes on a timer. | Measured through the `TemplateUpdateStart` profiler events | Fold into plan item C6 (OnPush/zoneless). No separate thread. |

### Added after the measurement: rotating hero

Not in the measured counts above; found by reading the code on master after
#1725. The rotation row was measured later, when its follow-up landed.

| Source | What it does | Period | Cost per firing | Justified | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| [dashboard-hero.component.scss:579](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-hero.component.scss) `hero-dot-fill` and the `(animationend)="onRotationTick()"` at [dashboard-hero.component.html:233](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-hero.component.html) | The active rotation dot animated `width` 0 → 18 px over `HERO_ROTATION_MS` (8 s); its `animationend` advances the slide, which starts the next fill and the backdrop's 8 s `transform` transition | Continuous while the dashboard is visible with two or more hero slides, unless the rotation is paused or reduced motion is on | Measured afterwards (visible, four slides, 120 Hz display): about 10,500 layouts, 16 s renderer and 17 s GPU process CPU per 120 s; about 0.3 s each while paused | **Partly.** The rotation is a feature. Animating a layout property for it is not, and it runs on an otherwise idle page. | Measured after the fact | **Done.** The fill now animates `transform` only: about 370 layouts (the slide switches), 3.7 s renderer and 14 s GPU process CPU per 120 s. The GPU figure is the compositor drawing every vsync for any running animation, so going lower means animating less, not animating differently; whether rotation should stop on an idle dashboard is open. |
| [dashboard-live-epg.presenter.ts:121](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-live-epg.presenter.ts) `heroLiveCandidates` (lookup) and :191 (pinned portal keys); limits in [dashboard-hero-slides.utils.ts:14–15](../../libs/workspace/dashboard/feature/src/lib/rails/dashboard-hero-slides.utils.ts) | Up to five hero live candidates (three favourites, two recent) join the 30 s XMLTV "now on air" lookup, and are pinned for the portal live-EPG queue even when their rails are hidden or scrolled away | 30 s XMLTV heartbeat while the hero is enabled and any candidate exists; portal sync on the same tick | More lookup keys per `GET_CURRENT_PROGRAMS_BATCH` IPC and SQL, and portal `get_short_epg`-style requests for pinned Xtream/Stalker candidates when stale (not measured) | **Yes** for the programme shown on the hero; the 30 s re-ask of unchanged programmes is not | Static | Covered by #1722: the clock re-asks only when a programme ended, a key has no answer, the answer is five minutes old, or the guide changed, and it pauses while hidden. |

### Checked and not periodic at idle

| Source | What it does | Period | Cost per firing | Justified | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| EPG refresh ([epg.events.ts:176–178](../../apps/electron-backend/src/app/events/epg.events.ts)) | There is no scheduler. `FETCH_EPG` and `EPG_CHECK_FRESHNESS` (default `maxAgeHours` 12) run only when the renderer asks. | None | One `FETCH_EPG` at boot with no configured EPG URL. The M3U `url-tvg` was never requested. | Yes | Measured: 0 at idle | None |
| Download manager ([download-transfer.ts:289](../../apps/electron-backend/src/app/events/database/download-transfer.ts), [download-reconnect.ts:104](../../apps/electron-backend/src/app/events/database/download-reconnect.ts)) | Writes progress at most every 500 ms from stream `data` events, and has a 1 s reconnect sleep. It runs only while bytes flow or a reconnect is pending. | Event-driven | One `UPDATE downloads` plus a `DOWNLOADS_UPDATE_EVENT` per progress write during a transfer | Yes (real transfers) | Static; `DOWNLOADS_GET_LIST` once at boot | None |
| Source health probe ([source-health.service.ts:111–114](../../libs/portal/shared/data-access/src/lib/source-health.service.ts), #1592) | On-mount and manual checks. TTL 60 s, or 15 s when uncertain. The documented contract is demand-driven with no polling ([m3u-playlist-module.md](m3u-playlist-module.md#desktop-source-health)). | None | One Xtream `player_api.php` at boot (dashboard expiry check). No M3U probe on the dashboard. | Yes | Measured: 0 at idle | None |
| Auto-updater ([app-update.service.ts:291](../../apps/electron-backend/src/app/services/app-update.service.ts)) | One check at startup, packaged builds only, then only on request | None | — | Yes | Static; `APP_UPDATE:GET_STATUS` once at boot | None |
| Remote-control server ([http-server.ts:126](../../apps/electron-backend/src/app/server/http-server.ts)) | Listens only when the `remoteControl` setting is on (default off). The 2 s poll lives in the phone client and is served from memory. | None by default | — | Yes | Static; off in the profile | None |
| Connectivity guard ([host-connectivity-guard.ts:43](../../libs/shared/host-health/src/lib/host-connectivity-guard.ts)) | Compares against the clock lazily per request. The contract says no heartbeat ([host-connectivity-guard.md](host-connectivity-guard.md)). | None | — | Yes | Measured: 0 at idle | None |
| Playlist auto-refresh ([app.component.ts:261–294](../../apps/web/src/app/app.component.ts)) | One pass at startup for playlists with `autoRefresh` (default false) | Once | — | Yes | Static | None |
| PWA service worker ([app.config.ts:126–129](../../apps/web/src/app/app.config.ts), `ngsw-config.json`) | `registerWhenStable:30000`. It has asset groups only: no `dataGroups`, no periodic sync, and no `checkForUpdate` polling (`PwaService.checkUpdates` is never called). Disabled in Electron. | None | — | Yes | Static only; no PWA runtime capture was run | None |

### Conditional periodic work (not active on idle `/workspace`)

Found by reading the code. They run only on the listed route or state, so a
user who leaves that screen open pays them indefinitely, minimized included.

| Source | What it does | Period | Cost per firing | Justified | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| [mpv-session.service.ts:140–141](../../apps/electron-backend/src/app/events/mpv-session.service.ts) | External MPV position poll | 2 s delay, then 5 s | Two IPC-socket round-trips and one `playback-position-update` | Yes while playing. The early-exit leak found here (an unstored start-delay handle leaving an orphaned 5 s poll) is **resolved by #1720**. Still open: in reuse mode the poll keeps querying an idle MPV (no IPC while `time-pos` is null). | Static | Early-exit leak: done (#1720). Reuse mode: needs an idle signal from MPV before the poll can stop; not worth its own thread at two local socket calls per 5 s. |
| [vlc-session.service.ts:81–82](../../apps/electron-backend/src/app/events/vlc-session.service.ts) | External VLC position poll | 1.5 s delay, then 2 s | Up to three localhost TCP connections, then IPC | Yes while playing. The early-exit leak (orphaned 2 s poll) is **resolved by #1720**. | Static | Done (#1720). |
| [embedded-mpv-native.service.ts:1068](../../apps/electron-backend/src/app/services/embedded-mpv-native.service.ts) | Embedded MPV session snapshot poll | 500 ms while a session exists | Native snapshot, diff, and IPC only on change | Yes during playback. It is cleared when the last session closes. | Static | None |
| [embedded-mpv-session-controller.ts:197](../../libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-session-controller.ts) | Renderer-side bounds poll for a native-view embedded MPV session: compares `getBoundingClientRect()` with the last synced bounds | 500 ms while a native-view session is open (skipped for frame-copy) | One layout read outside the Angular zone; on drift a rAF and a `setEmbeddedMpvBounds` IPC | Yes during playback: a position-only layout shift would otherwise leave the native view misplaced | Static | Cover with the throttling thread: it kept its rate while minimized under `backgroundThrottling: false`. |
| [embedded-mpv-frame-pump.ts:212](../../apps/electron-backend/src/app/api/embedded-mpv-frame-pump.ts) (preload) | Frame-copy engine's frame pump: `pumpTick` re-arms itself with `requestAnimationFrame`, checks the shared-memory ring for a new frame, and uploads and draws it when one arrived | Every display frame while a frame-copy session is attached, paused included; stops only on detach. Opt-in (`IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY`) | A ring read per frame; a texture upload and draw per new frame | Yes while the video is on screen. A paused or minimized session gains nothing from 60 Hz polling. | Static. Under `backgroundThrottling: false`, rAF kept firing in a minimized window: the E2E fixture's own rAF counter ran at 60 Hz there. | Cover with the throttling thread (rAF stops in a hidden window once throttling is on), and consider stopping the pump while paused. |
| [embedded-mpv-controls.adapter.ts:252](../../libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.ts) (frame-copy) and [embedded-mpv-player.component.ts:587](../../libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.ts) (native view) | Elapsed-time heartbeat of an active embedded-MPV recording; the two intervals are mutually exclusive by engine | 1 s while a recording is active | A signal write and a CD tick | Yes while the elapsed time is on screen. A minimized window gains nothing from it. | Static. Under `backgroundThrottling: false` it kept its rate while minimized. | Cover with the throttling thread (throttled while hidden once #1724 lands). |
| [embedded-mpv-reconnect.ts:296](../../apps/electron-backend/src/app/services/embedded-mpv-reconnect.ts) | Reconnect backoff | 2 s to 30 s, at most 6 attempts | Native reload | Yes | Static | None |
| [channel-list-container.component.ts:426, :431](../../libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts) | M3U list: re-queries current programmes and metadata for **all** channels in the list, plus a progress tick | 60 s / 30 s while an M3U list is mounted | IPC and SQL that grow with channel count (not measured) | **Partly.** Only visible rows need refreshing. | Static | **Own thread.** Measure on a 10k-channel list, then limit to the viewport and pause on hidden. |
| [epg-refresh-coordinator.service.ts:82](../../libs/portal/xtream/feature/src/lib/portal-channels-list/epg-refresh-coordinator.service.ts) | Xtream live: refreshes stale visible or tracked EPG entries | 60 s while live lists are registered | Xtream HTTP through main for stale entries only | Yes (already scoped) | Static | Pause on hidden once throttling allows it. |
| [stalker-watchdog.controller.ts:188](../../libs/portal/stalker/data-access/src/lib/stalker-watchdog.controller.ts) | Stalker `get_events` keep-alive | Portal `watchdog_timeout` (default 120 s) | A playlist row read and one portal HTTP request | Yes (portal protocol) | Static | None |
| [downloads.component.ts:223](../../libs/portal/downloads/feature/src/lib/downloads.component.ts), [recording-queue.component.ts:88](../../libs/portal/downloads/feature/src/lib/recording-queue.component.ts) | Recordings reload and elapsed-time tick | 15 s / 1 s while recordings are active and the page is open | `loadRecordings()` IPC and SQL / CD tick | **Partly.** Downloads are already push-based, so recordings could be too. | Static | **Own thread.** Push recording state like `onDownloadsUpdate`. |
| [controls-stream-stats.ts:42](../../libs/ui/playback/src/lib/player-controls/controls-stream-stats.ts) | Stream-info sampling | 1 s, only while the stream-info popover is open; `stop()` clears it when the popover closes | CD tick each | Yes (a closed popover costs nothing) | Static | None |
| 30 s EPG clocks in the Xtream, Stalker, EPG guide and unified live views | "Now" clocks for progress and the current programme | 30 s for as long as their route is open | CD tick each | Yes while visible | Static | Cover with the throttling thread (pause on hidden). |
| [empty-state.welcome-dashboard.scss:58](../../libs/playlist/shared/ui/src/lib/recent-playlists/empty-state/empty-state.welcome-dashboard.scss) (`gridMove`, keyframes in `empty-state.component.scss:169`) | First-run dashboard with no playlists: the welcome state's `::before` grid drifts via an infinite `transform` animation | Continuous (60 s loop) while the empty dashboard is shown; the reduced-motion block does not stop the pseudo-element | Compositor and GPU frames only, no main-thread layout (not measured) | **Partly.** Decorative; a first-run screen left open keeps the GPU busy, and reduced motion should stop it. | Static | **Own thread** (small): stop the `::before` animation under `prefers-reduced-motion`, and consider pausing it while hidden (throttling stops compositor frames in a hidden window once #1724 lands). |
| [video-player.component.ts:790](../../libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts) `epgNowMs` | M3U playlist view: refreshes "now" for EPG state, unconditionally, separate from the channel-list timers above | 30 s while an M3U playlist route is open, with or without an active channel | A signal write and an app-wide CD tick | **Partly.** Needed while a programme is shown; not with no channel selected. | Static | Cover with the throttling thread (pause on hidden), and start it only while a channel with EPG is active. |
| [portal-empty-state.component.scss:25](../../libs/portal/shared/ui/src/lib/components/portal-empty-state/portal-empty-state.component.scss) `portal-empty-state-float` | Xtream, Stalker and unified live views with nothing selected or no results: the empty-state icon floats on an infinite `transform` animation | Continuous (2.8 s loop) while the empty state is shown | Compositor and GPU frames only (not measured) | **Partly.** Decorative; an empty portal view left open keeps the GPU busy. | Static | **Own thread** (small, with the welcome grid): stop decorative loops under reduced motion; #1724 stops their frames in a hidden window. |

Every infinite CSS animation in the renderer styles (`animation: … infinite`)
falls into one of three groups. **Loading indicators** (skeleton and list
shimmers, spinners, the refresh and download spinners, the EPG import spinner)
end with their loading state. **Playback and recording indicators** (live
pulses, the radio artwork and ring, the recording pulse and slide) run only
while something plays or records. **Decorative loops in idle states** are the
welcome grid and the portal empty-state icon listed above; they are the only
ones that keep running on a screen left alone.

## Related observation

[playback-keep-awake.service.ts](../../apps/web/src/app/services/playback-keep-awake.service.ts)
documents that "Visibility gates the lock in both modes: a minimized window
streaming audio in the background should not pin the display on". Under
`backgroundThrottling: false`, a minimized Electron window keeps
`visibilityState === 'visible'` and never fires `visibilitychange`, as
measured in this audit. So the Electron `powerSaveBlocker` likely stays held
for a minimized window playing video. Playback itself was not measured. Verify
this in the same thread as the first worst offender.

## Not covered

- Production (optimized, non-dev-mode) renderer costs. Timer, rAF, IPC, SQL,
  network, layout and DOM-mutation counts carry over; the Angular
  change-detection and template-update counts do not (production skips
  `checkNoChanges`), and per-firing milliseconds are upper bounds.
  The tick count in the optimized build is now measured by J1's idle window:
  `renderer.cdTicksIdle30s` read 3 ticks per 30 s on the journey's dashboard
  (one M3U source, one Xtream portal), the baseline for plan item C6. See
  [performance journeys](performance-journeys.md#idle-window).
- Windows and Linux. Throttling and occlusion behavior differ per platform.
- Idle during playback, and on routes other than the dashboard. The
  conditional table above is from code reading only.
- A PWA runtime capture of the service worker.
