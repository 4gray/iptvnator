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
- Keep the root `CLAUDE.md` and this file up to date. They are living documents: whenever a change touches something they describe — monorepo structure (new/moved/renamed apps or libs), routes, database schema/tables, stores and their features, key components, commands, environment behavior, or coding conventions — update the affected sections as part of the same task, and keep the process sections mirrored between `AGENTS.md` and `CLAUDE.md` in sync.
- When adding a new feature area, check whether the Architecture or Key Features sections of `CLAUDE.md` describe the surrounding area; if they do, reflect the addition there instead of leaving the description stale.
- Do not let `CLAUDE.md` or `AGENTS.md` drift: a stale path or route in these files poisons the context of every future agent session. If you notice an outdated claim while working, fix it (or flag it in the final summary) even if it is unrelated to the current task.
- Repo docs are canonical even when they were originally drafted by an LLM.
- Final task summaries should state whether docs were updated and which doc changed.

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
    - `IPTVNATOR_TRACE_PLAYER=1` traces external-player activity and bounded Embedded MPV runtime-probe stderr
    - `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console output into the Electron terminal

- Settings, portal request/response, and trace payloads must use
  `@iptvnator/shared/logging` or the redacting portal logger before reaching
  `console.*`; never log raw credentials while debugging.

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

## Shared Player Controls

- `libs/ui/playback/src/lib/player-controls/` contains the additive,
  engine-neutral `PlayerController` contract, standalone
  `app-player-controls`, generic web-video adapter/helper, and component-scoped
  `WEB_PLAYER_SHARED_CONTROLS` rollout token.
- Persisted `Settings.webPlayerSharedControls` is default-off, and its checkbox
  appears only when HTML5, Video.js, or ArtPlayer is selected.
  `WebPlayerViewComponent` snapshots the preference into
  `WEB_PLAYER_SHARED_CONTROLS` for each new player host. The parent `/workspace`
  route awaits the initial `SettingsStore` load, including cold-start direct
  links, before this snapshot can occur. Saving applies to the next host without
  an application restart; an existing session never changes controls mode in
  place.
- Embedded MPV ignores the web-player preference. Frame-copy always uses shared
  DOM controls through its component-scoped `EmbeddedMpvControlsAdapter`, while
  native-view retains the legacy compositor-safe dock and external MPV/VLC
  retain their own UI. The host must render exactly one controls system for the
  reported Embedded MPV engine.
- Frame-copy shared controls own DOM surface interactions, shortcuts,
  fullscreen, and recording feedback. `showControls=false` detaches the shared
  surface, modal overlays gate playback shortcuts, fullscreen still triggers
  bounds sync, and a playback/session transition key prevents engine or session
  handoff from presenting stale recording feedback while timers and pending
  commands are cancelled. Same-session IPC replies also yield to a broadcast
  snapshot received while the command was pending, preventing a successful
  recording acknowledgement from being rolled back by a stale reply.
- The built-in HTML5/hls.js player is the second guarded consumer.
  `HtmlVideoPlayerComponent` provides a component-scoped
  `WebVideoControlsAdapter`; its neutral `web-video-support` bridge is shared
  with ArtPlayer and owns HLS/native tracks, MPEG-TS VOD duration correction,
  caption preference, and source cleanup.
  `HtmlVideoElementSession` owns native video-event lifecycle, persisted
  volume, start-time/time/ended propagation, and legacy post-play caption
  suppression.
  `WebPlayerViewComponent.resolvedIsLive` supplies authoritative live/VOD
  metadata, while a visible playback diagnostic disables both shared surface
  interaction and shortcuts and exits the HTML5 shell's own fullscreen so the
  diagnostic actions remain visible. The preference-off path keeps native
  controls and legacy series navigation unchanged.
- Video.js is the third guarded consumer. `VjsPlayerComponent` provides a
  component-scoped `WebVideoControlsAdapter`; its bridge binds the current Tech
  video, rebinds after `playerreset`, exposes source-stable audio/subtitle IDs,
  preserves caption preference and explicit subtitle-off state, and reads
  duration from Video.js. Reset-driven raw MPEG-TS changes pause first,
  coalesce to the latest desired source, preserve actual volume across
  Video.js's reset, and restart when authoritative live/VOD metadata changes.
  The shared-controls path disables native controls, Video.js
  click/double-click/hotkey actions, and spatial navigation;
  diagnostic gating and owned-fullscreen exit match HTML5. The preference-off
  path keeps the existing Video.js skin and legacy series navigation unchanged.
- ArtPlayer is the fourth guarded consumer. `ArtPlayerComponent` provides a
  component-scoped `WebVideoControlsAdapter`; `ArtPlayerSourceSession` owns
  HLS/MPEG-TS/native sources, the neutral web-video bridge, exact cleanup, and
  a destroyed-session guard for delayed `customType` callbacks, while
  `ArtPlayerVideoSession` owns native media/ArtPlayer events. Shared mode uses
  authoritative live/VOD metadata, HLS/native tracks and caption preference,
  MPEG-TS VOD duration correction, and reapplies app volume directly after
  ArtPlayer restores its own stored volume. Vendor chrome/hotkeys are disabled,
  and a transparent capture layer gives shared controls exclusive click and
  double-click ownership. Diagnostic interaction gating and owned-fullscreen
  exit match the other web players. The preference-off path keeps the legacy
  ArtPlayer skin, source behavior, and series navigation unchanged.
- Shared web picture-in-picture stays inside that default-off rollout.
  `PlayerController` exposes capability `pictureInPicture`, state
  `pictureInPictureActive`/`canPictureInPicture`, and command
  `togglePictureInPicture()`. HTML5, Video.js, and ArtPlayer use standard
  element PiP from the adapter's attached video; shared ArtPlayer keeps vendor
  `pip: false`, while preference-off native/vendor paths remain unchanged. The
  capability-gated button sits before fullscreen and uses active enter/exit
  semantics; entry is disabled until metadata, and the action is disabled while
  an operation is pending. Embedded MPV reports capability/state false with a
  no-op command and has no popup/mini-window.
- `WebVideoControlsAdapter` supplies its current video and binding generation to
  `WebVideoPictureInPictureController`; the controller reads the video's
  `ownerDocument`, while browser enter/leave events remain authoritative.
  Exact-owner exit stays available if request support changes. Request/exit
  invocation remains synchronous for user activation, one operation is
  serialized, and binding generation plus exact video identity protects
  replacement and teardown from stale completion. Video.js Tech reset and
  ArtPlayer rebuild rebind with exact-owner cleanup; HTML5 source changes on a
  retained target preserve PiP.
  Standard PiP shows the browser/OS video surface without Angular control
  chrome, with browser-dependent subtitles. AirPlay, Cast, Document PiP, a PiP
  keyboard shortcut, and Embedded MPV popup/native support are out of scope.
- Canonical docs: `docs/architecture/player-controls-contract.md` and
  `docs/architecture/embedded-mpv-native.md`

## Linux Embedded MPV Packaging

- Official Linux frame-copy artifacts are x64-only. AppImage, DEB, RPM,
  Pacman, Snap, and Flatpak are supported; non-x64 Linux packages must remain
  marker-only and must never inherit x64 native artifacts from environment
  overrides.
- Packaging runs three isolated profiles:
    - `system`: DEB/RPM/Pacman, no private `native/lib`, with package
      dependencies DEB=`libmpv2,libegl1,libgl1,libgbm1`,
      RPM=`mpv-libs,libglvnd-egl,libglvnd-glx,mesa-libgbm`, and
      Pacman=`mpv,libglvnd,mesa`
    - `portable`: AppImage/Snap with the pinned LGPL-compatible closure
    - `flatpak`: Flatpak with the same pinned closure
- Flatpak is an isolated packaging pass and keeps `iptvnator` as the real
  Electron ELF so Electron Builder's `electron-wrapper` passes it directly to
  Zypak. Other Linux targets retain the conditional `iptvnator` wrapper and
  `iptvnator.bin`. Mixed Flatpak/non-Flatpak target sets fail before mutation.
- The DEB system-runtime contract is Ubuntu 24.04+ (`libmpv2`). Ubuntu 22.04
  provides `libmpv1`, so use the x64 AppImage on Jammy instead of weakening the
  package dependency or advertising frame-copy without a compatible runtime.
- Only `iptvnator_mpv_helper` may link libmpv. The Electron executable,
  Electron libraries, `embedded_mpv.node`, and
  `embedded_mpv_frame_reader.node` must not load or link it. Preserve this
  process-isolation contract in build, package, and smoke checks.
- `electron-backend/native{,/**/*}` is excluded from `app.asar`; `afterPack`
  exclusively writes the profile-normalized unpacked native tree. Layout and
  final-artifact checks must reject every archived
  `/electron-backend/native/**` entry so system and marker-only packages cannot
  hide stale x64 artifacts.
- Packaged addon, frame-reader, and helper discovery is package-owned
  `app.asar.unpacked` only. Writable cwd/dist candidates are development-only
  and must never satisfy packaged native-view support or the frame-copy gate.
- Pristine afterPack/unpacked layouts scan Electron libraries recursively.
  Extracted Snap payloads exclude only the package-manager `lib/**` and
  `usr/lib/**` trees that Snap overlays into the same root; every other
  directory remains recursive, and Electron-library symlinks still fail
  closed.
- Linux frame-copy availability is fail-closed. The packaged manifest,
  artifact modes, declared bundled hashes/closure, and bounded
  `--runtime-probe` must all succeed before frame-copy can relax the renderer
  sandbox. Any failure reports a stable reason and falls back to native-view
  without crashing; an environment flag never bypasses this gate.
- Snap is `core22`/strict and uses an exact private `shared-memory` plug plus
  the `graphics-core22` content plug at an empty mode-0755 `$SNAP/graphics`,
  with `mesa-core22` as default provider. It declares only the canonical
  provider layouts: `/usr/share/libdrm` binds from
  `$SNAP/graphics/libdrm`, and `/usr/share/drirc.d` symlinks to
  `$SNAP/graphics/drirc.d`. The provider is external shared content, not part
  of IPTVnator's package size, source archive, or notices. Installed-Snap CI
  must prove controlled unavailable exit after disconnect, then reconnect and
  prove success. The helper links `libGL.so.1` rather than `libOpenGL.so.0`.
- The probe and playback helper share one sanitized loader environment:
  ambient audit, preload, library, graphics-driver, and shell-startup overrides
  are removed; the validated private closure wins; trusted Snap GL,
  `graphics-core22`, the core22 base x64 root, and exact GNOME-platform roots
  precede generic in-snap roots. The core22 base must precede GNOME so its
  `libedit.so.2` cannot be replaced by the older copy requiring
  `libtinfo.so.5`. The extracted-artifact verifier removes the identical
  unsafe loader/graphics/shell set before direct helper smoke while preserving
  feature/debug selectors such as `LIBGL_ALWAYS_SOFTWARE`. Snap fixes the
  wrapper `PATH`, removes exported `BASH_FUNC_*` functions, and launches
  probe/playback through the regular executable
  `$SNAP/graphics/bin/graphics-core22-provider-wrapper`; a missing or
  disconnected provider returns `snap-graphics-provider-unavailable` before
  helper spawn. The packaging-only `--embedded-mpv-runtime-probe` app switch
  runs the complete cached manifest/hash/helper gate before BrowserWindow
  startup and exits with one availability JSON line. A nonzero helper exit
  keeps top-level reason `helper-probe-failed`; `helperReason` is present only
  for an exact protocol-v1 line carrying a fixed allowlisted reason, and its
  optional `helperDetail` must be 1–1024 printable ASCII characters. Invalid
  detail suppresses both helper fields. Every probe uses an explicit 16 MiB
  aggregate captured-output ceiling independent of tracing. With
  `IPTVNATOR_TRACE_PLAYER=1`, a non-empty helper stderr capture is emitted
  separately as one JSON-escaped stderr line whose `stderr` field is limited
  to 16,384 characters and whose `truncated` field is always explicit;
  trace-write failure cannot change the capability result. Installed-Snap CI
  enables Mesa EGL/GL diagnostics through this bounded channel. Any loader
  failure remains a stable native-view fallback, never a flag-enabled success.
- In the exact packaged Flatpak `/app` context, reconstruct only Freedesktop
  Platform 24.08's immutable `__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS`; its GL
  extension loader path comes from the sandbox cache. Flatpak CI must invoke
  the application-level `--embedded-mpv-runtime-probe`, not a direct helper
  probe that bypasses capability detection.
- The packaged x64 Playwright smoke runs its fixture-contract target first and
  passes Chromium `--ignore-gpu-blocklist` so CI llvmpipe can expose WebGL2.
  This launch-only flag does not bypass the manifest, hash, loader, or helper
  capability gate; `--no-sandbox` remains root-only.
- Bundled Linux releases must publish the exact source archives/git records,
  checksums, licenses, flags, patches, build scripts, and the pinned hwdata
  `pnp.ids` input. Each bundled package carries
  `embedded-mpv-notices.json`, `THIRD_PARTY_NOTICES.txt`, and the exact
  `licenses/**` files. CI may cache immutable source inputs, but regenerates
  notices and a VCS-metadata-free
  `linux-frame-copy-runtime-sources.tar.xz` for the current checkout on every
  run while retaining the exact pinned six recursive libplacebo submodule
  records. Each record is canonical `full-commit safe/path`; clone-depth
  dependent `git describe` annotations are discarded and never form part of
  the provenance identity. Its source index carries the globally sorted libplacebo
  directory/file/symlink inventory; file hashes, sizes, executable bits, link
  targets, aggregates, and canonical tree digest must match the trusted pinned
  checkout. The archive has an exact member/type layout and its
  `metadata/archive-sha256.txt` records must match the actual source archives.
  Concatenated tar/xz streams are inspected past every end marker. The final
  archive's SHA-256 and repository revision are copied into every bundled x64
  package manifest; system and marker-only packages carry no source-archive
  binding.
  Automated Snap Store publication is allowed only after a public `v*` GitHub
  release contains both the Snap assets and exactly one matching source
  archive. Before any upload, the workflow hashes and inspects that archive,
  verifies its exact member/type set and size bounds, clean tag revision,
  pinned sources including the six recursive submodule records and exact
  libplacebo tree digest, legal files, and exact released tooling, then
  performs bounded extraction and static package validation for every Snap.
  That public-release boundary independently revalidates the exact strict
  `meta/snap.yaml` graphics/shared-memory contract and enumerates
  `resources/app.asar`, rejecting any archived
  `electron-backend/native/**` payload before publication. Its bounded ASAR
  header reader uses only Node built-ins and released local tooling, so the
  clean tag checkout does not require `node_modules`.
  Exactly one x64 Snap must have matching
  `sourceArchive` and `sourceRuntime`; any non-x64 Snap must remain
  marker-only. Checkout and the artifact-transfer actions are pinned to full
  commits; checkout does not persist credentials, and repository credentials
  are limited to download steps. A secretless verification job copies assets
  through no-follow descriptors, checks pre/post hashes, writes an exact
  receipt, repeats the complete source/package verification on a root-owned
  read-only snapshot, and transfers only that data through the pinned artifact
  service while its receipt digest travels separately through a job output.
  The dependent publish job runs on a bounded `ubuntu-latest` runner with no
  checkout or release-tag code, verifies that digest plus the exact receipt,
  asset hashes, and file-only layout, root-seals the data again, and installs
  Snapcraft directly. Store credentials exist only in its final fixed shell
  step, which resolves no PATH command, executes no released code, and exposes
  the credential only to each exact
  `/snap/bin/snapcraft upload --release=edge` process.
  Candidate/stable promotion is manual after installed-Snap frame-copy and
  missing-runtime fallback smoke; GitHub Actions never promotes automatically.
  Canonical maintenance docs:
  `docs/architecture/embedded-mpv-native.md` and
  `tools/embedded-mpv/README.md`.

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

- `stalker-portal`
  Repository-specific guidance for Stalker/Ministra catalogs, all three VOD/series modes, cross-surface `is_series` behavior, playback metadata, collections, EPG, and remote control.
  Use when changing Stalker routes, stores, detail views, playback, favorites/recent activity, EPG, or remote control.
  File: `.codex/skills/stalker-portal/SKILL.md`

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
