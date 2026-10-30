# Server Storage for the Self-hosted PWA — Overview

Spec: `docs/superpowers/specs/2026-10-08-server-storage-design.md`.
Branch base: `origin/master` at `7abf479de` (2026-10-11).

## Order of work

Three plans, three pull requests, merged in this order. Each one leaves the
app working and fully tested.

| Plan | PR title | Release note |
| --- | --- | --- |
| [Phase 1: seams](2026-10-11-server-storage-phase-1-seams.md) | `refactor(storage): seams for server-backed playlist storage` | none, label `no-release-note` (behavior-preserving) |
| [Phase 2a: backend](2026-10-11-server-storage-phase-2a-backend.md) | `feat(self-hosted): server storage API in web-backend` | none yet, label `no-release-note`; the PWA does not use it until 2b |
| [Phase 2b: PWA](2026-10-11-server-storage-phase-2b-pwa.md) | `feat(self-hosted): keep playlists on the server for every device` | `.changes/self-hosted-server-storage.md`, closes #305 |

Phase 2a only depends on Phase 1 Tasks 2 and 3 (shared codec, data-dir
variable). Phase 2b depends on all of Phase 1 and 2a.

## Branches and worktrees

- One worktree per PR under `.claude/worktrees/`, each with its own
  `pnpm install --frozen-lockfile` (AGENTS.md).
- Phase 1 branch: `claude/server-storage` (this worktree, already holds the
  spec and the plans).
- Phase 2a branch: `claude/server-storage-backend`, created from
  `claude/server-storage` after Phase 1 is committed, rebased onto `master`
  once Phase 1 merges.
- Phase 2b branch: `claude/server-storage-pwa`, created from the 2a branch the
  same way.

## Gates for every PR (from AGENTS.md)

1. Targeted unit tests and lint of each touched project.
2. `pnpm run typecheck:ci`.
3. Docs updated in the canonical owner (listed per plan).
4. Local review gate: commit, then `codex review --base origin/master -c model_reasoning_effort=high`
   and `greptile review --json` on the same commit, fix, repeat until both are clean (max five rounds).
5. Push once, open the PR, report checks, skipped checks with reasons, docs and release-note status.

## Decisions to keep in mind while implementing

- Do not change `PlaylistsService`'s public API. All storage selection goes
  through `PlaylistStorageBackend`.
- Never add files to `tools/eslint/max-lines-baseline.mjs`. New production
  files stay under 300 lines.
- Storage errors on the server are logged by error name and route only;
  Drizzle messages can carry SQL parameters (portal credentials).
- The server-mode browser cache uses the key prefix `iptvnator-server:`;
  never write server data into the legacy `xtream-*` keys.
- Translate every new i18n key in all 19 locales; `pnpm run i18n:check`
  must pass.
