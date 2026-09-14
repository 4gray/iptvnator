# Nx Workspace Boundaries

This document records the current monorepo placement, tagging, and validation
contract for IPTVnator. Nx discovery is the canonical project inventory; avoid
copying an exhaustive project list into documentation.

## Fresh Worktree Bootstrap and Discovery

Install dependencies before relying on Nx:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
```

`pnpm nx show projects` requires the workspace-local Nx packages in
`node_modules`. Inspect project ownership and available validation targets
before choosing commands:

```bash
pnpm nx show project <name>
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget e2e
```

Do not invent a `test`, `build`, or `e2e` target because a similarly named
project has one. Run affected lint/test/build targets that exist and the closest
available E2E target for the changed behavior.

E2E applications must declare runtime dependencies even when they use HTTP
instead of TypeScript imports. `web-e2e` includes `web-backend` in
`implicitDependencies` so provider-proxy changes invalidate cached self-hosted
PWA tests; starting the backend through a `serve` dependency alone does not
make its source files inputs to the test hash.

## Nx Dependency Updates

Keep `nx` and every official `@nx/*` package on the same exact version. Run
`pnpm run deps:nx:validate` after any manifest or lockfile update; CI runs the
same policy check and rejects both direct specifier drift and multiple resolved
Nx versions.

Dependabot groups routine minor and patch Nx updates when possible. A security
update may still contain only the vulnerable package, so replace an incomplete
Dependabot PR with a coordinated maintainer update instead of editing the bot
branch:

```bash
pnpm nx migrate nx@<target> --skipInstall
pnpm install --no-frozen-lockfile
pnpm nx migrate --run-migrations
pnpm run deps:nx:validate
```

Omit `pnpm nx migrate --run-migrations` when the first command reports that no
migrations exist. Major Nx updates always use this manual workflow and the
resulting PR runs the full CI pipeline.

## Angular 22 Toolchain Compatibility

Angular framework/Material 22.1 and CLI/build 22.1 use Nx 23.2 and TypeScript
6.0. Framework and CLI patch numbers may differ; keep framework packages aligned
in both dependency sections and all official Nx packages on one exact version.
Use `.nvmrc` for development/CI; supported LTS Node ranges are
`^22.22.3 || ^24.15.0`. Docker uses the supported Node 24 line.

The Angular 22 migration explicitly preserves the old default change detection
with `ChangeDetectionStrategy.Eager`. Existing OnPush components and
`provideZoneChangeDetection` remain in their existing modes.
Existing eager components under Angular ESLint carry a line-scoped explanation
for the newly recommended OnPush rule; new components keep that rule enabled.
Adopting OnPush in those components requires a separate behavior review.
TypeScript 6 migration settings preserve compiler defaults and per-project output roots;
`ignoreDeprecations: "6.0"` temporarily supports legacy Node test configs and
`baseUrl`, rather than changing the whole workspace to browser resolution.

Two third-party packages need scoped compatibility bridges in
`pnpm-workspace.yaml`:

- `nx-electron@22.0.0` still declares Nx 22 peers. Its existing package-layout
  patch also changes the removed `@nx/js/src/utils/buildable-libs-utils` import
  to `@nx/js/internal`. A package extension supplies its undeclared runtime
  dependency `webpack-node-externals`. The packaging suite loads every executor
  and checks the single application manifest. Remove these bridges only after
  the upstream package declares and implements the current Nx APIs.
- `ngx-indexed-db@22.0.0` declares Angular `<22`, but its used API remains
  compatible. Its allowance is scoped to the exact Angular version and must be
  revalidated on upgrades. `apps/web-e2e/src/basic.e2e.ts` opens a historical
  `iptvnator` v1 database, retains the `_id` key path, and checks reload
  persistence. The shared interfaces package declares the same library version.
  Remove the allowance when upstream includes the installed Angular version.

Jest uses root Babel 7 while Angular build retains its own Babel 8. The website
uses Astro 7 with the root TypeScript 6; no Astro-specific compiler package
extension is needed. Keep the website build in toolchain validation.
The website's alias uses a relative `./src/*` target without the deprecated
`baseUrl` option.

Electron's webpack build resolves `ts-loader` 9.6.2 through the existing
`nx-electron` version range. Keep at least 9.5.7: earlier versions clear
`rootDir` in transpile-only mode and fail with TypeScript 6 (TS5011/TS6059).

Angular unit-test setup explicitly uses `setupZonelessTestEnv` and separately
imports `zone.js/testing` for existing `fakeAsync` helpers. This preserves the
Angular 21 scheduler used by jest-preset-angular 15: its `setupZoneTestEnv` loaded
Zone but did not provide zone-based change detection on Angular 20+. Preset 17
does provide it, which disables automatic fixture rendering and changes
`whenStable()` behavior. Production applications continue to use their existing
`provideZoneChangeDetection`; browser and Electron E2E validate that runtime.

## Vite Dev-Server Patch

Angular's development builder resolves Vite `8.1.5`. It contains upstream precise
asset/worker URL matchers, but also uses them as raw-code prefilters. Those
prefilters reject valid expressions containing comments before the handlers can
strip the comments and apply the precise matchers.

`patches/vite@8.1.5.patch` adds bounded asset/worker prefilters and uses the asset
prefilter for bundled URL rewriting too. The precise handler matchers remain
unchanged. This preserves the earlier protection against expensive scanning of
large false-positive chunks and retains comment-bearing expressions. Remove the
patch only when the resolved upstream Vite passes the same behavior checks:

```bash
pnpm run deps:vite:test
```

CI runs the same check. It resolves Vite from `@angular/build`, verifies the
patched prefilter/matcher wiring and version pin, stress-tests the false-positive
chunk shape, and preserves ordinary and comment-bearing asset and worker
`new URL(..., import.meta.url)` matches.

## Placement Decision

- `apps/` owns runtime applications, development servers, E2E applications,
  and provider mock servers.
- `libs/` owns reusable code grouped by product domain and architectural role.
- `tools/` owns repository automation such as lint, packaging, release, and
  repository-skill validation. Nx projects there use `scope:tools`.

Inside `libs/`, choose the role before the path:

- `type:feature` owns routes, screens, and feature orchestration.
- `type:ui` owns reusable visual components.
- `type:data-access` owns injectable state, API access, persistence, and
  orchestration.
- `type:util` is the destination for new pure helpers and contracts only.

For example, provider-neutral collection services that coordinate favorites,
recents, EPG, or playback persistence belong in
`libs/portal/shared/data-access`. Pure collection types and transformations stay
in `libs/portal/shared/util`, while reusable collection views stay in
`libs/portal/shared/ui`. Existing injectable or stateful services in a `util`
path are legacy debt, not precedent for new placement.

Playback follows the same split: browser and Angular player integration stays
in `libs/ui/playback`, while DOM-free diagnostic contracts and classifiers live
in `libs/playback/util` and receive browser capability checks as explicit
probes.

`libs/playback/util` is the `playback-util` Nx project and is imported through
`@iptvnator/playback/util`. Its exact tags are `scope:shared`,
`domain:playback`, and `type:util`. It owns the public playback diagnostic,
structured engine-evidence, source/engine-family, target-capability,
content-session-key, and recovery-recommendation contracts and pure helpers.
Its public API is `libs/playback/util/src/index.ts`.

`playback-util` has no Angular, DOM, settings, storage, UI, or Electron IPC
ownership. Browser/player adapters collect public engine events and supply
explicit capability facts; `playback-util` classifies and ranks them without
inspecting runtime globals. As a `type:util` project it may depend only on
other utility projects, including shared interface contracts, while
`ui-playback` and feature hosts may depend on it to render and execute
session-local recovery actions.

## Project Tags

Every Nx project keeps one tag from each family in `project.json`:

1. `scope:*` records ownership, such as `scope:portal`, `scope:workspace`,
   `scope:shared`, `scope:electron`, `scope:e2e`, or `scope:tools`.
2. `domain:*` records the product/runtime domain.
3. `type:*` records the architectural role.

`eslint.config.mjs` enforces these type directions:

| Source tag         | Allowed dependency type tags   |
| ------------------ | ------------------------------ |
| `type:app`         | feature, UI, data-access, util |
| `type:e2e`         | feature, UI, data-access, util |
| `type:dev-app`     | feature, UI, data-access, util |
| `type:website`     | UI, util                       |
| `type:feature`     | feature, UI, data-access, util |
| `type:ui`          | UI, data-access, util          |
| `type:data-access` | data-access, util              |
| `type:util`        | util                           |

Domain constraints in the same rule are additive to type constraints. If an
import violates either family, move the contract or implementation to its
proper owner instead of weakening a constraint.

`workspace-shell-util` is a deliberate path/tag exception:
`libs/workspace/shell/util` is tagged `type:data-access` because it exports
injectable services that depend on `@iptvnator/services`. The web app imports
those services eagerly from `apps/web/src/app/app.routes.ts` without pulling
the lazy workspace shell feature into the initial bundle.

## Import Aliases and Public APIs

Use scoped aliases from `tsconfig.base.json` and expose public imports through a
library's `src/index.ts`. Do not introduce legacy bare aliases such as
`services`, `components`, `shared-interfaces`, or `database`, and avoid deep
imports unless a sub-entrypoint is explicitly configured.

For a buildable library that has a local `package.json`, its `name` must match
the scoped alias. Nx uses that package name when rewriting buildable dependency
paths to `dist/` during `@nx/js:tsc` builds.

## Shared Stylesheets and Cache Inputs

Nx derives the project graph from TypeScript imports. A relative Sass `@use`
that crosses a project root creates **no** graph edge, so without an explicit
declaration the imported partial belongs to no task's input set. The build then
reports a cache hit for a stylesheet edit and serves the previous CSS — a
silent wrong build rather than a failure.

Two rules keep that from happening:

1. A directory whose files are consumed by another project is itself an Nx
   project. Shared partials live in `libs/ui/styles`, project `ui-styles`,
   tagged `scope:shared`, `domain:shared-ui`, `type:ui`. It declares no targets;
   it exists so its files are hashed.
2. Every consumer declares the dependency Nx cannot infer:

    ```json
    "implicitDependencies": ["ui-styles"]
    ```

`@nx/enforce-module-boundaries` does not read stylesheets, so tag directions are
not enforced here — keep consumers at `type:feature` or `type:ui`, both of which
may depend on `type:ui`.

Importing a partial that the consuming **application** owns is a different case
and needs no declaration, because that partial already sits inside the app's own
build inputs. It is still the wrong direction, and it is the one case the two
rules above cannot repair: a lib → app edge would make the graph cyclic, since
the app already depends on those libraries. Move the partial into `ui-styles`
instead. No library stylesheet imports from `apps/` today — keep it that way.

`pnpm run styles:inputs:validate` enforces both rules. It resolves every
relative `@use`/`@forward`/`@import` in the workspace against Nx's own project
graph and fails when an imported stylesheet sits outside the input closure of a
build that compiles it, naming the project to declare. Comment-only example
paths are ignored, so the documentation blocks inside the shared partials do not
register as broken imports. CI runs it in the `unit-and-typecheck` job.

Only a module Sass actually compiles counts as an input. `@import` is the one
rule that takes a comma-separated list, and **every** target in it is a separate
dependency — reading just the first would let a later cross-project target
escape the cache key while the check still passed. A quoted string after the
module in `@use`/`@forward` belongs to a `with (...)` configuration and is a
value, and `url(...)` stays a plain CSS import the browser resolves at runtime;
neither is a build input, and treating either as one would report a phantom
broken import.

Verify a suspected caching gap directly — add a comment to a partial, run the
consuming build, and confirm the task runs instead of reporting a cache hit:

```bash
pnpm nx build web --verbose
```

## TypeScript File Size

`tools/eslint/max-lines-config.mjs` is the single source of truth:

- production TypeScript should stay below 300 lines and has a hard maximum of
  400;
- tests, E2E specs, and E2E infrastructure have a maximum of 1200;
- blank lines and comments are not counted.

Pre-existing violations live in
`tools/eslint/max-lines-baseline.mjs`. That baseline may only shrink. After
splitting a baselined file, run
`node tools/eslint/generate-max-lines-baseline.mjs`; never add a new file to the
baseline. A genuinely inseparable new file needs a justified file-wide
directive, which the generator deliberately skips.

## Command-Based Lint Targets

Quote recursive globs so POSIX and Windows hosts lint the same files:

```bash
eslint "apps/<project>/**/*.ts"
find apps/<project> -name '*.ts' | wc -l
```

An unquoted `**` can expand to a shallow subset on POSIX while still returning
success. After editing such a target, compare ESLint's linted-file count with
the `find` count.

Repository tooling in `tools/` has the mirror-image trap: Node's `execSync`
runs through `cmd.exe` on Windows, where single quotes are literal characters
rather than quoting, so a POSIX-quoted pattern reaches the program intact and
matches nothing. Spawn without a shell — `execFileSync('git', ['ls-files',
'*.scss'])` — and let the program expand its own patterns. Both traps report
success while covering nothing, so a check that scans an empty file set must
fail rather than pass.

## CI Enforcement

The CI lint job runs affected projects on pull requests and all projects on
master pushes. Root config or lockfile changes affect every project, so module
boundaries, legacy-alias restrictions, and max-lines enforcement apply across
the workspace.
