# Multiview (PiP, side by side, 2×2, focus 1+3) — Design

Date: 2026-11-12, against `master` at `9960c4801`.
Status: approved by the maintainer (UX mockup, decisions in section 5, open
questions resolved in section 16). Next step: implementation plan for phase 1.

Mockup: Claude Design project "iptvnator", page **IPTVnator Multiview
concept** (prototype with 9 steps, source picker v2, library entry, audit of
the earlier sketch). It is the visual reference for every screen named here;
this document is the behavioural contract.

## 1. Summary

Watch up to four streams at once without leaving the player. The core
scenario: a movie plays, a football match starts, the match goes into a
picture-in-picture tile in the corner; on a goal the two swap with one click,
the movie pauses itself and later resumes from the same position. From there
the user can switch to side by side, a 2×2 grid or a "focus 1+3" layout.

Nothing of this exists in code yet. The feature is new and additive.

## 2. Scope boundary (read first)

1. Only multiview is built. Existing screens, players, controls and
   shortcuts keep their current behaviour **byte-for-byte when no multiview
   session is active**. Every change to shared code is an opt-in extension
   point (new optional input, new optional action) with a default that
   reproduces today's behaviour.
2. Touching shared code is allowed only at the integration points listed in
   section 11. Anything else that "could be improved on the way" is out of
   scope and goes into a separate issue.
3. Platforms: Electron and the PWA (`apps/web`). The TV app (`apps/tv`,
   Tizen/webOS) is not touched.

## 3. Goals

1. Add a second (third, fourth) stream from the player in at most two clicks,
   or one Alt+click from the channel list.
2. Swap main and PiP instantly; the stream that loses audio and is VOD pauses.
3. Exactly one tile has audio at any time; audio moves independently of size.
4. Four layouts: PiP, side by side, 2×2, focus 1+3; switching never re-creates
   a playing `<video>`.
5. Navigating away does not kill the session: it collapses into a mini-player
   (phase 3).
6. Connection limits are visible before adding (Xtream) and failures are
   explained inside the tile with actions.

## 4. Non-goals

- TV app and remote-control-first interaction.
- Multiview with MPV, VLC or Embedded MPV (see 5.2).
- A Settings UI for multiview behaviours (see 5.4).
- Restoring a session after app restart (only VOD positions persist).
- More than four tiles; mixing audio of several tiles; synchronised playback.
- Per-tile recording, per-tile system picture-in-picture ("pop out").
- Radio (audio-only) channels as tiles.
- Any redesign of existing player controls, channel lists or dialogs.

## 5. Decisions taken with the maintainer

1. **Platforms:** Electron + PWA. TV untouched.
2. **Engines:** tile 1 (the stream that was playing when the session started)
   keeps the engine chosen in Settings (`videojs`, `html5`, `artplayer`).
   Every added tile always uses the built-in HTML5 player
   (`WebPlayerViewComponent` with `playerOverride = VideoPlayer.Html5Player`),
   whatever the setting. When the selected player is `mpv`, `vlc` or
   `embedded-mpv`, the multiview button stays visible but disabled with a
   tooltip "Available with the built-in player".
3. **Shortcuts** (existing `M` = mute and `0-9` = M3U channel number stay
   unchanged):

   | Shortcut | Action |
   | --- | --- |
   | `Shift+M` | Open the source picker (start / add to multiview) |
   | `S` | Swap main and PiP tile (PiP layout); in other layouts swap active tile with the first |
   | `A` | Move audio to the active tile |
   | `Alt+1` … `Alt+4` | Make tile N active (match on `event.code` `Digit1-4`: on macOS Alt+digit produces other characters) |
   | `Esc` | Close picker / exit fullscreen; never ends the session |

   Shortcuts are active only while a session exists (except `Shift+M`, which
   starts one) and follow the keyboard ownership rules in
   `player-controls-contract.md` (not while typing in inputs).
4. **Behaviour settings are hard-coded** in phase 1–3:
   - VOD tile without audio is paused (on).
   - Live tiles without audio are stopped while the session is minimised to
     the mini-player (on).
   They live as named constants in the session store so a Settings toggle can
   be added later without refactoring.
