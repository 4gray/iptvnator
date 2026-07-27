---
name: stalker-portal
description: Repository guidance for Stalker/Ministra sessions, catalogs, VOD/series shapes, playback metadata, collections, EPG, and remote control.
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
- Pure session protocol: `libs/portal/stalker/protocol/src/lib/`
- Typed full-session IPC:
  `apps/electron-backend/src/app/events/stalker-session.events.ts`
- Main-owned session runtime:
  `apps/electron-backend/src/app/services/stalker-session/`
- Legacy simple/PWA-compatible requests:
  `apps/electron-backend/src/app/events/stalker.events.ts`
- Shared Stalker item normalization:
  `libs/shared/interfaces/src/lib/stalker-item.normalizer.ts`
- Dashboard aggregation: `libs/workspace/dashboard/data-access/src/lib/`

Keep provider-specific API and normalization behavior in Stalker data access.
Keep shared portal layouts/utilities provider-neutral. Preserve full-portal
session auth and simple IPC request paths.

## Session Compatibility Invariants

1. Electron full portals cross preload only through typed open, continue,
   request, and control operations. The renderer retains opaque lease,
   challenge, attempt, and playback-context references only.
2. Credentials, Bearer tokens, handshake randoms, cookies, internal session
   keys, and playback headers stay out of preload/renderer state, persisted
   playlist metadata, and diagnostics. Electron main owns them and supplies
   authorized HTTP/native-player requests directly.
3. Discovery is anonymous before origin approval. Unknown/malformed response
   shapes fail closed; only a narrowly recognized benign HTML endpoint-shape
   miss or an explicit unsupported status may advance, and only explicit
   unsupported auth can contribute stateless evidence. Explicit private portal
   sources are allowed. Anonymous public-to-private redirects must be rejected
   before contact; identity-bearing cross-origin redirects must pause before
   target preparation/contact and require approval.
4. First profile uses `auth_second_step=0`. Submit exact credentials only after
   status `2`; a second profile with step `1` follows canonical `do_auth`
   success. The three-submission budget belongs to the connection attempt, not
   a replaceable auth object. Do not invent serial/device/hash values.
5. Provisional flows persist the verified playlist atomically before commit.
   Cancel, navigation, stale async outcomes, deletion, and failed promotion
   must discard/clean the corresponding main-owned state.
6. Embedded MPV and external MPV/VLC consume `create_link` authorization
   through a sender-bound main-owned playback context. Built-in web players
   may carry but do not consume the opaque reference, and authenticated
   downloads are not yet a context consumer. Do not expose headers or cookies
   to make an unsupported surface work.
7. A request recipe with the current classifier version is authoritative over
   legacy `isFullStalkerPortal`. Missing/stale recipes classify provisionally;
   a current stateless recipe may perform one single-flight endpoint-shape
   re-detection, persist/commit the new recipe, and reissue the operation once.
8. Backup import never trusts learned Stalker connection state. Every restore,
   including a matched redacted or secret-bearing merge, clears the landing,
   recipe, classifier-version, and last-verification fields before reconnecting.

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
- Pure protocol and Electron session runtime:
  `pnpm nx test portal-stalker-protocol`
  `pnpm nx test electron-backend`
- Import and connection lifecycle:
  `pnpm nx test playlist-import-feature`
  `pnpm nx test portal-stalker-feature`
- Stateful replay validation:
  `pnpm run stalker:fixtures:validate`
  `pnpm nx test stalker-fixture-tools`
- Dashboard classification and position lookup:
  `pnpm nx test workspace-dashboard-data-access`
- Dashboard badge rendering when changed:
  `pnpm nx test workspace-dashboard-feature`

For user-visible workflow changes, run the closest available E2E target. If no
fixture covers the affected portal shape, record that gap and perform the
strongest targeted unit/build validation available.
