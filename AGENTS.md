# Repository guidance

IPTVnator is an Angular/Electron IPTV player with a browser/PWA runtime.
These are the common instructions for all coding agents. Read the relevant
contracts below before changing a subsystem; do not load every document.

## Bootstrap and commands

- Use the Node version in `.nvmrc` and the repository's pnpm version.
- In a fresh worktree, run `pnpm install --frozen-lockfile` before Nx discovery,
  tests, lint or builds. Each worktree needs its own install.
- Repeat the install after checkout changes, pulls, resets or rebases. Compare
  `pnpm-lock.yaml` with `node_modules/.pnpm/lock.yaml`; a difference means stale
  dependencies. Do not diagnose stale modules as application failures.
- Verify discovery with `pnpm nx show projects`. Inspect the owning project's
  targets before choosing checks. Prefer the smallest relevant Nx target.
- Development: `pnpm run serve:frontend` or `pnpm run serve:backend`.
- Tests: `pnpm nx test <project>`; lint: `pnpm nx lint <project>`.
- Find checks and E2E commands in the [validation map](docs/architecture/validation-map.md).
- Packaging, native dependencies and runtime patches have additional contracts
  in the context map; read them before dependency or release changes.

## Implementation invariants

- Use scoped aliases from `tsconfig.base.json`, such as `@iptvnator/services`.
  Do not introduce legacy bare aliases or bypass public project boundaries.
- Nx projects keep `scope:*`, `domain:*` and `type:*` tags. Shared cross-project
  files must belong to a project. SCSS imports need explicit hash dependencies.
- Target under 300 production TypeScript lines; the hard limit is 400 (1200
  for tests), excluding comments/blanks. Never add entries to the legacy baseline.
- Preserve existing persisted data. Users may skip releases: migrations must
  apply in dependency order, preserve data and be safe on repeated startup.
  Test actual historical SQLite schemas, not only SQL mocks.
- Choose runtime behavior through the relevant capability contract; a generic
  `window.electron` check does not prove that a particular bridge is available.
- Use shared redacting logging before emitting settings, portal or trace data.
  Never log credentials or expanded SQL/bound values.
- Keep UI consistent with the shared guidelines. Read the repository UI/theme
  skills before changing user-visible Angular views or shared styles.

## Validation and completion

- Before finishing, assess affected projects and test impact. Bug fixes normally
  include regression coverage that fails before the fix and passes afterwards.
- Update stale tests, fixtures and E2E flows when behavior changes. Run targeted
  unit checks and affected E2E for routing, persistence, playback and user flows.
- Electron-only IPC, database, packaging, players and filesystem changes need
  Electron E2E where available, otherwise CDP/manual validation with a reason.
- Report checks and results, any skipped checks with reasons, documentation
  changes, and whether a release note was added or why it was unnecessary.
- Every user-visible change needs a note under `.changes/`; follow the
  [release-note format](.changes/README.md) and the repository release-notes skill.
  Docs, tests, CI and behavior-preserving refactors do not need a note. Apply
  `no-release-note` on exempt PRs touching runtime code.
- Validate notes with `pnpm run release:notes:validate`. Release publication has
  separate ordered gates; follow the release-cut skill and release contract.

## Keep guidance small and canonical

- Update the affected subsystem's canonical document after meaningful changes.
  Prefer an existing authoritative doc; keep user/developer entry points in
  README and detailed contracts in architecture docs or a module README.
- Add to this file only repository-wide rules and navigation. Implementation
  details, incident history and multi-step procedures belong in linked docs.
  Do not duplicate subsystem contracts here or in CLAUDE.md.
- `AGENTS.md` is the single source of common rules. `CLAUDE.md` imports it and
  contains only Claude-specific guidance. Limits: 200 lines / 16 KiB here,
  30 lines / 2 KiB for CLAUDE.md. Do not raise loading limits to fit more prose.
- Read the [context map](docs/maintenance/agent-context-map.md) when ownership
  is unclear. Read each affected domain for cross-domain tasks, not the whole map's documents.
- Preserve exceptions and rationale when moving knowledge. Correct stale facts
  against code; do not silently discard a contract. Maintenance details are in
  the [agent workflow](docs/development/agent-workflow.md).
- Never run whole-file `prettier --write` on AGENTS.md, CLAUDE.md or `docs/**`.
  Edit only intended lines; upstream Markdown is not uniformly Prettier-clean.
- After changing guidance, run `pnpm run agents:validate`; after editing a
  repository skill or a literal path it documents, run `pnpm run skills:validate`.
  Keep release-cut and release-notes copies byte-identical for Codex and Claude.
- Save finalized plans only in `.plans/YYYY-MM-DD-short-topic.md`; if a filename
  exists, append `-2`, `-3`, etc. Respect active mode restrictions on file writes;
  if writing is forbidden, save the approved plan when execution starts.

## Read by task

| Task | Required starting point |
| --- | --- |
| Project layout, imports, dependencies, lint configuration | [Nx boundaries](docs/architecture/nx-workspace-boundaries.md) |
| Angular conventions, docs and skills maintenance | [Agent workflow](docs/development/agent-workflow.md) |
| Electron debugging, CDP, trace flags | [Electron debugging](docs/development/electron-debugging.md) |
| SQLite, worker IPC, persistence migrations | [DB worker](docs/architecture/sqlite-db-worker.md), [database migrations](libs/shared/database/README.md) |
| M3U, XMLTV, startup, source health, OS playlist opening | [M3U contracts](docs/architecture/m3u-playlist-module.md) |
| Xtream / Stalker | [Xtream compatibility](docs/architecture/xtream-portal-compatibility.md), [Stalker contracts](docs/architecture/stalker-portal.md) (affected provider only) |
| Player controls, diagnostics, radio, keep-awake | [Controls contract](docs/architecture/player-controls-contract.md) |
| Embedded MPV, native runtime and packaging | [Embedded MPV](docs/architecture/embedded-mpv-native.md) |
| UI, keyboard, detail navigation, remote control | [UI guidelines](docs/architecture/iptvnator-ui-guidelines.md), then matching topic in context map |
| PWA, backend networking, connectivity guard | [PWA contract](docs/architecture/pwa-self-hosted.md), [host connectivity](docs/architecture/host-connectivity-guard.md) |
| Downloads, TMDB, multi-source, workspace, backup, website | [Context map](docs/maintenance/agent-context-map.md) |
| Release or packaging metadata | [Release pipeline](docs/architecture/release-pipeline.md), release-cut skill |

Repository skills live in `.codex/skills/`. Their frontmatter owns trigger
conditions; use the context map to locate a relevant skill. Read its linked
contract before editing. A missing optional global skill/tool is not a blocker:
use repository documentation and available CLI discovery.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For workspace exploration, use the `nx-workspace` skill when available;
  otherwise inspect project-local project.json files, `pnpm nx show projects` and `pnpm nx graph`.
- Run project tasks through local `pnpm nx`, not a global Nx installation.
- Use the Nx MCP server when available; otherwise use CLI discovery.
- Check `node_modules/@nx/<plugin>/PLUGIN.md` for plugin guidance when present.
- Never guess unfamiliar flags: consult `--help` or available `nx_docs`.

## Scaffolding and generators

- Use the `nx-generate` skill first when available. Otherwise discover the
  generator with local Nx help and follow repository boundary rules.

## When to use nx_docs

- Use available `nx_docs` for migrations, unfamiliar configuration and flags.
- Basic task syntax does not require a docs lookup; generator discovery belongs
  to the generator skill or local CLI help.

<!-- nx configuration end-->
