# Performance journeys and the CI ratchet

IPTVnator measures performance through a small set of everyday user journeys.
Each journey has deterministic counters that are asserted exactly, and
wall-clock timings that are recorded as evidence. Counters are ratcheted in CI:
a committed baseline may only be lowered, and only with the measured output as
evidence. This document is the contract for that loop. The journey harness lives in
`apps/electron-backend-e2e/src/journeys` and
`apps/electron-backend-e2e/src/performance/journey-*.ts`; the ratchet scripts
live in `tools/performance/`.

## Journeys

| Journey          | Start                                        | End                                                                           |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| J1 `launch`      | Electron process spawn                       | first playlist or portal card rendered on `/workspace`, inline splash removed |
| J2 `open-source` | click on the Xtream portal card              | category list and first page of the opened section painted                    |
| J3 `playback`    | click on a channel                           | HTML5 `playing` event                                                         |
| J4 `search`      | six-character query typed into global search | results list settled                                                          |

J1 is instrumented: `renderer.initialBytes` from the built output, and the
runtime counters of the launch benchmark below. J2 and J3 are instrumented by
their own specs (below). J4 follows the plan in `.plans/` and is added in its
own thread; each thread names its journey and counter in the PR description.

## Running the journeys

```bash
pnpm run perf:journeys
```

The script runs the Nx target `electron-backend-e2e:journeys`, which builds the
`electron-performance` configuration of the Electron app and the renderer
first, starts the Xtream mock server on the dedicated loopback port
`127.0.0.1:3231` (override with `IPTVNATOR_JOURNEY_XTREAM_MOCK_PORT`), and runs
`playwright.journeys.config.ts` with one worker. Each run writes one file:

```
dist/performance/journeys/<YYYYMMDDTHHMMSSZ>/summary.json
```

Every journey spec (`src/journeys/*.journey.ts`) adds its own
`journeys.<id>` entry to that file. The config starts a run only in the
Playwright runner (not in a worker, which has `TEST_WORKER_INDEX`): it sets
`IPTVNATOR_JOURNEY_RUN_STARTED_AT` and a random `IPTVNATOR_JOURNEY_RUN_ID`
before the worker forks, replacing any value left in the environment. All
specs of one invocation, including a restarted worker, therefore share the
directory and `harness.runId`. The first spec creates the file; a later one
merges into it only when `harness.runId` matches and the rest of the harness
is identical, through a temporary file and a rename. A journey that is
already present fails, so no measurement is ever overwritten; a second
invocation in the same second fails instead of merging into the first.
`IPTVNATOR_JOURNEY_MEASURED_ITERATIONS` lowers the five measured iterations
for a quick local check; the warm-up iteration always runs. Numbers from a
laptop are previews: the Linux CI runner is the canonical measurer for
baselines, as it is for `renderer.initialBytes`.

## J1 `launch`: launch to usable

The profile holds one M3U source and one Xtream portal, both served by the
Xtream mock (`/playlist.m3u` and `player_api.php` on the same origin). The
profile is seeded once per run through the app's own "Add playlist" dialogs,
then every iteration copies that seeded data directory into a fresh temporary
directory and spawns a fresh Electron process on it. One warm-up iteration is
recorded but excluded from the summary; five measured iterations follow. The
app lands on `/workspace/dashboard`, so the first card is a card of the
"Recent sources" rail; an `app-playlist-item` row on `/workspace/sources`
also ends the journey for profiles that disable the dashboard.

The journey ends at the first `MutationObserver` batch in which all of the
following hold: the location is below `/workspace`, `#initial-splash` is no
longer in the DOM, and a source card has a non-empty client rect. Counters are
frozen at that microtask checkpoint, so bridge calls and mutations issued
later in the same task are included and everything after it is not.

Three test-side pieces are injected. The app itself only contributes the
main-process counters below, which exist only with `IPTVNATOR_PERF_CAPTURE=1`:

- `journey-renderer-gate.cjs` is loaded into the main process with `-r`, the
  mechanism Playwright uses for its own loader. Playwright resolves
  `electron.launch()` while the app is already creating its window, and
  Electron reports no page until a navigation commits, so an init script
  registered afterwards would race the first document. The gate makes the
  first `loadFile` navigate to `about:blank` and holds the real load until
  the test releases it. A 15 s safety timeout releases it on its own and the
  iteration is then invalid. Electron emits `ready-to-show` for the first
  paint of a hidden window, and `about:blank` paints too, so the gate drops
  that event while the window shows `about:blank`; otherwise the app would
  show a blank window and freeze its `ready-to-show` counter before its own
  document exists. Electron emits the event again for the real document's
  first paint because the window is still hidden, which is the moment
  production sees. The gate also keeps the listener the app registers with
  `ipcMain.handle('performance:read-counters')`, so the test can call it from
  the main process.
