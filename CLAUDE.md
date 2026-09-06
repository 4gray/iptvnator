# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> The process sections below (Plan Mode, Documentation After Changes, Regression Prevention, Agent Bootstrap, Electron CDP Debugging) are mirrored in `AGENTS.md`, which is the canonical copy for agent workflows. When updating one, keep the other in sync.

## Plan Mode

- When Claude Code is in Plan Mode and produces a final `<proposed_plan>`, it must also save that finalized plan as a Markdown file in the repo-root `.plans/` directory.
- Save only finalized plans. Do not write interim exploration, question turns, or draft revisions to `.plans/`.
- Use the filename pattern `YYYY-MM-DD-short-topic.md` such as `.plans/2026-03-12-channel-filtering.md`.
- If the intended filename already exists, append a numeric suffix such as `-2`, `-3`, and so on.

## Documentation After Changes

- After implementing a meaningful change, Claude Code must assess whether canonical repo docs need updates before considering the task complete.
- Meaningful changes include new or changed user-visible behavior, architecture or data-flow changes, non-obvious maintenance workflows, new setup/debugging steps, and new subsystem contracts or boundaries.
- Skip doc updates for trivial refactors with unchanged behavior, formatting-only edits, and isolated test-only changes.
- Prefer updating an existing authoritative doc before creating a new one:
    1. `README.md` for top-level developer or user workflows
    2. `docs/architecture/` for architecture, ownership, and behavior contracts
    3. the nearest module `README.md` for local usage or behavior
- Keep this file (`CLAUDE.md`) itself up to date. It is a living document: whenever a change touches something it describes — monorepo structure (new/moved/renamed apps or libs), routes, database schema/tables, stores and their features, key components, commands, environment behavior, or coding conventions — update the affected `CLAUDE.md` sections as part of the same task, and keep the mirrored process sections in `AGENTS.md` in sync.
- When adding a new feature area, check whether the Architecture or Key Features sections of `CLAUDE.md` describe the surrounding area; if they do, reflect the addition there instead of leaving the description stale.
- Do not let `CLAUDE.md` drift: a stale path or route in this file poisons the context of every future agent session. If you notice an outdated claim while working, fix it (or flag it in the final summary) even if it is unrelated to the current task.
- Repo docs are canonical even when they were originally drafted by an LLM.
- Final task summaries should state whether docs were updated and which doc changed.

## Release Notes For User-Visible Changes

