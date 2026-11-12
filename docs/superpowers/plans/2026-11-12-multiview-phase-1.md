# Multiview Phase 1 (PiP MVP) Implementation Plan

> **For agentic workers:** Execute task-by-task; one task is one commit. Steps
> use checkbox (`- [ ]`) syntax for tracking. Do not start a task before the
> previous one is green. Status: **decisions D1–D11 confirmed on 2026-11-12;
> implementation starts only on the maintainer's go-ahead.**

**Goal:** Ship phase 1 of multiview: a second stream in a picture-in-picture
tile over the built-in web player, with swap, single audio tile, VOD
pause/resume, source picker, error state, channel-list badges and keyboard
shortcuts — in Electron and the PWA. With no session, the app behaves exactly
as it does today.

**Architecture:** A root `MultiviewSessionStore` (pure reducer + signals) owns
tiles, the active tile and the audio tile. A single `MultiviewStageComponent`
in the workspace shell renders one `WebPlayerViewComponent` per tile over the
rect of the player view's anchor. Player views wrap their player slot in a
structural anchor directive: without a session it renders the existing
template untouched; with a session it renders a placeholder and the stage
covers it. All shared code is extended through optional inputs and optional
injection tokens whose defaults reproduce today's behaviour.

**Tech Stack:** Angular signals and standalone components, Nx/Jest, Playwright
(Electron and web), Electron IPC, ngx-translate, existing shared dialog shell
and control kit.

**Design:** `docs/superpowers/specs/2026-11-12-multiview-design.md` (behaviour
contract). Visual reference: Claude Design project "iptvnator", page
"IPTVnator Multiview concept", reviewed as a PDF export on 2026-11-12 (see
"Mockup review" below for what the export shows and what it does not).

---

## Scope guard (spec section 2)

- Only the integration points of spec 11.2 are touched. Every change there is
  an optional input, optional token or optional trailing argument.
- **Parity rule for every task:** existing spec and e2e files are not edited
  to make them pass. If a task needs to change an existing assertion, stop and
  report it — that is a behaviour change, not an implementation detail.
  (Adding new cases to an existing spec file is fine.)
- `apps/tv` and `libs/tv/**` are not touched.
- Phase 2+ items are out: side by side, 2×2, focus 1+3, active ring,
  `Alt+1–4`, slot cards, panel auto-collapse, stage fullscreen (L7),
  mini-player, library entry.

## Findings from the code that shape the plan

1. **Header slot.** The main process keeps one global override and one scoped
   override (`activeScopedHeaderOverride` in
   `request-header-overrides.service.ts`). A scoped call replaces the slot,
   and a scoped call with no headers clears it. Writers of the scoped slot:
   `ElectronStreamHeadersService` (web player, Stalker radio, unified-live
   radio) **and** `libs/m3u-state/src/lib/effects.ts` (direct
   `setUserAgent(..., channel.url)`). `M3uWorkspaceRouteSession` writes the
   global slot; an empty global call clears both.
2. **PWA has no header path.** `apps/web-backend` proxies only API calls
   (`/xtream`, `/stalker`, `/parse`, `/parse-xml`), not media. In the browser
   `ElectronStreamHeadersService.apply()` returns `null` and streams load
   directly. So the spec's "verify the proxy path handles concurrent streams"
   resolves to: nothing to change, covered by a unit test that per-owner
   `apply()` still returns `null` without the bridge.
3. **Controls live inside the engines.** `PlayerControlsComponent` is rendered
   by `html-video-player`, `vjs-player` and `art-player`, not by
   `WebPlayerViewComponent`. Threading new inputs through three engines would
   widen the change, so reduced chrome, external mute/pause and the dock
   action travel through injection tokens that `WebPlayerViewComponent`
   (already a provider of `WEB_PLAYER_SHARED_CONTROLS`) provides for its
   subtree.
4. **Dependency cycle.** The stage renders `WebPlayerViewComponent`
   (`ui-playback`), and `portal-inline-player` (also `ui-playback`) must host
   an anchor. So the anchor cannot live in the same project as the stage.
   `domain:playback` also may not import `domain:xtream` or
   `domain:workspace`, where the Xtream account info, `GlobalFavoritesService`
   and `dashboard-playback.utils.ts` live. Result: three new projects (below)
   and the anchor directive inside `ui-playback`.
5. **Line limits.** `video-player.component.ts`, both live-stream layouts,
   `main.preload.ts` and `electron-api.interface.ts` are on the max-lines
   baseline (may not grow the baseline list, but the files themselves are
   exempt). `web-player-view.component.ts` (448 raw lines),
   `player-controls.component.ts` (433), `unified-live-tab.component.ts`
   (459) and `portal-inline-player.component.ts` (384) are near the 400
   limit: new logic goes into sibling helper files, not into these classes.
6. **i18n drift guard.** `tools/i18n/check-drift.mjs` fails on keys missing
   from any of the 21 locales and on values identical to English. New keys
   ship translated in every locale in the same commit.
