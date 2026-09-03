# Workspace Shell

This document records the current workspace-first shell contract. It is the
stable replacement for the older UI refactor summary.

Related:

- [Workspace Dashboard](./workspace-dashboard.md)

## Summary

- `/workspace` is the primary app surface.
- `WorkspaceShellComponent` owns the persistent frame: rail, header, optional
  context panel, content outlet, and external playback footer.
- Descendant workspace pages inherit `layout = 'workspace'` from the
  `/workspace` root route.
- Provider route trees now bootstrap through route-scoped session providers
  instead of nested provider shell components.

Core implementation:

1. `apps/web/src/app/app.routes.ts`
2. `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.ts`
3. `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.html`
4. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell.facade.ts`
5. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell-route-state.service.ts`
6. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell-search.service.ts`
7. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell-search-sync.service.ts`
8. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell-header.service.ts`
9. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell-command-palette.service.ts`
10. `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell-xtream-import.service.ts`
11. `libs/portal/shared/util/src/lib/navigation/portal-route.utils.ts`
12. `libs/portal/shared/util/src/lib/navigation/portal-rail-links.ts`
13. `libs/portal/shared/ui/src/lib/navigation/portal-rail-links.component.ts`

## Route Contract

Current workspace routes:

1. `/` -> `/workspace`
2. `/workspace` -> functional redirect `workspaceEntryRedirect`
   (`WorkspaceStartupPreferencesService.resolveInitialWorkspacePath()`;
   `/workspace/dashboard` by default, `/workspace/sources` when the dashboard
   is disabled, or the last restorable route under
   `StartupBehavior.RestoreLastView` — `dashboard` itself is guarded by
   `dashboardAccessGuard`)
3. `/workspace/dashboard`
4. `/workspace/sources`
5. `/workspace/playlists/:id/:view` (plus `favorites` and `recent` siblings)
6. `/workspace/global-favorites`
7. `/workspace/global-recent`
8. `/workspace/search`
9. `/workspace/downloads`
10. `/workspace/settings/:section` (`/workspace/settings` redirects to
    `general`; the settings context panel links each section page)
11. `/workspace/xtreams/:id/...`
12. `/workspace/stalker/:id/...`

Compatibility redirect:

1. `/settings` -> `/workspace/settings`

Provider route integration:

1. `apps/web/src/app/app.routes.ts` marks the `/workspace` root route with
   `data.layout = 'workspace'`.
2. `isWorkspaceLayoutRoute(...)` treats that layout marker as inherited route
   state for all descendants.
3. Xtream and Stalker parent routes attach route-scoped session providers that
   bootstrap the active playlist, sync provider section state, and clean up
   provider-local state when the route is destroyed.
4. Xtream route bootstrap is DB-first for already imported Electron playlists:
   if the requested section has persisted categories and content, the route
   hydrates from SQLite even when the portal status probe reports unavailable,
   expired, or inactive. Fresh/no-cache Xtream routes still use the status probe
   to block remote imports before the loading overlay starts.
5. Workspace routes no longer rely on nested provider shell components for
   hidden local chrome.

## Shell Structure

The shell is intentionally split into four persistent regions:

1. Left rail:
    1. Static workspace links for dashboard, sources, global favorites, and
       recently viewed. The routed global-search rail link is Electron-only
       because its data source is the SQLite worker bridge.
    2. Provider-aware context links derived from the active or current playlist.
    3. Settings remains a persistent footer shortcut in the rail.
2. Top header:
    1. Playlist switcher.
    2. Route-aware search input and command palette trigger.
    3. Add source action.
    4. Optional playlist refresh and route-specific shortcut actions.
    5. Downloads shortcut in Electron.
3. Main body:
    1. Optional left context panel.
    2. Main router outlet content.
4. Optional footer:
    1. External playback session bar when a docked session is visible.

`WorkspaceShellComponent` binds only to `WorkspaceShellFacade`. The facade is
kept as a thin template-facing API and delegates ownership to component-scoped
services:

1. `WorkspaceShellRouteStateService` owns current route parsing, rail links,
   context-panel state, dashboard startup preference, and playlist source
   signals.
2. `WorkspaceShellSearchService` owns the route-aware header search capability
   and public search actions.
3. `WorkspaceShellSearchSyncService` owns the search query signals, debounced
   application, provider-store synchronization, and query-param sync.
4. `WorkspaceShellHeaderService` owns playlist title/subtitle, account/info
   actions, refresh action state, and recent-items bulk cleanup.
