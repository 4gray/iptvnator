---
name: stalker-portal
description: Use when changing Stalker or Ministra routes, stores, catalog or series shapes, playback progress, favorites and recent items, EPG, or remote control.
---

# Stalker Portal

## Read First

- `docs/architecture/stalker-portal.md`
- `docs/architecture/stalker-epg.md` for ITV EPG
- `docs/architecture/remote-control.md` for live remote control

## Ownership

- Routed UI: `libs/portal/stalker/feature/src/lib/`
- API, session, store, and normalization:
  `libs/portal/stalker/data-access/src/lib/`
- Electron transport: `apps/electron-backend/src/app/events/stalker.events.ts`
- Provider-neutral collections: `libs/portal/shared/data-access/src/lib/`

Keep Stalker request and shape rules in Stalker data access. Shared portal UI
must remain provider-neutral.

## Series Contract

Inside Stalker portal code, `isStalkerSeriesFlag()` is the sole flag
interpretation and accepts exactly `true`, `1`, and `'1'`. The activity
normalizer in shared interfaces remains dependency-neutral and preserves the
same closed set for favorites/recent and dashboard classification. Preserve
all three modes: regular `/series`, VOD with embedded `series[]`, and lazy
Ministra VOD `is_series`.

Favorites/recent preserve the raw flag and VOD origin so reopening still uses
the correct lazy or embedded mode. Keep quick-start translation parameters and
the naturally ordered season fallback when `season_number` is absent.

Lazy episodes use a deterministic tracking ID scoped by parent series,
provider episode, season key, and episode number. `legacyTrackingId` is only a
guarded compatibility alias. Reconciliation is limited to the current parent
series and optional matching season/episode metadata; an exact scoped row
always wins the resolved display position, while a compatible legacy row may
remain tracked only for cleanup. The scoped ID is the in-memory key. At the
strict migration boundary, save the scoped row before clearing a confirmed
legacy row, and keep legacy progress when the save fails.

Before inline or external handoff, attach parent `seriesXtreamId` and resolved
season/episode numbers. Keep them on subsequent position writes.

## Live Contract

- Start bulk ITV EPG eagerly once channel rows exist. Rows read the bulk cache;
  only the active channel may fall back to `get_short_epg`.
- Radio skips EPG and external players, preserves live collection identity
  with `radio: 'true'`, and uses the shared inline audio player.

## Validation

Run:

- `pnpm nx test shared-interfaces`
- `pnpm nx test portal-stalker-data-access`
- `pnpm nx test portal-stalker-feature`
- the affected `portal-shared-data-access` / `portal-shared-ui` target for
  collection or radio behavior
- the affected `workspace-dashboard-data-access` and
  `workspace-dashboard-feature` test targets

For the user workflow, run
`pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts` or document the missing
fixture and strongest focused coverage.
