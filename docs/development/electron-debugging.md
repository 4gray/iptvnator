# Electron debugging and tracing

Use this procedure for Electron/CDP tasks. Read the available `electron` skill
when automating the desktop app. These commands assume a bootstrapped worktree.

## Start and attach

- Start the Electron development app with: `pnpm nx serve electron-backend`
- Package-script equivalent: `pnpm run serve:backend`
- Electron is configured to start with: `--remote-debugging-port=9222`
- Connect Chrome DevTools Protocol tools to: `127.0.0.1:9222`
- For Electron automation/debugging tasks, use the `electron` skill
- Do not auto-open DevTools during normal CDP automation. In development, DevTools is opt-in via `ELECTRON_OPEN_DEVTOOLS=1`.
- If DevTools is open, `agent-browser --cdp 9222 ...` may attach to the DevTools page instead of the IPTVnator window. Symptoms: `tab list` shows `about:blank`, snapshots are empty, and screenshots are black.
- If that happens, inspect targets with `curl http://127.0.0.1:9222/json/list` and connect directly to the IPTVnator page websocket from the `webSocketDebuggerUrl` field.
- The app holds a single-instance lock (`acquireSingleInstanceLock` in `apps/electron-backend/src/app/services/single-instance.ts`): a second launch against the same `userData` quits immediately and focuses the running window. To attach a second CDP-enabled instance to the same profile, set `IPTVNATOR_ALLOW_MULTIPLE_INSTANCES=1` — knowing that only one of the two processes will own the renderer's IndexedDB, so settings written by the other are lost. Before focusing, the guard forwards the second launch's argv to `onSecondInstance`, which is how a playlist path handed to an already-running app reaches the open queue.

### Trace / Debug Startup

- Full startup tracing:

```bash
IPTVNATOR_TRACE_STARTUP=1 pnpm nx serve electron-backend
```

