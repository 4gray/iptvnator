# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Plan Mode

- When an agent is in Plan Mode and produces a final `<proposed_plan>`, it must also save that finalized plan as a Markdown file in the repo-root `.plans/` directory.
- Save only finalized plans. Do not write interim exploration, questions, or draft revisions to `.plans/`.
- Use the filename pattern `YYYY-MM-DD-short-topic.md` such as `.plans/2026-03-12-channel-filtering.md`.
- If the intended filename already exists, append a numeric suffix such as `-2`, `-3`, and so on.

## Agent Bootstrap

- In a fresh worktree, run `pnpm install --frozen-lockfile` before relying on Nx project discovery, lint, test, or build commands. Without `node_modules`, `pnpm nx show projects` will fail because the local Nx modules are unavailable.
- Re-run the install whenever the checkout moves — `git pull`, `git reset --hard`, a rebase, or a worktree branch being re-pointed. Git rewrites `pnpm-lock.yaml` but never re-links `node_modules`, so a tree installed at an older commit keeps serving the old dependency versions and tests fail locally while CI stays green. Check with `cmp pnpm-lock.yaml node_modules/.pnpm/lock.yaml`; any difference means the tree is stale, and a plain `pnpm install --frozen-lockfile` in that directory repairs it. Each worktree needs its own install — with no local `node_modules`, Nx aborts with `Could not find ".modules.yaml"`.
- After dependencies are installed, verify workspace discovery with `pnpm nx show projects`.
- Use scoped path aliases from `tsconfig.base.json` such as `@iptvnator/services`, `@iptvnator/shared/interfaces`, and `@iptvnator/ui/components`. Do not add new imports from legacy bare aliases such as `services`, `shared-interfaces`, `components`, `m3u-state`, or `database`.
- Every Nx project should keep `scope:*`, `domain:*`, and `type:*` tags in `project.json` so `@nx/enforce-module-boundaries` remains useful for humans and agents.
- See `docs/architecture/nx-workspace-boundaries.md` for the current Nx tag and alias policy.
- Keep `nx` and every official `@nx/*` package on the same exact version; run
  `pnpm run deps:nx:validate` after dependency updates.
- Vite `7.3.6`, resolved through Angular's build tooling, is patched with
  bounded transform prefilters and the upstream precise matchers in
  `patches/vite@7.3.6.patch`. Keep the patch until supported Angular tooling
  resolves a Vite version containing the fix, and run `pnpm run deps:vite:test`
  after related dependency updates.
- A directory holding files consumed by other projects must be an Nx project.
  Nx builds its graph from TypeScript imports only, so a relative SCSS `@use`
  across project roots creates no edge and the imported file lands in no task
  hash — edits then return a cache hit instead of rebuilding. Shared partials
  live in `libs/ui/styles` (project `ui-styles`), and each consumer declares
  `"implicitDependencies": ["ui-styles"]`. Run `pnpm run styles:inputs:validate`
  after adding a cross-project stylesheet import.
- Update Nx with `pnpm nx migrate nx@<target> --skipInstall`, regenerate the
  lockfile, run generated migrations when present, and validate before opening
  a PR. Major updates are always manual. Replace incomplete Dependabot security
  PRs with a coordinated update instead of editing the bot branch.
