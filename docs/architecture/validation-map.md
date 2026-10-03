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
| Jest spec programs                 | `pnpm run typecheck:spec`           |
| Full unit suite (all projects)     | `pnpm run test:unit:ci`             |
| EPG data access                    | `pnpm nx test epg-data-access`      |
| Workspace shell utilities          | `pnpm nx test workspace-shell-util` |
| Shared SQLite schema/connection    | `pnpm nx test database`             |
| Packaging metadata                 | `pnpm nx test packaging`            |

`typecheck:spec` (`tools/typecheck/spec-typecheck.mjs`) runs `tsc --noEmit`
over every `tsconfig.spec.json` under `apps/`, `libs/` and `tools/`, a few
programs at a time (`--concurrency=N` or `SPEC_TYPECHECK_CONCURRENCY`; a
positional argument filters by path), and fails on any diagnostic. ts-jest
transpiles with `isolatedModules`, so this is the only check that catches a
spec whose types drifted from the code it exercises. CI runs it in the
`unit-and-typecheck` job after `typecheck:ci`. Conventions the gate relies on:

- Spec tsconfigs use `module: preserve` with `moduleResolution: bundler`, the
  same as the library's own `tsconfig.json`; ts-jest forces CommonJS emit
  outside ESM mode, so the setting only affects type-checking, and `node10`
  resolution cannot see Angular's `exports`-only secondary entry points.
- Each spec program lists `global.d.ts` in `files` so `window.electron` and the
  other ambient declarations resolve.
- Libraries tested through `tools/testing/run-web-esm-lib-tests.mjs` are
  type-checked by `apps/web/tsconfig.spec.json`, the config
  `jest.web-esm.workspace.ts` hands to ts-jest; add a new ESM-tested library's
  spec globs there. `apps/web/src/jest-esm.d.ts` types `jest.unstable_mockModule`.
- Type test doubles instead of casting to `any`: `jest.Mocked<T>`,
  `InstanceType<typeof SomeStore>` for signal stores, and
  `Object.defineProperty` or a writable mapped type for read-only capability
  flags.

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
It runs projects a few at a time, largest first, with a bounded Jest worker
count per project (defaults: `min(3, cores - 1)` in flight and
`ceil(cores / concurrency)` workers each; override with `--concurrency=N`,
`--max-workers=N` or `TIER_A_CONCURRENCY` / `TIER_A_MAX_WORKERS`). Two cores
run one project at a time with two workers. Two in flight would leave each
project one worker, which runs Jest in-band, and a big project's single heap
can run out on a small machine; for the same reason avoid `--max-workers=1`. Each
project's output is printed as one block when it finishes, and the run ends
with the wall-clock total and the longest projects. Spec `tsconfig`s set
`isolatedModules: true`, so ts-jest transpiles files one at a time instead of
type-checking each through a language service (the web configs already ran
with `diagnostics: false`); `isolatedModules`-incompatible syntax such as a
type re-export without `export type` still fails at load time, and spec type
errors are caught by `typecheck:spec` (see Unit And Type Checks).

Some `electron-backend` and `database` specs run SQLite code in the Electron
binary under `ELECTRON_RUN_AS_NODE`, resolving it with `require('electron')`.
pnpm does not run Electron's postinstall (`electron` is deliberately absent from
`onlyBuiltDependencies`, see [workspace shell](workspace-shell.md)), so the
first `require` downloads and extracts the binary. With projects and Jest
workers in parallel, one process can exec it while another is still extracting
it (`spawnSync … ETXTBSY` on Linux). When a selected project has a spec that
calls `createRequire(...)('electron')`, `coverage:unit:ci` first runs
`tools/testing/ensure-electron-binary.mjs`, which downloads the binary once and
fails unless it runs and reports the pinned version; CI also runs it as its own
step when the Tier A suite is in scope. In a fresh worktree, run it before
starting several of these specs at once by other means.

In CI, a pull request skips the Tier A suite (and the merged-coverage upload)
when every changed file is outside Tier A test inputs:
`tools/coverage/unit-coverage-scope.mjs` holds the allowlist (Markdown, `docs/`,
notes and plans, agent guidance, workflows other than `ci.yml` and
`build-and-make.yaml`, the website, E2E and mock-server apps,
release/packaging/skills/performance tooling, and a `package.json` edit
confined to non-`coverage:*` scripts). Anything else, including files no Nx
project owns such as `jest.preset.js` or `tsconfig.base.json`, and every
`{workspaceRoot}` input a Tier A test target declares, runs the full suite;
master pushes always run it. `nx affected` is deliberately not used for this
decision because a change to an unowned file affects no project. A node test
parses every Tier A source for string literals that point at repository files
outside the owning project (`tier-a-external-references.mjs`) and fails if the
allowlist would skip any of them, so a new cross-project read cannot be
silently exempted.
Jest's transform cache is kept in `JEST_CACHE_DIRECTORY` and persisted with
`actions/cache`: pull requests restore it, while only master pushes (starting
from an empty cache, so it holds exactly the current tree) and maintainer
dispatches save it. A shared Nx task cache is not used: Nx indexes its local
cache in a machine-specific database, so a restored cache folder is never hit,
and sharing it safely needs Nx Cloud or another supported remote cache.
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

