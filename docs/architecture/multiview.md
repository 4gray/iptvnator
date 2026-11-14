# Multiview

Multiview plays a second stream next to the one a player view already plays
(phase 1: picture in picture). This is the canonical contract of the
implementation; the behaviour rules (R1–R11, D1–D12) come from the spec
`docs/superpowers/specs/2026-11-12-multiview-design.md`, and the phase 1 plan
with its as-built notes is `docs/superpowers/plans/2026-11-12-multiview-phase-1.md`.

With no session the app behaves exactly as before: every multiview hook is
opt-in, and existing specs and e2e flows run unchanged.

## Projects

| Project | Owns |
| --- | --- |
| `playback-multiview-data-access` | The session (pure reducer, selectors, behaviour constants, `MultiviewSessionStore`), the anchor registry, `MultiviewEntryService`, the ports (picker, connection budget, channel resolver, row mapper), collection-item identity (`pickerSessionKey`, `tileNumberFor`) and the channel drag carrier |
| `playback-multiview-ui` | The stage, tiles, tile chrome, paused overlay, error card, multiview bar, PiP geometry; a lazy chunk |
| `ui-playback` (`@iptvnator/ui/playback/multiview-anchor`) | The anchor a player view creates, its placeholder, `appMultiviewPlayer`, the keyboard shortcuts; tile mode on `WebPlayerViewComponent` |
| `workspace-multiview-feature` | The source picker dialog and its data (sections, search, EPG allowance, series episodes), the tile resolver, the Xtream connection budget, the channel adder; a lazy chunk |
| `ui-components` | `appMultiviewChannel` on channel rows (badge, Alt+click, drag) |

Boundaries are listed in `docs/architecture/nx-workspace-boundaries.md`.

## Session

`MultiviewSessionStore` holds one session: ordered tiles (the first is the
main tile), the layout (`pip` only in phase 1, capacity 2 — D1), the audio
tile, the active tile, PiP geometry, and the owning anchor. Every change goes
through `reduceMultiviewSession`; effects (`started`, `replaced`, `ended`
with a survivor, `rejected`) are published as `notice`. A session ends when
one tile is left, on Exit, when the anchor view leaves, or when Settings
select MPV, VLC or embedded MPV.

- New tiles start muted (R2) at the viewer's saved volume; exactly one tile
  has sound. A mute alone (the session's or the viewer's) never rewrites the
  saved volume.
- A VOD or episode tile without sound is held paused at its position (R4).
- No next-episode autoplay while a session exists (D11).
- A parental relock withholds the tiles whose source became locked.

## Anchors

A player view takes part by creating an anchor:

```ts
readonly multiviewAnchor = injectMultiviewAnchor(createXxxMultiviewHost(...));
// providers: [provideMultiviewAnchor(() => inject(View).multiviewAnchor)]
```

and in its template showing either its player (marked `appMultiviewPlayer`)
or, while the session is its own, `<app-multiview-anchor-placeholder>`. The
host describes the playing source (`MultiviewTileSource`: playback, session
key, kind, playlist, provider content id, title) and its engine, and may
`adopt()` a survivor; `adopt()` returns false when the view cannot show it,
and the survivor's `reopen()` then opens it in its own view (D2). Anchors:
Xtream live, M3U player, Stalker live, the Favorites / Recently viewed live
tab and the portal inline player (movie and series details).

Tile 1 continues the view's VOD from its position (R1); after the session the
view resumes its own source where its tile was (`resumePosition`, R7). A
live host also gives its source the channel's row item (`lockItem`), so a
tile the view played stays under parental relocks after the view moves on.
When the view's player slot goes away for its own reason (a radio channel
selected), the session ends without handing the survivor back: the view's
new selection stands.

## Stage

The workspace shell creates the stage lazily inside the content frame the
first time a session starts (`hostMultiviewStage`) and positions it over the
owning anchor's placeholder (`StageRectTracker`), clipped to the content
area and inert with it. Tiles are rendered in stable creation order and only
move by CSS, so swap and audio changes never remount a player. The 48 px bar
under the tiles shows a chip per tile, the layout control (PiP only), "+
Channel" (while a picker exists) and Exit.

The stage carries the anchor view's `data-player-shortcuts-suspended` marker
while the view has one (the M3U guide), so the tiles' player shortcuts stand
down as the view's own player would.

Tiles render `WebPlayerViewComponent` in tile mode (`controlsMode`, `muted`,
`paused`, `headerOwner`); added tiles use the HTML5 engine, tile 1 keeps the
view's engine. Tile videos never enter system picture-in-picture (D12), and
a tile's playback error offers no MPV or VLC handoff, only the built-in
recovery actions.

## Request headers

