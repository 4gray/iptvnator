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

## CI Enforcement

The CI lint job runs affected projects on pull requests and all projects on
master pushes. Root config or lockfile changes affect every project, so module
boundaries, legacy-alias restrictions, and max-lines enforcement apply across
the workspace.