5. `WorkspaceShellCommandPaletteService` owns command-palette dialog lifecycle
   and recent-command recording.
6. `WorkspaceShellXtreamImportService` owns Xtream import/refresh overlay
   state and labels.

When adding shell behavior, prefer placing it in the service that owns the
nearest existing state. Keep `WorkspaceShellFacade` as a stable re-export layer
for the template unless the template contract itself intentionally changes.

## Context Panel Rules

The shell decides which secondary panel to show from the current route:

1. `/workspace/sources`
    1. `WorkspaceSourcesFiltersPanelComponent`
2. Xtream category sections (`live`, `vod`, `series`)
    1. `WorkspaceContextPanelComponent`
3. Stalker category sections (`itv`, `radio`, `vod`, `series`)
    1. `WorkspaceContextPanelComponent`
4. `/workspace/settings/:section`
    1. `WorkspaceSettingsContextPanelComponent`
5. Downloads sections
    1. `WorkspaceCollectionContextPanelComponent`

The context panel is part of the shell contract. New workspace-level routes
should explicitly decide whether they need one rather than adding local
sidebars inside feature pages.

Xtream and Stalker category panels preserve provider/server category order by
default. The panel header exposes a sort menu next to category search with
`Server sorting`, `A-Z`, and `Z-A`; when alphabetical sorting is active,
synthetic "all categories" entries stay pinned before sorted provider
categories.

## Search And Navigation Rules

Search is shell-owned and route-aware:

1. Disabled on settings routes.
2. Enabled on sources routes.
3. Enabled for `/workspace/search`, which is the Electron-only routed
   global-search view. `Ctrl/Cmd+F` in Electron opens this route and
   focuses/selects the header search input instead of opening a fullscreen
   dialog.
4. Enabled for supported Xtream and Stalker content/search views.
5. Placeholder text and search handling vary by provider and section.
6. Input changes are debounced before route/store updates are applied.
7. Global search uses the header input as its primary input and writes the
   search phrase to the `q` query parameter, so history/back-forward behavior
   matches the rest of the workspace.
8. The URL is authoritative for the search box only when it carries search
   intent. `WorkspaceShellSearchSyncService` re-reads `q` on every
   `NavigationEnd`, but an **app-initiated** navigation that stays on the same
   page and carries the term already applied is always ignored — whether or
   not a debounce is still pending. Otherwise a page writing an unrelated
   query param (a downloads filter chip, a refresh bump) or the router echoing
   back our own trimmed `q` would reset the box to the applied term, eating
   everything typed since: the whole word while the first keystroke is still
   debouncing, or a just-typed trailing space once the debounce has fired
   ("Bein " would snap to "Bein" and typing on would yield "BeinSports").
   Applied terms are always stored trimmed (`applySearchQuery` and
   `setSearchState` both trim), so the echoed `q` compares directly; the box
   keeps exactly what the user typed. Pages are free to write their own query
   params while the user types; they must not assume the shell will re-apply
   the search afterwards.
9. Browser history overrides that guard. The exemption is keyed on
   `Navigation.trigger === 'imperative'`, so back/forward always re-applies
   what the history entry carries, even mid-typing.
10. Applying a term explicitly supersedes a queued one. `applySearchQuery()`
    cancels any pending debounce, so the Enter key committing a trimmed term
    cannot be overwritten a moment later by the untrimmed keystroke still
    waiting behind it.

Rail navigation is also shell-owned:

1. Workspace-global entries are static.
2. Provider entries come from `buildPortalRailLinks(...)`.
3. On dashboard, sources, settings, global search, global favorites, and global
   recent, the shell falls back to the currently selected playlist so provider
   navigation remains available even outside a provider route.

Command palette behavior is shell-owned but view-extensible:

1. The shell resolves commands into three groups in fixed order: current view,
   this playlist, then global.
2. Shell-owned commands are derived from route context and current playlist
   state; empty groups are omitted instead of rendering disabled placeholders.
3. Workspace features contribute current-view commands through
   `WorkspaceViewCommandService`.
4. Header shortcut actions can opt into palette exposure by attaching palette
   metadata through `WorkspaceHeaderContextService`.
5. Filtering matches command labels, descriptions, and keywords, and keyboard
   selection always lands on the first enabled command.
6. A "Recently used" section is rendered above the standard groups when the
   query is empty and at least one stored id resolves to a visible+enabled
   command; ids are persisted via `RecentCommandsService` (capped at 5,
   stored at `STORE_KEY.RecentCommands`). Storage is **not** pruned by route
   visibility — a navigation command like `Open sources` is invisible while
   the user is on `/workspace/sources` but the id stays in storage so it
   reappears in the recent section after navigating away.
