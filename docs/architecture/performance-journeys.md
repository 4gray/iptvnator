# Performance journeys and the CI ratchet

IPTVnator measures performance through a small set of everyday user journeys.
Each journey has deterministic counters that are asserted exactly, and
wall-clock timings that are recorded as evidence. Counters are ratcheted in CI:
a committed baseline may only be lowered, and only with the measured output as
evidence. This document is the contract for that loop. The journey harness
lives in `apps/electron-backend-e2e/src/journeys` and
`apps/electron-backend-e2e/src/performance/journey-*.ts`; the ratchet scripts
live in `tools/performance/`.

## Journeys

| Journey          | Start                                        | End                                                                           |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| J1 `launch`      | Electron process spawn                       | first playlist or portal card rendered on `/workspace`, inline splash removed |
| J2 `open-source` | click on a portal card                       | live category list and first channel page painted                             |
| J3 `playback`    | click on a channel                           | HTML5 `playing` event                                                         |
| J4 `search`      | six-character query typed into global search | results list settled                                                          |

J1 is instrumented by the launch benchmark below. J2 to J4 follow the plan in
`.plans/` and are added one thread at a time; each thread names its journey
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

Two probes are injected from the test side; production code is not changed:

- `journey-renderer-probe.ts` is registered with `addInitScript` right after
  `electron.launch`, before the window exists, and records that it ran while
  the document was still `loading` with zero scripts. It emits one JSON blob
  under `window.__iptvnatorJourneyProbe`.
- `journey-main-ipc-capture.ts` subscribes to the preload's renderer-API trace
  channel (`IPTVNATOR_DEBUG_TRACE_EVENT`, enabled with
  `IPTVNATOR_TRACE_IPC=1`) through `electronApp.evaluate` and records that it
  was installed before the renderer probe ran.

### Counters

| Counter                            | Source                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.ipcCallsToFirstCard`     | `start` trace events the preload emits for every bridge invocation (listener registrations `on*`/`remove*` excluded, as in `wrapElectronApi`). The renderer probe fires one sentinel `dbGetAppPlaylist('__iptvnator-journey-sentinel__')` at the terminal moment; renderer-to-main IPC is ordered, so events before the sentinel are the exact count. |
| `renderer.domMutationsToFirstCard` | `MutationRecord`s (not callback batches) from a `MutationObserver` on the document element with `childList`, `attributes`, `characterData` and `subtree`. When the init script runs before `<html>` exists the observer watches `document`, which the blob reports in `capabilities.observedTarget`.                                                  |
| `renderer.layoutShiftScore`        | Sum of `layout-shift` entries with `hadRecentInput === false`, rounded to four decimals, up to the first frame painted after the terminal batch.                                                                                                                                                                                                      |
| `renderer.longTasks`               | `longtask` entries over 50 ms up to that same frame. The count depends on machine speed, so it is evidence until a run shows it is stable on the CI runner.                                                                                                                                                                                           |

Counters are exact: the summary carries the value shared by every measured
iteration. When iterations disagree, the summary reports the maximum and marks
the counter `stable: false` under `counterStability`; such a counter is not
promoted to a guardrail until it is deterministic.

Two counters from the plan are listed under `unavailable` with the reason
instead of being faked:

- `renderer.cdTicksToFirstCard`: the `electron-performance` build optimizes
  scripts, which sets `ngDevMode` to false, so Angular does not publish
  `window.ng` and `ɵsetProfiler` is unavailable. The probe checks this at the
  terminal moment and the record refuses a build where the hook exists but was
  not counted.
- `main.sqlStatementsBeforeReadyToShow`: SQL statements are only visible as
  worker-thread trace lines on stdout, which Node forwards asynchronously, so
  they cannot be ordered against `ready-to-show`. Plan item A2 adds a channel
  that can be counted.

### Wall-clock

| Entry                             | Derivation                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawnToDidFinishLoadMs.p50/.p90` | `performance.timeOrigin + loadEventEnd` of the navigation entry (the main frame's `load`, which is what `did-finish-load` reports) minus the test-side timestamp taken just before `electron.launch`. |
| `spawnToFirstCardMs.p50/.p90`     | Terminal epoch of the renderer probe minus the same spawn timestamp.                                                                                                                                  |

Percentiles use linear interpolation over the five measured iterations. The
spawn timestamp includes Playwright's own launch overhead: Playwright holds
`app.whenReady()` until its CDP session is attached, so absolute values are
larger than a bare launch. They are comparable between runs of the same
harness, which is what the ratchet needs. The main process start
(`Date.now() - process.uptime()`) is recorded per iteration under
`evidence.epochs` for cross-checks.

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
`tools/performance/journey-baselines.json`. A J1 baseline is added once the
numbers are stable on the CI runner; until then the summary is evidence only.

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