After changing a Playwright config's `webServer` list, `nx.json` target
defaults or an E2E project's `dependsOn`, run
`pnpm run e2e:task-graphs:validate`. It builds every Playwright target's task
graph with and without `CI` and fails on the graphs Nx refuses to run; CI runs
it in the `unit-and-typecheck` job. See
[Xtream mock Playwright integration](xtream-mock-server.md#playwright-integration).

Inside `expect.poll`, read a changing list in one DOM snapshot
(`allTextContents()` or `evaluateAll()`, as in
`apps/electron-backend-e2e/src/sidebar-categories.e2e-support.ts`), not by
looping over `count()` with per-row `nth(index)` reads. Those reads auto-wait,
so a row removed mid-loop hangs the predicate until the poll times out instead
of letting it retry.

Playwright coverage is measured semantically by tags and critical journeys, not
by a source-line percentage. E2E reports should use tags such as `@critical`,
`@electron`, `@web`, `@xtream`, `@stalker`, `@m3u`, `@search`, `@epg`,
`@persistence`, `@settings`, `@pwa`, and `@self-hosted`.

After an E2E run, generate the semantic summary with:

```bash
pnpm run coverage:e2e:summary
```

CI runs the Electron suite as Playwright shards (`--shard=<n>/<total>`, split
by spec file because the suite is sequential): three shards on Ubuntu and
Windows, two on macOS, whose runners are the scarcest and queued longest. Each
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
pnpm run i18n:validate          # checker unit tests, then the check (CI)
pnpm run i18n:check             # the check only
pnpm run i18n:baseline:update   # deliberate: rewrite the English-identical baseline
```

The i18n check is non-mutating. It compares every locale file in
`apps/web/src/assets/i18n/` against `en.json` and fails on missing or extra keys.
It also fails on a locale value that is identical to English unless
`tools/i18n/identical-en-baseline.json` records that exact English text for the
same locale and key. The baseline holds values that are legitimately the same
in a language (brand and technical names, language autonyms, loanwords such as
"PIN") and the untranslated debt that existed when the guard was added, so new
keys must ship translated. An entry stops covering its key once the English
text changes, so copying reworded English into a locale fails as well.

Baseline entries that are no longer English-identical (translated, removed, or
reworded) are reported but do not fail. `pnpm run i18n:baseline:update`
rewrites the baseline from the current locale files, dropping those entries
and printing every added one; it writes nothing while any locale is unreadable
or has missing or extra keys. Run it only after translating, or for a value
that is legitimately identical in that language; review the diff, and never
run it in CI. A new locale starts with no baseline entries, so it has to
record its legitimate identical values the same way.
`node tools/i18n/check-drift.mjs --fail-on-identical` ignores the baseline for
a full translation audit. CI runs `pnpm run i18n:validate` in the unit test
job.

## Performance

```bash
pnpm nx build web
pnpm run perf:initial-bytes         # breakdown only
pnpm run perf:initial-bytes:check   # measure, then compare with the committed baseline
pnpm nx test performance-tools
pnpm run perf:journeys              # J1 launch + J2 open-source journeys, one dist/performance/journeys/<timestamp>/summary.json
```

`perf:initial-bytes` reads the built `dist/apps/web/index.html` and sums the
bytes on the initial path (the J1 counter `renderer.initialBytes`).
`perf:initial-bytes:check` then fails if the value exceeds
`tools/performance/journey-baselines.json`; baselines only move down. CI runs
the same check in the `Initial bytes ratchet` job of `ci.yml` for PRs that
target `master` and for `master` pushes (dispatch it with
`gh workflow run ci.yml --ref <branch>` for a stacked branch). The weekly
`performance-ratchet.yml` workflow lowers baselines through a bot PR; validate
a change to it with `gh workflow run performance-ratchet.yml --ref <branch>`,
which measures but opens no PR off `master`. Dispatch needs the workflow file
on `master`; before that, see the temporary-trigger note under Weekly
tightening in the performance journeys document. `perf:journeys` builds the `electron-performance` configuration and runs every
journey spec against the Xtream mock: J1 launch, then J2 open-source (a
second set of launches, each followed by the click on the portal card), both
written to the same summary file; its probe specs run with
`pnpm nx run electron-backend-e2e:test-performance-harness`, which CI runs in
the `Unit Tests and Typechecks` job of `ci.yml` on every run. The
`electron-backend-e2e` command targets call `tsx` and `playwright` directly,
not through `pnpm exec`: under `pnpm nx`, a nested `pnpm exec` can run from the
workspace root instead of the target `cwd` and miss cwd-relative specs, globs
and configs. The contract, what
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
