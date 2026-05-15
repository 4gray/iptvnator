---
name: iptvnator-nx-architecture
description: Repository-specific Nx monorepo structure, library placement rules, scoped path aliases, and migration guardrails for portal/workspace/app code.
---

# IPTVnator Nx Architecture

Use this skill when deciding where code belongs, extracting libraries, changing imports, editing project tags, or refactoring portal/workspace/app boundaries.

## Project Shape

- `apps/web`: Angular renderer application.
- `apps/electron-backend`: Electron main process and native/runtime integration.
- `apps/*-e2e`: Playwright E2E projects.
- `apps/*-mock-server`: local development and E2E mock servers.
- `libs/playlist/*`: M3U/import/shared playlist functionality.
- `libs/portal/*`: Xtream, Stalker, and provider-neutral portal functionality.
- `libs/workspace/*`: workspace shell and dashboard.
- `libs/ui/*`: provider-neutral UI, playback, EPG, remote control, and pipes.
- `libs/shared/*`: contracts, database, and pure utility code.

## Import Policy

- Use scoped aliases from `tsconfig.base.json`, for example `@iptvnator/services` and `@iptvnator/shared/interfaces`.
- Do not reintroduce legacy bare aliases such as `services`, `components`, or `shared-interfaces`.
- Prefer library public APIs (`src/index.ts`) over deep imports unless a sub-entrypoint is explicitly configured.
- Keep app-only code in `apps/*`; shared behavior belongs in a domain library.

## Tag Policy

- Every project should have `scope:*`, `domain:*`, and `type:*` tags.
- Use `type:feature` for route/component orchestration, `type:data-access` for stores/API/persistence, `type:ui` for reusable components, and `type:util` for pure helpers/contracts.
- Keep `type:data-access` from depending on `type:feature` or `type:ui`.
- Add or update `@nx/enforce-module-boundaries` constraints when introducing new tag families.

## Validation

```bash
pnpm nx show projects
pnpm nx lint <project>
pnpm nx test <project>
```

When dependencies are not installed in a fresh worktree, run `pnpm install --frozen-lockfile` first.