- `journey-renderer-probe.ts` is registered with `addInitScript` on that
  `about:blank` page, so it runs at the start of the real document. It
  records that it ran while the document was still `loading` with zero
  scripts and emits one JSON blob under `window.__iptvnatorJourneyProbe`,
  complete once the [settle window](#settle-window) has closed.
- `journey-main-ipc-capture.ts` subscribes to the preload's renderer-API trace
  channel (`IPTVNATOR_DEBUG_TRACE_EVENT`, enabled with
  `IPTVNATOR_TRACE_IPC=1`) through `electronApp.evaluate`, also before the
  release. The record refuses an iteration whose gate timed out, saw a second
  load, or released before the probe was in place.

### Counters

| Counter                            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.ipcCallsToFirstCard`     | `start` trace events the preload emits for every bridge invocation (listener registrations `on*`/`remove*` excluded, as in `wrapElectronApi`). The renderer probe fires one sentinel `cancelSourceProbe('__iptvnator-journey-sentinel__')` at the terminal moment; renderer-to-main IPC is ordered, so events before the sentinel are the exact count. The preload traces the call before forwarding it, and `SOURCE_HEALTH_CANCEL` only looks the id up in an in-memory map, so the sentinel never reaches the database worker.                      |
| `renderer.ipcSerialDepthToFirstCard` | Length of the longest chain of bridge calls before the sentinel in which each call started after the previous one completed. Derived from the same trace channel; see [Serial IPC depth](#serial-ipc-depth). |
| `renderer.domMutationsToFirstCard` | `MutationRecord`s (not callback batches) from a `MutationObserver` on the document element with `childList`, `attributes`, `characterData` and `subtree`. When the init script runs before `<html>` exists the observer watches `document`, which the blob reports in `capabilities.observedTarget`.                                                                                                                                                                                                                                                  |
| `renderer.layoutShiftScore`        | Sum of `layout-shift` entries with `hadRecentInput === false`, rounded to three decimals (a shift of 0.0001 flips in and out of the cutoff between runs; the CLS "good" threshold is 0.1, so three decimals keep the counter exact without hiding anything a user could see). The cutoff is sampled in a timer queued from the first `requestAnimationFrame` after the terminal batch, that is after the frame that paints the card has been committed; entries delivered live after the terminal batch are buffered and filtered by the same cutoff. |
| `renderer.layoutShiftScoreSettled` | The same filter from navigation start until the settle point after the first card (see [Settle window](#settle-window)), rounded to three decimals. It catches shifts that land after the cutoff, such as skeletons that collapse once their data resolves.                                                                                                                                                                                                                                                                                           |
| `renderer.longTasks`               | `longtask` entries over 50 ms up to that same cutoff, which includes the task that rendered the card. The count depends on machine speed, so it is evidence until a run shows it is stable on the CI runner.                                                                                                                                                                                                                                                                                                                                          |
| `renderer.cdTicksToFirstCard`      | `ApplicationRef` ticks from document start until the terminal batch, read from the `electron-performance` build's tick counter (see [Change-detection ticks](#change-detection-ticks)). The tick that rendered the card runs before the observer's microtask, so it is included.                                                                                                                                                                                                                         |
| `renderer.cdTicksIdle30s`          | Ticks during the 30 s [idle window](#idle-window) that opens at the settle point, with nothing touching the page. The baseline for plan item C6 (zoneless change detection).                                                                                                                                                                                                                                                                                                                          |

#### Settle window

`renderer.layoutShiftScore` stops at the first-card cutoff, one frame after
the terminal batch. A shift that lands later is invisible to it: in #1738,
rail skeletons of rails that resolved empty collapsed about 15 ms after the
first card and pulled the rails below upwards, a shift of about 0.23 on every
relaunch with sources that the counter read as 0.
`renderer.layoutShiftScoreSettled` sums the same entries until the page has
settled. The first-card counter is unchanged, so its baselines and history
stay comparable.

The settle window opens at the first-card cutoff. A second
`MutationObserver` watches `main.workspace-content`, the workspace shell's
content pane (the document element if it is missing, reported in
`evidence.settle.observedTarget`). The window closes when nothing in that
subtree has mutated for 500 ms, or 3 s after the cutoff, whichever comes
first. The settle point is the deadline the firing timer was scheduled for
(the last mutation plus 500 ms, or the cutoff plus 3 s), or the moment it
ran if that is earlier, so a timer delayed by a busy main thread does not
let later shifts in. Every entry that starts at or before the settle point
counts, including entries still queued in the observer. Why this point:

- A DOM change in the content pane is what causes the shifts this counter
  is after (data resolving, skeletons swapped for content), so quiet in that
  subtree is a condition the page reaches, not a guess at a delay. The rail
  and header stay outside the watched subtree, so their own updates neither
  keep the window open nor hide a shift in the content, which still counts
  wherever it happens.
- 500 ms is many frames and well above the round trips to the local mock,
  so startup data that is already on its way lands inside the window. On the
  J1 profile the content pane goes quiet within about 110 ms of the first
  card, so the window closes about 520-610 ms after it.
- The 3 s cap bounds each iteration when something keeps mutating (an
  animation, a ticking label). A capped window can end in the middle of that
  activity, so `evidence.settle.reason` (`quiet` or `cap`) is recorded for
  every iteration, together with `firstCardToSettledMs` and the mutation
  records seen (`domMutations`). Iterations that close for different reasons
  point at a settle point that is not deterministic; compare them before
  trusting `stable`.

Entries with `hadRecentInput === true` are excluded, as for the first-card
counter; J1 has no input. The probe keeps its layout-shift observer open
only for this window: `final` still marks the first-card counters as
frozen, `settle.status` moves from `pending` to `quiet` or `cap`, and the
test waits for both. The record refuses an iteration whose window never
closed or closed before the cutoff. J2's probe has no settle window
(`settle.status` is `disabled`) and its counters are unchanged.

`evidence.settle.lateShifts` lists the counted shifts after the cutoff (at
most 20): the time after the first card, the value and, for each source the
browser attributes the shift to, the node (`tag.class[data-test-id]`; a
component host such as `lib-dashboard-rail` takes its first child's test id)
and its vertical move. A late shift can therefore be traced to its component
from the summary alone.

First local measurement (macOS, 2026-09-29, `master` with #1738): all
windows closed on `quiet`, `renderer.layoutShiftScore` stayed 0, and
`renderer.layoutShiftScoreSettled` was 0.236 in 14 of 15 measured
iterations over three runs (`stable: false` in the first run with one 0,
stable in the other two). Every iteration shows the same two shifts of 0.118:
about 12 ms after the first card the `dashboard-recent-sources-rail`, which
holds the first card, moves up by 316 px, and 12-65 ms later it moves back
down. Something 316 px tall above it is removed and inserted again during
startup, a flicker #1738 did not cover.

On the Linux CI runner (`Performance journeys` job of #1756, run
36618062068) the same flicker is a race: the measured iterations read
`[0, 0, 0.235, 0, 0]` (`stable: false`, every window `quiet` about 540 ms
after the first card), and the one hit shows the same two 316 px moves of
the recent-sources rail.

The 316 px element was the dashboard hero. The J1 profile has no history
and no favorites; its only slide is an Xtream recently-added title, and that
query waits for the favorites. The hero dropped its skeleton as soon as the
history resolved empty and came back with that slide moments later. It now
keeps the skeleton until every source that can feature a title has loaded,
including a live candidate's first programme answer for at most 2 s
(`DashboardHeroSlidesPresenter.loading`), and
`DashboardDataService.xtreamRecentlyAddedLoading` no longer settles before
the playlist inventory has loaded. After the fix (macOS, 2026-09-30): both
counters were 0 in all 12 iterations of two runs, every window closed on
`quiet` and `lateShifts` was empty.

#### Idle window

After the settle point J1 leaves the dashboard alone for
`JOURNEY_IDLE_WINDOW_MS` (30 s) and counts what it does anyway:
`renderer.cdTicksIdle30s` is the number of change-detection ticks in that
window, and `evidence.idle.domMutations` the mutation records in the whole
document. The [idle work audit](idle-work-audit-2026-09.md) found Eager
components re-rendering on every such tick in a dev build; this counter
measures the ticks in the optimized build, so plan item C6 can show what
zoneless change detection removes; its checklist is the
[zoneless migration](zoneless-migration.md).

The window opens when the settle window closes, so startup data still
landing is not idle work, and it is timed by a renderer `setTimeout`. The
record refuses an iteration whose window opened before the settle point or
more than 100 ms after it (`launch-journey-record-idle-start-late`), or
lasted less than 30 s, or more than 1 s longer
(`launch-journey-record-idle-window-late`). The window opens in the settle
timer's callback while the settle point is that timer's deadline, so a late
callback would leave ticks between the two outside both windows; either late
timer means the page was busy, not idle. Locally the window opened 1-4 ms
after the settle point. `evidence.idle` keeps the measured `durationMs` and
`settledToIdleStartMs`. The main-process counters and the IPC capture are
read after the window, which does not move them: they are frozen earlier.
J2's launches skip the window (`runLaunchJourney` with `idleWindowMs: null`),
so its click does not wait 30 s; a record without a finished window is
refused as a J1 measurement.

#### Change-detection ticks

`window.ng` and Angular's profiler hook (`ɵsetProfiler`) exist only in dev
mode, and the `electron-performance` build is optimized like production. So
that build alone installs its own counter: its `fileReplacements` entry
swaps `apps/web/src/environments/environment.ts` for
`environment.performance.ts`, which re-exports the production `AppConfig`
and calls `installChangeDetectionTickCounter()` from
`change-detection-tick-counter.ts` while `main.js` is evaluated, before
Angular bootstraps. The counter wraps the internal `ApplicationRef._tick`,
the method every tick runs through: the zone scheduler's `onMicrotaskEmpty`,
the zoneless scheduler, `afterNextRender` idle buckets and the public
`ApplicationRef.tick()` all call it, and it is where Angular emits the
profiler's `ChangeDetectionStart`. The count therefore equals the profiler's
tick count and stays comparable across the zoneless migration. The running
total is `window.__iptvnatorCdTicks.count`; the probe subtracts it at the
journey's boundaries (zero at document start for J1, the value in the
capture-phase click listener for J2). If a future Angular renames `_tick`,
the performance build throws at startup instead of reporting zero.

This is a fileReplacements swap rather than an environment flag checked in
`app.config.ts` on purpose: a flag, even one the optimizer folds, would put
an import and a branch into the production sources, while the swap leaves
every file the production and PWA builds compile unchanged. Their output is
byte-identical with and without the counter (every emitted file hashes the
same apart from the `ngsw.json` build timestamp), so
`renderer.initialBytes` cannot move. A build-config test fails if another
configuration references `environment.performance.ts`. The other benchmarks
built from `electron-performance` (M3U import, Xtream, cancellation) carry
the counter too; it adds one increment per tick.

A build without the counter reports
`capabilities.changeDetectionTicks: "unavailable-counter-missing"` and the
record refuses the iteration, so a zero is never a missing hook.

First local measurement (macOS, 2026-09-30, three `perf:journeys` runs,
18 iterations per journey including warm-ups):

| Counter                       | Run 1 | Run 2 | Run 3 |
| ----------------------------- | ----- | ----- | ----- |
| `renderer.cdTicksToFirstCard` | 20    | 20    | 21    |
| `renderer.cdTicksIdle30s`     | 3     | 3     | 3     |
| `renderer.cdTicksToFirstPage` | 22    | 22    | 22    |

Every run marked all three `stable: true`. `renderer.cdTicksIdle30s` and
`renderer.cdTicksToFirstPage` were identical in all 18 iterations, and every
idle window saw 90 mutation records. `renderer.cdTicksToFirstCard` read 20
in 13 iterations and 21 in the five measured iterations of the third run
(its warm-up read 20), with every other J1 counter unchanged
(`renderer.ipcCallsToFirstCard` 14, `renderer.domMutationsToFirstCard` 554).
With zone.js a tick follows every macrotask that ran in the Angular zone, so
two startup callbacks that land in one task on one launch and in two tasks
on another differ by one tick without any different work. Treat a one-tick
difference in J1 as that race, and confirm on the CI runner that the counter
is deterministic before it becomes a baseline.

#### Main-process counters

With `IPTVNATOR_PERF_CAPTURE=1`, which the journey sets,
`apps/electron-backend/src/app/services/debug-trace.ts` keeps named counters
in the main process (`services/performance-counters.ts`) and `main.ts`
registers the `performance:read-counters` IPC handler. Without the flag
nothing is counted, no listener is attached and the handler does not exist;
the preload never exposes the channel. SQL statements are counted only with
`IPTVNATOR_PERF_COUNT_SQL=1` as well, because the hook wraps every statement
execution: the launch journey sets both (the flags are built in
`journey-launch-environment.ts`), while J2's launches and the M3U, refresh
and Xtream benchmarks do not set the SQL flag and keep measuring unwrapped
statements. A harness test fails if any other source sets the SQL flag. After the renderer probe completes,
`journey-main-counters.ts` calls the handler through `electronApp.evaluate`
and the gate's tap.

| Counter                               | Source                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.modulesRegisteredBeforeWindow`  | `main.startupPhases`, one per `traceStartupPhase` call (the phases printed as `[startup]` trace lines), frozen right after the first main window is constructed.                                                                                                                         |
| `main.sqlStatementsBeforeReadyToShow` | `main.sqlStatements`, frozen at the first main window's `ready-to-show`. It counts the statements of the main-thread connection (`sql-main`, schema creation and migrations) and of the database worker, which posts its count over its message port ([DB worker](sqlite-db-worker.md)). |

Main-thread statements are counted synchronously. The worker flushes its
count before every other message it posts, so every worker statement whose
response the main process has handled is included. The worker count is
ordered against the worker's responses, not against wall-clock: statements
whose count is still in flight when `ready-to-show` is dispatched are not.
One call of `run`, `get`, `all`, `iterate` or `exec` that returns normally is
one statement; on the launch workloads this matches the number of SQL trace
lines exactly. An `exec` with several statements would count as one, so the
shared connection passes one statement per call, and its historical-upgrade
test fails on a batch.

`main.sqlStatementsBeforeReadyToShow` is not yet deterministic. The main
thread runs the shared connection's schema creation and migrations (about 90
statements on the J1 profile) in one synchronous block after the load event,
and `ready-to-show` is dispatched after it. The stale-download and
stale-recording recovery that follows (one statement each) races the event,
so iterations differ by two and the summary marks the counter
`stable: false`. The database worker runs no statement before the first
paint.
Each frozen counter carries its epoch. The record refuses an iteration whose
window counter was frozen after the gate saw the first load, or whose
`ready-to-show` counter was frozen before the gate released the real
document. Running totals at read time are kept under
`evidence.mainCountersAtRead`, the freeze epochs under
`evidence.epochs.mainWindowCreated` and `evidence.epochs.mainReadyToShow`, and
the number of dropped blank `ready-to-show` events under
`evidence.rendererGateReadyToShowHeldOnBlank`.

