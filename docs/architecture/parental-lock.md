# Parental Lock

Issue #285. A PIN-protected lock for individual categories: Xtream
categories, Stalker genres and M3U `group-title`s. While the lock is active,
everything in a locked category is withheld from the app; entering the PIN
shows it again until the app locks itself.

This document is the contract. Phase 1 (this document's scope) covers the
portals' own surfaces; the aggregate surfaces listed under "Not yet covered"
follow in a second PR.

## Product rules

- Off by default. Enabling asks for a new PIN (4–8 digits); disabling and
  changing the PIN always verify the current PIN against the stored hash,
  even while the session is unlocked (`verifyCurrentPin()`, never the
  `requestUnlock()` short-cut) — a parent leaving the app unlocked must not
  leave the lock removable. Disabling keeps the locks for a later re-enable.
- The unit of locking is the category. Nothing is blurred or greyed: a
  withheld category and its rows are absent. The only trace is one
  "N locked · Enter PIN to show" row at the bottom of a portal's category
  rail, which opens the PIN prompt. In fail-closed mode (lock store
  unreadable) the row shows without a count, since which categories are
  locked is unknown while every one of them is withheld.
- The unlock lives in memory only. The app locks again on every restart, on
  "Lock now" (header button, command palette, settings), and after
  `Settings.parentalLockRelockMinutes` minutes without user interaction
  (default 15; `0` = only on restart). The idle timer follows the UNLOCKED
  transition: armed the moment a session is unlocked — including the session
  that just enabled the feature — and disarmed on lock. Active playback of a built-in web
  player counts as interaction, so a film never locks half way — video
  through the keep-awake tracker, and audio (the radio player) read from
  the playing `<audio>` elements, since the keep-awake service ignores
  them.
- This is a child lock, not a security boundary: the PIN hash and the lock
  store sit in user-readable app data. The UI says so. There is no PIN
  recovery; resetting the app data is the way out.

## Storage

| What               | Where (Electron)                                                                  | Where (PWA)               |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------- |
| PIN hash           | `app_state` key `parental-lock:pin`                                               | localStorage, same key    |
| Lock store         | `app_state` key `parental-lock:locks`                                             | localStorage, same key    |
| Feature switch     | `Settings.parentalLockEnabled`, mirrored to electron-conf `PARENTAL_LOCK_ENABLED` | `Settings`                |
| Relock timeout     | `Settings.parentalLockRelockMinutes`                                              | same                      |
| Xtream query index | `categories.locked` column                                                        | none (filtered in memory) |

The PIN is hashed with PBKDF2-SHA256 through WebCrypto
(`parental-lock-pin.util.ts`, format `v1$<iterations>$<salt>$<hash>`), so
Electron and PWA share one implementation. The hash is deliberately not part
of `Settings`: settings are logged, backed up and mirrored to the main
process. A hash that could not be READ is not an absent PIN:
`ParentalLockStorageService.readPinHash()` reports the failure as `null`
(an absent PIN is `{hash: null}`), the session then stays locked (`enabled`
treats an unreadable PIN as set while the switch is unknown) and every
PIN-protected step — unlock, change PIN, disable — re-reads it first, so
storage answering later is enough to recover without a restart.

The lock store (`ParentalLockStore` in `parental-lock.util.ts`) is keyed by
playlist id and holds, per playlist, Xtream `{categoryType, xtreamId}`
pairs, Stalker `{categoryType, categoryId}` pairs and M3U group titles. It
is the source of truth for all three portal types. Xtream additionally keeps
`categories.locked` as a SQLite index derived from it: `DB_SET_CATEGORY_LOCKS`
re-stamps one playlist/type from a provider-id list (idempotent, so the store
can be replayed after a refresh or a backup restore), and `DB_SAVE_CATEGORIES`
takes `lockedCategoryXtreamIds` so a refresh recreates the rows already
stamped. Locks are keyed by provider ids, never by SQLite row ids, because a
refresh deletes and re-inserts the rows.

## Enforcement — two layers, both default-closed

1. **SQLite worker (Electron).** `apps/electron-backend/src/app/database/parental-lock-state.ts`
   holds one process-wide flag. While active, every content-returning read
   appends "category is not locked": `getCategories`, `getContent`,
   `searchContent`, the three `globalSearch` candidate selectors,
   `getGlobalRecentlyAddedByType`, `DB_MATCH_TITLES` and the multi-source
   discovery queries. A surface added later is therefore withheld by
   default. The flag is seeded through `workerData.parentalLockActive` when
   the worker is (re)started and flipped by the `parental-lock` control
   message on the request port (ordered with the requests, so a read posted
   after it observes the new state). `getAllCategories` is exempt: it feeds
   the management dialog, which itself sits behind the PIN.
2. **Renderer `ParentalLockService`** (`libs/services/src/lib/parental-lock/`).
   Signals `enabled`, `unlocked`, `active` (= enabled && !unlocked),
   `hasPin`, `version`; `requestUnlock()` (one shared prompt for concurrent
   callers), `lock()`, `setupPin()`, `changePin()`, `disable()`, the lock
   store API (`setXtreamLocks`, `setStalkerLocks`, `setM3uLocks`,
   `replacePlaylistLocks`, `lockedXtreamIds`, …) and the `is*Locked`
   predicates, which answer `true` only while `active`. The PIN dialog is
   reached through the `PARENTAL_LOCK_PROMPT` token, provided by the app
   (`AppParentalLockPromptService` → `ParentalLockPinDialogComponent` in
   `libs/ui/components`), so the data-access lib stays free of UI.
   Five wrong PINs pause the prompt for 30 seconds. The count and the
   pause live in the service (`createParentalLockPinThrottle`, handed to
   every unlock prompt), so dismissing the dialog and opening it again
   does not reset them.

The renderer reports `active` to the main process over
`PARENTAL_LOCK_SET_STATE` (`apps/electron-backend/src/app/events/parental-lock.events.ts`),
which forwards it to the worker. `SETTINGS_UPDATE` only persists the
`parentalLockEnabled` mirror; it never derives the live state from a settings
save (every save carries the flag unchanged and would re-lock the worker
under a renderer that shows "unlocked"). The one exception is a switch-off,
which releases the worker at once. `requestUnlock()` awaits `initialize()`
before it can answer "not active", so a slow settings load cannot open a
gate. Like the playback keep-awake vote, the
renderer's word does not outlive its page: on reload, main-frame navigation or
a dead render process the flag falls back to the mirrored
`PARENTAL_LOCK_ENABLED` setting, i.e. locked while the feature is on. The
renderer, in turn, reports nothing before its settings have loaded, so it can
never send a spurious "unlocked" while the main process still holds the
locked default. Unreadable settings fail the same way: `SettingsStore`
serves defaults and records `storageFailure = 'load'`, and the switch is
then unknown rather than off — a stored PIN stands in for it (`enabled`
follows `hasPin`, so the session starts locked and one PIN entry unlocks
it), and without a PIN the renderer does not report at all, leaving the
main process on its mirrored default instead of announcing "unlocked" on
the strength of default settings. The lock store itself fails closed the
same way: `ParentalLockStorageService.readLocks()` reports a failed read as
`null` (distinct from an absent store, `{}`; Electron reads through
`DatabaseService.readAppState`, which keeps a rejected IPC apart from a
missing key, and a stored payload that does not parse or does not have the
shape `writeLocks` produces — `isWellFormedParentalLockStore`, all three
lists present, down to the nested entries — is a failed read too — corruption never becomes an empty
store), and while the lock is active with the store unreadable
`ParentalLockService.withholdsEverything` is true — every `is*Locked`
predicate answers true and the set-based filters (PWA Xtream, Stalker
content and search, the M3U channel list) receive
`ALL_CATEGORIES_WITHHELD`, and `ElectronXtreamDataSource` serves no
categories, content, cached categories/content (the warm-route hydration
path) or search hits either, since its SQLite index may still
carry a stale stamp — under which a row WITHOUT a genre is withheld
too (`isStalkerItemWithheld`, `isStalkerCategoryLocked`), since "no genre"
must not be the one row a withheld catalog still shows — so the whole
catalog is withheld until the PIN
is entered or the store reads again (`requestUnlock` and every lock write
retry the read first, and a write is refused while it still fails, since it
would be built on an empty in-memory store and wipe the persisted locks).
The same fail-closed mode applies while locked when Electron reads Xtream
through the SQLite worker (`supportsXtreamSqliteDataSource`) but the bridge
lacks the worker filter (`supportsParentalLockSqliteFilter`:
`setParentalLockState` and `dbSetCategoryLocks`, e.g. a partial or older
preload): the worker would never learn the lock state, so it cannot
withhold locked rows itself. The same holds while locked after the
lock-state sync itself was rejected (`ParentalLockWorkerSync`), until a
later sync succeeds. The direct worker consumers
(`CatalogTitleMatchService`, `VodSourceDiscoveryService`) ask the worker
nothing while `withholdsEverything` is true, in either case. The VOD
multi-source host keys its discovery session to the lock version: a lock
change drops the discovered sources, retires discoveries and switches in
flight, and rediscovers through the worker's new lock state. Title-match
results are cached by their consumers (Xtream/Stalker Actor and Discover
routes, the dashboard trending and recommendation rails, the four
"similar in your portals" rails), so each filters them on READ through
`CatalogTitleMatchService.visibleMatches` / `isWithheld` or
`CrossPortalSimilarService.visible`. Every match carries its provider
category id, and the predicate reads the lock state, so a relock hides
matches cached while unlocked (and those of a lookup issued before it) at
once, with no re-query; an unlock shows them again. Consumers keep ALL the
rows a lookup returned and pick a title's match from the visible ones on
read (the Actor/Discover indexes, the trending rail, the recommendation
rail through `buildRecommendationItems`, and each "similar" item's
`candidates`), so a title that also exists in an unlocked portal stays
available through that copy instead of disappearing with the locked one.
The window before the initial read settles is treated the same way
(`ParentalLockLockStore.readable` is false until then): settings can report
the feature as on before the locks are known — and the workspace route's
`settingsReady` resolver awaits `ParentalLockService.initialize()` next to
the settings load, so no route or catalog activates before the PIN and the
lock store are known (in the PWA the settings read can be the slower one).
Every lock write re-reads a failed store BEFORE building its edit, so a
recovered store is edited, never overwritten by an edit built on the empty
fail-closed one. The feature switch itself is
persisted through one guarded path (`persistEnabled`), and every
parental-lock settings write first retries a failed startup settings read
(`ensureSettingsReadable`) and is refused while settings stay unreadable —
`updateSettings` writes the whole settings object, which after a failed
read is the defaults and would replace the user's persisted preferences.
Within that path `updateSettings`
patches memory before it writes, so a failed write is undone in memory and
`setupPin`/`disable` report false (whether to persist is decided from the
settings switch BEFORE the PIN is stored, since `enabled` follows `hasPin`
while the switch is unknown); the Electron mirror write is awaited
next, and a mirror that cannot be written undoes the settings write the
same way — the toggle never shows a state the next launch will not have,
on either side. The undo restores the value read AFTER the settings retry
(not the hard-coded inverse, which a recovered read may already hold). The
Settings switch itself only requests the change: it snaps back to the
saved state at once and follows `enabled()` when the PIN action succeeds,
so a cancelled or refused PIN leaves it showing the real state.

### In-memory catalogs

- **Xtream (Electron):** the store reads categories and streams through the
  worker, so they arrive filtered. On `version` changes
  `ParentalLockEnforcementService` (`apps/web/src/app/services/`) calls
  `XtreamStore.reloadCategories()` + `reloadCachedContent()` and, if the
  selected category vanished, clears the selection and navigates to the
  section root. The selected ITEM is judged separately, on its own
  `category_id` against the reloaded category list: a detail opened from
  "All", recently added or search has no selected category to vanish
  with, so its row disappearing from a list is not enough — the item is
  cleared and the route returns to the section root while the (still
  readable) selected category stays. Within one apply the synchronous
  surfaces (the M3U active channel, the Stalker selection) are stepped off
  BEFORE the Xtream reloads are awaited, so a playing M3U channel never
  waits behind a slow portal read — the Xtream store stays populated after
  leaving that portal, so its reload runs on every apply. The M3U check
  also runs whenever the active channel changes while locked: numeric
  zapping, next/previous and remote commands select from the full channel
  list without any lock change following, so a channel of a locked group
  is reset as soon as it becomes active (numeric zapping also skips it). Applies run one
  at a time and each is
  abandoned once a newer `version` exists (the queued apply reads the latest
  state): `ElectronXtreamDataSource` shares in-flight category/content
  reads per playlist and type, and its share key carries the lock version,
  so an unlock refresh still running when "Lock now" arrives can never hand
  the relock its unfiltered rows. The apply also re-runs the stored
  in-portal search (`XtreamStore.refreshSearchResults`, the last
  `searchContent` call as issued) — `searchResults` is a separate array the
  search page renders directly and would otherwise keep locked titles until
  the query changes. A RELOCK fails closed at once rather than after the
  database answers — ahead of the serialized apply queue, so an earlier
  apply still waiting on a slow or hung read cannot delay it: the selected detail is stepped off synchronously when
  the lock store already names its category (the pre-reload category list
  maps Electron's row id to the provider id) or when that list cannot place
  it at all (a manually hidden category opened through search), then
  `withholdCatalog()`
  empties every catalog list and `clearSearchResults()` the stored search
  (retiring a search still in flight, which was issued under the previous
  lock state) before the filtered reads refill them; both reloads take a publish guard
  answered before every state patch, so a read issued under an older lock
  version is dropped instead of published. The guard also turns false once
  another Xtream playlist is open (the store is a singleton), and the store
  itself refuses to publish a reload into a playlist it was not read for;
  the post-reload search refresh and selection checks are skipped then
  too. The post-reload checks of the
  selected category and item decide by the LOCK STORE through the
  unfiltered category rows (`IXtreamDataSource.getAllCategories`), not by
  absence from the reloaded list, which also omits categories the user
  merely hid; rows that cannot be read fail closed. A lock change that overtakes
  the INITIAL hydration (the content is not initialized yet, so the reload
  has nothing to re-read) sets a deferred-reload flag instead — already
  when `withholdCatalog()` empties the lists, before the category reload is
  awaited: the
  hydration then publishes empty lists in place of the rows it read under
  the previous lock state (categories included), and the filtered reload
  of categories and content runs as soon as the hydration settles, on
  every path that marks the content initialized, under the publish guard
  of the request that deferred it.
  Both reloads fail closed: a category reload that
  rejects empties the three category lists, and a per-type content reload
  that rejects empties that type and sets it back to `idle` so the next
  visit loads it again (filtered) — rows read under the previous lock state
  are never kept. Live playback is stopped by the layout itself:
  `LiveStreamLayoutComponent` keeps the playing channel's provider category
  id (mapped from the SQLite row id on Electron — through the visible
  category list, else through the unfiltered rows, since search can play a
  channel of a HIDDEN category; until that lookup lands the id is unknown
  and a relock stops the channel, and a lookup that lands after a later
  playback — same provider id, other playlist — is discarded) and drops `activePlayback` on a `version`
  change that locks it, because the player is gated on that
  signal, not on the store selection — which an ordinary category switch
  also clears while the channel keeps playing.
- **Stalker:** the same service checks the selected genre through
  `isStalkerCategoryLocked` and, independently, the selected item's own
  genre — `tv_genre_id` for live and radio rows, `category_id` for VOD and
  series, the rule the store's withheld filter applies — so an item opened
  from `*` (All) or search is withheld by its genre even though `*` itself
  can never be locked. A withheld item is cleared and the section root is
  navigated to; the category selection is reset only when the genre itself
  is locked. A stream still RESOLVING at relock time is retired too: the
  embedded player defers selecting the channel until resolution, so the
  cleared selection cannot retire it — the playback request carries the
  lock version it was issued under (`isStalkerPlaybackRequestLockCurrent`)
  and is dropped when the session relocked meanwhile (an unlock lets it
  complete). `StalkerLiveStreamLayoutComponent` drops its `activePlayback`
  whenever the store selection is cleared: its template mounts the player
  only with a selection, and the held stream must not resurface with the
  next one.
- **M3U groups rail:** `ChannelListContainerComponent` derives
  `withheldGroupCount` (groups of the playlist the active lock withholds)
  and the groups rail renders the same "N locked · Enter PIN to show" row
  as the portal category rail, so locked groups do not simply vanish —
  also when EVERY group is locked: the container keeps the groups view
  (`showChannelViews`) and the groups view keeps its rail instead of the
  generic empty state.
- **Xtream (PWA):** `PwaXtreamDataSource` drops withheld categories,
  streams and search hits at read time; the same reloads apply. Provider
  category ids are compared in canonical numeric form (`"009"` matches the
  stored lock `9`), as the lock editor stores them with `Number`.
- **Warm-cache detection (Electron):** the filtered category/content reads
  can be empty while the offline cache is complete (every category locked),
  so `ElectronXtreamDataSource` confirms an empty read with the unfiltered
  `hasXtreamCategories` / `hasXtreamContent` before refetching from the
  provider.
- **Routes:** `parentalLockXtreamCategoryGuard(section)` on every Xtream
  `:categoryId` route (live, vod, series and their detail children) and
  `parentalLockStalkerCategoryGuard(section)` on the Stalker vod/series
  `:categoryId` routes prompt for the PIN when a locked category is reached
  by URL — bookmark, typed address, stale link — and redirect to the section
  root on refusal. Detail routes also resolve the ITEM's own category through
  `getContentByXtreamId`, so a locked movie paired with an unlocked category
  id in the URL is still refused; on a cold PWA navigation the guard
  hydrates the session cache first (`getPlaylist` + `getContent`), and an
  item the catalog cannot place fails closed (PIN prompt) rather than
  passing as unlocked. Electron routes carry SQLite row ids, so
  the Xtream guard maps them through the unfiltered category read; Stalker
  routes already carry the genre id.
- **Stalker withheld-row bookkeeping:** the paging logic that advances past
  a page made only of withheld rows keys those rows by
  `stalkerWithheldRowKey` (`id`, else `stream_id`/`movie_id`/`series_id`,
  else the row's `cmd`/`name`), never by a shared `''`, so a page of new
  locked rows is not mistaken for a stalled portal.
- **Stalker search relock:** a lock change drops the withheld rows already
  on screen at once (`applyRelockToResults`, page 1 included) and closes an
  open detail of a now-withheld genre (in fail-closed mode also one
  without a genre), before the replacement page is awaited — otherwise
  they stay clickable while that request is pending.
- **Stalker search staleness:** portal requests are not aborted, so a
  search page issued before a relock can finish after it, filtered with the
  pre-relock withheld set; `isStalkerSearchRequestCurrent` keys the
  response on the parental lock version as well as term/type/page/portal,
  so such a page is dropped instead of repopulating the grid.
- **Stalker search route** (`/workspace/stalker/:id/search`, no category
  in the URL): `StalkerSearchComponent` filters each portal page through the
  same withheld-genre predicate, carries `parentalLockVersion` in its
  resource params, judges paging progress on the raw page (a page made only
  of locked rows is not the end of the results), advances past a run of
  fully withheld pages by itself (the infinite scroll stops auto-filling
  after a few no-growth loads), closes an open detail whose genre is newly
  withheld and, on a lock flip past page 1, drops the withheld rows and
  restarts from page 1.
- **Stalker:** genres are stored unfiltered; `getCategoryResource` filters
  them, `getAllCategoriesForSelectedType` is the raw list for the lock
  dialog. `itvFullChannelList` and the content loader drop rows whose
  `tv_genre_id` / `category_id` is withheld, the content resource's params
  carry `parentalLockVersion` so lock/unlock re-fires it, and a stale
  response is discarded when the version moved. Paging is judged on the RAW
  page: withheld ids the list has not seen before count as progress (so a
  portal page made only of locked rows does not end the list), a page that
  is entirely withheld requests the next page by itself, and the VOD/series
  `totalCount` is reduced by the withheld ids seen so the grid stops asking
  once every visible row is in. A lock flip while the list sits past page 1
  drops the withheld rows on screen at once and restarts from page 1, so rows
  accumulated under the old lock state are never appended to. A selected
  withheld genre is cleared and the
  section root is navigated to.
- **M3U:** `ChannelListContainerComponent` derives one `visibleChannelList`
  (all views, favorites, recents, the fullscreen panel and numeric zapping
  read from it); locked groups are absent from the groups rail. A playing
  channel of a locked group is reset on lock.

## UI

- `Settings → Parental lock` (`/workspace/settings/parental`): enable
  toggle, state + Lock now / Unlock, relock select, Change PIN, the
  disclaimer. Everything applies immediately (it gates on the PIN), outside
  the shared dirty form; `createSettingsFromFormValue` carries both values
  from the current settings so Save cannot undo them.
- One entry point per rail, the same on every portal type: the "Manage
  categories" button (`tune` icon; "Manage groups" on an M3U playlist).
  Xtream and M3U render lock toggles inside their existing hide/show
  dialogs while the feature is on; Stalker has no hide/show dialog, so its
  button — shown only while the feature is on — opens the lock-only
  `StalkerCategoryLockDialogComponent`, which also offers "Lock adult
  (18+)" for genres the portal flags `censored`. All three list the locked
  names and can rewrite the locks, so each opens only after
  `requestUnlock()` succeeds — and closes itself, discarding the draft, the
  moment `active` becomes true again (idle relock, Lock now), since the
  PIN gate covers only the opening. The M3U group dialog does this only
  while it carries lock toggles; the plain hide/show editor is not behind
  the PIN. The Xtream dialog loads its candidates through the
  capability-selected data source (`IXtreamDataSource.getAllCategories`,
  which the PWA source answers from its session cache or the API), so PWA
  users can set locks too; the hide/show checkboxes, the selection count
  and the Select/Deselect-all actions remain Electron-only.
  A deliberate non-choice: no dedicated lock button in the rail header
  (the header already carries search, sort and manage, and the lock is a
  category-management concern) and no keyword-based "adult" recognition
  for Xtream/M3U (provider naming is arbitrary; the only automation is the
  portal's own `censored` flag on Stalker).
- Right-click accelerator: a `contextmenu` on a category row (Xtream and
  Stalker rail, `WorkspaceContextCategoryViewComponent`) or an M3U group
  row opens the shared `CategoryLockMenuComponent` (`libs/ui/components`)
  with one "Lock / Unlock category (group)" item, only while the feature
  is on. The portal rail persists through
  `WorkspaceCategoryLockActionService` (PIN gate, then one-id edit of the
  lock store, failure snackbar); the M3U rail emits the toggled group to
  `ChannelListContainerComponent`, which captures the playlist, asks for
  the PIN, and persists the edit only if that playlist is still open (two
  playlists can share a group name). The M3U management dialog is bound
  the same way: `GroupsViewComponent` captures its `playlistId` input
  before the PIN and drops the dialog's result once another playlist is
  open. Every bulk lock editor (Xtream and M3U management dialogs, the
  Stalker lock dialog) builds its draft only from a lock store that was
  read (`ensureLocksReadable`): a draft taken from the empty fail-closed
  snapshot would erase the real locks on Save if storage recovered in
  between. The M3U and Xtream dialogs then open without lock toggles; the
  Stalker dialog does not open. Every one of them closes on a relock, the
  M3U one also when it opened without toggles, since it still lists every
  group name. Bulk actions stay in the dialog, and while the session is locked
  a locked category is not in the rail, so unlocking always goes through
  the "N locked · Enter PIN to show" row or the dialog. The M3U dialog
  hands its lock list back to `ChannelListContainerComponent`, which
  awaits the write and reports a failed save in a snackbar (the dialog has
  closed by then). On Electron the `categories.locked` re-stamp
  (`setCategoryLocks`) clears and re-locks one playlist/type inside ONE
  transaction, so a failed restamp keeps the previous index instead of
  leaving every category unlocked. The relock timeout persists through the
  same undo-on-failure pattern as the switch (`setRelockMinutes` reverts
  the in-memory value and the facade shows the settings save-failure
  snackbar). A locked session cannot change it: the selector is disabled
  until the PIN is entered, and `setRelockMinutes` refuses while `active`,
  so a child cannot switch the idle relock off for the next unlock.
- Header lock/unlock button and the `parental-lock-now` /
  `parental-unlock` palette commands.
- The PIN dialog's submit button names the flow: the service passes a
  `submitKey` with every prompt — Unlock (`requestUnlock`), Save PIN (a new
  PIN in `setupPin` and `changePin`), Confirm (the current PIN before a
  change), Turn off (`disable`). The dismiss button is the shared Cancel.
  Errors sit on their field as `mat-error` (an `errorStateMatcher` drives
  it, so the input gets `aria-invalid` and the message lands in the field's
  live region): a wrong PIN, the cooldown or a too-short PIN on the PIN
  field; a mismatch on the repeat field, shown while typing once the repeat
  is as long as the PIN. Submit is disabled only while busy or cooling
  down, never for incomplete input, because Enter does nothing on a
  disabled default button; `submit()` refuses instead, shakes the field
  (no shake under `prefers-reduced-motion: reduce`) and focuses it — except
  that Enter in the PIN field with the repeat still empty only moves focus
  to the repeat (a `keydown.enter` handler: focus cannot tell Enter from a
  click on Save, since WebKit does not focus a clicked button). Set
  mode marks both inputs `autocomplete="new-password"`. The Electron
  `parental-lock-pin-dialog.e2e.ts` covers the labels and the
  mismatch → fix → save flow.
- Styling uses app tokens only (the theme declares no `--mat-sys-*`); the
  PIN errors, the fields' error outline and the Stalker adult chip use a
  local red per theme. Keyboard
  focus on a lock row is a 2px inset `--app-selection-color` ring, and the
  lock dialogs open with `maxWidth: 'calc(100vw - 32px)'` and no content
  min-width, so they fit a 375px phone. `apps/web-e2e/src/parental-lock-ui.e2e.ts`
  checks rings, borders, the PIN error and phone width in both themes.

## Startup footprint

The lock service, lock store and enforcement are on the renderer's initial
path by necessity (the workspace resolver and the catalog data sources gate
on them). Everything else stays lazy: the PIN dialog loads through
`parental-lock-pin-dialog.lazy.ts` on the first prompt (a failed chunk load
reads as a cancelled prompt), and the enforcement's Stalker step loads
through `parental-lock-stalker-enforcement.ts` only while a Stalker route is
open — a static import of the Stalker store would put the whole Stalker
data layer back into `main.js`. The chunk is preloaded when a Stalker route
opens, so a relock there runs the step synchronously; if it is not loaded
yet (still fetching, or it cannot load — a stale PWA page after a
deployment) the step fails closed at once by navigating to
`/workspace/sources`: leaving the Stalker route clears its selection and
stops its playback, and the Xtream step still runs. The feature costs about 35 KB of
`renderer.initialBytes`; the baseline was not raised for it, the growth was
offset by moving lazy-only barrel re-exports (backup/restore and the portal
helpers) off the initial path.

## Lock store lifetime

On Electron the SQLite `categories.locked` index is derived from the lock
store and must never lag behind it, because the worker filters every read
by the index alone:

- The store commits BEFORE the re-stamp, so a failed re-stamp rolls the
  store back to the previous locks AND re-stamps every touched type from
  them (a backup restore stamps three types, and the ones before the
  failing type already carry the new locks). The store revision consumers
  reload on is published only once every touched type is stamped — also
  after a rollback — so a reload cannot read a later type through its old
  stamps. If the rollback write or its re-stamp fails too, the playlist is
  marked stale and re-stamped on the next store access. A failed rollback
  WRITE still puts memory back to the previous locks and leaves a pending
  rewrite: the next store access persists them before it re-stamps, so the
  failed edit cannot take effect through that re-stamp. The pending rewrite
  lives in memory: if the app exits before it lands, the next launch loads
  the persisted copy, i.e. the edit the parent submitted with the PIN. That
  is accepted — it is not a bypass, and a durable rollback journal would
  hit the same storage failure. For the whole
  re-stamp window — store changed, stamps not yet landed — the playlist
  counts as stale, so `readable` is false and a relock inside the window
  reloads fail-closed instead of through the old stamps. Such in-flight
  entries are not retried by a reconcile running beside the write (a PIN
  prompt or backup calling `ensureReadable()`): it would stamp from a store
  the write has not committed yet. Only failed stamps are retryable.
- A write that removes a playlist's LAST lock clears the index first and
  drops the key afterwards: the launch-time reconcile finds playlists only
  through their key, so an interruption must leave store-with-lock and
  index-without, which the next reconcile repairs toward locked. If the
  clear or the store write fails, the index is re-stamped from the previous
  locks at once — title matching and multi-source discovery query the
  worker directly and trust the index, so a stale flag alone would not
  protect them. The playlist stays stale until the store write has landed
  too: while it is pending the index is already cleared but the store
  still holds the lock.
- An edit that takes a lock away commits only while the session is
  unlocked, checked inside the write queue at commit time
  (`ParentalLockLockStore.setRemovalGate`, set by `ParentalLockService`).
  An editor opened while unlocked may still be saving, or queued behind
  another write, when the app relocks. The gate is asked right before the
  edit's first write is issued; a relock that lands after that is ordered
  after the write, which completes: the parent authorized that removal,
  and a post-write rollback could itself fail and leave the persisted
  store diverged from memory across a restart. (During the Xtream stamps
  the playlist is stale anyway, so the relock reloads fail-closed until
  they land.) Adding locks is always allowed.
  Playlist deletion and "Remove all playlists" are not edits and are not
  gated.
- Every launch re-derives the index from the store for each playlist that
  has locks, and a store recovered by a later successful read marks its
  playlists stale the same way. The reconcile is awaited inside the store's
  `load()`, so `readable` (and with it every catalog read the renderer
  gates) stays false until the index agrees with the store; a re-stamp that
  keeps failing keeps the session fail-closed.

Every lock-store mutation runs through one write queue in
`ParentalLockLockStore`: each rewrites the whole persisted store from the
in-memory copy, so overlapping edits (two right-click toggles, a dialog
save during a restore) would otherwise snapshot the same store and the
later write would drop the earlier edit. Single-row changes (the
right-click Lock/Unlock) are passed as an EDIT of the current list
(`LockListEdit`), evaluated inside that queue, so two quick toggles each
see the other's result instead of one shared snapshot; the dialogs pass a
full list, which is the replacement they mean. A deleted playlist's locks leave
the store through the `PLAYLIST_DELETE_CLEANUP` hook
(`provideParentalLockPlaylistCleanup`, run by
`PlaylistsService.deletePlaylist` for every single-playlist deletion; no
re-stamp, the category rows go with the playlist), and "Remove all
playlists" empties it through `ParentalLockService.clearAllLocks` once the
deletion has succeeded — the in-memory store empties at once, and a failed
persisted clear is retried on the next store access (the store is not
`readable` until it lands). A backup restore that CREATES a playlist (not a merge) starts
that playlist from empty locks, so a reused id can never inherit entries a
failed cleanup left behind; the restore retries a failed lock-store read
first (`ensureLocksReadable`) and aborts while it still fails, so that check
never runs against the empty fail-closed snapshot.

## Backup

A backup carrying lock lists replaces the matching playlists' locks,
possibly with an emptier set, so the import asks for the PIN first (after
the file was chosen) and aborts when it is refused. That answer can go
stale during a long import (idle relock, "Lock now"), so an entry whose
restore would take a lock away asks again right before it replaces locks
if the app has relocked; a refusal fails that entry and keeps its previous
locks. A restore that only adds locks is not asked again. Locks are
restored LAST
for each entry, after the Xtream data restore, so a
failed merge leaves the playlist's previous locks in place. M3U group titles
travel verbatim (`normalizeParentalLockGroupTitles`, exact
dedup): locks match `channel.group.title` exactly, so the trimming
`uniqueStrings` used for favorites would weaken a lock on a title with
surrounding whitespace. A backup's lock lists are validated entry by entry
on import (`isWellFormedParentalLock*` in the shared contract): restore
treats them as authoritative and the normalizer drops what it does not
understand, so a damaged list is rejected rather than erasing the
playlist's persisted protection.

`lockedGroupTitles` (M3U), `lockedCategories` (Xtream `{categoryType,
xtreamId}`, Stalker `{categoryType, categoryId}`) travel in each entry's
`userState`, written only when the playlist has locks. Absent means "no
opinion" and restore leaves the target's locks alone; present replaces them
(`replacePlaylistLocks`, which also re-stamps the Xtream index). The PIN is
never exported.

## Not yet covered (phase 2)

Favorites, recently viewed, playback positions / Continue Watching, the
dashboard rails built from Stalker and M3U documents, global favorites /
recent pages, the EPG guide, downloads and recordings lists, the remote
control's channel-number resolvers, the command palette's channel search and
the Electron-only global search page (`/workspace/search`, whose stored
results are not re-run on a relock) still show rows from locked categories. The SQLite-side hooks exist
(`unlockedCategoryCondition()` / `unlockedCategorySql()`), the renderer
predicate is `ParentalLockService.is*Locked`.

## Files

- Contracts: `libs/shared/interfaces/src/lib/parental-lock.util.ts`,
  `parental-lock-pin.util.ts`, `Settings.parentalLock*`,
  `PARENTAL_LOCK_SET_STATE`.
- Renderer: `libs/services/src/lib/parental-lock/` (`ParentalLockService`
  owns the session state and PIN flows; `ParentalLockLockStore` owns the
  persisted lock set, its unreadable state and the SQLite re-stamp),
  `apps/web/src/app/services/parental-lock-prompt.service.ts`,
  `parental-lock-enforcement.service.ts`,
  `apps/web/src/app/settings/settings-parental-section.component.*` and `settings-parental-lock.facade.ts` (rows anchored and indexed for settings search),
  `libs/ui/components/src/lib/parental-lock-pin-dialog/`,
  `libs/portal/stalker/feature/src/lib/stalker-category-lock-dialog/`.
- Electron: `apps/electron-backend/src/app/database/parental-lock-state.ts`,
  `services/parental-lock-state.ts`, `events/parental-lock.events.ts`,
  `database/operations/category.operations.ts` (`setCategoryLocks`).