- ESLint enforces `max-lines` on TypeScript files: production code targets under 300 with a hard maximum of 400, while tests (`**/*.spec.ts`, `**/*.spec-data.ts`, `**/*.e2e.ts`, `apps/*-e2e/**`) are held to 1200 — a long spec signals coverage, not the design debt the production limit catches. Blank lines and comments are not counted, so a docblock never forces a split. Limits live in `tools/eslint/max-lines-config.mjs`, imported by both `eslint.config.mjs` and the generator so the rule and the baseline cannot drift. Files that predate the rule are baselined in `tools/eslint/max-lines-baseline.mjs`; after splitting a file, regenerate it with `node tools/eslint/generate-max-lines-baseline.mjs` (it runs ESLint's own rule rather than counting lines itself). Never add new files to the baseline — the list must only shrink. A new file that genuinely cannot be split (for example a function serialized into another process) instead carries its own file-wide `/* eslint-disable max-lines -- <why> */`; the generator skips those files, so a justified exemption never lands in the baseline. Remove such a directive once ESLint reports it as unused.
- Project `lint` targets that shell out to eslint must quote the glob, e.g. `eslint "apps/<project>/**/*.ts"`. An unquoted `**` is expanded by the POSIX shell on Linux and macOS (which has no `globstar`, so it matches only a shallow subset of files) while Windows passes the literal pattern to ESLint, which expands it recursively — the two hosts then lint different file sets. The target still reports success either way, so a broken glob hides missing coverage instead of failing. After changing such a target, compare the linted file count against `find <project> -name '*.ts' | wc -l`.
- Repository-specific skills live under `.codex/skills/`.
- Frontmatter descriptions are trigger-only and begin with `Use when`; keep
  each skill at or below 500 words.
- Run `pnpm run skills:validate` after editing a committed skill or a literal
  path it documents.
- Keep `.codex` and `.claude` copies of `release-notes` and `release-cut`
  byte-identical.

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

## Release Notes For User-Visible Changes

- Any change a user could notice — new behavior, changed behavior, bug fix, performance win, breaking change — must add one note file under `.changes/` in the same PR. Format, field table, and writing rules: `.changes/README.md`.
- Name it `<area>-<short-slug>.md`; `area` matches the conventional-commit scope. There is no version field — the release version is chosen at release time.
- Write the body for a user, not a reviewer: "the player now remembers volume between episodes", not "hoist volume state into the session". Max 400 characters; depth belongs in the release blog post.
- `type: internal` records invisible maintenance. Internal notes stay collapsed in `CHANGELOG.md`, are omitted from the blog scaffold, and are removed from the authored public GitHub body by `extract-changelog-section.mjs --public`; GitHub's generated commit list remains separate, so an internal-only release can have an empty authored body.
- `highlight: <short headline>` (max 60 characters, rejected on `type: internal`) marks a note as one of the release's two or three headline changes. Highlights lead the Telegram/Reddit announcement drafts, become ready-made blog section headings, and are the input the highlight-card generator renders from. A release where everything is a highlight has none.
- Skip the note for test-only changes, docs, CI/workflow plumbing, and pure refactors with no behavior change. When skipping on a PR that touches `apps/**` or `libs/**`, apply the `no-release-note` label.
- CI enforces this: the "Release note gate" job in `.github/workflows/ci.yml` fails PRs that change runtime code without an added `.changes/*.md` or the label (policy in `tools/release/check-release-note-gate.mjs`; tests/e2e/website/mock-server/docs paths are auto-exempt).
- The `release-notes` skill covers writing notes; the `release-cut` skill covers the full release sequence. Canonical contract — surfaces, ordering constraints, the required draft asset set: `docs/architecture/release-pipeline.md`.
- Validate before finishing: `pnpm run release:notes:validate`.
- Announcement drafts and highlight cards are built from the same notes: `pnpm --silent run release:notes:telegram` and `pnpm --silent run release:notes:reddit` print paste-ready posts to stdout (Telegram is guaranteed to fit its 4096-character limit; `--silent` keeps pnpm's lifecycle banner out of a redirected post), and `pnpm run release:cards:generate` renders branded 1200×630 highlight cards plus a release hero into `dist/release-highlight-cards/v<version>/`. All three read `highlight:` metadata that exists only in the note files, so they must run before `build-release-notes.mjs --consume`; the cards additionally need `release:screenshots` to have run. Nothing is posted or copied into the website tree automatically.
- Pushes to `master` and `v*` can publish Docker images. A `v*` tag build creates a draft GitHub release.
- `pnpm run release:verify:draft` waits for that tag build (polling until the run is indexed, then `gh run watch`) and verifies the draft's status, authored body, and complete required asset set. It is read-only and deliberately fails on an already-published release, because it is the gate that runs before publication.
- Publishing the GitHub release verifies its Snap assets and automatically uploads them to `edge`; installed-Snap smoke and candidate/stable promotion remain manual.
- Release-post screenshots come only from the release capture script running against the mock servers. Never add a screenshot taken from a real playlist or account to `apps/website/public/blog/**` — real streams, logos, and metadata are copyrighted, and credentials must never reach a published image.
- Final task summaries should state whether a release note was added or why it was skipped.

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
- The app holds a single-instance lock (`acquireSingleInstanceLock` in `apps/electron-backend/src/app/services/single-instance.ts`): a second launch against the same `userData` quits immediately and focuses the running window. To attach a second CDP-enabled instance to the same profile, set `IPTVNATOR_ALLOW_MULTIPLE_INSTANCES=1` — knowing that only one of the two processes will own the renderer's IndexedDB, so settings written by the other are lost. Before focusing, the guard forwards the second launch's argv to `onSecondInstance`, which is how a playlist path handed to an already-running app reaches the open queue.

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
    - `IPTVNATOR_PERF_CAPTURE=1` enables development/test-only, redacted M3U and Xtream preload IPC request/completion markers plus count-only M3U acquire/parse/normalize, Xtream main network/JSON-transform/success-response-ready/cancel-dispatch, and renderer store phase capture; renderer wrappers emit only while the benchmark installs its Symbol hook, benchmark tooling sets the flag explicitly, and production launches must leave it unset
    - `IPTVNATOR_PERF_WORKER_PROFILING=1` enables development/test-only, request-scoped worker receive/work/response-post timestamps, thread CPU, event-loop utilization/delay, count-only playlist serialization/SQLite write/read/deserialization plus Xtream category/content/cache-clear/delete/in-source-search phase events, profiling-only worker cancel-receipt acknowledgements, valid-sample-counted isolate peak memory, and the database worker's idle-only one-shot post-GC heap probe; overlapping database requests are explicitly invalidated instead of misattributed, the performance benchmark sets the flag automatically, and production launches must leave it unset

- Settings, portal request/response, and trace payloads must use
  `@iptvnator/shared/logging` or the redacting portal logger before reaching
  `console.*`; never log raw credentials while debugging.

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
- The subtitle menu carries capability-gated advanced subtitle support
  (#1408): external subtitle file loading, a ±0.5 s timing-offset row, and
  size/color styling persisted in the shared `subtitleStyle` localStorage key.
  HTML5/ArtPlayer implement it through the neutral source bridge (`.srt`/`.vtt`
  via a DOM file picker with encoding detection, native `TextTrack` rendering,
  `::cue` styling, delay only while the loaded file is the selected track;
  picks are source-generation-guarded and engine deselection precedes external
  track activation). The canonical style shape and clamp/normalize rules are
  shared with the main process via `@iptvnator/shared/interfaces`
  (`subtitle-style.util.ts`). Embedded MPV frame-copy implements it through
  helper protocol commands (`sub-add`/`sub-delay`/`sub-scale`/`sub-color`,
  main-process file dialog, ASS supported, delay for all tracks). Video.js
  shared mode, vendor-chrome paths, native-view, and the Linux out-of-process
  path advertise no such capability and render no UI. Contract details:
  `docs/architecture/player-controls-contract.md` ("Advanced subtitle
  support").
- In fullscreen, `app-player-controls` shows a pointer-transparent media-title
  overlay at the top while controls are revealed (`mediaTitle` input:
  movie/channel/series name, plus an `S01E03` second line for episodes). Series
  names flow from the Xtream/Stalker detail views through
  `PortalInlinePlayerComponent.seriesTitle` and `WebPlayerViewComponent.mediaTitle`;
  movie and live hosts fall back to `playback.title`, skipping raw stream-URL
  fallbacks. Outside fullscreen the overlay stays hidden.
- Auto-hide pauses while the pointer is over the controls bar or keyboard
  focus is inside it, but only keyboard-originated focus pins the bar open.
  Chromium also focuses a clicked `<button>`, so
  `ControlsSurface.wasPointerInteraction` attributes a `focusin` to a recent
  `pointerdown` inside the focused element; such focus reveals without
  blocking auto-hide (otherwise the fullscreen button left the controls on
  screen until a click-to-pause on the viewport). The press record is
  discarded on the first bar focus event it is asked about or on any
  `keydown`, a `pointerdown` inside the bar releases a keyboard pin, and a
  `keydown` bubbling out of a bar control re-pins it, since operating a
  focused control produces no focus event. A completed pointer click then
  releases the focus it left on the control (`onBarClick` →
  `ControlsSurface.releasePointerFocus`, attributed by `wasPointerClick`:
  non-empty click `pointerType`, else a recent press inside the clicked
  element), because a focused control captures the keyboard: Space and
  Enter re-activated the clicked button and `ControlsShortcuts` yields to
  any interactive element in the key's path, so after a click on fullscreen
  Space left fullscreen instead of pausing. Keyboard activation (empty
  `pointerType`) keeps focus, only buttons and range sliders are released,
  Chromium keeps its sequential-focus starting point at the blurred control
  so Tab continues from it, and the volume popover ignores the release's
  `focusout` (`wasPointerFocusRelease`). Contract:
  `docs/architecture/player-controls-contract.md` (auto-hide paragraph).
- Persisted `Settings.webPlayerSharedControls` is default-ON (absent stored
  values coerce with `!== false`; only an explicit false opts out to the legacy
  vendor chrome), and its checkbox appears only when HTML5, Video.js, or
  ArtPlayer is selected.
  `WebPlayerViewComponent` snapshots the preference into
  `WEB_PLAYER_SHARED_CONTROLS` for each new player host. The parent `/workspace`
  route awaits the initial `SettingsStore` load, including cold-start direct
  links, before this snapshot can occur. Saving applies to the next host without
  an application restart; an existing session never changes controls mode in
  place.
- `Settings.showCaptions` is deliberately outside this rollout gate: it is
  engine state, not controls UI. HTML5, Video.js, and ArtPlayer apply it in both
  modes — shared controls through their controls bridge, the preference-off
  paths through the same helpers without an adapter (`WebVideoSourceTracks` for
  HTML5/ArtPlayer, `VjsLegacyTracks` for Video.js). Both re-apply the preference
  as the engine adds or switches text tracks. `WebPlayerViewComponent` reads it
  from `SettingsStore` rather than a host input, so the M3U player, the
  Xtream/Stalker live layouts, and the portal detail inline player all inherit
  it (#1155).
- The modes differ in how long the preference is enforced. Shared controls are
  authoritative for the session; user intent arrives through `setSubtitleTrack`
  and wins until the source changes. Vendor chrome is source-default: the
  preference seeds each new source and is released once the media element
  reports `playing`, so the engine's own caption menu keeps working. The mode is
  selected by the optional `playbackStarted` probe the legacy owners pass to all
  three helpers (HLS, native text tracks, Shaka); in that mode the HLS helper
  deselects the track (`subtitleTrack = -1`) instead of hiding it, because
  `subtitleDisplay` would silently override whatever the vendor menu picks. For
  DASH the seed happens in `ShakaVideoSession.start()` after the manifest loads,
  so the helper only stops re-suppressing afterwards.
- Shared controls include a per-session quality menu (Auto + "1080p"-style
  levels via `setQualityLevel`; `AUTO_QUALITY_LEVEL_ID` restores ABR). The
  capability derives from the manifest — advertised only when the source
  exposes >1 video rendition (multi-variant HLS via hls.js
  `nextLevel`/`manualLevel`, DASH via Shaka variant tracks pinned to the
  active variant's exact audio stream (`audioId`, language fallback) with ABR
  toggled off for manual picks, Video.js via videojs-contrib-quality-levels) —
  so single-bitrate VOD and raw MPEG-TS never show it, nothing persists to
  Settings, and Embedded MPV/external players report the capability false.
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
- DASH (`.mpd`) sources play through a lazily imported Shaka Player source
  engine (`libs/ui/playback/src/lib/shaka-engine/`) inside the HTML5 and
  ArtPlayer components; ClearKey keys come from KODIPROP-derived
  `Channel.drm`, and the shared bridge exposes Shaka audio/text tracks via
  source kind `shaka`. The DOM-free Shaka `5.2.4` diagnostic boundary lives in
  `libs/playback/util`; it version-locks public severity/category/code evidence,
  ignores recoverable error events,
  treats rejected loads as terminal lifecycle outcomes, preserves exact public
  DASH text-parser category/code evidence with unknown stage/failure, and never
  retains or renders raw messages or `error.data`. A failed browser-support
  preflight stays generic-unknown but carries the exact app-owned
  `PlaybackRuntimeSupport.ShakaBrowserUnsupported` marker, preserving managed
  external fallback only for clear transferable DASH; PWA capability and
  KODIPROP DRM still suppress it. See the CLAUDE.md "Video Players" feature
  entry and the "DASH + ClearKey Playback" section of
  `docs/architecture/m3u-playlist-module.md`.
- mpegts.js `1.8.1` errors from HTML5, Video.js, and ArtPlayer cross one
  version-locked structured evidence boundary in `libs/playback/util`. Only
  exact public type/detail pairs, pair-derived stage/failure, terminal
  disposition, and the validated HTTP 4xx/5xx status slot are retained; raw
  messages and arbitrary `info`
  never reach diagnostics. This is a sibling of `PlayerController`, not part
  of the controls contract.
- Browser playback diagnostics and recovery policy live in
  `libs/playback/util` and are exported by `@iptvnator/playback/util`.
  Public engine errors cross allowlisted sanitizers into a
  `PlaybackDiagnostic`; `recommendPlaybackRecovery(context)` then ranks at
  most three actions, and `WebPlayerViewComponent` executes only the action
  the user selects. The policy is a sibling of `PlayerController`; shared
  controls only gate interaction while the diagnostic panel is visible.
  `WebPlayerViewComponent` owns a host-derived content-session key that is
  stable for the mounted logical selection, attempted target IDs, the temporary
  player override, and VOD handoff position. Its `PlaybackBinding` is exactly
  `{ generation, target }`, while every source/target/reload application uses a
  fieldless opaque `Symbol` token. Diagnostic storage uses a separate fieldless
  intent `Symbol`, and source applications advance a third fieldless revision
  `Symbol` that clears only the VOD handoff position; target-only switches and
  Retry leave that revision stable. None of these ownership primitives contains
  URLs, headers, DRM material, or credentials. The application effect
  synchronizes the content session before tracking intent, so clearing a
  temporary player override cannot schedule a duplicate application or header
  handoff. Every application start clears both the diagnostic owner and backing
  signal before asynchronous header setup; a current false result or rejection
  leaves them clear, and a stale completion cannot erase a newer owned
  diagnostic. Each
  rendered web or Embedded MPV application captures its nullable binding, the
  application and source-revision tokens, and live/VOD flag; a time update
  changes resume state only while that exact capture still owns the current
  application. A recommended built-in
  player temporarily
  outranks the host override and saved player for that mounted content session,
  never mutates `Settings.player`, and resumes finite VOD position on a
  best-effort basis; live playback returns to the live edge. Retry and
  alternative sources preserve attempts, while a different content-session key
  or component teardown resets them. Recovery recommendations never
  auto-switch, persist history, learn across sessions, or emit telemetry.
  The policy projects attempted inline target IDs through the validated
  canonical source/target capabilities and excludes every attempted engine
  family, so HTML5 and ArtPlayer are not separate hls.js recoveries. Network
  and generic unknown evidence fail closed to Retry/alternative source; the
  exact Shaka browser-unsupported preflight marker is the sole unknown-code
  exception. PWA capability suppresses managed MPV/VLC, and ClearKey/KODIPROP
  DRM suppresses external targets because its payload is not transferable. Raw
  engine messages, arbitrary data, and credentials never enter recommendation
  evidence or ownership state. MPV/VLC actions remain mounted after an attempt
  and expose credential-free per-target launching/started/playing/error state;
  only an exact Electron `playing` update is labelled Playing. One handshake is
  allowed at a time. The renderer claims the credential-free content identity
  before awaiting Electron, so primary Play is disabled and a launching or
  closable-error alternative remains owned before the controller commits it.
  Every route action that can start the same external playback, including
  Restart and the provider-source shortcut, observes that local pre-IPC guard.
  The Xtream VOD diagnostic-fallback handler records the same route-scoped
  destination and pending generation before invoking MPV/VLC, so route reuse
  cannot orphan that process outside the next route's close-before-play path.
  Its fieldless intent is bound to the exact session returned
  by the source owner's launch promise, so a late timed-out attempt cannot take
  over a retry; later global updates must match that ID. A replacement waits for
  confirmed teardown of the tracked external process, applies the old exact
  close before launch, and cancels an unlaunched handoff if diagnostic ownership
  changes. Process teardown has bounded graceful and forced confirmation
  windows, and reusable MPV bounds the IPC command that precedes them; if any
  stage cannot reach a confirmed exit, the exact session stays live and the
  replacement fails closed instead of overlapping it. A process-wide teardown
  gate starts before any potentially slow teardown preparation, including VLC
  position flush and a reused player's protocol quit, and rejects every
  MPV/VLC spawn until that exact child reports exit. If bounded
  teardown fails while a fresh launch is still pending, that launch IPC rejects
  and the exact session remains a closable error instead of hanging forever.
  If a pre-content reuse failure has no still-live displaced session to restore,
  the replacement error keeps its attached closer so Stop can retry the orphaned
  child teardown. A terminal error without a closer is never restorable.
  A failed close is single-flight only while its promise is pending: Stop can
  retry the same exact child after a bounded confirmation failure. Reuse maps
  the child to its current content session, so a stale older closer becomes a
  no-op instead of terminating a newer `loadfile`/VLC enqueue handoff.
  A duplicate close for an already closed session returns its terminal snapshot
  without re-entering the saved closer, and a late process error cannot revive
  that terminal session. Reused MPV commands are bound to the socket captured
  for that exact child, so a later process cannot inherit a stale protocol quit.
  Stop observed before a pending MPV content command or VLC enqueue command
  prevents that command from dispatching. A source handoff fails closed while
  a live session has no closer (`canClose: false`); renderer Dismiss is not
  teardown confirmation. That denied handoff advances neither the multi-source
  switch token nor the playback generation, so it cannot cancel the sole launch
  already in flight.
  VLC rechecks the gate at each concrete spawn after port allocation or reuse
  work; if a post-start fallback is blocked there, the opened session becomes
  an error rather than retaining a false started status. A failed RC-port
  allocation never claims reuse ownership, so the fallback VLC child retains
  its exact one-shot closer.
  Reuse failures before a content command restore the globally displaced
  renderer session, not the reusable process's prior owner, and only while the
  exact displaced-session ID is still active; after
  `loadfile`/VLC `clear` is dispatched,
  the replacement owns the process and remains a closable error instead of
  restoring stale content metadata. Stop during an in-flight MPV or VLC reuse
  command, including during failed-command teardown or the subsequent VLC
  fallback port-allocation wait, settles that exact close without falling
  through to a fresh spawn;
  a stopped VLC spawn error that reports only `close` also settles its original
  launch IPC with the exact closed session;
  a fresh fallback retires the old child's exit under its prior session so it
  cannot close the replacement. Source handoffs recheck ownership after launch
  and accept only `opened`/`playing`; a stale returned session is closed exactly
  and a Stop-returned `closed` session is never committed. If that exact stale
  close fails, its credential-free destination owner is retained for the next
  close attempt. Retained destination ownership is scoped to the initiating
  playlist/VOD route key, so route reuse cannot expose Stop for the previous
  movie's external session. Play/Resume capture that route key before awaiting
  close and cancel if navigation changes it; a late diagnostic fallback closes
  its exact returned session instead of adopting it on the new route. They
  supersede an older source resolution before awaiting the shared
  close-before-replacement path, and accepting a diagnostic fallback retires
  the same older resolution before opening MPV/VLC. They publish the route-source
  badge, caption evidence, and position only after start succeeds.
  Closable errors still participate in every replacement close and keep Stop as
  the global dock's only teardown affordance; Dismiss is reserved for terminal
  errors that have no closer. The shared `isLiveExternalPlayerSession` predicate
  keeps M3U and series ownership while
  such an error can still be stopped; consumers must not treat every `error`
  status as terminal.
  If the local handshake times out after an exact Electron session is known,
  that ID remains
  correlated so a later exact update can recover the UI. The global dock mirrors
  those statuses, keeps closable errors visible until Stop confirms teardown and
  terminal errors visible until dismissal, and intentionally has no retry because
  it does not own the original launch headers or credentials.
- The built-in HTML5/hls.js player is the second guarded consumer.
  `HtmlVideoPlayerComponent` provides a component-scoped
  `WebVideoControlsAdapter`; its neutral `web-video-support` bridge is shared
  with ArtPlayer and owns HLS/Shaka(DASH)/native tracks, MPEG-TS VOD duration correction,
  caption preference, and source cleanup.
  `HtmlVideoElementSession` owns native video-event lifecycle, persisted
  volume, start-time/time/ended propagation, and legacy post-play caption
  suppression.
  `WebPlayerViewComponent.resolvedIsLive` supplies authoritative live/VOD
  metadata, while a visible playback diagnostic disables both shared surface
  interaction and shortcuts and exits the shared controls' resolved fullscreen
  owner (the host-supplied `fullscreenTarget`, else the HTML5 shell) so the
  diagnostic actions remain visible. The preference-off path keeps native
  controls and legacy series navigation unchanged, while the playback keyboard
  shortcuts (Space/K, F, arrow seek/volume, M) attach through
  `LegacyPlayerShortcuts` with commands acting on the native video element
  (`html-video-legacy-shortcuts.ts`); seek requires authoritative VOD metadata
  plus a finite positive duration, and a visible diagnostic disables the keys.
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
  path keeps the existing Video.js skin and legacy series navigation unchanged
  (still without `userActions.hotkeys`), while the playback keyboard shortcuts
  attach through `LegacyPlayerShortcuts` and drive the player API so the
  vendor control bar stays in sync (`vjs-legacy-shortcuts.ts`). That chrome
  also releases the focus a pointer interaction leaves on a control
  (`vjs-pointer-focus-release.ts`, sharing `pointer-focus-release.ts`'s
  `blurFocusedControl` with `ControlsSurface`): a focused Video.js component
  stops every key before the document and turns Space/Enter into a click, so
  after a click on fullscreen Space left fullscreen instead of pausing. It is
  driven mainly by `focusin`, not the click, because choosing a menu item
  moves focus to the menu button a tick later and that click never bubbles to
  the shell: an eligible control (button/`role=button`/slider, never a menu
  item) is released when its focus is attributable to a recent shell
  `pointerdown` not yet ended by a document `keydown`, so `Tab` focus is kept.
  A `click` runs the same release for a control clicked while already focused
  (Tab, then a mouse click), which fires no `focusin`. The release is scoped
  to `.vjs-control-bar`, so the caption-settings dialog (a modal sibling of
  the bar) keeps its focus trap. Menu buttons live in the bar and are not
  exempt: a popup is navigated through its focused item, so releasing the
  button never disturbs an open menu, and the button focus a pointer moves
  through (open, item selection, toggling an open menu shut) is released so
  Space works again after the menu closes. ArtPlayer
  (non-focusable divs) and the native HTML5 controls (focus lands on the
  `<video>`) need no counterpart.
- ArtPlayer is the fourth guarded consumer. `ArtPlayerComponent` provides a
  component-scoped `WebVideoControlsAdapter`; `ArtPlayerSourceSession` owns
  HLS/DASH(Shaka)/MPEG-TS/native sources, the neutral web-video bridge, exact cleanup, and
  a destroyed-session guard for delayed `customType` callbacks, while
  `ArtPlayerVideoSession` owns native media/ArtPlayer events. Shared mode uses
  authoritative live/VOD metadata, HLS/Shaka/native tracks and caption preference,
  MPEG-TS VOD duration correction, and reapplies app volume directly after
  ArtPlayer restores its own stored volume. Vendor chrome/hotkeys are disabled,
  and a transparent capture layer gives shared controls exclusive click and
  double-click ownership. Diagnostic interaction gating and owned-fullscreen
  exit match the other web players. The preference-off path keeps the legacy
  ArtPlayer skin, source behavior, and series navigation unchanged, while the
  playback keyboard shortcuts attach through `LegacyPlayerShortcuts` using the
  vendor setters ArtPlayer's own hotkeys used
  (`art-player-legacy-shortcuts.ts`); the legacy chrome passes `hotkey: false`
  because ArtPlayer's focus-scoped hotkeys ignore `defaultPrevented` and would
  double-handle every key, and the wiring restores its Escape-exits-web-
  fullscreen behavior.
- Shared web picture-in-picture stays inside that default-on rollout.
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

## Display Sleep During Playback

- `PlaybackKeepAwakeService`
  (`apps/web/src/app/services/playback-keep-awake.service.ts`) watches every
  `<video>` via document-level capture listeners (media events don't bubble;
  release listeners sit on the tracked element because Chromium's
  removed-from-DOM pause never reaches the document) and, while any video is
  playing and the document is visible (or the playing video is in
  picture-in-picture — the PiP surface survives a minimized window), holds a
  display-sleep lock.
- Electron: a main-process `powerSaveBlocker` behind
  `window.electron.setPlaybackKeepAwake`
  (`apps/electron-backend/src/app/services/playback-keep-awake.service.ts`);
  the renderer's vote is auto-cleared on renderer reload, crash
  (`render-process-gone`), or destruction. PWA: the Screen Wake Lock API,
  re-requested after browser auto-release; state changes masked by an
  in-flight `request()` queue one re-evaluation on rejection.
- Radio's `<audio>` deliberately never blocks display sleep. Embedded MPV
  holds its own blocker in `EmbeddedMpvNativeService`; external MPV/VLC
  inhibit the screensaver themselves.

## Windows Embedded MPV Pin Maintenance

- PR, master, and tag builds resolve the Windows runtime only from
  `tools/embedded-mpv/windows-runtime-pin.json`; repository variables are not
  build inputs.
- Validate the checked-in schema and provenance with
  `pnpm embedded-mpv:windows-runtime-pin:check`.
- Prepare a manual rotation with
  `pnpm embedded-mpv:windows-runtime-pin:refresh -- --force`. The weekly
  `refresh-windows-embedded-mpv-runtime.yaml` workflow runs the same updater
  and opens a reviewable PR before upstream retention expires.
- The PAT-backed refresh job must keep every third-party action pinned to a
  full commit. Do not mirror the upstream binary without complete
  corresponding source, build records, license notices, and a validated
  transitive license closure.

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
  prove success. Static artifact verification requires regular
  `desktop-init.sh`, `desktop-common.sh`, and `desktop-gnome-specific.sh`
  files at the Snap root, with `desktop-init.sh` executable. The helper links
  `libGL.so.1` rather than `libOpenGL.so.0`.
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

- `.codex/skills/iptvnator-nx-architecture/SKILL.md`
- `.codex/skills/iptvnator-sqlite-db-worker/SKILL.md`
- `.codex/skills/iptvnator-theme-style/SKILL.md`
- `.codex/skills/iptvnator-ui-design/SKILL.md`
- `.codex/skills/release-cut/SKILL.md`
- `.codex/skills/release-notes/SKILL.md`
- `.codex/skills/stalker-portal/SKILL.md`
- `.codex/skills/xtream-electron/SKILL.md`

Descriptions and trigger conditions are canonical in each skill's frontmatter;
do not duplicate them here.

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
