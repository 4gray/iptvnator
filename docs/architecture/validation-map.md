# Validation Map

This map records the lowest-cost validation commands agents should reach for
before broad CI-sized runs.

## Discovery

```bash
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget lint
pnpm nx show projects --withTarget e2e
```

## Manual CI Runs

When a PR event does not start checks for the current head, dispatch CI and E2E
with `gh workflow run ci.yml --ref <branch>` and
`gh workflow run e2e-tests.yaml --ref <branch>`. CodeQL also supports
`gh workflow run codeql-analysis.yml --ref <branch>`; this analyzes the selected
branch commit instead of the PR merge commit. Verify each run's head SHA before
using its result as evidence. Docker validation can use
`gh workflow run docker.yml --ref <branch> -f push=false`.

## Unit And Type Checks

| Area                               | Command                             |
| ---------------------------------- | ----------------------------------- |
| Angular renderer entry points      | `pnpm run typecheck:web`            |
| Electron main process entry points | `pnpm run typecheck:backend`        |
| Full unit suite (all projects)     | `pnpm run test:unit:ci`             |
| EPG data access                    | `pnpm nx test epg-data-access`      |
| Workspace shell utilities          | `pnpm nx test workspace-shell-util` |
| Shared SQLite schema/connection    | `pnpm nx test database`             |
| Packaging metadata                 | `pnpm nx test packaging`            |

## Lint

```bash
pnpm run lint                 # nx run-many --target=lint --all
pnpm nx lint <project>        # single project
```

The CI workflow (`.github/workflows/ci.yml`) lints affected projects on PRs
(`nx affected`) and every project on master pushes.
This enforces `@nx/enforce-module-boundaries` (scope/domain/type tag
constraints), the legacy bare-alias ban, and the `max-lines` file-size rule
(hard maximum 400 lines for production TypeScript, 1200 for tests; blank lines
and comments are not counted). The limits live in
`tools/eslint/max-lines-config.mjs`, which both `eslint.config.mjs` and the
generator import. Files that predate the `max-lines` rule are baselined in
`tools/eslint/max-lines-baseline.mjs`; after splitting a baselined file below
the limit, regenerate the list with
`node tools/eslint/generate-max-lines-baseline.mjs`. Never add new files to
the baseline.

## Coverage Tiers

Use `tools/coverage/coverage-policy.json` as the source of truth for coverage
ownership. Every project with a `test` target must be classified in a tier;
`pnpm run coverage:policy:check` (part of `coverage:ci`) fails CI when a new
project is missing from the policy, a listed project no longer exists, or a
Tier A entry has no test target. CI runs Tier A with coverage (uploaded to
Codecov) and each Tier B/C project's `validationCommand` (falling back to
`nx test`) without coverage; projects with an `e2e` target are skipped there
because the E2E workflow already runs them on every PR that touches app code.
Docs-only changes (Markdown, `docs/`, `.plans/`, `.codex/`, `.claude/`) and
`apps/website/**` changes skip the E2E workflow via `paths-ignore` — for those
PRs no E2E validation runs in CI, which is intentional: they cannot affect app
behavior.

Tier A coverage is fail-closed. `coverage:unit:ci` relays Jest output but exits
nonzero on a `Failed to collect coverage` marker, a missing or invalid project
report, or a runtime-owning production TypeScript file absent from that report.
`coverage:merge` requires every configured Tier A report before replacing the
merged output. Strict health validation also requires the merged Istanbul map
itself to contain usable instrumentation for every runtime-owning Tier A file,
recomputes its summary, and then applies aggregate and selected critical-file
ratchets.

Runtime-owning files are discovered from the TypeScript AST. Specs,
declarations, test setup and stubs, generated and environment files, `index.ts`,
type-only files, and pure re-export shims are excluded. Ratchets live under
`reporting.coverageRatchet` in `tools/coverage/coverage-policy.json`; update
them only from a fresh full `coverage:ci` report when every value stays level
or rises, and never lower one to accept a regression. The only exception is an
explicitly reviewed production source shrink: `minimumCovered` may follow a
lower total statement count when the PR documents the removed executable
statements and fresh coverage proves that the corresponding
`minimumPercent`, every aggregate ratchet, and the remaining behavioral
coverage do not decrease.

| Tier | Rule                                                                                                                                              | Validation                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A    | Product/runtime Angular, Electron, backend, data-access, portal, playlist, workspace, playback, EPG, and shared UI code collects source coverage. | `pnpm run coverage:ci`                                                                 |
| B    | Validate behavior without percentage coverage, such as `website`, `packaging`, and Playwright E2E projects.                                       | `pnpm nx test website`, `pnpm nx test packaging`, or the closest E2E target            |
| C    | Excluded from the source coverage baseline, such as mock servers, test helper libraries, and untested feature shells.                             | Validate through dependent flows, or add focused tests when changing behavior directly |

