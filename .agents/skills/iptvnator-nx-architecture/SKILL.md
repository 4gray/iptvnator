---
name: iptvnator-nx-architecture
description: Use when deciding where IPTVnator code belongs, creating or moving Nx projects, changing scoped aliases or tags, editing lint targets, or validating module boundaries.
---

# IPTVnator Nx Architecture

## Discover Before Deciding

In a fresh worktree, install first:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
pnpm nx show project <name>
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget e2e
```

Discovery is authoritative. The current app groups are `web`,
`electron-backend`, `web-backend`, `remote-control-web`, `website`, `web-e2e`,
`electron-backend-e2e`, `stalker-mock-server`, and `xtream-mock-server`. Current
tool projects are `eslint-tools`, `packaging`, `release-tools`, and
`repository-skills`.

## Place Code by Ownership

- `apps/`: runtime, development, E2E, and mock-server applications.
- `tools/`: repository automation; tag its projects `scope:tools`.
- `libs/`: domain libraries.
- `type:feature`: route and screen orchestration.
- `type:ui`: reusable visual components.
- `type:data-access`: injectable state, API, persistence, or orchestration.
- `type:util`: the destination for **new pure** helpers and contracts only.

Provider-neutral collection services that coordinate persistence belong in
`libs/portal/shared/data-access`; pure collection helpers belong in
`libs/portal/shared/util`; reusable views belong in
`libs/portal/shared/ui`. Existing injectable/stateful services under a `util`
path are legacy debt, not placement precedent.

## Preserve Boundaries

Every project keeps one `scope:*`, `domain:*`, and `type:*` tag. Enforced type
directions are:

| Source            | Allowed dependencies           |
| ----------------- | ------------------------------ |
| app, E2E, dev-app | feature, UI, data-access, util |
| website           | UI, util                       |
| feature           | feature, UI, data-access, util |
| UI                | UI, data-access, util          |
| data-access       | data-access, util              |
| util              | util                           |

Domain constraints are additive. Never weaken either constraint to solve a
placement problem. Preserve the documented `workspace-shell-util` path/tag
exception: its injectable services require `type:data-access` so app routes can
eagerly import them without loading the lazy shell feature.

Use aliases from `tsconfig.base.json` and public `src/index.ts` barrels. Do not
add legacy bare aliases or deep imports. For a buildable library that has a
local `package.json`, its package name must match its scoped alias.

## Validate the Change

Production TypeScript targets under 300 lines; 400 is the hard limit. Tests are
limited to 1200. The legacy baseline may only shrink. See
`tools/eslint/max-lines-config.mjs` and regenerate after a split with
`tools/eslint/generate-max-lines-baseline.mjs`; never add a new baseline entry.

Quote recursive globs in command-based lint targets, for example
`eslint "apps/<project>/**/*.ts"`, then compare coverage with
`find apps/<project> -name '*.ts' | wc -l`.

Discover targets, then run affected lint/test/build targets and the closest
available E2E target; do not invent targets. Canonical guidance:
`docs/architecture/nx-workspace-boundaries.md`.
