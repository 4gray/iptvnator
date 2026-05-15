# Validation Map

This map records the lowest-cost validation commands agents should reach for
before broad CI-sized runs.

## Discovery

```bash
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget lint
pnpm nx show projects --withTarget e2e
```

## Unit And Type Checks

| Area                               | Command                             |
| ---------------------------------- | ----------------------------------- |
| Angular renderer entry points      | `pnpm run typecheck:web`            |
| Electron main process entry points | `pnpm run typecheck:backend`        |
| Curated CI unit suite              | `pnpm run test:unit:ci`             |
| EPG data access                    | `pnpm nx test epg-data-access`      |
| Workspace shell utilities          | `pnpm nx test workspace-shell-util` |
| Shared SQLite schema/connection    | `pnpm nx test database`             |
| Packaging metadata                 | `pnpm nx test packaging`            |

## E2E

| Area                  | Command                                         |
| --------------------- | ----------------------------------------------- |
| Web app browser flows | `pnpm nx run web-e2e:e2e -- --project=chromium` |
| Electron flows        | `pnpm nx run electron-backend-e2e:e2e`          |

Use atomized E2E targets when available, for example
`pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts`.

## I18n

```bash
pnpm run i18n:check
```

The i18n check is non-mutating. It compares every locale file in
`apps/web/src/assets/i18n/` against `en.json` and fails on missing or extra keys.
Identical English fallback values are reported as warnings by default; use
`node tools/i18n/check-drift.mjs --fail-on-identical` for a stricter translation
audit.

## Logging

Runtime playback and EPG debug logs should use the existing logger or trace
helpers instead of unconditional `console.log`. Electron external-player traces
are gated by:

```bash
IPTVNATOR_TRACE_PLAYER=1 pnpm run serve:backend
```