Counters are exact: the summary carries the value shared by every measured
iteration. When iterations disagree, the summary reports the maximum and marks
the counter `stable: false` under `counterStability`; such a counter is not
promoted to a guardrail until it is deterministic.

No J1 counter from the plan is listed under `unavailable` any more; the
list stays in the record so a future gap is reported instead of faked.

#### Serial IPC depth

`renderer.ipcCallsToFirstCard` counts calls, but calls issued in parallel
cost one round trip, and #1716 showed that lowering the count did not move
wall-clock. `renderer.ipcSerialDepthToFirstCard` counts the round trips the
renderer made one after another instead.

The capture records every `start` and every completion (`success` or
`error`) the preload traces, in arrival order, from install until the
sentinel (`timeline` in the capture state). The preload traces a completion
inside the wrapper's `then`, before the caller's own continuation runs, and
renderer-to-main IPC is ordered, so a call the renderer issued because
another call resolved always arrives after that call's completion.
`computeJourneyIpcSerialDepth` (`src/performance/journey-ipc-serial-depth.ts`)
then defines:

- the depth of a call is 1 plus the largest depth of the calls that
  completed before it started (1 when none had);
- the counter is the largest depth of a call that completed before the
  sentinel. A call still in flight at the first card is excluded: the card
  did not wait for it. Every bridge call counts, including a synchronous one,
  as `renderer.ipcCallsToFirstCard` does.

Trace events carry no call id, so when several calls of one method are in
flight the capture cannot tell which one completed. The counter attributes
each completion to the deepest in-flight call of that method (an upper
bound); `evidence.ipcSerialDepth.depthLowerBound` attributes it to the
shallowest. The two differ only when concurrent calls of one method sit at
different depths. A completion with no matching start fails the iteration.

With a start marker (J2) the timeline starts mid-run, so the capture keeps
calls that started outside it (before the marker, and the markers
themselves) apart: their completions are left out. When a method has calls
in flight both inside and outside the timeline, a completion is attributed
outside, which leaves the timeline call in flight (excluded from the depth)
rather than ending it too early; `evidence.ipcTimelineAmbiguousCompletions`
counts these.