- Any change a user could notice — new behavior, changed behavior, bug fix, performance win, breaking change — must add one note file under `.changes/` in the same PR. Format, field table, and writing rules: `.changes/README.md`.
- Name it `<area>-<short-slug>.md`; `area` matches the conventional-commit scope. There is no version field — the release version is chosen at release time.
- Write the body for a user, not a reviewer: "the player now remembers volume between episodes", not "hoist volume state into the session". Max 400 characters; depth belongs in the release blog post.
- `type: internal` records invisible maintenance. Internal notes stay collapsed in `CHANGELOG.md`, are omitted from the blog scaffold, and are removed from the authored public GitHub body by `extract-changelog-section.mjs --public`; GitHub's generated commit list remains separate, so an internal-only release can have an empty authored body.
- `highlight: <short headline>` (max 60 characters, rejected on `type: internal`) marks a note as one of the release's two or three headline changes. Highlights lead the Telegram/Reddit announcement drafts, open the blog scaffold (a "What changed" table row plus a leading `##` section each, while the remaining features fold into themed sections and non-highlighted fixes collapse under a spoiler — `tools/release/release-notes-blog.mjs`), and are the input the highlight-card generator renders from. A release where everything is a highlight has none.
- Skip the note for test-only changes, docs, CI/workflow plumbing, and pure refactors with no behavior change. When skipping on a PR that touches `apps/**` or `libs/**`, apply the `no-release-note` label.
- CI enforces this: the "Release note gate" job in `.github/workflows/ci.yml` fails PRs that change runtime code without an added `.changes/*.md` or the label (policy in `tools/release/check-release-note-gate.mjs`; tests/e2e/website/mock-server/docs paths are auto-exempt).
- The `release-notes` skill covers writing notes; the `release-cut` skill covers the full release sequence. Canonical contract — surfaces, ordering constraints, the required draft asset set: `docs/architecture/release-pipeline.md`.
- Validate before finishing: `pnpm run release:notes:validate`.
- Announcement drafts and highlight cards are built from the same notes: `pnpm --silent run release:notes:telegram` and `pnpm --silent run release:notes:reddit` print paste-ready posts to stdout (Telegram is guaranteed to fit its 4096-character limit; `--silent` keeps pnpm's lifecycle banner out of a redirected post), and `pnpm run release:cards:generate` renders branded 1200×630 highlight cards plus a release hero into `dist/release-highlight-cards/v<version>/`. All three read `highlight:` metadata that exists only in the note files, so they must run before `build-release-notes.mjs --consume`; the cards additionally need `release:screenshots` to have run. Nothing is posted or copied into the website tree automatically.
- Pushes to `master` and `v*` can publish Docker images. A `v*` tag build creates a draft GitHub release.
- `pnpm run release:verify:draft` waits for that tag build (polling until the run is indexed, then `gh run watch`) and verifies the draft's status, authored body, and complete required asset set. It is read-only and deliberately fails on an already-published release, because it is the gate that runs before publication.
- Publishing the GitHub release verifies its Snap assets and automatically uploads them to `edge`; installed-Snap smoke and candidate/stable promotion remain manual.
- Release-post screenshots come only from the release capture script running against the mock servers. Never add a screenshot taken from a real playlist or account to `apps/website/public/blog/**` — real streams, logos, and metadata are copyrighted, and credentials must never reach a published image. Website guide screenshots use the same script: manifest shots with `"group": "guides"` are captured only by `pnpm release:screenshots --group guides` and land in `apps/website/public/blog/guides/screenshots/`. A manifest shot may carry `browser: {url, viewport}` to frame a loopback page the app serves (the remote-control phone view) in a separate mobile-sized Chromium instead of the Electron window, behind the same network and content guards; the Xtream mock's `marketing`/`marketing2` scenarios serve movie, episode and live stream URLs from local bytes so download and playback shots never leave the machine.
- Final task summaries should state whether a release note was added or why it was skipped.

## AppImage Manager Metadata

AppManager full-download discovery uses `appImage.desktop.entry` URL fields.
Electron Builder generates the version; `extraMetadata.desktopName=iptvnator`
preserves Linux window identity without a shared `linux.desktop.entry` object
(builder's nested merge would leak AppImage fields into Snap). This does not
enable AppImageUpdate/zsync. Contract: `docs/architecture/release-pipeline.md`
(AppImage external-manager metadata).

## Regression Prevention And Test Updates

- Before the final summary for any feature, behavior change, bug fix, data-flow change, Electron IPC/database change, or user-visible UI workflow change, Claude Code must complete a test impact pass. Identify the affected projects and decide whether unit, integration, E2E, build, lint, or manual/CDP verification is required.
- Bug fixes must normally include regression coverage that fails on the old behavior and passes with the fix. If automated coverage is not practical, document why in the final summary and include the strongest manual validation performed.
- Feature work and behavior changes must update existing tests when assertions, fixtures, mocks, routes, or E2E flows are now stale, incomplete, or missing. Prefer extending the closest existing spec or E2E file before adding a new suite.
- Default validation ladder:
    1. Run targeted unit tests for directly affected projects with `pnpm nx test <project>` or existing scripts such as `pnpm run test:frontend`, `pnpm run test:backend`, or `pnpm run test:unit:ci` when the scope is broader.
    2. Run affected E2E coverage when changing user-visible workflows, routing, persistence, playback, portals, settings, import flows, or Electron-only behavior.
    3. Use `pnpm nx show projects --withTarget test` and `pnpm nx show projects --withTarget e2e` when project ownership or available validation targets are unclear.
    4. Prefer specific atomized E2E targets before broad suites when they cover the changed behavior, for example `pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts` or `pnpm nx run electron-backend-e2e:e2e-ci--src/search.e2e.ts`.
- Electron-specific changes affecting IPC, SQLite, packaged runtime, external players, native file access, or Electron-only routes require Electron E2E coverage where available, or CDP/manual verification with `agent-browser` and the tracing flags documented below.
- Final task summaries must list tests added or updated, validation commands run with results, and any skipped validation with the reason. For docs-only changes, state that unit/E2E validation was not required and verify the changed Markdown instead.

## Project Overview

IPTVnator is a cross-platform IPTV player application built with Angular and Electron, supporting M3U/M3U8 playlists, Xtream Codes API, and Stalker portals.

**Dual Environment Support**: The application is designed to work in both Electron and as a Progressive Web App (PWA). The architecture uses a factory pattern to inject environment-specific services at runtime, ensuring the same codebase works in both contexts.

## Development Commands

### Agent Bootstrap

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
```

- Run the install step in a fresh worktree before relying on Nx discovery, lint, test, or build commands. Without `node_modules`, local Nx modules are unavailable.
- Re-run the install whenever the checkout moves — `git pull`, `git reset --hard`, a rebase, or a worktree branch being re-pointed. Git rewrites `pnpm-lock.yaml` but never re-links `node_modules`, so a tree installed at an older commit keeps serving the old dependency versions and tests fail locally while CI stays green. Check with `cmp pnpm-lock.yaml node_modules/.pnpm/lock.yaml`; any difference means the tree is stale, and a plain `pnpm install --frozen-lockfile` in that directory repairs it. Each worktree needs its own install — with no local `node_modules`, Nx aborts with `Could not find ".modules.yaml"`.
- Use scoped path aliases from `tsconfig.base.json` such as `@iptvnator/services`, `@iptvnator/shared/interfaces`, and `@iptvnator/ui/components`.
- Do not add new imports from legacy bare aliases such as `services`, `shared-interfaces`, `components`, `m3u-state`, or `database`.
- Every Nx project should keep `scope:*`, `domain:*`, and `type:*` tags in `project.json`.
- See `docs/architecture/nx-workspace-boundaries.md` for the current Nx tag and alias policy.
- Keep `nx` and every official `@nx/*` package on the same exact version; run
  `pnpm run deps:nx:validate` after dependency updates.
- Vite `7.3.6`, resolved through Angular's build tooling, is patched with
  bounded transform prefilters and the upstream precise matchers in
  `patches/vite@7.3.6.patch`. Keep the patch until supported Angular tooling
  resolves a Vite version containing the fix, and run `pnpm run deps:vite:test`
  after related dependency updates.
- `app-builder-lib` `26.15.7` (electron-builder's macOS signing) is patched in
  `patches/app-builder-lib@26.15.7.patch` with the upstream backport
  electron-userland/electron-builder#10172: `security set-key-partition-list -k`
  must receive the temporary keychain's own password, not the `.p12` import
  password. macOS runner images since `macos-26-arm64` 20260831 verify that
  password, and `Build on macos arm64` failed with `SecKeychainUnlock: The user
name or passphrase you entered is not correct`. Keep the patch until
  electron-builder resolves an `app-builder-lib` containing the fix (26.16.1+),
  and run `pnpm run deps:electron-builder:test` after related dependency
  updates — the test fails when the patched version no longer matches the
  installed one.
- A directory holding files consumed by other projects must be an Nx project.
  Nx builds its graph from TypeScript imports only, so a relative SCSS `@use`
  across project roots creates no edge and the imported file lands in no task
  hash — edits then return a cache hit instead of rebuilding. Shared partials
  live in `libs/ui/styles` (project `ui-styles`), and each consumer declares
  `"implicitDependencies": ["ui-styles"]`. Run `pnpm run styles:inputs:validate`
  after adding a cross-project stylesheet import.
- Update Nx with `pnpm nx migrate nx@<target> --skipInstall`, regenerate the
  lockfile, run generated migrations when present, and validate before opening
  a PR. Major updates are always manual. Replace incomplete Dependabot security
  PRs with a coordinated update instead of editing the bot branch.
- Repository-specific skills live under `.codex/skills/`.
- Frontmatter descriptions are trigger-only and begin with `Use when`; keep
  each skill at or below 500 words.
- Run `pnpm run skills:validate` after editing a committed skill or a literal
  path it documents.
- Keep `.codex` and `.claude` copies of `release-notes` and `release-cut`
  byte-identical.

### Building and Serving

```bash
# Serve the Angular web app only (development mode, baseHref="/")
pnpm run serve:frontend
# or
nx serve web

# Serve with PWA configuration (optimized, baseHref="/")
pnpm run serve:frontend:pwa
# or
nx serve web --configuration=pwa

# Serve the Electron app (starts both frontend and backend)
pnpm run serve:backend
# or
nx serve electron-backend

# Build frontend for Electron (baseHref="./")
pnpm run build:frontend
# or
nx build web

# Build frontend for PWA deployment (baseHref="/")
pnpm run build:frontend:pwa
# or
nx build web --configuration=pwa

# Build backend (Electron)
pnpm run build:backend
# or
nx build electron-backend

# Package the app (creates distributable without installers)
pnpm run package:app
# or
nx run electron-backend:package

# Create installers/executables
pnpm run make:app
# or
nx run electron-backend:make
```

### Windows Embedded MPV Pin Maintenance

- PR, master, and tag builds resolve the Windows runtime only from
  `tools/embedded-mpv/windows-runtime-pin.json`; repository variables are not
  build inputs.
- Validate the checked-in schema and provenance with
  `pnpm embedded-mpv:windows-runtime-pin:check`.
- Prepare a manual rotation with
  `pnpm embedded-mpv:windows-runtime-pin:refresh -- --force`. The weekly
  `refresh-windows-embedded-mpv-runtime.yaml` workflow runs the same updater
  and opens a reviewable PR before upstream retention expires.
- The PAT-backed refresh job must keep every third-party action pinned to a
  full commit. Do not mirror the upstream binary without complete
  corresponding source, build records, license notices, and a validated
  transitive license closure.

### Electron CDP Debugging

- Start Electron in dev mode with: `nx serve electron-backend`
- Package-script equivalent: `pnpm run serve:backend`
- The workspace is configured to always launch Electron with: `--remote-debugging-port=9222`
- Use CDP clients (Chrome DevTools Protocol tools) against: `127.0.0.1:9222`
- When the task is Electron automation/debugging, use the `electron` skill
- Do not auto-open DevTools during normal CDP automation. In development, DevTools is opt-in via `ELECTRON_OPEN_DEVTOOLS=1`.
- If DevTools is open, `agent-browser --cdp 9222 ...` may attach to the DevTools page instead of the IPTVnator window (symptoms: `tab list` shows `about:blank`, empty snapshots, black screenshots). Inspect targets with `curl http://127.0.0.1:9222/json/list` and connect directly to the app page's `webSocketDebuggerUrl`.
- The app holds a single-instance lock (`acquireSingleInstanceLock` in `apps/electron-backend/src/app/services/single-instance.ts`): a second launch against the same `userData` quits immediately and focuses the running window. To attach a second CDP-enabled instance to the same profile, set `IPTVNATOR_ALLOW_MULTIPLE_INSTANCES=1` — knowing that only one of the two processes will own the renderer's IndexedDB, so settings written by the other are lost. Before focusing, the guard forwards the second launch's argv to `onSecondInstance`, which is how a playlist path handed to an already-running app reaches the open queue.

For startup tracing or white-screen debugging:

```bash
IPTVNATOR_TRACE_STARTUP=1 nx serve electron-backend
```

Useful narrower flags:

- `IPTVNATOR_TRACE_IPC=1` traces renderer `window.electron.*` bridge calls
- `IPTVNATOR_TRACE_DB=1` traces DB worker requests and DB progress events
- `IPTVNATOR_TRACE_SQL=1` traces SQLite statements in both main and worker connections
- `IPTVNATOR_TRACE_WINDOW=1` traces BrowserWindow navigation/load lifecycle
- `IPTVNATOR_TRACE_PLAYER=1` traces external-player activity, bounded Embedded MPV runtime-probe stderr, and embedded MPV session status transitions (the input of the reconnect policy; never the stream URL)
- `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console logs into the Electron terminal
- `IPTVNATOR_PERF_CAPTURE=1` enables development/test-only, redacted M3U and Xtream preload IPC request/completion markers plus count-only M3U acquire/parse/normalize, Xtream main network/JSON-transform/success-response-ready/cancel-dispatch, and renderer store phase capture; renderer wrappers emit only while the benchmark installs its Symbol hook, benchmark tooling sets the flag explicitly, and production launches must leave it unset
- `IPTVNATOR_PERF_WORKER_PROFILING=1` enables development/test-only, request-scoped worker receive/work/response-post timestamps, thread CPU, event-loop utilization/delay, count-only playlist serialization/SQLite write/read/deserialization plus Xtream category/content/cache-clear/delete/in-source-search phase events, profiling-only worker cancel-receipt acknowledgements, valid-sample-counted isolate peak memory, and the database worker's idle-only one-shot post-GC heap probe; overlapping database requests are explicitly invalidated instead of misattributed, the performance benchmark sets the flag automatically, and production launches must leave it unset

Settings, portal request/response, and trace payloads must use
`@iptvnator/shared/logging` or the redacting portal logger before reaching
`console.*`; never log raw credentials while debugging.

If the Nx daemon gets into a bad state before rerunning Electron:

```bash
pnpm nx reset
```

Use global `agent-browser` (preferred):

```bash
# Verify CDP targets
agent-browser --cdp 9222 tab list

# Switch to the app tab and inspect interactive elements
agent-browser --cdp 9222 tab 1
agent-browser --cdp 9222 snapshot -i -c -d 4

# Capture debug artifacts
agent-browser --cdp 9222 screenshot /tmp/iptvnator-cdp.png
agent-browser --cdp 9222 trace start /tmp/iptvnator.trace.zip
agent-browser --cdp 9222 wait 1500
agent-browser --cdp 9222 trace stop /tmp/iptvnator.trace.zip
```

If `agent-browser` is not in PATH, use:

```bash
npx --yes agent-browser --cdp 9222 tab list
```

### Testing

```bash
# Run frontend tests
pnpm run test:frontend
# or
pnpm nx test web

# Run backend tests
pnpm run test:backend
# or
pnpm nx test electron-backend

# Run targeted E2E tests (Playwright)
pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/search.e2e.ts

# Run broad E2E suites only when the impact justifies it
pnpm nx e2e web-e2e
pnpm nx e2e electron-backend-e2e

# Run tests with coverage when needed
pnpm nx test web --configuration=ci
```

Before finishing behavior changes or bug fixes, follow `Regression Prevention And Test Updates` above and report the test impact decision in the final summary.

### Linting

```bash
# Lint all projects (CI runs this on master; PRs lint affected projects)
pnpm run lint

# Lint a single project
nx lint web
nx lint electron-backend
```

CI lints affected projects on PRs (`nx affected`) and every project on master
pushes (`.github/workflows/ci.yml`). This enforces the
Nx module-boundary tags, the legacy bare-alias ban, and a `max-lines` ESLint
rule. The limits and their rationale live in one place,
`tools/eslint/max-lines-config.mjs`, which both `eslint.config.mjs` and the
baseline generator import so the enforced rule and the generated list cannot
drift:

- **Production TypeScript: hard maximum 400 lines.**
- **Tests: 1200.** `**/*.spec.ts`, `**/*.spec-data.ts`, `**/*.e2e.ts` and
  everything under `apps/*-e2e/**` — a spec is a flat list of independent
  cases, so splitting one at the production limit yields arbitrary
  `-2.spec.ts` files, and length there signals coverage rather than the
  design debt the production limit catches. `.spec-data.ts` fixtures (flat
  case lists consumed only by a spec, e.g. the worker IPC contract table)
  grow with coverage the same way.
- **Blank lines and comments are not counted** (`skipBlankLines`,
  `skipComments`), so a docblock is never the reason a file must be split.

Pre-existing oversized files are baselined in
`tools/eslint/max-lines-baseline.mjs`; regenerate the baseline with
`node tools/eslint/generate-max-lines-baseline.mjs` after splitting a file. The
generator decides who belongs on the list by running ESLint's own `max-lines`
rule, not by counting lines itself — a private reimplementation would silently
disagree with the rule and produce a baseline that turns CI red while looking
correct. Never add new files to the baseline — the list must only shrink. A new
file that genuinely cannot be split (for example a function serialized into
another process) instead carries its own file-wide
`/* eslint-disable max-lines -- <why> */`; the generator skips those files, so
a justified exemption never lands in the baseline. If such a directive later
becomes unnecessary, ESLint reports it as an unused disable directive — remove
it rather than leaving a stale justification behind.

Project `lint` targets that shell out to eslint must quote the glob, e.g.
`eslint "apps/<project>/**/*.ts"`. An unquoted `**` is expanded by the POSIX
shell on Linux and macOS (which has no `globstar`, so it matches only a
shallow subset of files) while Windows passes the literal pattern to ESLint,
which expands it recursively — the two hosts then lint different file sets.
The target still reports success either way, so a broken glob hides missing
coverage instead of failing. After changing such a target, compare the linted
file count against `find <project> -name '*.ts' | wc -l`.

## Legacy Desktop Profile Migration

`electron-profile-bootstrap.ts` selects the known v0.19 `electron-backend`
profile before eager main-process imports only when current Chromium storage
is unused. Existing profiles retain their settings and offer explicit recovery
of missing sources from a disposable legacy snapshot. Playlist rows and a
completion receipt commit atomically in the DB worker; original IndexedDB is
retained, current payload rows are preserved, and completed imports never
replay deleted sources. Contract and recovery limits:
`docs/architecture/m3u-playlist-module.md` (Desktop upgrades from legacy profiles).

## Architecture

### Monorepo Structure (Nx Workspace)

This is an Nx monorepo with the following structure:

- **apps/web** - Angular application (frontend, shared by Electron and PWA)
- **apps/electron-backend** - Electron main process
- **apps/web-backend** - HTTP backend for the self-hosted PWA (`/parse`, `/parse-xml`, `/xtream`, `/stalker` CORS proxy endpoints). At startup it raises Node's happy-eyeballs per-attempt connection timeout to 2500 ms (`network-family-autoselection.ts`) so dual-stack provider hostnames fall back to IPv4 behind IPv6-less VPN/Docker networks; an explicit `--network-family-autoselection-attempt-timeout` passed via `NODE_OPTIONS`/CLI always wins. Outbound provider failures are logged hostname-only with the underlying Node error codes and return the primary code in the error body (`provider-error.ts`) — the proxied URL query carries credentials and must never be logged. Every proxied request carries the same timeout as its Electron counterpart (Xtream 30 s, Stalker 15 s / 30 s for `create_link`, playlist and XMLTV 30 s). The shared per-host circuit breaker (`host-guard.ts`, injected via `WebBackendAppOptions.hostGuard`) covers `/xtream` and `/stalker` only — playlist/XMLTV downloads keep the timeout but no breaker, matching Electron. A fast-fail keeps the route's normal failure shape (HTTP 200 with a `{message, status}` body), `skipConnectionGuard=true` carries the Stalker discovery exemption through the proxy, and `POST /connectivity-guard/reset` is the PWA's counterpart to the `CONNECTIVITY_GUARD_RESET` IPC
- **apps/remote-control-web** - Mobile remote-control web app served by the Electron backend
- **apps/web-e2e** - Playwright E2E tests against the web app
- **apps/electron-backend-e2e** - Playwright E2E tests against the Electron app
- **apps/stalker-mock-server** - Mock Stalker/Ministra portal for dev and E2E
- **apps/xtream-mock-server** - Mock Xtream Codes API for dev and E2E
- **apps/website** - Astro + Tailwind landing page, blog (guides carry `faq:` frontmatter → FAQPage JSON-LD and open with `src/components/blog/ContentDisclaimer.astro`, whose `offline` variant is mandatory for posts about downloads or recordings; tags are a closed vocabulary in `src/lib/blog-tags.ts` enforced by the collection schema, each with a `/blog/tag/<tag>/` hub), per-OS download landing pages (`/download/`, `/download/{windows,macos,linux}/`) plus the Docker page (`/download/docker/`) feature landing pages (`/features/`, registry in `src/lib/features.ts`) and comparison pages (`/compare/`, registry in `src/lib/comparisons.ts`, comparing IPTVnator's own options rather than other products); direct asset links are resolved at build time from the GitHub Releases API with a `package.json` fallback (`src/lib/downloads.ts`, see `apps/website/README.md`)
- **libs/** - Shared libraries:
    - **epg/data-access** - EPG services, runtime bridge, program normalization
    - **m3u-state** - NgRx state management for M3U playlists
    - **playlist/import/feature** - Playlist import flows (file/URL/text upload, Xtream and Stalker import dialogs, and the "Auto-detect" method: paste a provider message, `detectProviderImportCandidates` in `libs/shared/interfaces` deterministically extracts URLs/credentials/MAC+device identity and prefills the matching form — detection only proposes, the target form's own validation and behavioral probes stay authoritative)
    - **playlist/m3u/feature-player** - M3U video player page and `/workspace/playlists/:id` routes
    - **playlist/shared/{ui,util}** - Shared playlist UI and utilities
    - **portal/xtream/{data-access,feature}** - XtreamStore, services, data sources; routed Xtream components
    - **portal/stalker/{data-access,feature}** - StalkerStore and routed Stalker components
    - **portal/catalog/feature** - Portal catalog UI
    - **portal/downloads/feature** - Download manager UI
    - **portal/shared/{data-access,ui,util}** - Cross-portal shared code: stateful collection services and VOD multi-source discovery/resolve/ranking live in `data-access`; reusable views live in `ui`; `util` is for pure contracts/helpers
    - **services** - Abstract DataService contract and shared app services (incl. the TMDB metadata enrichment module in `lib/tmdb/`)
    - **shared/interfaces** - TypeScript interfaces and types (incl. `ElectronBridgeApi`)
    - **shared/logging** - Dependency-free structured redaction for diagnostic logs
    - **shared/host-health** - Per-host circuit breaker for portal requests (`HostConnectivityGuard`), shared by the Electron main process and the web backend; transport-free, the owning app supplies the clock and owns the instance. Monotonic admission ids with per-endpoint failure boundaries distinguish parallel failures from later attempts even within one clock tick (#1438)
    - **shared/database** - Canonical Drizzle schema and DB connection (used by the Electron backend)
    - **shared/m3u-utils** - M3U playlist utilities
    - **shared/marketing-fixtures** - Provider-neutral fictional movie metadata, live channel list and the generated channel-logo SVG renderer shared by the Xtream and Stalker marketing mocks (both serve `/assets/marketing/logo/<slug>.svg`)
    - **shared/testing** - Shared test helpers
    - **ui/components** - Reusable UI components (incl. channel list)
    - **ui/epg** - EPG UI (timeline ribbon, programme guide grid via `EPG_GUIDE_SOURCE`, progress panel, program dialogs)
    - **ui/playback** - Player UI (video/audio players)
    - **ui/pipes** - Angular pipes
    - **ui/remote-control** - Remote-control UI pieces
    - **ui/shared-portals** - Shared portal types (`LiveEpgPanelSummary`)
    - **ui/styles** - Shared styles/theme
    - **workspace/{shell,dashboard}** - Workspace shell (layout/navigation) and dashboard

### Frontend Architecture (Angular)

**State Management**: Uses NgRx for playlist state management:

- Store configuration in `apps/web/src/app/app.config.ts`
- Playlist state, actions, effects, and reducers in `libs/m3u-state/`
- Entity adapter pattern for managing playlists collection
- Router store integration for route-based state

**XtreamStore Architecture** (Signal Store with Feature Composition):

The Xtream Codes module uses NgRx Signal Store with a layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                        │
│              Components use XtreamStore (facade)                 │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FACADE LAYER                             │
│                         XtreamStore                              │
│            (Composes feature stores, unified API)                │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ withPortal · withContent · withSelection · withSearch · withEpg │
│ withPlayer · withFavorites · withRecentItems                     │
│ withPlaybackPositions                                           │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATA SOURCE LAYER                             │
│                   IXtreamDataSource                              │
│         ┌───────────────────┬───────────────────┐               │
│         ▼                   ▼                                    │
│  ElectronDataSource    PwaDataSource                            │
│  (DB-first + API)      (API-only)                               │
└─────────────────────────────────────────────────────────────────┘
```

File structure:

```
libs/portal/xtream/
├── data-access/src/lib/
│   ├── stores/
│   │   ├── features/
│   │   │   ├── with-portal.feature.ts             # Playlist & portal status
│   │   │   ├── with-content.feature.ts            # Categories & streams
│   │   │   ├── with-selection.feature.ts          # UI selection & infinite-scroll window
│   │   │   ├── with-search.feature.ts             # Search functionality
│   │   │   ├── with-epg.feature.ts                # EPG data
│   │   │   ├── with-player.feature.ts             # Stream URLs & player
│   │   │   ├── with-playback-positions.feature.ts # Resume/playback positions
│   │   │   └── index.ts
│   │   ├── xtream.store.ts                        # Facade composing all features
│   │   └── index.ts
│   ├── services/
│   │   ├── xtream-api.service.ts                  # Xtream Codes API calls
│   │   ├── xtream-url.service.ts                  # Stream URL construction
│   │   ├── favorites.service.ts                   # Favorites persistence
│   │   ├── epg-queue.service.ts                   # EPG fetch queueing
│   │   ├── xtream-xmltv-fallback.service.ts       # XMLTV fallback EPG
│   │   └── index.ts
│   ├── data-sources/
│   │   ├── xtream-data-source.interface.ts        # Abstract interface + types
│   │   ├── electron-xtream-data-source.ts         # DB-first implementation
│   │   ├── pwa-xtream-data-source.ts              # API-only implementation
│   │   └── index.ts                               # provideXtreamDataSource() factory
│   ├── with-favorites.feature.ts                  # Favorites feature
│   └── with-recent-items.ts                       # Recently viewed feature
└── feature/src/lib/                               # Routed components
    ├── xtream-feature.routes.ts                   # createXtreamRoutes(): /workspace/xtreams/:id tree
    ├── live-stream-layout/, vod-details/, serial-details/, ...
    └── global-search-results/                     # Global search (Electron-only route)
```

Key patterns:

- **Feature stores**: Each `with*.feature.ts` uses `signalStoreFeature()` for focused functionality
- **Facade pattern**: `XtreamStore` composes all features, maintaining backward compatibility
- **Data source abstraction**: `IXtreamDataSource` has SQLite-backed and
  API/in-memory implementations
- **Factory injection**: `provideXtreamDataSource()` selects
  `ElectronXtreamDataSource` only when
  `RuntimeCapabilitiesService.supportsXtreamSqliteDataSource`; otherwise it
  selects `PwaXtreamDataSource`
- **Catalog lazy loading**: catalog grids scroll infinitely instead of paging.
  `withSelection` keeps a `visibleCount` render window over the in-memory
  catalog plus bounded per-selection scroll snapshots for detail/tab
  round-trips; the shared `InfiniteScrollDirective`
  (`libs/portal/shared/ui`) measures container overflow to auto-fill tall
  viewports (terminating on lack of container growth, not on a load count)
  and fires `loadMore` near the bottom. The search layout routes its results
  container through the same directive (`nearEnd*` inputs). Stalker feeds the
  same contract from server-paged appends: portal pages accumulate into one
  deduplicated list, `hasMoreContent` derives from accumulated length vs
  `total_items`, a failed append keeps loaded pages and offers a tail retry,
  and the facade maps page 0 to the skeleton and later pages to the tail
  spinner. No paginator remains anywhere in the app

Xtream data strategies by runtime capability:

| Capability                        | Strategy                                                 |
| --------------------------------- | -------------------------------------------------------- |
| **Complete Xtream SQLite bridge** | DB-first: check DB → fetch API if missing → cache to DB  |
| **Bridge unavailable**            | API-only: fetch from API and keep session data in memory |

**M3U Playlist Module Architecture**:

The M3U playlist module handles traditional M3U/M3U8 playlists with support for 90,000+ channels.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VIDEO PLAYER PAGE                            │
│        libs/playlist/m3u/feature-player/src/lib/video-player/       │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌───────────────────────────────────────────────┐│
│  │   Sidebar   │  │        Video Player (ArtPlayer/Video.js)      ││
│  │ ┌─────────┐ │  │                                               ││
│  │ │Channel  │ │  ├───────────────────────────────────────────────┤│
│  │ │List     │ │  │  EPG timeline ribbon (app-epg-timeline)       ││
│  │ │Container│ │  │  horizontal, under the player                 ││
│  │ └─────────┘ │  └───────────────────────────────────────────────┘│
│  └─────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

The live EPG panel is a horizontal **timeline ribbon** under the player (`app-epg-timeline`, `libs/ui/epg/src/lib/epg-timeline/`), not a right-side drawer (reworked in PR #1102). See `docs/architecture/m3u-playlist-module.md` for the timeline's controllers and scroll behavior.

**Collapsible live channel rail** (M3U player, Xtream/Stalker live layouts, unified favorites/recent live tab): collapse state is owned by `LiveLayoutSidebarStateService` (`@iptvnator/portal/shared/util`) and kept per surface (`m3u` / `portal` / `collection`, localStorage `live-sidebar-state:<surface>`); the pre-split shared key `live-sidebar-state` is forgotten on startup and never read (issue #1458: one stored `collapsed` hid every channel list in the app behind a 32px chevron and survived restart, "Remove all playlists" and re-import). The workspace header renders a `view_sidebar` toggle on every route that renders its own rail (`resolveRouteLiveSidebarSurface`) so the control exists in both states, and a collapsed rail with nothing playing shows `app-channel-list-hidden-state` (title + hint + "Show channels list" button) instead of "select a channel". Contract: "Collapsible Live Sidebar" in `docs/architecture/iptvnator-ui-guidelines.md`.

**Radio Channel Layout** (when `channel.radio === 'true'`):

```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌─────────────┐  ┌────────────────────────────────────────────────┐│
│  │   Sidebar   │  │  Blurred backdrop (station logo)              ││
│  │             │  │  ┌──────────┐                                 ││
│  │             │  │  │ Artwork  │  ← cinematic hero layout        ││
│  │             │  │  └──────────┘                                 ││
│  │             │  │  Station Name                                 ││
│  │             │  │  [LIVE] badge                                 ││
│  │             │  │  ⏮  ▶/⏸  ⏭   ← transport controls          ││
│  │             │  │  🔊 ━━━━━━━━━  ← volume slider               ││
│  │             │  │  (no EPG panel)                               ││
│  └─────────────┘  └────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

Key radio behavior:

- Detection: `channel.radio === 'true'` (string from M3U `radio` attribute)
- The audio player always renders inline — `shouldShowInlinePlayer` is bypassed for radio
- EPG panel is conditionally hidden in the template when radio is active
- Volume is shared with video player via `localStorage` key `'volume'`
- Keyboard: ArrowUp/Down adjusts volume by 5%, M toggles mute
- Component: `libs/ui/playback/src/lib/audio-player/audio-player.component.ts`

**M3U Movie Recognition** (VOD detail instead of the EPG zone): an M3U entry
recognized as a movie FILE swaps the player + EPG area for the portals'
two-state VOD detail shell fed by TMDB, watch-first (activation still plays
immediately; Esc reveals the Browse hero). Detection is synchronous URL-shape
heuristics — movie container extension (`mkv`/`mp4`/…, never `ts`/`m3u8`/`mpd`)
or an Xtream-style `/movie|movies|vod/` path segment; radio, DASH, `/series/`
paths and episode-marker names (`S01E02`, "2 серия") fail toward the live
layout (`isLikelyM3uMovie` in `libs/shared/m3u-utils`). Gated on TMDB
enrichment being enabled AND `Settings.m3uVodDetails` (default on; checkbox in
Settings → Metadata (TMDB)). Host: `m3u-vod-detail/` in
`libs/playlist/m3u/feature-player` (shell + `PortalInlinePlayerComponent`,
parent's `embeddedPlayback()` with `isLive: false`); external MPV/VLC users
keep Browse. See "Movie Recognition (VOD Detail View)" in
`docs/architecture/m3u-playlist-module.md`.

Channel List Component Structure (parent coordinator pattern):

```
libs/ui/components/src/lib/channel-list-container/
├── channel-list-container.component.ts   # Parent - shared state coordinator
├── all-channels-view/                     # Virtual scroll + debounced search
├── groups-view/                           # Expansion panels + infinite scroll
├── favorites-view/                        # CDK drag-drop reordering
├── recent-view/                           # Recently viewed channels
└── channel-list-item/                     # Individual channel display
```

Key patterns:

- **EnrichedChannel**: Pre-computed EPG data attached to channels for performance
- **Parent coordinator**: Manages shared signals (`channelEpgMap`, `progressTick`, `favoriteIds`)
- **Virtual scrolling**: CDK virtual scroll for 90,000+ channel lists
- **Infinite scroll**: IntersectionObserver in groups view loads 50 items at a time
- **Global progress tick**: Single 30s interval instead of per-item intervals

State management via NgRx (`libs/m3u-state/`):

- `PlaylistActions`: loadPlaylists, addPlaylist, removePlaylist, parsePlaylist
- `ChannelActions`: setChannels, setActiveChannel, setAdjacentChannelAsActive
- `EpgActions`: setActiveEpgProgram, setCurrentEpgProgram, setEpgAvailableFlag
- `FavoritesActions`: updateFavorites, setFavorites, hydrateFavorites

See `docs/architecture/m3u-playlist-module.md` for complete documentation.

**Routing**: Lazy-loaded routes in `apps/web/src/app/app.routes.ts`. All user-facing routes are nested under the workspace shell (`/workspace/...`); `/` redirects into the workspace.

- Dashboard: `/workspace/dashboard`; sources overview: `/workspace/sources`
- M3U player: `/workspace/playlists/:id` (children: `favorites`, `recent`, `:view`) — routes in `libs/playlist/m3u/feature-player`
- Xtream Codes: `/workspace/xtreams/:id` (children: `live`, `vod`, `series`, `search`, `actor/:personId`, `discover`, `recently-added`, `favorites`, `recent`, `downloads`) — `libs/portal/xtream/feature/src/lib/xtream-feature.routes.ts`
- Stalker portal: `/workspace/stalker/:id` (children: `itv`, `vod`, `radio`, `series`, `favorites`, `recent`, `search`, `actor/:personId`, `discover`, `downloads`) — `libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts`
- Global collections: `/workspace/global-favorites`, `/workspace/global-recent`
- Global search: `/workspace/search` (Electron-only; a guard redirects the PWA to `/workspace/sources`)
- Downloads: `/workspace/downloads` with focused
  `/workspace/downloads/:downloadId`; source-scoped equivalents are
  `/workspace/xtreams/:id/downloads/:downloadId` and
  `/workspace/stalker/:id/downloads/:downloadId`. Focused download details hide
  the workspace context panel.
- Settings: `/workspace/settings/:section` — one page per section (`general`, `playback`, `epg`, `dashboard`, `remote-control`, `tmdb`, `backup`, `reset`, `about`); `/workspace/settings` redirects to `general`, unknown or capability-gated sections redirect there too, and `/settings` redirects into the workspace. The `general` section's "Window on startup" select (`Settings.startupWindowMode`: `normal` / `maximized` / `fullscreen`, Electron only, gated on `RuntimeCapabilitiesService.supportsStartupWindowMode`) is mirrored into the main-process config by the `SETTINGS_UPDATE` handler and read synchronously at the next window creation — the renderer's IndexedDB is unreachable then, so it is the same pattern as `embeddedMpvFrameCopy`; `iptvnator --fullscreen` forces one fullscreen launch without persisting it, and F11 (`WINDOW:TOGGLE_FULLSCREEN`, bound in `WorkspaceKeyboardShortcutsService`, skipped while the player owns `document.fullscreenElement`) is the exit path on Windows/Linux, where the title bar is hidden (contract: `docs/architecture/workspace-shell.md`, "Startup window mode"). The shared form lives on the parent `SettingsComponent`, so edits survive section switches; a floating unsaved-changes bar (Save/Discard) replaces the old always-visible footer Save button. Leaving the settings AREA with a dirty form triggers `settingsUnsavedChangesGuard` (canDeactivate) and a save/discard/stay dialog — section switches deliberately bypass it, and a failed save cancels the navigation. Non-router exits are covered too: `SettingsUnloadGuardService` (provided by `SettingsComponent`) arms a `beforeunload` handler while the form is dirty (native leave prompt in the PWA) and arms an Electron main-process close guard (`window-close-guard.service.ts`) for the whole settings mount — mount-long on purpose, since arming on the first edit would race the close it protects against. The guard intercepts window close/app quit before `beforeunload` fires and completes the original intent only after the renderer confirms through the same dialog (a pristine form auto-confirms); Electron reloads are cancelled and re-triggered the same way, a failed save always keeps the window open, and installing an app update suspends the whole guard so the updater's quit passes unchallenged — every install entry point (settings About section and the global update notification panel) must go through the root `AppUpdateInstallService`, which owns that suspend/restore choreography

**Service Architecture** (Factory Pattern):

- Abstract `DataService` class in `libs/services/src/lib/data.service.ts` defines the contract
- Two environment-specific implementations:
    - `ElectronService` (`apps/web/src/app/services/electron.service.ts`) - Uses IPC to communicate with Electron backend
    - `PwaService` (`apps/web/src/app/services/pwa.service.ts`) - Uses HTTP API and IndexedDB for standalone web version
- Factory function `DataFactory()` in `apps/web/src/app/app.config.ts` determines which implementation to inject:
    ```typescript
    if (window.electron) {
        return inject(ElectronService);
    }
    return inject(PwaService);
    ```

**Data Storage (Environment-Specific)**:

- **Electron**: SQLite database via Drizzle ORM (`better-sqlite3` driver)
    - Location: `~/.iptvnator/databases/iptvnator.db`
    - Full-featured relational database with foreign keys and indexes
    - Canonical schema and connection live in `libs/shared/database`
- **PWA (Web)**: IndexedDB via `ngx-indexed-db`
    - Browser-based NoSQL storage
    - Same schema structure but implemented in IndexedDB
    - Limited by browser storage quotas

**TypeScript File Size Rule**:

Keep production TypeScript files under **300 lines**. Hard maximum is
**350–400 lines**, and CI enforces the 400. Blank lines and comments do not
count toward it, so documenting a file never costs you headroom. Tests
(`**/*.spec.ts`, `**/*.spec-data.ts`, `**/*.e2e.ts`, `apps/*-e2e/**`) are held
to 1200 instead — the guidance below is about production code.

- When creating new files, design them to stay within this limit from the start.
- When adding a feature to an existing file that would push it past 350 lines, **refactor first**: extract helpers, sub-services, or feature modules before adding the new code.
- When you notice a file already exceeds 350 lines, **proactively suggest a refactoring** (or perform it if the change is straightforward) — even if the immediate task is small.

Typical split strategies:

- Angular components: extract child components, move logic to a dedicated service or store feature
- Signal store features: split into smaller `with*` feature functions in separate files
- Services: split by responsibility (e.g. separate API, transformation, and state concerns)
- Utility files: group by domain and export from a barrel `index.ts`

This rule exists to keep the codebase navigable and reviewable. A 150-line file is always preferable to a 500-line file.

---

**Angular Coding Standards**:

This project uses modern Angular signal-based APIs and patterns. **ALWAYS** use the following:

- **Component Queries**: Use `viewChild()`, `viewChildren()`, `contentChild()`, `contentChildren()` instead of `@ViewChild`, `@ViewChildren`, `@ContentChild`, `@ContentChildren` decorators

    ```typescript
    // ✅ Correct - Signal-based
    readonly menu = viewChild.required<MatMenu>('menuRef');
    readonly items = viewChildren<ElementRef>('item');

    // ❌ Incorrect - Old decorator syntax
    @ViewChild('menuRef') menu!: MatMenu;
    @ViewChildren('item') items!: QueryList<ElementRef>;
    ```

    **Important**: When using signals in templates with properties that expect non-signal values, unwrap the signal by calling it:

    ```html
    <!-- ✅ Correct - Unwrap the signal -->
    <button [matMenuTriggerFor]="menu()">Open Menu</button>

    <!-- ❌ Incorrect - Signal not unwrapped -->
    <button [matMenuTriggerFor]="menu">Open Menu</button>
    ```

- **Component Inputs/Outputs**: Use `input()` and `output()` functions instead of `@Input()` and `@Output()` decorators

    ```typescript
    // ✅ Correct - Signal-based
    readonly title = input.required<string>();
    readonly size = input<number>(10); // with default value
    readonly clicked = output<string>();

    // ❌ Incorrect - Old decorator syntax
    @Input({ required: true }) title!: string;
    @Input() size = 10;
    @Output() clicked = new EventEmitter<string>();
    ```

- **Reactive State**: Use signal primitives for reactive state management

    ```typescript
    // ✅ Use signal(), computed(), effect(), linkedSignal()
    readonly count = signal(0);
    readonly doubled = computed(() => this.count() * 2);

    constructor() {
        effect(() => {
            console.log('Count changed:', this.count());
        });
    }
    ```

- **Host Bindings**: Use `@HostBinding()` and `@HostListener()` decorators (these don't have signal equivalents yet)

    ```typescript
    @HostBinding('class.active') get isActive() { return this.active(); }
    @HostListener('click') onClick() { /* ... */ }
    ```

- **Control Flow**: Use `@if`, `@for`, `@switch` instead of `*ngIf`, `*ngFor`, `*ngSwitch`

    ```typescript
    // ✅ Correct - Modern syntax
    @if (isLoggedIn()) {
        <p>Welcome!</p>
    }

    @for (item of items(); track item.id) {
        <li>{{ item.name }}</li>
    }

    // ❌ Incorrect - Old syntax
    <p *ngIf="isLoggedIn">Welcome!</p>
    <li *ngFor="let item of items; trackBy: trackById">{{ item.name }}</li>
    ```

### Backend Architecture (Electron)

**Main Entry**: `apps/electron-backend/src/main.ts`

- Bootstraps Electron app and initializes database
- Registers event handlers for IPC communication
- Creates the main window per the startup window mode (`app/app.ts` `initMainWindow`, resolver in `app/services/startup-window-mode.ts`): the electron-conf `STARTUP_WINDOW_MODE` mirror or the one-shot `--fullscreen` switch (consumed by the first window, so a window the macOS Dock re-creates in the same process follows the stored setting); `fullscreen: true` is a constructor option that Windows/Linux honour before the first paint, while macOS ignores it on a hidden window, so `ready-to-show` repeats the request after `show()` only when `isFullScreen()` is still false, through the same tracker the F11 toggle uses (`app/services/native-fullscreen-transitions.ts`: per-window fullscreen state seeded once at creation via `trackNativeFullScreen` and fed only by the enter/leave events afterwards, plus a pending record holding the latest target, cleared when an event lands on it, kept when an event lands on the other state, and ignored after 2 s; the tracker only observes and never issues a request itself, since a "repeat on mismatch" cannot be told apart from reversing the user's own green-button action — a toggle is never decided against `isFullScreen()`, which is stale mid-transition and, on Windows, even during the event), so F11 during the startup animation exits instead of re-requesting; `maximize()` waits for `ready-to-show` too (it would show a hidden window early). `attachWindowStateEvents` tracks native and HTML-element fullscreen as two flags OR-ed into `WINDOW:STATE_CHANGED`, because Electron leaves only the HTML state when the window was already natively fullscreen
- Holds a single-instance lock (`app/services/single-instance.ts`), requested after the `userData` override so E2E runs with their own data dir keep independent locks. A second launch quits and focuses the running window; concurrent instances would otherwise share a Chromium profile whose IndexedDB only one of them can lock, silently breaking renderer-side settings persistence. `IPTVNATOR_ALLOW_MULTIPLE_INSTANCES=1` opts out for local debugging. The guard also forwards that launch's argv and working directory, so `iptvnator playlist.m3u` against a running app opens the playlist instead of being discarded.

**Database**:

- **ORM**: Drizzle ORM with `better-sqlite3` (local SQLite file)
- **Location**: `~/.iptvnator/databases/iptvnator.db` (avoids spaces in path)
- **Schema** (`libs/shared/database/src/lib/schema.ts` — canonical; `apps/electron-backend/src/app/database/schema.ts` is a backwards-compat re-export shim):
    - `playlists` - Playlist metadata (M3U, Xtream, Stalker)
    - `categories` - Content categories (live, movies, series)
    - `content` - Streams/VOD/series items. Besides the catalog fields it carries what a detail view learned and handed back: `backdrop_url`, plus the TMDB identity (`tmdb_id`, `release_year`, `original_title`) that lets an activity row repeat the detail view's lookup instead of rebuilding a weaker one from the display title
    - `favorites` - User favorites
    - `recentlyViewed` - Watch history
    - `epgChannels`, `epgPrograms` - Persisted EPG data
    - `epgChannelMappings` (`epg_channel_mappings`) - Manual EPG channel mappings (defined in `epg-mapping.schema.ts`, re-exported by `schema.ts`)
    - `playbackPositions` - Resume positions
    - `downloads` - Download manager state
    - `recordings` - Live-TV recording lifecycle + start-time channel/EPG snapshot (defined in `schema.ts` beside `downloads`)
    - `appState` - Key-value app state (also tracks one-off data migrations)
    - `tmdbMetadata` - TMDB enrichment cache (details payloads + search match resolutions, keyed by media type/lookup key/language)
    - `vodSourcePins` (`vod_source_pins`) - VOD multi-source per-movie preferred playlist, keyed by a portal-agnostic match key (defined in `vod-source-pins.schema.ts`, re-exported by `schema.ts`)
- **Connection**: `libs/shared/database/src/lib/connection.ts`
    - `createTables()` auto-creates tables on init (`CREATE TABLE IF NOT EXISTS`)
    - Provides full read-write access for `electron-backend` and a read-only mode
    - A root `drizzle.config.ts` configures Drizzle Kit tooling (points at the schema via the compat shim)

**IPC Communication**:

- **Preload script**: `apps/electron-backend/src/app/api/main.preload.ts`
    - Exposes `window.electron` API via `contextBridge`
    - All IPC channels defined here (playlist operations, EPG, database CRUD, external players, etc.)
    - The canonical TypeScript contract is `ElectronBridgeApi` in `libs/shared/interfaces/src/lib/electron-api.interface.ts`; `global.d.ts`, `apps/web/src/typings.d.ts`, and `main.preload.ts` must reference this shared type instead of maintaining separate method lists.
- **Event handlers**: `apps/electron-backend/src/app/events/`
    - `database.events.ts` - Database CRUD operations
    - `playlist.events.ts` - Playlist import/update
    - `playlist-open.events.ts` - Playlist files handed over by the OS (argv, file association, macOS `open-file`); the queue itself lives in `services/playlist-open-request.ts`
    - `epg.events.ts` - EPG IPC registration; freshness/fetch orchestration lives in `epg-fetch.service.ts`, manual channel-mapping resolution and CRUD in `epg-mapping.service.ts`, source orchestration in `epg-worker.service.ts`, per-import lifecycle in `epg-fetch-operation.ts`, worker bootstrap/shutdown and clear protocol in `epg-worker-runtime.ts`, DB lookups in `epg-query.service.ts`
    - `xtream.events.ts` - Xtream Codes API
    - `stalker.events.ts` - Stalker portal API
    - `connectivity-guard.events.ts` - `CONNECTIVITY_GUARD_RESET`: forgets the connection failures recorded for a portal host. Both portal handlers above run every request through the per-host circuit breaker (rules in `@iptvnator/shared/host-health`, process-wide instance in `util/host-connectivity-guard.ts`; the web backend runs the same breaker over its proxy routes) — after 2 consecutive connection-level failures (no HTTP response; `ETIMEDOUT`/`ENOTFOUND`/`ECONNREFUSED`/… but never `ECONNRESET`) requests to that endpoint fail immediately for 30 s. The key is `URL.origin`, not `URL.host`, which would give `http://panel` and `https://panel` one shared record and let a dead TLS listener fast-fail the working HTTP one instead of hanging the full 30 s/15 s axios timeout again, with one half-open trial request afterwards. Any HTTP response (4xx and 5xx included) clears the record. The refusal is a real `Error` whose wording is a renderer contract (`buildHostConnectivityFastFailMessage` in `libs/shared/interfaces`): it must carry no `HTTP Error <code>`, no timeout wording and none of the auth phrases, or Stalker endpoint discovery misclassifies it and lazy portal repair fires against a host just declared dead. Discovery probes are exempt via the `skipConnectionGuard` payload flag (bypass + no failure counting, but successes still clear the record). Every user-driven retry/refresh that issues portal requests must reset BEFORE its first request, or the affordance fast-fails and looks broken; automatic and first-load paths deliberately do not reset. Current senders: Xtream content-gate Retry, Stalker catalog append retry (`retryContentPage`), Stalker search-page retry, `StalkerItvCacheService.refresh()` (Live TV refresh), both account-info dialogs' Retry, the destructive Xtream refresh (`XtreamRefreshFlowService`, before it deletes the cached catalog — one flow shared by both entry points, `PlaylistRefreshActionService.refreshXtream()` and `RecentPlaylistsComponent.refreshXtreamPlaylist()`, which supply only a progress reporter), `StalkerPortalDiscoveryService.discover()`, and `PortalStatusService` on `skipCache`. Kill switch: `IPTVNATOR_DISABLE_CONNECTIVITY_GUARD=1`. Contract: `docs/architecture/host-connectivity-guard.md`
    - `player.events.ts` - External player IPC registration; MPV/VLC lifecycle logic lives in `mpv-session.service.ts`, `vlc-session.service.ts`, and shared `external-player-*` helpers
    - `settings.events.ts` - App settings
    - `electron.events.ts` - App version, etc.

**Workers** (`apps/electron-backend/src/app/workers/`):

- EPG parsing: `epg-parser.worker.ts`; main-process worker lifecycle is coordinated from `apps/electron-backend/src/app/events/epg-worker.service.ts`
- Non-EPG SQLite work: `database.worker.ts` (see `docs/architecture/sqlite-db-worker.md`). Catalog deletes and inserts commit in row-budgeted transactions of ~5,000 rows (`database/operations/catalog-deletion.ts`: per-category row counts → category groups → set-based `DELETE`s scoped to the captured category ids, never playlist-wide, since the worker interleaves requests between commits and a newer import's categories must survive an older refresh; never 100-row autocommit batches, which flush FTS5 segments and re-append index pages to the WAL on every commit, and never one giant transaction, which would starve the main-process and EPG-worker connections past their 5 s `busy_timeout`). Progress events are throttled to one per 100 ms per operation with summed `increment`s (`operation-progress-throttle.ts`); phase starts, totals reached and terminal events are never held back
- Playlist refresh: `playlist-refresh.worker.ts`; explicit cancellation is main-process-owned and terminates the one-shot worker before acknowledging `PLAYLIST_CANCEL_REFRESH` (see `docs/architecture/m3u-playlist-module.md`)

### Xtream Category Management

The Electron Live TV, Movies, and Series category dialog applies Select/Deselect
to search results while a filter is active and to the whole type otherwise.
Button states use the matching group; "Total selected" counts the whole catalog.
Save persists the complete draft, Close discards it, and refresh restores hidden
categories by provider ID and type. See `docs/architecture/category-management.md`.

### Key Features

#### Xtream Live Auto Format

The routed Xtream live host supplies `liveAutoTsUrl` only for Auto with explicit
HLS+TS account evidence, using the canonical URL builder and original headers.
The same web player may try TS once after an owned initial terminal HTTP failure,
before `playing`; the old transport unmounts before the guarded render callback
starts TS. No player preference or playlist cache changes. Manual formats,
unknown formats, DRM, VOD/catch-up and stale sessions are excluded. External
MPV/VLC and Embedded MPV retain manual TS; Video.js segment retry cycles without
a terminal diagnostic also need manual TS. Contract and full support matrix:
`docs/architecture/xtream-portal-compatibility.md` (Initial Auto HLS failure).

#### Xtream Catch-Up Server Timezone

The `{Y-m-d:H-M}` segment of a timeshift URL is read by the panel in ITS
timezone (`server_info.timezone`), never the viewer's (issue #1562).
`withPortal.checkPortalStatus()` normalizes it with
`resolveXtreamServerTimezone()` (`libs/shared/interfaces`, an ICU-resolvable
name, else a `UTC±HH:MM` derived from the `time_now`/`timestamp_now` clock
pair) and persists it on the playlist row through
`IXtreamDataSource.rememberServerTimezone` — Electron: one conditional
`json_set` UPDATE (`DB_SET_PLAYLIST_SERVER_TIMEZONE`) guarded by the row's
current connection; PWA: `PlaylistsService.transformPlaylistMeta` — because
the Favorites / Recent resolver reads the STORED row, not the store, and the
worker interleaves requests, so no read may precede the write.
`DB_GET_PLAYLIST` projects it back from the row payload, and a server URL
change drops it until the next account-info check. The same value converts
timestamp-less EPG
`start`/`end` strings. Contract:
`docs/architecture/xtream-portal-compatibility.md` ("Start time is the
panel's clock, not the viewer's").

#### M3U URL User-Agent

- The URL import form accepts an optional User-Agent and stores it as
  `Playlist.userAgent`. Electron sends it on initial download, manual refresh,
  and startup auto-update. The self-hosted PWA sends it through the registered
  target `/parse` backend proxy for import and refresh; a matching backend is
  required, and browser playback-header restrictions still apply.
- Reuse the existing source editor and channel-over-playlist playback header
  precedence. Contract: `docs/architecture/m3u-playlist-module.md`
  ("User-Agent for URL sources").

**Playlist Support**:

- M3U/M3U8 files (local or URL)
- Xtream Codes API (`username`, `password`, `serverUrl`)
- Stalker portal (`macAddress`, `url`)

**Stalker playback links**: `create_link` runs only when the catalog row sets
`use_http_tmp_link` or `use_load_balancing`; otherwise the static `cmd` plays
directly. One helper decides
(`resolveStalkerStaticPlaybackUrl` in
`libs/portal/stalker/data-access/.../stalker-link-semantics.utils.ts`), applied
by `fetchStalkerPlaybackLink()` for ITV/VOD/radio and by
`StreamResolverService` for Favorites/Recently Viewed. It falls back to
`create_link` for anything it cannot resolve alone: no row to read flags from,
a relative/query-only command (the VOD `has_files` rewrite), a non-HTTP scheme,
or a loopback host; an episode (`series` set) always mints, since the parameter
selects the episode server-side. Temporary links live ~5 s, so no resolved URL
is persisted or replayed — favorites and recently-viewed store the `cmd`,
playback positions store ids, and the main-process context map stores headers
keyed by origin+path. Downloads are the one exception (they must retry a URL).
`forced_storage`/`play_token` are deliberately unwired. Contract:
`docs/architecture/stalker-portal.md` ("Playback Link Resolution").

**Opening a playlist from the OS** (Electron only): a `.m3u`/`.m3u8` path passed
on the command line, opened through a file association, or delivered by macOS'
`open-file` event is normalized to an absolute path in the main process
(`services/playlist-open-request.ts`) and queued there. The renderer
(`apps/web/src/app/services/playlist-open-request.service.ts`) subscribes to the
`OPEN_FILE` push **before** calling `announcePlaylistOpenListener`, which is
what makes the main process flush. `OPEN_FILE` is the only way out of the
queue, and a request stays there until the renderer confirms receipt via
`acknowledgePlaylistOpenRequest` — `webContents.send()` returns before the
listener runs, and a reload or dead render process keeps the `WebContents`
alive, so a successful push is not proof of delivery. Anything unacknowledged
is replayed to the next renderer that announces itself. The renderer
imports them on a single promise chain so a burst arrives in a deterministic
order. `addPlaylist$` in `libs/m3u-state` uses `concatMap` (not `switchMap`)
for the same reason: each action carries a different playlist, so a newer add
must never cancel an older one's write, EPG fetch and navigation. The import
itself reuses the normal file path
(`updatePlaylistFromFilePath` → `PlaylistActions.addPlaylist`), so persistence,
playlist-scoped EPG, and the navigation to the new playlist all behave exactly
like a dialog import.

The OS-level registration that makes those paths reachable is
`fileAssociations` in `electron-builder.json` — one entry per extension, each
with its own `mimeType`. Electron Builder derives all three platform
registrations from it: macOS `CFBundleDocumentTypes` (which is what makes
`open-file` fire from Finder), the NSIS registry entries, and, on Linux, the
desktop entry's `MimeType` plus `/usr/share/mime/packages/iptvnator.xml` for
deb/rpm/pacman. Two traps: it assigns the derived `MimeType` _after_ spreading
`linux.desktop.entry`, so declaring `MimeType` there is silently overwritten and
must not be used; and it appends `%U` to `Exec`, so Linux file managers hand
over percent-encoded `file://` URIs rather than paths —
`createPlaylistOpenRequest` decodes them before the extension check. `%U` is
also the _plural_ exec code, so a multi-file selection arrives as one launch
with one argument per file; `extractPlaylistOpenRequestsFromArgv` returns all
of them and `enqueueAll` queues the batch, because stopping at the first match
would silently drop the rest of the selection. Adding an exec code to
`linux.executableArgs` would suppress the `%U` but also pass that code to the
app as a real argument, so it is not an option.

**Video Players**:

- The Embedded MPV native-view dock follows app theme tokens as a solid app
  surface, including Material icon-button disabled states. Over-video loading,
  stalled and feedback overlays keep a paired light-on-dark palette. Video
  viewports remain black in windowed and fullscreen modes. Shared EPG panels
  use the library-local app-token palette in `libs/ui/epg/src/lib/_epg-theme.scss`.
  Theme/contrast contract: `docs/architecture/iptvnator-ui-guidelines.md`.

- Built-in web players: HTML5+hls.js, Video.js, and ArtPlayer. The HTML5
  player and ArtPlayer pick their source engine from one URL rule,
  `resolvePlaybackUrlSourceKind()` in `libs/playback/util` (`mpd` → Shaka,
  `m3u8`/`m3u` → hls.js, `ts`/`m2ts`/extension-less → mpegts.js, every other
  container → native `<video>`), so hls.js never receives an `.mkv`/`.webm`
  file. The HTML5 native `<source>` carries a `video/mp4` hint only for
  MP4-family files (`resolveNativeSourceMimeType`); a hint `canPlayType()`
  rejects would make the browser skip the source.
- mpegts.js `1.8.1` errors from all three built-in players cross one
  version-locked structured evidence boundary in `libs/playback/util`. It
  retains only exact public type/detail pairs, pair-derived stage/failure,
  terminal disposition, and a
  validated HTTP 4xx/5xx status; raw messages and arbitrary `info` never reach
  stored or rendered diagnostics. HTTP/network failures avoid false decoder
  recommendations, while exact format, codec, truncated-stream, and
  MediaSource failures retain actionable recovery guidance. This diagnostic
  layer remains separate from the shared `PlayerController` controls contract.
- Browser playback diagnostics and recovery policy live in
  `libs/playback/util` and are exported by `@iptvnator/playback/util`.
  Public engine errors cross allowlisted sanitizers into a
  `PlaybackDiagnostic`; `recommendPlaybackRecovery(context)` then ranks at
  most three actions, and `WebPlayerViewComponent` executes only the action
  the user selects. The policy is a sibling of `PlayerController`; shared
  controls only gate interaction while the diagnostic panel is visible.
  `WebPlayerViewComponent` owns a host-derived content-session key that is
  stable for the mounted logical selection, attempted target IDs, the temporary
  player override, and VOD handoff position. Its `PlaybackBinding` is exactly
  `{ generation, target }`, while every source/target/reload application uses a
  fieldless opaque `Symbol` token. Diagnostic storage uses a separate fieldless
  intent `Symbol`, and source applications advance a third fieldless revision
  `Symbol` that clears only the VOD handoff position; target-only switches and
  Retry leave that revision stable. None of these ownership primitives contains
  URLs, headers, DRM material, or credentials. The application effect
  synchronizes the content session before tracking intent, so clearing a
  temporary player override cannot schedule a duplicate application or header
  handoff. Every application start clears both the diagnostic owner and backing
  signal before asynchronous header setup; a current false result or rejection
  leaves them clear, and a stale completion cannot erase a newer owned
  diagnostic. Each
  rendered web or Embedded MPV application captures its nullable binding, the
  application and source-revision tokens, and live/VOD flag; a time update
  changes resume state only while that exact capture still owns the current
  application. A recommended built-in
  player temporarily
  outranks the host override and saved player for that mounted content session,
  never mutates `Settings.player`, and resumes finite VOD position on a
  best-effort basis; live playback returns to the live edge. Retry and
  alternative sources preserve attempts, while a different content-session key
  or component teardown resets them. Recovery recommendations never
  auto-switch, persist history, learn across sessions, or emit telemetry.
  The policy projects attempted inline target IDs through the validated
  canonical source/target capabilities and excludes every attempted engine
  family, so HTML5 and ArtPlayer are not separate hls.js recoveries. Network
  and generic unknown evidence fail closed to Retry/alternative source; the
  exact Shaka browser-unsupported preflight marker is the sole unknown-code
  exception. PWA capability suppresses managed MPV/VLC, and ClearKey/KODIPROP
  DRM suppresses external targets because its payload is not transferable. Raw
  engine messages, arbitrary data, and credentials never enter recommendation
  evidence or ownership state. MPV/VLC actions remain mounted after an attempt
  and expose credential-free per-target launching/started/playing/error state;
  only an exact Electron `playing` update is labelled Playing. One handshake is
  allowed at a time. The renderer claims the credential-free content identity
  before awaiting Electron, so primary Play is disabled and a launching or
  closable-error alternative remains owned before the controller commits it.
  Every route action that can start the same external playback, including
  Restart and the provider-source shortcut, observes that local pre-IPC guard.
  The Xtream VOD diagnostic-fallback handler records the same route-scoped
  destination and pending generation before invoking MPV/VLC, so route reuse
  cannot orphan that process outside the next route's close-before-play path.
  Its fieldless intent is bound to the exact session returned
  by the source owner's launch promise, so a late timed-out attempt cannot take
  over a retry; later global updates must match that ID. A replacement waits for
  confirmed teardown of the tracked external process, applies the old exact
  close before launch, and cancels an unlaunched handoff if diagnostic ownership
  changes. Process teardown has bounded graceful and forced confirmation
  windows, and reusable MPV bounds the IPC command that precedes them; if any
  stage cannot reach a confirmed exit, the exact session stays live and the
  replacement fails closed instead of overlapping it. A process-wide teardown
  gate starts before any potentially slow teardown preparation, including VLC
  position flush and a reused player's protocol quit, and rejects every
  MPV/VLC spawn until that exact child reports exit. If bounded
  teardown fails while a fresh launch is still pending, that launch IPC rejects
  and the exact session remains a closable error instead of hanging forever.
  If a pre-content reuse failure has no still-live displaced session to restore,
  the replacement error keeps its attached closer so Stop can retry the orphaned
  child teardown. A terminal error without a closer is never restorable.
  A failed close is single-flight only while its promise is pending: Stop can
  retry the same exact child after a bounded confirmation failure. Reuse maps
  the child to its current content session, so a stale older closer becomes a
  no-op instead of terminating a newer `loadfile`/VLC enqueue handoff.
  A duplicate close for an already closed session returns its terminal snapshot
  without re-entering the saved closer, and a late process error cannot revive
  that terminal session. Reused MPV commands are bound to the socket captured
  for that exact child, so a later process cannot inherit a stale protocol quit.
  Stop observed before a pending MPV content command or VLC enqueue command
  prevents that command from dispatching. A source handoff fails closed while
  a live session has no closer (`canClose: false`); renderer Dismiss is not
  teardown confirmation. That denied handoff advances neither the multi-source
  switch token nor the playback generation, so it cannot cancel the sole launch
  already in flight.
  VLC rechecks the gate at each concrete spawn after port allocation or reuse
  work; if a post-start fallback is blocked there, the opened session becomes
  an error rather than retaining a false started status. A failed RC-port
  allocation never claims reuse ownership, so the fallback VLC child retains
  its exact one-shot closer.
  Reuse failures before a content command restore the globally displaced
  renderer session, not the reusable process's prior owner, and only while the
  exact displaced-session ID is still active; after
  `loadfile`/VLC `clear` is dispatched,
  the replacement owns the process and remains a closable error instead of
  restoring stale content metadata. Stop during an in-flight MPV or VLC reuse
  command, including during failed-command teardown or the subsequent VLC
  fallback port-allocation wait, settles that exact close without falling
  through to a fresh spawn;
  a stopped VLC spawn error that reports only `close` also settles its original
  launch IPC with the exact closed session;
  a fresh fallback retires the old child's exit under its prior session so it
  cannot close the replacement. Source handoffs recheck ownership after launch
  and accept only `opened`/`playing`; a stale returned session is closed exactly
  and a Stop-returned `closed` session is never committed. If that exact stale
  close fails, its credential-free destination owner is retained for the next
  close attempt. Retained destination ownership is scoped to the initiating
  playlist/VOD route key, so route reuse cannot expose Stop for the previous
  movie's external session. Play/Resume capture that route key before awaiting
  close and cancel if navigation changes it; a late diagnostic fallback closes
  its exact returned session instead of adopting it on the new route. They
  supersede an older source resolution before awaiting the shared
  close-before-replacement path, and accepting a diagnostic fallback retires
  the same older resolution before opening MPV/VLC. They publish the route-source
  badge, caption evidence, and position only after start succeeds.
  Closable errors still participate in every replacement close and keep Stop as
  the global dock's only teardown affordance; Dismiss is reserved for terminal
  errors that have no closer. The shared `isLiveExternalPlayerSession` predicate
  keeps M3U and series ownership while
  such an error can still be stopped; consumers must not treat every `error`
  status as terminal.
  If the local handshake times out after an exact Electron session is known,
  that ID remains
  correlated so a later exact update can recover the UI. The global dock mirrors
  those statuses, keeps closable errors visible until Stop confirms teardown and
  terminal errors visible until dismissal, and intentionally has no retry because
  it does not own the original launch headers or credentials.
- DASH + ClearKey (M3U module): `.mpd` channels play through a lazily loaded
  Shaka Player source engine inside the HTML5 and ArtPlayer components (no new
  player in settings). ClearKey keys come from `#KODIPROP:inputstream.adaptive.*`
  lines, post-processed into `Channel.drm` by `extractDrmFromRaw()` in
  `libs/shared/m3u-utils` (hooked in `createPlaylistObject()`, covering all
  import paths). DASH channels always play inline: `isDashChannel()` bypasses
  the external-player setting (radio precedent) and routes Video.js/MPV/VLC/
  embedded-MPV users to the HTML5 player via `playerOverride` (ArtPlayer keeps
  ArtPlayer). Unsupported license types (Widevine/PlayReady — out of scope,
  need the castLabs Electron fork) surface a DRM playback diagnostic instead
  of crashing. ClearKey EME works in stock Electron. Engine:
  `libs/ui/playback/src/lib/shaka-engine/`. Its DOM-free Shaka `5.2.4`
  diagnostic boundary lives in `libs/playback/util`; it version-locks public
  severity/category/code evidence, ignores
  recoverable error events, treats rejected loads as terminal lifecycle
  outcomes, preserves exact public DASH text-parser category/code evidence with
  unknown stage/failure, and never retains or renders raw messages or
  `error.data`. A failed browser-support preflight stays generic-unknown but
  carries the exact app-owned
  `PlaybackRuntimeSupport.ShakaBrowserUnsupported` marker, preserving managed
  external fallback only for clear transferable DASH; PWA capability and
  KODIPROP DRM still suppress it. Details in
  `docs/architecture/m3u-playlist-module.md` ("DASH + ClearKey Playback").
- External players: MPV, VLC (via IPC to Electron backend)
- Display sleep during playback: `PlaybackKeepAwakeService`
  (`apps/web/src/app/services/playback-keep-awake.service.ts`) watches every
  `<video>` via document-level capture listeners (media events don't bubble;
  release listeners sit on the tracked element because Chromium's
  removed-from-DOM pause never reaches the document) and, while any video is
  playing and the document is visible (or the playing video is in
  picture-in-picture — the PiP surface survives a minimized window), holds a
  display-sleep lock: in
  Electron a main-process `powerSaveBlocker` behind
  `window.electron.setPlaybackKeepAwake`
  (`apps/electron-backend/src/app/services/playback-keep-awake.service.ts`;
  auto-cleared on renderer reload/crash), in the PWA the Screen Wake Lock
  API. Radio's `<audio>` deliberately never blocks display sleep. Embedded
  MPV holds its own blocker in `EmbeddedMpvNativeService`; external MPV/VLC
  inhibit the screensaver themselves.
- Embedded MPV (experimental, macOS/Windows/Linux): renders mpv video inside the Electron window through a native addon. Two per-session knobs are captured at session creation from the main-process settings mirror (`readEmbeddedMpvSessionOptions()`, read in the `EMBEDDED_MPV_CREATE_SESSION` handler — never inside the service, whose specs would otherwise construct electron-conf): `Settings.embeddedMpvExtraOptions` (free-form `key=value` libmpv lines, forbidden embed-critical keys refused by the form, network defaults `network-timeout=10` + ffmpeg `reconnect` prepended, applied on every engine after its built-ins — Windows/macOS via `mpv_set_option_string`, Linux through a user-only `--include` config file, frame-copy as the helper's first stdin line — never on a command line, where `ps` could read a credential-bearing header option) and `Settings.embeddedMpvAutoReconnect` (default on: `EmbeddedMpvReconnectCoordinator` in `embedded-mpv-reconnect.ts` reloads the last playback on `error`, or `ended` for live, only if it had played, with 2 s→30 s backoff, six attempts per outage, budget reset after 30 s stable playing, cancelled by user loads/pause/dispose; a recording running at the drop is finalized as an interrupted partial when the reload actually replaces the stream (a stream that recovers on its own keeps recording) and restarted into a new file once that reload plays, and an external subtitle file added through `sub-add` is re-added once the reload plays unless the user picked another track or loaded something else since; the renderer only displays `EmbeddedMpvSession.reconnect`). Contract: `docs/architecture/embedded-mpv-native.md` ("Session Options", "Network Auto-Reconnect"). macOS uses the libmpv render API in an `NSOpenGLView`; Windows uses in-process libmpv with `--wid` against an app-owned child `HWND`; Linux spawns an out-of-process `mpv --wid=<x11-window>` controlled over a JSON IPC socket (X11/XWayland only, requires system `mpv` on PATH; subtitles/speed/aspect/recording are not exported there). mpv's own screensaver inhibition does not apply to any of these paths, so `EmbeddedMpvNativeService` holds an Electron `powerSaveBlocker` (`prevent-display-sleep`) whenever any session's status is `playing`, and releases it on pause, dispose, or shutdown. Renderer bounds are CSS pixels; the service converts them to native units in the main process (`embedded-mpv-bounds.util.ts`: × page zoom everywhere, × display scale on Windows/Linux whose child windows are positioned in physical pixels; frame-copy bounds stay unscaled), and the session controller re-syncs bounds when `devicePixelRatio` changes and polls (500 ms, drift-gated) for position-only layout shifts that `ResizeObserver` cannot observe. Arrow-key and ±10 s button steps go through the relative `seekEmbeddedMpvBy` IPC (mpv `seek <delta> relative+exact`; addon export `seekBy`, helper stdin command `seek-by`, Linux JSON IPC), never an absolute target computed from the renderer's whole-second, 500 ms-polled `positionSeconds` — that stale base collapsed rapid presses onto one target (about 1 s of progress per press); only the timeline scrub commits an absolute `seek`. Service: `apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`; full architecture: `docs/architecture/embedded-mpv-native.md`.
- Embedded MPV frame-copy engine (experimental, macOS Apple Silicon + Linux
  x64 + Windows; enabled via `Settings > Playback > Embedded MPV: frame-copy
engine` (restart required) or
  `IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY=1` on top of the embedded MPV
  experiment flag): a per-session helper renders mpv offscreen (CGL on macOS,
  EGL on Linux, WGL on Windows), publishes BGRA frames into a shm ring, and the
  preload frame pump uploads them to
  `<canvas data-embedded-mpv-frame>`. Shared `app-player-controls` owns the DOM
  UI; native-view retains the legacy dock. On Linux, only
  `iptvnator_mpv_helper` may link libmpv; Electron, its shipped libraries, the
  addon, and frame reader must not. Pristine afterPack/unpacked layouts scan
  Electron libraries recursively; extracted Snap payloads exclude only the
  package-manager `lib/**` and `usr/lib/**` trees overlaid into the same root.
  Every other directory remains recursive, and Electron-library symlinks still
  fail closed. `electron-backend/native{,/**/*}` is excluded from `app.asar`;
  `afterPack` alone owns the profile-normalized unpacked native tree, and
  package checks reject every archived `/electron-backend/native/**` entry.
  Packaged addon, frame-reader, and helper discovery uses only package-owned
  `app.asar.unpacked` paths; cwd/dist candidates remain development-only.
  Official x64 packages use three separate profiles:
  DEB/RPM/Pacman depend on system libmpv plus the helper's direct
  EGL/GL/GBM interfaces, AppImage/Snap bundle the pinned LGPL closure, and
  Flatpak bundles the same closure. Flatpak is an isolated packaging pass and
  keeps `iptvnator` as the real Electron ELF so Electron Builder's
  `electron-wrapper` passes it directly to Zypak. Other Linux targets retain the
  conditional `iptvnator` wrapper and `iptvnator.bin`. Mixed
  Flatpak/non-Flatpak target sets fail before mutation. Exact system
  dependencies are DEB=`libmpv2,libegl1,libgl1,libgbm1`,
  RPM=`mpv-libs,libglvnd-egl,libglvnd-glx,mesa-libgbm`, and
  Pacman=`mpv,libglvnd,mesa`. The DEB contract is verified on Ubuntu 24.04+;
  Ubuntu 22.04 users need the x64 AppImage because Jammy provides `libmpv1`.
  ARM packages are marker-only. Stored or explicit opt-ins cannot bypass the
  fail-closed packaged manifest/file/hash gate and bounded `--runtime-probe`;
  any failure keeps the sandbox enabled, records a stable reason, and falls
  back to native-view without crashing. Snap is `core22`/strict and uses an
  exact private `shared-memory` plug plus the `graphics-core22` content plug at
  a real empty mode-0755 `$SNAP/graphics`, with external `mesa-core22` as the
  default provider. Its only provider-data layouts bind `/usr/share/libdrm`
  from `$SNAP/graphics/libdrm` and symlink `/usr/share/drirc.d` to
  `$SNAP/graphics/drirc.d`. Installed-Snap CI requires controlled unavailable
  status after disconnect, then reconnects and requires success. Static
  artifact verification requires regular `desktop-init.sh`,
  `desktop-common.sh`, and `desktop-gnome-specific.sh` files at the Snap root,
  with `desktop-init.sh` executable. The helper links `libGL.so.1`, and
  probe/playback share a sanitized loader environment
  in which ambient audit, preload, library, graphics-driver, and shell-startup
  overrides are removed; the validated private closure plus trusted host GL,
  graphics-content, core22 base x64, and exact GNOME-platform roots have
  explicit precedence. The core22 base stays ahead of GNOME so the older
  `libedit.so.2` requiring `libtinfo.so.5` cannot shadow the base ABI. The
  extracted-artifact verifier removes the identical unsafe loader/graphics/
  shell set before direct helper smoke while preserving selectors such as
  `LIBGL_ALWAYS_SOFTWARE`. Snap fixes the wrapper `PATH`,
  removes exported `BASH_FUNC_*` functions, and
  launches probe/playback through the regular executable
  `$SNAP/graphics/bin/graphics-core22-provider-wrapper`; a missing or
  disconnected provider returns `snap-graphics-provider-unavailable` before
  helper spawn. The packaging-only
  `--embedded-mpv-runtime-probe` app switch runs the complete packaged gate
  before BrowserWindow startup and emits one availability JSON line. A nonzero
  helper exit keeps top-level reason `helper-probe-failed`; `helperReason` is
  present only for an exact protocol-v1 line carrying a fixed allowlisted
  reason, and its optional `helperDetail` must be 1–1024 printable ASCII
  characters. Invalid detail suppresses both helper fields. Every probe uses
  an explicit 16 MiB aggregate captured-output ceiling independent of tracing.
  With `IPTVNATOR_TRACE_PLAYER=1`, non-empty helper stderr is emitted separately
  as one JSON-escaped stderr line with a 16,384-character `stderr` limit and an
  explicit `truncated` field; trace-write failure cannot change availability.
  Installed-Snap CI enables Mesa EGL/GL diagnostics through this bounded
  channel. The exact packaged Flatpak `/app` context reconstructs only
  Freedesktop Platform 24.08's immutable
  `__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS`; its CI smoke invokes that
  application-level probe instead of the helper directly. The packaged x64
  Playwright smoke runs its fixture-contract target first and passes Chromium
  `--ignore-gpu-blocklist` so CI llvmpipe exposes WebGL2; this does not bypass
  the runtime gate, and `--no-sandbox` remains root-only. Bundled Linux
  packages carry hash-validated
  `embedded-mpv-notices.json`, `THIRD_PARTY_NOTICES.txt`, and `licenses/**`.
  CI caches the staged runtime plus immutable source inputs, never finished
  notices or the compliance tarball; it regenerates those notices and the
  VCS-metadata-free `linux-frame-copy-runtime-sources.tar.xz` for the current
  checkout while preserving the exact pinned six recursive libplacebo
  submodule records. Each record is canonical `full-commit safe/path`;
  clone-depth dependent `git describe` annotations are discarded and never
  form part of the provenance identity. Its source index carries the globally sorted libplacebo
  directory/file/symlink inventory; file hashes, sizes, executable bits, link
  targets, aggregates, and canonical tree digest must match the trusted pinned
  checkout. The archive has an exact member/type layout and its
  `metadata/archive-sha256.txt` records must match the actual source archives.
  Concatenated tar/xz streams are inspected past every end marker. Every
  bundled x64 package manifest binds the final archive's SHA-256 and repository
  revision; system and marker-only packages do not carry that binding. Snap
  Store
  publication runs only from a public `v*` GitHub release that already
  contains the Snap assets and exactly one source archive. Before any upload,
  the workflow hashes and checks the archive's exact member/type set and size
  bounds, verifies its clean tag revision, pinned sources including the six
  recursive submodule records and exact libplacebo tree digest, legal payload,
  and exact released tooling, then performs bounded extraction and static
  validation for every Snap. That public-release boundary independently
  revalidates the exact strict `meta/snap.yaml` graphics/shared-memory
  contract and enumerates `resources/app.asar`, rejecting any archived
  `electron-backend/native/**` payload before publication. Its bounded ASAR
  header reader uses only Node built-ins and released local tooling, so the
  clean tag checkout does not require `node_modules`. Exactly one x64 Snap
  must have matching
  `sourceArchive` and `sourceRuntime`; any non-x64 Snap remains marker-only.
  Checkout and artifact-transfer actions are pinned to full commits; checkout
  does not persist credentials, and repository credentials are scoped to
  download steps. A secretless verification job copies assets through
  no-follow descriptors, checks them before and after inspection, writes an
  exact receipt, fully reverifies a root-owned read-only snapshot, and
  transfers only that data through the pinned artifact service while passing
  the receipt digest separately through a job output. The dependent publish
  job uses a bounded `ubuntu-latest` runner with no checkout or release-tag
  code, verifies that digest plus the exact receipt, asset hashes, and
  file-only layout, root-seals the data again, and installs Snapcraft directly.
  Its final fixed shell step alone receives the Store credential, resolves no
  PATH command, executes no released code, and exposes that credential only to
  each exact
  `/snap/bin/snapcraft upload --release=edge` process. Candidate/stable
  promotion is manual after installed-Snap frame-copy and missing-runtime
  fallback smoke; GitHub Actions never promotes automatically. On Windows,
  package validation requires the exact MPV DLL named by the helper's PE import
  table beside the executable.
  Backend adapter:
  `apps/electron-backend/src/app/services/embedded-mpv-frame-copy.adapter.ts`;
  shared-controls adapter:
  `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.ts`;
  helper: `apps/electron-backend/native/helper/`; canonical packaging/runtime
  contracts: `docs/architecture/embedded-mpv-native.md` and
  `tools/embedded-mpv/README.md`.
- Shared player-controls layer: `libs/ui/playback/src/lib/player-controls/` exports the engine-neutral `PlayerController` contract, standalone `app-player-controls`, a generic web-video adapter/helper, and component-scoped `WEB_PLAYER_SHARED_CONTROLS` rollout token. Its subtitle menu carries capability-gated advanced subtitle support (#1408): external subtitle file loading, a ±0.5 s timing-offset row, and size/color styling persisted in the shared `subtitleStyle` localStorage key. HTML5/ArtPlayer implement it through the neutral source bridge (`.srt`/`.vtt` via a DOM file picker with encoding detection, native `TextTrack` rendering, `::cue` styling, delay only while the loaded file is the selected track; picks are source-generation-guarded and engine deselection precedes external track activation); the canonical style shape and clamp/normalize rules are shared with the main process via `@iptvnator/shared/interfaces` (`subtitle-style.util.ts`). Embedded MPV frame-copy implements it through new helper protocol commands (`sub-add`/`sub-delay`/`sub-scale`/`sub-color`, main-process file dialog, ASS supported, delay for all tracks). Video.js shared mode, vendor-chrome paths, native-view, and the Linux out-of-process path advertise no such capability and render no UI. Contract details: `docs/architecture/player-controls-contract.md` ("Advanced subtitle support"). Shared controls include a per-session quality menu (Auto + “1080p”-style levels via `setQualityLevel`; `AUTO_QUALITY_LEVEL_ID` restores ABR): the capability derives from the manifest — advertised only when the source exposes >1 video rendition (multi-variant HLS via hls.js `nextLevel`/`manualLevel`, DASH via Shaka variant tracks pinned to the active variant's exact audio stream (`audioId`, language fallback) with ABR toggled off for manual picks, Video.js via videojs-contrib-quality-levels) — so single-bitrate VOD and raw MPEG-TS never show it, nothing persists to Settings, and Embedded MPV/external players report the capability false. In fullscreen, `app-player-controls` shows a pointer-transparent media-title overlay at the top while controls are revealed (`mediaTitle` input: movie/channel/series name, plus an `S01E03` second line for episodes; series names flow from the detail views through `PortalInlinePlayerComponent.seriesTitle` and `WebPlayerViewComponent.mediaTitle`). Persisted `Settings.webPlayerSharedControls` is default-ON (absent stored values coerce with `!== false` in every normalization site; only an explicit false — the Settings > Playback checkbox — opts out to the legacy vendor chrome), and its checkbox appears only when HTML5, Video.js, or ArtPlayer is selected. The shared surface has explicit touch semantics (`ControlsSurface.wasTouchInteraction`): viewport taps toggle overlay visibility instead of pausing, the volume popover opens on tap instead of hover, coarse pointers get a taller scrub strip, and at container widths ≤640px the bar reflows to two rows (full-width timeline above transport + an end-aligned, wrapping actions cluster with 40px buttons whose panels remain unclipped). Only keyboard-originated focus pins the bar open: Chromium also focuses a clicked `<button>`, so `ControlsSurface.wasPointerInteraction` attributes a `focusin` to a recent `pointerdown` inside the focused element and such focus reveals without blocking auto-hide (otherwise the fullscreen button left the controls on screen until a click-to-pause on the viewport); the press record is discarded on the first bar focus event or any `keydown`, a `pointerdown` inside the bar releases a keyboard pin, and a `keydown` bubbling out of a bar control re-pins it, since operating a focused control produces no focus event. A completed pointer click then releases the focus it left on the control (`onBarClick` → `ControlsSurface.releasePointerFocus`, attributed by `wasPointerClick`: non-empty click `pointerType`, else a recent press inside the clicked element): a focused control captures the keyboard — Space and Enter re-activated the clicked button and `ControlsShortcuts` yields to any interactive element in the key's path, so after a click on fullscreen Space left fullscreen instead of pausing. Keyboard activation (empty `pointerType`) keeps focus, only buttons and range sliders are released, Chromium keeps its sequential-focus starting point at the blurred control so Tab continues from it, and the volume popover ignores the release's `focusout` (`wasPointerFocusRelease`). Deliberately dropped vs. vendor chrome (opt-out retains them): Video.js spatial navigation, ArtPlayer screenshot/AirPlay/web-fullscreen/mini-progress/vendor gestures — listed in the contract doc's "Known differences" section. `WebPlayerViewComponent` snapshots the preference into the immutable token for each new player host. The parent `/workspace` route awaits the initial `SettingsStore` load, including cold-start direct links, before this snapshot can occur. Saving applies to the next host without an application restart; an existing session never changes controls mode in place. Embedded MPV ignores the web-player preference: frame-copy always uses shared DOM controls through `EmbeddedMpvControlsAdapter`, native-view retains its compositor-safe legacy dock, and external MPV/VLC retain their own UI. The Embedded MPV host selects exactly one controls UI for its reported engine. `showControls=false` detaches the shared surface, modal overlays gate frame-copy playback shortcuts, fullscreen remains DOM-based with Embedded MPV bounds sync — its owner is the `app-web-player-view` host (`WebPlayerViewComponent.fullscreenSurface`, passed to every engine as `fullscreenTarget`), not the engine shell, because the view remounts the engine component per playback application and the Fullscreen API exits when its element leaves the document; that is what keeps fullscreen across episode/channel/alternative-source switches (the vendor-chrome opt-out still loses it) — and a playback/session transition key prevents engine or session handoff from presenting stale recording feedback while timers and pending commands are cancelled. Same-session IPC replies yield to a broadcast snapshot received while the command was pending, so a successful recording acknowledgement cannot be rolled back by a stale reply. The built-in HTML5/hls.js player is the second guarded consumer: `HtmlVideoPlayerComponent` provides a component-scoped `WebVideoControlsAdapter`, while its neutral `web-video-support` bridge is shared with ArtPlayer and owns HLS/Shaka(DASH)/native tracks, MPEG-TS VOD duration correction, caption preference, and source cleanup. `HtmlVideoElementSession` owns native video-event lifecycle, persisted volume, and start-time/time/ended propagation. Video.js is the third guarded consumer: `VjsPlayerComponent` provides a component-scoped `WebVideoControlsAdapter`; its bridge rebinds the current Tech video after `playerreset`, exposes source-stable audio/subtitle IDs, preserves caption preference and explicit subtitle-off state, and reads Video.js duration. Reset-driven raw MPEG-TS changes pause first, coalesce to the latest desired source, preserve actual volume across Video.js's reset, and restart when authoritative live/VOD metadata changes. In shared-controls mode, Video.js native controls, click/double-click/hotkey actions, and spatial navigation are disabled. ArtPlayer is the fourth guarded consumer: `ArtPlayerComponent` provides a component-scoped `WebVideoControlsAdapter`; `ArtPlayerSourceSession` owns HLS/DASH(Shaka)/MPEG-TS/native sources, the neutral web-video bridge, exact cleanup, and a destroyed-session guard for delayed `customType` callbacks, while `ArtPlayerVideoSession` owns native media/ArtPlayer events. Shared ArtPlayer mode uses authoritative live/VOD metadata, HLS/Shaka/native tracks and caption preference, MPEG-TS VOD duration correction, and reapplies app volume directly after ArtPlayer restores its own stored volume. Vendor chrome/hotkeys are disabled, and a transparent capture layer gives shared controls exclusive click and double-click ownership. `WebPlayerViewComponent.resolvedIsLive` supplies authoritative metadata; visible playback diagnostics disable shared pointer/keyboard ownership and exit only the shared controls' resolved fullscreen owner (the host-supplied `fullscreenTarget`, i.e. the `app-web-player-view` host, else the engine shell) so ranked recovery actions remain visible. The view also renders `app-fullscreen-channel-panel` beside the engine, staged on `fullscreenSurface` and withheld (`enabled=false`) for native-view Embedded MPV, which paints above the DOM (confirmed frame-copy support survives the unknown probe during a channel remount, preserving panel search/scroll; initial unknown and confirmed native/unsupported results withhold the panel): a live host provides `FULLSCREEN_CHANNEL_PANEL` (`panelTemplate` + optional `panelTitle`, gated on `Settings.fullscreenChannelPanel`, default on, offered only for web players with shared controls and for Embedded MPV; the M3U host returns null while its VOD detail hosts the player) and the panel slides that list over the video in fullscreen — left-edge hover dwell, a touch tap on that edge, or `C`; nothing is drawn while it is closed (no handle) and the hot zone stops above the controls bar; scrim/Escape/mouse-leave close it, while a CDK overlay opened from the list counts as the panel (hover keeps it open, Escape closes the overlay first); the header is one row (search whose placeholder carries the host title + close); the list stays mounted per fullscreen session. Providers: M3U `VideoPlayerComponent` (`app-m3u-fullscreen-channel-list`, a local icon-only all/groups/favorites/recent switcher over a second `ChannelListContainerComponent` in `compact` mode — no per-view title/sort/collapse headers, and the groups rail pinned to 148px without the sidebar's persisted width — with `resetActiveChannelOnDestroy=false`, and radio plus recognized movies filtered out of the list it is handed, since `app-audio-player` and the VOD detail shell each replace the fullscreen-owning `app-web-player-view`; every panel view resolves against that one list; with MPV/VLC configured only DASH rows remain, since other streams replace the inline host with the external-player UI), Xtream `LiveStreamLayoutComponent`, `StalkerLiveStreamLayoutComponent` (list markup is one `ng-template` stamped twice, `#scrollContainer` per copy; a blank panel field shows the category independently of sidebar search, or the windowed full cache when All Items playback has no selected category; the panel's search results are windowed by `PanelSearchWindow`, and on a paged portal the panel copy keeps requesting pages while its matches do not fill it, even while the sidebar's own search is active; closing the retained panel pauses paging, and reopening resumes automatic filling; inline video commits the selected channel with resolved playback, retaining the old selection, EPG and recording metadata during a pending or failed replacement), `UnifiedLiveTabComponent` (keeps the previous detail, and so the fullscreen player, mounted until the next selection resolves, with `activeItem` paired to that detail so the session key and recording metadata keep describing the stream on screen — only the `activeUid` row highlight moves ahead, a second activation of the row still resolving folds its start-playback or auto-open intent into that request instead of launching the retained stream, and a failed replacement retains the previous video, catch-up and session and restores its row highlight; Xtream's two `PortalChannelsListComponent` instances relay favorite toggles through `XtreamFavoriteMarksService`). CDK overlays follow the fullscreen element via `FullscreenOverlayContainer` in `app.config.ts`. M3U also zaps with PageUp/PageDown, yielding to already-handled events and menu/dialog or scrollable-list targets. While the live web-player host owns fullscreen (itself, or through the nested surface a legacy player fullscreens under the vendor-chrome opt-out), numeric and adjacent-channel commands use the same eligible channel set as the panel, preserving original numeric positions and ignoring ineligible numbers; windowed commands keep the complete catalog. Contract section "Fullscreen channel panel" in `docs/architecture/player-controls-contract.md`. On the preference-off path, all three web players retain their existing controls, source behavior, and legacy series navigation — but the playback keyboard shortcuts (Space/K, F, arrow seek/volume, M) still work: each vendor-chrome player attaches `LegacyPlayerShortcuts` (a wrapper over the same `ControlsShortcuts` arbitration/ignore rules) with engine-specific command wiring (`html-video-legacy-shortcuts.ts`, `vjs-legacy-shortcuts.ts`, `art-player-legacy-shortcuts.ts`); seek is gated on authoritative `isLive` plus a finite positive duration, `interactionEnabled` (visible playback diagnostic) disables the keys, and the legacy ArtPlayer chrome passes `hotkey: false` because ArtPlayer's focus-scoped hotkeys ignore `defaultPrevented` and would double-handle every key (its lost Escape-exits-`fullscreenWeb` behavior is restored by the wiring). The legacy Video.js chrome also releases the focus a pointer interaction leaves on a control (`vjs-pointer-focus-release.ts`, sharing `pointer-focus-release.ts`'s `blurFocusedControl` with `ControlsSurface`): a focused Video.js component stops every key before the document and turns Space/Enter into a click, so after a click on fullscreen Space left fullscreen instead of pausing. It is driven mainly by `focusin`, not the click, because choosing a menu item moves focus to the menu button a tick later (`MenuItem.handleTapClick`) and that selection click never bubbles to the shell: an eligible control (button/`role=button`/slider, never a `role=menuitem*`) is released when its focus is attributable to a recent shell `pointerdown` not yet ended by a document `keydown`, so keyboard `Tab` focus is kept — plus a `click` runs the same release for a control clicked while already focused (Tab then a mouse click, which fires no `focusin`). The release is scoped to `.vjs-control-bar` so the caption-settings dialog (a modal sibling of the bar) keeps its focus trap; menu buttons live in the bar and are not exempt (a popup is navigated through its focused item, so releasing the button never disturbs an open menu, and the button focus a pointer moves through on open, item selection, or toggling an open menu shut is released so Space works after the menu closes) — ArtPlayer (non-focusable divs) and the native HTML5 controls (focus lands on the `<video>`) need no counterpart. `Settings.showCaptions` is deliberately outside this rollout gate: it is engine state, so the preference-off players apply it through the same helpers without an adapter (`WebVideoSourceTracks` for HTML5/ArtPlayer, `VjsLegacyTracks` for Video.js), re-applying it as the engine adds or switches text tracks. The two modes differ in how long it is enforced: shared controls are authoritative for the session (user intent arrives via `setSubtitleTrack`), while vendor chrome is source-default — the preference seeds each new source and is released once the media reports `playing`, so the engine's own caption menu keeps working. Mode selection is the optional `playbackStarted` probe the legacy owners pass to all three helpers (HLS, native text tracks, Shaka); in that mode the HLS helper deselects (`subtitleTrack = -1`) rather than hiding, since `subtitleDisplay` would override the vendor menu, and DASH is seeded by `ShakaVideoSession.start()` after the manifest loads. `WebPlayerViewComponent` reads it from `SettingsStore` instead of a host input so every host (M3U, Xtream/Stalker live layouts, portal detail inline player) inherits it. Contract: `docs/architecture/player-controls-contract.md`.
- Shared web picture-in-picture stays inside that default-on rollout.
  `PlayerController` exposes capability `pictureInPicture`, state
  `pictureInPictureActive`/`canPictureInPicture`, and command
  `togglePictureInPicture()`. HTML5, Video.js, and ArtPlayer use standard
  element PiP from the adapter's attached video; shared ArtPlayer keeps vendor
  `pip: false`, while preference-off native/vendor controls keep their own UI. The
  capability-gated button sits before fullscreen and uses active enter/exit
  semantics; entry is disabled until metadata, and the action is disabled while
  an operation is pending. Embedded MPV reports capability/state false with a
  no-op command and has no popup/mini-window.
- `WebVideoControlsAdapter` supplies its current video and binding generation to
  `WebVideoPictureInPictureController`; the controller reads the video's
  `ownerDocument`, while browser enter/leave events remain authoritative.
  Exact-owner exit stays available if request support changes. Request/exit
  invocation remains synchronous for user activation, one operation is
  serialized, and binding generation plus exact video identity protects
  replacement and teardown from stale completion. Video.js Tech reset and
  ArtPlayer rebuild rebind with exact-owner cleanup; HTML5 source changes on a
  retained target preserve PiP. Legacy HTML5/ArtPlayer teardown and Video.js
  Tech replacement also release exact-owned PiP through
  `web-video-picture-in-picture-lifecycle.ts`, independent of the controls
  preference. A one-shot listener on the retired video closes late native/vendor
  entries without retaining the host or touching another video's PiP. Legacy
  WebKit presentation-mode PiP also returns the retired video to inline; its
  presentation-change listener ignores fullscreen/inline events until a late
  PiP entry consumes it.
  Standard PiP shows the browser/OS video surface without Angular control
  chrome, with browser-dependent subtitles. AirPlay, Cast, Document PiP, a PiP
  keyboard shortcut, and Embedded MPV popup/native support are out of scope.

**Download Manager**:

- Fresh Xtream movie and series-episode downloads propagate the playlist's
  User-Agent, Referer, and Origin, defaulting User-Agent to the same
  provider-compatible `XTREAM_CLIENT_USER_AGENT` used by API requests and
  stream probes. Retry, resume, and missing-file
  recovery also add the fallback to legacy Xtream rows that have no stored
  User-Agent. Because download rows survive source deletion, a headerless
  legacy row whose playlist is already absent receives the same IPTV-player
  fallback; a known Stalker row remains unchanged. Allowlisted connection
  resets after bytes reach disk retain the partial and show a credential-safe
  `DOWNLOAD_NETWORK_INTERRUPTED` code. Retry resumes with Range/If-Range when
  the response supplied a strong ETag or Last-Modified validator; without one
  the Range request rewinds by a 256 KiB overlap window whose bytes must match
  the partial's tail before anything is appended (`download-overlap.ts`); a
  smaller partial is verified in full from byte zero and appended, never
  rewritten in place; reported progress is floored at the retained size while
  appending; and a mismatch truncates the partial and restarts from byte zero
  instead of risking mixed-representation corruption. The runtime also
  reconnects interrupted transfers automatically (`download-reconnect.ts`):
  reconnects continue while attempts end ≥64 KiB past the previous attempt;
  restarts are an explicit `task.transferRestarts` signal (never byte
  inference) that opens a fresh progress epoch, at most twice per transfer;
  three consecutive stalled attempts surface the retained failure; and a
  reconnect that fails before any response is converted into the same
  retained interruption so it can never delete the partial. Only the response's own
  total authorizes completion — an indeterminate `bytes X-Y/*` range stays
  incomplete even at a clean EOF; carried totals are informational and
  dropped when falsified; and any retainable network failure retains any
  nonempty partial (no evidence required), persisting a falsified total as
  unknown.
- The desktop-only manager shares one global download store across the global,
  Xtream-scoped, and Stalker-scoped routes. Completed movie and grouped-series
  cards use the global Small/Medium/Large cover-grid tokens; missing completed
  files move to Needs attention instead of remaining in Ready to watch.
- Series details route individual and selected-season episode downloads through
  the provider-neutral `SeasonDownloadCoordinator`. It reserves per-episode
  pending identities synchronously, submits season candidates sequentially and
  best-effort through the existing `DOWNLOADS_START` path, performs one final
  authoritative refresh after added or stable duplicate submissions, and
  reports added, skipped, and failed counts. Xtream and Stalker adapters remain
  responsible for provider URLs, headers, and metadata; the backend still runs
  one active transfer with a FIFO queue. `DOWNLOADS_START` remains the sole
  start IPC. A reserved completed-missing match triggers one authoritative
  preflight refresh before provider preparation. Download-list loads are
  serialized as one active IPC plus one coalesced trailing refresh; a preflight
  assigned to that trailing refresh cannot be starved by later progress
  broadcasts. A restored Stalker file can therefore become a stable skip
  without a portal request. The IPC's stable
  `reason: 'already-in-progress'` and `reason: 'already-downloaded'`
  results are counted as skipped, and no batch IPC is introduced. The latter
  comes from an asynchronous main-process filesystem recheck before a
  completed-missing row can be reset, so a file restored after the renderer
  snapshot is not orphaned or downloaded again. The recheck has a one-second
  caller deadline that starts before shared-slot acquisition; timeout or probe
  failure leaves the row untouched and reports a failed submission so the
  season loop can continue. Completed-file list callers use the same deadline
  and report a timeout as missing for that snapshot. The underlying filesystem
  operation remains coalesced and charged against the four-probe cap until it
  settles, so later callers have independent bounded waits without duplicating
  stalled native work. Only `ENOENT` and `ENOTDIR` prove absence; permission,
  I/O, and other filesystem errors remain unknown and cannot clear a completed
  row. Before a completed-missing, failed, or canceled row clears its retained
  path, the start IPC asynchronously removes any `.part` through a separate,
  same-path-coalesced, four-operation cap. A one-second admission deadline
  rejects queued work before unlink starts; started work is awaited so it cannot
  mutate after a failure response. Non-absence errors keep the row's ownership
  intact; `ENOENT` and `ENOTDIR` safely proceed. Episode and season download
  actions require an authoritative global list. A
  successful snapshot remains authoritative while a later background refresh
  is in flight; a latest refresh failure leaves
  loading/empty-state resolution intact but disables starts until another
  snapshot succeeds. Overlapping download-list callers join one serialized
  trailing refresh, so responses commit in request order and frequent progress
  events cannot perpetually postpone a waiting series action.
- Episode ownership uses normalized `episode.id` as the canonical `xtreamId`
  for both providers; Stalker playback identifiers only resolve the URL. Exact
  `(playlistId, contentType, xtreamId)` matches are authoritative, while
  complete playlist/series/season/episode coordinates are a fail-closed legacy
  fallback that migrates reusable rows to the canonical id. Numeric season
  zero, including fallback key `"0"`, remains a valid Specials coordinate for
  both providers. Stalker persists
  `episode_identity_scope` separately for regular `/series`, embedded VOD
  `series[]`, and lazy Ministra VOD `is_series`. Known different scopes do not
  match; a pre-scope coordinate row is ambiguous and blocked, while an exact
  canonical legacy row remains authoritative. Renderer lookup preserves that
  ambiguity or conflicting ownership as a distinct ineligible state, so
  neither the episode action nor the season count treats it as a row-less
  download. SQLite `null` and optional `undefined` coordinates both mean an
  incomplete canonical legacy row, matching the backend resolver. Pending and
  active rows plus completed available/unknown rows are skipped; failed,
  canceled, completed-missing, and unambiguous row-less episodes remain
  eligible.
- Ready cards (movies, grouped series, and standalone episodes) open a focused
  local detail; local file actions (Play, Show in folder, Copy URL, Remove)
  live in the poster's overflow menu. Movies play the finalized local file;
  series list only locally available episode rows and every episode action
  targets its own downloaded file. Focused routes disable route search and use
  `contextPanel: 'none'`.
- Downloads capture a versioned metadata snapshot from the rendered Xtream or
  Stalker movie/episode detail at start time, including already-merged TMDB
  fields. Legacy, sparse, stale, or wrong-language snapshots are safely
  backfilled from row/provider metadata and optional TMDB enrichment when the
  focused detail opens.
- `View in portal` resolves a concrete Xtream category/item route. Stalker
  accepts a recently-viewed shape only when its raw movie/series mode matches
  the download, and prefers an exact numeric category from the download
  snapshot. Without that shape, only a movie carrying an exact category can
  form a metadata-only target; unproven episode and legacy-movie handoffs stay
  unavailable. The normal detail uses one-shot `provider-only` presentation:
  it exposes provider content/playback it can resolve while hiding
  Offline/local/download actions. A second, independent `View in portal`
  bridge exists for inline collection details — see **Collection Detail
  Portal Handoff** below; it deliberately does NOT use `provider-only`.
- Download rows and local files survive source deletion. The global offline
  library remains visible with no playlists; only provider handoff is disabled
  until the source exists again.
- If a finalized file disappears while a focused detail is open, the
  authoritative download list refreshes and returns to the manager. A failed
  redirect leaves an actionable missing-file state with Back and Retry.
- Live-TV recordings (Embedded MPV `stream-record`) are tracked beside
  downloads in their own `recordings` table (no unique index, no playlist FK —
  recordings survive source deletion with a `playlistDisplayLabel` name
  snapshot). `EmbeddedMpvRecordingTracker` persists the lifecycle: start/stop
  hooks in `EmbeddedMpvNativeService` plus a session-snapshot observer. The
  stop hook only REQUESTS a stop (`addon.stopRecording()` dispatches
  asynchronously), so finalization waits for the snapshot reporting the
  recording inactive — bounded at 10s — and only a recording that never went
  active has its empty reservation unlinked; mpv's bytes are never deleted.
  The same observer covers the implicit stops (stream-replacement auto-stop,
  helper crash, session error/close). Rows carry `owner_pid`, so startup
  repair turns a hard kill's leftovers into playable `interrupted` partials or
  `failed` while skipping rows another live instance owns. Channel/EPG metadata is
  snapshotted at recording START (each live host passes
  `RecordingStartMetadata` down through the player chain; provider EPG never
  reaches SQLite so post-hoc lookup is impossible). `EmbeddedMpvPlayerComponent`
  owns the active→inactive recording edge and emits `recordingStopped` for
  every trigger (including the manager's Stop, which bypasses the player's own
  toggle); the host answers with enrichment: programs overlapping the recorded
  window, keyed by target path (`RECORDINGS_UPDATE_PROGRAMS`, which awaits only
  the tracker's write queue and then matches the newest row for that path in
  ANY status — `finalize()` never touches `programs_json`, so the two writes
  are order-independent and no deadline can drop the programs) — that covers
  recordings spanning a program boundary. Own `RECORDINGS_*` IPC + `RECORDINGS_UPDATE_EVENT` ping
  and a separate `supportsRecordings` capability gate (never folded into the
  all-or-nothing `supportsDownloads` allowlist). Manager UI: `recording`
  filter chip, "Recording now" queue section (REC pulse + elapsed, live size,
  Stop, no percentage), 16:9 channel-logo "Recordings" library cards, Needs
  attention with Remove only (a broadcast cannot be re-recorded), focused
  detail at `/workspace/downloads/recording/:recordingId` listing covered
  programs. Reveal/play shell IPCs are gated on the recordings table
  (`isManagedRecordingFile`).
- Canonical contract: `docs/architecture/download-manager.md`; provider handoff:
  `docs/architecture/portal-detail-navigation.md`.

**Collection Detail Portal Handoff** (`View in portal` for inline details):

- Details opened outside portal category context — `/workspace/global-favorites`,
  `/workspace/global-recent` (which also receive the dashboard hero, Continue
  Watching and favorites-rail handoffs), and a portal's own `favorites`/`recent`
  tabs — render full-width with no category sidebar. They expose a separate-row
  hero action that jumps to the item inside its owning portal.
- Visibility is DI-gated, never URL-sniffed: `app-view-in-portal-action`
  (`libs/ui/components/src/lib/view-in-portal-action/`) renders only when a host
  provides `VIEW_IN_PORTAL_HANDOFF`. The sole providers are
  `XtreamCollectionDetailComponent` (through its dynamic detail injector) and
  `StalkerCollectionDetailComponent` (component providers), which exist only in
  collection contexts — so router-mounted category details need no opt-out. When
  hidden the host must stay `display: none`, or its `flex: 0 0 100%` would claim
  a phantom row in the hero action container.
- Targets come from `getUnifiedCollectionDetailNavigation()`
  (`libs/portal/shared/util/.../collection-detail-portal-navigation.ts`). Unlike
  `getUnifiedCollectionNavigation` it NEVER degrades to a category- or
  section-only route: an Xtream item without a resolvable category and positive
  item id keeps the action hidden rather than promising a jump to the title and
  landing in a list.
- Stalker section resolution mirrors `resolveStalkerCollectionDetailMode()`
  (`libs/portal/stalker/feature/src/lib/stalker-collection-detail-mode.ts`) and
  must not be
  simplified to `item.contentType`: `extractStalkerItemType()` reports `series`
  for embedded `series[]` snapshots and lazy Ministra VOD `is_series` items, but
  both belong in the VOD catalog — the lazy season/episode fetch in
  `StalkerCatalogFacadeService.selectItem()` is gated on the VOD content type, so
  a `/series` route leaves the detail unable to load episodes. The virtual
  `series` category is normalized to `vod` the same way
  `resolveStalkerCollectionSelectedCategory()` does. Stalker also carries
  `stalkerReturnTo` plus
  `stalkerReturnByHistory`, and the portal detail's back affordance
  (`StalkerCatalogDetailComponent.onVodBack()`,
  `StalkerSeriesViewComponent.goBack()`) honours the latter by stepping back
  one history entry instead of calling `navigateByUrl()`. The collection's
  active tab, scope and open inline detail live only in `window.history.state`
  (`collectionViewState` / `openCollectionDetailItem`), so re-navigating would
  reopen it on the default `live` tab and leave the portal page one browser
  Back away. The marker carries the handed-off item's identity, not a bare
  `true`: `openStalkerItem` is consumed on arrival while the return keys stay
  on the entry, and a Stalker detail opens in place without pushing one — so
  after Back + browser Forward the same entry can host a different title, whose
  back affordance must just close it. A stale marker suppresses the whole
  return contract, and honouring it retires both keys from the entry so a
  browser Forward cannot replay them for a reopened title. Leaving with the
  browser's own Back runs no affordance, so `CategoryContentViewComponent`
  also retires the contract whenever it lands on the entry with no handoff
  item and no open detail. That retirement is gated on the marker, so a plain
  `stalkerReturnTo` caller such as the dashboard handoff is unaffected. The identity is
  restricted to what `buildStalkerSelectedVodItem()` preserves (`id ??
stream_id`); it drops `series_id`/`movie_id`, so the builder pins the
  resolved id onto the handoff state item when the raw row carries neither —
  those rows then get the same history return instead of degrading to a
  re-navigation that resets the collection's tab.
  Only this builder sets the marker, so the
  dashboard handoff and any other `stalkerReturnTo` caller keeps
  re-navigating.
- Unlike the download handoff this bridge does NOT pass
  `detailPresentation: 'provider-only'` — the item exists in the provider
  catalog, so the full normal detail (downloads included) is wanted.
- Contract: `docs/architecture/portal-detail-navigation.md`.

**VOD/Series Detail Pages (two-state layout)**:

- Xtream and Stalker detail pages use the shared `PortalDetailShellComponent` (`libs/ui/components/src/lib/portal-detail-shell/`) with two states: **Browse** (hero with poster/metadata/actions, episodes below) and **Watch** (hero collapses with a ~300ms morph, the inline player takes the full content width, metadata moves to an About block below the episodes)
- The inline player (`PortalInlinePlayerComponent`) renders a full-width **theater stage** (`.player-shell__viewport`): the 16:9 player is centered and letterboxed so the leftover on wide-short windows is always the stage's black background, never app surface. An opt-in `playerAmbientMode` setting (Settings → Playback, default off, built-in web players only) fills that leftover with a blurred, dimmed copy of the poster (YouTube "Ambient mode" style)
- For inline **series** playback on wide windows the stage instead docks the player left and shows an **"Up Next" episode rail** in the leftover column (`app-up-next-rail` in `libs/ui/playback/src/lib/portal-inline-player/`): rest of the current season plus next-season spillover, playing episode highlighted, watch-progress bars from playback positions; clicking plays inline via the host's episode flow (both Xtream and Stalker). Gated by the `playerUpNextRail` setting (default on, web players only) and a ≥320px leftover-width check via ResizeObserver — narrower windows keep the centered theater/ambient stage; movies and live never show the rail. The rail is opaque and sits on top of the ambient fill
- Watch state derives from `inlinePlayback() !== null` only; external MPV/VLC playback keeps the browse layout. Esc and "Close player" exit to browse without navigation; the now-playing back arrow is route-level back (straight to the list via the host's `goBack()`)
- Xtream VOD treats metadata presentation and playability as separate contracts. Empty or sparse `get_vod_info` data keeps the curated fallback detail page, while Play/Resume, Favorite, and Download remain available whenever a positive stream id and non-empty container extension resolve from `movie_data` or the catalog fields. Playback fields are selected as one atomic pair in detail → recovered catalog → owner-valid cached catalog order; incomplete candidates never combine into a synthetic source. In-memory VOD categories/streams carry their owner playlist, and cross-portal Favorites/Recent details ignore arrays from another playlist so colliding Xtream ids cannot inject stale playback or presentation data. When Electron's normalized catalog cache lacks the extension, the detail loader immediately publishes the sparse fallback and ends its loading state, then performs a best-effort category-scoped raw catalog lookup and reactively upgrades the same item with actions on success. It maps the normal SQLite route category through all persisted categories, including hidden ones, while also accepting the provider `xtream_id` carried by cross-portal Similar links; ambiguous numeric matches keep local-id precedence, deduplicate provider candidates, and try the next candidate when the exact VOD is absent. PWA falls back to API categories. It skips that request when existing data is sufficient, never sends an unresolved database id as a provider id, preserves concurrent metadata enrichment, and drops late detail/recovery responses after replacement, playlist reset, or detail teardown. Inline playback moves either detail page into Watch; external MPV/VLC remains in Browse. Unresolvable items expose no actions, and playback/download titles and posters fall back through `info`, `movie_data`, then catalog fields.
- A successful external MPV/VLC episode launch immediately persists the selected episode as the latest playback-position entry and retargets the series CTA to `Play episode N`; real player telemetry overwrites that marker when available, so episode identity is reliable while exact external timestamps remain best-effort.
- Stalker preserves this contract for regular `/series`, embedded VOD `series[]`, and lazy Ministra VOD `is_series` items; `is_series` is normalized only from `true`, `1`, or `'1'`. Quick-start translation parameters must reach the CTA, and inline/external episode handoffs must include the parent series id plus resolved season and episode numbers. Single-season title markers correct both displayed and playback season coordinates; lazy VOD retains the original provider season key/number for stable IDs and old progress. Lazy VOD episode tracking IDs scope the parent series, provider episode, original season key, and episode number; the previous season/episode hash is only a compatibility alias. Exact scoped positions win, while compatible legacy rows are considered only for the current parent and must match the episode and either its resolved or retained original provider season. The scoped row is persisted through the strict failure-propagating boundary before confirmed legacy cleanup, so a failed save keeps the old row; compatibility is lazy and performs no schema migration or bulk rewrite. Season resources ignore metadata-only selection patches, and episode responses belong to the exact loading VM so navigation cannot mix episode lists.
- Hosts pass hero chips/meta/actions as `*appDetailTags`/`*appDetailMeta`/`*appDetailActions` templates; the shell stamps them into both the hero and the About block
- Seasons are tabs (`SeasonTabsComponent`, dropdown beyond 6 seasons) with auto-selection (playing episode's season → resume season → earliest season with unwatched episodes → latest non-empty season; Stalker lazy-VOD series with unhydrated seasons fall back to the first season, and a session's own watched-toggle echo never re-resolves the selection) that fires the same `seasonSelected` lazy-load/enrichment hooks as manual clicks; grid/list episode view toggle persists to localStorage; season descriptions come from `get_series_info` (Xtream, provider-first with URL-only junk filtered by `sanitizeProviderOverview` and a TMDB season-overview fallback stored as `tmdb_season_overviews` by the lazy season enrichment) or TMDB (Stalker)
- The season header hosts a bulk watched toggle next to "Download season" (both portals): marking writes full-progress position rows for the unwatched episodes only — skipping the episode currently playing/launching, whose position ticks would overwrite the row — and a fully watched season flips the action to unwatch-all (`buildSeasonWatchToggleRequest` in `libs/ui/components/.../season-watch-toggle.util.ts`). Xtream persists via the batch IPC `DB_SAVE/CLEAR_PLAYBACK_POSITIONS_BATCH` (one SQLite transaction; the PWA data source rewrites its localStorage blob once) and refreshes `XtreamStore.loadAllPositions` after any toggle so catalog progress badges follow; Stalker loops the serialized position-mutation queue (legacy-row reconciliation, one coalesced reload) and reports direction-specific partial failures. A batch resolving after navigation neither mutates the new page's state nor shows its snackbar. A series-level counterpart sits in a `⋮` menu at the end of the header row (`SeasonWatchPresenter` owns both scopes' state math; `buildSeriesWatchToggleRequest` flattens every loaded season; the direction is always the one the label advertised). It reuses the same host machinery per portal (Xtream: scope-parameterized `SerialDetailsSeasonWatchService`; Stalker: shared `runWatchToggleBatch` core). Stalker lazy-VOD hydrates unloaded seasons sequentially first (abort with zero writes on a failed fetch; a well-formed EMPTY portal answer marks the season loaded-and-empty via `VodSeriesSeasonVm.episodesLoaded` rather than eternally pending, while `fetchVodSeriesEpisodes` rejects malformed envelopes and answers without recognizable episodes; `loadEpisodesForSeason` is single-flight per season so concurrent callers join one request), re-runs the position reconcile synchronously so hydrated episodes' legacy rows are cleaned, then rebuilds the request keeping the clicked direction — the `hasUnloadedSeasons` container input blocks the unwatch verdict and the count label until everything is loaded. Contract: `docs/architecture/embedded-inline-playback.md`
- The dashboard hero CTA and the Continue Watching cards' explicit "Resume episode" ⋮ action for an Xtream series carry a one-shot resume target through the global-recent inline-detail handoff; after series metadata and playback positions load, the exact saved episode starts at its stored position. A failed positions load leaves the target unconsumed and the handoff detail-only, so a transient storage error never starts the episode from the beginning. Continue Watching cards' DEFAULT click is detail-only (movie-like, issue #1441), and their ⋮ menu (`buildDashboardContinueWatchingActions`) also offers "Mark as Watched" (maxes out the existing position row via `DashboardDataService.markRecentItemWatched`) and "Remove from history". Ordinary global-recent grid clicks remain detail-only.
- See `docs/architecture/embedded-inline-playback.md` ("Two-State Detail Layout")

**VOD Multi-Source** (alternative sources for a movie):

- Finds the same movie in the user's other imported playlists and adds a "Sources N" chip to the Xtream VOD action row (only when ≥1 alternative exists), plus a `.source-caption` line reporting where playback is coming from. The chip opens a 660px anchored CDK-overlay popover (`libs/ui/components/src/lib/vod-sources/`; not `MatMenu`, which caps its width at 280px), reused unchanged in the inline player's now-playing bar and on the playback-error screen. It opens ABOVE the chip (right edges aligned, pressed state on the chip while open), height-capped by the overlay's flexible bounding box so only the source list scrolls, and flips below when less than the overlay `minHeight` remains above; filter chips (All / Available / HD+ / language select) compose with the host search, "Available" auto-runs check-all when no verdicts exist, and expanded copy rows show a parsed language chip + raw stream title with diff-only tags ("same as above" for the parent's copy). A row's language is `vodSourceLanguage` (`libs/shared/interfaces/src/lib/vod-source-language.util.ts`): the title's own prefix (pipe incl. Unicode lookalikes, bracketed, or ALL-CAPS spaced-dash form; Latin/Cyrillic 2–4 letters + `MULTI`; only the legacy pipe form is permissive — bracket/dash matches must also pass `isKnownLanguageTag`, since those positions carry quality/rip tags like `[HD]`) wins, else the language the stream's visible categories unambiguously carry ("EN | Netflix" — discovery returns all category names — the FTS tier joins them with `group_concat(cat.name, char(31))` under the GROUP BY it already needs, the scan tier must NOT group (per-category uniqueness means sibling rows can carry different titles and grouping would drop a matching one) and its names merge in TypeScript, prefixed categories must agree, and category prefixes must pass `isKnownLanguageTag`, since `new`/`top`/`hot` are real ISO 639-3 codes but everyday category words; the route's own row reads the one category the route arrived through, overlaid late by the host's same-key `refreshRouteFacts` since cold/direct routes load categories after discovery). Both forms are parsed guesses: browse filter and chips only, never ranking/failover/dub-warning inputs. Recognition alone is not enough — `normalizeTitleKeys` must STRIP the same tag or the copy is never discovered, so its leading-tag rule shares `PROVIDER_PIPE_CLASS` and drops the required space after a pipe. It goes no further on purpose: a wrong guess costs a filter option, a wrong strip corrupts identity, and on 1.27M real titles a case-insensitive/Cyrillic pipe rule corrupts 349 keys ("Akira | 1988", "Момо | Momo" — the name sits in the tag position) while `–`/`—` on the dash branch amputates 14 subtitled titles. The one shape that cannot decide itself is a strip leaving NO real word behind — decided by running the rest of the pipeline on the stripped form rather than re-implementing what later stages drop, since quality tags, trailing tags, underscore tags, double-dash suffixes and season markers each otherwise smuggle the strip through ("|TA| RRR - HEVC" → empty key, "IF - 2024_sub" → bare year "2024") — "IT - 65 (2023)" is the film "65" tagged Italian, "AKA - 2023" is the film "AKA" and its year — so there the leading token must be in `TRAILING_TAG_VOCABULARY` or the prefix-only list (`NF`, `EX`, `NRC`, `AMZ`, `D+`, `P+`, `OSN`, `VO`, …; a compound is read by its HEAD, so `4K-*` works and the film names "INU-OH"/"PC-4L" do not), and an unknown token keeps its title: a refused strip costs one unmatched copy, a wrong one produced a bare-year key that collapsed AKA/BDE/BRO/OUT/WIL/IF onto `"2023"`. Every vocabulary entry is one the catalog proves prefixes hundreds of ordinary titles — never one that merely looks like a provider ("MAX - 2015" is a film). Verify such widenings against the real catalog before shipping them, over movies AND series: a movie-only derivation missed `AMZ`/`D+`/`P+` and broke the numeric series 1923, 1883, 24 and 9-1-1. Checks run through a 4-slot queue and settled verdicts are cached 10 min per movie+source (`VodSourceProbeCacheService`). Both chips are handed the same `matchKind` and `vodAutoFailover` and both write the setting back. The details-page chip badge counts TOTAL **copies** across all playlists (the in-player chip still counts alternatives); the caption ("also found in N other playlists") counts distinct **playlists** via `alternativePlaylistCount`, because the popover groups one portal's copies under that portal. The action row's Favorites and Download buttons are icon-only 64px squares: filled red heart when favorited, and a download idle icon → progress ring (real percent, indeterminate spin, paused-resume) → green done-checkmark whose click reveals the file (state read from the download manager; the labeled "Play from source" secondary is gone — provider playback for a downloaded movie goes through the Sources popover).
- Scope v1 is **Xtream ↔ Xtream, movies only, Electron only**. Stalker never reaches the `content` table and M3U is a JSON blob whose search forces `content_type:'live'`; both are additive later since `VodSourceCandidate.portalType` already carries all three. In the PWA every entry point is gated off by a bridge `typeof` check and the chip renders nothing.
- **Metadata provenance is the core contract.** Every field is `{value, provenance}` where `api`/`probe` are facts (plain tag), `parsed` is a title-regex guess (tag prefixed `~`, warn colour), and absent renders **no tag at all** plus a `check` chip. `factualOnly()` in `vod-source-metadata.util.ts` is the only accessor allowed for ranking/failover, so guesses are structurally unable to influence a decision. `VodSourceProbeStatus` separates `fail` (contacted and refused) from `unknown` (timed out / blocked / no capability) — an unchecked source is never shown as offline. Quality is derived from pixel **width** because letterboxing crops height — but a known height vetoes the answer on every tier, since cropping only removes lines: a taller frame is a different shape (1440×1080 anamorphic or 1600×900 are not 720p, 960×540 is not 576p) and gets no tag rather than a wrong one carrying `api` provenance. The route's OWN row is never resolved, so it takes its facts from the `get_vod_info` the page already loaded (`providerVodMetadataOf`, shared with the resolver) and picks them up via `refreshRouteFacts()` even when they arrive without changing the movie identity — otherwise `audioDiffersFactually` has nothing on one side and the dub warning cannot fire on a route-to-alternative switch.
- Discovery (`DB_FIND_TITLE_SOURCES`, trigram FTS over `content_title_fts`) is lazy and returns only what the `content` table can prove; titles whose tokens are all shorter than three characters ("Up", "It") fall back to a scan, since the trigram tokenizer cannot index them at all. A source that is never read looks exactly like one that does not exist, so: the current playlist is excluded **in SQL** and duplicates collapse there too (`GROUP BY cat.playlist_id, c.xtream_id` before the limit — one playlist's dozens of identically ranked category rows would otherwise crowd out every alternative), and the scan matches an ASCII token as a whole word (`' ' || LOWER(title) || ' ' GLOB '*[^a-z0-9]it[^a-z0-9]*'`) ordered by title length **with no row limit** — FTS keeps its 60-row window because it ranks by relevance, while a scan cannot rank, and the GLOB reads every row regardless so a limit would only truncate the answer. The year gate covers BOTH match tiers: `normalizeTitleKeys` strips bracketed segments, so "Dune (1984)" normalizes identically to "Dune" and would otherwise be an _exact_ match for the 2021 film; a bracketed year is read out of the raw title and a stated disagreement rejects the row — but the two tiers read different forms: the base tier accepts bracketed or trailing (it just stripped a trailing year, the only thing separating "Dune 1984" from "Dune 2021"), while the exact tier reads bracketed ONLY, since reaching it means both titles are the same string and a trailing number is then part of the NAME ("Blade Runner 2049" against a metadata year of 2017 would otherwise vanish once enrichment lands). A non-ASCII token cannot be folded by `LOWER()` (ASCII-only) but CAN be by a GLOB character class (UTF-8 code points), so `caseInsensitiveGlobPattern` folds the case in JS and emits one `[lowerUpper]` class per character — returning `null`, leaving the two substring tests alone, for a GLOB metacharacter or a length-changing case map (`ß`→`SS`). The movie's own year comes from `releaseTagYear` (bracketed or trailing only), never `extractYear`: a year inside the NAME ("2001: A Space Odyssey") would fail every genuine 1968 copy at the year gate and move the pin key once enrichment lands. One row inside the excluded playlist is kept when the caller names it (`keepContentId`), because a pin can point at another copy in the playlist being viewed — the host reads the pin before discovery for exactly this. Resolution is deferred to click/pin/check because `content` stores no `container_extension` and `constructVodUrl` returns `''` without one — each alternative costs a live `get_vod_info` against the foreign playlist's credentials.
- Switching = one `inlinePlayback.set({...next, startTime})`, never null-then-set, so the player and engine survive and re-seek. The carried position is read _before_ the 15s persistence throttle, and `VodDetailsPlaybackService` uses a one-shot `resumeSettled` latch so a resuming engine's `timeupdate` at ~0 cannot overwrite the resume point. `handleInlineTimeUpdate` returns that verdict and the route feeds multi-source the requested `startTime` until the engine reaches it — one latch for both, or a switch during the initial seek would restart the film. Before anything plays there is no live position at all, so the controller is seeded from the persisted one (`seedResumeSeconds`, one-way: a live value always wins). Portal failures in the multi-source path log through the redacting `createLogger`/`redactSensitiveData` — an Xtream error message carries the stream URL, and that URL is built out of the username and password.
- Pins are keyed portal-agnostically (`tmdb:{id}` else `title:{base}:{year}` else the yearless `title:{base}:`, `vod_source_pins` table); enrichment supplies the id and the year late, so a pin may sit under any poorer form — three key sets (`pinKeysFor`): `lookup` passes every alias most-trusted-first, `write` holds only keys naming exactly one film, and `loaded` records where the pin on screen was found — the yearless alias is readable but never written or deleted on spec, since it is shared by every remake, with the single exception of the row this session actually read. A write stores the decision under **every** key in `write` (`setVodSourcePin(db, pin, retireKeys, aliasKeys)`: one upsert per key plus the leftover retirement, in a single transaction), because a movie's identity grows — recorded only under the enriched `tmdb:` key, a pin is invisible to the next reopen, which starts out with just a title and a year, and stays invisible for good if enrichment is off or never answers. A pin is not decoration: the primary Play action starts from the pinned source (except when that button reads Stop — an active external session wins, or the control would launch a second player), and it outranks everything else in failover ranking. The row changes only after the write lands, so a refused pin is never shown as saved. Starting a pinned source loads THAT source's own playback position — progress is keyed by (playlist, stream), so the row the page loaded belongs to the route's copy. The primary button says nothing at all until that row is in, and "is it in" is answered by comparing the loaded pin **id** rather than mere presence, or re-pinning would leave the button wearing the previous copy's timecode. An external player launched for an alternative carries the OTHER playlist's ids, so `VodDetailsPlaybackBindings.activeSource` feeds one `ownsContent()` predicate used by BOTH the session matcher and the playback-position bridge — if they disagree, the page shows Stop for a session whose progress it throws away and a later switch rewinds hours. Two identity keys: `vodMultiSourceMovieKey` (title, year, tmdbId) makes TMDB enrichment re-trigger discovery and rebuild the pin keys, while `vodMultiSourceSessionKey` (`playlistId:contentId`) decides whether that rerun is a refresh or a new session — a refresh keeps the active source, its resolved facts, the tried set, the live position and any switch in flight; only a different film resets them.
- Claims in the present tense (the "Playing from" caption and the source row's `Playing` badge) are gated on `VodDetailsRouteComponent.playbackLive`, never on `isActive` — discovery marks a source active before anything plays and it stays active after the player closes. Inline that means a `timeupdate` has arrived (`inlinePlayback()` is only the request to play); external it means the session is past `launching`. A merely selected row reads `Current`.
- Pins are included in playlist backup as the optional `sourcePins` collection, carried under the playlist they point at; `matchKey` survives untouched and only the playlist id is remapped on restore (older archives simply lack the field).
- Auto-failover is `Settings.vodAutoFailover`, **opt-in and off by default**, web engines only — the toggle is hidden in settings and in the sources menu on MPV, VLC and Embedded MPV, since only the built-in web players raise the playback diagnostic that triggers it (`reportsPlaybackFailures()`); it awaits a discovery still in flight before concluding there is nowhere to go (a stream can fail faster than SQLite answers) and re-checks the session afterwards, since the user can navigate during that wait; pinned Play takes the same guarded wait. Each source is tried at most once per session (`triedSourceIds` only grows), so it terminates structurally — but SELECTION is not an attempt: `setActiveSource` only selects, `markPlaying` spends the turn, and `runFailover` retires whatever is on screen before picking, so discovery selecting the route row (or a pin selecting an alternative) before anything plays cannot burn a healthy fallback; and it continues past candidates that fail to resolve rather than stopping at the first one — `switchTo` reports whether it was unresolvable (keep going) or superseded (stop), since only the former marks the candidate tried. The switch is never silent: the toast names the new playlist (through `playlistDisplayLabel`, since a stored playlist name is routinely the pasted URL with credentials), offers Undo, and warns "dub may differ" only when both sides state a spoken **language** as fact — `audioLanguage`, never `audio`. The latter holds the codec whenever the fact came from the API, and a codec cannot answer that question: AAC and AC3 routinely carry the same dub while two AC3 tracks can carry different ones, so comparing codecs fired on identical-language re-encodes and stayed silent on real dub changes. Few panels tag a language, so the warning is usually silent — which is the honest state.
- HEAD probe reuses the main-process handler extracted to `apps/electron-backend/src/app/events/stream-probe.ts` (`STREAM_PROBE_URL`; `XTREAM_PROBE_URL` still delegates there for catchup), and carries the playlist's own `userAgent`/`referer`/`origin` (`StreamProbeHeaders`) — a panel that requires them answers 401/403 otherwise and a working source would be shown as dead. No ffprobe — the binary is not bundled.
- See `docs/architecture/vod-multi-source.md`

**Radio Player**:

- Dedicated audio player for channels with `radio="true"` M3U attribute
- Cinematic layout: blurred station logo as backdrop, floating artwork card, transport controls
- Always uses the built-in inline player — external player settings (MPV/VLC) are ignored for radio
- EPG panel is hidden for radio channels (radio streams have no EPG data)
- Volume synced with video player via shared `localStorage` key `'volume'`
- Keyboard shortcuts: ArrowUp/ArrowDown (volume), M (mute)
- Component: `libs/ui/playback/src/lib/audio-player/audio-player.component.ts`

**EPG (Electronic Program Guide)**:

- XMLTV format support
- Background parsing in worker thread
- Stored in database for quick lookup
- Global display-time offset (`Settings.epgOffsetMinutes`, Settings → EPG, ±720 min, Electron only): display-only, provider data is never rewritten. Two equivalent forms in `libs/shared/interfaces/src/lib/epg-display-offset.util.ts` — `epgDisplayTimeMs` (shift the programme; `ui/epg` rendering via the `offsetMinutes` input, channel rows, dashboard/recording labels; the programme dialog and the programme guide read the store themselves) and `epgProviderClockMs` (shift "now"; every "currently airing" decision: the `GET_CURRENT_PROGRAMS_BATCH` lookup takes an explicit `nowMs` and `EpgService` tags its cache with the offset, Xtream/Stalker/M3U current-programme selection and previews, the unified collection resolver, dashboard progress, recording overlap). A consumer applies exactly one form per comparison. Contract: `docs/architecture/m3u-playlist-module.md` ("EPG display offset")
- Programme guide (Electron, M3U): `app-epg-guide` in `libs/ui/epg` fed by the host-provided `EPG_GUIDE_SOURCE`; the M3U host switches into guide mode (docked player strip, no sidebar/timeline, no remount) from the header action, the palette, the EPG panel's Guide button (timeline or list view) or `G`. Data: `EPG_GET_PROGRAMS_FOR_CHANNELS` / `EPG_GET_PROGRAM_COVERAGE` (keys resolved in main; manual mappings honoured). Contract: `docs/architecture/m3u-playlist-module.md` ("Programme guide").
- Manual EPG mapping (Electron only): right-click a channel in any list (M3U views, Xtream portal list, Stalker ITV sidebar, global favorites) → "Map EPG channel" attaches it to an uploaded-XMLTV channel; stored in `epg_channel_mappings` keyed by the M3U lookup key or a playlist-scoped portal key (`xtream:{playlistId}:{id}` / `stalker:{playlistId}:{id}`, helpers in `libs/shared/interfaces/src/lib/epg-mapping-key.util.ts`); resolved on every EPG path (single + batch IPC lookups, portal detail views, preview queues); dialog: `libs/ui/components/src/lib/channel-list-container/epg-mapping-dialog/`

**TMDB Metadata Enrichment** (opt-in):

- Enriches Xtream and Stalker VOD/series detail views with TMDB data (plot, cast with avatar chips, director, genres, rating, artwork, YouTube trailers) via a field-level merge — the provider stays authoritative for stream data and any field TMDB can't fill; Cyrillic titles are searched with `ru-RU` so exact-title matching works
- The M3U player consumes it too: entries recognized as movie files open in the VOD detail shell fed purely by `enrichMovie` (no provider payload to merge); the extra `Settings.m3uVodDetails` toggle (default on) sits in the TMDB settings section — see "M3U Movie Recognition" above
- "Similar" rail in ALL detail views: TMDB recommendations matched against the provider catalog by normalized title, two-tier — exact form first, year-stripped fallback gated on year compatibility (`libs/portal/xtream/feature/src/lib/tmdb-similar.util.ts`, `normalizeTitleKeys`); cross-portal matches from other imported Xtream playlists supplement the Xtream rail and fully power the Stalker rail (`CrossPortalSimilarService` in `libs/services`, batched `DB_MATCH_TITLES`, Electron only); detail components re-initialize on route param changes since the router reuses them for detail→detail navigation
- Season/episode enrichment: opening a season lazily fetches `/tv/{id}/season/{n}` and overlays real episode names, overviews and stills via `mergeEpisodesWithTmdb` (Xtream: `XtreamStore.enrichSelectedSerialSeason`; Stalker: overlay in the series view's `mappedSeasons`); for single-season provider slices whose title carries an explicit season marker ("The Mandalorian (2 season)", "s02", "2 сезон"), the marker overrides the provider's renumbered season (`resolveEnrichmentSeasonNumber` in `libs/shared/interfaces/src/lib/season-marker.util.ts`)
- Dashboard: opt-in "Trending this week" rail (weekly TMDB trending matched against imported Xtream playlists via one batched `DB_MATCH_TITLES` request; Electron-only, `dashboardRails.tmdbTrending` toggle), a "Because you watched" recommendations rail (`dashboardRails.tmdbRecommendations` toggle; TMDB has no account-free "for you" endpoint, so `DashboardRecommendationsService` seeds per-title `recommendations` — already riding in every cached details payload — from up to 3 recently watched movies/series via the shared `dashboard-tmdb-lookup.util.ts` attempt builder, interleaves them, dedupes by TMDB id (title collisions are resolved after matching, by the catalog row, so same-titled remakes both reach the matcher), drops watched/favorited titles through a year-gated exclusion index built by the same lookup-attempt builder (so a Stalker embedded-VOD series indexes under `series:` despite routing as `movie`, and its stored `o_name` alias counts too; only the PRIMARY attempt is indexed, or a watched film would swallow the same-named show) on two title tiers (exact normalized title plus a year-gated base tier so a stored "Inception 2010" excludes TMDB's "Inception" while "Blade Runner 2049" does not swallow the 1982 film), keeps only year-compatible `DB_MATCH_TITLES` matches — matching/exclusion run through both the localized title and the TMDB original-title alias, and a year-incompatible first alias falls through to the other — and hides the rail below 5 cards while resetting the latch; successful loads are keyed by TMDB language + seed set + watched/favorited exclusion set + imported-playlist ids, an emptied history clears the rail, a mid-flight load request is queued, and a no-seed-resolved load retries instead of latching) and hero TMDB extras (backdrop fallback, rating + genre badges, memoized per lookup identity; series heroes show the tracked S/E badge from playback positions) — `DashboardTrendingService` in `libs/workspace/dashboard/data-access`, `DashboardHeroTmdbService` in `libs/workspace/dashboard/feature`; both load async after first paint. The hero lookup must carry the same identity the detail view used, not just the display title — `extractStalkerItemTmdbHints` (`libs/shared/interfaces`) reads title/original title/year/tmdb id off a stored Stalker entry; an unconfirmed Stalker `movie` verdict retries as `tv` without the id (the default answer earns a retry, and an id is valid only for its own media type), while a `tv` verdict — reached only on positive series evidence — gets no retry back to `movie`; a confirmed `movie` gets none either, and is confirmed by an Xtream `source` (that catalog files movies and series apart) or by a stored Stalker `info.tmdb_id` (never a provider claim, only a match this app already gated). The lookup key is the WHOLE attempt sequence, since two rows can share title/year/id yet differ in whether a `tv` fallback follows, and callers memoize by it. Stalker items never reach the `content` table, so their backdrop rides in the stored entry (`info.tmdb_backdrop`) rather than `content.backdrop_url`, and the activity mappers surface it as `backdrop_url`. Xtream rows carry the same identity on the `content` row: the detail views back-fill `tmdb_id`/`release_year`/`original_title` next to `backdrop_url` (`xtreamDetailContentMetadata` → `XtreamStore.backfillContentMetadata` → `DB_SET_CONTENT_METADATA_IF_MISSING` → `persistContentMetadataIfMissing`), the activity SELECTs project them onto `PortalActivityItem`, and `buildDashboardTmdbAttempts` reads them back. Writes are per-column and never overwrite (enrichment supplies the pieces at different times, so a row-level guard would let the first arrival block every later one); `release_year` is the year the PROVIDER stated, never one read out of the title (readers still apply that fallback themselves, so an absent column means "no provider date" — and "2001: A Space Odyssey" can never be frozen in as a 2001 film), which holds only because the TMDB merge marks the dates it substitutes itself with `tmdb_supplied_release_date` and the extractor skips those — the merge's other `tmdb_*` fields are conditional on having content, so they cannot serve as an "enrichment ran" signal; the id is stored unvetted because every consumer re-gates it through `assessProviderId`; and there is no media-type column, since for Xtream `content.type` already is the media type. Both sides validate through `normalizeContentMetadataPatch` (`libs/shared/interfaces`), so legacy rows, never-opened rows and provider junk all collapse to the title-only fallback — as does the PWA, whose catalog cache is rebuilt from the API on every load
- Series detail views show a TMDB production-status chip (`tmdb_status`, e.g. Ended / Returning) — TMDB sends `status` in English regardless of request language, so it is normalized to a token by `normalizeSeriesStatus` and rendered via `seriesStatusLabelKey` translations; person pages show `deathday` alongside `birthday`
- Actor pages: cast avatar chips are clickable (TMDB person id) and open `actor/:personId` inside the current portal — TMDB person bio + full filmography (acting + directing credits merged; acting wins the per-title dedup); director/creator chips (`tmdb_directors` via `enrichedDirectors`/`enrichedCreators` in `tmdb-credits.ts`) are clickable the same way and open the same person page; Xtream matches titles against the loaded catalog (direct navigation), unmatched titles and all Stalker titles open the portal search prefilled (`?q=`); the in-portal search page shows a Back button (`SearchLayoutComponent.showBackButton` → `Location.back()`) so users can return to the actor page; shared UI in `libs/ui/shared-portals` (`ActorViewComponent`, whose grid is the extracted `TitleResultsComponent` shared with the Discover pages)
- Discover pages (clickable metadata chips, issue #1449): year, genre, and country chips on all four detail views (Xtream VOD/series, shared Stalker detail, Stalker series) are clickable when TMDB matched the item — the merges emit structured `tmdb_genres`/`tmdb_countries` (+ `tmdb_media_type` on Stalker), the year chip renders from provider data so it is gated on the navigation TARGET instead of the item's identity — `createDiscoverFacetNavigation()` offers a facet only when a playlist resolves AND `TmdbEnrichmentService.isEnabled()`, since Discover reads its results from TMDB (gating on `typeof tmdb_id === 'number'` is WRONG: the field is `number | string` and a provider-sent number satisfied it with enrichment never having run) — and clicks navigate via `discoverLink()` (`libs/portal/shared/util`) to the portal-scoped `discover` route (`?type&year&genre&genreLabel&country&countryLabel`). The route containers (`XtreamDiscoverRouteComponent`, `StalkerDiscoverRouteComponent`) clone the actor-page pattern: TMDB `/discover` top-5-pages by popularity via `TmdbDiscoverService` (session-only Map cache, never persisted to `tmdb_metadata`), matched against the catalog (Xtream in-memory index / all-portals `DB_MATCH_TITLES`; Stalker search-prefill), rendered by `DiscoverViewComponent`. Facets change via query params on the same route instance, so the discover load is guarded by recency (`createLatestRequestGuard()`) — A→B→A leaves two in-flight requests sharing one `discoverFacetKey()` — while the catalog match uses the guard for its spinner and the facet key for its results; availability also waits for catalog readiness (in-flight flags, not `isContentInitialized`, so a failed import still settles). See "Discover Pages" in `docs/architecture/tmdb-metadata-enrichment.md`
- Actor page "All portals" scope (Electron only): batched `DB_MATCH_TITLES` worker op (trigram FTS over all imported Xtream playlists, `apps/electron-backend/src/app/database/operations/title-match.operations.ts`); `normalizeTitle` is shared renderer/worker via `libs/shared/interfaces/src/lib/title-normalization.util.ts`
- All `DB_MATCH_TITLES` consumers (Trending rail, "Because you watched" recommendations rail, cross-portal Similar rail, actor "All portals" scope) resolve the worker's flat result list through the shared `groupTitleMatchesByKey()` + `pickTitleMatch()` in `libs/services/src/lib/catalog-title-match.service.ts`. The grouping keeps EVERY row per `type:exactNormalizedTitle` on purpose — the year that separates same-titled rows belongs to the lookup, which the grouping cannot see, so collapsing first made a catalog holding both "Dune 1984" and "Dune 2021" drop whichever copy the user actually owns. `pickTitleMatch` then ranks year-compatible rows by evidence (exact year → untagged → any compatible) across all title aliases at once; only the recommendations rail passes an alias (TMDB `original_title`, via `candidateLookup()`). Multi-source VOD discovery deliberately stays off these helpers: there every copy is a distinct selectable source, not one best answer
- Opt-in via `Settings > Metadata (TMDB)` (sends titles to TMDB); the section also has a "check key" button and a cache panel (row count + payload size, with a clear button); optional user API key overrides the embedded default (`DEFAULT_TMDB_API_KEY` in `libs/services/src/lib/tmdb/tmdb-config.ts` — an empty placeholder in the repo by design; the real key lives in the `TMDB_API_KEY` GitHub Actions secret and is injected at CI build time by `tools/tmdb/inject-tmdb-key.mjs`)
- Match confidence: a provider `tmdb_id` is a strong hint, not gospel — its payload is weighed against the item (`assessProviderId`: title or year agrees → use it; both years known and incompatible → the search may take over; title-only mismatch → keep it, since TMDB localizes titles). A 404 marks the id dead (`badProviderId:<id>` row); transient failures never do. Without a usable id: normalized-title + year (±1) search with a strict gate — no confident match means no enrichment
- Detail views render provider data immediately; enrichment patches the selection asynchronously (staleness-guarded)
- Cached in SQLite `tmdb_metadata` (Electron, via DB worker ops `DB_GET/SET_TMDB_METADATA`, plus `DB_GET_TMDB_CACHE_STATS` / `DB_CLEAR_TMDB_METADATA` behind the settings cache panel) or in-memory (PWA); localized via the app language setting. Search-match lookup keys are versioned, and connection startup removes obsolete unversioned rows once through the `migration:tmdb-search-lookup-v2-cache-cleanup:v1` app-state marker.
- Service layer: `libs/services/src/lib/tmdb/`; store glue: `libs/portal/xtream/data-access/src/lib/stores/xtream-tmdb-enrichment.ts` and `libs/portal/stalker/data-access/src/lib/stores/stalker-tmdb-enrichment.ts` (hooked in `withStalkerSelection().setSelectedItem`)
- TMDB attribution (logo + disclaimer) is required and shown in the settings TMDB section and About
- See `docs/architecture/tmdb-metadata-enrichment.md`

**Portal Account Info**:

- Both portal types expose an account-info dialog through the same entry points: header playlist switcher (bottom section for the active playlist + per-row ⋮ menu), dashboard source card ⋮ menu, and the command palette. Gates use the shared predicates in `libs/shared/interfaces/src/lib/portal-account-playlist.utils.ts`; `WorkspaceShellHeaderService.openAccountInfoFor()` picks the dialog by playlist type.
- Xtream: `AccountInfoComponent` (`libs/portal/xtream/feature/src/lib/account-info/`), queries `get_account_info` live.
- Stalker: `StalkerAccountInfoComponent` (`libs/portal/stalker/feature/src/lib/stalker-account-info/`), cached-first — renders the import-time `stalkerAccountInfo` snapshot instantly, then `StalkerAccountInfoService` refreshes, routing by the observed portal MODE rather than the URL shape (full mode: handshake+`get_profile`; simple mode: best-effort `account_info/get_main_info`, nested `js.account_info` envelope or flat fields), and re-routing when a lazy repair changes the mode mid-request. Details: `docs/architecture/stalker-portal.md` ("Account Info Dialog").
- Dashboard source cards carry a passive subscription-expiry chip (amber within 7 days, error-toned once expired); account details remain behind ⋮ → Account info. `DashboardSourceExpiryService` (`libs/workspace/dashboard/data-access/`) gathers the facts: Xtream from `PortalStatusService.checkPortalStatusDetails()` (the switcher's cached status check, now carrying `exp_date`), Stalker from the persisted `stalkerAccountInfo` snapshot — it lives in the playlist payload, not on meta rows, so each Stalker source costs one memoized full-playlist read.

**Stalker Portal Mode and Endpoint Discovery**:

- Every resolved Edit commit is guarded by the source connection authority captured when Edit began. Electron checks it inside the per-playlist write queue; PWA performs the read, predicate, and cursor update in one IndexedDB readwrite transaction, so another tab cannot interleave a replacement. The one-time legacy mode-flag migration also scans and updates rows through one readwrite cursor transaction and never replays a pre-transaction snapshot. Delete/restore or replacement under the same playlist ID aborts both ordinary and post-navigation writes; the latter still merge concurrent title/EPG metadata when authority matches.
- Portal mode (full vs. simple) follows OBSERVED behavior, never a URL substring. The single predicate is `isFullStalkerPortalPlaylist()` / `isFullStalkerPortalUrl()` in `@iptvnator/shared/interfaces` (`stalker-portal-mode.util.ts`): the persisted `Playlist.isFullStalkerPortal` flag is authoritative and the URL shape is a fallback for legacy rows only. Three diverging copies of this rule used to exist and shipped broken configurations (#850/#686/#755) — never re-implement it. A token-enforcing `portal.php` panel is a full portal; a `server/load.php` endpoint that answers without a token is a simple one.
- Import requires an explicit HTTP(S) scheme but accepts a bare host, `/c`, or a concrete `.php` address. It probes candidates in order (a pasted `.php` endpoint first, then `<base>/portal.php` → `<base>/server/load.php` → `<base>/stalker_portal/server/load.php`) and classifies each by behavior — a token-less `itv/get_genres` returning data proves a token-free panel; the plain-text auth failure proves a full portal, confirmed by a real handshake + `get_profile`. `StalkerPortalDiscoveryService` (`libs/portal/stalker/data-access`) persists and displays the proven endpoint and mode. An unreachable panel-style import remains allowed with a warning; a bare host falls back to `<base>/portal.php`, while canonical-shaped unreachable addresses still abort. If bounded discovery returns while abandoned authentication remains on the wire, the refusal is shown immediately but Add and every form field stay disabled until its settlement promise resolves.
- The playlist-info Edit dialog loads the complete persisted Stalker row before enabling the form, because Electron's startup metadata projection omits payload-only serial/device/signature/mode fields; a summarized row must never render and then persist an empty portal identity. A metadata-only Save omits connection/mode fields from its queued update, so the stored connection stays byte-identical even if the dialog hydrated before a concurrent discovery committed; it skips discovery. A persisted `portalUrl` keeps the row on the Stalker save path even if legacy Xtream fields remain. Changing URL, MAC, credentials, serial, device IDs or signatures blocks duplicate saves, disables dialog closure for the validation window, and runs the existing discovery service through the app-provided `STALKER_PLAYLIST_CONNECTION_EDITOR` token, keeping Stalker data-access out of `playlist-shared-ui`. Before discovery, PWA acquires a shared playlist-authority barrier plus an exclusive origin-wide per-playlist Web Lock and verifies the persisted source authority while holding both. Add/delete, backup restore, and bulk replacement take the same row lock, while Delete All takes the barrier exclusively, so authority cannot change between preflight and the identity-bearing request. A concurrent Edit or stale dialog fails before remote discovery; a replacement waits for the current owner. Same-tab Save first publishes its local authentication owner, drains an existing lazy repair through actual Web Lock request completion, and only then asks for the conflicting row lock; repair callers already queued behind that owner observe the Edit block and do not reserve again. PWA fails closed if Web Locks are unavailable, while Electron relies on its single-instance local owner. The reservation blocks every new authentication (including fingerprint-equivalent URL edits) and repair, drains existing work, and rechecks ownership after every asynchronous drain/rebase; ordinary failure releases it without changing the saved or runtime connection. If discovery returns after its bounded drain while an abandoned authentication is still on the wire, that result carries its settlement promise and both reservations remain installed until it resolves, so catalog, watchdog, repair, or retry authentication cannot race a late `get_profile`. Once Save starts, navigation or dialog destruction does not discard a later successful result: `get_profile` may already have pinned the submitted serial/device identity remotely and cannot be recalled. That late commit uses `transformPlaylistMeta()` inside the per-playlist write queue to merge only connection/session fields into the current row, so newer title/EPG/metadata edits win; its returned row feeds the state-only update together with discovery's transient session patch, so NgRx replaces or clears its session fields while success UI is suppressed. Success uses one awaited write to atomically replace endpoint, mode, normalized identity and session metadata, then feeds its complete merged row into the state-only NgRx update and active `StalkerStore`/session/watchdog replacement before another same-route request can use the old connection. This preserves playback headers and other metadata absent from the form. Runtime configuration authority covers the observed full/simple mode as well as the session fingerprint, and both authenticated and direct simple requests cross its guard before dispatch and after transport, so a same-endpoint mode change rejects stale snapshots and completed responses in either direction. A changed authority may rebase only when the persisted row proves that it owns the same playlist ID, keeping delete/restore and backup merge usable. The transient `PlaylistMetaUpdate.stalkerSessionPatch` preserves on absence, clears on `null`, and fully replaces from an object before storage; it is projected onto existing flat playlist fields and never changes the DB or backup shape.
- `executeStalkerRequest()` (`stores/utils/stalker-request.utils.ts`) is the choke point for catalog, content and playback requests: mode routing, the in-session repair override, and retry-once all live there. Four callers are deliberately outside it because they run below or before the thing it routes on — `StalkerAuthApi` (handshake/`get_profile`/`do_auth`, which the full-portal branch is built from; routing them back would recurse), `StalkerPortalDiscoveryService` (probes precede the mode they determine), `StalkerAccountInfoService.fetchViaProfile()`, and `StreamResolverService` for a collection item with no playlist row. They are exempt from the routing, not from the repair it hooks, but only `fetchViaProfile()` wires `StalkerPortalRepairService` itself: discovery is what repair _drives_, the row-less resolver branch has no playlist to repair, and the auth layer needs nothing — a terminal handshake failure propagates out of the full-portal branch into whichever `executeStalkerRequest()` call triggered the authentication, which is why terminal handshake failures are a repair trigger. Anything new that is not auth or discovery belongs on `executeStalkerRequest()`. Existing playlists are repaired LAZILY (`StalkerPortalRepairService`) — only after a request fails with a shape a wrong endpoint/mode produces, at most once per source configuration per playlist per session, persisted through the atomic `PlaylistsService.transformPlaylistMeta`. Before an unrecorded repair reads the persisted source or calls discovery, PWA takes the same playlist-authority barrier and row reservation as explicit Edit; contention or unavailable Web Locks declines repair without a remote request, and ownership is held through the conditional transform. This prevents repair in another tab from authenticating alongside Edit or crossing delete/restore. The persisted-row preflight still verifies that the caller owns the failing source, so a late pre-Edit request cannot authenticate against the old portal after Edit commits and invalidate the newly saved token. Its in-session override is bound to source endpoint, mode, device identity, and credentials; an Edit or backup restore with the same playlist ID but different connection metadata retires the override and token only after the persisted row confirms ownership and only if no explicit Edit took ownership during that read, so a delayed stale request cannot remove valid runtime state or a token negotiated by the overlapping Edit. Each repair installs a session-level authentication fence synchronously, drains the existing token slot before probing, and keeps request routing ahead of effective-connection selection until repair finishes; an abandoned transport keeps both the repair and session fences until it actually settles. There is deliberately **no eager one-shot migration**: a portal that works is never re-probed.
- Explicit Edit advances the repair generation before installing its resolved session. Lazy repair captures that generation before any probe-history row read and rechecks it with the active Edit fence before reserving discovery. A repair that started earlier is therefore discarded even if it was restoring a `discarded` history record or had already verified its row, so it cannot probe alongside Edit or restore an older endpoint, mode or token afterwards.
- Both transports build the wire format from the same shared builders in `@iptvnator/shared/interfaces` — `buildStalkerRequestUrl()`, `buildStalkerIdentityRequestContext()`, `encodeStalkerCmdValue()` — so the Electron and PWA legs cannot drift. The mock's `/stalker` mirror shares the identity builder only — it dispatches in-process, so there is no portal URL to build and it mirrors the `JsHttpRequest` default by hand. Never fork any of them.
- Simple portals skip the auth lifecycle (no handshake, token or watchdog) but their requests are not stripped to a bare cookie: they still carry everything the shared builder derives from a MAC alone (`mac`/`stb_lang`/`timezone` cookie, MAG `User-Agent`/`X-User-Agent`, `Accept` set). They do NOT carry the serial — `dispatchStalkerRequest()`'s direct branch forwards only `url`/`macAddress`/`params`, so no `SN` header and no serial-derived `__cfduid`, whatever the playlist stores. That gate is on API requests only: `buildStalkerExternalPlaybackHeaders()` reads the serial off the playlist row with no mode check, so the same simple-mode playlist does send `SN`/`__cfduid` with a portal-owned stream.
- Contract: `docs/architecture/stalker-portal.md` ("Portal Mode and Endpoint Discovery", "Request Transport and `cmd` Encoding").

**Stalker Session Authentication**:

- Full portals authenticate through `StalkerSessionService` (`libs/portal/stalker/data-access/src/lib/stalker-session.service.ts`), a thin facade over `stalker-auth.api.ts` (handshake / `get_profile` / `do_auth` + the `authenticate()` orchestration), `stalker-authenticated-request-client.ts`, `stalker-edited-session-coordinator.ts` (authoritative Edit/session serialization), `stalker-watchdog.controller.ts`, `stalker-token-cache.ts` (in-run token + pending-auth state, tagged with the identity fingerprint), `stalker-session-store.ts` (the session persisted on the playlist row), `stalker-portal-error.ts` and `stalker-response-classification.ts`.
- `get_profile`'s `js.status` decodes as: full profile/`0` = OK, `1` = refused (`device-conflict` when the message says so, otherwise `blocked`), `2` = login/password required → `do_auth` then `get_profile` with `auth_second_step=1` (only that retry sets it). A bare `{status: 1}` with no message is a refusal, not a success. Credentials come from the import dialog's username/password fields and are persisted so runtime re-auth can repeat `do_auth`. Status is read through a numeric coercion — portals stringify it.
- Refusals throw `StalkerPortalError` (`login-required` / `login-rejected` / `device-conflict` / `blocked` / `auth-failed`) carrying the portal's markup-stripped `msg`/`block_msg` in `portalText`; the import dialog and the workspace context panel render it. Read it with `asStalkerPortalError()`, never `instanceof` in lazy-loaded code. `device-conflict` splits off `blocked` via `isStalkerDeviceConflictMessage` (narrow phrase set, structured `msg` only): it is the one refusal with a remedy, and the portal's own "Your STB is damaged" wording points away from it, so both surfaces lead with their own headline and append the portal text.
- Auth failures are HTTP 200 + plain text (`Authorization failed.` / `Access denied.` / `Unauthorized request.`), classified at the transport boundary by `libs/shared/interfaces/src/lib/stalker-auth-failure.util.ts`; the Electron handler **returns** a `{stalkerAuthFailure}` marker rather than throwing, because `ipcRenderer.invoke` strips custom properties off rejections.
- The handshake is idempotent, so `Playlist.stalkerToken` is re-presented and `get_profile` is skipped when it comes back unchanged (unless `not_valid` is set, or the persisted `stalkerSessionIdentity` no longer matches `stalkerSessionFingerprint(playlist)` — portal endpoint (origin, path, and URL Basic-auth userinfo) + identity + credentials; an edited endpoint, MAC or login must never inherit the previous session, and a token with no recorded fingerprint counts as unverified. The path is deliberate: discovery preserves tenant base paths, so `/tenant-a/server/load.php` and `/tenant-b/server/load.php` are different portals on one host and must not share a session; URL parsers omit `user:pass@` from `origin`, so userinfo is tracked separately while endpoints without it retain their previous fingerprint across upgrades). The advertised watchdog cadence is persisted alongside it (`stalkerWatchdogTimeout`/`stalkerTimeslot`) precisely because that reuse skips the response carrying it — and the skip only applies once the cadence is known, so a legacy token-only playlist profiles once instead of being stranded on the default. The _effective_ cadence is stored, so stored absence means "never profiled" and nothing re-profiles on every start.
- Watchdog: `get_events` immediately (`init=1`), then every `watchdog_timeout` s (default **120**, clamped 30–3600) offset by `timeslot`. Ping failures are logged only — a missed ping never invalidates auth, it only affects the portal's "online" reporting.
- Full contract: `docs/architecture/stalker-portal.md` ("Session Authentication Lifecycle").

**Stalker Identity Hardening**:

- The MAC is canonicalized to `00:1A:79:XX:XX:XX` by `normalizeStalkerMacAddress` (`@iptvnator/shared/interfaces`) at the INPUT boundary only — the import dialog and the playlist-info edit dialog, on blur and again on submit. Stored MACs are never rewritten on read: the MAC is the account key, and a transport-level rewrite would move `stalkerSessionFingerprint` for every existing playlist with no user action. An edit does move it, deliberately. `validateStalkerMacAddressControl` is the shared form validator, typed structurally so the contracts lib stays Angular-free.
- Format is enforced, the Infomir OUI is **advisory only**: `hasInfomirMacOui` drives a hint, never a rejection. The stock filter is off on most reseller panels, so non-Infomir MACs are working setups; refusing one would lock those users out (`AUTH_REJECTED_MAC` in `stalker.e2e.ts` relies on a non-Infomir MAC being importable, and the mock only applies `enforceMacFormat` on the strict endpoint). The edit dialog additionally grandfathers the stored value via `createStalkerMacAddressValidator` — a pre-validation playlist may hold arbitrary text, and blocking Save would strand its title/URL/EPG edits too.
- `deriveStalkerDeviceIdsFromMac` returns the StbEmu / `stalker-to-m3u` PAIR: `SHA256(MAC)` for `device_id` and `SHA256(MAC + 'stalker')` for `device_id2`. They must differ — a real box reports them from separate firmware calls and never equal, and the pinning is permanent, so an identical pair could never be corrected. Offered as an opt-in checkbox **at import only**, writing into the visible fields and persisted as literal strings — never recomputed at request time. The portal pins the first non-empty `device_id`/`device_id2` to the MAC forever, refuses a different one, and treats a later empty value as a permanent lockout, so a derived value that silently followed a MAC edit would be unrecoverable. The edit dialog offers no derivation and shows `DEVICE_ID_PINNED_WARNING` once an ID is stored.
- `get_profile` reports one coherent MAG250 via `STALKER_STB_PROFILE_PARAMS` (`ver`, `stb_type` — previously empty —, `hw_version`, `image_version`, `client_type`, `num_banks`, `video_out`, `hd`). Constants, identical per playlist, deliberately outside both fingerprints.
- Contract: `docs/architecture/stalker-portal.md` ("Stalker Identity Policy").

**Favorites and Recently Viewed**:

- Per-playlist favorites and global favorites
- Recently viewed tracks watch history

**Internationalization**:

- Uses `@ngx-translate` with 19 language files in `apps/web/src/assets/i18n/`

## Development Notes

### Environment Detection and Dual-Mode Architecture

The app determines whether it's running in Electron or as a PWA by checking:

```typescript
window.electron; // truthy in Electron, undefined in browser
```

**Why Dual Mode?**
IPTVnator supports both Electron (desktop app) and PWA (web browser) to provide flexibility:

- **Electron**: Full-featured desktop experience with local database, external player support (MPV/VLC), and native file system access
- **PWA**: Lightweight web version that runs in any browser without installation

**Environment-Specific Behavior**:

- `app.config.ts` - `DataFactory()` selects DataService implementation based on environment
- `app.routes.ts` - Same `/workspace/...` route tree in both environments; guards keep Electron-only routes (e.g. global search) out of the PWA
- Storage layer switches automatically:
    - Electron → SQLite/Drizzle ORM → `~/.iptvnator/databases/iptvnator.db`
    - PWA → IndexedDB → Browser storage
- External player support (MPV/VLC) only available in Electron
- File system operations only available in Electron (uploading playlists from disk)

**Base Href Configuration**:
The app uses different base href values depending on the build target:

- **Development & PWA**: `baseHref="/"` (from `index.html`)
    - Used by: `pnpm run serve:frontend`, `pnpm run build:frontend:pwa`
    - For web servers with proper routing
- **Electron Production**: `baseHref="./"` (overridden in build config)
    - Used by: `pnpm run build:backend`, `pnpm run make:app`
    - Required for `file://` protocol in Electron

Build configurations in `apps/web/project.json`:

- `production`: Electron build with `baseHref="./"`
- `pwa`: Web deployment with `baseHref="/"`
- `development`: Dev mode with `baseHref="/"` from index.html

**Factory Pattern Implementation**:
The factory pattern ensures a single codebase works in both environments without conditional checks scattered throughout the application. All environment-specific logic is encapsulated in the service implementations.

**Build Commit In About**:
CI injects the git commit into `apps/web/src/environments/build-commit.ts` via `tools/build/inject-build-commit.mjs` (same placeholder pattern as the TMDB key inject); `Settings > About` then shows `"<version> (<short-sha>)"`. The semver version itself deliberately stays untouched — a `-sha` suffix would flip electron-updater into prerelease mode and leak into installer/artifact version fields. Local/dev builds keep the placeholder empty and show the plain version.

### Testing Strategy

- **Unit tests**: Jest with `jest-preset-angular` and `ng-mocks`
- **E2E tests**: Playwright testing the web app and Electron app
- Backend tests use standard Jest
- Bug fixes should add focused regression coverage unless there is a documented reason not to.
- Use the impact-based validation policy in `Regression Prevention And Test Updates` to choose targeted unit tests, atomized E2E targets, broad suites, or CDP/manual verification.

### Nx Commands

Use `nx` CLI for better performance:

```bash
pnpm nx run <project>:<target>
# Example: pnpm nx run web:build
# Example: pnpm nx run electron-backend:serve
```

To run multiple projects:

```bash
pnpm nx run-many --target=test --all
```

### Electron Build Process

The Electron backend depends on the web app being built first:

- `electron-backend:build` depends on `web:build`
- Output goes to `dist/apps/electron-backend` (backend) and `dist/apps/web` (frontend)
- Packaging combines both into distributable

### Database Migrations

No formal migration system yet. Schema changes are applied via raw SQL in the `createTables()` function in `libs/shared/database/src/lib/connection.ts` using `CREATE TABLE IF NOT EXISTS`. One-off data migrations run guarded by keys stored in the `appState` table.

### Common Patterns

**IPC Communication**:

1. Define handler in appropriate events file (e.g., `database.events.ts`)
2. Register with `ipcMain.handle()` in the event bootstrap function
3. Expose in preload script via `contextBridge.exposeInMainWorld()`
4. Call from Angular via `window.electron.<methodName>()`

**Adding New Playlist Source**:

1. Add type to `libs/shared/interfaces/src/lib/playlist.interface.ts`
2. Create event handler in `apps/electron-backend/src/app/events/`
3. Add the import flow in `libs/playlist/import/feature/` (add-playlist dialog + per-source import components) and surface it on the dashboard (`libs/workspace/dashboard/`) if needed
4. Update database schema if needed

**State Management**:

- Use NgRx for global application state (M3U playlists, `libs/m3u-state`)
- Use NgRx Signal Store with `signalStoreFeature()` composition for portal/feature state (XtreamStore, StalkerStore)
- Use NgRx signals for reactive data streams

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first when it is available - it has patterns for querying projects, targets, and dependencies. If it is unavailable, use `pnpm nx show projects`, `pnpm nx graph`, and project `project.json` files directly.
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## XMLTV Source Removal

Saving Settings → EPG reconciles cached XMLTV with committed global URLs and
all enabled M3U playlist sources. Startup runs the same reconciliation after
settings load and playlist migration. Ordinary saves skip unchanged normalized
source sets; an explicitly edited EPG field can retry a failed cleanup.
A cleanup failure after persistence still mirrors committed settings to Electron;
the form stays dirty for retry. Failed storage writes never mirror to main.
Failed settings reads and incomplete playlist migration never authorize pruning.
Removed sources retire queued/running imports and dismiss retained error rows
before worker-owned deletion. Retry waits for reconciliation and rechecks its
error row, including after trust-setting writes. Shared channel IDs survive while
another source has programmes or per-source channel metadata. The additive
`epg_channel_sources` table preserves each imported source's name, logo, URL and
timestamp plus transaction-ordered `write_order`, so removal restores the latest
surviving snapshot even when import timestamps tie; ambiguous legacy metadata
falls back to the XMLTV ID until reimport. Manual mappings remain user preferences, but no
longer resolve deleted data. Renderer lookup generations, Xtream previews and Stalker mapping-cache
invalidation prevent late results from restoring removed programmes. Provider
EPG is independent. See `docs/architecture/m3u-playlist-module.md`
("XMLTV source lifecycle").

## Web Backend Provider Redirects

All four provider proxy routes use `ValidatedHttpClient`: automatic redirects
are disabled, the initial URL and at most five redirect hops pass full URL/DNS
validation, and fresh agents pin each connection to that hop's validated IPs.
Host/SNI and TLS verification remain intact; outbound environment proxies are
disabled. Private-network opt-in applies to the chain. Cross-origin redirects
strip session headers; original query params are not replayed. One portal
admission owns the entire chain and final body, with explicit redirect evidence
preventing destination failures from penalizing the initial endpoint. Contracts:
`docs/architecture/pwa-self-hosted.md` and
`docs/architecture/host-connectivity-guard.md`.

## Portal Connectivity Preference

- Half-open trial slots follow the complete request lifetime with no elapsed-time
  expiry. All four Electron/web-backend portal handlers release in `finally`,
  independently of outcome reporting; cleanup preserves trial/epoch ownership
  and works while the environment override is disabled. Contract:
  `docs/architecture/host-connectivity-guard.md` ("Trial ownership follows the
  request lifetime").
- Desktop Settings > General > Portal connections exposes default-on
  `Settings.portalConnectivityGuard`. Only explicit false opts out. Save mirrors
  the value to Electron `PORTAL_CONNECTIVITY_GUARD` and applies it without restart;
  settings bootstrap restores it before the renderer loads. It controls Xtream
  and Stalker together. Preference transitions clear cooldowns and invalidate old
  request completions; unchanged saves preserve evidence. The environment switch
  `IPTVNATOR_DISABLE_CONNECTIVITY_GUARD=1` remains authoritative. PWA clients do not
  control the shared backend's guard.
- Both account-info dialogs explain guard refusals with localized paused-request
  copy and Retry now; Stalker preserves cached account data on a failed refresh.
  Contract: `docs/architecture/host-connectivity-guard.md`.

## Live TV Panel Levels

Portal live layouts (Xtream `live`, Stalker `itv`/`radio`) fold their panels
from the outside in, in three nested levels owned by `LiveSidebarState`
(`@iptvnator/portal/shared/util`): `expanded` (categories rail + channels rail
+ player), `categories-hidden` (channels rail + player) and `collapsed`
(player only). `LiveLayoutSidebarStateService` is the single source of truth, per
surface (`m3u` / `portal` / `collection`; the levels apply to `portal`); the
shell context sidebar folds the categories rail on
`areCategoriesHiddenFor('portal')` (at level 2 only while the portal store has
a selected category — the live root has no channels header to host the way
back — and always at level 3), the channels rail folds on
`isCollapsedFor('portal')`. While the rail is folded the
channels header turns its title into a category dropdown that opens the same
`WorkspaceContextPanelComponent` as a CDK popover through the
`LIVE_CATEGORIES_POPOVER` token: the workspace shell provides
`WorkspaceLiveCategoriesPopoverService` (focus-trapped `role="dialog"`,
closed by backdrop, Escape, selection, its footer and any `NavigationStart`),
the live layouts reach it through `createLivePanelsController()` (level
flags, dropdown bridge and focus handoff in one shared object; the token is
optional). `Cmd/Ctrl+B`, the header toggle and the
floating restore handle return to the level the user collapsed from (the
target is session-only; every level is restored as stored per surface).
Folded rails carry `inert`, and
`handoffFocusOnLiveSidebarChange()` / `focusIfFocusLost()` move focus to the
replacement affordance only when the activated button was removed or inerted.
M3U and the unified live tab have no categories rail and treat level 2 like
level 1. Contract: `docs/architecture/iptvnator-ui-guidelines.md`
("Collapsible Live Sidebar").

## Live Channel Return

Xtream and Stalker (including radio) capture displayed playback order on explicit
selection. Remote up/down, numbers and status use that queue while browsing
categories or search. Stalker commits after successful current URL resolution
and extends only loaded pages of the original scope. The conditional channel
header action clears search, returns to the accessible playing category and
focuses its row without changing playback. Contract:
`docs/architecture/remote-control.md` (Live channel return and playback order).

## Stalker Live Search

ITV sidebar and fullscreen searches independently filter the complete selected
category; only All Items searches the whole public catalog. Cached categories
search before windowing; missing/censored genres keep provider pagination,
including automatic continuation for short or empty search results. ITV search
never narrows shared provider pages or resets their index. Category changes
reset list windows and retain playback/active EPG. Contract:
`docs/architecture/stalker-portal.md` (Full ITV Channel List Cache).

## Channel and Detail Keyboard Scrolling

Channel scroll owners use `ChannelScrollFocusDirective`; pointer selection
focuses the viewport, native scrolling survives virtual row recycling, and
row Enter/Space activation stays separate from focus movement. Portal Live TV
uses ArrowRight from the selected category and ArrowLeft from the channels
pane to move between columns. Shared live sidebars reserve scrollbar space
beside the resize handle. `PortalDetailShellComponent` owns a visible native
scrollbar and guarded initial page focus. Contracts:
`docs/architecture/iptvnator-ui-guidelines.md` and
`docs/architecture/portal-detail-navigation.md`.