5. **Phasing:** four phases (section 14). Each phase ships on its own.

## 6. Vocabulary

- **Session** — one per app. Holds 1–4 tiles, a layout, the active tile and
  the audio tile. Exists while at least two tiles exist or while minimised.
- **Tile** — one playing source: `ResolvedPortalPlayback` + identity
  (`playbackSessionKey`), kind (`live` | `vod` | `episode`), source playlist,
  status (`loading` | `playing` | `paused` | `stopped` | `error`), last VOD
  position.
- **Main tile** — the large tile in PiP layout and in focus 1+3.
- **Active tile** — receives list clicks, shortcuts and the full control dock.
  Shown with a blue ring in split / grid / focus. In PiP the main tile is
  always the active one, no ring.
- **Audio tile** — the only unmuted tile. Independent of active / main.
- **Anchor** — the element in a player view where the player normally sits.
  The multiview stage is positioned over it.
- **Slot** — an empty position in grid / focus layouts.

## 7. Behaviour rules

R1. Starting: picking a source in the picker (or Alt+click / drag of a channel
onto the player) while a single player plays creates a session: tile 1 = the
current playback (same playback, current position, same engine), tile 2 =
the new source in PiP, muted, bottom-right corner.

R2. Audio: exactly one tile is unmuted. New tiles always start muted. Audio
moves with the speaker button on a tile, `A`, or as part of swap.

R3. Swap (PiP): double-click on the PiP tile, its swap button, or `S`. Sizes
and audio exchange. The former main, if VOD, pauses (R4).

R4. VOD pause: a VOD/episode tile without audio is paused and shows its
position ("Paused · 1:05:13"). It resumes from that position when it gets
audio again. Live tiles never pause on their own.

R5. List click targets the active tile: a normal click on a channel in any
channel list replaces the active tile's stream. Alt+click adds the channel as
a new tile (PiP when one tile, next free slot otherwise). Dragging a channel
onto a tile replaces that tile; onto empty player space or a slot adds it.

R6. Max four tiles. When four exist, "add" actions replace the active tile
after a confirmation toast ("Replaced tile 2 · Undo").

R7. Closing a tile: its × removes it. With one tile left the session ends and
the remaining tile becomes the normal single player (same engine rules as R1;
if it was an HTML5 added tile it may be re-mounted with the user's engine at
the current position — one rebuffer is acceptable).

R8. "Exit" in the multiview bar keeps the audio tile, closes the others.

R9. Positions: every VOD/episode tile saves its position through the existing
`PlaybackPositionService` exactly like single playback.

R10. History: a tile added by the user is recorded in recently viewed like a
normal playback start (through the existing history gate). Background
reconnects are not new history entries.

R11. Parental lock and hidden categories apply to the picker and to Alt+click
exactly as they apply to the source lists.

R12. Keep-awake: display sleep is blocked while any tile plays.

R13. Remote control, media keys and the shared control dock act on the
active tile.

## 8. Layouts

All geometry is relative to the multiview stage (= anchor rect, or the whole
content frame in split / grid / focus, see L5).

L1. **PiP.** Main tile fills the stage. PiP tile is 16:9, default width 30 % of
the stage (min 240 px, max 480 px). It snaps to the four corners of the
stage with 16 px inset, above the control dock area. Drag by the whole tile
(no separate move handle). Resize from the one corner facing the stage
centre. Remember the last corner and size for the session.

L2. **Side by side.** Two equal 16:9 tiles centred, 8 px gap.

L3. **Grid 2×2.** Four equal cells; missing tiles are slot cards
("Add channel", also a drop target). Tiles ≥ 3 can only be added in grid or
focus.

L4. **Focus 1+3.** Main tile large on the left, up to three small tiles in a
column on the right; empty positions are slot cards. Click on a small tile
promotes it to main (animated, like swap).

L5. In split / grid / focus the workspace context panel (channel list)
collapses automatically and the stage uses the full content frame; a header
button reopens the panel. Returning to PiP or single restores the panel state
from before.

L6. Layout changes animate tile rects (FLIP, ~450 ms). With
`prefers-reduced-motion` they switch instantly. Playing `<video>` elements are
never re-created by a layout change.

