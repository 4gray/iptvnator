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

## Coverage Tiers

Use `tools/coverage/coverage-policy.json` as the source of truth for coverage
ownership.

| Tier | Rule | Validation |
| --- | --- | --- |
| A | Product/runtime Angular, Electron, backend, data-access, portal, playlist, workspace, playback, EPG, and shared UI code collects source coverage. | `pnpm run coverage:ci` |
| B | Validate behavior without percentage coverage, such as `website`, `packaging`, and Playwright E2E projects. | `pnpm nx test website`, `pnpm nx test packaging`, or the closest E2E target |
| C | Excluded from the source coverage baseline, such as mock servers, test helper libraries, and untested feature shells. | Validate through dependent flows, or add focused tests when changing behavior directly |

`apps/website` is an Astro marketing site. Its useful signal is a successful
static build plus targeted output checks, not a merged code coverage percentage.
Projects with a test target but no specs, such as `remote-control-web` and
`remote-control` today, should not be in Tier A until focused specs exist.

For local coverage inspection:

```bash
pnpm run coverage:unit:ci
pnpm run coverage:merge
pnpm run coverage:health
```

The merged report is written to `coverage/merged/` as HTML, LCOV, Cobertura,
and JSON summary output. CI uploads the merged Tier A report to Codecov with the
`unit` flag and keeps the HTML report as a GitHub artifact.

## E2E

| Area                  | Command                                         |
| --------------------- | ----------------------------------------------- |
| Web app browser flows | `pnpm nx run web-e2e:e2e -- --project=chromium` |
| Electron flows        | `pnpm nx run electron-backend-e2e:e2e`          |

Use atomized E2E targets when available, for example
`pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts`.

Playwright coverage is measured semantically by tags and critical journeys, not
by a source-line percentage. E2E reports should use tags such as `@critical`,
`@electron`, `@web`, `@xtream`, `@stalker`, `@m3u`, `@search`, `@epg`,
`@persistence`, `@settings`, `@pwa`, and `@self-hosted`.

After an E2E run, generate the semantic summary with:

```bash
pnpm run coverage:e2e:summary
```

For local investigation only, Chromium browser V8 coverage can be explored with:

```bash
pnpm run coverage:e2e:v8:web
```

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
