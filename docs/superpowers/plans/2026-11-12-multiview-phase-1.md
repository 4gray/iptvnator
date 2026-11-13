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

### Interactive prototype (HTML export, reviewed 2026-11-13)

The maintainer supplied the full prototype as a bundled HTML file; it was
rendered locally (headless Chromium, no network) and all nine steps were
captured. It replaces the "steps 2–9 not visible" caveat above. Visual facts
used by Tasks 11, 12, 14 and 16 (the prototype is dark-only; on-video chrome
uses the theme-independent player palette, chrome outside the video uses
app tokens in both themes):

- **PiP tile, hover/focus (step 3):** top-left label pill — tile number
  badge, `LIVE` (red) or `VOD` badge, title; bottom-left three 28 px icon
  buttons — swap (accent-filled), audio here (speaker), side by side
  (phase 2, not rendered); bottom-right close (×). At rest: picture only.
  Rounded corners and a soft shadow. Double click swaps.
- **Held VOD tile (step 4):** centred play circle and a chip
  "Pause · 1:05:13" (position in mono). Play gives the tile the audio (R4).
- **Multiview bar (steps 3, 4, 9):** a 48 px row under the video (prototype
  48 px; spec 9.3 says 52 px — 48 is used), inside the player area,
  `#0f141c`-like surface, 12 px side padding, 8 px gap:
  - chips (30 px tall, radius 9 px, 12 px/500): number badge (17 px, radius
    5 px; accent for the audio tile), title, state icon — speaker for the
    audio tile, pause bars for a held VOD tile, warning for a failed tile;
    the audio tile's chip has an accent outline;
  - layout segmented control (radius 10 px, 2 px padding, 33×30 px icon
    segments: PiP, side by side, 2×2, 1+3; phase 1 renders PiP only);
  - "+ Channel" (tonal, 28 px, radius 8 px, 12 px/600) — only while a
    picker exists; "× Exit" (text button, muted colour).
- **Error tile (step 9):** the failed tile grows into a card over the video:
  warning icon + bold title ("Provider refused a second stream"), one
  sentence of cause naming the playlist and its limit, actions "Replace main
  tile" (filled accent), "Another playlist" (tonal), "Close" (text). The
  tile's chip shows a warning icon.
- **Channel rows (step 3):** the row of an on-screen channel shows a small
  pill with the tile number, plus a speaker for the audio tile; the active
  tile's row keeps the selected highlight.
- **Picker (step 2):** type chips with counts (All / TV / Movies / Series),
  groups "On air now" / "Channels" / "Movies" with the query highlighted,
  red minute badge for programmes, red `LIVE` badge otherwise, bottom-left
  connection meter, bottom-right PiP / side-by-side toggle (phase 1: not
  rendered).

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
- **D12. System picture-in-picture (confirmed 2026-11-13).** Mechanism:
  the tile media helper sets `disablePictureInPicture` on every tile video;
  the dock's PiP capability already honours it, so no shared-controls change
  is needed. The two features stay independent outside a session: the
  single player keeps its system PiP button exactly as today. During a
  session no tile can enter system PiP (per-tile pop-out is a non-goal):
  small tiles have no dock, and the main tile's dock hides its PiP button
  (Task 11). Starting a session while the video is in system PiP is allowed;
  tile 1 replaces the player element, so the browser closes the PiP window
  and the stream continues in the app. The multiview button is not disabled
  while system PiP is active.
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

- [x] Commit `docs/superpowers/specs/2026-11-12-multiview-design.md` and this
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

- [x] Write the new specs first (red):
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
- [x] Main process: replace `activeScopedHeaderOverride` with
      `Map<ownerId, override>` (stores scope URL and a configure sequence);
      `configureRequestHeaderOverride` gets an optional trailing `ownerId`
      defaulting to a module constant; request handling applies the global
      override, then matching scoped overrides ordered so the best match is
      applied last.
- [x] IPC: `set-user-agent` accepts an optional sixth argument, validated as a
      short string, otherwise the default owner. The preload appends it
      **only when defined**, so existing calls stay byte-identical on the wire.
- [x] Renderer: `ElectronStreamHeadersService.apply(playback, owner?)` and
      `clear(streamUrl, owner?)` with per-owner state.
      `WebPlayerApplicationHandoffCoordinator` takes an optional owner getter;
      `WebPlayerViewComponent` gets `headerOwner = input<string | null>(null)`.
- [x] Docs: update the "exactly one scoped slot" wording in the service
      comment, `docs/architecture/electron-security.md` ("Override owners")
      and `docs/architecture/stalker-portal.md`.

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
`multiview-session.model.ts`, `multiview-session.commands.ts`,
`multiview-session.reducer.ts` (+ spec), `multiview-session.selectors.ts`,
`multiview-behaviour.constants.ts`, `multiview-session.store.ts` (+ spec),
`index.ts`; `tsconfig.base.json` alias, `nx.json` Jest include, Tier A entry
in `tools/coverage/coverage-policy.json`, project paragraph in
`docs/architecture/nx-workspace-boundaries.md`. The port tokens (picker
launcher, connection budget, tile resolver) are defined with their first
consumer in Tasks 5 and 13 instead of here, so their shape follows real use.

- [x] Model per spec section 6: tile (`id`, `playback`, `playbackSessionKey`,
      `kind`, `playlistId`, `title`, `engine`, `status`, `lastPosition`),
      layout (`'pip'` only is reachable in phase 1), `activeTileId`,
      `audioTileId`, `anchorId`, PiP corner and size.
- [x] Reducer spec first: R1 start (tile 1 keeps engine and position, tile 2
      muted in the bottom-right corner), R2 single audio tile, R3 swap
      exchanges main and audio, R4 VOD/episode without audio is `paused` with
      its position and resumes on audio, live never pauses, R6 capacity and
      replace-with-undo snapshot (D1), R7 close → session ends at one tile,
      R8 exit keeps the audio tile, same source already on screen is rejected,
      radio sources are rejected (non-goal), a parental relock removes a
      withheld tile and moves audio if needed, no next-episode autoplay while
      a session exists (D11).
- [x] Constants `PAUSE_VOD_WITHOUT_AUDIO` and `STOP_MUTED_LIVE_WHEN_MINIMISED`
      (spec 5.4) as named exports read by the reducer.