L7. Fullscreen (`F` / dock button) puts the whole stage in fullscreen; the
multiview bar hides with the controls.

## 9. UI elements

### 9.1 Entry point

A "Multiview" icon button (grid icon, not the system PiP icon) in the shared
control dock, right group, next to fullscreen. Tooltip "Multiview · Shift+M".
Present only in the embedded web players; disabled per 5.2. It opens the
source picker.

### 9.2 Tile chrome

- Main / active tile in PiP and focus: the normal control dock of that tile.
- Small tiles (PiP, focus column) at rest: no chrome (like today's sketch,
  screenshot 4). On hover / focus: four buttons — swap, audio here,
  side by side (phase 2+), close. No move handle, one resize corner.
- Grid / split tiles: label top-left (tile number, LIVE/VOD badge, title) and
  speaker button bottom-right. The full dock appears on the active tile only.
- Paused VOD overlay: play icon + position.
- Error overlay (R-E below).

Requires a new optional input on `WebPlayerViewComponent` to render reduced
chrome (`controlsMode: 'full' | 'minimal' | 'none'`, default `'full'`).

### 9.3 Multiview bar

A 52 px bar under the stage (inside the player view in PiP, at the bottom of
the content frame in other layouts): tile chips (number, title, state icon —
audio / paused / error), layout segmented control (PiP, side by side, 2×2,
1+3; phase 1 shows PiP only), "+ Channel" (opens picker), "Exit" (R8).
Uses the shared `.seg` and button kit from the UI-kit spec.

### 9.4 Channel list badges

While a session exists, rows of channels that are on screen show a small
badge with the tile number and a speaker icon for the audio tile. Applies to
the live lists of M3U, Xtream and Stalker and to the unified live tab.

### 9.5 Source picker (v2)

One dialog, opened from: the dock button, "+ Channel", a slot card, or
"Replace" on a tile. Shell: the shared dialog shell (`ipt-dialog`), 820 px.

Context changes only title, subtitle and the action label:

| Context | Title | Action label |
| --- | --- | --- |
| add from single / PiP | "Add to multiview" | "PiP" / "Side by side" (footer toggle) |
| empty slot | "Tile N · 2×2" | "To tile N" |
| replace | "Replace tile N" | "Replace" |

Layout:

- Search field on top: channels, current programmes, movies, series.
  Scope chip shows "everywhere" or the selected playlist.
- Left navigation, "Quick": **Live now**, **Continue**, **Favorites**,
  **Recent**. "Playlists": each playlist with type and a connection badge
  (`N free` / `full` / `limit ?`).
- Right list with type chips (All / TV / Movies / Series; in a playlist:
  TV / Movies / Series + category menu).
- Rows: live = logo, name, current programme + progress, minute badge;
  movie = poster, title, year/genre, resume progress; series = poster,
  title, next episode ("continue S02E05 from 12:40"), button "Episodes ›" (the
  only drill-down: seasons + episode list). Items already on screen are shown
  disabled with "In tile N".
- Search results grouped: "On air now" (programme matches), "Channels",
  "Movies", "Series".
- Footer: connection budget of the relevant playlist; in add context the
  PiP / side-by-side toggle.
- Default section: if the main tile is VOD → Live now; if live → Continue;
  afterwards the last used section.
- Keyboard: typing goes to search, ↑↓ moves, Enter adds, Shift+Enter adds side
  by side, Esc closes.

Data sources (reuse, do not duplicate):

| Section | Source |
| --- | --- |
| Favorites | `UnifiedFavoritesDataService` / `GlobalFavoritesService` |
| Recent | `UnifiedRecentDataService` |
| Continue | `PlaybackPositionService` + dashboard continue-watching utils (`dashboard-playback.utils.ts`) |
| Live now | favorites live + recent live + current playlist channels, EPG line via `StreamResolverService.loadEpgForItems` (bounded to visible rows) |
| Playlists | current playlist from its store; other playlists see open question Q2 |
| Search | Electron: the SQLite global search (incl. EPG programme search where available); PWA: client-side filter over the loaded sections |
| Resolve to playback | `StreamResolverService` (`resolvePlayback`, `resolveLiveDetail`, `resolveM3uPlaybackDetail`), Xtream `XtreamUrlService`, Stalker session `create_link` |

