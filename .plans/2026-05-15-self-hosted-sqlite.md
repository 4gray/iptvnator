# Self-Hosted SQLite Storage Follow-Up

## Status

Deferred. This plan captures the intended direction only; do not start implementation as part of the current PWA self-hosted Docker work.

## Context

The current self-hosted PWA runtime ships one Docker image with nginx, the Angular PWA, and `web-backend`. Xtream in PWA mode remains API-first: catalog categories and content are cached in memory only, while playlist metadata, favorites, recent items, and playback positions use browser storage. Electron has a DB-first SQLite flow for Xtream content, user activity, search, and refresh behavior.

Adding backend-owned SQLite for self-hosted can reduce the architectural gap between Electron and PWA, but it should be introduced deliberately rather than as ad-hoc endpoints.

## Proposed Direction

1. Add a persistent SQLite database owned by `web-backend`.
2. Store the database under a Docker volume, for example `/data/iptvnator.db`.
3. Expose backend HTTP APIs that mirror the Electron database contract closely enough for frontend data sources to share behavior.
4. Add a self-hosted Xtream data source that uses the backend storage API instead of PWA-only localStorage/in-memory catalog behavior.
5. Reuse shared SQLite schema and operation code where practical so Electron and self-hosted do not drift.
6. Keep Stalker catalog API-first initially; move only Stalker metadata, favorites, recent items, and playback positions into backend storage unless a concrete catalog-cache need appears.

## Expected Benefits

- Xtream catalog survives browser reloads and browser storage clearing.
- Self-hosted instances can provide the same DB-backed favorites, recent items, dashboard, search, and refresh semantics as Electron.
- The frontend needs fewer PWA-specific fallbacks.
- Docker self-hosted state becomes easier to back up and restore through one mounted data directory.
- Web/PWA E2E can validate persisted backend state without depending on browser localStorage snapshots.

## Risks And Decisions

- The backend database must be mounted as a volume; storing it only inside the container would lose data on container replacement.
- Self-hosted is currently effectively single-user. A backend SQLite database would be shared by everyone with access to the instance unless authentication/multi-profile storage is added.
- Cache freshness needs an explicit policy: manual refresh, TTL, or Electron-style import status.
- The API should be designed as a storage contract, not a set of route-specific helpers, otherwise the codebase gains a third persistence model.
- Migrations, backup/restore docs, and Docker upgrade behavior need to be part of the implementation.

## Suggested Implementation Phases

1. Introduce backend SQLite volume, schema initialization, migrations, and health/debug visibility.
2. Add HTTP storage endpoints for playlists, Xtream categories/content, favorites, recent items, playback positions, and import status.
3. Extract or share Electron SQLite operations where boundaries allow it.
4. Implement `SelfHostedXtreamDataSource` and select it when runtime config points at the monorepo backend.
5. Add Docker/self-hosted E2E coverage for persisted Xtream catalog, favorites, recently viewed, dashboard, and reload behavior.
6. Evaluate Stalker storage after Xtream parity is stable.

## Validation Expectations

- Unit tests for backend SQLite operations and frontend data-source selection.
- Web/PWA E2E against self-hosted backend for Xtream add portal, catalog import/cache, favorite, recent item, reload persistence, dashboard, and global collection pages.
- Docker compose smoke with a named volume and a recreate cycle proving data persistence.
- Documentation updates in `docker/README.md`, `README.md`, `docs/architecture/pwa-self-hosted.md`, and `AGENTS.md`.
