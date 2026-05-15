# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Plan Mode

- When an agent is in Plan Mode and produces a final `<proposed_plan>`, it must also save that finalized plan as a Markdown file in the repo-root `.plans/` directory.
- Save only finalized plans. Do not write interim exploration, questions, or draft revisions to `.plans/`.
- Use the filename pattern `YYYY-MM-DD-short-topic.md` such as `.plans/2026-03-12-channel-filtering.md`.
- If the intended filename already exists, append a numeric suffix such as `-2`, `-3`, and so on.

## Agent Bootstrap

- In a fresh worktree, run `pnpm install --frozen-lockfile` before relying on Nx project discovery, lint, test, or build commands. Without `node_modules`, `pnpm nx show projects` will fail because the local Nx modules are unavailable.
- After dependencies are installed, verify workspace discovery with `pnpm nx show projects`.
- Use scoped path aliases from `tsconfig.base.json` such as `@iptvnator/services`, `@iptvnator/shared/interfaces`, and `@iptvnator/ui/components`. Do not add new imports from legacy bare aliases such as `services`, `shared-interfaces`, `components`, `m3u-state`, or `database`.
- Every Nx project should keep `scope:*`, `domain:*`, and `type:*` tags in `project.json` so `@nx/enforce-module-boundaries` remains useful for humans and agents.
- See `docs/architecture/nx-workspace-boundaries.md` for the current Nx tag and alias policy.
- Repository-specific skills are committed under `.codex/skills/`. If an external agent does not support skills, treat those files as concise ownership docs.

## Documentation After Changes

- After implementing a meaningful change, agents must assess whether canonical repo docs need updates before considering the task complete.
- Meaningful changes include new or changed user-visible behavior, architecture or data-flow changes, non-obvious maintenance workflows, new setup/debugging steps, and new subsystem contracts or boundaries.
- Skip doc updates for trivial refactors with unchanged behavior, formatting-only edits, and isolated test-only changes.
- Prefer updating an existing authoritative doc before creating a new one:
    1. `README.md` for top-level developer or user workflows
    2. `docs/architecture/` for architecture, ownership, and behavior contracts
    3. the nearest module `README.md` for local usage or behavior
- Repo docs are canonical even when they were originally drafted by an LLM. External wiki pages are derivative or synthesis content unless explicitly promoted back into the repo.
- The external wiki sync is one-way by default: repo docs -> external wiki `_repo-context/`.
- If repo docs changed and `IPTVNATOR_WIKI_VAULT` is configured, run `pnpm wiki:export --mode changed` after the doc update.
- The wiki exporter only owns `_repo-context/` in the external vault. It must never overwrite repo docs or maintained wiki pages outside that folder.
- Final task summaries should state whether docs were updated, which doc changed, and whether wiki export ran, was skipped, or failed.

## Regression Prevention And Test Updates

- Before the final summary for any feature, behavior change, bug fix, data-flow change, Electron IPC/database change, or user-visible UI workflow change, complete a test impact pass. Identify the affected projects and decide whether unit, integration, E2E, build, lint, or manual/CDP verification is required.
- Bug fixes must normally include regression coverage that fails on the old behavior and passes with the fix. If automated coverage is not practical, document why in the final summary and include the strongest manual validation performed.
- Feature work and behavior changes must update existing tests when assertions, fixtures, mocks, routes, or E2E flows are now stale, incomplete, or missing. Prefer extending the closest existing spec or E2E file before adding a new suite.
- Default validation ladder:
    1. Run targeted unit tests for directly affected projects with `pnpm nx test <project>` or existing scripts such as `pnpm run test:frontend`, `pnpm run test:backend`, or `pnpm run test:unit:ci` when the scope is broader.
    2. Run affected E2E coverage when changing user-visible workflows, routing, persistence, playback, portals, settings, import flows, or Electron-only behavior.
    3. Use `pnpm nx show projects --withTarget test` and `pnpm nx show projects --withTarget e2e` when project ownership or available validation targets are unclear.
    4. Prefer specific atomized E2E targets before broad suites when they cover the changed behavior, for example `pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts` or `pnpm nx run electron-backend-e2e:e2e-ci--src/search.e2e.ts`.
- Electron-specific changes affecting IPC, SQLite, packaged runtime, external players, native file access, or Electron-only routes require Electron E2E coverage where available, or CDP/manual verification with `agent-browser` and the tracing flags documented below.
- Final task summaries must list tests added or updated, validation commands run with results, and any skipped validation with the reason. For docs-only changes, state that unit/E2E validation was not required and verify the changed Markdown instead.

## Electron Debugging (CDP)

- Start the Electron development app with: `nx serve electron-backend`
- Package-script equivalent: `pnpm run serve:backend`
- Electron is configured to start with: `--remote-debugging-port=9222`
- Connect Chrome DevTools Protocol tools to: `127.0.0.1:9222`
- For Electron automation/debugging tasks, use the `electron` skill
- Do not auto-open DevTools during normal CDP automation. In development, DevTools is opt-in via `ELECTRON_OPEN_DEVTOOLS=1`.
- If DevTools is open, `agent-browser --cdp 9222 ...` may attach to the DevTools page instead of the IPTVnator window. Symptoms: `tab list` shows `about:blank`, snapshots are empty, and screenshots are black.
- If that happens, inspect targets with `curl http://127.0.0.1:9222/json/list` and connect directly to the IPTVnator page websocket from the `webSocketDebuggerUrl` field.