`apps/website` is an Astro marketing site. Its useful signal is a successful
static build plus targeted output checks, not a merged code coverage percentage.
Projects with a test target but no specs, such as `remote-control-web` and
`remote-control` today, should not be in Tier A until focused specs exist.

For local coverage inspection:

```bash
pnpm run coverage:tools:test
pnpm run coverage:unit:ci
pnpm run coverage:merge
pnpm run coverage:health -- --require-report
```

The merged report is written to `coverage/merged/` as HTML, LCOV, Cobertura,
and JSON summary output. CI uploads the merged Tier A report to Codecov with the
`unit` flag and keeps the HTML report as a GitHub artifact.

## E2E

| Area                  | Command                                         |
| --------------------- | ----------------------------------------------- |
| Web app browser flows | `pnpm nx run web-e2e:e2e -- --project=chromium` |
| Electron flows        | `pnpm nx run electron-backend-e2e:e2e`          |
| VOD multi-source      | `pnpm nx run electron-backend-e2e:e2e-ci--src/vod-multi-source.e2e.ts` |

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

CI runs the Electron suite as three Playwright shards per OS
(`--shard=<n>/3`, split by spec file because the suite is sequential). Each
shard uploads `playwright-report-electron-<os>-<n>`; the follow-up
`Electron E2E summary` job downloads the shards of each OS into their own
directory and runs the summary per OS with `--input=<directory>` and
`--output-dir=coverage/e2e/<os>`. A directory input merges every
`results.json` beneath it and fails when a shard is missing or duplicated, so
the summary never reports a partial run as complete. Tests for that merge live
in `tools/coverage/e2e-shard-reports.test.mjs` (`pnpm run coverage:tools:test`).

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

## Performance

```bash
pnpm nx build web
pnpm run perf:initial-bytes         # breakdown only
pnpm run perf:initial-bytes:check   # measure, then compare with the committed baseline
pnpm nx test performance-tools
pnpm run perf:journeys              # J1 launch benchmark, writes dist/performance/journeys/<timestamp>/summary.json
```

`perf:initial-bytes` reads the built `dist/apps/web/index.html` and sums the
bytes on the initial path (the J1 counter `renderer.initialBytes`).
`perf:initial-bytes:check` then fails if the value exceeds
`tools/performance/journey-baselines.json`; baselines only move down. CI runs
the same check in the `Initial bytes ratchet` job of `ci.yml` for PRs that
target `master` and for `master` pushes (dispatch it with
`gh workflow run ci.yml --ref <branch>` for a stacked branch). `perf:journeys` builds the `electron-performance` configuration and runs the
J1 launch benchmark against the Xtream mock; its probe specs run with
`pnpm nx run electron-backend-e2e:test-performance-harness`. The contract, what
counts and how to add a counter or a journey are in the
[performance journeys](performance-journeys.md) document.

## Logging

Runtime playback and EPG debug logs should use the existing logger or trace
helpers instead of unconditional `console.log`. Electron external-player traces
are gated by:

```bash
IPTVNATOR_TRACE_PLAYER=1 pnpm run serve:backend
```

## Test impact and completion

Before finishing a feature, bug fix, data-flow or UI workflow change, identify
the affected projects and choose unit, integration, E2E, build, lint and manual
checks. Bug fixes normally include regression coverage that fails before the
fix. If automation is impractical, explain why and report the strongest manual
validation. Update fixtures, mocks, routes and E2E flows when behavior changes.
Prefer extending the closest existing suite to introducing a parallel suite.

Run targeted unit checks first, then affected E2E for workflows, routing,
persistence, playback, portals, settings or import flows. Electron IPC, SQLite,
packaged runtime, external players, native files and Electron-only routes require
Electron E2E where available, otherwise CDP/manual verification using the
[debugging guide](../development/electron-debugging.md). Prefer atomized E2E
targets before broad suites. Final reports name tests changed, commands/results,
and skipped validation with reasons. Docs-only changes need Markdown validation,
not app unit/E2E. Tooling validation still requires its own focused tests.

## Agent guidance checks

`pnpm run agents:validate` checks root instruction budgets/imports and guidance
navigation links/anchors. `pnpm run skills:validate` checks skill frontmatter,
length, paths and release mirrors. Both tooling suites run through
`pnpm nx test repository-skills`; syntax checks use
`pnpm nx lint repository-skills`. The CI guidance check runs regardless of the
Nx affected set. Semantic preservation of moved contracts is a review task;
link validation alone cannot prove it.
