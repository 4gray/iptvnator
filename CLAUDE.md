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
- Repo docs are canonical even when they were originally drafted by an LLM. External wiki pages are derivative or synthesis content unless explicitly promoted back into the repo.
- The external wiki sync is one-way by default: repo docs -> external wiki `_repo-context/`.
- If repo docs changed and `IPTVNATOR_WIKI_VAULT` is configured, run `pnpm wiki:export --mode changed` after the doc update.
- The wiki exporter only owns `_repo-context/` in the external vault. It must never overwrite repo docs or maintained wiki pages outside that folder.
- Final task summaries should state whether docs were updated, which doc changed, and whether wiki export ran, was skipped, or failed.

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
- Use scoped path aliases from `tsconfig.base.json` such as `@iptvnator/services`, `@iptvnator/shared/interfaces`, and `@iptvnator/ui/components`.
- Do not add new imports from legacy bare aliases such as `services`, `shared-interfaces`, `components`, `m3u-state`, or `database`.
- Every Nx project should keep `scope:*`, `domain:*`, and `type:*` tags in `project.json`.
- See `docs/architecture/nx-workspace-boundaries.md` for the current Nx tag and alias policy.
- Repository-specific skills are committed under `.codex/skills/`. If Claude Code does not load skills directly, treat those files as concise ownership docs.

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

### Electron CDP Debugging

- Start Electron in dev mode with: `nx serve electron-backend`
- Package-script equivalent: `pnpm run serve:backend`
- The workspace is configured to always launch Electron with: `--remote-debugging-port=9222`
- Use CDP clients (Chrome DevTools Protocol tools) against: `127.0.0.1:9222`
- When the task is Electron automation/debugging, use the `electron` skill
- Do not auto-open DevTools during normal CDP automation. In development, DevTools is opt-in via `ELECTRON_OPEN_DEVTOOLS=1`.
- If DevTools is open, `agent-browser --cdp 9222 ...` may attach to the DevTools page instead of the IPTVnator window (symptoms: `tab list` shows `about:blank`, empty snapshots, black screenshots). Inspect targets with `curl http://127.0.0.1:9222/json/list` and connect directly to the app page's `webSocketDebuggerUrl`.

For startup tracing or white-screen debugging:

```bash
IPTVNATOR_TRACE_STARTUP=1 nx serve electron-backend
```

Useful narrower flags:

- `IPTVNATOR_TRACE_IPC=1` traces renderer `window.electron.*` bridge calls
- `IPTVNATOR_TRACE_DB=1` traces DB worker requests and DB progress events
- `IPTVNATOR_TRACE_SQL=1` traces SQLite statements in both main and worker connections
- `IPTVNATOR_TRACE_WINDOW=1` traces BrowserWindow navigation/load lifecycle
- `IPTVNATOR_TRACE_PLAYER=1` traces external-player launch/reuse/polling debug output
- `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console logs into the Electron terminal

For GPU/compositor debugging:

```bash
IPTVNATOR_DISABLE_HARDWARE_ACCELERATION=1 nx serve electron-backend
```

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
# Lint frontend
nx lint web

# Lint backend
nx lint electron-backend
```

### Documentation And Wiki Export

```bash
# Export a full canonical-doc snapshot into the external Obsidian vault
pnpm wiki:export --mode full

# Export only the latest repo context into the external Obsidian vault
pnpm wiki:export --mode changed
```

## Architecture

### Monorepo Structure (Nx Workspace)

This is an Nx monorepo with the following structure:

- **apps/web** - Angular application (frontend, shared by Electron and PWA)
- **apps/electron-backend** - Electron main process
- **apps/web-backend** - HTTP backend for the self-hosted PWA (`/parse`, `/parse-xml`, `/xtream`, `/stalker` CORS proxy endpoints)
- **apps/remote-control-web** - Mobile remote-control web app served by the Electron backend
- **apps/web-e2e** - Playwright E2E tests against the web app
- **apps/electron-backend-e2e** - Playwright E2E tests against the Electron app
- **apps/stalker-mock-server** - Mock Stalker/Ministra portal for dev and E2E
- **apps/xtream-mock-server** - Mock Xtream Codes API for dev and E2E
- **apps/website** - Astro + Tailwind landing page and blog
- **libs/** - Shared libraries:
    - **epg/data-access** - EPG services, runtime bridge, program normalization
    - **m3u-state** - NgRx state management for M3U playlists
    - **playlist/import/feature** - Playlist import flows (file/URL/text upload, Xtream and Stalker import dialogs)
    - **playlist/m3u/feature-player** - M3U video player page and `/workspace/playlists/:id` routes
    - **playlist/shared/{ui,util}** - Shared playlist UI and utilities
    - **portal/xtream/{data-access,feature}** - XtreamStore, services, data sources; routed Xtream components
    - **portal/stalker/{data-access,feature}** - StalkerStore and routed Stalker components
    - **portal/catalog/feature** - Portal catalog UI
    - **portal/downloads/feature** - Download manager UI
    - **portal/shared/{data-access,ui,util}** - Cross-portal shared code
    - **services** - Abstract DataService contract and shared app services
    - **shared/interfaces** - TypeScript interfaces and types (incl. `ElectronBridgeApi`)
    - **shared/database** - Canonical Drizzle schema and DB connection (used by the Electron backend)
    - **shared/m3u-utils** - M3U playlist utilities
    - **shared/testing** - Shared test helpers
    - **ui/components** - Reusable UI components (incl. channel list)
    - **ui/epg** - EPG UI (timeline ribbon, multi-EPG, progress panel, program dialogs)
    - **ui/playback** - Player UI (video/audio players)
    - **ui/pipes** - Angular pipes
    - **ui/remote-control** - Remote-control UI pieces
    - **ui/shared-portals** - Portal-related UI components
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
        ┌────────────┬────────────┼────────────┬────────────┐
        ▼            ▼            ▼            ▼            ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│  withPortal│ │withContent │ │withSelection│ │ withSearch │ │ withPlayer │
└────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
        │                           │              │
        └───────────────────────────┼──────────────┘
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
│   │   │   ├── with-selection.feature.ts          # UI selection & pagination
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
- **Data source abstraction**: `IXtreamDataSource` interface with environment-specific implementations
- **Factory injection**: `provideXtreamDataSource()` selects Electron or PWA implementation at runtime

Data strategies by environment:
| Environment | Strategy |
|-------------|----------|
| **Electron** | DB-first: Check DB → fetch API if missing → cache to DB |
| **PWA** | API-only: Always fetch from API, store in memory |

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
- `FavoritesActions`: updateFavorites, setFavorites

See `docs/architecture/m3u-playlist-module.md` for complete documentation.

**Routing**: Lazy-loaded routes in `apps/web/src/app/app.routes.ts`. All user-facing routes are nested under the workspace shell (`/workspace/...`); `/` redirects into the workspace.

- Dashboard: `/workspace/dashboard`; sources overview: `/workspace/sources`
- M3U player: `/workspace/playlists/:id` (children: `favorites`, `recent`, `:view`) — routes in `libs/playlist/m3u/feature-player`
- Xtream Codes: `/workspace/xtreams/:id` (children: `live`, `vod`, `series`, `search`, `recently-added`, `favorites`, `recent`, `downloads`) — `libs/portal/xtream/feature/src/lib/xtream-feature.routes.ts`
- Stalker portal: `/workspace/stalker/:id` (children: `itv`, `vod`, `radio`, `series`, `favorites`, `recent`, `search`, `downloads`) — `libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts`
- Global collections: `/workspace/global-favorites`, `/workspace/global-recent`
- Global search: `/workspace/search` (Electron-only; a guard redirects the PWA to `/workspace/sources`)
- Downloads: `/workspace/downloads`
- Settings: `/workspace/settings` (`/settings` redirects there)

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

Keep TypeScript files under **300 lines**. Hard maximum is **350–400 lines**.

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

**Database**:

- **ORM**: Drizzle ORM with `better-sqlite3` (local SQLite file)
- **Location**: `~/.iptvnator/databases/iptvnator.db` (avoids spaces in path)
- **Schema** (`libs/shared/database/src/lib/schema.ts` — canonical; `apps/electron-backend/src/app/database/schema.ts` is a backwards-compat re-export shim):
    - `playlists` - Playlist metadata (M3U, Xtream, Stalker)
    - `categories` - Content categories (live, movies, series)
    - `content` - Streams/VOD/series items
    - `favorites` - User favorites
    - `recentlyViewed` - Watch history
    - `epgChannels`, `epgPrograms` - Persisted EPG data
    - `playbackPositions` - Resume positions
    - `downloads` - Download manager state
    - `appState` - Key-value app state (also tracks one-off data migrations)
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
    - `epg.events.ts` - EPG IPC registration and freshness/fetch orchestration; worker lifecycle lives in `epg-worker.service.ts`, DB lookups in `epg-query.service.ts`
    - `xtream.events.ts` - Xtream Codes API
    - `stalker.events.ts` - Stalker portal API
    - `player.events.ts` - External player IPC registration; MPV/VLC lifecycle logic lives in `mpv-session.service.ts`, `vlc-session.service.ts`, and shared `external-player-*` helpers
    - `settings.events.ts` - App settings
    - `electron.events.ts` - App version, etc.

**Workers** (`apps/electron-backend/src/app/workers/`):

- EPG parsing: `epg-parser.worker.ts`; main-process worker lifecycle is coordinated from `apps/electron-backend/src/app/events/epg-worker.service.ts`
- Non-EPG SQLite work: `database.worker.ts` (see `docs/architecture/sqlite-db-worker.md`)
- Playlist refresh: `playlist-refresh.worker.ts`

### Key Features

**Playlist Support**:

- M3U/M3U8 files (local or URL)
- Xtream Codes API (`username`, `password`, `serverUrl`)
- Stalker portal (`macAddress`, `url`)

**Video Players**:

- Built-in HTML5 player with HLS.js or Video.js
- External players: MPV, VLC (via IPC to Electron backend)
- Embedded MPV (experimental, macOS/Windows/Linux): renders mpv video inside the Electron window through a native addon. macOS uses the libmpv render API in an `NSOpenGLView`; Windows uses in-process libmpv with `--wid` against an app-owned child `HWND`; Linux spawns an out-of-process `mpv --wid=<x11-window>` controlled over a JSON IPC socket (X11/XWayland only, requires system `mpv` on PATH; subtitles/speed/aspect/recording are not exported there). mpv's own screensaver inhibition does not apply to any of these paths, so `EmbeddedMpvNativeService` holds an Electron `powerSaveBlocker` (`prevent-display-sleep`) whenever any session's status is `playing`, and releases it on pause, dispose, or shutdown. Service: `apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`; full architecture: `docs/architecture/embedded-mpv-native.md`.

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

**Favorites and Recently Viewed**:

- Per-playlist favorites and global favorites
- Recently viewed tracks watch history

**Internationalization**:

- Uses `@ngx-translate` with 18 language files in `apps/web/src/assets/i18n/`

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
- `@ngrx/component-store` is listed in `package.json` but unused in the codebase — do not introduce new usages

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