- [x] Store: `providedIn: 'root'`, signals plus commands delegating to the
      reducer; `exists` computed; `tileNumberFor(source)` for badges; ends the
      session with a toast event when the selected player becomes
      `mpv`/`vlc`/`embedded-mpv`.
- [x] Rules settled while writing the reducer: a swap in PiP always gives the
      audio to the new main tile (in both R3 cases the tile that becomes
      large ends up audible); replacing a tile's stream (R5) keeps its id,
      engine and audio role, so the player is not re-created; an "add" that
      replaces a tile (R6) leaves the new stream muted and hands a lost audio
      role to the main tile; every effect is published as a numbered
      `notice` signal for toasts and survivor adoption.

**Tests:** `pnpm nx test playback-multiview-data-access`, lint, `pnpm nx show
projects`. **Accept:** reducer is free of Angular imports; boundaries lint
clean.

### Task 3: Tile mode on `WebPlayerViewComponent` (opt-in)

**Files (as built):** `libs/ui/playback/src/lib/web-player-view/` —
`web-player-tile-mode.ts`, `web-player-tile-media.ts` (+ spec),
`web-player-view.component.{ts,html,scss}`,
`web-player-application-ownership.ts` (rendered-applications computation
moved here unchanged to stay under the 400-line limit), new spec
`web-player-view.component.tile-mode.spec.ts`; section "Multiview Tile Mode"
in `docs/architecture/embedded-inline-playback.md`.

Deviation from the first draft: no token, no change to
`PlayerControlsComponent` or `WebVideoControlsAdapter`. The engines'
existing `interactionEnabled` input already hides the shared dock and turns
off shortcuts, and the adapter is not attached at all with the legacy
controls setting, so mute and pause are applied by the view to the `<video>`
elements in its host instead. That covers all three web engines in both
controls settings and touches less shared code.

- [x] Inputs `controlsMode: 'full' | 'minimal' | 'none'` (default `'full'`),
      `muted: boolean | null` and `paused: boolean | null` (default `null` =
      not managed), outputs `audioRequested` and `diagnosticChanged`.
- [x] Not `full`: engines get `interactionEnabled = false`, the fullscreen
      channel panel is disabled, legacy vendor chrome is hidden by the host
      class `web-player-view--chromeless`, the diagnostic panel is not
      rendered; `playbackFailed` still fires and `diagnosticChanged` carries
      the diagnostic.
- [x] `WebPlayerTileMedia` keeps a muted tile muted and a held tile paused
      across engine remounts, resumes on release, and reports the viewer
      unmuting or playing a managed tile as `audioRequested` (D3) — judged by
      a pointer or key interaction inside the tile within the last second.

**Tests:** `web-player-tile-media.spec.ts` (15), tile-mode component spec
(11; 4 fail with the template wiring reverted), whole `ui-playback` suite
(1746, no existing spec edited), lint, `typecheck:web`, `typecheck:spec`,
`electron-backend:build-e2e`.
**Note:** `web-player-view.component.ts` is at 399 of 400 counted lines;
later tasks must not add to it without moving code out first.

### Task 4: Dock action and translations

**Files (as built):** `libs/ui/playback/src/lib/player-controls/` —
`player-multiview-action.ts` (token `PLAYER_MULTIVIEW_ACTION` and template
directive `appPlayerMultiviewAction`), `player-controls.component.{ts,html}`,
spec `player-controls.component.multiview.spec.ts`; 21 locale files; dock
paragraph in `docs/architecture/player-controls-contract.md`.

- [x] Optional token `PLAYER_MULTIVIEW_ACTION` (`enabled` signal,
      optional `disabledReasonKey`, `run()`). No provider → no button. The
      button markup lives in the dock template behind a template directive
      that stamps it only when the token is provided, so it reuses the
      dock's `player-controls__button` styles (the dock uses emulated
      encapsulation, a child component would not get them). Grid icon,
      right group before `tune`; tooltip "Multiview · Shift+M"; accessible
      name "Multiview". Disabled uses `disabledInteractive`, so the reason
      tooltip stays reachable and the click is ignored.
- [x] `player-controls.component.ts` was at 399 of 400 counted lines: the
      private `canHide()` was inlined into the `ControlsVisibility` factory
      (as on `agent/two-stream-mpv`) to make room; it is still at 399.
- [x] Keys `PLAYER.MULTIVIEW.ACTION`, `ACTION_TOOLTIP`, `UNAVAILABLE_PLAYER`
      in all 21 locales. Deviation: the remaining phase 1 keys are added with
      the task that renders them (picker, bar, tile chrome, toasts,
      shortcuts), so every string ships with its UI and the usage check
      stays meaningful; the prototype's `TWO_STREAMS.*` translations are
      reused there.

**Tests:** new dock spec (6; 5 red before the template change), whole
`ui-playback` (1752), `pnpm run i18n:check`, icon ligature check, lint,
`typecheck:web`, `typecheck:spec`, `electron-backend:build-e2e`.
`player-controls-keyboard.e2e.ts` was not run: without a provider the dock
DOM is unchanged and no host provides the action yet.

### Task 5: Stage in the shell and the anchor directive

**Files (as built):**
- `playback-multiview-data-access`: `multiview-anchor-registry.ts`
  (`MultiviewAnchorHost`, registry), `multiview-entry.service.ts` (start or
  add on the current anchor, picker round trip), `multiview-ports.ts`
  (`MULTIVIEW_SOURCE_PICKER`), new rejections `no-anchor` and
  `unsupported-player`; undo now resumes at the replaced tile's position.
- `ui-playback`: `multiview-anchor/multiview-anchor.directive.ts`,
  `multiview-anchor-placeholder.component.ts`; `PLAYER_MULTIVIEW_ACTION`
  exported from the player-controls barrel.
- New project `playback-multiview-ui` (`libs/playback/multiview/ui`):
  `multiview-stage.component.*`, `multiview-tile.component.*`,
  `pip-geometry.ts`, `stage-rect-tracker.ts`, `multiview-stage-action.ts`;
  alias, Tier A coverage entry, spec include in `apps/web/tsconfig.spec.json`.
