# Xtream Portal Compatibility

This document captures the Xtream Codes compatibility rules shared by the
Electron and PWA paths.

## Runtime Selection And Ownership

`provideXtreamDataSource()` selects `ElectronXtreamDataSource` only when
`RuntimeCapabilitiesService.supportsXtreamSqliteDataSource` proves that the
complete SQLite-backed Xtream bridge is available. Otherwise it selects
`PwaXtreamDataSource`. A generic Electron or `window.electron` check is not the
data-source capability contract. Older favorites/recent branches that still
probe `window.electron` directly are migration debt, not an alternate runtime
selection rule; changes in those paths should follow the selected data source
and explicit capabilities.

Ownership follows the workspace boundaries:

- routed screens and screen-session orchestration:
  `libs/portal/xtream/feature`
- Xtream API, cache, Signal Store, and data sources:
  `libs/portal/xtream/data-access`
- provider-neutral collection services and reusable multi-source
  discovery/resolution: `libs/portal/shared/data-access`
- reusable presentation: `libs/portal/shared/ui`
- pure provider-neutral contracts/helpers: `libs/portal/shared/util`

Persisted Xtream identity is playlist-scoped and content-type-aware:
`playlist_id + content.type + xtream_id`. Mixed collection keys likewise
include type plus provider ID because live, movie, and series IDs can collide.
Do not confuse the normalized SQLite row ID with provider `xtream_id`,
`stream_id`, or `series_id`, especially when recovering a hidden provider
category for detail playback.

See [Nx Workspace Boundaries](./nx-workspace-boundaries.md),
[SQLite DB Worker](./sqlite-db-worker.md),
[Portal Detail Navigation](./portal-detail-navigation.md), and
[VOD Multi-Source](./vod-multi-source.md).

## Durable Electron Favorites

SQLite favorites are user-owned records keyed by playlist, normalized content
kind (`live`, `movie`, `series`), and provider ID. The nullable catalog link uses
`ON DELETE SET NULL`; only explicit favorite removal/clear or playlist deletion
removes a saved record. Refresh and import-cache cleanup never replay canonical
favorites from a temporary snapshot. The two Refresh entry points continue to
share `XtreamRefreshFlowService` and its per-playlist single-flight guard.

Favorite rows retain a durable `favorite_id`, saved title/artwork, added date
and order. Their `id`/`category_id` may be null; consumers must not invent a
catalog ID. Remove/reorder can use the stable favorite ID while detail toggles
resolve any category row through the same typed provider identity. Completed
imports reconnect valid identities. Display snapshots are replaced only after
the returning row confirms every saved TMDB ID/year; incomplete identity keeps
the saved title/artwork in collections and backups. Restore applies the same
confirmation guard before filling gaps in saved metadata from catalog rows.
When detail enrichment confirms the remaining identity fields, it immediately
copies the returning title, artwork and metadata into the saved snapshot without
waiting for another import. Blank catalog fields retain their saved values.
Conflicting known TMDB IDs or release years prevent automatic reconnection;
changed provider IDs never reconnect by title. Electron persists known conflicts in
`favorites.identity_conflict`, separately from catalog absence. Completed imports,
detail enrichment and destructive cache refresh reconcile this evidence; only a
candidate confirming every saved TMDB/year clears it. Sparse returns remain compatible
when no conflict was observed. Backup snapshots carry known conflicts across runtimes,
and explicit favorite removal/re-add starts independent ownership.
Adding a conflicting replacement returns an explicit failure and retains the
older favorite. Detail and recent-collection toggles stay inactive and explain
that the older entry must be removed from Favorites before the replacement can
be saved. Collection hearts change only after the storage write succeeds.
Recent collections also check the current catalog row's favorite status through
the data source when loading: a retained favorite's matching provider key alone
cannot mark an incompatible replacement as saved.

`catalog_status` is `present`, `missing`, or `unknown`. Only a completed import
of the relevant type can prove absence. Failed, cancelled and in-progress
imports remain unknown. Collections and dashboard rails retain unresolved rows
with saved titles/status and removal/order controls; they suppress playback,
details, downloads and EPG requests that depend on catalog resolution. History
navigation rechecks current collection state. Removing a live row or making it
unavailable closes its active detail and invalidates pending selection work,
including a retained player during a channel switch. Unresolved records are not
promoted to dashboard hero slides, including Continue Watching and the most-recent fallback.
Unavailable live candidates are excluded before EPG lookup, candidate limits and
slot reservation; Recent rail projections and EPG cards retain availability and cannot
borrow cached programmes. Unavailable series are excluded before continuation candidate
selection, so watched/season-zero positions cannot schedule replacement episode requests;
history and saved positions remain intact. Parental locks still gate display: an
unresolved category cannot prove that it is unlocked, so those records remain
stored but are withheld while locks apply. For duplicate category copies, ordinary
reads choose an unlocked compatible row before resolving the catalog link; a
locked earlier copy cannot hide a later unlocked copy. Detail favorite status, mutations and Recent recording carry the displayed normalized
TMDB/year through the worker lookup. That lookup excludes known conflicts and ranks
full confirmation before sparse compatible duplicates; omitted identity keeps legacy
lookup behavior. Async detail status ownership includes identity as well as typed provider
ID, so a late toggle cannot update a different displayed replacement. Fully confirming duplicates
rank before sparse compatible rows, with the catalog row ID breaking ties, so a
confirmed return can refresh saved artwork in reads, completed imports and exports. Backup reads remain
unfiltered.