7. **Mock server.** `get-account-info.handler.ts` returns fixed
   `active_cons: '1'`, `max_connections: '2'`; refusing a stream needs a new
   scenario switch.

## Mockup review (PDF export)

The export is static. It shows: prototype step 1 (single player with the dock
button), the source picker in the "add from PiP" context with an empty query,
the library entry (phase 4), the audit of the earlier sketch, the session
model, the transition table, the key list and the implementation notes. It
does **not** show prototype steps 2–9, so the PiP tile chrome, the multiview
bar, the paused overlay, the error tile, the picker's search results and the
"replace" context are implemented from the spec text; Tasks 11, 12 and 14
need those screens (screenshots or a second export) before their visual
review.

### Taken from the mockup into the tasks

- **Dock button (Task 4).** Grid icon; order in the right group is volume →
  multiview → settings → fullscreen; hover shows a filled button background
  and a tooltip chip with the label and a keyboard badge.
- **PiP tile at rest (Task 11).** Clean picture with a shadow and nothing
  else; tile number and speaker appear at rest only with more than two tiles,
  so never in phase 1. The tile stays inside the video area and never covers
  content under the player. Reference size 320×180.
- **Picker shell (Task 14).** Header: grid icon tile, title, subtitle naming
  the main tile ("<title> keeps playing with sound. The new one starts
  muted."), close button. Search placeholder "Channels, programmes, movies,
  series…" with the scope chip inside the field on the right.
- **Picker navigation (Task 14).** Captions "Quick" and "Playlists"; each
  quick entry has an icon and an item count; a playlist row has the name, the
  source type as a second line and a badge: green `N free`, amber `0 free`,
  neutral `limit ?`.
- **Live now list (Tasks 13–14).** Caption above the list ("TV from all
  playlists · favourites first"); groups "From favourites" and "More on air";
  a row is a logo tile, the channel name, one line "programme · start–end ·
  playlist name", a thin progress bar under the text and a badge on the right.
- **Picker footer (Task 14).** Connection meter drawn as one segment per
  allowed connection plus the text "<playlist>: N of M in use".
- **Full playlist (Task 14).** It is not hidden: it stays selectable, is
  marked, and the list shows a warning banner.
- **Search scope (Task 13).** With a playlist selected, search runs inside
  that playlist only and the scope chip shows its name.

### Where the mockup and the spec differ (the spec wins)

| Mockup | Spec | Plan |
| --- | --- | --- |
| `M` opens multiview, tooltip "Multiview M" | `Shift+M`; `M` stays mute | `Shift+M` |
| `1`–`4` make a tile active | `Alt+1`–`Alt+4`, phase 2 | not in phase 1 |
| `G` next layout, `Enter` expand, `Backspace` close active tile | absent from 5.3 | not implemented |
| "Detach" to system PiP | non-goal | not implemented |
| VOD pauses "in a small tile or without sound" | R4: without audio only | R4 |
| All playlists listed in the picker | Q2: current playlist only in phase 1 | Q2 |
| PiP / side-by-side toggle in the footer | side by side is phase 2 | toggle not rendered |
| Store field `returnUrl` | `anchor` (route + rect source) | `anchor` |

## Existing prototype: `agent/two-stream-mpv`

Branch on GitHub, four commits on top of `07d14e80a`, no pull request. It is
the "Add second stream" sketch the mockup audits. What it is:

- **Engine:** Electron only, Embedded MPV frame-copy only (two mpv helpers
  drawing into two canvases). The multiview spec excludes Embedded MPV
  (non-goal, 5.2) and uses the HTML5 player for added tiles, so the playback
  core of the prototype — `SecondStreamComponent` bound to
  `EmbeddedMpvPlayerComponent`, session-owned frame readers, volume
  acknowledgement, audio handoff — does not carry over.
- **Entry:** `canAddSecondStream` input and `secondStreamRequested` output on
  `PlayerControlsComponent`, icon in the top-right chrome beside Stream info.
  The mockup moves it into the dock; the plan uses an optional token instead
  of inputs (finding 3).
- **Small view:** floats anywhere in the app viewport through manual
  popovers, with a move handle, two resize corners, pause and "No sound"
  label. The mockup replaces this with a tile inside the video area that
  snaps to corners.
- **Unrelated commit on the branch:** `8b9f62f1d` keeps the inline player
  header visible. Not part of multiview; it needs its own PR.

Reused in phase 1 (ported with their specs, renamed, credited in the commit):

| Prototype piece | Use | Task |
| --- | --- | --- |
| `SecondStreamCatalogService` (`portal-shared-data-access`): saved playlists → groups → channels for M3U, Xtream and Stalker without touching the active provider store, parental-lock filtering (`isAllowed`), `resolve()` through `StreamResolverService` | picker "Playlists" data and the tile resolver | 13 |
| `stalker-itv-genre-loader` (`portal-stalker-data-access`): ordered, cancellable genre pages | Stalker groups in the picker | 13 |
| `second-stream-position.ts`: viewport clamping, 16:9 resize limits, arrow-key move and resize | PiP drag/resize math, adapted to corner snapping and the 240–480 px range | 11 |
| `TWO_STREAMS.*` translations in all 21 locales | source text for the overlapping `PLAYER.MULTIVIEW.*` keys (swap, paused, pick hint, connection hint, loading, empty and error states) | 4 |
| Picker behaviour: focus trap, closes on selection / Escape / backdrop | same in picker v2 | 14 |
| `two-stream-mpv.e2e.ts` | structure and mock setup for the Electron e2e | 17 |

Rules the prototype already settled and the plan adopts:

- A parental relock during a session removes a tile whose source is now
  withheld, immediately; if it had audio, audio moves to the remaining tile
  (Task 2 rule, Task 5 wiring).
- A retried or replaced small tile always starts muted (already R2).
- No next-episode autoplay while a session exists (D11).

Because the catalog service reads every saved playlist, listing all playlists
in the picker costs nothing extra; Q2 still limits phase 1 to the current
playlist unless you say otherwise.

## Decisions (all confirmed by the maintainer on 2026-11-12)

Every "Proposal" below was accepted as written and is now part of the
contract for phase 1. Still open, and not blocking Tasks 0–10: the screens
of prototype steps 2–9 for the visual review of Tasks 11, 12 and 14. The
picker lists only the current playlist under "Playlists" (spec Q2).

- **D1. Tile count in phase 1.** The spec allows tiles ≥ 3 only in grid/focus
  (L3), which are phase 2. Proposal: phase 1 caps a session at two tiles; an
  "add" with two tiles replaces the PiP tile and shows the R6 toast
  ("Replaced tile 2 · Undo"). The reducer still implements the general
  four-tile rules behind a per-layout capacity so phase 2 only raises the cap.
- **D2. Remaining tile is foreign to the view (R7/R8).** When the session ends
  and the surviving tile is not something the hosting view can show as its
  own selection (another playlist, or a movie on a live page), proposal: the
  view adopts it when playlist and kind match; otherwise the app opens the
  item through the same navigation the Recent/Favorites lists use.
- **D3. Volume control on a muted tile.** The dock's volume/mute on a tile the
  session keeps muted does not unmute it locally; it moves audio to that tile
  (same as `A`). The persisted volume setting is never written by multiview.
- **D4. Same-origin header conflict.** Requests are matched to an override by
  exact URL first, then by origin with the most recently configured override
  winning. Two concurrent tiles on the same origin with different
  User-Agent/credentials cannot be told apart for segment requests; the later
  tile's headers win and a failing tile surfaces through R-E. Accept as a
  documented limit.
- **D5. Project layout** (deviation from the spec's single
  `libs/playback/multiview` example, forced by finding 4): see file structure.
- **D7. Fate of the `agent/two-stream-mpv` prototype — confirmed
  2026-11-12.** The branch is not merged. Phase 1 ports the reusable pieces
  listed under "Existing prototype" together with their specs; the branch
  stays as a reference for a later Embedded MPV tile engine.
- **D11. Next-episode autoplay during a session.** The prototype suppresses
  episode autoplay while the second view is open. Proposal: keep that rule —
  while a session exists no tile advances to the next episode on its own; the
  "Up next" card stays usable by hand on the main tile.
- **D8. Hint card in the channel panel.** Step 1 shows a card under the
  channel list: "Alt-click or drag a channel onto the player — straight into
  a second tile, no dialog". The spec does not list it and it would add UI to
  the channel panels of three providers. Proposal: treat it as a prototype
  annotation and do not build it; the same text goes into the dock tooltip
  area only if you want it.
- **D9. "By popularity" in the picker.** The "More on air" group has a sort
  link "by popularity". The app has no popularity data. Proposal: phase 1
  orders that group by recently viewed first, then playlist order, and does
  not render the link.
- **D10. Row badge in "Live now".** The mockup shows elapsed minutes ("67′")
  on some rows and "LIVE" on others without a visible rule. Proposal: elapsed
  minutes of the current programme when the row has EPG, "LIVE" when it has
  none.
- **D6. Plan location.** `AGENTS.md` asks for finalized plans in `.plans/`;
  this file is in `docs/superpowers/plans/` as requested. Say if you want a
  copy there once approved.

## File structure

### New projects

| Project | Alias | Tags | Contents |
| --- | --- | --- | --- |
| `libs/playback/multiview/data-access` | `@iptvnator/playback/multiview/data-access` | `scope:shared`, `domain:playback`, `type:data-access` | reducer, `MultiviewSessionStore`, behaviour constants, anchor registry, port tokens (picker launcher, connection budget source, tile resolver) |
| `libs/playback/multiview/ui` | `@iptvnator/playback/multiview/ui` | `scope:shared`, `domain:playback`, `type:ui` | `MultiviewStageComponent`, tile, tile chrome, paused/error overlays, `MultiviewBarComponent`, PiP geometry |
| `libs/workspace/multiview/feature` | `@iptvnator/workspace/multiview/feature` | `scope:workspace`, `domain:workspace`, `type:feature` | `MultiviewPickerDialogComponent`, section composition, `ConnectionBudgetService` (Xtream), shortcut registration, providers for the port tokens |

Generated with the Nx library generator (`nx-generate` skill), then tags and
aliases checked against `docs/architecture/nx-workspace-boundaries.md`.
`workspace-shell-feature` imports the UI and feature projects; neither
imports `workspace-shell-feature`.

### Existing files touched (all opt-in)

- Electron: `request-header-overrides.service.ts`, `shared.events.ts`,
  `main.preload.ts`, `libs/shared/interfaces/.../electron-api.interface.ts`.
- `libs/ui/playback`: `electron-stream-headers.service.ts`,
  `web-player-application-handoff.ts`, `web-player-view.component.{ts,html}`,
  `player-controls.component.{ts,html}`, `web-video-controls.adapter.ts`,
  `portal-inline-player.component.html`, new `multiview-anchor/` folder,
  `src/index.ts`.
- Hosts: M3U `video-player.component.html`, Xtream
  `live-stream-layout.component.html`, Stalker
  `stalker-live-stream-layout.component.html`,
  `unified-live-tab.component.html` (plus one small adapter file per host).
- Lists: `channel-list-item.component.{ts,html}` and the four places that
  render it (M3U container views, Xtream `portal-channels-list`, Stalker
  layout / `stalker-itv-all-items`, unified live rows).
- Shell: `workspace-shell.component.{ts,html}`.
- Shortcuts: `keyboard-shortcut-definitions.ts`, `docs/keyboard-shortcuts.md`.
- i18n: `apps/web/src/assets/i18n/*.json` (21 files).
- Mock: `apps/xtream-mock-server` scenario + stream handler.
- Docs: `player-controls-contract.md`, `workspace-shell.md`,
  `embedded-inline-playback.md`, new `docs/architecture/multiview.md`,
  context map entry.

---

## Tasks

### Task 0: Bring the spec and this plan onto the branch

The spec currently exists only as an untracked file in the main checkout; it
was copied into this worktree unchanged.

- [ ] Commit `docs/superpowers/specs/2026-11-12-multiview-design.md` and this
      plan. No other changes.

**Accept:** `git status` clean; `pnpm run agents:validate` passes.

### Task 1: One scoped header override per owner (prerequisite)

Turns the single scoped slot into a map keyed by an **owner id**. Every
existing caller keeps using the implicit default owner, so with one player
the map holds at most one entry and behaves as the slot does today. Only
multiview tiles will pass their own owner.

**Files**

- Modify `apps/electron-backend/src/app/services/request-header-overrides.service.ts`;
  create `request-header-override-matching.ts` next to it for the selection
  logic (keeps the service under the line target).
- Modify `apps/electron-backend/src/app/events/shared.events.ts`,
  `apps/electron-backend/src/app/api/main.preload.ts`,
  `libs/shared/interfaces/src/lib/electron-api.interface.ts`.
- Modify `libs/ui/playback/src/lib/web-player-view/electron-stream-headers.service.ts`,
  `web-player-application-handoff.ts`, `web-player-view.component.ts`.
- Create specs: `request-header-overrides.service.multi-owner.spec.ts`,
  `request-header-override-matching.spec.ts`,
  `electron-stream-headers.service.owners.spec.ts`,
  `web-player-view.component.header-owner.spec.ts`.

**Steps**

- [ ] Write the new specs first (red):
  - main: two owners on different origins each get their own
    User-Agent/Referer/Origin/Cookie/Authorization; credentials stay pinned to
    the exact origin of their own scope URL; clearing one owner leaves the
    other; an empty scoped call clears only its owner; an empty global call
    clears the global override and every owner (today's "clears both");
    exact-URL match beats origin match; among origin matches the most
    recently configured wins (D4); control characters still rejected.
  - renderer: `apply(playback)` / `clear(url)` without an owner behave as
    today (sequence guard, ownership check on clear); two owners keep
    independent sequence and scope URL, so applying tile B does not make tile
    A's pending apply resolve `false` and `clear` for A does not release B;
    without the bridge `apply()` returns `null` for any owner (PWA).
  - view: without `headerOwner` the IPC call has exactly today's five
    arguments; with it the owner is the sixth.
- [ ] Main process: replace `activeScopedHeaderOverride` with
      `Map<ownerId, override>` (stores scope URL and a configure sequence);
      `configureRequestHeaderOverride` gets an optional trailing `ownerId`
      defaulting to a module constant; request handling applies the global
      override, then matching scoped overrides ordered so the best match is
      applied last.
- [ ] IPC: `set-user-agent` accepts an optional sixth argument, validated as a
      short string, otherwise the default owner. The preload appends it
      **only when defined**, so existing calls stay byte-identical on the wire.
- [ ] Renderer: `ElectronStreamHeadersService.apply(playback, owner?)` and
      `clear(streamUrl, owner?)` with per-owner state.
      `WebPlayerApplicationHandoffCoordinator` takes an optional owner getter;
      `WebPlayerViewComponent` gets `headerOwner = input<string | null>(null)`.
- [ ] Docs: update the "exactly one scoped slot" wording in the service
      comment and in the architecture doc that describes inline playback
      headers.

**Tests**

```sh
pnpm nx test electron-backend --testFile='request-header|shared.events|main.preload'
pnpm nx test ui-playback --testFile='electron-stream-headers|web-player-view'
pnpm nx test portal-stalker-feature
pnpm nx test portal-shared-ui
pnpm nx test playlist-m3u-feature-player
pnpm nx test m3u-state
pnpm run typecheck:backend && pnpm run typecheck:web && pnpm run typecheck:spec
pnpm nx run-many -t lint -p electron-backend,ui-playback,shared-interfaces
```

Electron E2E (IPC change): `xtream-playback-headers.e2e.ts`,
`stalker-playback-headers.e2e.ts`, `xtream-live-format.e2e.ts`,
`dash-clearkey.e2e.ts` (compare with a master run first — known local flake).

**Accept:** the existing header specs
(`request-header-overrides.service.spec.ts`,
`electron-stream-headers.service.spec.ts`, `shared.events.spec.ts`,
`main.preload.spec.ts`) and the four e2e files pass with no edits; `git diff --stat` shows no existing `*.spec.ts` / `*.e2e.ts` changed
except added cases; no release note (no user-visible change, PR label
`no-release-note`).

### Task 2: Session reducer and store

**Files:** new project `libs/playback/multiview/data-access` —
`multiview-session.model.ts`, `multiview-session.reducer.ts` (+ spec),
`multiview-behaviour.constants.ts`, `multiview-session.store.ts` (+ spec),
`multiview-ports.ts`, `index.ts`; `tsconfig.base.json` alias.

- [ ] Model per spec section 6: tile (`id`, `playback`, `playbackSessionKey`,
      `kind`, `playlistId`, `title`, `engine`, `status`, `lastPosition`),
      layout (`'pip'` only is reachable in phase 1), `activeTileId`,
      `audioTileId`, `anchorId`, PiP corner and size.
- [ ] Reducer spec first: R1 start (tile 1 keeps engine and position, tile 2
      muted in the bottom-right corner), R2 single audio tile, R3 swap
      exchanges main and audio, R4 VOD/episode without audio is `paused` with
      its position and resumes on audio, live never pauses, R6 capacity and
      replace-with-undo snapshot (D1), R7 close → session ends at one tile,
      R8 exit keeps the audio tile, same source already on screen is rejected,
      radio sources are rejected (non-goal), a parental relock removes a
      withheld tile and moves audio if needed, no next-episode autoplay while
      a session exists (D11).
- [ ] Constants `PAUSE_VOD_WITHOUT_AUDIO` and `STOP_MUTED_LIVE_WHEN_MINIMISED`
      (spec 5.4) as named exports read by the reducer.
- [ ] Store: `providedIn: 'root'`, signals plus commands delegating to the
      reducer; `exists` computed; `tileNumberFor(source)` for badges; ends the
      session with a toast event when the selected player becomes
      `mpv`/`vlc`/`embedded-mpv`.

**Tests:** `pnpm nx test playback-multiview-data-access`, lint, `pnpm nx show
projects`. **Accept:** reducer is free of Angular imports; boundaries lint
clean.

### Task 3: Tile mode on `WebPlayerViewComponent` (opt-in)

**Files:** `libs/ui/playback/src/lib/web-player-view/web-player-tile-context.ts`
(new token + default), `web-player-view.component.{ts,html}`,
`player-controls.component.ts`, `web-video-controls.adapter.ts`, new specs
`web-player-view.component.tile-mode.spec.ts`,
`web-video-controls.adapter.tile.spec.ts`.

- [ ] Inputs `controlsMode: 'full' | 'minimal' | 'none'` (default `'full'`),
      `muted: boolean | null` (default `null` = not managed), `paused:
      boolean | null` (default `null`), output `audioRequested`.
- [ ] Token `WEB_PLAYER_TILE_CONTEXT` provided by the view, root default
      equal to "full / unmanaged". The controls read it to hide the dock and
      detach shortcuts when not `'full'`; the adapter applies `muted` to
      `video.muted` and `paused` through play/pause on its current element
      (also after an engine remount); a volume command on a managed-muted tile
      emits `audioRequested` (D3).
- [ ] With `controlsMode !== 'full'` the view does not render the diagnostic
      panel or the fullscreen channel panel; failures still emit
      `playbackFailed`, and a new `diagnosticChanged` output hands the
      diagnostic to the tile's error overlay.

**Tests:** new specs plus the whole `ui-playback` suite unchanged;
`pnpm nx run electron-backend:build-e2e` (template type check).
**Accept:** every existing `web-player-view.*.spec.ts` passes unedited;
defaults proven by a "no inputs set" case.

### Task 4: Dock action and translations

**Files:** `libs/ui/playback/src/lib/player-controls/player-multiview-action.ts`
(token), `player-controls.component.{ts,html}`, spec
`player-controls.component.multiview.spec.ts`, 21 locale files.

- [ ] Optional token `PLAYER_MULTIVIEW_ACTION` (`run()`, `enabled` signal,
      `disabledTooltipKey`). No provider → no button (spec 11.2.3). Grid
      icon; position per the mockup: after volume, before the settings
      button (the record and system-PiP buttons, which the mockup does not
      show, keep their place between settings and fullscreen). Tooltip
      "Multiview · Shift+M" with the existing tooltip style of the dock,
      accessible name equal to the tooltip. No new button style: it reuses
      the dock's icon-button class and hover state.
- [ ] Start from the prototype's `TWO_STREAMS.*` strings for the keys that
      overlap, so those 21 translations are reused, not redone.
- [ ] Add all phase 1 keys under `PLAYER.MULTIVIEW.*` (dock, bar, tile
      actions, picker, errors, toasts, shortcut labels) to `en.json` and
      translate them in the other 20 locales.

**Tests:** `pnpm nx test ui-playback`, `node tools/i18n/check-drift.mjs`,
existing `player-controls-keyboard.e2e.ts` unchanged.
**Accept:** dock snapshot/DOM specs without a provider are unchanged.

### Task 5: Stage in the shell and the anchor directive

**Files:** `libs/playback/multiview/ui` — `multiview-stage.component.*`,
`multiview-tile.component.*`, `pip-geometry.ts` (+ specs);
`libs/ui/playback/src/lib/multiview-anchor/multiview-anchor.directive.ts`
(+ spec), `multiview-anchor.model.ts`; `workspace-shell.component.{ts,html}`.

- [ ] Anchor: structural directive taking a descriptor (anchor id, current
      source as a signal, `adopt(tile)` callback, D2). No session for this
      anchor → renders the host template as is. Session → renders a
      placeholder, registers its element in the store's anchor registry, and
      provides `PLAYER_MULTIVIEW_ACTION` to the wrapped player (disabled with
      "Available with the built-in player" for `mpv`/`vlc`/`embedded-mpv`).
      When the host's current source changes during a session it replaces the
      active tile (R5); when the anchor is destroyed the session ends and VOD
      positions are flushed (phase 1 navigation rule).
- [ ] Stage: one instance inside `.workspace-content-frame`, rendered only
      while a session exists, positioned over the anchor rect
      (ResizeObserver + scroll). `@for` over tiles tracked by tile id with
      absolute positioning, so swap never re-creates a `<video>`. Each tile is
      a `WebPlayerViewComponent` with `headerOwner = tile.id`,
      `playerOverride` (tile 1: its engine; added tiles: `Html5Player`),
      `controlsMode`, `muted`, `paused`, and `startTime` from the takeover
      position.
- [ ] PiP geometry (L1) as pure functions: 30 % width clamped 240–480 px,
      16:9, four corners with 16 px inset above the dock area.
- [ ] Keep-awake (R12): verify the existing per-engine keep-awake reporting
      already holds the blocker while any tile plays; add a case, change
      nothing if it does.

**Tests:** component specs: tile instances survive swap (same element
identity), anchor without session renders the original content, takeover
passes session key/engine/position, destroy ends the session;
`pnpm nx test playback-multiview-ui ui-playback workspace-shell-feature`.
**Accept:** shell DOM without a session contains no stage element; existing
shell specs unedited.

### Tasks 6–10: Anchors in the five player views (one commit each)

Each task wraps the existing player element with the anchor and adds a small
`*-multiview-source.ts` adapter that maps the view's current playback to a
tile source and implements `adopt`. No other change in the view. Radio stays
outside the anchor (non-goal).

| Task | View | Files |
| --- | --- | --- |
| 6 | Xtream live | `live-stream-layout.component.html`, new adapter, new spec |
| 7 | M3U player | `video-player.component.html`, new adapter, new spec |
| 8 | Stalker live | `stalker-live-stream-layout.component.html`, new adapter, new spec |
| 9 | VOD / series inline | `portal-inline-player.component.html`, new adapter, new spec |
| 10 | Unified live tab | `unified-live-tab.component.html`, new adapter, new spec |

For each: spec proves the template renders the same player with the same
bindings when no session exists, and the correct tile source (session key,
kind, playlist id, position for VOD) when a session starts. M3U: the catch-up
guide dock (`data-player-shortcuts-suspended`) keeps working; the dock button
is hidden while the guide is open. Inline VOD: position keeps flowing through
the host's existing `timeUpdate` → `PlaybackPositionService` path (R9).

**Tests per task:** the owning project's full unit suite and lint; affected
existing e2e (`inline-player-layout.e2e.ts`, live layout specs).
**Accept:** existing specs of the view unedited and green.

### Task 11: Tile chrome, multiview bar, swap, audio, close, exit

**Files:** `libs/playback/multiview/ui` — `multiview-tile-chrome.component.*`,
`multiview-paused-overlay.component.*`, `multiview-bar.component.*`,
`pip-drag-resize.ts` (+ specs, ported from the prototype's
`second-stream-position.ts`); stage wiring.

- [ ] PiP tile: at rest a clean picture with a shadow and no chrome, number
      or speaker (those appear at rest only with more than two tiles, phase
      2); on hover/focus exactly three buttons — swap, audio here, close
      (the fourth, side by side, is phase 2). No move handle, no label, no
      "No sound" text, no pause button on the tile. Drag by the whole tile with corner
      snapping, resize from the corner facing the stage centre, both
      remembered for the session. Double-click swaps (R3). Keyboard: with the
      tile focused, arrow keys move it between corners and resize it (kept
      from the prototype).
- [ ] Main tile keeps its normal dock. Paused VOD overlay with position (R4).
- [ ] Bar (52 px, under the stage inside the player view): tile chips with
      state icon, layout segmented control showing PiP only, "+ Channel",
      "Exit" (R8). Uses the shared `.seg` and button kit.
- [ ] Accessibility (spec 13): real buttons with names, tile regions labelled
      "Tile N, title, state", live announcement on active-tile change,
      `prefers-reduced-motion` switches instantly.
- [ ] Read the `iptvnator-ui-design` and `iptvnator-theme-style` skills first;
      compare with the mockup in light and dark.

**Tests:** component specs for every action and for reduced motion; reducer
already covers the rules. **Accept:** swap/audio/close/exit work in the
Xtream mock by hand; no `<video>` re-created on swap (spec).

### Task 12: Tile error state (R-E)

**Files:** `multiview-error-overlay.component.*`, `multiview-error-copy.ts`
(+ specs) in the UI project; Xtream mock scenario and stream handler.

- [ ] Overlay with title, one-sentence cause from the tile's diagnostic
      (explicit wording when the budget says `active_cons >=
      max_connections`), actions "Replace main tile", "Choose another source",
      "Close".
- [ ] Mock: scenario switch that refuses a stream when the account is at its
      connection limit; default scenario unchanged (covered by the mock's own
      spec).

**Tests:** `pnpm nx test playback-multiview-ui xtream-mock-server`.

### Task 13: Connection budget and picker data

**Files:** `libs/workspace/multiview/feature` —
`connection-budget.service.ts`, `multiview-picker-sections.ts`,
`multiview-picker-search.ts`, `multiview-tile-resolver.ts` (+ specs).

- [ ] Port `SecondStreamCatalogService` and `stalker-itv-genre-loader` from
      `agent/two-stream-mpv` with their specs (renamed to
      `MultiviewCatalogService`; behaviour unchanged) as the source for the
      "Playlists" section and for resolving a picked row.
- [ ] Budget: Xtream `user_info` fetched on picker open and before add →
      `N free` / `0 free` (full) with `used` and `max` for the footer meter;
      M3U and Stalker → `limit ?`.
- [ ] Live now is composed as two groups, "From favourites" then "More on
      air" (order per D9), each row carrying programme title, start–end,
      progress and playlist name; section entries expose their item count
      for the navigation.
- [ ] Sections reuse existing sources only (spec 9.5 table): Favorites
      (`UnifiedFavoritesDataService`), Recent (`UnifiedRecentDataService`),
      Continue (`PlaybackPositionService` + `dashboard-playback.utils.ts`),
      Live now (favourites + recent + current playlist, EPG through
      `StreamResolverService.loadEpgForItems`, visible rows only, at most 20
      requests per open — Q1), current playlist only under "Playlists" (Q2).
- [ ] Search: Electron SQLite global search; PWA client-side filter. Runtime
      choice through the capability contract, not `window.electron`. Scope is
      "everywhere" by default and the selected playlist when one is selected.
- [ ] Resolver: item → `ResolvedPortalPlayback` through
      `StreamResolverService` / `XtreamUrlService` / Stalker `create_link`.
- [ ] Parental lock and hidden categories applied exactly as in the source
      lists (R11); items already on screen marked "In tile N"; radio excluded.

**Tests:** section composition, default section rule (VOD main → Live now,
live main → Continue, then last used), budget arithmetic, EPG request cap,
R11 filtering.

### Task 14: Picker dialog and entry points

**Files:** `multiview-picker-dialog.component.*` (+ spec),
`multiview-launcher.service.ts`, provider wiring in the shell.

- [ ] Dialog on the shared `ipt-dialog` shell, 820 px, contexts "add" and
      "replace" (slot context is phase 2). Layout per the mockup: header with
      icon tile, title and the subtitle naming the main tile; search field
      with the scope chip; left navigation ("Quick" with icons and counts,
      "Playlists" with type line and budget badge); list caption; rows for
      live (logo, name, programme line, progress bar, badge per D10), movie
      and series with "Episodes ›" drill-down; grouped search results;
      footer with the segmented connection meter. The PiP / side-by-side
      toggle is not rendered in phase 1.
- [ ] A full playlist stays selectable, is marked in the navigation and
      shows a warning banner above the list ("probably won't start").
- [ ] Keyboard: typing goes to search, ↑↓, Enter adds, Esc closes; focus
      trapped.
- [ ] Opened from the dock button, "+ Channel", "Choose another source".
      Adding records recently viewed through the existing history gate at add
      time (R10, Q3).

**Tests:** dialog spec (contexts, disabled rows, keyboard);
`dialog-shell.e2e.ts` / `dialog-accessibility.e2e.ts` unchanged.

### Task 15: Keyboard shortcuts

**Files:** `multiview-shortcuts.service.ts` (+ spec) in the feature project,
`keyboard-shortcut-definitions.ts`, `docs/keyboard-shortcuts.md`,
`player-controls-contract.md` (keyboard ownership section).

- [ ] `Shift+M` opens the picker (works without a session, only when an
      anchor with a web player is mounted); `S` swap; `A` audio to the active
      tile; `Esc` closes the picker only and never ends the session. `Alt+1–4`
      is phase 2.
- [ ] Same ignore rules as `ControlsShortcuts`: not in inputs or interactive
      targets, not inside `[inert]` / `[data-player-shortcuts-suspended]`;
      plain `M` (mute) and digits stay untouched — spec cases prove `M` still
      mutes and `Shift+M` does not.
- [ ] Entries in the in-app shortcuts dialog.

**Tests:** service spec; `player-controls-keyboard.e2e.ts` unchanged.

### Task 16: Channel-list badges, Alt+click, drag

**Files:** `channel-list-item.component.{ts,html,scss}` (optional
`multiviewBadge` input and `altActivated` output, default none), a shared
`multiview-list-binding.ts` helper, and the list hosts: M3U container views,
Xtream `portal-channels-list`, Stalker layout and `stalker-itv-all-items`,
unified live rows.

- [ ] Badge with the tile number and a speaker icon for the audio tile, only
      while a session exists (spec 9.4).
- [ ] Alt+click adds the channel as a tile (R5) instead of selecting it;
      a normal click keeps today's path.
- [ ] Drag: native drag source on live rows with a multiview payload; drop on
      a tile replaces it, on empty player space adds. Must not interfere with
      the existing `cdkDrag` favourites reordering — if the two cannot coexist
      cleanly, drag is reported back instead of forced.
- [ ] The hint card under the channel list from mockup step 1 is not built
      (D8).
- [ ] Read the UI skills first (channel rows are a guarded surface).

**Tests:** item spec (no badge and no new listeners by default), one spec per
list host; existing list specs unedited.

### Task 17: End-to-end, docs, release note

**Files:** `apps/electron-backend-e2e/src/multiview-pip.e2e.ts`,
`apps/web-e2e/src/multiview-pip.e2e.ts`, `docs/architecture/multiview.md`,
`workspace-shell.md`, `embedded-inline-playback.md`,
`docs/maintenance/agent-context-map.md`, `validation-map.md`,
`.changes/playback-multiview-pip.md`.

- [ ] Electron: start PiP from the dock; swap; VOD resumes at its position;
      Alt+click add; two tiles with different headers both reach the mock
      with their own headers; connection-limit error and its actions; leaving
      the route ends the session and saves positions.
- [ ] PWA: PiP start and swap.
- [ ] Scenario "movie → match → swap → swap back" on Xtream mock, M3U and
      Stalker mock; light and dark; synthetic data only in screenshots.
- [ ] Canonical doc for the subsystem, context-map entry, release note
      (`release-notes` skill), `pnpm run release:notes:validate`.

## Phase acceptance (spec 14)

- The scenario works in Electron and the PWA with all three source types.
- With no session: `pnpm run test:unit:ci` and both e2e suites pass with no
  existing test edited; `git diff master --stat -- '*.spec.ts' '*.e2e.ts'`
  lists only new files and added cases.
- `pnpm run typecheck:web`, `typecheck:backend`, `typecheck:spec`, affected
  lint, `pnpm nx run electron-backend:build-e2e`, i18n drift check,
  `agents:validate`, `skills:validate` (if a skill path changed) all pass.
- Local review gate (Codex + Greptile CLI) before the first push.

## Risks

- **Takeover rebuffer.** Tile 1 is remounted by the stage; the spec accepts
  one short rebuffer. Provider-side, the old connection must close before the
  new one opens, or a one-connection account fails at session start —
  covered by an e2e case with the mock at `max_connections: 1`.
- **Stalker `create_link` tokens** may be single-use; takeover re-resolves
  the link for tile 1 instead of reusing the URL if the mock/e2e shows it is
  needed.
- **Three engines for tile 1.** External mute/pause goes through the shared
  `WebVideoControlsAdapter`, which all three use; Video.js tech replacement
  is the case most likely to drop the muted flag (explicit spec in Task 3).
- **Size.** Seventeen commits; Tasks 1–5 are the foundation and can ship as
  their own PR (no user-visible change) ahead of the rest if you prefer
  smaller reviews.
