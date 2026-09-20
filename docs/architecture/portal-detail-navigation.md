# Portal Detail Navigation

This document records the current navigation contract for Xtream and Stalker detail flows, especially for favorites, recently viewed, search, and category content.

Related:

- [Embedded Inline Playback](./embedded-inline-playback.md)

## Detail Scroll and Focus

`PortalDetailShellComponent` is the single scroll owner for portal, collection,
M3U movie and offline detail surfaces. It is a named, focusable region with a
native scrollbar and stable gutter. Scrollbars follow the platform's visibility
policy; CSS must not hide them. Content that fits the pane needs no thumb.

On its first render, a browse shell takes focus only if it is still on the
page body or the enclosing workspace `main`; it does not steal focus from a
button, input, dialog or inert surface. Replacing a loading shell can hand off
page focus to the loaded shell, but metadata updates and browse/watch changes
do not refocus it. Initial watch playback keeps its existing focus behavior.
ArrowUp/Down, PageUp/Down, Home/End and Space on the shell scroll natively and
do not reach global player shortcuts. Descendant controls retain their native
keys and Tab order. Entering watch still scrolls to the top; Back and saved
catalog scroll positions retain the existing navigation contract below.

The shell owns a single sticky Back control, outside the collapsing hero. Its
zero-height wrapper is a direct child of the scroll owner, so the control stays
16 px from the top throughout long episode lists without shifting the hero.
The button has an opaque app-themed surface, visible keyboard focus, an Escape
shortcut hint via native `title` and Electron `no-drag` hit testing. The hint
does not create an overlay that could consume the first Escape press.

