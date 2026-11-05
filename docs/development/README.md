# Build and develop

[Back to README](../../README.md)

Requirements:

- Node.js 24.22.1 (see `.nvmrc`); patched Node 22.23.4 or newer within 22.x is also supported
- pnpm 10.33.0 (via Corepack)

The repository's `.nvmrc` pins the Node.js version used by CI. With nvm,
run `nvm install` and `nvm use` from the repository root to use the same version
for local development.

1. Clone this repository and install project dependencies:

    ```
    $ nvm install
    $ nvm use
    $ corepack enable
    $ pnpm install --frozen-lockfile
    ```

2. Start the application:
    ```
    $ pnpm run serve:backend
    ```

This will open the Electron app in a separate window, while the Angular dev server will run at http://localhost:4200.

The equivalent Nx command is:

```
$ pnpm nx serve electron-backend
```

To start Electron with an empty, isolated data directory instead of your normal
`~/.iptvnator` folder, set `IPTVNATOR_E2E_DATA_DIR` for that run:

```
$ rm -rf .tmp/iptvnator-empty && mkdir -p .tmp/iptvnator-empty
$ IPTVNATOR_E2E_DATA_DIR="$PWD/.tmp/iptvnator-empty" pnpm run serve:backend
```

This redirects the SQLite database, Electron user data, and local config under
the given directory. Delete that directory whenever you want a fresh empty
state.

If you need startup diagnostics for a white screen or a frozen route, you can
also turn on opt-in Electron tracing. These logs are written to the Electron
terminal output so they still help when the renderer DevTools never open:

```
$ IPTVNATOR_TRACE_STARTUP=1 pnpm run serve:backend
```

Nx equivalent:

```
$ IPTVNATOR_TRACE_STARTUP=1 nx serve electron-backend
```

Useful narrower flags:

- `IPTVNATOR_TRACE_IPC=1` logs renderer `window.electron.*` calls reaching the
  Electron bridge
- `IPTVNATOR_TRACE_DB=1` logs DB worker requests and request-scoped DB events
- `IPTVNATOR_TRACE_SQL=1` logs SQLite statements in both the main connection and
  DB worker connection
- `IPTVNATOR_TRACE_WINDOW=1` logs BrowserWindow load, navigation, and
  unresponsive events
- `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console messages into
  the Electron terminal output

Security-sensitive network compatibility flags are opt-in:

- `IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS=1` permits strict EPG fetches from
  playlist metadata (`x-tvg-url`, `url-tvg`, or `tvg-url`) to resolve to
  localhost, LAN, or other private addresses. Directly configured
  Xtream/Stalker portals and private playlist servers remain supported without
  this flag. Prefer the in-app source-scoped “Allow source” action for a trusted
  EPG URL.
- `IPTVNATOR_ALLOW_INSECURE_TLS=1` disables certificate validation for remote
  playlist imports and refreshes for the whole Electron process. Prefer the
  in-app host-scoped trust action for a trusted provider with a self-signed or
  otherwise invalid certificate.

If the local Nx daemon gets into a bad state before rerunning Electron, reset it:

```
$ pnpm nx reset
```

To run only the Angular app without Electron, use:

```
$ pnpm run serve:frontend
```

To see how many bytes the built web app puts on the initial load path (the
number the CI ratchet guards), build it and run the measurement:

```
$ pnpm nx build web
$ pnpm run perf:initial-bytes
```

The contract behind that number is in
[performance journeys contract](../architecture/performance-journeys.md).

To benchmark the "launch to usable", "open a source" and "start playback"
journeys (fresh Electron processes on a seeded profile against the local
Xtream mock, exact renderer counters plus wall-clock), run:

```
$ pnpm run perf:journeys
```

The journeys, their counters and the summary written under
`dist/performance/journeys/` are described in
[performance journeys contract](../architecture/performance-journeys.md).
`pnpm run perf:compositing` measures the renderer's tile memory and composited
layers on the dashboard, the detail pages, Live TV and settings (the
"compositing budget" section of the same document).

Continue with [Electron debugging](electron-debugging.md), the [agent workflow](agent-workflow.md), the [task context map](../maintenance/agent-context-map.md), or [website development](../../apps/website/README.md).