Per iteration, `evidence.ipcSerialDepth.chain` names the methods of one
longest chain, first call first (at each step the predecessor is the latest
completion at the largest depth), `inFlightAtEnd` counts the calls excluded
as in flight, and `evidence.ipcTimeline` is the whole ordered timeline
(`+method` start, `-method` completion). The CI job summary prints the chain
of the first measured iteration. The chain is ordering, not proven
causality: a call placed in it may have been triggered by a timer or signal
rather than by its predecessor. [Startup work before the first
card](#startup-work-before-the-first-card) records what the chain is on
`master`.

### Wall-clock

| Entry                             | Derivation                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawnToDidFinishLoadMs.p50/.p90` | `performance.timeOrigin + loadEventEnd` of the navigation entry (the main frame's `load`, which is what `did-finish-load` reports) minus the test-side timestamp taken just before `electron.launch`. |
| `spawnToFirstCardMs.p50/.p90`     | Terminal epoch of the renderer probe minus the same spawn timestamp.                                                                                                                                  |

Percentiles use linear interpolation over the five measured iterations. The
spawn timestamp includes Playwright's own launch overhead and the gate's
`about:blank` detour: Playwright holds `app.whenReady()` until its CDP session
is attached, and the real document loads only after the probes are in place,
so absolute values are larger than a bare launch. They are comparable between runs of the same
harness, which is what the ratchet needs. The main process start
(`Date.now() - process.uptime()`) is recorded per iteration under
`evidence.epochs` for cross-checks.

### Startup work before the first card

`renderer.ipcCallsToFirstCard` counts what the renderer asks of the main
process before the first card.

- `PlaylistsService.getAllPlaylists()` shares its first SQLite read: at
  startup the playlist effect and the XMLTV source reconciliation both read
  the inventory, and the second caller joins the first read and receives a
  `structuredClone` of its result. Sharing ends when that read settles or a
  `PlaylistsService` write starts. It is limited to startup on purpose:
  other services write playlists too (the settings reset deletes them
  through `DatabaseService`), and while the startup screen is up no such
  action can run. `dbGetAppPlaylistMetas` before the first card: 2 → 1.
- `reconcileEpgSources` stays before the first card on purpose: its
  completion bumps `EpgSourceSettingsService.revision()`, the fence that
  keeps XMLTV lookups from returning data of a removed source.

- The main thread must stay free between the load and the first card. The
  renderer's first database read creates the database worker, and every
  request waits until the main process has handled the worker's `ready`
  message. Until #1784 the login-shell PATH lookup (`fix-path`) ran right
  after `bootstrap-events:done` and spawned `$SHELL -ilc env` synchronously:
  on a Mac with a typical zsh profile it held the main thread for about
  1-2 s, the first `dbGetAppState` resolved about 2.3 s after spawn, and
  everything after it (about 20 ms of IPC) waited. It now runs the shell
  asynchronously (`startup/login-shell-path.ts`). On Linux runners bash
  starts in tens of milliseconds, so the effect there is small.

Validation (#1716, Principle 3): deferring the download list, update status
and dashboard recent/favorites reads until after the first render took the
counter from 12 to 7 on a Mac, but moved neither `spawnToFirstCardMs` nor
load→card beyond run-to-run drift on a quiet machine, and it grew
`renderer.initialBytes`, so it was dropped. Those calls were never on the
path the first card waits for. That path is a serial chain of round trips
(the migration reads, the inventory read and `reconcileEpgSources`), so a
serial-depth counter is a better guardrail candidate than a raw call count.

`renderer.ipcSerialDepthToFirstCard` is that counter. First measurement
(macOS, 2026-09-30, `master` at 525ca7bc4, six launches): 6 in every
iteration, upper and lower bound equal, with the same chain each time:

```
dbGetAppState → dbRecoverLegacyPlaylists → dbGetAppState
  → dbGetAppPlaylistMetas → reconcileEpgSources → setParentalLockState
```

The first level is three parallel `dbGetAppState` reads (with
`announcePlaylistOpenListener` and `getAppUpdateStatus`); the four calls
started after `setParentalLockState` resolved (`downloadsGetList`,
`dbGetRecentlyViewed`, `dbGetAllGlobalFavorites`, `xtreamRequest`) are
still in flight at the first card and excluded.

The chain is ordering, and its last link shows the limit of that: nothing
on the card's path awaits `setParentalLockState`. The parental lock
service fires it (without awaiting) once `SettingsStore.loadSettings()`
has resolved, which happens only after `reconcileEpgSources`, and it
completes before the card in every measured launch. The links the card
waits for are the first five: the route resolver
(`settingsReadyResolver`) and the startup overlay (`allPlaylistsLoaded`,
set by the `loadPlaylists$` effect) both wait for `loadSettings()`, which
waits for the playlist migrations, the inventory read and
`reconcileEpgSources`. No baseline yet: the counter is promoted only after a
PR that lowers it also lowers `spawnToFirstCardMs` (Principle 3).

### Summary schema

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-26T11:02:14.318Z",
  "harness": {
    "platform": "darwin",
    "electron": "43.3.0",
    "measuredIterations": 5,
    "runId": "0b6f7f1e-…",
    "warmupIterations": 1
  },
  "journeys": {
    "launch": {
      "counters": {
        "renderer.cdTicksIdle30s": 3,
        "renderer.cdTicksToFirstCard": 20,
        "renderer.ipcCallsToFirstCard": 12,
        "renderer.layoutShiftScoreSettled": 0.236
      },
      "counterStability": {
        "renderer.ipcCallsToFirstCard": {
          "stable": true,
          "values": [12, 12, 12, 12, 12]
        },
        "renderer.layoutShiftScoreSettled": {
          "stable": true,
          "values": [0.236, 0.236, 0.236, 0.236, 0.236]
        }
      },
      "wallClock": {
        "spawnToFirstCardMs.p50": 1234.5,
        "spawnToFirstCardMs.p90": 1300.1
      },
      "unavailable": {},
      "iterations": [
        {
          "index": 0,
          "warmup": true,
          "pid": 1,
          "counters": {},
          "wallClock": {},
          "evidence": {
            "settle": {
              "domMutations": 458,
              "firstCardToSettledMs": 536.6,
              "lateShifts": [
                {
                  "afterFirstCardMs": 12.4,
                  "sources": [
                    {
                      "deltaHeight": 0,
                      "deltaY": -316,
                      "node": "lib-dashboard-rail[data-test-id=\"dashboard-recent-sources-rail\"]"
                    }
                  ],
                  "value": 0.118
                }
              ],
              "observedTarget": "root",
              "reason": "quiet"
            }
          }
        }
      ]
    }
  }
}
```

`journeys.<id>.counters.<name>` and `journeys.<id>.wallClock.<name>` are plain
numbers so `tools/performance/check-journey-ratchet.mjs` can compare them with
`tools/performance/journey-baselines.json`. The summary writer checks only
that every measured iteration reports the same counter names with finite
values, so a new counter needs no schema change. A J1 runtime baseline is added
once its counter is deterministic on the CI runner; the launch counters are
not yet (see [Ratchet](#ratchet)), so the summary is evidence only.

J3 adds the `journeys.playback` entry with the same shape and no schema
version change: `counters` and `wallClock` hold only plain numbers, and its
iterations carry `evidence.media` (the video element at `playing`) and
`evidence.epochs.loadedMetadata` / `.playing`. The renderer probe blob gained
a `media` field (`null` for J1 and J2), which the probe's
`schemaVersion` 1 readers ignore.

## J2 `open-source`: open a source to a browsable list

`open-source.journey.ts` reuses the J1 profile and process pattern: the
profile is seeded once through the "Add playlist" dialogs, and every
iteration copies it and spawns a fresh process through `runLaunchJourney`,
which measures J1 as usual (gate, probe, IPC capture) and then hands the
running app to `measureOpenSourceJourney` in
`src/journeys/open-source-journey-app.ts`. The click therefore happens after
J1's terminal condition and its counters are final, and after J1's settle
window has closed, so the two journeys never overlap. One warm-up and five measured iterations, as for J1; the J1 numbers
of these launches are not reported again. J2 does not read J1's
main-process counters, so its launches run without `IPTVNATOR_PERF_CAPTURE`
and `IPTVNATOR_PERF_COUNT_SQL` (`runLaunchJourney` with
`mainCounters: false`). The click is not measured under the SQL hook that
wraps every statement.

**Start.** The click on the dashboard card of the Xtream portal
(`dashboard-recent-sources-rail-card` with the portal's name; the probe also
accepts an `app-playlist-item` row on `/workspace/sources`). Before the
click the test hovers the card and waits until the app has been quiet for
1 s: no DOM mutation, no new bridge call, no new request to the mock, and
neither a bridge call nor a mock request still in flight (30 s timeout, which
fails the iteration). Bridge calls in flight come from J1's IPC capture: it
was installed before the document loaded, and the preload follows every
traced `start` with exactly one `success` or `error`, so a call that is still
pending cannot resolve after the click and have its DOM changes or follow-up
calls counted as J2. After settling, J1's capture is detached
(`detachJourneyMainIpcCapture`), so its listener does not run for every
bridge call of the measured click. The settle is a snapshot, and Playwright's
actionability checks run between it and the click. The probe and the IPC
capture keep counting pre-click activity until the click event itself, and
the ledger splits at the click stamp. So the record rejects an iteration
whose DOM mutations, bridge calls or mock requests moved after the snapshot
(`open-source-journey-record-activity-before-click-*`). The settle wait and what happened during
it are kept under `evidence.settle`. The renderer probe is armed in the
loaded document with `page.evaluate` (the same self-contained script as J1,
with `startClick` set). It registers a capture-phase `click` listener on
`window`, which runs before every listener of the app. On the first click
inside the start selector it stamps the start at the event's timestamp (or
the listener's time if that is earlier) and sends the start sentinel
`cancelSourceProbe('__iptvnator-journey-open-source-start__')`, the same
no-op marker as J1's. Only then do
the counters start.

**End.** The first `MutationObserver` batch after the start in which the
path contains `/workspace/xtreams/`, an item of the first page is visible
(`app-grid-list mat-card, .content-card, [data-test-id="channel-item"]`;
skeleton cards do not match) and a category of the context panel is visible
(`app-workspace-context-panel .category-item`). The probe then sends the end
sentinel `cancelSourceProbe('__iptvnator-journey-open-source-end__')` and closes
the observers at the same post-paint cutoff as J1. A portal card opens the
source's default section, which is VOD (`getPlaylistLink` links to
`/workspace/xtreams/<id>/vod`): the category list is the movie category list
and the first page is the "All items" grid. The plan's "live category list"
would need a second click and is not measured; the landed section is
recorded under `evidence.firstPage.section`.

**HTTP requests to the mock.** The J2 profile is seeded with the origin of a
loopback proxy in the test process
(`src/performance/journey-mock-request-ledger.ts`) that forwards to the mock
and records every request, so requests from the main process (Xtream API,
M3U) and from the renderer (artwork served by the mock) are all counted. The
default fixture's posters point at `picsum.photos`, so they are neither
counted nor blocked: they load after the first page is painted, and on an
offline runner they fail instead. Blocking them with `page.route` would put
request interception on every renderer request, including the lazy chunks
the journey loads. The mock's own
`/__control/state` ledger is not used: it exists only in performance-control
mode, which disables `/playlist.m3u` and tracks only the 100k scenario, and a
Playwright request listener would see renderer traffic only. The ledger stores
the method, the path and, for `player_api.php`, the `action` parameter; query
strings and stream paths carry credentials and are never stored.

### Counters

| Counter                            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.ipcCallsToFirstPage`     | Bridge `start` trace events between the start and end sentinels, counted by a second `journey-main-ipc-capture.ts` instance installed with `startSentinelId`. Calls before the start marker are tallied separately (`callsBeforeStart`); a start marker that is missing, repeated or received after the end sentinel fails the iteration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `renderer.domMutationsToFirstPage` | `MutationRecord`s from the click until the terminal batch. Records produced before the click (hover, settling) are taken from the observer at the start and counted under `evidence.settle` instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `renderer.cdTicksToFirstPage`      | `ApplicationRef` ticks from the click until the terminal batch: the counter's running total read in the capture-phase click listener, before the app handles the click, subtracted from its value at the terminal batch (see [Change-detection ticks](#change-detection-ticks)). |
| `renderer.layoutShiftScore`        | Sum of all `layout-shift` entries from the click until the post-paint cutoff, rounded to three decimals. Unlike J1 it includes entries with `hadRecentInput === true`: the journey is a response to the click and runs inside the 500 ms input window, so the CLS filter would always read 0. The split is under `evidence.layoutShift`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderer.longTasks`               | `longtask` entries over 50 ms whose time range overlaps the window from the click to the cutoff. The task that dispatches the click began before the event's timestamp and still counts; buffered J1 tasks that ended before the click are dropped. Evidence until it is shown to be stable on the CI runner, as for J1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `main.mockHttpRequestsToSettled`   | Requests the proxy received from the click until, after the terminal batch, no new request had arrived for 1 s and none was in flight (a response slower than that, and what it triggers, stays inside the window). The window ends at the ledger position read by that accepted quiet sample; a request arriving after it was never seen in flight, so it goes to `evidence.httpRequestsAfterSettledByRoute` instead of the counter. The ledger is read 1 s after that sample, so that late traffic is actually observed. The window starts at the renderer's click stamp, the same boundary as every other J2 counter, not when Playwright began its actionability checks; the proxy stamps requests with the test process's wall clock, and both processes read the same host clock. Bounding by the terminal would compare the test process's clock with the renderer's, so the count up to the terminal epoch is evidence only (`evidence.httpRequestsToFirstPage`); `evidence.httpRequestsByRoute` names the requests. |

One counter is listed under `unavailable`.
`main.sqlStatementsToFirstPage` is missing because the running
`main.sqlStatements` total that J1 freezes at `ready-to-show` can only be
read from the test process through the journey gate. It therefore cannot be
sampled at the click or at the first-page batch, and the worker's count is
ordered against its responses, not against the renderer. Reading it after
the app has settled before the click and again after the first page would
give a click-to-settled count; that is left to a follow-up.

### Wall-clock

| Entry                              | Derivation                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clickToFirstPageMs.p50/.p90`      | Terminal epoch minus start epoch: the click until the batch that made the category list and first page visible, the same boundary J1's `spawnToFirstCardMs` uses.                                                              |
| `clickToFirstPagePaintMs.p50/.p90` | Post-paint cutoff minus start epoch: the click until the frame that paints the first page has been committed (the timer queued from the next `requestAnimationFrame`). This is the "painted" figure of the journey definition. |

All epochs are taken in the renderer, so neither entry crosses a process clock.

## J3 `playback`: start playback to the first frame

`playback.journey.ts` follows J2: the profile is seeded once through the
"Add playlist" dialogs (`seedLaunchJourneyProfile` with
`PLAYBACK_JOURNEY_SEED`), every iteration copies it, spawns a fresh process
through `runLaunchJourney` without main-process counters, and hands the
running app to `measurePlaybackJourney` in
`src/journeys/playback-journey-app.ts`. One warm-up and five measured
iterations.

**Profile.** J2's M3U source plus an Xtream portal ("Journey live portal") on
the mock's `live-fallback:live-fallback` account, behind the same request
ledger proxy. Seeding also selects **Settings > Playback > Video player >
HTML5 video player** and **Stream format > ts** through the settings page
(`configureLiveFormat`), so live URLs end in `.ts`. Embedded MPV and external
players are out of scope.

**Stream.** `/live/live-fallback/live-fallback/10000.ts` returns
`apps/xtream-mock-server/src/fixtures/live.mpegts` from disk: six seconds of
160x90 H.264 baseline video and AAC audio in MPEG-TS, about 300 KB. The HTML5
player plays `.ts` through mpegts.js, which transmuxes to fragmented MP4 for
Media Source Extensions; H.264 and AAC are among the codecs Electron's
Chromium decodes on every platform, including the Linux runner, and the
Electron E2E for the live-format fallback already plays this fixture there.
Two other choices were rejected: the `marketing` and `marketing2` accounts
serve live URLs from local bytes, but those bytes are zero-filled (a fixture
for download screenshots, not media), so no player ever fires `playing`; every
other account redirects streams to a public HLS test stream. The record
fails an iteration whose click-to-`playing` window has no `.ts` request for
a live stream, so a player that played something else is never measured.

**No request leaves the machine.** The generated live catalog's channel and
category logos point at `picsum.photos`. Before navigating, the journey
registers `session.defaultSession.webRequest.onBeforeRequest` for
`*://picsum.photos/*` from the test side and cancels those requests (the app
registers no `onBeforeRequest` listener of its own, so none is replaced). A
logo therefore never loads, or fails, at a moment that depends on the
runner's network; the number cancelled is kept as
`evidence.externalArtworkCancelled`. Every other request goes to the mock
through the ledger.

**Start.** After J1 has ended, the test clicks the portal's dashboard card,
the **Live TV** link and the first category (not measured), then installs the
IPC capture with a start sentinel, arms the probe, hovers the first
`app-live-stream-layout [data-test-id="channel-item"]` and waits for the same
1 s quiet as J2 (`src/performance/journey-click-settle.ts`, shared with J2).
J1's capture is detached and the channel is clicked. The probe's capture-phase
`click` listener stamps the start and sends
`cancelSourceProbe('__iptvnator-journey-playback-start__')`. The record
rejects activity between the settle snapshot and the click exactly as J2
does.

**End.** The probe runs with `media: { endEvent: 'playing', phaseEvents:
['loadedmetadata'] }`. Media events do not bubble, but a capture-phase
listener on `window` sees them before any listener of the app. The first
`playing` event after the start on an element matching
`app-web-player-view video` ends the journey: pending mutation records are
taken synchronously, the end sentinel
`cancelSourceProbe('__iptvnator-journey-playback-end__')` is sent, and the
element's state is recorded (`evidence.media`: `readyState`, `paused`,
`currentTime`, intrinsic size, and `currentSrcScheme`, which is `blob` for
Media Source playback). The first `loadedmetadata` on such an element after
the start is recorded as a phase. A visible video element does not end the
journey, and media events before the click or on other elements are
ignored.

