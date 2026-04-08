# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Plan Mode

- When an agent is in Plan Mode and produces a final `<proposed_plan>`, it must also save that finalized plan as a Markdown file in the repo-root `.plans/` directory.
- Save only finalized plans. Do not write interim exploration, questions, or draft revisions to `.plans/`.
- Use the filename pattern `YYYY-MM-DD-short-topic.md` such as `.plans/2026-03-12-channel-filtering.md`.
- If the intended filename already exists, append a numeric suffix such as `-2`, `-3`, and so on.

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