7. Six "Switch player to X" commands are registered globally by
   `WorkspacePlayerCommandsContributor` (VideoJS, HTML5, ArtPlayer, Embedded
   MPV, MPV, VLC). Each command carries a `requires` flag gating its
   visibility: the MPV/VLC ("managed-external") entries are visible only when
   `RuntimeCapabilitiesService.supportsManagedExternalPlayers` is true, and the
   Embedded MPV ("embedded-mpv") entry is visible only after the command
   palette lazily preloads an async `window.electron.getEmbeddedMpvSupport()`
   check and it resolves to `supported` (mirroring the Settings dropdown gate).
   Do not run this Embedded MPV support check from workspace shell bootstrap:
   supported desktop builds may load the native addon while resolving
   capabilities. The entry matching the current `SettingsStore.player()` value
   is disabled. The new player setting applies to the next playback session; an
   existing stream is not re-mounted.

Keyboard shortcut help is shell-owned:

1. `WorkspaceKeyboardShortcutsService` is provided by `WorkspaceShellComponent`.
   It owns the workspace-scoped `document:keydown` listener for `?` /
   `Shift+/`.
2. The listener ignores events from inputs, textareas, selects, and
   content-editable elements via `isTypingInInput(...)`.
3. `libs/portal/shared/util/src/lib/keyboard-shortcut-definitions.ts` is the
   metadata registry for shortcuts shown in the help dialog and documented in
   README. `keyboard-shortcuts.ts` owns the display transformation and help
   trigger detection.
   Shortcuts that only work through the Electron bridge, such as embedded MPV
   controls, must set `electronOnly: true` so the PWA dialog does not advertise
   unavailable commands.
4. New custom shortcuts should be added to that registry when the handler is
   added. Do not include native browser/editor behavior such as `Tab` or
   platform text editing shortcuts.

## Window Chrome And Custom Title Bar

The Electron window hides the native title bar on all desktop platforms
(`titleBarStyle: 'hidden'` in `apps/electron-backend/src/app/app.ts`):

1. macOS keeps the native traffic lights (`titleBarOverlay: true`,
   `trafficLightPosition`); the renderer draws no window buttons.
2. Windows and Linux use renderer-drawn window controls
   (`app-window-controls`, `libs/ui/components/src/lib/window-controls/`).
   `frame` is intentionally left untouched so native resize borders and
   window snapping keep working.

The controls are mounted once in `app-root` (not inside the workspace
header) as a `position: fixed` top-right overlay so they stay clickable
above full-window content such as the multi-EPG cdk overlay and Material
dialog backdrops — the same behavior as the macOS traffic lights. Because
CDK overlays render as popovers in the browser top layer (above any
z-index), the component host is itself a `popover="manual"` element: it
enters the top layer on init and re-enters it (hide + show) whenever
another popover opens, so the controls always paint last. The
`z-index: 10000` remains only as a fallback when the popover API is
unavailable. They render only when
`RuntimeCapabilitiesService.usesCustomWindowControls` is true (Windows/Linux
Electron with the window-control bridge methods available); the PWA and
macOS never mount them.

IPC contract (constants in `libs/shared/interfaces/src/lib/ipc-commands.ts`,
handlers in `apps/electron-backend/src/app/events/window.events.ts`):

1. `WINDOW:MINIMIZE`, `WINDOW:TOGGLE_MAXIMIZE`, `WINDOW:CLOSE`,
   `WINDOW:GET_STATE` are `ipcMain.handle` channels resolved from the sender
   WebContents. Close goes through `win.close()` so the existing
   window-bounds persistence in `app.ts` still runs.
