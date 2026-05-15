---
name: xtream-electron
description: IPTVnator's Electron-first Xtream implementation, including feature/data-access boundaries, worker-backed DB flows, and Xtream loading/progress UX.
---

# Xtream Electron

Use this skill when working on Xtream routes, stores, data sources, import/search/delete behavior, or Electron-backed Xtream playback and persistence.

## Key Areas

- Feature UI: `libs/portal/xtream/feature/src/lib/`
- Data access: `libs/portal/xtream/data-access/src/lib/`
- Shared portal utilities: `libs/portal/shared/util/src/lib/`
- Shared portal UI: `libs/portal/shared/ui/src/lib/`
- Electron DB events: `apps/electron-backend/src/app/events/database/`
- DB worker operations: `apps/electron-backend/src/app/database/operations/`

## Rules

- Keep provider-specific API/cache behavior in `portal/xtream/data-access`.
- Keep reusable layout and collection UI in `portal/shared/ui` or `portal/shared/util`.
- Prefer worker-backed DB operations for large imports, global search, delete, and restore.
- Preserve request cancellation and progress reporting for long imports.
- Validate both PWA and Electron data-source paths when changing Xtream APIs.

## Validation

- Run `pnpm nx test portal-xtream-data-access` and `pnpm nx test portal-xtream-feature` for store/UI changes.
- Run `pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts` or the closest Electron E2E target for user-visible Xtream workflow changes.