- Narrower trace flags:
    - `IPTVNATOR_TRACE_IPC=1` traces renderer `window.electron.*` bridge calls
    - `IPTVNATOR_TRACE_DB=1` traces DB worker requests and request-scoped DB events
    - `IPTVNATOR_TRACE_SQL=1` traces SQLite statements in the main process and DB worker
    - `IPTVNATOR_TRACE_WINDOW=1` traces BrowserWindow lifecycle and unresponsive events
    - `IPTVNATOR_TRACE_PLAYER=1` traces external-player activity and bounded Embedded MPV runtime-probe stderr
    - `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console output into the Electron terminal
    - `IPTVNATOR_PERF_CAPTURE=1` enables development/test-only, redacted M3U and Xtream preload IPC request/completion markers plus count-only M3U acquire/parse/normalize, Xtream main network/JSON-transform/success-response-ready/cancel-dispatch, and renderer store phase capture; renderer wrappers emit only while the benchmark installs its Symbol hook, benchmark tooling sets the flag explicitly, and production launches must leave it unset. It also keeps count-only main-process counters (startup phases, database worker SQL statements, and their values at main-window creation and `ready-to-show`) and registers the main-only `performance:read-counters` IPC handler, which the preload does not expose; see [performance journeys](../architecture/performance-journeys.md)
    - `IPTVNATOR_PERF_COUNT_SQL=1`, together with `IPTVNATOR_PERF_CAPTURE=1`, also counts every SQL statement of the main-process and database-worker connections for `main.sqlStatementsBeforeReadyToShow`; it wraps each statement execution, including every row of a bulk insert, so only the launch journey sets it and the import benchmarks leave it unset
    - `IPTVNATOR_PERF_WORKER_PROFILING=1` enables development/test-only, request-scoped worker receive/work/response-post timestamps, thread CPU, event-loop utilization/delay, count-only playlist serialization/SQLite write/read/deserialization plus Xtream category/content/cache-clear/delete/in-source-search phase events, profiling-only worker cancel-receipt acknowledgements, valid-sample-counted isolate peak memory, and the database worker's idle-only one-shot post-GC heap probe; overlapping database requests are explicitly invalidated instead of misattributed, the performance benchmark sets the flag automatically, and production launches must leave it unset
    - `IPTVNATOR_DISABLE_COMPILE_CACHE=1` disables the main-process V8 compile cache; `IPTVNATOR_COMPILE_CACHE_DIR=<dir>` relocates it. The startup trace reports the outcome as `compile-cache`

- Settings, portal request/response, and trace payloads must use
  `@iptvnator/shared/logging` or the redacting portal logger before reaching
  `console.*`; never log raw credentials while debugging.

- If local Nx state gets weird before a rerun:

```bash
pnpm nx reset
```

### agent-browser (global install)

```bash
agent-browser --cdp 9222 tab list
agent-browser --cdp 9222 tab 1
agent-browser --cdp 9222 snapshot -i -c -d 4
agent-browser --cdp 9222 screenshot /tmp/iptvnator-cdp.png
```

### Fallback

```bash
npx --yes agent-browser --cdp 9222 tab list
```

### DevTools Workaround

```bash
ELECTRON_OPEN_DEVTOOLS=1 pnpm nx serve electron-backend
curl http://127.0.0.1:9222/json/list
agent-browser connect ws://127.0.0.1:9222/devtools/page/<iptvnator-page-id>
agent-browser screenshot /tmp/iptvnator-cdp.png
```

## E2E process cleanup and packaged diagnostics

Playwright launches Electron through `cmd.exe` on Windows. If graceful E2E
shutdown times out, terminate that process tree with `taskkill /T /F`; killing
only `electronApp.process()` can leave Electron holding the temporary profile
and make the next launch exit on the single-instance lock. The E2E workflow
checks this against a real Windows shell and child process. Test cleanup must
target only its own launch PID, never all Electron or IPTVnator processes.
Cleanup confirms process exit even if Playwright's close promise fails or
never settles. If termination fails, it retries and then throws instead of
allowing a relaunch against a potentially locked profile.
Capture the Node child-process handle immediately after launch and retain it
in a WeakMap keyed by the Electron application for cleanup and preparation
failures. This binding follows the application when restart callers replace
only the application/window fields on their fixture. After the last window
closes on Linux,
Electron can exit before cleanup begins; Playwright disposes its dispatcher,
so calling `electronApp.process()` at that point can throw even after a clean
exit. The retained handle still provides the actual exit code and signal.

Playwright sends `Emulation.setFocusEmulationEnabled` to every page it attaches
to, and Chromium implements focus emulation by raising the page's capturer
count. A window launched through `launchElectronApp` therefore always reports
`document.visibilityState === 'visible'` and is never background-throttled,
even when hidden or minimized. Tests of hidden-window behavior launch through
`apps/electron-backend-e2e/src/electron-unautomated-launch.ts`, which spawns
the app without Playwright and evaluates over raw CDP sockets
(`window-visibility.e2e.ts` is the example).

The Linux portable build uploads `packaged-frame-copy-smoke` reports and traces
even when the smoke fails. Check the paused-frame screenshot and trace before
classifying a zero rendered-frame signal as an infrastructure flake. A zero
signal also attaches `frame-copy-diagnostics` (the session's stream stats,
including mpv's drop counter, and its helper rings read from `/dev/shm`) and
`mpv-log`, the session's verbose mpv log. A `latestSeq` of 0 means the helper
never published; a `latestFrameSignal` of 0 means mpv rendered black; a
visible ring frame behind a black canvas points at the preload pump.
The Snap and Flatpak `--embedded-mpv-runtime-probe` launches in
`build-and-make.yaml` run under GNU `timeout --verbose -k 10 300` with
`ELECTRON_ENABLE_LOGGING=1`, so a main process that throws before app ready
and blocks on Electron's uncaught-exception dialog under xvfb fails within
five minutes with a distinct `::error::` (exit 124, or 137 after timeout's
announced KILL escalation) and its stderr in the step log, instead of holding
the job until the 120-minute limit.

## Main-process ownership

The process entry is `apps/electron-backend/src/main.entry.ts` (built to
`dist/apps/electron-backend/main.js`): it enables the V8 compile cache under
`userData/v8-compile-cache` and then requires the application bundle,
`main.app.js`, built from `apps/electron-backend/src/main.ts`. Before the window
loads, `main.ts` registers only what the renderer can call before its first paint
(window state, the close guard, playlist-open requests, request-header shims);
everything else, including the database, portal, EPG, download, player,
remote-control and update IPC, lives in
`apps/electron-backend/src/app/startup/deferred-events.ts`, built as the
`deferred-events.js` chunk and loaded inside the window's `did-start-loading`
listener. That import and its registrations finish within the same task, so no
renderer `invoke` can find a missing handler (`app/startup/deferred-bootstrap.ts`
holds the scheduler and its test); the startup trace reports it as
`deferred-events:start` and `deferred-events:done`. The cache is
disposable; `IPTVNATOR_DISABLE_COMPILE_CACHE=1` turns it off and
`IPTVNATOR_COMPILE_CACHE_DIR` relocates it (E2E runs keep it inside
`IPTVNATOR_E2E_DATA_DIR`). nx-electron packages the backend through an
allowlist, so `apps/electron-backend/project.json` lists `main.app.js` and
`deferred-events.js` under the `files` option of the `package` and `make`
targets, and `verify:package-layout` fails when any of the entry files is missing
from `app.asar`. The preload is
`apps/electron-backend/src/app/api/main.preload.ts`, with handlers under
`apps/electron-backend/src/app/events/`. The window follows the saved startup mode
(normal/maximized/fullscreen); `--fullscreen` overrides a single launch. Use
[workspace shell](../architecture/workspace-shell.md) for window behavior,
[DB worker](../architecture/sqlite-db-worker.md) for worker ownership and
[Electron security](../architecture/electron-security.md) for bridge boundaries.

`apps/electron-backend/tsconfig.app.json` sets `"target": "ES2022"` for the
main-process bundles (`main.js`, `main.app.js`, `deferred-events.js`) and the
preloads; `tsconfig.base.json` stays at `es2015` because other projects
inherit it. The Jest specs (`tsconfig.spec.json`) keep the base target on
purpose: Istanbul counts the statements of the emitted code, so an ES2022 spec
build drops the downleveled helpers from the counts (for example
`downloads.events.ts` from 126 to 111 statements) and would trip the absolute
`minimumCovered` ratchets in `tools/coverage/coverage-policy.json` without any
coverage being lost. Electron 43 (Node 24 and Chromium's V8) runs
ES2022 natively in the main process and in the sandboxed preload, so
async/await, optional chaining and `??` are no longer downleveled.
`"useDefineForClassFields": false` keeps the class-field semantics of the old
target (constructor assignment, not `[[Define]]`), so only syntax changed. The
workers built by `build-worker.js` (esbuild, `node18`) were already native. On
2026-09-29 the four bundles shrank from 2,008,115 to 1,853,599 bytes (every
inlined `__awaiter` gone); neither main-process CPU time to `did-finish-load`
nor the J1 launch journey's wall-clock changed measurably in an interleaved
A/B, and J1's counters were identical.
