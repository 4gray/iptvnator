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
| J2 `open-source` | click on a portal card                       | live category list and first channel page painted                             |
| J3 `playback`    | click on a channel                           | HTML5 `playing` event                                                         |
| J4 `search`      | six-character query typed into global search | results list settled                                                          |

J1 is instrumented today: `renderer.initialBytes` from the built output, and
the runtime counters of the launch benchmark below. J2 to J4 follow the plan
in `.plans/` and are added one thread at a time; each thread names its journey
and counter in the PR description.

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

The file is never overwritten; a second run in the same second fails instead.
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
  scripts and emits one JSON blob under `window.__iptvnatorJourneyProbe`.
- `journey-main-ipc-capture.ts` subscribes to the preload's renderer-API trace
  channel (`IPTVNATOR_DEBUG_TRACE_EVENT`, enabled with
  `IPTVNATOR_TRACE_IPC=1`) through `electronApp.evaluate`, also before the
  release. The record refuses an iteration whose gate timed out, saw a second
  load, or released before the probe was in place.

### Counters

| Counter                            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.ipcCallsToFirstCard`     | `start` trace events the preload emits for every bridge invocation (listener registrations `on*`/`remove*` excluded, as in `wrapElectronApi`). The renderer probe fires one sentinel `dbGetAppPlaylist('__iptvnator-journey-sentinel__')` at the terminal moment; renderer-to-main IPC is ordered, so events before the sentinel are the exact count.                                                                                                                                                                                                 |
| `renderer.domMutationsToFirstCard` | `MutationRecord`s (not callback batches) from a `MutationObserver` on the document element with `childList`, `attributes`, `characterData` and `subtree`. When the init script runs before `<html>` exists the observer watches `document`, which the blob reports in `capabilities.observedTarget`.                                                                                                                                                                                                                                                  |
| `renderer.layoutShiftScore`        | Sum of `layout-shift` entries with `hadRecentInput === false`, rounded to three decimals (a shift of 0.0001 flips in and out of the cutoff between runs; the CLS "good" threshold is 0.1, so three decimals keep the counter exact without hiding anything a user could see). The cutoff is sampled in a timer queued from the first `requestAnimationFrame` after the terminal batch, that is after the frame that paints the card has been committed; entries delivered live after the terminal batch are buffered and filtered by the same cutoff. |
| `renderer.longTasks`               | `longtask` entries over 50 ms up to that same cutoff, which includes the task that rendered the card. The count depends on machine speed, so it is evidence until a run shows it is stable on the CI runner.                                                                                                                                                                                                                                                                                                                                          |

#### Main-process counters

With `IPTVNATOR_PERF_CAPTURE=1`, which the journey sets,
`apps/electron-backend/src/app/services/debug-trace.ts` keeps named counters
in the main process (`services/performance-counters.ts`) and `main.ts`
registers the `performance:read-counters` IPC handler. Without the flag
nothing is counted, no listener is attached and the handler does not exist;
the preload never exposes the channel. SQL statements are counted only with
`IPTVNATOR_PERF_COUNT_SQL=1` as well, because the hook wraps every statement
execution: the journey sets both, while the M3U, refresh and Xtream
benchmarks run with the capture flag alone and keep measuring unwrapped
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

One counter from the plan is listed under `unavailable` with the reason
instead of being faked:

- `renderer.cdTicksToFirstCard`: the `electron-performance` build optimizes
  scripts, which sets `ngDevMode` to false, so Angular does not publish
  `window.ng` and `ɵsetProfiler` is unavailable. The probe checks this at the
  terminal moment and the record refuses a build where the hook exists but was
  not counted.

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

- `PlaylistsService.getAllPlaylists()` shares one in-flight SQLite read
  between concurrent callers (`SharedInFlightRead`): at startup the playlist
  effect and the XMLTV source reconciliation both read the inventory, and the
  second caller joins the first read and receives a copy. A settled read is
  never reused, and every SQLite write detaches the pending read, so a caller
  that follows a write reads again. This took the counter from 12 to 7 in
  the #1716 profile... see the validation note below.
- `reconcileEpgSources` stays before the first card on purpose: its
  completion bumps `EpgSourceSettingsService.revision()`, the fence that
  keeps XMLTV lookups from returning data of a removed source.

Validation (#1716, Principle 3): deferring the download list, update status
and dashboard recent/favorites reads until after the first render lowered
the counter by four more, but moved neither `spawnToFirstCardMs` nor
load→card beyond run-to-run drift on a quiet machine, and it grew
`renderer.initialBytes`, so it was dropped. Those calls were never on the
path the first card waits for. That path is a serial chain of round trips
(the migration reads, the inventory read and `reconcileEpgSources`), so a
serial-depth counter is a better guardrail candidate than a raw call count.

### Summary schema

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-26T11:02:14.318Z",
  "harness": {
    "platform": "darwin",
    "electron": "43.3.0",
    "measuredIterations": 5,
    "warmupIterations": 1
  },
  "journeys": {
    "launch": {
      "counters": { "renderer.ipcCallsToFirstCard": 12 },
      "counterStability": {
        "renderer.ipcCallsToFirstCard": {
          "stable": true,
          "values": [12, 12, 12, 12, 12]
        }
      },
      "wallClock": {
        "spawnToFirstCardMs.p50": 1234.5,
        "spawnToFirstCardMs.p90": 1300.1
      },
      "unavailable": { "renderer.cdTicksToFirstCard": "reason" },
      "iterations": [
        {
          "index": 0,
          "warmup": true,
          "pid": 1,
          "counters": {},
          "wallClock": {},
          "evidence": {}
        }
      ]
    }
  }
}
```

`journeys.<id>.counters.<name>` and `journeys.<id>.wallClock.<name>` are plain
numbers so `tools/performance/check-journey-ratchet.mjs` can compare them with
`tools/performance/journey-baselines.json`. A J1 runtime baseline is added
once its counter is deterministic on the CI runner; the launch counters are
not yet (see [Ratchet](#ratchet)), so the summary is evidence only.

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
workflow, on `ubuntu-latest` only. It runs `pnpm run perf:journeys` under
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
   action with Playwright.
2. Give the journey its own probe options (`cardSelector`, `routeFragment`,
   terminal condition) or extend `journey-renderer-probe.ts` when the end
   condition is not "an element became visible". Keep the probe
   self-contained: Playwright serializes it with `toString()`.
3. Map the measurement to a `JourneyIterationRecord` in a
   `<journey>-journey-record.ts` under `src/performance/`; name counters
   `renderer.*` or `main.*`, and list counters you cannot measure under
   `unavailable` with the reason.
4. Add the journey under `journeys.<id>` in the summary through
   `summarizeJourneyIterations`; the schema needs no change.
5. Cover the probe with jsdom fixtures and the record and summary code with
   `node:test` (`pnpm nx run electron-backend-e2e:test-performance-harness`).
6. Validate a counter before it becomes a guardrail: one PR must show that
   lowering it moved wall-clock in the same journey.

## Idle work

The [idle work audit](idle-work-audit-2026-09.md) records what the app does
while the user does nothing, measured on the dashboard with the window visible
and minimized. Its **own thread** rows are candidate performance threads.
