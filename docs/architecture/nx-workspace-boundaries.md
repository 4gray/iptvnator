# Nx Workspace Boundaries

This document records the current monorepo boundary conventions for IPTVnator.

## Fresh Worktree Bootstrap

Install dependencies before using Nx discovery or targets:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
```

`pnpm nx show projects` depends on the workspace-local Nx packages under
`node_modules`. In a fresh worktree without dependencies it will fail before it
can inspect project metadata.

## Project Tags

Every Nx project should carry three tag families in `project.json`:

1. `scope:*` - ownership area, for example `scope:portal`, `scope:workspace`,
   `scope:shared`, `scope:electron`, `scope:e2e`, or `scope:dev-tools`.
2. `domain:*` - product/runtime domain, for example `domain:xtream`,
   `domain:stalker`, `domain:m3u`, `domain:playback`, `domain:web`, or
   `domain:shared-runtime`.
3. `type:*` - architectural role, for example `type:app`, `type:e2e`,
   `type:dev-app`, `type:feature`, `type:ui`, `type:data-access`,
   `type:util`, `type:tool`, or `type:website`.

`eslint.config.mjs` uses these tags with `@nx/enforce-module-boundaries`.
When adding a project, choose tags before adding imports so dependency direction
is clear from the start.

## Import Aliases

Use scoped `@iptvnator/*` aliases from `tsconfig.base.json`.

Examples:

```ts
import { SettingsStore } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
```

Do not introduce legacy bare aliases such as:

- `components`
- `m3u-state`
- `m3u-utils`
- `services`
- `shared-interfaces`
- `shared-portals`
- `remote-control`
- `database`
- `database-schema`
- `database-path-utils`
- `workspace-dashboard-feature`
- `workspace-dashboard-data-access`

The lint config blocks these aliases so new code uses the same visible
namespace and ownership convention.

Buildable libraries that have a local `package.json` should use the same public
name as their scoped alias. Nx uses `package.json.name` when it rewrites
buildable dependency paths to `dist/` during `@nx/js:tsc` builds.

## Dependency Direction

- `type:feature` may use `type:feature`, `type:ui`, `type:data-access`, and
  `type:util`.
- `type:ui` may use `type:ui`, `type:data-access`, and `type:util`.
- `type:data-access` may use `type:data-access` and `type:util`.
- `type:util` may use only `type:util`.

If a change needs a dependency in the opposite direction, move the shared
contract into a lower-level library instead of weakening boundaries.