### 9.6 Error state (R-E)

A tile that fails shows, inside the tile: icon, plain-language title
("Provider refused a second stream"), one sentence of cause (from playback
diagnostics; for Xtream with `active_cons >= max_connections` say so
explicitly) and actions: "Replace main tile" (stop tile 1, play this one
instead), "Choose another source" (picker in replace context), "Close".

## 10. Navigation and transitions

| Event | Phase 1–2 | Phase 3+ |
| --- | --- | --- |
| Leave the anchor's route (dashboard, favorites, another section) | Session ends; VOD positions saved | Collapses to mini-player (10.1) |
| Switch playlist | Same as above | Same as above; tiles from different playlists are fine |
| Click mini-player | — | Back to the anchor route of the active tile's playlist; layout restored; stopped live tiles reconnect |
| × on mini-player | — | Session ends; VOD positions saved |
| Play from details / search while a session exists | Normal behaviour (session already ended by navigation) | Replaces the active tile; toast "Replaced tile N · Undo" |
| "Exit" in the bar | R8 | R8 |
| Fullscreen | L7 | L7 |
| Esc | Closes picker / fullscreen only | same |
| App closed | Session lost, positions kept | same |
| Settings switched to MPV/VLC/Embedded MPV during a session | Session ends with a toast | same |

### 10.1 Mini-player (phase 3)

Bottom-right of the workspace content frame, 320×180, above any page content,
never over the rail. Shows the audio tile with chip "+N tiles", pause,
"return to player", ×. VOD tiles stay paused; live tiles without audio are
stopped (5.4) to free connections. Does not coexist with the external
playback session bar (they are mutually exclusive by 5.2).

## 11. Architecture and integration points

### 11.1 New code (new lib, e.g. `libs/playback/multiview`)

1. `MultiviewSessionStore` — signals store, `providedIn: 'root'`:
   `tiles`, `layout`, `activeTileId`, `audioTileId`, `anchor` (route + rect
   source), `minimised`, plus commands (`start`, `add`, `replace`, `remove`,
   `swap`, `setAudio`, `setActive`, `setLayout`, `exit`, `minimise`,
   `restore`). Pure rules (R2–R8) in a separately unit-tested reducer.
2. `MultiviewStageComponent` — hosted **once in the workspace shell** (from
   phase 1), positioned over the active anchor rect (ResizeObserver) or the
   content frame. Renders one `WebPlayerViewComponent` per tile; tiles keep
   their component instance across layout changes (track by tile id,
   absolute positioning).
3. `MultiviewAnchorDirective` — placed by player views around their player
   slot; while a session belongs to this view, the view renders the anchor
   instead of its own player and the stage covers it.
4. `MultiviewPickerDialogComponent` (9.5), `MultiviewBarComponent`,
   tile chrome, slot card, mini-player (phase 3).
5. `ConnectionBudgetService` — Xtream: fresh `user_info` (`max_connections`,
   `active_cons`) on picker open and before add; others: unknown.

### 11.2 Integration points in existing code (opt-in only)

1. **Electron request headers** — `ElectronStreamHeadersService` and the main
   process currently have exactly one scoped header override slot. Multiview
   needs one override per concurrently playing stream URL (map keyed by
   URL, released per owner). This is a prerequisite of phase 1 and must keep
   single-player behaviour identical. PWA: verify the web-backend proxy path
   handles concurrent streams with different headers.
2. `WebPlayerViewComponent` — new optional inputs `controlsMode` (9.2) and
   `muted`/`paused` control from outside; default behaviour unchanged.
3. Shared control dock (`libs/ui/playback/.../player-controls`) — optional
   "multiview" action, rendered only when a handler is provided.
4. Player views that host an anchor (phase 1): M3U
   `video-player.component`, Xtream `live-stream-layout`, Stalker
   `stalker-live-stream-layout`, `portal-inline-player` (VOD / series
   details and collections), unified live tab.