### Counters

| Counter                          | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.ipcCallsToPlaying`     | Bridge `start` trace events between the start and end sentinels, as `renderer.ipcCallsToFirstPage` in J2.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `renderer.httpRequestsToPlaying` | Requests the ledger proxy received from the click stamp until the `playing` stamp, from either process (the stream request comes from the renderer, Xtream API calls from the main process). Both stamps are `performance.timeOrigin + performance.now()` of processes on the same host clock, as in J2. Unlike J2's counter the window ends at the terminal, not at a quiet mock: a live stream has no quiet end. Later requests are kept as `evidence.httpRequestsAfterPlayingByRoute`, the ones in the window as `evidence.httpRequestsByRoute`. |
| `renderer.domMutationsToPlaying` | `MutationRecord`s from the click until the `playing` event, including records still queued when it fires.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `renderer.cdTicksToPlaying`      | `ApplicationRef` ticks from the click until the `playing` event, read like `renderer.cdTicksToFirstPage` in J2 (see [Change-detection ticks](#change-detection-ticks)). Not yet measured on a run; the counter shipped after J3's first measurements. |
| `renderer.layoutShiftScore`      | All `layout-shift` entries from the click until the `playing` event, including `hadRecentInput` ones (as J2), rounded to three decimals. Entries delivered up to the post-paint cutoff are read, but only those that started by the event count.                                                                                                                                                                                                                                                                                                    |
| `renderer.longTasks`             | `longtask` entries over 50 ms whose time range overlaps the window from the click to the `playing` event, so the task that dispatched the event counts. Evidence until shown to be stable on the runner.                                                                                                                                                                                                                                                                                                                                            |

`renderer.httpRequestsToPlaying` compares the ledger's arrival stamps
(test process) with the renderer's click and `playing` stamps. Both are
`performance.timeOrigin + performance.now()` on the same host clock, but the
two processes' time origins can differ by a fraction of a millisecond, so
every iteration records `evidence.httpBoundaryMarginsMs`: the distance of
the nearest request on either side of the click and of `playing`. A margin
of a few milliseconds means a clock difference could move that request
across the boundary. Locally the first request after the click arrives 3-6
ms after its stamp (the click causes it, so it cannot precede the click) and
the nearest request to `playing` is more than 170 ms away; both are well
above a sub-millisecond origin difference. `evidence.httpRequestsAfterPlayingByRoute` covers a fixed
window of 1 s after `playing` (the test waits that long before reading the
ledger), not a quiet mock as in J2: a live stream has no quiet end.

One counter is listed under `unavailable`.
`renderer.ipcSerialDepthToPlaying` is missing because the serial-depth
helper (see [Startup work before the first card](#startup-work-before-the-first-card))
was not on `master` when J3 landed; J3 adopts it once the J1 thread adds it.
`main.sqlStatementsToPlaying` is not measured for the same reason as J2's
SQL counter.

### Wall-clock

| Entry                              | Derivation                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `clickToPlayingMs.p50/.p90`        | `playing` epoch minus start epoch.                                                                                      |
| `clickToLoadedMetadataMs.p50/.p90` | First `loadedmetadata` epoch minus start epoch: player setup, the stream request and the first transmuxed init segment. |

The difference of the two is stream start: buffering until the element can
play. All epochs are taken in the renderer.

### First measurement

Local, macOS, 2026-09-30 (two `perf:journeys` runs, five measured iterations
each): every counter identical in all ten, `renderer.ipcCallsToPlaying` 4
(`getEpgMapping`, `xtreamRequest`, `updateRemoteControlStatus`,
`setUserAgent`), `renderer.httpRequestsToPlaying` 2 (the `.ts` stream and
`get_simple_data_table`), `renderer.domMutationsToPlaying` 6,188,
`renderer.layoutShiftScore` 0.001, `renderer.longTasks` 0; P50
click→`loadedmetadata` 92-94 ms and click→`playing` 239-257 ms. The warm-up
iteration of the first run took the cold path (888 ms to `playing`, one more
`updateRemoteControlStatus` call); warm-ups are excluded. About 6,000 of the
mutations come from the EPG timeline rendering about 240 programme blocks
from the `get_simple_data_table` response before the first frame. Whether
that response and its render land before `playing` is a race on a slower
machine, so check the runner's `counterStability` before trusting the
mutation and request counts. No J3 baseline exists yet; J3 counters join the
ratchet once three runner runs agree.

## `renderer.initialBytes`

The bytes a browser fetches before Angular can bootstrap, read from the built
`dist/apps/web/index.html`:

- `index.html` itself,
- every same-origin `<script src>`, including `assets/app-config.js`,
- every `<link rel="stylesheet">`,
- every `<link rel="modulepreload">` chunk.

Manifest, icons, external URLs, commented-out tags and lazy chunks are not
counted, so the value is the same for every language: a non-English launch
additionally fetches that language's Angular locale chunk (about 2 KB), which
belongs to the per-profile J1 benchmark rather than to this counter. A file
that `index.html` references but the build did not emit is an error, never
zero bytes. The value is raw (uncompressed) size, which is what the renderer
parses. It is Angular's "Initial total" plus `index.html` and
`assets/app-config.js` (about 4 KB together), so it sits slightly above the
rounded figure the build prints; never copy that figure into a baseline, use
the script's output. The bundle embeds only the app version from
`package.json` (a named import, which esbuild tree-shakes), not the whole
file, so editing scripts or dependencies does not move the counter.

```bash
pnpm nx build web                                # production configuration
pnpm run perf:initial-bytes                      # human-readable breakdown
pnpm --silent run perf:initial-bytes -- --json   # machine-readable; --silent keeps pnpm's headers out of stdout
node tools/performance/measure-initial-bytes.mjs --summary dist/performance/journey-summary.json
```

`--summary` writes the journey summary shape (`journeys.<journey>.counters`)
that the ratchet checker consumes. `--dist <dir>` points the script at another
build output, for example the `electron-performance` configuration.

The measurement script is `tools/performance/measure-initial-bytes.mjs`; its
Node tests run with `pnpm nx test performance-tools` (Tier B in the coverage
policy) and lint with `pnpm nx lint performance-tools`.

## Ratchet

`tools/performance/journey-baselines.json` holds one entry per journey and
counter:

```json
{
  "journeys": {
    "launch": {
      "renderer.initialBytes": {
        "value": 2739510,
        "unit": "bytes",
        "slack": 4096,
        "updatedAt": "2026-09-26",
        "evidencePr": 1693,
        "measuredWith": "pnpm nx build web && pnpm run perf:initial-bytes"
      }
    }
  }
}
```

`tools/performance/check-journey-ratchet.mjs` compares a journey summary with
that file:

- a counter above `value + slack` fails; counters are exact, and `slack`
  (default 0, in the entry's unit) is the only allowance, printed as "uses N
  of S slack" whenever a measurement is above `value`;
- a wall-clock entry carries `toleranceRatio` and fails above
  `value × toleranceRatio`;
- a baseline with no measurement in the summary fails, so dropping a
  measurement cannot disable the ratchet; a counter is read only from
  `journeys.<journey>.counters` and a wall-clock entry (one with
  `toleranceRatio`) only from `journeys.<journey>.wallClock`, so a value in
  the wrong section also counts as missing;
- a measurement below its baseline passes and prints a "tighten" hint;
- a measured counter without a baseline is noted, not failed;
- checking nothing fails: an empty baselines file, or `--only` naming an
  entry that does not exist, cannot exit 0.

`--only <journey>/<counter>` (repeatable) restricts the check to the named
baselines. A script that measures one counter writes its own summary file
and checks only its counter, so it neither overwrites another measurement's
summary nor fails the other baselines as unmeasured.

```bash
pnpm run perf:initial-bytes:check   # measure dist/apps/web into dist/performance/initial-bytes.summary.json, check only that counter
pnpm run perf:ratchet:check         # check every baseline against dist/performance/journey-summary.json
```

CI runs `perf:initial-bytes:check` in the `Initial bytes ratchet` job of
`.github/workflows/ci.yml` after a production build of `apps/web`, and uploads
`dist/performance/` as the `performance-journey-summary` artifact. Like the
rest of that workflow it runs for pull requests that target `master` and for
pushes to `master`; a stacked PR that targets another branch gets no run until
it is retargeted, so dispatch one with `gh workflow run ci.yml --ref <branch>`
when you need the number. A PR that grows the counter fails that job.

That runner is the canonical measurer: take baseline values from its output,
not from a local build. A local macOS build of the code before #1695 is 2
bytes smaller in `main.js` (the eager locale imports); since #1695 the two
have been byte-identical. (An apparent 556-byte platform difference during
the first measurements was otherwise `package.json` text embedded in
`main.js`, which moved with every script edit; #1692 fixed that by importing
only the version.)

Two effects make the exact counter move for reasons outside a PR's own diff.
A baseline lowered on a branch that predates a concurrent `master` merge can
sit below what the merged code measures: #1712 lowered it on a branch without
#1714, so `master` measured 108 bytes over and every later PR failed the job
until a follow-up moved lazy-only modules out of `main.js`. Re-run the job on
an up-to-date branch before merging a baseline change. And the bundler's
chunk-level identifier renaming shifts when a module enters or leaves
`main.js`: moving one service out once renamed an imported identifier at 162
call sites, eating about 320 of the bytes saved. Judge a small change by the
`--stats-json` input sizes, not only by the counter.

Both effects are why `renderer.initialBytes` carries `"slack": 4096`. With a
zero allowance the +108 above failed every PR for hours on 2026-09-27, and
PRs growing the counter by 243 and 302 bytes, each through one service
change, had no way to pass. The
slack is fixed, not a ratio, and sits on top of `value`, which still only
moves down: growth accumulates at most 4 KiB past the last lowered baseline
before the job fails again, while a regression such as #1601's +35,435 bytes
fails as before. Lower `value` to the measured number as usual; the slack
stays and is not part of the evidence.

The job also refuses a weakened baselines file:
`tools/performance/check-baseline-direction.mjs` compares
`journey-baselines.json` with the revision the change is measured against
(the target branch of a pull request, the previous head of a `master` push,
`master` for a manual dispatch) and fails when any
entry's enforced limit (`value × toleranceRatio` or `value + slack`) went up,
a tolerance or slack widened or an entry disappeared, so a PR cannot grow the
payload and raise the baseline to match. A counter's `value` may not go up
either, even when narrower slack lowers its limit, and switching an entry
between counter and wall-clock (adding or removing `toleranceRatio`) counts
as a weakening too. Lowered limits and new entries pass.

Baselines only move down. Lower `value` in the same PR as the change that
earned it, set `updatedAt` and `evidencePr`, and paste the measurement output
into the PR. Never raise a value to make a PR pass: if growth is a deliberate
trade-off (a framework upgrade, a feature that must be on the initial path),
raise `value` to the runner's measurement in the PR, make the case with the
per-file breakdown, and ask a maintainer to add the `perf-baseline-increase`
label. With the label the direction check prints the weakened entries as
`ALLOWED` and passes; the job reads labels from the API when it runs, so
re-run the job after the label is added. For a `master` push the label is
read from the pull request merged as the pushed commit, and only when the
push added exactly one first-parent commit: a squash or merge of a labelled
PR passes, while a direct push, or a push of several commits (which the check
compares as a whole), that raises a baseline still fails.
Only people with triage access can set labels, so the label is the
maintainer decision.

A PR merged while this job is red makes every later PR fail it with the same
numbers until `master` is fixed: #1601 merged at +35,435 bytes and failed
the job for every PR until #1734. Treat the job as blocking before merging;
making it a required check is a maintainer decision.

The runtime counters come from the `Performance journeys` job of the same
workflow, on `ubuntu-latest` only. Through the
`.github/actions/performance-journeys` composite action it runs
`pnpm run perf:journeys` under
`xvfb-run` (the Nx target builds `electron-backend:build-performance`, the
Playwright config starts the Xtream mock), writes the measurements to the job
summary and uploads `dist/performance/journeys/` as the `performance-journeys`
artifact. The `Performance journeys scope` job skips it only for pull
requests that change nothing but Markdown, `docs/**`, `.plans/**`,
`.codex/**`, `.claude/**`, `.changes/**` or `apps/website/**` (the E2E
workflow's ignore list plus release notes); any other file, including root
build inputs such as `.nvmrc`, `nx.json` or `tsconfig.base.json`, runs it.
Pushes to `master` and manual dispatches always run it. The job is warn-only (`continue-on-error: true`) for its first two
weeks (plan item B3): a regression marks the job failed without failing the
workflow. Making it required is a maintainer decision.

No J1 runtime counter is enforced yet. Three dispatched runs on 2026-09-27
(CI runs 36271875209, 36271879955 and 36271884616) reported the same summary
values, `renderer.ipcCallsToFirstCard` 16 and
`renderer.domMutationsToFirstCard` 939, but the third run marked both
`stable: false`: its warm-up and one measured iteration reached the first
card in about 750 ms with 13 bridge calls and 576 mutations, the others in
about 1,400 ms with 16 and 939. The three extra calls
(`downloadsGetDefaultFolder` and two `dbGetGlobalRecentlyAdded`) land before
or after the first card depending on that race, so neither counter is
promoted until the race is understood and the counters are deterministic.
`renderer.layoutShiftScore` (0) and `renderer.longTasks` (2) were identical
in all eighteen runner iterations; the `spawnToFirstCardMs` P50 ranged from
1,401 to 1,674 ms. All four stay evidence for now. Runner counters also
differ from a Mac (12 and 571 there, the fast path without the Linux-only
`getWindowState` call), so take J1 baseline values from the runner only.
`renderer.layoutShiftScoreSettled` has no baseline either: the runner read
it as `stable: false` because the dashboard hero flicker it reported was a
race there (see [Settle window](#settle-window)). That flicker is fixed; add
the runner's number once runner runs read it as `stable` too.

### Weekly tightening

`.github/workflows/performance-ratchet.yml` lowers baselines without waiting
for someone to act on a "tighten" hint. Every Monday, and on
`workflow_dispatch`, three `ubuntu-latest` jobs measure the same commit
independently: the production `apps/web` build with
`measure-initial-bytes.mjs --summary`, then the journeys through the
`.github/actions/performance-journeys` composite action, which the
`Performance journeys` job above uses too. A failed journey run does not stop
its job; its entries are then unmeasured in that run. A final job runs
`tools/performance/tighten-baselines.mjs` on the three runs:

- an entry is lowered only when every run measured it and every measurement
  is strictly below `value`; the new `value` is the largest of the three (for
  a wall-clock entry the largest per-run summary value, which is the largest
  P50 for a `.p50` entry);
- a counter marked `counterStability.<name>.stable: false` in any run is
  kept, and the report says which run and which iterations disagreed;
- `value` never goes up, `slack` and `toleranceRatio` never change, and no
  entry is added or removed: the result must pass
  `check-baseline-direction.mjs` without `--allow-increase`, which both the
  script and the job check;
- a lowered entry gets `updatedAt`, `measuredWith` and `evidenceRun` (the
  workflow run URL); `evidencePr` is set to the tightening PR once it exists.

When the file changed and the run is on `master`, the job pushes
`automation/performance-ratchet` and opens (or updates) a pull request with
the per-run table, the diff and the run URL, labelled `no-release-note`. It
pushes with the existing `PAT` secret, as the Windows MPV pin refresh does,
because a pull request pushed with `GITHUB_TOKEN` starts no CI. Each run
replaces the branch with one fresh commit, except when the open tightening
pull request carries a commit the workflow did not make (a review edit, an
"Update branch" merge): then it leaves the branch alone with a warning, and
the numbers stay in the job summary. When no
baseline was below its value in all three runs, the workflow ends without a
pull request. A dispatch on another branch measures and prints the diff but
never opens one, so `gh workflow run performance-ratchet.yml --ref <branch>`
validates a change to the workflow once the file is on `master`. GitHub only
dispatches workflows that exist on the default branch, so before the first
merge of a new or renamed workflow add a temporary `push` trigger for the
branch and drop it before review, as #1760 did. Review the pull request like a manual
tightening: if `master` moved since the measured commit, the
`Initial bytes ratchet` job on the pull request is what shows that the new
value still holds (the concurrent-merge effect above).

## Charset parse benchmark

V8 stores a string as two-byte UTF-16 once one character falls outside
Latin-1, and substrings of such a string stay two-byte, even ASCII-only URL
lines. `src/performance/charset-parse.benchmark.ts` checks whether that slows
playlist and EPG parsing. It is a Node benchmark, not a journey, and is not
ratcheted:

```bash
pnpm nx run electron-backend-e2e:benchmark-charset-parse --iterations=5
```

It parses 50,000 M3U channels (`iptv-playlist-parser`, then
`createPlaylistObject`, the main-process `PARSE_M3U` and `NORMALIZE` phases)
and 50,000 XMLTV programmes (`StreamingEpgParser`, the EPG worker's parser).
Each workload runs on three inputs: `latin1` and `cyrillic` from the
synthetic generators (`charset` option of `synthetic-m3u.ts` and
`synthetic-xmltv.ts`, identical layout apart from titles), and `latin1-bom`,
the latin1 bytes behind a UTF-8 byte-order mark. The BOM forces two-byte
storage without changing content, which separates the encoding cost from
the effect that non-ASCII titles have on ASCII-only regexes. The XMLTV
parser receives 64 Ki-character slices of one decoded string rather than
per-chunk decoded buffers: slices keep the input's representation (a
per-chunk decode would make the BOM control one-byte after its first
chunk), and no multi-byte character is split. Before timing, an untimed
pass checks that the parsed titles match the fixture.

The report gives P50 wall-clock and CPU time after one warm-up, plus
CPU-profile sample counts and top self frames from a separate profiled pass.
Inputs alternate within each round and the starting input rotates between
rounds. Prefer CPU time and samples on a busy machine.

The 2026-09-27 measurement (plan item D1) found every workload under the 1.5x
threshold on Node 22 and inside Electron 43, so D2 regex prefilters were not
applied. Rerun the benchmark after changing either parser or when a user
reports slow imports of non-Latin playlists.

## Adding a counter

1. Produce the value from the built output or from a deterministic probe, not
   from source heuristics. Missing inputs must fail the measurement.
2. Emit it under `journeys.<journey>.counters.<name>` in the summary JSON.
3. Cover the extraction and the failure modes with `node --test` and register
   the test file in `tools/performance/project.json`.
4. Validate the counter before it becomes a guardrail: one PR must show that
   lowering it moved wall-clock in the same journey.

## Adding a journey

1. Add `apps/electron-backend-e2e/src/journeys/<journey>.journey.ts`. Seed the
   profile through the app's dialogs, spawn a fresh process per iteration
   with `measureLaunchJourney` as the model, and drive the journey's start
   action with Playwright. A journey that starts inside the running app
   continues from J1 with `runLaunchJourney` and lets the app settle first,
   as `open-source-journey-app.ts` does.
2. Give the journey its own probe options (`cardSelector`,
   `companionSelectors`, `routeFragment`, `startClick` for a click start,
   `media` for a media-event end such as J3's `playing`) or extend
   `journey-renderer-probe.ts` when the end condition is neither. Use a state
   key and sentinel ids of its own. Keep the probe self-contained: Playwright
   serializes it with `toString()`. A click-started journey settles with
   `waitForJourneyClickQuiet` from `journey-click-settle.ts`.
3. Map the measurement to a `JourneyIterationRecord` in a
   `<journey>-journey-record.ts` under `src/performance/`; name counters
   `renderer.*` or `main.*`, and list counters you cannot measure under
   `unavailable` with the reason.
4. Add the journey under `journeys.<id>` in the run's summary with
   `writeJourneyRunEntry` (`src/journeys/journey-run.ts`), which calls
   `summarizeJourneyIterations` and merges the entry; the schema needs no
   change.
5. Cover the probe with jsdom fixtures and the record and summary code with
   `node:test` (`pnpm nx run electron-backend-e2e:test-performance-harness`).
6. Validate a counter before it becomes a guardrail: one PR must show that
   lowering it moved wall-clock in the same journey.

## Idle work

The [idle work audit](idle-work-audit-2026-09.md) records what the app does
while the user does nothing, measured on the dashboard with the window visible
and minimized. Its **own thread** rows are candidate performance threads.