The sticky control is route-level Back in both states: it emits `backClicked`
whether or not inline playback is active, so the arrow keeps one meaning and
the list is one click away while watching. Only Escape unwinds one level: watch
emits `closePlayerRequested`, browse emits `backClicked`. Hosts retain their
existing route/inline/collection return behavior. The now-playing bar carries
no second arrow; its "Close player" button is the pointer counterpart of the
watch Escape (two arrows with different meanings, and two controls for one
action, were the pre-#1576 confusion this replaces). Browse Escape requires focus
inside this shell; watch keeps the existing global close shortcut, including
M3U playback started from its sidebar. Handled events, key repeats/modifiers,
editable fields, inert/hidden shells, fullscreen, dialogs and menus are ignored.
Escape bubbles through the shell before Material's body-level tooltip dispatcher,
so focused detail actions return with one press even while their tooltip is open.
The document listener remains the outside-shell watch fallback; `defaultPrevented`
prevents duplicate actions and preserves descendant handlers' priority.
After Escape closes a player, lost focus moves to the sticky control (or the
shell when there is no browse Back), without scrolling or stealing existing
focus.

Hosts without browse navigation set `backAvailable=false`: M3U uses its channel
sidebar, and collection bootstrap placeholders have no return handler. They
render no sticky arrow in either state and have no browse Escape action; their
watch exits are the bar's Close player button and Escape. Loading/error shells
with a return handler keep Back available.

## Summary

- Xtream category browsing uses a route-first detail model.
- Stalker uses an inline/store-state detail model.
- Detail pages themselves are two-state (browse ↔ watch) inside
  `PortalDetailShellComponent`; entering/leaving watch is a layout state,
  not a navigation. Route-level back semantics are unchanged; the one
  sticky arrow returns to the list from either state, while Escape and the
  now-playing bar's Close button close the inline player. See
  [Embedded Inline Playback](./embedded-inline-playback.md).
- Favorites and recently viewed collections now use collection-owned inline detail
  for non-live Xtream and Stalker items.
- Provider-scoped collection routes fall back to the matching global collection
  route when `All playlists` shows a non-live item from the other portal type,
  so the correct detail host still opens without switching playlist context.
- Dashboard `Global Favorites` and `Recently Watched` widgets hand off Xtream and
  Stalker movies/series into the matching global collection route with detail
  pre-opened.
- The dashboard hero CTA and the Continue Watching cards' explicit "Resume
  episode" ⋮ action for Xtream series carry a one-shot season/episode resume
  target. The collection-owned Xtream detail consumes it after its episode
  positions load and starts that exact episode; the cards' default click is
  detail-only (movie-like), as is opening the series from the collection grid
  itself. If the positions load fails, the target stays unconsumed and the
  handoff degrades to detail-only rather than starting the episode at offset
  zero. Continue Watching cards also expose "Mark as Watched" (maxes out the
  tracked position row) and "Remove from history" in the same ⋮ menu.
- Ready Download Manager cards open one of the three focused
  `downloads/:downloadId` routes. These local details hide the workspace
  context panel, play only finalized local files, and show only locally
  available episodes for a series.
- `View in portal` is the explicit bridge from a focused offline detail to the
  source catalog. Xtream resolves a concrete category/item route; Stalker uses
  the best stored item shape or an identity/title-derived fallback. Both pass
  the one-shot `detailPresentation: 'provider-only'` navigation state. The
  destination keeps provider playback and whatever catalog the normal provider
  host can resolve, but hides Offline/local/download presentation.
- Inline collection details (global favorites/recent — which also receive the
  dashboard hero and Continue Watching handoffs — plus a portal's own
  favorites/recent tabs) expose the same bridge as a separate-row hero action.
  The shared `app-view-in-portal-action` (`libs/ui/components`) renders only
  when a host provides `VIEW_IN_PORTAL_HANDOFF`; the two collection-detail
  wrappers (`xtream-collection-detail.component.ts`,
  `stalker-collection-detail.component.ts`) are the only providers, so
  router-mounted category details never show the button. Targets come from
  `getUnifiedCollectionDetailNavigation()` (`libs/portal/shared/util`), which
  never degrades to a category- or section-only route: an Xtream item without a
  resolvable category and positive item id keeps the button hidden. Unlike the
  download handoff it does NOT pass `detailPresentation: 'provider-only'` — the
  item exists in the provider catalog and the full normal detail is desired.
  The Stalker handoff carries `stalkerReturnTo` so the portal detail's back
  affordance returns to the originating collection, plus
  `stalkerReturnByHistory` so that return is a single history step rather than
  a fresh `navigateByUrl()`. The collection's active tab, scope and open inline
  detail live only in `window.history.state` (`collectionViewState` /
  `openCollectionDetailItem`); re-navigating starts a stateless entry, which
  reopened the collection on its default `live` tab and left the portal page
  one browser Back away. The marker carries the handed-off item's identity
  rather than a bare `true`, because `openStalkerItem` is consumed on arrival
  while the return keys stay on the entry and a Stalker detail opens in place
  without pushing one: after Back + browser Forward the same entry can host a
  different title, and that title's back affordance must close it rather than
  exit to the collection. A marker that does not match the open item is stale
  and suppresses the whole return contract. Honouring it retires both return
  keys from the entry, so the handoff is genuinely one-shot: a browser Forward
  onto the same entry cannot replay it for a title reopened from the catalog.
  Leaving via the browser's own Back runs no affordance at all, so
  `CategoryContentViewComponent` retires the contract as well whenever it
  lands on the entry with no handoff item and no detail open — the handoff is
  over, and anything opened from the list afterwards is a fresh selection. It
  is gated on the marker's presence, so a plain `stalkerReturnTo` caller such
  as the dashboard handoff keeps its existing behaviour untouched.
  The identity is restricted to the fields `buildStalkerSelectedVodItem()`
  preserves (`id ?? stream_id`) — it drops `series_id`/`movie_id`, so binding
  to the wider `extractStalkerItemId()` set would compare against an identity
  the opened detail can no longer report and silently strand the affordance.
  A row identified only by those alternate fields would open with an empty
  identity, so the builder pins the resolved id onto the handoff state item
  and those rows keep the history return as well. The marker is set only by this
  builder and only alongside `returnTo`, so the dashboard handoff and every
  other `stalkerReturnTo` caller keeps its re-navigating behaviour.
- Live channels in the same collections (the unified live tab of global
  favorites/recent and a portal's own favorites/recent tabs) get the live
  counterpart of that bridge, "open in playlist". Targets come from
  `getLiveCollectionPlaylistNavigation()` (`libs/portal/shared/util`), which
  lands on the channel, never on the playlist root: Xtream reuses
  `buildXtreamNavigationTarget` and its `openXtreamLiveItemId` state, which
  `LiveStreamAutoOpenStateService` turns into a selected, playing channel.
  The layout reads that state once at mount and again on every
  `NavigationEnd`: arriving from another route, the Xtream shell mounts the
  layout only after its session bootstrap, i.e. after the arrival's
  `NavigationEnd`, which a subscription made in the layout can never observe
  (the handoff used to be silently lost for every cross-route arrival), while
  the event read still covers re-navigation to the same `/live` route with the
  component reused. The state also carries `openXtreamLivePlaylistId`: `NavigationEnd` fires
  before the route session resets the shared `XtreamStore`, so at capture
  time `liveStreams()` can still be the PREVIOUS playlist's catalog, and the
  live layout used to read "not in this list" as "channel gone" and drop the
  handoff (a jump from a collection or global search into another portal then
  landed on the live root with nothing selected). The layout now consults the
  catalog at all only once `currentPlaylist()` is the requested playlist —
  stream ids are provider-local, so a colliding id in the previous catalog
  would otherwise play the wrong channel — and treats a miss as final only
  once `isContentInitialized()` is true; until then it keeps waiting and the
  effect re-runs as the store switches and loads;
  M3U navigates to `/workspace/playlists/:id/all` with `openM3uChannelUrl`
  (`OPEN_M3U_CHANNEL_URL_STATE_KEY`), the same key global search writes and
  the M3U player selects by URL; Stalker navigates to `/workspace/stalker/:id/itv`
  with `openStalkerLiveItemId` + `openStalkerLivePlaylistId` (+ the row's
  genre as `openStalkerLiveCategoryId` when known) from
  `buildStalkerLiveNavigationTarget`, which `StalkerLiveAutoOpen`
  (`stalker-live-stream-layout/stalker-live-auto-open.ts`, the Stalker
  counterpart of the Xtream service + effect) consumes: it reads the state at
  construction and on every `NavigationEnd`, waits until `currentPlaylist` is
  the requested portal (channel ids are provider-local, so a colliding id in
  the previous portal's list must never match), then locates the channel in
  the full ITV channel list cache — `get_ordered_list` is server-paged, so
  the row may sit on any page of its genre — selects that genre (`'*'` for a
  channel without one), expands the rail and plays it. While the list loads it
  waits (the cache turning ready re-runs the effect); a portal that cannot
  serve a full list (`itvFullListUnsupported`, the cache's reactive
  unsupported set), a load that fails transiently (the cache only arms a
  retry cooldown and changes no signal, so the flow awaits the preload
  promise and treats "settled, neither ready nor unsupported" as the same
  outcome) or a channel missing from the list (censored genres are excluded
  from `get_all_channels`) falls back to selecting the remembered genre, so
  the user still lands in the right list, and the handoff is consumed either
  way. That remembered genre is the stored row's `tv_genre_id` (an opaque
  portal id, numeric on most panels but not all); the row's `categoryId`
  counts only when it is not a section marker, because app-written
  favorites/recent rows carry `'itv'` there. Playback is deferred whenever
  selecting the genre changes the list scope (another genre, the All Items
  grid — `null`, a different row source from the `'*'` All list — or an
  active search): `playChannel` → `navigation.prepare` captures the
  displayed rows as the remote/numeric channel order, and the store serves a
  category a tick after `setSelectedCategory` — even from the full-list
  cache — so playing right away would capture the previous scope's queue.
  The store answers "whose channels are on screen?" with
  `itvChannelsCategory` (set wherever `itvChannels` is served, cleared by
  `setItvChannels`), which is what the deferred play waits for. Array
  identity cannot answer it: filtering by `'*'` hands back the cache by
  reference, and clearing a search replaces the rendered list without the
  source moving. Clearing the search IS synchronous, so a genre already on
  screen plays at once. A pending play is dropped when a newer handoff
  arrives, when the user switches portal, genre or section or starts a
  search, and when the layout is destroyed. Stalker radio stations resolve to `null`: they live in the separate
  `radio` section, whose station list is legacy-paged with no
  open-on-arrival contract, so the action stays hidden for them.
  Two surfaces render the one verdict: `app-open-in-playlist-chip`
  (`libs/portal/shared/ui`), projected into the EPG timeline / list-view
  toolbar through the panels' `[epgToolbarAction]` content slot beside the
  channel name (the "where is this from" answer sits on the now-playing
  surface and survives the collapsed state; it is absent for radio, which
  has no EPG panel, and without EPG support), and an "Open in <playlist>"
  entry in `app-global-favorites-list`'s row context menu
  (`openInPlaylistRequested`), which also covers radio rows and rows that
  are not playing. Both label with `playlistDisplayLabel` (a stored playlist
  name can be a URL carrying credentials) and reuse
  `PORTALS.VIEW_IN_PORTAL_TOOLTIP`; `UnifiedLiveTabComponent` performs the
  navigation. A row whose target does not resolve shows neither.
- Do not force both portals into the same browse/detail behavior unless the full
  portal detail architecture is being changed.

## Xtream

Xtream category and search details are represented by canonical routes.

Examples:

- `/xtreams/:id/vod/:categoryId/:vodId`
- `/xtreams/:id/series/:categoryId/:serialId`

Implication:

- Category browsing and search can still redirect to the original Xtream content
  route and item route.
- This keeps the URL, browser history, and detail rendering model aligned with
  normal Xtream browsing.

Current code paths:

- `libs/portal/xtream/feature/src/lib/xtream-collection-detail.component.ts` (favorites + recent, with shared UI from `libs/portal/shared/ui/src/lib/components/favorites-layout/`)
- `libs/portal/xtream/feature/src/lib/search-results/search-results.component.ts`
- `libs/portal/catalog/feature/src/lib/category-content-view/category-content-view.component.ts`

Collection behavior to preserve:

- Selecting a non-live Xtream item from favorites/recent should keep the current
  collection route and open inline detail inside the collection pane when the
  current collection host is already Xtream-aware.
- If a Stalker or M3U collection route is showing `All playlists` and the user
  selects an Xtream movie/series item, route into `/workspace/global-favorites`
  or `/workspace/global-recent` with detail pre-opened instead of trying to
  render Xtream detail inside the wrong host.
- The current playlist context must stay unchanged even when the selected item
  belongs to a different Xtream source playlist.
- The workspace/sidebar category panel should stay hidden for these collection
  detail opens.
- Back from a collection-owned detail should restore the previous collection
  view state, including the active content tab and playlist/all-playlists
  scope.
- Live streams can still open through the player path rather than a detail
  route.

Dashboard behavior to preserve:

- Dashboard `Global Favorites` and `Recently Watched` widgets should route
  Xtream movie/series items into `/workspace/global-favorites` or
  `/workspace/global-recent` with collection detail pre-opened from navigation
  state.
- When an Xtream series recent has a saved episode position, the dashboard hero
  and Continue Watching card should include that exact series/episode target in
  the navigation state. It is a one-shot playback request and must not leak into
  normal favorites, search, category, or collection-grid navigation. Only
  position rows that name their parent `seriesXtreamId` produce a target:
  episode-keyed recents make `item.xtream_id` an episode id, so legacy rows
  without the pointer stay detail-only instead of promoting the episode id to a
  series id.
- Back from the collection detail should return to the dashboard handoff state,
  not switch the active playlist.

Search behavior to preserve:

- Selecting an Xtream item from search should still navigate to the canonical
  Xtream content type/category/item route when the item is not a live stream.

Download handoff behavior:

- An Xtream movie handoff requires its exact VOD category and item route; a
  series handoff requires its exact series category and item route. The
  download snapshot's provider category is preferred, with the typed catalog
  used to recover it for legacy rows. The action stays unavailable rather than
  opening a bare collection route when the target cannot be resolved.
- Provider-only mode is read by the normal VOD/series detail components. It
  preserves provider Play/Resume and every provider episode, while suppressing
  the local Offline state and download controls. Reusing the route component
  for another item must clear the mode unless that navigation explicitly
  carries the marker.

## Stalker

Stalker details are represented by store state and inline detail rendering on the current screen.

Examples:

- Category content sets `selectedItem` and renders details inline.
- Search sets `selectedItem` and stays on the search view.
- Favorites and recently viewed stay on their current collection screen and open
  inline detail when the current collection host is already Stalker-aware.

Implication:

- Favorites, recently viewed, and search should remain in the current Stalker view when opening VOD/series details.
- This keeps Stalker behavior aligned with its normal category-content and search flow.

Current code paths:

- `libs/portal/stalker/feature/src/lib/stalker-collection-route.component.ts` (favorites + recent via `mode` route data) -> `stalker-collection-detail.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`
- `libs/portal/catalog/feature/src/lib/category-content-view/category-content-view.component.ts` (Stalker branch)

Behavior to preserve:

- Favorites/recent/search should not navigate away to a canonical Stalker detail route because Stalker does not currently use one.
- If an Xtream or M3U collection route is showing `All playlists` and the user
  selects a Stalker VOD/series item, route into `/workspace/global-favorites`
  or `/workspace/global-recent` with detail pre-opened so the Stalker inline
  detail host still renders on a compatible screen.
- ITV/live items can still trigger playback immediately.
- Stalker VOD items that are displayed as series because of `is_series=1`
  remain VOD-backed when opened from favorites/recent/global collections; the
  collection host must not convert them into regular `/series` detail mode.
- Dashboard `Global Favorites` and `Recently Watched` widgets should route
  Stalker movie/series items into `/workspace/global-favorites` or
  `/workspace/global-recent` with detail pre-opened inline, again without
  switching playlist context or showing the workspace category sidebar.
- Back from the collection-owned detail should restore the previous collection
  tab and scope instead of resetting the collection screen to its defaults.

Download handoff behavior:

- `View in portal` preserves Stalker's inline/store-state architecture. A
  type-compatible recently-viewed snapshot is carried as `openStalkerItem`
  into the normal category host, preserving regular series, embedded VOD
  `series[]`, or lazy Ministra VOD `is_series=1` shape. Candidate filtering
  rejects live items and the opposite movie/series namespace even when ids
  overlap. When the download snapshot carries an exact numeric provider
  category, that category wins over the recent record's virtual `vod` or
  `series` marker while the raw mode fields stay intact.
- When no compatible recent snapshot exists, only a movie download with an
  exact numeric provider category can form a metadata-only VOD target. A
  legacy movie without that category and every episode without a recoverable
  raw series mode leave `View in portal` unavailable instead of fabricating an
  unverified provider target.
- The provider-only marker is scoped to the resulting selected item. Its normal
  provider host supplies the seasons, episodes, and playback it can resolve,
  while the shared VOD or series UI suppresses local Offline and download
  controls. A later ordinary item open returns to normal provider presentation.

## Decision Rule For Future Changes

When deciding how a favorites/recent/search click should behave:

1. Follow the portal's canonical detail model.
2. Prefer local consistency within the portal over cross-portal sameness.
3. Only unify Xtream and Stalker behavior if the full detail architecture is being unified as well.

That means:

- Xtream browse/search: navigate to the canonical route.
- Xtream favorites/recent/global collection widgets: open collection-owned
  detail without switching playlist context. Use the current route when it can
  host Xtream detail, otherwise fall back to the matching global collection
  route.
- Stalker non-live items: open collection-owned detail without switching
  playlist context. Use the current route when it can host Stalker detail,
  otherwise fall back to the matching global collection route.

## Refactor Guidance

If a future change proposes that Stalker favorites/recent should deep-link into category routes:

- also update Stalker category-content and search behavior
- define a canonical Stalker detail route model first
- update architecture docs and portal skills together

If a future change proposes that Xtream favorites/recent should stay inline:

- keep the existing route-based detail pages reusable from the collection-owned
  detail host
- verify history/back behavior, playlist preservation, and dashboard handoff
  behavior still make sense