### Trace / Debug Startup

- Full startup tracing:

```bash
IPTVNATOR_TRACE_STARTUP=1 nx serve electron-backend
```

- Narrower trace flags:
    - `IPTVNATOR_TRACE_IPC=1` traces renderer `window.electron.*` bridge calls
    - `IPTVNATOR_TRACE_DB=1` traces DB worker requests and request-scoped DB events
    - `IPTVNATOR_TRACE_SQL=1` traces SQLite statements in the main process and DB worker
    - `IPTVNATOR_TRACE_WINDOW=1` traces BrowserWindow lifecycle and unresponsive events
    - `IPTVNATOR_TRACE_PLAYER=1` traces external-player launch/reuse/polling debug output
    - `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console output into the Electron terminal

- GPU/compositor debugging:

```bash
IPTVNATOR_DISABLE_HARDWARE_ACCELERATION=1 nx serve electron-backend
```

- If local Nx state gets weird before a rerun:

```bash
pnpm nx reset
```

### agent-browser (global install)

```bash
agent-browser --cdp 9222 tab list
agent-browser --cdp 9222 tab 1
agent-browser --cdp 9222 snapshot -i -c -d 4
agent-browser --cdp 9222 screenshot /tmp/iptvnator-cdp.png
```

### Fallback

```bash
npx --yes agent-browser --cdp 9222 tab list
```

### DevTools Workaround

```bash
ELECTRON_OPEN_DEVTOOLS=1 nx serve electron-backend
curl http://127.0.0.1:9222/json/list
agent-browser connect ws://127.0.0.1:9222/devtools/page/<iptvnator-page-id>
agent-browser screenshot /tmp/iptvnator-cdp.png
```

## Radio / Audio Player

M3U playlists can contain radio channels identified by the `radio="true"` attribute on `#EXTINF` lines. When a radio channel is selected:

- The dedicated `AudioPlayerComponent` (`libs/ui/playback/src/lib/audio-player/`) renders instead of a video player
- The audio player always uses the built-in inline player — external player settings (MPV/VLC) are ignored
- The EPG panel is hidden (radio streams have no EPG data)
- The layout uses a cinematic hero pattern: the station logo is blurred as a full-area backdrop with a vignette overlay, and the artwork card + controls float above it
- Volume is shared with the video player via `localStorage` key `'volume'`
- Keyboard shortcuts: ArrowUp/ArrowDown (volume +/-5%), M (mute toggle)
- Radio detection in the video player template: `activeChannel.radio === 'true'` — this is a string comparison, not boolean

Key files:

- `libs/ui/playback/src/lib/audio-player/audio-player.component.ts` — the audio player component
- `libs/ui/playback/src/lib/audio-player/audio-player.component.scss` — cinematic hero styling
- `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.html` — template conditionals for radio vs video
- `libs/shared/interfaces/src/lib/channel.interface.ts` — `radio: string` field on Channel interface

## Repo Skills

- `iptvnator-ui-design`
  Repository-specific UI design guidance for IPTVnator.
  Use when working on channel rows, EPG views, settings surfaces, shared selection styles, or light/dark theme consistency.
  File: `.codex/skills/iptvnator-ui-design/SKILL.md`

- `iptvnator-theme-style`
  Theme architecture, design token reference, shared SCSS library, portal header pattern, Electron drag region, and common styling mistakes.
  Use when adding/changing CSS tokens, styling portal headers or sidebars, using shared SCSS mixins (`portal-layout`, `content-grid`, `portal-sidebar`), or auditing cross-portal visual consistency.
  File: `.codex/skills/iptvnator-theme-style/SKILL.md`

- `iptvnator-nx-architecture`
  Repository-specific Nx monorepo structure, library placement rules, path alias guidance, and migration guardrails for portal/workspace/app code.
  Use when deciding where code belongs, extracting code into libs, choosing imports, or refactoring Xtream/Stalker/Workspace boundaries.
  File: `.codex/skills/iptvnator-nx-architecture/SKILL.md`

- `iptvnator-sqlite-db-worker`
  Repository-specific guidance for the Electron non-EPG SQLite worker, including worker boundaries, request-scoped DB progress events, and validation steps for slow DB operations.
  Use when moving heavy database work off the main thread, adding worker-backed SQLite operations, or wiring loading/progress UI for Xtream and playlist DB flows.
  File: `.codex/skills/iptvnator-sqlite-db-worker/SKILL.md`

- `xtream-electron`
  Repository-specific guidance for IPTVnator's Electron-first Xtream implementation, including feature/data-access boundaries, worker-backed DB flows, and Xtream loading/progress UX expectations.
  Use when working on Xtream routes, store/data-source logic, or Electron-backed Xtream import/search/delete behavior.
  File: `.codex/skills/xtream-electron/SKILL.md`

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first when it is available - it has patterns for querying projects, targets, and dependencies. If it is unavailable, use `pnpm nx show projects`, `pnpm nx graph`, and project `project.json` files directly.
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