- Shell: `workspace-shell/multiview-stage-host.ts` (+ spec), `#contentFrame`
  ref and one call in `workspace-shell.component.ts`.
- Docs: `nx-workspace-boundaries.md`, `workspace-shell.md` ("Multiview
  stage").

- [x] Anchor directive `*appMultiviewAnchor="host"` on the player element.
      Renders its template in the same check as `@if` would; with a session
      owned by this view it renders a black placeholder instead and the
      stage covers it. R5: a new selection in the view replaces the active
      tile. Leaving the view ends the session (`anchor-left`). When a session
      ends, the survivor is handed to `host.adopt()` before the player
      returns (D2), unless the view already shows it. It provides
      `PLAYER_MULTIVIEW_ACTION` to the wrapped player, disabled for
      unsupported engines — and provides nothing while no picker exists.
- [x] Stage created lazily by the shell (not in its template: the launch
      journey's DOM-mutation counter has no slack and the stage chunk carries
      the web players). Tiles render in creation order (`stableTileOrder`)
      and are moved only by CSS, so a swap never moves a `<video>` in the
      DOM; tiles stay mounted for the whole session even if the anchor is
      briefly unmeasured. Each tile: `headerOwner = tile.id`, its engine,
      `startTime` = takeover position (later positions do not remount),
      `controlsMode` full/minimal by role, session `muted`/`paused`,
      `audioRequested` → audio here, `playbackFailed` → status `error`, VOD
      positions to the store once per second.
- [x] PiP geometry (L1): 30 % width clamped 240–480 px and to the stage,
      16:9, corners with 16 px inset; bottom corners keep 96 px above the
      dock (value to confirm in the Task 11 visual review).
- [x] Keep-awake (R12): `PlaybackKeepAwakeService` already tracks every
      playing `<video>` in the document, so the lock holds while any tile
      plays. No change.

**Tests:** anchor 11, stage 8 (swap keeps instances and elements), geometry
12, stage action 2, entry/registry 11, undo position 1, stage host 4; `ui-playback` 1763,
`playback-multiview-ui` 22, `playback-multiview-data-access` 73,
`workspace-shell-feature` 399 (no existing spec edited); lint,
`typecheck:web`, `typecheck:spec`, coverage policy,
`electron-backend:build-e2e`.
**Not yet verified in the running app:** nothing hosts an anchor until
Task 6 and nothing opens a session before Task 14/16, so the first runtime
check happens with Task 6 (session started from the dev console or a test
hook).
**Known limits for later tasks:** the main tile's own fullscreen covers only
that tile (stage fullscreen is L7, phase 2); VOD positions reach only the
store — persisting them through `PlaybackPositionService` (R9) lands with the
inline-player anchor in Task 9.

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

#### Anchor scheme change (made during Task 7)

The structural `*appMultiviewAnchor` directive of Task 5 is replaced. The
M3U, Stalker and unified-live specs replace their component's imports
wholesale (`overrideComponent(..., { set: { imports } })`); a structural
directive missing from those imports would stop the player from rendering,
so those existing specs would have had to change. Now:

- `injectMultiviewAnchor(host)` (constructor or field initializer of the
  view) creates the anchor: registration, R5, adoption, ending the session on
  leave or when the placeholder disappears.
- The view's player slot is plain control flow:
  `@if (anchor.ownsSession()) { <app-multiview-anchor-placeholder> } @else
  { <app-web-player-view appMultiviewPlayer …> }`. Without a session it
  renders exactly as before, whatever the spec imports.
- `appMultiviewPlayer` (attribute directive, no input) gives that player's
  dock the multiview action through `provideMultiviewAnchor()` on the view,
  and reports the player's position from its `<video>` `timeupdate` events
  (capture phase), so tile 1 continues a VOD where the view's player was
  (R1). Found by the live M3U check: without it tile 1 restarted from 0.
- Views import it from the light entry `@iptvnator/ui/playback/multiview-anchor`
  (no web players behind it), so specs can import it statically.

#### Task 6 as built (Xtream live)

- `xtream-live-multiview-host.ts` (+ spec, 10): anchor id `xtream-live`;
  source = the playing channel (`kind: 'live'`, `contentId` = stream id); a
  catch-up programme is its own source (`kind: 'vod'`, key suffixed with the
  programme start) so a list click from live to catch-up replaces the tile;
  engine = the Settings player; `adopt()` plays a surviving live channel of
  the same playlist through `playLive(item, false)` plus `setSelectedItem`,
  so no new history entry.
- `live-stream-layout.component.{ts,html}`: one `multiviewHost` field, the
  `selectMultiviewChannel()` helper, `*appMultiviewAnchor` on the player,
  `MultiviewAnchorDirective` import. `MultiviewTileSource` gains an optional
  `contentId`.
- `live-stream-layout.multiview.spec.ts` (5; 3 fail without the anchor):
  inline player unchanged without a session, takeover, R5 replace, survivor
  adoption, leaving ends the session.
- Checks: `portal-xtream-feature` 735 (no existing spec edited),
  `playback-multiview-data-access` 73, lint, typecheck, build-e2e.
- First runtime check, Electron + Xtream mock (temporary local probe, session
  started through Angular's debug API): stage exactly over the player, tile 1
  kept Video.js, tile 2 HTML5 muted 240×135 bottom-right above the dock, both
  playing; swap kept both `<video>` elements and playback, audio moved; exit
  handed the audio tile back to the layout; no console errors.
- Found on the way, for Task 13: `XtreamStore.constructStreamUrl()` also
  selects the item in the store. The picker's resolver must build Xtream
  URLs through `XtreamUrlService` instead, or the layout's selection moves.
- Known phase 1 limit: a parental relock that withholds the layout's own
  channel removes the player and so ends the whole session (the anchor
  leaves), rather than closing only that tile.

#### Task 7 as built (M3U player)

- `m3u-multiview-host.ts` (+ spec, 12): anchor id `m3u-player`; kind from
  the resolved playback (`isLive === false` → `vod`, so movie files and
  catch-up are held paused without audio); catch-up is its own source
  (key suffixed with the catch-up URL, no `contentId`); radio channels are
  flagged `radio` and never become tiles; engine = the inline player's
  (DASH override, else the player settings); `adopt()` dispatches
  `setActiveChannel` for a surviving channel of the same playlist. Note:
  the M3U player records every active-channel change as recently viewed, so
  adopting a survivor refreshes its history timestamp.
- `video-player.component.{ts,html}`: `multiviewAnchor` field,
  `provideMultiviewAnchor`, the `@else if (ownsSession)` placeholder branch
  after the radio branch, `appMultiviewPlayer` on the inline player. The
  movie-detail player gets no multiview action.
- `video-player.multiview.spec.ts` (4) on the existing harness.
- Checks: `playlist-m3u-feature-player` 192 (no existing spec edited),
  `portal-xtream-feature` 735, `ui-playback` 1767, `playback-multiview-ui` 22,
  `playback-multiview-data-access` 75, `workspace-shell-feature` 399; lint,
  `typecheck:web`, `typecheck:spec`, `electron-backend:build-e2e`.
- Live check, Electron with a local M3U of two WebM files and the Xtream
  mock (temporary probe, session started through Angular's debug API):
  tile 1 continued at the player's position; the muted VOD PiP was held
  paused; after a swap the movie paused at 3.04 s and resumed from 3.04 s on
  swap back (R4); exit handed the audio tile back; no console errors.

#### Task 8 as built (Stalker live)

- `stalker-live-multiview-host.ts` (+ spec, 9): anchor id `stalker-live`;
  source = the playing ITV channel from the layout's playback identity
  (`playlistId` = portal id, `contentId` = channel id); radio mode flags the
  source `radio`, so it never becomes a tile; engine = the Settings player;
  `adopt()` calls `playChannel()` for a surviving channel of the same
  portal, which resolves a fresh portal link instead of reusing the tile's.
- `stalker-live-stream-layout.component.{ts,html}`: `multiviewAnchor`
  field, `provideMultiviewAnchor`, `@else if (ownsSession)` placeholder after
  the radio branch, `appMultiviewPlayer` on the inline player.
- `stalker-live-stream-layout.multiview.spec.ts` (4).
- Checks: `portal-stalker-feature` 598 (no existing spec edited), lint,
  `typecheck:web`, `typecheck:spec`, `electron-backend:build-e2e`.
- Live check, Electron + Stalker mock (temporary probe): tile 1 reused the
  resolved link and kept Video.js, tile 2 HTML5 muted in the corner, both
  playing; swap kept both `<video>` elements; exit re-resolved and played the
  surviving channel in the layout; no console errors. Single-use portal
  tokens were not exercised (the mock's links are reusable): if a real portal
  refuses the reused link, tile 1 shows the error state of Task 12.

#### Task 9 as built (detail pages' inline player)

- `portal-inline-player-multiview-host.ts`: anchor id
  `portal-inline-player`; kind `live` / `episode` (episode metadata present)
  / `vod`; `playlistId` from `playback.contentInfo`; engine = the host's
  `playerOverride`, else the Settings player. No `adopt()`: the inline player
  cannot switch titles itself.
- R9 for every tile: `MultiviewTileSource.persistPosition` is called on each
  tile time update. The inline player passes its own `timeUpdate` output, so
  tile 1's progress reaches the page's existing saving code (Xtream, Stalker,
  M3U VOD detail, series pages) exactly as in single playback. Sources added
  later (picker, Task 13) set it for their own content.
- `portal-inline-player.component.{ts,html}`: anchor field,
  `provideMultiviewAnchor`, placeholder branch, `appMultiviewPlayer`.
  Episode autoplay (D11) needs nothing extra: the page only advances on the
  inline player's `playbackEnded`, which tiles never emit.
- `portal-inline-player.multiview.spec.ts` (5); stage spec +1 for
  `persistPosition`.
- Checks: `ui-playback` 1772, `playback-multiview-ui` 23, data-access 75,
  `portal-xtream-feature` 735, `portal-stalker-feature` 598,
  `playlist-m3u-feature-player` 192 (no existing spec edited); lint,
  typecheck, build-e2e.
- Live check, Electron + Xtream mock movie (temporary probe): tile 1
  continued at the player's position (2.66 s), its progress kept reaching
  the page during the session (2.7 → 6.3 s), after a swap the movie was held
  paused and muted at 6.52 s.
- **Gap found (D2), new item for Task 14:** when the survivor is something
  the anchor view cannot show itself (here a live channel after a movie
  page's session), the view returns to its own title and the survivor is
  lost. D2 asks for navigating to the survivor instead. Plan: a
  `MULTIVIEW_SURVIVOR_NAVIGATOR` port in data-access, provided by the
  workspace feature that already knows how Recent/Favorites open items; the
  anchor calls it when `adopt()` is absent or declines. Until then this
  only happens through debug entry points (no picker yet).

#### Task 10 as built (Favorites / Recently viewed live tab)

- `unified-live-multiview-host.ts` (+ spec, 5): anchor id `unified-live`;
  rows identified by their collection uid (`contentId`), `playlistId` from
  the row; catch-up is its own VOD-like source; radio flagged `radio`;
  engine = the tab's inline player (M3U DASH override included); `adopt()`
  selects a surviving row of the list through `onChannelSelected()`.
- `unified-live-tab.component.ts` was at 400 of 400 counted lines: the
  auto-open effect moved unchanged to `unified-live-auto-open.ts`, and the
  anchor is created by `createUnifiedLiveMultiviewAnchor(this)` with the
  template parts in `UNIFIED_LIVE_MULTIVIEW_IMPORTS`; now 397.
- `unified-live-tab.multiview.spec.ts` (4).
- Checks: `portal-shared-ui` 275 (no existing spec edited), `ui-playback`
  1772, data-access 75; lint, typecheck, build-e2e.
- Live check, Electron + Xtream mock, two channels favourited, Global
  favorites (temporary probe): takeover, muted PiP at 30 % (258 px of an
  860 px stage), exit selected and played the surviving row; no console
  errors.

All five anchors are in place. Every live check so far started the session
through Angular's debug API: the user-facing entry points arrive with the
picker (Tasks 13–14) and Alt+click (Task 16).

### Task 11: Tile chrome, multiview bar, swap, audio, close, exit

**Files (as built):** `libs/playback/multiview/ui/src/lib/` —
`multiview-tile-chrome.component.*`, `multiview-paused-overlay.component.*`,
`multiview-bar.component.*`, `pip-drag.ts` (+ spec), `pip-pointer.ts`,
tile and stage changes, `multiview-chrome.spec.ts`; `web-player-tile-media.ts`
(D12 flag); 19 new `PLAYER.MULTIVIEW.*` keys in 21 locales; picture-in-picture
paragraph in `player-controls-contract.md`.

- [x] PiP tile at rest: picture and shadow only. On hover or keyboard focus:
      label (number, LIVE/VOD badge, title), swap (accent), sound here (only
      while muted), close; one resize handle in the corner facing the stage
      centre — the element that would sit in that corner steps aside. No
      side-by-side button (phase 2), no move handle, no pause button.
- [x] Drag by the whole tile, snapping to the corner whose quadrant holds
      the tile centre (L1); resize from the handle, both remembered in the
      session's PiP geometry and clamped to 240–480 px. A press without
      movement is a click. Double click and Enter swap (R3). Keyboard: arrows
      move between corners, + and − resize. The prototype's free-position
      math (`second-stream-position.ts`) did not apply: phase 1 snaps.
- [x] The chrome covers the tile, so engine clicks never reach the small
      tile's player.
- [x] Held VOD overlay (R4): play button (gives the tile the audio) and
      "Paused · 1:05:13", on any held tile, main included.
- [x] Bar, 48 px under the tiles inside the stage (the stage keeps the
      anchor's size, so the host layout does not change): chips with number,
      title and state (sound, muted, paused, error), audio chip outlined;
      layout switch with PiP only; "+ Channel" only while a picker exists;
      "Exit" (R8). The bar is part of the player area and stays dark in both
      themes, like the dock.
- [x] Accessibility (spec 13): each tile is a region named "Tile N: title,
      state"; the PiP chrome is focusable with the keyboard hint as
      description; a polite live region announces the new main tile;
      `prefers-reduced-motion` turns off the tile transitions (L6).
- [x] D12: tile videos get `disablePictureInPicture`, so the main tile's dock
      shows no system PiP button.
- Placement: the 96 px dock clearance of the bottom corners is kept: in the
  app the PiP's bottom edge sits above the dock's two rows, as the prototype
  shows for its one-row dock.

**Tests:** `pip-drag.spec.ts` (19), `multiview-chrome.spec.ts` (15: chrome,
drag snap, click vs drag, resize, keys, held overlay, bar, exit, picker
button), tile media +1; `playback-multiview-ui` 56, `ui-playback` 1773,
data-access 75; lint, icon ligatures, `pnpm run i18n:check`,
`typecheck:web`, `typecheck:spec`, `electron-backend:build-e2e`.
**Detail pages check (after Task 11, Xtream mock movie and series, both
themes):** three defects found and fixed:
- the inline player's title row ("Now playing", copy, Close player) hid
  itself during a session, because its idle timer only sees pointer
  activity over the viewport the stage now covers — it stays visible while
  the inline player's anchor owns a session;
- the stage had square corners over the detail page's rounded player — the
  stage viewport now takes the border radius of the box that clips the
  anchor;
- after a session the inline player restarted its title from the original
  start instead of where its tile was (R7) — `MultiviewAnchor.resumePosition`
  keeps the own tile's last VOD position, and the inline player starts there
  while it plays the same source. Live views do not bind it: their existing
  spec stubs have no `startTime` input, so catch-up and M3U movie files in
  the live players still restart after a session (known phase 1 limit).
Movie resume verified live (held at 6.0 s, continued from there). The
series run was blocked by the public test stream the mock redirects series
to (HTTP 522); its start time was verified to be the tile's position.

**Live check (temporary probe, local M3U, Electron, light and dark):** hover
chrome, held VOD overlay after swap, drag to the top-left corner, no PiP
button in the main tile's dock, no console errors. One defect found and fixed
on the way: the resize handle overlapped the label of a bottom-right tile.

### Task 12: Tile error state (R-E)

**Files:** `multiview-error-card.component.*`, `multiview-error-copy.ts`
(+ specs) in the UI project; `connection-limit.ts` (+ spec), `scenarios.ts`,
`server.ts` and `get-account-info.handler.ts` in the Xtream mock.

- [x] Error card with title, one-sentence cause from the tile's diagnostic
      (explicit wording when the budget says `active_cons >=
      max_connections`), actions "Replace main tile", "Choose another source"
      (only while a picker is provided), "Close".
- [x] Mock: the `limit:limit` account allows one connection; a further live
      stream gets 403 while the other was requested within 20 s, and
      `user_info` reports `max_connections` and `active_cons`. Other accounts
      are unchanged (only `active_cons` is computed for limited scenarios).

**As built:**
- The card is drawn by the stage, not inside the tile: a 240 × 135 tile
  cannot hold a title, a cause and three buttons, and the prototype's card is
  larger than the tile. It grows from the PiP's corner (400 px wide, at most
  the tile area minus 2 × 16 px, never narrower than the tile), so it covers
  the failed video and not the main tile's centre. Player palette, both
  themes; `role="alertdialog"` named by its title.
- It shows for a PiP tile whose player reports a diagnostic
  (`diagnosticChanged`, re-emitted by the tile) or whose status is `error`;
  a failing main tile keeps its own player's diagnostic panel. It goes away
  when the diagnostic clears.
- Cause mapping: network and browser-access → "could not be reached …
  refused another stream"; container, codec, decode and DRM → format; other →
  "stopped unexpectedly". The budget input exists; Task 13 supplies it.
- "Replace main tile" moves the audio to the failed tile and removes the main
  one, so the session ends with the failed source as survivor — one stream
  instead of two. Adopting it follows D2: a source the view cannot select
  falls back to the anchor's own channel (the Task 14 navigator port closes
  this).
- Keys `PLAYER.MULTIVIEW.ERROR_*`, `REPLACE_MAIN`, `CHOOSE_ANOTHER` in 21
  locales; "Close" reuses the root `CLOSE`.

**Tests:** `multiview-error-copy.spec.ts` (8), `multiview-error-card.component.spec.ts`
(3: corner placement and clamping, picker replace, budget wording), stage spec
+6 (card on a PiP diagnostic, on `error` status, not for the main tile, clears
on recovery, Close, Replace main); `connection-limit.spec.ts` (5).
`playback-multiview-ui` 74, `xtream-mock-server` 116; lint, icon ligatures,
`pnpm run i18n:check`, `typecheck:web`, `typecheck:spec`,
`electron-backend:build-e2e`.
**Live check (temporary probe, Xtream mock `limit:limit`, Electron, both
themes):** the first channel plays, a second added stream gets 403 and the
card appears at the PiP corner with the network cause, and the bar chip
shows the warning icon. "Replace main tile" ends the session. One defect
found and fixed: the card was 438 px wide (content-box padding).

### Task 13: Connection budget and picker data

**Files:** new project `libs/workspace/multiview/feature` —
`connection-budget.ts`, `connection-budget.service.ts`,
`multiview-picker-row.ts`, `multiview-picker-sections.ts`,
`multiview-picker-epg.ts`, `multiview-picker-data.service.ts`,
`multiview-picker-search.ts`, `multiview-picker-search.service.ts`,
`multiview-tile-resolver.ts` (+ specs); `multiview-catalog.service.ts`
(`portal-shared-data-access`) and `stalker-itv-genre-loader.ts`
(`portal-stalker-data-access`) ported with their specs; the budget port in
`multiview-ports.ts`; `multiview-workspace-ports.ts` in the shell.

- [x] Port `SecondStreamCatalogService` and `stalker-itv-genre-loader` from
      `agent/two-stream-mpv` with their specs (renamed to
      `MultiviewCatalogService`; behaviour unchanged) as the source for the
      "Playlists" section and for resolving a picked row.
- [x] Budget: Xtream `user_info` fetched on every request → `N free` /
      `full` badge and used/free meter segments; M3U, Stalker and panels
      without a positive `max_connections` → `limit ?`.
- [x] Live now is composed as two groups, "From favourites" then "More on
      air" (order per D9), each row carrying its programme once loaded;
      section entries expose their item count for the navigation.
- [x] Sections reuse existing sources only (spec 9.5 table).
- [x] Search: client filter over loaded rows in every runtime, plus the
      current Xtream playlist's films and series through
      `XTREAM_DATA_SOURCE.searchContent` (SQLite in Electron, cached catalog
      in the PWA — chosen by the data source provider, not `window.electron`).
- [x] Resolver: live through the catalog (`StreamResolverService`, which
      covers Xtream URLs and Stalker `create_link`); Xtream films through
      `VodSourceResolverService`.
- [x] Parental lock (R11), "In tile N", radio excluded.

**As built:**
- Ported files keep the prototype's behaviour; only names changed and one
  non-null assertion became optional chaining. `MultiviewCatalogService` is
  at 365 counted lines (over the 300 target, under the 400 limit).
- **Budget to the error card:** `MULTIVIEW_CONNECTION_BUDGET` port in
  data-access. The shell provides it through
  `provideMultiviewWorkspacePorts()`, which loads the feature with a dynamic
  `import()` on first use (no initial-bundle or J1 change). The stage asks
  for the failed PiP tile's playlist once per failure; a spent budget turns
  the card into "Connection limit reached — {playlist} allows {max} streams".
  Task 14 adds the picker port to the same provider.
- **Rows:** `pickerSessionKey` uses `createPlaybackSessionKey` with the
  provider id the live views use (Xtream stream id, Stalker id, M3U channel
  id), so a picked channel and the same channel in its view are one tile.
  "In tile N" also matches by playlist and provider id of the same kind, or
  by stream URL, because some views key their playback differently.
- **Sections:** Live now = favourite live rows, then recent live rows, then
  the current playlist (D9), each channel once. Continue = recently viewed
  Xtream films with a resume point (position > 0, not watched, under 95 %),
  at most 20 checked per open. Favorites and Recent list every type; series
  rows have no tile kind and open their episodes (Task 14). Playlists = the
  current playlist's live channels with its groups for the category menu
  (Q2). A failing source is just empty.
- **R11:** live rows go through the catalog's `isAllowed` (parental lock,
  unavailable catalog rows), like the channel lists; films and series as
  the Favorites and Recent pages show them, which do not filter by category
  lock, but nothing is listed while the lock store withholds everything.
  The catalog applies hidden groups; the data source search excludes hidden
  categories and locked content itself.
- **EPG (Q1):** `MultiviewEpgAllowance` requests at most 20 visible live
  rows per open, each once; `StreamResolverService.loadEpgForItems` loads
  them.
- **Default section:** next to a film Live now, next to a channel Continue,
  then the last used section.
- **Known phase 1 limits:** Continue lists Xtream films only; Stalker and
  M3U films and all series episodes cannot be resolved into a tile yet
  (`MultiviewUnresolvableError`). Search does not query EPG programme text in
  SQLite; "On air now" matches the programme lines the picker loaded.

**Tests:** `workspace-multiview-feature` 58 (row identity and "In tile N",
section composition and D9 order, R11 and radio filtering, default section,
budget parsing, badge and meter, budget service, EPG cap, continue filter,
data loading with failing sources, search grouping and the data source
search, resolver for live, film with R9 saving and refusals); shell port
spec (lazy load); stage +1 (limit wording from the port); ported catalog and
genre loader specs (`portal-shared-data-access` 358, `portal-stalker-data-access`
748). Lint, `typecheck:web`, `typecheck:spec`, `coverage:tools:test`,
`agents:validate`.
**Live check (temporary probe, Xtream mock `limit:limit`, Electron):** the
second stream is refused and the card reads "Connection limit reached …
allows 1 streams at a time".

### Task 14: Picker dialog and entry points

**Files:** in `workspace-multiview-feature`:
`multiview-picker-dialog.component.*`, `multiview-picker-row.component.*`,
`multiview-picker-controller.ts`, `multiview-picker-list.ts`,
`multiview-picker-context.ts`, `multiview-picker-playlist.ts`,
`multiview-on-screen.ts`, `multiview-series-episodes.service.ts`,
`multiview-picker-launcher.service.ts` (+ specs); in the shell
`multiview-workspace-ports.ts`; in data-access `MultiviewEntryService.usePicker`,
`MultiviewTileSource.reopen` and the boolean `adopt()` contract (the four
hosts follow it); `PLAYER.MULTIVIEW.PICKER.*` in 21 locales.

- [x] Dialog on the shared `app-dialog-shell`, 820 px, contexts "add" and
      "replace" (slot context is phase 2). Header with the grid icon tile,
      title and the subtitle naming the main tile (or the replaced tile);
      search with the scope chip; navigation "Quick" (icons, counts) and
      "Playlists" (name, provider type, budget badge); type chips with
      counts; rows for live (logo or initials, name, programme · start–end ·
      playlist, progress bar, minutes or LIVE per D10), films (resume point)
      and series ("Episodes ›", the one drill-down); grouped search results;
      footer meter "<playlist>: N of M in use". No PiP / side-by-side toggle.
- [x] A full playlist stays selectable, its badge reads "full" and the
      playlist list shows the "probably won't start" banner.
- [x] Keyboard: the search field is a combobox over the list
      (`aria-activedescendant`); typing anywhere goes to it, ↑↓ move over
      enabled rows with wrap-around, Enter adds, Backspace leaves the
      episodes, Escape closes (Material). Clicking a section or a type chip
      returns focus to the search. Focus is trapped by the dialog.
- [x] Opened from the dock button, "+ Channel" and "Choose another source"
      (all through `MultiviewEntryService.pick`). The picked item is recorded
      in recently viewed through `PlaybackHistoryGate.defer` under the tile's
      own session key; the tile's player confirms it once the stream
      advances (R10, Q3).
- [x] D2 survivor: `adopt()` now returns whether the view took the survivor;
      when it did not (or the view has no `adopt`), the anchor calls the
      survivor's `reopen()`. Sources from the picker carry it: live rows
      navigate like "Open in playlist" (`getLiveCollectionPlaylistNavigation`),
      films and episodes to their detail page
      (`getUnifiedCollectionDetailNavigation`). This replaces the planned
      `MULTIVIEW_SURVIVOR_NAVIGATOR` port: the source knows its own way back.

**As built:**
- **Picker installation:** `MultiviewEntryService` is root-provided, so a
  token provided on the shell cannot reach it. The shell installs the picker
  at run time (`installMultiviewPicker()` in its constructor, before the
  outlet renders player views; `hasPicker` became a getter) and uninstalls it
  on destroy. The picker, like the budget port, loads the feature through a
  dynamic `import()` on first use: no initial-bundle or J1 change.
- **Default section:** the spec's rule (film → Live now, channel → Continue,
  then the last used section, remembered per app session in
  `MultiviewPickerMemory`). Deviation: until the viewer chose a section, an
  empty default gives way to Live now — in a fresh profile Continue is empty
  and the picker would otherwise open on "Nothing here yet".
- **"In tile N" before a session:** the view's own playback counts as tile 1
  (`MultiviewOnScreenSources`), so the channel that is already playing is
  disabled in the list instead of being offered as a duplicate.
- **Height:** the list area has a fixed 440 px (shrinking with the shell's
  cap), so the dialog does not jump between sections and results.
- **Series episodes:** Xtream only (`get_series_info`), in season/episode
  order, saved progress per episode, the most recently watched unfinished
  episode active; the tile resumes and saves progress like the series page
  (contentInfo `episode`). Other providers' series list no episodes.
- **Visual review fixes (live probe):** the minute badge became a tinted
  chip in the live colour (white on light red had too little contrast); a
  logo that fails to load falls back to the initials; under one minute the
  badge reads LIVE instead of `0′`; the busy icon `progress_activity` is not
  in the bundled font and became `autorenew`.
- Identical-to-English baseline: 6 entries that are correct as they are
  (es/nl "Series", fr "Sources", pl "limit ?").

**Tests:** `workspace-multiview-feature` 94 (dialog 14: contexts, default
section and the empty fallback, budget badge and meter, full warning,
keyboard over enabled rows, disabled click, resolve error, typing to search,
grouped search, episodes drill-down, section memory; row component 7; list
helpers; launcher 5 incl. R10 defer; episodes 4; on-screen sources 2);
`workspace-shell-feature` 401 (picker install/uninstall); anchor spec +2
(D2 reopen only when not adopted); entry service +1 (`usePicker`); host specs
assert the `adopt()` result. `dialog-shell.e2e.ts` / `dialog-accessibility`
unchanged. Lint, `typecheck:web`, `typecheck:spec`, `i18n:check`, icon
ligatures, `electron-backend:build-e2e`.
**Live check (temporary probe, Xtream mock, Electron, both themes):** the
dock button opens the picker with focus in the search; the playing channel
is "In tile 1"; Enter adds the next channel muted in the PiP; search groups
channels, films and series; a series opens its episodes; "+ Channel" opens
it again with Recent = 2 (R10) and both tiles marked; Escape closes; no
console errors.

### Task 15: Keyboard shortcuts

**Files:** `libs/ui/playback/src/lib/multiview-anchor/multiview-shortcuts.ts`
(+ spec), exported from the light entry `@iptvnator/ui/playback/multiview-anchor`;
`controls-shortcuts.ts` (`comesFromInteractiveTarget` extracted, behaviour
unchanged); anchor and `appMultiviewPlayer` (the anchor registration now
reports the view's player element); `workspace-shell.component.ts`
(`installMultiviewShortcuts()`); `keyboard-shortcut-definitions.ts`;
`docs/keyboard-shortcuts.md`; `player-controls-contract.md` (keyboard
ownership); `WORKSPACE.SHORTCUTS.ITEMS.MULTIVIEW_*` in 21 locales.

- [x] `Shift+M` opens the picker (without a session too, only when a picker
      is installed and the current anchor can start one); `S` swap; `A`
      audio to the active tile; `Esc` stays with the picker dialog and never
      ends the session. `Alt+1–4` is phase 2.
- [x] Same ignore rules as `ControlsShortcuts`: not from interactive targets
      (shared helper), not with Ctrl/Cmd/Alt, not while the player surface is
      `inert` or inside `[data-player-shortcuts-suspended]`. Plain `M` and
      digits are never taken.
- [x] Entries in the in-app shortcuts dialog (playback group, after Mute).

**As built:**
- **Location:** the plan put the service in the feature project, but the
  feature is a lazy chunk and `Shift+M` must work before it loads. The
  handler lives next to the anchor in `ui-playback` (light entry, which the
  shell may import statically), where it also reuses the player's
  interactive-target rule without a cycle with data-access.
- **Shift+M vs mute:** `ControlsShortcuts` mutes on `m` and `M`, so
  `Shift+M` muted before. The multiview listener runs in the capture phase
  on `document` and marks a taken key `defaultPrevented`, which
  `ControlsShortcuts` already skips. Where no picker is installed, Shift+M
  still mutes (unchanged).
- **Player surface:** the anchor placeholder during a session, else the
  element `appMultiviewPlayer` marks (new `player` in the anchor
  registration). A key is ignored without a connected surface.
- As with the player's own keys, a keypress while a list row or another
  control has focus is left to that control.

**Tests:** `multiview-shortcuts.spec.ts` (15: Shift+M with and without a
session, five refusals, chord refusals, interactive target, S and A, keys
left alone; with `ControlsShortcuts` attached: Shift+M opens without muting,
M still mutes, Shift+M still mutes without a picker); anchor spec +1 (player
element). `ui-playback` 1796, `workspace-shell-feature` 401,
`portal-shared-util` 381 (shortcut list ids stay unique); lint,
`typecheck:web`, `typecheck:spec`, `i18n:check`, icon ligatures.
`player-controls-keyboard.e2e.ts` unchanged.
**Live check (temporary probe, Xtream mock, Electron):** Shift+M opened the
picker and the main video stayed unmuted; Escape closed it without a
session; plain M muted; Shift+M + Enter started a session; S swapped the
tiles; Escape during the session kept both tiles; no console errors.

### Task 16: Channel-list badges, Alt+click, drag

**Files:** `channel-list-item.component.{ts,html,scss}` (a `multiviewTile`
signal and the badge, nothing else), `multiview-channel.directive.ts` (+ spec)
in `ui-components`; row mappers `m3u-multiview-channel.ts`,
`xtream-multiview-channel.ts`, `stalker-multiview-channel.ts` (+ specs) and
`provideUnifiedLiveMultiview()`; in data-access `multiview-collection-identity.ts`
(moved from the feature), `multiview-channel-drag.ts` (+ spec), the
`MultiviewChannelResolver` port and `MULTIVIEW_CHANNEL_MAPPER` token,
`MultiviewEntryService.useChannelResolver/addChannel/replaceWithChannel`;
drop targets on the tile, the bar and `appMultiviewPlayer`;
`MultiviewChannelAdder` in the feature; the shell installs it with the picker;
`CHANNELS.MULTIVIEW_TILE*` in 21 locales.

- [x] Badge with the tile number and a speaker for the audio tile, only while
      the channel is on screen in a session (spec 9.4).
- [x] Alt+click adds the channel as a tile (R5) instead of selecting it; a
      normal click keeps today's path.
- [x] Drag: native drag source on live rows; a drop on a tile replaces it,
      on the multiview bar adds, on the view's own player (no session yet)
      starts multiview. No conflict with `cdkDrag`: rows of a list that
      reorders (favourites) get no native drag.
- [x] The hint card under the channel list is not built (D8).
- [x] UI skills read first (channel rows are a guarded surface).

**As built:**
- **One attribute per list:** the nine row hosts (M3U all / groups /
  favourites / recent, Xtream live list, Stalker layout and "All items",
  Favorites / Recent live tab) add `[appMultiviewChannel]="row"` to
  `<app-channel-list-item>`; each list container provides one
  `MULTIVIEW_CHANNEL_MAPPER` that turns its row into the collection item the
  picker resolves (M3U through the active playlist, Xtream with the provider
  category id the lock keys by, Stalker with its `cmd` for `create_link`,
  unified rows by uid). Without a mapper — or without the real row
  component, as in specs that stub it — the directive does nothing: no
  badge, no listeners, no `draggable`.
- **Alt+click** is taken in the capture phase on the row host, before the
  row's own click handler, only while `canAddChannel()` (a resolver is
  installed and the anchor can start or extend a session); otherwise it
  falls through to the normal click. The row's `clicked` output and its
  double-click / keyboard paths are untouched.
- **Resolution** goes through `MultiviewChannelAdder` (lazy feature): the
  picker's resolver, so R11 (catalog lock check before and after) and R10
  (history deferred under the tile key) are the same as for the picker.
  Radio rows and non-live rows map to nothing.
- **Identity:** the badge uses the same `tileNumberFor` as the picker's
  "In tile N", now in data-access so lists need no lazy chunk.
- **Drag:** the data transfer carries only a token (`MultiviewChannelDrag`);
  drop targets highlight with the player accent while a channel is over
  them.
- A transient "worker failed to exit gracefully" Jest warning appeared once
  in a parallel `run-many`; it does not reproduce per project.

**Tests:** directive 6 (badge with and without sound, Alt+click adds and
does not select, plain click unchanged, Alt+click falls through when
unavailable, drag only without `cdkDrag` reordering, no mapper = no
change); drag carrier 5; entry service +4; mappers (Xtream 5, Stalker 3,
M3U 2, unified 1); channel adder 3; stage +2 (drop on tile replaces, on bar
adds); shell install +1. Existing list specs unedited (the Stalker layout
spec stubs the row; the directive stays inert there). `components` 543,
`portal-xtream-feature` 740, `portal-stalker-feature` 601,
`portal-shared-ui` 276, `ui-playback` 1796, `playlist-m3u-feature-player`
192; lint (module boundaries) on 9 projects, `typecheck:web`,
`typecheck:spec`, `i18n:check`, icon ligatures,
`electron-backend:build-e2e`.
**Live check (temporary probe, Xtream mock, Electron, both themes):** rows
are draggable while a channel plays; Alt+click on the second row started
multiview with it muted in the PiP while the first row stayed selected;
badges "1 + speaker" and "2"; dragging the third row onto the PiP replaced
it and the "2" badge moved; no console errors. M3U, Stalker and the
Favorites tab are covered by unit tests only.

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