5. Channel lists — badges (9.4), Alt+click and drag source (R5).
6. `WorkspaceShellComponent` — hosts the stage and (phase 3) the mini-player;
   collapses the context panel in wide layouts (L5).
7. Keyboard — register shortcuts from 5.3 through the existing shortcut
   ownership mechanism; update `docs/keyboard-shortcuts.md` and the in-app
   shortcuts list.
8. i18n — new keys under `PLAYER.MULTIVIEW.*` in `en.json`; other locales per
   the repo's existing convention.

### 11.3 Takeover of the current player (R1)

On start, the view swaps its player for the anchor and the stage mounts tile
1 with the same `ResolvedPortalPlayback`, `playbackSessionKey`, engine and
current position. One short rebuffer of tile 1 at session start is accepted.
Recovery / diagnostics / history ownership move with the tile (each tile has
its own `playbackSessionKey`).

## 12. Connection budget

- Xtream: show `free = max_connections - active_cons` per playlist in the
  picker, refreshed on open. Adding to a full playlist is allowed but warned
  ("probably won't start"). The mock server already returns
  `max_connections: '2'`, `active_cons: '1'`.
- M3U and Stalker: "limit ?" badge; failures surface through R-E.
- Minimised sessions stop muted live tiles (5.4) and reconnect on restore.

## 13. Accessibility

Real buttons with accessible names for every tile action; tiles are focusable
regions labelled "Tile N, <title>, <live/paused/muted>"; the active tile is
announced on change; focus is trapped in the picker; contrast per the UI-kit
spec in light and dark themes.

## 14. Phases and acceptance criteria

### Phase 1 — PiP (MVP)

- Header override multi-slot (11.2.1) with tests proving single-player parity.
- Session store, stage in shell, anchors in the five player views.
- Entry: dock button, `Shift+M`, Alt+click / drag from live lists.
- Picker v2: Live now, Continue, Favorites, Recent, current playlist, search;
  add/replace contexts; connection badge for Xtream.
- PiP layout (L1), swap, audio, VOD pause/resume, close, Exit, bar with chips.
- Error state with actions.
- Channel list badges.
- Leaving the anchor route ends the session (positions saved).
- Done when: the movie → match → swap → swap back scenario works in Electron
  and PWA with Xtream mock, M3U and Stalker mock; with no session every
  existing unit and e2e test passes unchanged; light and dark checked.

### Phase 2 — Layouts

Side by side, 2×2, focus 1+3, active ring, `Alt+1–4`, slots, panel
auto-collapse (L5), stage fullscreen (L7), picker in slot context.

### Phase 3 — Session across navigation

Mini-player (10.1), stop/reconnect of muted live tiles, restore on click,
"Play elsewhere replaces active tile" with undo.

### Phase 4 — Library entry

On VOD / series detail heroes while a session exists: the Play button gets a
menu — "Play instead of tile N", "Add as PiP", "Add side by side",
"Replace tile N". Alt+click from global favorites / recent / search results.

## 15. Testing

- Unit: session reducer (all rules R1–R8, limits, swap with VOD pause),
  layout geometry, picker section composition, budget calculation, header
  slot map.
- Component: stage keeps tile instances across layout changes; anchor
  takeover; reduced chrome.
- E2E (Electron, `apps/electron-backend-e2e`): start PiP from the dock, swap,
  VOD resumes at position, Alt+click add, connection-limit error (extend the
  Xtream mock to refuse a stream when `active_cons >= max_connections`),
  leave route ends session (phase 1) / minimises (phase 3).
- E2E (PWA, `apps/web-e2e`): PiP start and swap.

## 16. Resolved questions

All three were accepted as proposed by the maintainer on 2026-11-12.

- Q1. "Live now" for providers without cheap bulk EPG: request EPG for
  visible rows only, at most 20 requests per picker open; other rows show the
  channel name only.
- Q2. Under "Playlists" phase 1 shows only the current playlist; other
  playlists are reachable through Favorites, Recent and search. The full list
  follows in phase 2.
- Q3. A tile is recorded in recently viewed when it is added (R10), not when
  it first gets audio.