Legacy pending favorites are converted before destructive refresh, import
requests and ordinary collection reads, even if portal-status preflight is
offline. Ordinary collection reads isolate failed conversions per playlist and
still read healthy database favorites, retaining pending state for retry. This
also applies when localStorage access or key enumeration fails. Backup reads
remain strict and fail if storage access or conversion fails. Backup merges convert any
older pending favorites before parking the incoming archive. Favorite inserts and a replay receipt commit together;
retries cannot resurrect a subsequently removed favorite. Deliberate backup import creates a
fresh receipt ID, which stays internal and is never exported. Identity-only old
backups use a labelled saved-item fallback until catalog metadata returns.
Backups include unresolved snapshots and locked records through a dedicated
unfiltered read; a failed favorites read fails export rather than producing an
empty collection. New backup imports materialize favorites before waiting for
an online catalog. Existing history, hidden-category and playback-position
restore contracts remain separate.
In server-storage mode the same shared import/replay boundary waits for a fresh
user-data read and earlier writes, then confirms the restored lists and required
snapshots with the server before consuming pending state. Restore receipts remain
client metadata in the atomic cache blob, never server playlist entries. Hydration
preserves them and shrinks favorite ownership on remote removals. Local write completion is separate from server confirmation: an unconfirmed receipt
retains its replacement target until the server accepts it. Retry and pending export use
that target, rather than a conflict-merged list. Explicit favorite/history/position edits
update the target atomically with their list and receipt, preserving removals and re-adds.
Only confirmed receipts may shrink ownership from later remote removals. Receipt-bearing
writes reject browser quota failures rather than acknowledge only in memory; ordinary
receipt-free server caches retain their existing memory fallback.

Browser imports convert desktop favorite snapshots into typed collection-cache
rows so saved titles and artwork remain visible offline. Browser exports include
the normalized nested favorite snapshots as well as their optional collection
cache, preserving metadata when the archive returns to Electron.
The backup boundary normalizes numeric-string TMDB IDs and years from older
browser snapshots with the shared metadata rules, preserving identity checks
after Electron restore. Nulls remain null; unusable placeholders are omitted.
Once all three browser catalogs have loaded successfully, a saved typed item
absent from those catalogs is retained with `missing` status. Favorites and
Recent persist that status across reload and disable catalog-dependent actions;
partial or failed hydration cannot establish absence. Returning compatible
catalog evidence can make the saved item available again without changing its
favorite date/order or an independent Recent snapshot's identity. Browser snapshots
record whether missing status came from absence or a known identity conflict.
A sparse returning typed row clears proven absence while retaining the saved
presentation and identity. It cannot clear a known conflict or an older missing
status whose cause is unknown; those still require identity confirmation. Favorite-status checks and stale detail-heart
mutations use the same retained-conflict rule; explicit removal with the saved original
identity remains available from Favorites. This
evidence survives reload and browser backup/restore for Favorites and Recent.
Favorite snapshot backups include allowlisted availability evidence in pending
state too, so retrying a failed snapshot write cannot enable a known conflict.
Older browser cache evidence is promoted only for the same typed identity and
compatible saved metadata; legacy optional-cache-only imports remain optional.
Duplicate category rows are ranked against the original collection snapshot:
fully confirming rows take precedence over compatible sparse rows, which take
precedence over conflicting rows. Favorite and Recent choose independently.
Catalog hydration keeps the saved snapshot separate from current provider rows.
Only a row confirming every saved TMDB ID/year may refresh that snapshot;
missing, partially confirmed or conflicting identity retains the original title,
artwork and metadata. Identity numbers use the shared Electron metadata normalizer: numeric strings
match numbers, and empty/zero placeholders are unknown. After confirmation,
blank catalog fields retain saved values. The favorite's added date and order always belong to user state.
Favorites and Recent reads/writes share this resolution. Recent/detail backdrop
writes check the actual catalog evidence, never the resolved collection row
which already carries saved identity. Browsing, reload and re-export therefore
cannot replace an imported snapshot merely because a provider reused its ID.
A known browser identity conflict marks the retained snapshot unavailable, so
collection and dashboard detail actions cannot open the replacement under the
saved title. This survives reload and clears only when the saved identity is
confirmed again. Legacy numeric aliases are deduplicated separately, with the
canonical typed snapshot taking precedence; stored copies never count as catalog
confirmation. Recent collection and dashboard mappings carry the same conflict
status into their detail guards. Explicit removal remains available. After removal, deliberately
favoriting the current item may replace the old snapshot (including legacy key
aliases); that replacement must persist before the new reference is saved, so
storage failure cannot silently resurrect the old title. Ordinary optional
snapshot-cache writes retain their existing quota behavior. The explicit browser
favorite and Recent writers, cold-detail favorite preparation, catalog normalization,
playback-position operations and pending-state serialization load on demand.
After loading, each mutation reads fresh storage and completes its writes
synchronously so concurrent additions are not lost; Recent snapshots and viewing
dates still share one atomic write.
Browser collection actions carry the rendered row's saved TMDB/year identity,
independent of whether the catalog has hydrated. Status, add and remove compare
that identity with the retained favorite; removal rechecks storage so a stale
Recent heart cannot delete a different favorite. Explicit removal of the original
row still works while the provider is showing a conflicting replacement.
Movie/series detail hearts carry the displayed detail identity too, and metadata
arrival refreshes their status after metadata persistence, without accepting stale
lookup results or an old detail completing after navigation. After
explicit removal, a cold Recent save uses its independently stored matching
snapshot; it persists that snapshot before the favorite reference. Missing
compatible metadata or a required snapshot-write failure rejects the save.
Cold detail enrichment updates the matching independent Recent snapshot without
treating it as catalog evidence or rewriting the retained favorite. This lets a
sparse Recent item gain its detail identity before a new favorite is saved.
For a cold Favorites-only detail, compatible enrichment stays in a bounded,
data-source-local candidate until the user explicitly removes and re-adds the
favorite. It never confirms catalog availability or mutates the retained snapshot
just by opening details. A changed stored snapshot invalidates the candidate;
re-adding persists its enriched snapshot before the favorite reference, so quota
failure leaves the item removed and retryable rather than restoring stale identity.
When a replacement favorite needs the shared snapshot, any Recent entry still
using the previous snapshot first receives its own copy, preserving the watched
identity and date. Failure to save that copy aborts the replacement. Sparse catalog
rows may refresh category routing even before confirming all saved identity fields;
protected presentation stays unchanged, and known conflicts still block actions.
Detail metadata fills missing identity and presentation fields in the current PWA
catalog row and reconciles each compatible saved snapshot separately. Identity-only
patches also persist, so an initially sparse favorite gains protection before a
later provider-ID reuse. A conflicting detail response cannot enrich another known
identity; independent Recent snapshots never backfill a retained favorite.
When a provider ID appears in multiple catalog categories, detail enrichment fills
only compatible missing metadata in each original row. The initial detail candidate
is selected against the normalized patch identity before saved snapshots are
enriched; a conflicting last duplicate cannot discard identity learned in details. It preserves each row's
category, title, poster, rating and other provider fields; conflicting rows are
left untouched rather than replaced by one resolved catalog object.
Favorite status and save guards choose raw catalog duplicates against the saved or
explicitly displayed identity as well. This selection hint cannot create catalog
evidence when no actual row exists, and an unrelated duplicate cannot veto a
matching heart action.
Saving a new cold detail favorite may hydrate and enrich its matching catalog
rows, but does not rewrite independent Recent entries. Optional history
enrichment cannot block the explicit favorite write when browser storage is full.
Playback captures the displayed title, artwork and normalized detail identity before
waiting for confirmation. That metadata travels with the captured playlist even if
navigation or catalog changes happen before the save. Shared live playback from
Favorites and Recent forwards the selected row’s metadata through the same
confirmed-playback boundary as the portal live view. New playback keeps its own
typed `collectionItem` on the Recent entry; a cold catalog never gives the older
independent Recent snapshot a new timestamp for a different played identity. Its metadata and viewing date are
saved atomically, independently of any retained favorite, and remain available
after reload, export/restore and deferred retries. Reading Recent never copies
that independent snapshot into the favorite cache. Older Recent entries still
use the shared cache; compatible optional caches keep their quota behavior.
Initial browser imports and deferred retries share `PwaXtreamBackupStorage`;
`PwaXtreamBackupStateService` supplies its injected storage for the importer.
Both write the lists first and require the nested favorite snapshots to persist
before consuming pending state. A quota or storage failure keeps the archive
parked for another attempt, including when the provider returns an empty catalog.
Each browser list write stores its restore receipt in the same JSON blob, under
`__iptvnator_xtream_restore_receipts__` outside the playlist arrays. Ordinary
list edits preserve that internal metadata, so retries skip completed list writes
and cannot undo later removals, reordering, history updates or playback progress.
A bounded per-playlist receipt remembers the imported keys still owned by the
archive. Explicit removal shrinks that set atomically, requiring no extra quota
space for a tombstone; a later re-add owns its current snapshot. Catalog hydration and
detail/cache normalization never count as an explicit replacement. Automatic Recent
reads/enrichment cannot append remote history to an unconfirmed server restore target;
they may only detach metadata for a legacy row already owned by that target. Actual
Play, removals and reordering remain explicit user edits. Remaining
metadata retries therefore preserve genuine user replacements without discarding
parked archived identity after an ordinary read. Pending exports combine current
applied lists with authoritative archived snapshots, dates and positions for
untouched imported favorites; receipts never enter the exported manifest.
When legacy Recent shares a required imported favorite snapshot, its metadata
is copied into the Recent entry with the viewing date before snapshot replay.
Removing or replacing that favorite cannot erase the history’s only metadata.
Legacy optional-cache-only imports keep their best-effort behavior. Saved
unavailable evidence can pass to an independent Recent snapshot only when both
snapshots confirm the same normalized identity in both directions. Only status
is copied; a different played identity retains its own metadata and availability.
Unavailable live Recent rows keep their individual history-removal menu action;
catalog-dependent playlist navigation, EPG mapping and details remain gated. A deliberate new
import gets a fresh ID and can intentionally apply the archive again.
Legacy browser-only `collectionItems` remain an optional cache. If a combined
write exceeds quota, restoration retries only the required favorite fields;
optional rows or extra cache fields cannot block metadata that fits. Optional cache fields enrich a required snapshot only when every saved TMDB/year
field is confirmed by the normalized cache identity; conflicting or partial
identity evidence cannot supply artwork or new identity fields. The same
fallback applies when copying a required favorite into legacy Recent. A failed
required-only write still keeps pending state.
The PWA retry loads that storage implementation on demand through a local module.
Collection identity lookups index only requested provider IDs per cached array,
including all typed/category duplicates. Recent heart checks reuse that index
instead of repeatedly scanning the catalog. Catalog refresh or detail enrichment
replaces the array and therefore invalidates its index; loading completeness
still comes from the original caches, never the requested subset.

