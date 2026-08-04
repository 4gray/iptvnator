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
- Session, store, and normalization:
  `libs/portal/stalker/data-access/src/lib/`
- Wire-format and identity contracts: `libs/shared/interfaces/src/lib/` —
  portal-mode predicate, MAC/device-ID utils, auth-failure classifier, `cmd`
  encoder, URL/identity builders. There because Electron main cannot import
  renderer libs; never fork them.
- Electron transport: `apps/electron-backend/src/app/events/stalker.events.ts`
- Provider-neutral collections: `libs/portal/shared/data-access/src/lib/`

Keep Stalker shape and store rules in Stalker data access. Shared portal UI
must remain provider-neutral.

## Portal Mode And Session

Full vs. simple mode is decided by observed behavior, not URL shape, and read
only through `isFullStalkerPortalPlaylist()`. Route catalog, content and
playback calls through `executeStalkerRequest()`; the auth, discovery and
account-profile layers below it call `STALKER_REQUEST` directly and wire
repair themselves. Repair is lazy per session, never an eager migration.
Full portals reuse the persisted idempotent handshake token while its session
fingerprint matches, and ping `get_events` at the profile cadence (default
120 s). Auth failures are HTTP 200 plus plain text.

## Series Contract

Inside Stalker portal code, `isStalkerSeriesFlag()` is the canonical predicate
and accepts exactly `true`, `1`, and `'1'`. `normalizeStalkerSeriesFlag()`
delegates to it and produces the normalized positive marker `true` or
`undefined`. The activity normalizer in shared interfaces keeps its
dependency-neutral equivalent for favorites/recent and dashboard
classification. Preserve all three modes: regular `/series`, VOD with embedded
`series[]`, and lazy Ministra VOD `is_series`.

Favorites/recent preserve the normalized positive marker and VOD origin so
reopening still uses the correct lazy or embedded mode. Keep quick-start
translation parameters and the naturally ordered season fallback when
`season_number` is absent.

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
`pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts` or document the strongest
focused coverage available.
