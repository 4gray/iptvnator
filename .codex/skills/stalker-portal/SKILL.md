---
name: stalker-portal
description: Repository guidance for Stalker/Ministra portal catalogs, VOD/series shapes, playback metadata, collections, EPG, and remote control.
---

# Stalker Portal

Use this skill when changing Stalker/Ministra routes, stores, catalog/detail
views, playback, favorites/recent activity, EPG, or remote control.

## Read First

- `docs/architecture/stalker-portal.md`
- `docs/architecture/stalker-epg.md` for ITV EPG work
- `docs/architecture/remote-control.md` for live remote-control work

## Ownership

- Feature UI: `libs/portal/stalker/feature/src/lib/`
- Store/API data access: `libs/portal/stalker/data-access/src/lib/`
- Electron requests: `apps/electron-backend/src/app/events/stalker.events.ts`
- Shared Stalker item normalization:
  `libs/shared/interfaces/src/lib/stalker-item.normalizer.ts`
- Dashboard aggregation: `libs/workspace/dashboard/data-access/src/lib/`

Keep provider-specific API and normalization behavior in Stalker data access.
Keep shared portal layouts/utilities provider-neutral. Preserve full-portal
session auth and simple IPC request paths.

## `is_series` Cross-Surface Checklist

Treat VOD items with `is_series` as series across every downstream surface.
Do not stop after making the detail view render.

1. Accept portal flags `true`, `1`, and `'1'` through the existing normalizers.
   Preserve all three modes: regular `/series`, embedded VOD `series[]`, and
   lazy Ministra VOD `is_series`.
2. Build quick-start state through the shared series utility. Preserve
   `labelKey`, `labelParams`, and `episodeLabel` when adapting it for Stalker;
   translation parameters must reach the template.
3. Preserve `is_series` and the VOD origin in favorites/recent activity.
   `extractStalkerItemType()` must normalize that activity to dashboard type
   `series`.
4. Before either inline or external episode playback, persist the parent
   `seriesXtreamId` plus resolved `seasonNumber` and `episodeNumber`. Keep
   generated episode tracking IDs stable for lazy `is_series` episodes. When
   `season_number` is absent, derive the coordinate from the same naturally
   ordered season list used by quick start; do not default every season to 1.
5. The dashboard reads saved playback positions; it must not infer episode
   numbers from provider payloads. Legacy rows without season/episode metadata
   remain badge-less until that episode is played again.

## Regression Coverage

- Series view/UI and playback handoff:
  `pnpm nx test portal-stalker-feature`
- Stalker shape/store behavior:
  `pnpm nx test portal-stalker-data-access`
- Dashboard classification and position lookup:
  `pnpm nx test workspace-dashboard-data-access`
- Dashboard badge rendering when changed:
  `pnpm nx test workspace-dashboard-feature`

For user-visible workflow changes, run the closest available E2E target. If no
fixture covers the affected portal shape, record that gap and perform the
strongest targeted unit/build validation available.