Both Xtream data-source and portal-activity capabilities require the pending
favorite conversion bridge; activity reads also require playlist lookup. The
SQLite capability also requires the unfiltered favorite backup reader. An
unsupported atomic restore performs no favorite writes: a fresh archive stays
parked, while an older pending restore is retained without being overwritten.
Subsequent collection reads and early catalog imports must enforce the same
preflight before replaying those favorites. Ordinary reads still return existing
SQLite records. Exports that need to materialize parked favorites fail while
atomic restore is unsupported; exports with no pending favorites remain available.

Records already deleted by an older build cannot be recovered without a
surviving pending state or backup. Opening an Xtream section may initialize
content when its cache is not ready; startup imports and explicit refresh use
the same durable persistence invariant. This does not add a refresh scheduler.

## PWA Collection Persistence

Collection operations carry `{ id, type }`: `id` remains the SQLite row ID
on Electron and the provider ID on PWA. Electron unwraps the row ID at its
existing database boundary. Typed lookups, favorite toggles, recent updates,
removals, backdrops and backup/restore retain the content type. A favorite toggle
reads persisted status for its exact typed target instead of borrowing the last
detail's favorite state. Live history uses the same confirmed-playback gate as
VOD and series: inline playback confirms its playlist-scoped session key, while
external playback confirms its URL. The initiating playlist and typed identity
remain captured across delayed confirmation. Selection without playback or a
resolved URL does not update history. See the
[playback-history contract](./embedded-inline-playback.md#recently-viewed-confirmation).

PWA keeps the existing localStorage keys. `xtream-favorites` contains ordered
`type:id` keys (for example `movie:42`); `xtream-recent-items` uses the same
keys in each entry's `id`, retaining `viewedAt` and backdrop metadata.
`xtream-collection-items` stores snapshots under those typed keys while each
snapshot's `id` and `xtream_id` remain numeric provider IDs. Hydration fetches
only the required content types; snapshots support collection reads offline.
Typed add/remove/status operations use synchronous local migration and never
wait for unrelated catalog hydration. `PwaCollectionStorage` owns that local
migration and snapshot persistence; the data source owns provider hydration for
collection loading and legacy numeric callers that still need identity evidence.

Legacy numeric and numeric-string references migrate lazily. A valid legacy
snapshot supplies its saved content type; otherwise all three catalogs must
be loaded successfully and exactly one type must match (repeated rows within
that same type are one identity). A partial catalog,
failed hydration, missing item or colliding ID never chooses a type. Such
references remain stored but hidden until identity can be resolved or the
user explicitly adds a typed item. Legacy numeric snapshot entries remain as
migration evidence for the other collection. Already-overwritten snapshots
cannot recover information lost by an older version. Ambiguous references
cannot be included in typed backup exports; the original browser storage is
retained. Migration merges into current storage after hydration, preserving
concurrent additions/removals, and duplicate recent references keep the newest
timestamp.

Migration writes and snapshot-cache writes are best effort when browser storage
is full. Reads still resolve the retained legacy evidence in memory. Typed
status and mutations match original numeric references through that evidence;
removal filters the original stored keys without first expanding the remaining
keys. Typed favorite-status checks never write storage. Additions save the
requested reference before attempting optional migration or snapshot copies, so
those copies cannot consume space needed by the requested save. Recent aliases
are deduplicated in memory before the 50-item limit, keeping the newest timestamp
and its original saved key until optional migration. Favorite/recent
writes requested by the user still propagate storage failures. A new reference
that fits can be saved without its optional snapshot and hydrated on a later
collection load.

## Connection Input

Xtream server URLs are normalized through
`normalizeXtreamServerUrl` from `@iptvnator/shared/interfaces`.

Rules:

1. Only `http` and `https` URLs are accepted.
2. URL username/password credentials are rejected.
3. Leading and trailing whitespace is ignored.
4. Trailing slashes are removed.
5. Full API or playlist URLs ending in `/player_api.php`, `/panel_api.php`, or `/get.php` are
   reduced to the portal base URL.
6. Provider subpaths are preserved. For example,
   `https://example.test/panel/player_api.php?...` becomes
   `https://example.test/panel`.

The Xtream import form may extract `username` and `password` from full
`get.php` or `player_api.php` URLs, but stored playlist metadata should keep
the normalized `serverUrl` plus trimmed credentials.

### Explicit protocol discovery

Add and Edit source share `XtreamConnectionTestService` and form-owned
`createXtreamConnectionTestState` (`@iptvnator/services`). The explicit
**Test HTTPS and HTTP** button has a visible, accessible pre-request notice
that credentials may be sent over unencrypted HTTP. Clicking that action supplies
`allowHttpFallback`; the service defaults it to false, so an ordinary programmatic
test cannot authorize plaintext credentials. No modal or persistent opt-in is
needed. The test first probes the entered base, including the existing account-action variants.
Only an initial `ECONNREFUSED` or TLS wrong-version failure permits one HTTP
candidate on the same hostname/path. Default HTTPS port 443 becomes HTTP 80;
nonstandard explicit ports are preserved, never scanned. DNS, timeout, reset,
certificate, HTTP authorization, and redirected-destination failures cannot
trigger a downgrade. Aggregate and nested cause errors require positive
evidence from every address; mixed failures, cycles and truncated error trees
fail closed. TLS verification diagnostics include incomplete certificate chains.
A response from an earlier account-action variant also
prevents downgrade. HTTP failures (including panels returning 500 for unsupported actions)
still try the remaining account actions on the same candidate.

An active account on HTTP replaces only the form's `serverUrl`, with localized
copy explaining that HTTP is unencrypted. Add/Save persists through the existing
metadata path; Test never writes storage. Edits, reset, destruction and newer
tests invalidate pending results and prevent a stale fallback request. Add/Save
is disabled while that form's test is running. Empty or whitespace-only
credentials produce a localized validation message without a network request. Passive status checks, startup,
refresh and playback never perform protocol discovery.
Every completed current test refreshes `PortalStatusService` for the exact
connection: account responses publish status and expiration; terminal failures
publish unavailable with no expiration, without another network request.
Older passive checks cannot overwrite this explicit evidence; stale form
results do not publish it.

Both transports return an optional, credential-free `connectionFailure` envelope
only for `connectionTest` requests. Electron returns it rather than throwing
through IPC (which loses custom error fields); the PWA proxy strips the control
parameter before contacting the provider and preserves validated redirect-chain
evidence. PWA URL/DNS-policy refusals and Electron URL/redirect-policy errors are local
connection failures, never reported as provider HTTP statuses or used to
authorize HTTP. Older backends without the envelope cannot authorize HTTP discovery.
Provider JSON remains nested in `payload` and cannot provide this evidence.

Electron resolves two more outcomes instead of rejecting them, because Electron
logs every rejected `ipcMain.handle` promise as a handler error with a stack
trace: a cancelled request (`XTREAM_CANCEL_SESSION`, a cancelled or expired
source-health probe) and an HTTP 401/403. Both return a
`{ portalRequestFailure }` envelope
(`libs/shared/interfaces/src/lib/portal-request-failure.util.ts`, classified in
`apps/electron-backend/src/app/events/portal-request-outcome.ts`) that
`ElectronService.forwardXtreamRequest` turns back into what its callers already
handle: health probes get an `AbortError` or an `HTTP Error <code>` Error
carrying `status`; catalog calls get the usual `{ type: ERROR, status, message }`
result — status 499 and no snackbar for a cancellation, the real 401/403
(previously lost as `[object Object]`) for a refusal. The main process logs a
refusal as one credential-free `console.warn` (unless `suppressErrorLog`), a
cancellation only under `IPTVNATOR_TRACE_IPC`, and everything else as before
at error level with a rejection.

The saved base drives catalog refresh, provider EPG, live/VOD/series/catch-up URL
construction and fresh Favorites/Recent resolution. The routed Xtream session
observes metadata connection changes and bootstraps the new connection. Separate
XMLTV source URLs, provider-supplied absolute URLs and already-issued download
or playback sessions retain their own URLs; they are not rewritten. No database
schema change or migration is required.

## Account Status

Account status handling uses `resolveXtreamPortalStatus`.

Compatibility rules:

1. Status text is case-insensitive, so `Active`, `active`, and `ACTIVE` are
   treated the same.
2. `auth` values `1`, `'1'`, and `true` can mark a response as active when no
   status text is present.
3. `auth` values `0`, `'0'`, and `false` mark the response inactive.
4. `exp_date` values `0`, negative numbers, missing values, or invalid values
   are treated as no expiry.
5. A past positive `exp_date` marks the account expired even when status is
   active.

Status probes try account-info-compatible Xtream variants in this order:

1. `action=get_account_info`
2. no `action`
3. `action=get_profile`

This fallback exists because real panels differ even when they advertise
Xtream Codes compatibility.

## Request Construction

Electron IPC and the PWA backend both construct API requests by appending
`/player_api.php` to the normalized portal base URL. They must not append
`player_api.php` to an already full `player_api.php` or `get.php` URL.

Credentials sent to the API are trimmed before serialization.

The PWA backend only proxies Xtream requests through registered provider
targets. Those targets are validated when registered and revalidated before the
`/xtream` proxy request, including protocol, URL credentials, DNS resolution,
and private-network checks.

## Provider EPG

Xtream EPG comes from the portal itself. `get_short_epg` feeds the
channel-row previews (`EpgQueueService`: three items, two requests in flight)
and the collection previews (`StreamResolverService`). `get_simple_data_table`,
falling back to the legacy `get_simple_date_table`, feeds the live EPG panel
(`withEpg().loadEpg()`) and the collection detail panel. All of them use the
ordinary `XTREAM_REQUEST` transport, so they are gated on
`RuntimeCapabilitiesService.supportsProviderEpg`. It is true in the browser
PWA, where `PwaService` forwards to the backend `/xtream` proxy, and in
Electron when the `xtreamRequest` and `stalkerRequest` preload methods exist.
Both runtimes send the EPG actions as silent background requests (no error
snackbar) through the same per-host connectivity guard as the catalog. Only
connection-level failures count, so a panel that answers EPG requests slowly
or with an error status cannot fast-fail playback.

The local XMLTV parts keep the XMLTV capabilities and stay off in the PWA:
the `epg_channel_id` fallback and `preferUploadedEpgOverXtream`
(`XtreamXmltvFallbackService`), and manual EPG mapping (`supportsEpgMapping`).
The PWA hides the catch-up actions of the EPG panel (watch, copy, download):
`RuntimeCapabilitiesService.supportsProviderCatchUp` is false there until a
manual check against a real provider shows that the browser players play the
REST MPEG-TS timeshift URL the PWA falls back to (see Catch-Up Playback URLs).
It gates `archivePlaybackAvailable` (Live TV) and `timelineArchiveAvailable`
(Favorites/Recent); the desktop app keeps all three actions.

## User-Agent

Xtream account, catalog, detail, EPG, and source-health API requests carry the
playlist's trimmed `userAgent` separately from provider query parameters.
Credentials built for selected-channel and channel-list EPG, account dialogs,
PWA collections/category loading, category guards, and dashboard episode lookups
retain that value. Dashboard episode request identity includes the User-Agent so
an edited value retries a blocked lookup without waiting for the old cooldown.
Add/Edit connection tests use the current form value. Electron chooses a nonblank
override before `XTREAM_CLIENT_USER_AGENT`. The PWA proxy
accepts the override as a control parameter, removes it from the provider query,
and sends it as `User-Agent`. Blank overrides retain each transport's fallback.
Passive status caches and in-flight checks include the normalized User-Agent, so
changing it cannot reuse a refusal from the previous client identity.
The shared source-status service forwards the same override for browser-build
status indicators in the Sources page and playlist switcher, including rechecks.

Electron's `XTREAM_REQUEST` and stream-probe handlers plus fresh Xtream movie
and series-episode download requests share the exported
`XTREAM_CLIENT_USER_AGENT` fallback. A playlist's explicit User-Agent,
Referer, and Origin are propagated to either download kind; the explicit
User-Agent still wins over the fallback. Legacy
download rows without a stored User-Agent receive the fallback when retrying,
resuming, or recovering a missing completed file. Download rows intentionally
survive individual source deletion; when the playlist row is already gone and
its type can no longer be recovered, a headerless legacy download receives the
same IPTV-player fallback, while a still-identifiable Stalker row remains
unchanged. Some Xtream
panels sit behind a WAF (e.g. Cloudflare) configured to challenge
generic/incomplete browser-looking User-Agents while allowlisting known IPTV
player clients; a player-style User-Agent (currently a VLC signature) can avoid
that challenge page, whereas a browser-looking but non-browser TLS/HTTP client
(axios/curl with a Chrome or empty User-Agent) can be blocked even though a
real browser or a VLC-style client passes. Keep all three request sites using
the shared constant instead of inlining the string again.

## Playback URL Formats

When account info includes `user_info.allowed_output_formats`, the current
Xtream playlist keeps those formats for the active session. The default
application format is `auto`: live stream URL construction chooses `m3u8` when
the provider allows HLS, falls back to `ts` when MPEG-TS is the only known
standard format, and otherwise uses the first provider-advertised format. If
the provider does not advertise output formats, `auto` falls back to `m3u8`.
Manual `ts` and `m3u8` settings remain supported; when a manual setting is not
allowed by the portal, URL construction falls back to the first
provider-allowed format.

### Initial Auto HLS failure

The routed Xtream Live TV host attaches `ResolvedPortalPlayback.liveAutoTsUrl`
only when the current user preference is Auto and the current account explicitly
advertises both HLS and TS. `XtreamUrlService.constructAutoLiveTsUrl` uses the
same credential encoding and provider-subpath URL builder as the initial URL;
no URL string replacement, manifest preflight, stream download, or API probe is
introduced. Unknown/empty formats and manual HLS/TS have no alternative.

`WebPlayerLiveAutoFormat` may consume that alternative once per mounted logical
live session, in the same selected web player, after an owned terminal network
diagnostic with HTTP 4xx/5xx, before the native video element reports `playing`.
A successful manifest is not playback. HLS key/media/unknown-stage failures,
DRM payloads, content-info VOD/episodes, and catch-up are excluded. Generic
network failures, status zero, cancellation, timeouts without an HTTP response,
and decode errors keep the normal explicit recovery surface.

The old application is first removed from the render tree. The next render
callback starts TS only after the web engine's synchronous loader teardown and
only while source, logical session and user intent still match. The TS payload
keeps the original headers, title and playback metadata; Electron applies them
through its existing scoped header handoff. HTTP-media requests retain the
existing transport/trust rules and do not feed new evidence or admission into
the separate portal-API host-connectivity guard. Recovery recommendations still
require a user action and never auto-switch engines. No settings or playlist
cache is changed. A TS failure displays normal recovery actions; Retry repeats
TS without rearming the automatic attempt. Changing the actual logical channel
or playlist, or mounting a new host, creates a new session; same-session metadata
or provider-source refresh does not rearm it. Same-channel replay and metadata
refresh preserve the chosen TS while the candidate URLs, headers and mode stay
the same; an actual transport/provider change discards that selection. This deliberately avoids a sticky
playlist preference and reevaluates advertised formats on the next channel.

| Player/path                              | Initial Auto failure support                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML5 / ArtPlayer, hls.js                | One advertised TS attempt after terminal HLS manifest/level/segment HTTP failure; waits for the engine's own bounded retries                                                                               |
| Video.js / VHS                           | Only an observable terminal HTTP diagnostic can trigger an attempt. A sole HLS rendition's failing segment can remain in VHS retry/exclusion cycles without such a diagnostic; use manual TS for that case |
| External MPV / VLC                       | Manual TS only. Process launch/exit and best-effort playing telemetry do not reliably identify the initial HLS media HTTP failure                                                                          |
| Embedded MPV                             | Manual TS only; no equivalent structured HTTP diagnostic                                                                                                                                                   |
| Unified Favorites/Recent live resolution | Manual TS; it does not own fresh session account-format evidence                                                                                                                                           |

For manual recovery, stop the current player, choose **Settings > Playback >
Stream Format > ts**, save, and reopen the channel. This keeps the chosen player
and avoids a second uncorrelated external process. The settings description
explains this route. This is partial playback coverage of #1513, not a claim
that all external-player and VHS scenarios automatically recover.

Synthetic regression media lives in the mock's `live-fallback:live-fallback`
account: HLS manifest 200 plus segment 403, manifest 403, a playable local
H.264/AAC TS alternative, a failing TS alternative, and a delayed HLS segment.
Tests assert actual video progress and the number of concrete TS requests.

If stored Xtream playback credentials contain an invalid server URL or blank
username/password, stream URL construction returns an empty URL instead of
throwing during playback.

VOD playback uses the standard
`/movie/{username}/{password}/{streamId}.{containerExtension}` URL after
resolving the stream id and container extension as one source. A provider's
explicit absolute HTTP(S) `direct_source` is also a complete source when paired
with a positive stream id; its address is used verbatim for playback and
download, including when the extension is null, missing or blank. Other URL
schemes and relative addresses are ignored. Fields from
`movie_data` take priority, with the top-level catalog fields used as a
fallback when extended metadata is absent or incomplete. A source requires a
positive integer id and either a non-empty container extension or a valid direct
address; otherwise URL construction returns an empty string. No container is
guessed. Each candidate must belong to the requested provider stream id, and a
catalog candidate with conflicting known TMDB/year identity cannot supply
playback fields or presentation. This does not change durable favorite identity
or make an unavailable saved favorite available.

The Electron catalog cache does not persist the container extension. If the
merged detail response and cached row still cannot resolve a source, the detail
loader requests the exact VOD from its provider category and merges that raw
catalog row in memory. An Electron route category uses the SQLite row id, so
the loader maps it through the complete persisted category set, including
hidden categories, before sending the provider `category_id`. Cross-portal
Similar links already carry that provider id, so recovery accepts either the
SQLite `id` or `xtream_id` representation while preserving local-id lookup
precedence. If the numeric representations collide, candidate provider ids are
deduplicated and tried in that order until the exact VOD is found. PWA falls
back to its API-backed visible categories, and an unresolved database id is
never sent as though it were a provider id. This recovery request is skipped
when the detail response or owner-valid cached catalog fields are already
sufficient. Recovery is best-effort and never gates the detail page: the initial
sparse selection is published and the loading shell ends before the category
lookup completes, then a successful result upgrades that same fallback
reactively with playback actions. Detail, recovered, and cached
playback fields remain separate candidates: the first complete pair wins, so
two incomplete rows can never synthesize a source. A failed lookup leaves the
already-rendered item safely unplayable. A second identical `get_vod_info`
request is not issued automatically after a fresh incomplete response; reopening
the detail retries through the normal loader. Detail requests are generation- and
playlist-guarded, and detail teardown invalidates the active generation, so a
late response cannot replace a newer selection or repopulate a closed detail.
In-memory VOD category and stream arrays record the playlist that populated
them. Cross-portal Favorites/Recent details ignore arrays owned by another
playlist, so colliding Xtream ids cannot suppress recovery or contribute a
foreign playback extension, title, poster, category, or recommendation.

Null or absent detail payloads normalize to empty metadata before source recovery.
Catalog identity checks use provider-stated years; a release date filled by TMDB
cannot veto an otherwise matching playback source.
Metadata availability and VOD playability are independent. An empty or sparse
`get_vod_info` response keeps the curated fallback detail page, but that page
offers the same Play/Resume and Download actions when the source resolves.
Favorite and Watched are independent of stream availability and retain their
typed playlist/provider identity and existing persistence/playback guards. An
unresolved source keeps Play disabled with a translated explanation covering
playback and download; it cannot launch a player or enqueue an empty address.
A downloaded local copy remains playable. Playback and download
descriptors also fall back to the catalog title and poster after `info` and
`movie_data`.

A new PWA favorite from a cold detail hydrates only its typed catalog when
needed. When the initial detail backfill ran before catalog hydration, the
explicit save applies that metadata to the compatible current row. Retained
Favorite/Recent snapshots keep the existing identity, conflict and quota
protection; adding a favorite cannot rewrite an older saved movie implicitly.

Provider stand-ins in `get_vod_info` / `get_series_info` (`N/A`, `-`, an
unrated `0` score) are emptied before the response becomes the store
selection (`stores/xtream-detail-metadata.ts`), since both detail routes bind
`info` fields directly. A `get_vod_info` response made only of stand-ins
therefore counts as sparse and gets the fallback page above.

## Catch-Up Playback URLs

Xtream-compatible portals differ on archive playback URL shape. IPTVnator
supports these catch-up variants:

1. REST-style `/timeshift/{username}/{password}/{duration}/{start}/{streamId}.ts`
   and `.m3u8`.
2. Legacy `/streaming/timeshift.php?username=...&password=...&stream=...&start=...&duration=...`
   with optional `extension=ts` or `extension=m3u8`.

Electron probes concrete catch-up variants before caching a playlist-level
choice. The cache key includes the playlist id and the normalized
`allowed_output_formats` advertised by the provider, so a catch-up variant
detected before account capabilities are known cannot force stale MPEG-TS URLs
after the portal later reports HLS-only playback. The probe uses a short range
`GET`, follows only validated redirects, and accepts only `200` or `206` as
playable. MPEG-TS is preferred before HLS when the provider allows it because
some portals return a valid HLS manifest while the first media segment fails in
Chromium/video.js. PWA fallback keeps the REST MPEG-TS URL when no Electron
probe API is available.

Catch-up is offered from the Xtream Live TV tab and from the unified
collection surfaces (per-playlist and global Favorites and Recent). The
`tv_archive` / `tv_archive_duration` columns are carried through the
favorites and recently-viewed DB projections and mapped onto
`UnifiedCollectionItem.tvArchive` / `tvArchiveDuration` so the shared live
tab can gate the timeline's archive window. `tv_archive_duration` is
interpreted as **days** everywhere, matching
`live-stream-layout.controlledArchiveDays` (issue #1138).

While a programme plays from the archive, both entry points draw it on the
player's seek bar as a titled segment; see "Timeline segments" in the
[player controls contract](player-controls-contract.md#timeline-segments).

Programme details in the Live TV and Favorites/Recent EPG timeline/list also
offer **Copy archive URL**. This uses the same resolver and persisted server
timezone without changing playback. See the M3U module's "Copy archive URL"
contract for clipboard feedback and credential/header handling.

### Start time is the panel's clock, not the viewer's

The `{start}` segment (`Y-m-d:H-M`) is read by the panel with `strtotime()`
in ITS OWN timezone — the one it reports as `server_info.timezone` in the
account-info response — never the viewer's local clock (issue #1562). The
timezone is learned by `withPortal.checkPortalStatus()` and normalized by
`resolveXtreamServerTimezone()` (`libs/shared/interfaces/src/lib/xtream-server-timezone.util.ts`):

- a timezone name the runtime's ICU resolves (`Europe/London`) is kept as is;
- otherwise (`UTC+3`, a typo, an unknown alias) the offset is derived from
  the clock pair the same response carries — `time_now` read as a naive UTC
  wall clock minus `timestamp_now`, snapped to 15 minutes — and stored as
  `UTC±HH:MM`. This is a snapshot without DST rules: for such a panel,
  programmes on the far side of a DST switch are off by an hour until the
  next account-info check refreshes the offset. Xtream Codes reports PHP
  timezone identifiers (IANA names), so the snapshot only serves
  non-standard servers, where the alternative was the viewer's clock;
- with neither, nothing is stored and the URL falls back to the viewer's
  clock, the only remaining guess.

The value is persisted on the playlist row (`Playlist.serverTimezone`)
because the two catch-up entry points read different sources: the Live TV
layout uses the store's `currentPlaylist`, while the Favorites / Recent
resolver (`StreamResolverService.resolveXtreamCatchupUrl`) reads the stored
row through `dbGetAppPlaylist` / IndexedDB. The write goes through
`IXtreamDataSource.rememberServerTimezone` and is atomic against the row's
CURRENT connection in both runtimes — Electron: one conditional UPDATE
(`DB_SET_PLAYLIST_SERVER_TIMEZONE` → `setPlaylistServerTimezone`,
`json_set(payload, '$.serverTimezone', …)` only while `serverUrl`/`username`/
`password` still match the request and the payload does not already carry
the value; a malformed payload is never rewritten); PWA:
`PlaylistsService.transformPlaylistMeta`, whose read and write share one
IndexedDB readwrite cursor transaction. No read precedes the write, because
the database worker interleaves requests and the Xtream edit dialog saves
through `DB_UPDATE_PLAYLIST` outside `PlaylistsService`'s queue: a
read-modify-write could hand a concurrent upsert's newer payload back to the
past or undo an edit that landed in between. The reverse ordering is covered
on the upsert side: `DB_UPSERT_APP_PLAYLIST(S)` (`playlistConflictUpdate`)
carries the STORED clock into a snapshot that has none while the row still
points at the same connection, so a favorites, recent-items or metadata write
built from a pre-clock snapshot cannot strip it; a snapshot carrying its own
clock, or moving the source, wins as is. The store offers the resolved
value on every check (a transient write failure is retried by the next one),
patches its own state only while the selected playlist is still the panel the
answer came from (`answersFor`: id + connection), and returns the store's
verdict about the current selection when it is not. An update that moves
`serverUrl` (`mergePlaylistMeta`, `DB_UPDATE_PLAYLIST`) drops the clock until
the next account-info check. Electron's `DB_GET_PLAYLIST` projects the
persisted value from the row payload so the store is seeded with it before,
or without, the account-info check. The same timezone lets
`XtreamApiService` read timestamp-less EPG `start`/`end` strings in the
clock the panel wrote them in (`parseXtreamServerLocalDateTime`);
`start_timestamp` still wins whenever it is present. Formatting uses
`hourCycle: 'h23'`, so server midnight renders as `00`, never `24`.

### Downloading completed catch-up programmes

Desktop Xtream Live TV exposes a TS-only download action in programme details.
It reuses the canonical timeshift resolver and original timestamps, preserves
playback headers and does not change playback. See
[Download Manager](download-manager.md#xtream-archive-downloads) for identity,
restart, expiry and transport-completion limits.

## Store composition and catalog windowing

`XtreamStore` is the public facade built with `signalStore()`, composing
`signalStoreFeature()` features for portal, content, selection, search, EPG,
player, favorites, recent and playback positions. Most features live under
`libs/portal/xtream/data-access/src/lib/stores/features/`; favorites and recent
items live directly under the data-access library’s `src/lib/`.
Routed components consume that facade; features delegate persistence/networking
to `IXtreamDataSource`, selected through `provideXtreamDataSource()`. Complete
SQLite capability uses database-first cache reads and API fill; the PWA source
uses API requests and session memory. This does not move screen orchestration
into shared utility projects.

Catalog lazy loading: catalog grids scroll infinitely instead of paging.
`withSelection` keeps a `visibleCount` render window over the in-memory
catalog plus bounded per-selection scroll snapshots for detail/tab
round-trips; the shared `InfiniteScrollDirective`
(`libs/portal/shared/ui`) measures container overflow to auto-fill tall
viewports (terminating on lack of container growth, not on a load count)
and fires `loadMore` near the bottom. The search layout routes its results
container through the same directive (`nearEnd*` inputs). Stalker feeds the
same contract from server-paged appends: portal pages accumulate into one
deduplicated list, `hasMoreContent` derives from accumulated length vs
`total_items`, a failed append keeps loaded pages and offers a tail retry,
and the facade maps page 0 to the skeleton and later pages to the tail
spinner. These catalog/search surfaces use incremental loading instead of
page buttons.

A failed initial search is distinct from a successful empty result. The search
store exposes an error state to the shared search layout; Retry retains the
query, content-type filters and hidden-category choice. New searches clear the
error, and obsolete failures cannot replace newer results. Global search uses
the same recovery surface without resetting the user's query or filters.

## Forced external launches from detail pages

The "…" menu's MPV/VLC launch follows the shared rules in
[Forced External Launches From Detail Pages](./embedded-inline-playback.md#forced-external-launches-from-detail-pages).
The movie page's pin and reset rules are in
[VOD Multi-Source](./vod-multi-source.md#menu-launch-and-reset-follow-the-primary-button).

The series page keeps its launch state at module level in
`serial-details-external-launch.ts`, so it outlives a recreated page:

- The owner is `playlist:series` (`launchOwner()`). It changes when the page
  shows another series and is null once the page is gone.
- Forced launches of one owner run on one chain. A later launch waits for the
  earlier one to settle, closes the owner's running episode session and then
  launches. Each step rechecks the owner, and a launch that resolves after the
  page left the owner closes the session it opened.
- The duplicate guard is keyed by page token plus episode. The token
  (`pageToken()`) is owner, page instance and visit, so a launch left behind
  by an earlier visit of the same series does not swallow a launch from the
  reopened page; that launch queues on the owner's chain.
- While a forced launch of the owner is pending (`forcedLaunchPending`), a
  start that does not force a player is queued instead of started. One choice
  is kept per owner, the latest wins, and it carries the host and `start` of
  the page that made it. Once the chain settles, the player the launch opened
  is closed first while the owner stays pending. The choice is dropped when
  that page no longer shows the owner or the close was not confirmed.
- The pending flag also disables the menu's external-player row and the
  season and series watched actions, and counts as active playback for "Reset
  progress".
- The launch-position marker and a launch-failure message apply only while
  the page token is unchanged.

Regression coverage: `serial-details-external-launch.spec.ts` (chain,
duplicate guard, queued choice), `serial-details-playback.service.spec.ts`
(page token, the queued start, the launch-position marker),
`serial-details-menu.service.spec.ts` (launch-failure message, the rows held
while a launch is pending) and, for the external-player and reset rows,
`libs/ui/components/src/lib/detail-ui/series-hero.state.spec.ts`.

## Framework-free TV catalog recency

The provider client entrypoint exports `xtreamCatalogTimestamp` for the TV
adapter. It uses the shared recently-added epoch validator, accepts ISO provider
dates, and falls back to `last_modified` for series without a usable `added`
value. It does not infer addition time from release dates or IDs. TV applies
this timestamp before client pagination; see [TV application](tv-application.md).
The Angular selection store's sort behavior is unchanged.