Each tile is its own header owner (`headerOwner` = tile id) in the Electron
main process (`request-header-overrides.service.ts`). A request matches by
exact URL first, then by origin with the most recently configured override
(D4); exactly one owner's override applies to a request, so one tile's
credentials never reach another tile's request. A tile without custom headers
keeps a header-free claim on its exact stream URL for the same reason. A
page's tiles are released when the page reloads, crashes or closes. A tile's playback therefore carries its source's User-Agent, Referer
and Origin; the picker's resolver adds them for Xtream live channels, whose
shared resolution leaves them out.

## Entry points

`MultiviewEntryService` is root-provided; the workspace shell installs the
picker and the channel resolver at run time (`installMultiviewPicker()`), so
both load the feature chunk on first use and add nothing to the launch path.
Views read `hasPicker` when created; the shell installs before rendering
them.

- Dock button "Multiview" (`PLAYER_MULTIVIEW_ACTION`, disabled with a reason
  for MPV/VLC/embedded MPV), `Shift+M`, "+ Channel", and the error card's
  "Choose another source" open the picker (`MultiviewPickerLauncher`).
- Channel rows (`appMultiviewChannel` + `MULTIVIEW_CHANNEL_MAPPER` per list):
  Alt+click adds, a drop on a tile replaces it, on the bar adds, on the view's
  own player starts a session (R5). Lists that reorder rows with `cdkDrag`
  get no native drag.
- Keys (`installMultiviewShortcuts`): `Shift+M` picker, `S` swap, `A` sound
  to the active tile, under the player's keyboard-ownership rules; a taken
  `Shift+M` is not a mute. See `player-controls-contract.md`.

Every way in resolves a row through `MultiviewTileResolverService`: M3U and
Stalker channels through the catalog (parental lock checked before and
after, R11), Xtream items checked by stream id through the data source
(`MultiviewXtreamLock`, which applies the lock itself, so stored and provider
category ids cannot be confused) before and after resolving,
Xtream films through `VodSourceResolverService` resuming at their position,
Xtream episodes from the picker's episode list; tiles read and save
progress like their own players, through the runtime's position store
(`PORTAL_PLAYBACK_POSITIONS`, R9). A picked or dropped item is recorded in recently
viewed through `PlaybackHistoryGate`, confirmed once the tile plays (R10).

A parental relock stops every tile whose item is now withheld
(`MultiviewRelockGuard`): tiles added from the picker or a list, and tiles a
view played before it moved on (their `lockItem`); the tile playing the
view's current selection follows its view. An add that replaces a tile at
capacity shows "Replaced tile N" with Undo (R6); a drop on a tile or
"Choose another source" replaces it directly.

## Picker

An 820 px dialog on `app-dialog-shell`: search with a scope chip, sections
Live now (favourites, then recent, then the current playlist — D9), Continue
(Xtream films with a resume point), Favorites, Recent, and the current
playlist only (Q2) with its connection badge and a category menu (a portal
that lists channels per group only loads one group at a time); grouped
search results (at most 50 films and 50 series from an Xtream playlist's
catalog); series episodes as the one drill-down; footer connection meter.
EPG is requested for at most 20 visible rows per open (Q1). Rows already on
screen show "In tile N" and are disabled; before a session the playing
source counts as tile 1.

## Errors and connection budget

A failed small tile shows an error card at its corner with a cause from the
player's diagnostic, or "Connection limit reached" when the playlist's
budget is spent, and the actions Replace main tile, Choose another source
and Close. The budget (`ConnectionBudgetService`) reads Xtream `user_info`
(`max_connections`, `active_cons`) on every request; M3U, Stalker and panels
without a positive limit show "limit ?".

## Phase 1 limits

- PiP only; side by side, grid and focus, `Alt+1–4`, the minimised mini
  player and Embedded MPV tiles are later phases.
- A film or episode the details page played and then left (another
  episode) is not rechecked on a relock; live views are.
- Continue lists Xtream films only; series episodes exist for Xtream only;
  Stalker and M3U films cannot become tiles.
- The main tile's fullscreen covers that tile only.
- The remote control keeps addressing the view's own selection during a
  session (channel steps, status, volume), not the active tile.
- Two tiles on one host with different headers cannot be told apart for
  requests their URLs do not identify (D4).

## Validation

- Unit: `pnpm nx test playback-multiview-data-access`,
  `pnpm nx test playback-multiview-ui`, `pnpm nx test workspace-multiview-feature`,
  plus the anchor, shortcut and tile-mode specs in `ui-playback` and the
  host and list specs of each provider.
- Electron: `pnpm nx run "electron-backend-e2e:e2e-ci--src/multiview-pip.e2e.ts"`
  (dock picker, swap, leaving the view, Alt+click, drag, badges, error card,
  per-tile headers) on the Xtream mock's `live-fallback` account with the TS
  stream format, which plays a local clip.
- Web: `apps/web-e2e/src/multiview-pip.e2e.ts` (PiP start and swap); run it
  as described in the validation map.
- Mock: the `limit:limit` Xtream account allows one connection and refuses a
  further live stream with 403 (connection-limit error card).
