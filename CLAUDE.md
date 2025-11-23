# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPTVnator is a cross-platform IPTV player application built with Angular and Electron, supporting M3U/M3U8 playlists, Xtream Codes API, and Stalker portals.

**Dual Environment Support**: The application is designed to work in both Electron and as a Progressive Web App (PWA). The architecture uses a factory pattern to inject environment-specific services at runtime, ensuring the same codebase works in both contexts.

## Development Commands

### Building and Serving

```bash
# Serve the Angular web app only (development mode, baseHref="/")
npm run serve:frontend
# or
nx serve web

# Serve with PWA configuration (optimized, baseHref="/")
npm run serve:frontend:pwa
# or
nx serve web --configuration=pwa

# Serve the Electron app (starts both frontend and backend)
npm run serve:backend
# or
nx serve electron-backend

# Build frontend for Electron (baseHref="./")
npm run build:frontend
# or
nx build web

# Build frontend for PWA deployment (baseHref="/")
npm run build:frontend:pwa
# or
nx build web --configuration=pwa

# Build backend (Electron)
npm run build:backend
# or
nx build electron-backend

# Package the app (creates distributable without installers)
npm run package:app
# or
nx run electron-backend:package

# Create installers/executables
npm run make:app
# or
nx run electron-backend:make
```

### Testing

```bash
# Run frontend tests
npm run test:frontend
# or
nx test web

# Run backend tests
npm run test:backend
# or
nx test electron-backend

# Run e2e tests (Playwright)
nx e2e web-e2e

# Run tests with coverage
nx test web --configuration=ci
```

### Linting

```bash
# Lint frontend
nx lint web

# Lint backend
nx lint electron-backend
```

## Architecture

### Monorepo Structure (Nx Workspace)

This is an Nx monorepo with the following structure:

- **apps/web** - Angular application (frontend)
- **apps/electron-backend** - Electron main process
- **apps/web-e2e** - Playwright end-to-end tests
- **libs/** - Shared libraries:
    - **m3u-state** - NgRx state management for playlists
    - **services** - Abstract DataService and implementations
    - **shared/interfaces** - TypeScript interfaces and types
    - **shared/m3u-utils** - M3U playlist utilities
    - **ui/components** - Reusable UI components
    - **ui/pipes** - Angular pipes
    - **ui/shared-portals** - Portal-related UI components

### Frontend Architecture (Angular)

**State Management**: Uses NgRx for playlist state management:

- Store configuration in `apps/web/src/app/app.config.ts`
- Playlist state, actions, effects, and reducers in `libs/m3u-state/`
- Entity adapter pattern for managing playlists collection
- Router store integration for route-based state

**Routing**: Lazy-loaded routes in `apps/web/src/app/app.routes.ts`

- Home/playlists overview: `/`
- Video player: `/playlists/:id` or `/iptv`
- Xtream Codes: `/xtreams/:id` (different routes for Electron vs web)
- Stalker portal: `/portals/:id`
- Settings: `/settings`

**Service Architecture** (Factory Pattern):

- Abstract `DataService` class in `libs/services/src/lib/data.service.ts` defines the contract
- Two environment-specific implementations:
    - `ElectronService` (`apps/web/src/app/services/electron.service.ts`) - Uses IPC to communicate with Electron backend
    - `PwaService` (`apps/web/src/app/services/pwa.service.ts`) - Uses HTTP API and IndexedDB for standalone web version
- Factory function `DataFactory()` in `apps/web/src/app/app.config.ts` determines which implementation to inject:
    ```typescript
    if (window.electron) {
        return new ElectronService();
    }
    return new PwaService();
    ```

**Data Storage (Environment-Specific)**:

- **Electron**: libSQL/SQLite database via Drizzle ORM
    - Location: `~/.iptvnator/databases/iptvnator.db`
    - Full-featured relational database with foreign keys and indexes
    - Supports local file or remote Turso instance via env vars
- **PWA (Web)**: IndexedDB via `ngx-indexed-db`
    - Browser-based NoSQL storage
    - Same schema structure but implemented in IndexedDB
    - Limited by browser storage quotas

### Backend Architecture (Electron)

**Main Entry**: `apps/electron-backend/src/main.ts`

- Bootstraps Electron app and initializes database
- Registers event handlers for IPC communication

**Database**:

- **ORM**: Drizzle ORM with libSQL (local SQLite file or remote Turso)
- **Location**: `~/.iptvnator/databases/iptvnator.db` (avoids spaces in path)
- **Schema** (`apps/electron-backend/src/app/database/schema.ts`):
    - `playlists` - Playlist metadata (M3U, Xtream, Stalker)
    - `categories` - Content categories (live, movies, series)
    - `content` - Streams/VOD/series items
    - `favorites` - User favorites
    - `recentlyViewed` - Watch history
- **Connection**: `apps/electron-backend/src/app/database/connection.ts`
    - Auto-creates tables on init
    - Supports local file or remote via env vars (`LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`)

**IPC Communication**:

- **Preload script**: `apps/electron-backend/src/app/api/main.preload.ts`
    - Exposes `window.electron` API via `contextBridge`
    - All IPC channels defined here (playlist operations, EPG, database CRUD, external players, etc.)
- **Event handlers**: `apps/electron-backend/src/app/events/`
    - `database.events.ts` - Database CRUD operations
    - `playlist.events.ts` - Playlist import/update
    - `epg.events.ts` - EPG fetch and parsing (uses worker)
    - `xtream.events.ts` - Xtream Codes API
    - `stalker.events.ts` - Stalker portal API
    - `player.events.ts` - External player (MPV, VLC) integration
    - `settings.events.ts` - App settings
    - `electron.events.ts` - App version, etc.

**Workers**:

- EPG parsing runs in worker thread: `apps/electron-backend/src/app/workers/epg-parser.worker.ts`

### Key Features

**Playlist Support**:

- M3U/M3U8 files (local or URL)
- Xtream Codes API (`username`, `password`, `serverUrl`)
- Stalker portal (`macAddress`, `url`)

**Video Players**:

- Built-in HTML5 player with HLS.js or Video.js
- External players: MPV, VLC (via IPC to Electron backend)

**EPG (Electronic Program Guide)**:

- XMLTV format support
- Background parsing in worker thread
- Stored in database for quick lookup

**Favorites and Recently Viewed**:

- Per-playlist favorites and global favorites
- Recently viewed tracks watch history

**Internationalization**:

- Uses `@ngx-translate` with 16 language files in `apps/web/src/assets/i18n/`

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
- `app.routes.ts` - Different routes for Xtream portals (Electron uses Tauri-based routes, PWA uses standard routes)
- Storage layer switches automatically:
    - Electron → libSQL/Drizzle ORM → `~/.iptvnator/databases/iptvnator.db`
    - PWA → IndexedDB → Browser storage
- External player support (MPV/VLC) only available in Electron
- File system operations only available in Electron (uploading playlists from disk)

**Base Href Configuration**:
The app uses different base href values depending on the build target:

- **Development & PWA**: `baseHref="/"` (from `index.html`)
    - Used by: `npm run serve:frontend`, `npm run build:frontend:pwa`
    - For web servers with proper routing
- **Electron Production**: `baseHref="./"` (overridden in build config)
    - Used by: `npm run build:backend`, `npm run make:app`
    - Required for `file://` protocol in Electron

Build configurations in `apps/web/project.json`:

- `production`: Electron build with `baseHref="./"`
- `pwa`: Web deployment with `baseHref="/"`
- `development`: Dev mode with `baseHref="/"` from index.html

**Factory Pattern Implementation**:
The factory pattern ensures a single codebase works in both environments without conditional checks scattered throughout the application. All environment-specific logic is encapsulated in the service implementations.

### Testing Strategy

- **Unit tests**: Jest with `jest-preset-angular` and `ng-mocks`
- **E2E tests**: Playwright testing the web app
- Backend tests use standard Jest

### Nx Commands

Use `nx` CLI for better performance:

```bash
nx run <project>:<target>
# Example: nx run web:build
# Example: nx run electron-backend:serve
```

To run multiple projects:

```bash
nx run-many --target=test --all
```

### Electron Build Process

The Electron backend depends on the web app being built first:

- `electron-backend:build` depends on `web:build`
- Output goes to `dist/apps/electron-backend` (backend) and `dist/apps/web` (frontend)
- Packaging combines both into distributable

### Database Migrations

No formal migration system yet. Schema changes are applied via raw SQL in `connection.ts` `createTables()` function using `CREATE TABLE IF NOT EXISTS`.

### Common Patterns

**IPC Communication**:

1. Define handler in appropriate events file (e.g., `database.events.ts`)
2. Register with `ipcMain.handle()` in the event bootstrap function
3. Expose in preload script via `contextBridge.exposeInMainWorld()`
4. Call from Angular via `window.electron.<methodName>()`

**Adding New Playlist Source**:

1. Add type to `libs/shared/interfaces/src/lib/playlist.interface.ts`
2. Create event handler in `apps/electron-backend/src/app/events/`
3. Add UI in `apps/web/src/app/home/`
4. Update database schema if needed

**State Management**:

- Use NgRx for global application state (playlists)
- Use component stores (`@ngrx/component-store`) for feature-specific state
- Use NgRx signals for reactive data streams

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->
