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
  rail, which opens the PIN prompt.
- The unlock lives in memory only. The app locks again on every restart, on
  "Lock now" (header button, command palette, settings), and after
  `Settings.parentalLockRelockMinutes` minutes without user interaction
  (default 15; `0` = only on restart). The idle timer follows the UNLOCKED
  transition: armed the moment a session is unlocked — including the session
  that just enabled the feature — and disarmed on lock. Active playback of a built-in web
  player counts as interaction, so a film never locks half way.
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
The window before the initial read settles is treated the same way
(`ParentalLockLockStore.readable` is false until then): settings can report
the feature as on before the locks are known — and the workspace route's
`settingsReady` resolver awaits `ParentalLockService.initialize()` next to
the settings load, so no route or catalog activates before the PIN and the
lock store are known (in the PWA the settings read can be the slower one).
Every lock write re-reads a failed store BEFORE building its edit, so a
recovered store is edited, never overwritten by an edit built on the empty
fail-closed one. The feature switch itself is
persisted through one guarded path (`persistEnabled`): `updateSettings`
patches memory before it writes, so a failed write is undone in memory and
`setupPin`/`disable` report false (whether to persist is decided from the
settings switch BEFORE the PIN is stored, since `enabled` follows `hasPin`
while the switch is unknown); the Electron mirror write is awaited
next, and a mirror that cannot be written undoes the settings write the
same way — the toggle never shows a state the next launch will not have,
on either side.

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
  leaving that portal, so its reload runs on every apply. Applies run one
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
  database answers: the selected detail is stepped off synchronously when
  the lock store already names its category (the pre-reload category list
  maps Electron's row id to the provider id), then `withholdCatalog()`
  empties every catalog list and `clearSearchResults()` the stored search
  before the filtered reads refill them; both reloads take a publish guard
  answered before every state patch, so a read issued under an older lock
  version is dropped instead of published. A lock change that overtakes
  the INITIAL hydration (the content is not initialized yet, so the reload
  has nothing to re-read) sets a deferred-reload flag instead: the
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
  is locked. `StalkerLiveStreamLayoutComponent` drops its `activePlayback`
  whenever the store selection is cleared: its template mounts the player
  only with a selection, and the held stream must not resurface with the
  next one.
- **Xtream (PWA):** `PwaXtreamDataSource` drops withheld categories,
  streams and search hits at read time; the same reloads apply.
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
- Lock toggles in the Xtream category-management dialog and the M3U group
  dialog (rendered only while the feature is on), plus a new Stalker
  `StalkerCategoryLockDialogComponent` reached from a lock button above the
  categories rail; it offers "Lock adult (18+)" for genres the portal flags
  `censored`. All three list the locked names and can rewrite the locks, so
  each opens only after `requestUnlock()` succeeds — and closes itself,
  discarding the draft, the moment `active` becomes true again (idle relock,
  Lock now), since the PIN gate covers only the opening. The M3U group
  dialog does this only while it carries lock toggles; the plain hide/show
  editor is not behind the PIN. The Xtream dialog loads
  its candidates through the capability-selected data source
  (`IXtreamDataSource.getAllCategories`, which the PWA source answers from
  its session cache or the API), so PWA users can set locks too; the
  hide/show checkboxes remain Electron-only. The relock timeout persists
  through the same undo-on-failure pattern as the switch
  (`setRelockMinutes` reverts the in-memory value and the facade shows the
  settings save-failure snackbar). The M3U dialog hands its lock
  list back to `ChannelListContainerComponent`, which awaits the write and
  reports a failed save in a snackbar (the dialog has closed by then). On
  Electron the `categories.locked` re-stamp (`setCategoryLocks`) clears and
  re-locks one playlist/type inside ONE transaction, so a failed restamp
  keeps the previous index instead of leaving every category unlocked. The
  store commits BEFORE that re-stamp, so a failed re-stamp rolls the store
  back to the previous locks AND re-stamps every touched type from them (a
  backup restore stamps three types, and the ones before the failing type
  already carry the new locks; a category must not be recorded and shown
  as locked while Electron reads, which filter by the index alone, still
  serve it); if the rollback write or its re-stamp fails too, the playlist is
  re-stamped on the next store access, and every launch re-derives the
  index from the store for each playlist that has locks — which is why a
  write that removes a playlist's LAST lock clears the index first and
  drops the key afterwards (the reconcile finds playlists only through
  their key; an interruption then leaves store-with-lock and index-without,
  which the next reconcile repairs toward locked; a store recovered by a
  later successful read marks its playlists stale the same way) — awaited inside
  the store's `load()`, so `readable` (and with it every catalog read the
  renderer gates) stays false until the index agrees with the store; a
  re-stamp that keeps failing keeps the session fail-closed.
- Header lock/unlock button and the `parental-lock-now` /
  `parental-unlock` palette commands.

## Backup

M3U group titles travel verbatim (`normalizeParentalLockGroupTitles`, exact
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
  `apps/web/src/app/settings/settings-parental-lock*`,
  `libs/ui/components/src/lib/parental-lock-pin-dialog/`,
  `libs/portal/stalker/feature/src/lib/stalker-category-lock-dialog/`.
- Electron: `apps/electron-backend/src/app/database/parental-lock-state.ts`,
  `services/parental-lock-state.ts`, `events/parental-lock.events.ts`,
  `database/operations/category.operations.ts` (`setCategoryLocks`).