2. `WINDOW:STATE_CHANGED` is pushed main → renderer on
   maximize/unmaximize and on the fullscreen events —
   `enter/leave-full-screen` plus the `enter/leave-html-full-screen`
   variants emitted for HTML-element fullscreen (video player
   fullscreen) — so the maximize/restore glyph stays correct for
   externally triggered changes (double-click on a drag region, OS
   snap, F11). The controls hide themselves while the window is
   fullscreen.

   Window state is **never re-read at event time**. `attachWindowStateEvents`
   seeds `{ isMaximized, isFullScreen }` once at window creation and each
   event patches only the flag it names; every push carries a copy of that
   tracked state. On Windows both getters can still report the
   pre-transition value while the matching event fires — `isFullScreen()`
   stays `true` during an HTML fullscreen exit, and `isMaximized()` reads
   `false` while the window is fullscreen. Because the renderer replaces
   both flags on every push and no later event corrects a stale one,
   polling left the controls hidden forever after leaving fullscreen and
   stuck the maximize/restore glyph on the wrong icon. Regression coverage:
   `app-window-state.spec.ts` and `window-controls.e2e.ts`.

   The pushed `isFullScreen` is the OR of two flags tracked apart: native
   (OS-level, fed by `enter/leave-full-screen`) and HTML-element (fed by
   the `*-html-*` pair). Electron remembers when the window was already
   natively fullscreen before the player entered HTML fullscreen and then
   leaves ONLY the HTML state on exit — no `leave-full-screen` fires and the
   window stays fullscreen — so a single flag cleared by
   `leave-html-full-screen` would un-hide the controls over a window that
   is still fullscreen. A fullscreen launch (below) or F11 followed by the
   player's `F` → `Esc` makes that path routine on Windows/Linux.
3. `WINDOW:TOGGLE_FULLSCREEN` toggles OS-level fullscreen (`setFullScreen`)
   and, like the maximize toggle, reports the requested state and leaves
   the `WINDOW:STATE_CHANGED` push authoritative. Because the transition is
   asynchronous and `isFullScreen()` reports the old value until it lands,
   every native fullscreen request goes through the transition tracker in
   `apps/electron-backend/src/app/services/native-fullscreen-transitions.ts`
   — the F11 toggle AND the startup fallback below — which keeps the
   pending target per window and decides the next toggle against it: two
   quick presses are an enter-then-exit, not two enters, and F11 during the
   startup animation leaves fullscreen instead of asking for it again. The
   entry can never govern F11 for good: it is dropped once a
   transition event reports the target state, a transition landing on the
   other state re-issues the target (the platform may have dropped the
   queued request), and an entry older than
   `FULLSCREEN_TRANSITION_TIMEOUT_MS` (2 s) is ignored, so a request that
   produced no event at all is forgotten. The renderer binds it to
   **F11** in `WorkspaceKeyboardShortcutsService` (deliberately not gated
   by `isTypingInInput` — it must work from any focus, because it is the
   only exit from a fullscreen launch on Windows/Linux, where the title bar
   is hidden and the controls hide themselves) and skips the key while
   `document.fullscreenElement` is set, since the player's own `F` / `Esc`
   own HTML fullscreen and F11 must not yank OS fullscreen out from under
   it. Without a bridge (PWA) F11 is left to the browser.

Startup window mode (`Settings.startupWindowMode`, issue #1455):

1. `normal` (default) / `maximized` / `fullscreen`, chosen in Settings →
   General ("Window on startup"). Electron only — the select renders only
   when `RuntimeCapabilitiesService.supportsStartupWindowMode` sees both
   `updateSettings` and `toggleFullScreenWindow` on the bridge, so the mode
   is never offered without its F11 exit.
2. Settings live in the renderer's IndexedDB, which the main process cannot
   read at window creation, so the `SETTINGS_UPDATE` handler mirrors the
   value into electron-conf (`STARTUP_WINDOW_MODE`, the same pattern as the
   frame-copy flag) and `initMainWindow` reads it synchronously. A change
   therefore applies on the next launch. Both sides normalize through
   `normalizeStartupWindowMode`, so junk never reaches the config file or
   the window options.
3. `fullscreen` is the `BrowserWindow` constructor option: on Windows/Linux
   the window is created hidden and enters fullscreen before its first
   paint. macOS ignores the option while the window is hidden (an NSWindow
   only toggles fullscreen once it is on screen), so `ready-to-show` repeats
   the request with `setFullScreen(true)` right after `show()` wherever
   `isFullScreen()` is still false — never unconditionally, or the
   platforms that honoured the option would animate a second toggle. The
   saved bounds stay spread into the options — they are the normal bounds
   the window returns to, and the close handler keeps persisting
   `getNormalBounds()`. `maximized` calls `maximize()` inside
   `ready-to-show` right before `show()`, never earlier: `maximize()` on a
   hidden window shows it, and a blank window would flash.
4. `iptvnator --fullscreen` (read via `app.commandLine.hasSwitch`, so it can
   sit anywhere in argv; the playlist-path extractor already skips every
   `-`-prefixed argument) forces `fullscreen` for that launch only and is
   never persisted. Resolution lives in
   `apps/electron-backend/src/app/services/startup-window-mode.ts`. The
   switch is consumed by the first window (`launchFullscreenSwitchConsumed`
   in `App`): on macOS the process outlives its last window and the Dock
   re-creates it through the same `initMainWindow`, which must then follow
   the stored setting only. A second-instance launch carrying the switch is
   ignored — the window already exists.
5. Deliberately not offered: kiosk mode (removes the exit path) and
   "remember last state" (bounds persistence stores normal bounds only; an
   explicit choice is clearer). Regression coverage: `app.spec.ts`
   ("startup window mode"), `settings.events.spec.ts`,
   `window.events.spec.ts`, and the startup-window-mode cases in
   `settings.e2e.ts`.

Layout integration:

1. `document.body` gets a `frameless-platform` class (set in
   `AppComponent`, same mechanism as `dark-theme`) — body-level so rules
   also reach cdk-overlay content rendered outside `app-root`.
2. `apps/web/src/styles.scss` reserves `padding-right: 150px` in
   top-aligned drag regions (`.workspace-header`, multi-EPG
   `#epg-navigation`) for the 3 × 46px button strip.
3. Button colors follow the theme via CSS variables (`--app-on-surface`,
   `--app-hover-overlay`); the close button uses the Windows-style red
   hover (`#e81123`). No theme IPC is involved.

Window decorations on Linux (shadows, corners):

1. Hiding the title bar removes the window manager's decorations, so the
   shadow/rounded corners must come from client-side decorations (CSD).
   Electron 43 enables rounded corners by default when the Linux desktop
   environment supports CSD. GTK drop shadows and extended resize boundaries
   remain environment-dependent; Electron selects native Wayland automatically
   on Wayland sessions.
2. Linux environments without CSD support can still show a square,
   undecorated window. Windows 11 keeps its DWM rounded corners and shadow
   because the standard frame is retained.

Toolchain notes for the Electron 43 baseline:

1. `better-sqlite3` remains pinned exactly so native dependency updates happen
   deliberately with database-worker, packaging, and Electron E2E validation.
   Version 13 uses Node-API and ships its supported platform binaries in the
   package. It must not be listed in pnpm's `onlyBuiltDependencies`: forcing an
   implicit `node-gyp rebuild` bypasses those binaries and makes installation
   depend on the host compiler toolchain. The old `node-abi` override belonged
   to v12's removed `prebuild-install` path and is no longer required.
2. Local development supports **Node 22.13–22.x or Node >= 24**, declared in
   `engines` as `^22.13.0 || >=24.0.0`.
   The direct `@faker-js/faker` dependency and current lint tooling require
   that floor. `electron-builder` 26.15.7 also pulls `@electron/rebuild` 4,
   which requires Node 22.12 or newer, and the root `postinstall` runs
   `install-app-deps` on every `pnpm install`. The 26.15.7 minimum also
   carries the v26 backport that fully extracts the Snap template's `.tar.7z`
   payload; 26.15.0–26.15.6 can
   produce a Snap that is missing `desktop-init.sh`. CI already runs Node 22.
3. Dependabot keeps Electron, native database, packaging, EPG parser, and
   version-locked Shaka/mpegts updates out of the shared npm minor/patch group.
   Those dependencies require standalone PRs so their dedicated package,
   worker, playback, and diagnostic-contract validation cannot be hidden by an
   unrelated grouped update.
4. Electron 42 and newer download their development binary on the first
   Electron command instead of during package `postinstall`, so `electron`
   must not remain in pnpm's `onlyBuiltDependencies` allowlist. The first local
   `pnpm run serve:backend` can include a one-time download; use `pnpm exec
   electron --version` to prewarm it before an offline run.

Known caveats:

1. DIY buttons cannot show the Windows 11 Snap Layouts flyout (only native
   caption buttons or the Window Controls Overlay get that).
2. Double-click-to-maximize on drag regions is handled natively by
   Electron/Chromium; on Linux the exact behavior depends on the window
   manager.

## Maintenance Guidance

Use this document as the source of truth when changing workspace shell behavior.

1. New top-level user destinations should default to child routes under
   `/workspace`.
2. Shared provider navigation logic belongs in portal-shared util/UI libraries,
   not duplicated inside the shell.
3. If a provider route changes how playlist/session bootstrap works, update the
   route-session provider and shell-facing route contract together.
4. When adding a non-native keyboard shortcut, update the shared shortcuts
   registry, the help dialog tests, README, and the closest behavior test.
5. Historical migration notes, cleanup lists, and one-off refactor steps should
   stay out of this file; track them in issues or PR notes instead.
