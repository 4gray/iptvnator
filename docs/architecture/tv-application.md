# IPTVnator TV prototype

The TV client is a separate Preact 10 application (`apps/tv`), with feature,
UI, data-access and pure contracts under `libs/tv`. It does not load the Angular
renderer, Electron bridge, Node runtime or another player engine.
The approved target is LG OLED55BX9LB, firmware 04.64.00, webOS 5.x / Chromium 68.
A successful desktop browser test is not device certification.

## Runtime and ownership

- `tv-feature`: shell, sources/settings forms, cinematic home, catalogs, live
  preview, detail/episode navigation, and selection/request ownership.
- `tv-ui`: poster/hero primitives, directional geometry, stable focus keys and
  platform Back. Pointer movement focuses controls without starting streams.
- `tv-data-access`: provider adapters, backend transport, TV storage, explicit
  direct-access diagnostics and the single native video adapter.
- `tv-util`: provider, source, catalog and playback contracts. A media key is a
  JSON tuple containing source identity, provider, content type and provider ID.
  Episode keys additionally preserve parent and season/episode coordinates.
- Framework-free clients live in their provider domains and are exposed via
  `@iptvnator/portal/xtream/client` and `@iptvnator/portal/stalker/client`.
  Angular imports must continue to use the existing data-access wrappers.

The Vite build targets `chrome68`, emits a single classic deferred IIFE and
relative assets for packaged `file://` launch. Runtime module inspection rejects
Angular, NgRx, RxJS and Electron. TV client lint rejects Node/framework imports
and existing domain/type constraints remain additive.

## Provider contract

`ProviderClient` implements connection, paged catalogs/categories, metadata,
episodes, EPG and fresh playback resolution. Transport is explicitly configured
by the user; it never silently falls back from backend to direct access.

The backend's existing `provider-targets`, `xtream`, `stalker` and `parse` routes
retain URL admission, redirect, host-guard and MAG-header policies. Backend URL
and optional access token are configured on the TV. Packaged app deployments
must allow their actual Origin in the backend's `CLIENT_URL` setting. A backend
is an explicit credential destination; use one you control. No API response,
credential, portal URL or resolved stream URL is logged by the TV application.

Xtream retains URL normalization, account status, complete VOD stream-ID and
extension candidates, Unicode/base64 EPG and panel timezone conversion. EPG
normalization is extracted from `XtreamApiService`, whose existing API remains
available. Provider stream paths retain source/type identity; local row IDs are
never sent as Xtream IDs.

Stalker uses the existing authentication implementation with a narrow transport
interface, observed full/simple endpoint classification, persisted idempotent
tokens, one shared repair attempt, MAG profile/identity rules and watchdog.
Device IDs/signatures are explicit source fields, never generated or bound
silently. Regular, embedded VOD and lazy Ministra series use the existing series
adapters; the latter no longer imports an Angular utility just for its flag
predicate. Lazy playback retains original file IDs, parent and season coordinates.
Relative commands, file lookup and static/temporary link flags retain provider
semantics. Bulk provider EPG falls back to short EPG independently of playback.

M3U URL imports use the existing backend parser and shared VOD detection.
Groups and recognized standalone VOD are exposed. Standalone episode URLs do
not acquire an invented series hierarchy. XMLTV and DRM are excluded.

## Backend discovery and phone setup

Sources and Settings verify the backend identity (`/tv/connection`, protocol 1)
and its authorized API check before displaying Connected. Saved addresses are
checked on launch and every 30 seconds while visible. Editing either address or
token invalidates the indicator and cancels stale checks. This TV package needs
the matching backend version; older backends without these routes must be updated.

With no saved address, the TV reads its current network through the read-only
webOS connection-manager service. Discovery probes only `iptvnator.local` and,
when a private IPv4 /24 or smaller subnet is available, that local subnet on
ports 3333, 3335 and 4333 (`/api`). Twelve concurrent requests, 750 ms per probe
and a 55-second search deadline bound the work. Discovery sends no credentials.
A single unprotected match is checked and saved automatically; multiple matches
require selection and protected servers require their access token. Other
subnets, IPv6, unavailable platform APIs, custom ports and failed searches keep
manual entry available. This is bounded HTTP discovery, not universal mDNS/SSDP.

The 30-second backend check updates connection status independently. Failed
provider initialization and initial catalog/detail loads retry after 2, 5, 10
and 30 seconds, then stop with a manual recovery action. Retries pause while
hidden, offline or in a playback session. Network/app return reinitializes an
idle provider; it never automatically replaces an existing media session.
Manual retry, a changed source/backend or network/app return resets the budget;
a healthy minute also resets it. Failed appended pages retain their loaded rows
and explicit Retry loading action. Reconnection recreates provider transport
and reloads the current view. Missing backend target registrations are renewed
once after a backend 404; upstream errors do not trigger target renewal.
Transport requests have a 35-second deadline and refuse redirects.

Sources and Settings offer the selected home server's shared library when its
public instance endpoint verifies compatibility. The capability probe sends no
token. Use this server's sources explicitly connects with the selected backend
token; it never silently changes the source library. Separate library URLs and
tokens remain available for companion deployments. Error notices own their
recovery action: saving settings/favorites/progress does not reconnect providers.

`apps/tv-setup` owns the lightweight phone form. The web backend builds and ships
its HTML/JS/CSS as assets and mounts the session API in
`apps/web-backend/src/app/tv-setup`. A TV creates a five-minute session after
backend authorization. Separate random capabilities authorize the TV and phone;
the QR carries only the phone capability in a URL fragment, removed from the
address bar after loading. No global backend token is sent to the phone.
Session creation is rate-limited; at most 32 sessions exist in backend memory.
Restart, expiry, rejection or cancellation discards pending credentials.
Use a trusted local backend/network, or HTTPS when deployed beyond it.

The phone accepts M3U URLs, Xtream accounts and Stalker/MAG identities. It sends
one narrowed source draft; the TV shows its name, provider and hostname for
confirmation. Existing Stalker identity/password bytes are preserved. Only a
committed TV IndexedDB write produces a Saved receipt. Failed writes remain
retryable, and a stable session-derived source ID prevents retry duplicates.
The phone never reads source credentials back. QR transfer is source entry,
not account synchronization, playlist-file upload or a media relay.

Settings has its own purpose-bound QR session for layout, EPG and TMDB
preferences. The phone receives only nonsecret defaults and a has-key flag.
An empty key field preserves the saved key; a replacement is visible only to
the TV capability and never echoed in the review. The TV validates the narrow
settings draft, requires a key when enabling metadata, and commits it atomically
without changing sources/history. Source and settings sessions cannot exchange
draft types. The same expiry, cancellation and committed-write receipt rules
apply. Navigating away during a write waits for its outcome before acknowledging.

## Optional server source library

Settings can connect independently to the self-hosted `/v1` server-storage API.
The client verifies service, API version, storage mode and instance identity before
sending a saved token or writes. Redirects are refused. A changed instance requires
an explicit reconnect; a failed/aborted/invalid read never replaces the cached
sources. A snapshot becomes visible only after the TV IndexedDB transaction commits.
Startup, visible app return and a 60-second foreground timer refresh sources while
not playing; Settings also exposes manual refresh, status and last successful sync.
This timer is independent of backend health checks and provider reconnection.

M3U URLs, stored file/pasted M3U payloads, Xtream and Stalker sources are supported.
The mapper preserves provider credentials, explicit MAG identity and observed
full/simple mode, but never imports another device's Stalker session token. Existing
TV sessions survive unchanged connection fields. Shared framework-free
`sourceIdentity` matches accounts using the same rules as PWA migration. A matching
local source retains its TV media ID and an original configuration copy; new entries
have an instance/playlist-scoped ID plus the original server playlist ID.

The server controls linked source configuration. Edit/delete happen in the PWA;
refresh applies changes and removes missing server entries, retaining local viewing
data and restoring an original local source when one was linked. Disconnect restores
original local configurations and keeps other downloaded sources as local copies.
Favorites, history, progress and TV preferences are not synchronized in this phase.
Source credentials are cached locally just like manually entered TV sources.
Custom header fields are retained for copying; only the existing M3U parser's
User-Agent option is applied here. Native video still cannot attach arbitrary
provider headers, and this change does not add Xtream header handling.

Copy to server is an explicit per-source action. It re-reads the library, keeps an
existing provider account unchanged and creates missing records with stable IDs and
`If-None-Match: *`. A conflicting ID or failed write is visible; a retry after a lost
response cannot overwrite a server record. Concurrent independent uploads of the
same account with different IDs are not globally deduplicated by the server API.
No automatic source writes or server deletions occur. Malformed/unsupported documents
fail the refresh as a whole, preserving the previous cache rather than silently
losing entries. Full file M3U payloads are fetched only for sources without a URL.

The optional [TV companion container](../../docker/tv/README.md) can provide TV APIs
and a narrowly configured gateway to an existing PWA library without touching its
service or database. The existing server remains authoritative; the gateway does not
create a second shared database. Electron still does not activate server storage.

## Playback and local data

One `HTMLVideoElement` exists for preview and fullscreen. Focus movement never
switches streams. First OK starts live preview; repeated OK opens fullscreen.
Fullscreen Back restores the opening control, and detail Back restores item
identity and catalog page. Controls appear on demand; remote media keys and
native VOD seeking use the same adapter.

Live opens a large category list in its left pane. OK enters the selected
category; its header button or Back within the Live panes returns to categories.
Back from categories leaves Live; fullscreen Back first returns to preview.
Re-entering the same category restores the channel identity and scroll window;
choosing another category starts at its first channel. Category browsing never
starts or replaces playback. Source changes reset this local browse state.
Category rows use the same bounded 20-row window as channels, including distant
focus restoration; the All channels row remains available without provider groups.

Live owns a viewport-height flex/grid frame rather than the outer page scroll.
Its two independent scrollers are the category/channel list and programme guide.
Both reserve a scrollbar with `overflow-y: scroll`, supported on Chromium 68;
changing EPG content cannot resize or move the preview. The guide is a named,
focusable region: Up/Down scroll its contents, Up at the beginning exits, and
Left/Right use spatial navigation. Preview and channel actions remain fixed.

Live fullscreen offers Channels, Programme and TV Guide controls. With controls hidden,
Left opens the channel drawer directly; pointer users select Channels. The drawer
starts in the playing category and focuses the playing item. A playing item beyond
loaded provider pages appears once as a pinned row rather than crawling the catalog.
Category browsing and focus never change playback; OK resolves a selected channel.
The same native video element remains mounted. Back closes the overlay before
leaving fullscreen; the category header changes groups within the drawer.
The shared browse state retains loaded pages and scroll positions across surfaces.

Expand guide in preview and Programme in fullscreen open the single-channel guide.
It shows only supplied dates, with Now, programme details and independent scrolling.
At most 21 programme rows (including a retained selection) and seven date buttons
are mounted. Midnight-spanning programmes belong to their start date. Empty,
disabled and failed guide requests remain separate from playback. The compact
preview remains limited to 12 rows; this change does not extend provider coverage:
Xtream still requests short EPG, Stalker uses its existing bulk/short fallback,
and M3U XMLTV remains excluded.

TV Guide opens the multi-channel grid from Live preview, fullscreen or the drawer.
It keeps the current native video mounted and playing. Its own category/catalog,
schedule requests and selection never mutate playback merely through focus. OK on
any channel/programme focuses Watch live; only that action resolves playback and
opens fullscreen. Fullscreen Back restores the Live TV Guide control after a
grid-initiated switch. Failed resolution keeps the guide usable. The chosen category is
retained with playback for later drawer entry and retry. Back from the grid's
category list returns to its grid, then Back closes the overlay to its origin.

Rows advance through provider pages as the viewport approaches the end; at most
13 channel rows (12 plus a retained selection) and 65 programme buttons per row
(64 plus a selected dense-schedule item) are mounted. The opening playing channel
stays pinned at the same index, with its catalog duplicate removed. A two-hour
axis supports programme-by-programme Left/Right, time-aligned Up/Down, Now, earlier/
later windows and local-calendar day steps. Programme details retain original
start/end values even when blocks cross midnight or the viewport. Programme
windows outside supplied data display an empty state, not fabricated listings.
This does not add archive/catch-up playback, date-specific provider requests,
XMLTV, or extend Xtream's existing short-guide coverage.

`@iptvnator/shared/epg` is the pure `shared-epg` Nx utility (shared-contracts domain).
Both Angular EPG and TV use its epoch-ms axis projection, half-hour ticks and
render clipping. The Angular module preserves its existing exports and adapters;
TV imports no Angular components, services or barrels. Elapsed ticks preserve DST
transitions; day navigation changes the local calendar date.

Grid EPG uses one sequential request lane for the current row window, a 150 ms
viewport debounce, a 10-second per-row abort deadline, and at most 60 cached channel
schedules. Closing, category/source changes and superseding windows cancel owned
requests; late responses cannot publish. The foreground minute tick rechecks only
visible rows, with a five-minute cache age and manual Refresh guide. Refresh keeps
old programmes visible while loading and restores a replaced programme's focus.
Stalker's bulk cache independently deduplicates concurrent callers and expires
on demand after five minutes. Cancelling one subscriber leaves the others alive;
the final cancellation and provider disposal abort/fence the shared request.

An overlay owns directional and Tab focus, including hidden page/control exclusion.
Closing restores its opening control. EPG publication is keyed to the selected
channel so an earlier channel's programme cannot flash while its replacement loads.
The TV drawer uses a translucent dark gradient supported by Chromium 68; it does
not depend on backdrop blur, animate full-screen surfaces or capture native video.

Native VOD resume waits for confirmed playback and seek readiness, retries
ignored/rejected assignments at most every 750 ms, and requires a subsequent
media event at the requested position with seeking complete. Metadata alone is
not confirmation on webOS. A 250 ms poll and readiness events handle late
duration/ranges; a 30-second deadline pauses with a recoverable error. Progress
writes are suppressed during restoration and seeking, including pause/leave.
Timeout preserves the previous saved position. Retry playback reads that
position again, including records whose duration was unknown; completed items
still restart. Stop/source replacement cancels the retry timer. Positive timeline
seeks use the same confirmation path; explicit seek-to-zero starts over.

Single-line text fields keep Left/Right caret movement and use Up/Down for
spatial focus. Native select controls keep Up/Down for choices and leave with
Left/Right. Disclosure summaries, including explicit MAG identity fields, are
part of the remote focus order. Actual webOS keyboard interaction remains a
physical-device check.

Separate request lanes own catalog/detail, EPG and playback resolution.
Superseding requests abort transport and lose publication rights, even if a
transport later delivers a response. Movies, series, search and live lists append
provider pages near the scroll boundary. A failed append preserves loaded rows
and exposes Retry loading; repeated/duplicate pages cannot create an endless
request loop. Source/category/query changes cancel the append lane. Returning
from details retains the active query's loaded items, identity and scroll offset.

`VirtualCollection` windows the DOM with measured row geometry and spacer
heights: at most 60 poster cards, 20 channel rows, 30 compact channel cards or
30 episode rows. Favorites and supplied episode arrays use the same scroll
window instead of page buttons.
Arrow Left/Right stays in the current grid row when a neighbor exists;
Up/Down moves by logical row and loads the next batch when necessary;
scroll and Magic Remote pointer use the same viewport. Focus never starts a
stream. Resize and restoration are measured against the actual scroller before
pruning rows. Home's editorial rails remain capped previews. Provider APIs that
return whole catalogs/episode arrays still do so; this is not a claim that every
provider supports network pagination. Guide/search work remains debounced.

Movie/series catalogs default to recently added and offer title A–Z or provider
order. The two choices are persisted separately, additively hydrated for older
TV data, and published only after storage commits. Sort is part of the request
identity: changing it aborts an append, resets the scroll/window, and starts the
new order at its first page. Details/Back and relaunch preserve the selected mode.

Stalker sends `sortby=added` (descending on the portal) or `sortby=name` before
server pagination; provider order omits the parameter. Its page cache already
keys all parameters, including sort. This follows the existing Angular Stalker
request and the middleware's [VOD implementation](https://github.com/iptvhakr/stalker_portal/blob/master/server/lib/vod.class.php).
Portals that ignore ordering cannot be globally repaired by sorting one page.
Xtream sorts the complete fetched catalog before taking a client page. Its
framework-free `xtreamCatalogTimestamp` uses the shared epoch validity policy,
accepts provider ISO dates and falls back from missing series `added` to
`last_modified`, with an on-screen explanation. Release year is never recency.
Missing/invalid dates go last; ties explicitly preserve provider ordinal because
Chromium 68 does not promise stable native sorting. M3U without addition dates
keeps playlist order with a visible explanation; alphabetical VOD remains
available. Live channel order and season/episode numbering are unaffected.

`iptvnator-tv-user-data` is a separate IndexedDB database (schema 1 and payload
version 1). Sources, active source, backend settings, favorites, history and
positions survive browser relaunch. Updates serialize and become visible only
when the read/write transaction completes. Quota, open and write failures are
visible; the application never reports an uncommitted favorite as saved.
Until the initial snapshot is successfully read, the repository rejects all
writes and editing/navigation is hidden behind a storage recovery screen.
Retry reading saved data reloads the original snapshot without clearing it.
Aborted read transactions reject instead of leaving startup pending.
History begins on `playing`, then saves every 10 seconds, on pause/leave/hide.
Recent history is bounded to 200 entries; playback positions are retained
independently, so an older title still resumes. Additive reads recover positions
from older TV snapshots that only contain history. Closing an OS process can lose the interval
since the last committed write; asynchronous pagehide writes are best effort.

## Artwork and optional TMDB metadata

Stalker artwork resolves portal-root and protocol-relative paths through the
framework-free `resolveStalkerArtwork` helper in the provider client entrypoint.
Blank/placeholder fields fall through to screenshot/logo candidates; non-HTTP
schemes and URL-embedded credentials are rejected. The existing Angular mapper
re-exports its unchanged `makeAbsoluteUrl` helper from the extracted module.
Poster boxes use a Chromium-68-compatible percentage ratio of 2:3 at every
width, with `object-fit: cover`. Live logos use compact square boxes and
`contain`, with a local SVG television icon for absent or failed images.
An unavailable provider image keeps a text fallback and never blocks browsing.

Section headings, counts and the source selector share a compact top row;
filters follow directly below. Decorative top slogans and the prototype footer
are absent. Favorites separates Movies, Series (including saved episodes) and
TV within the active source. Movie/series posters retain their proportions;
channels use horizontal cards. Detail Back restores the selected favorite type,
item and scroll position. Home Continue watching pairs a 2:3 cover (or local
fallback icon) with persisted progress and its existing resume action. Available
parent artwork fills missing episode covers without requesting a new catalog.
Historical Stalker history/favorites recover missing covers from their saved raw
fields through the provider artwork resolver, without rewriting saved commands,
positions or credentials.

Home features up to three recently watched, unfinished titles from the active
source. A series contributes its latest watched episode; a completed latest
episode does not revive older unfinished episodes. Unknown-duration positions
remain resumable. The Continue watching rail retains up to eight titles using
the same grouping. Previous/Next controls wrap on OK or pointer click; there is
no automatic rotation or playback on focus. Continue watching resolves the
original saved media identity, while Details opens its provider detail view.
Selection survives detail/player Back; source changes and relaunch start at the
latest unfinished title. With no unfinished history, the first catalog movie
(or first available item) remains the featured fallback. Artwork-only parent
fallbacks and optional TMDB enrichment never replace saved playback commands.
The hero's title/progress/actions remain usable while metadata loads or fails.

Home and details share a backdrop beginning at the top of the content viewport,
behind the header. Left and bottom gradients keep text readable and fade into
the page background. There is no blurred panel or animated backdrop. Home
publishes its catalog immediately, then requests the fallback movie's provider
details to obtain wide artwork. History uses its saved detail artwork, with
available parent art for episodes. Missing images leave the controls usable.

Settings exposes opt-in TMDB enrichment, a masked v3 key or v4 read token,
metadata language, connection check and an explicit save result. These settings
survive relaunch in the same atomic IndexedDB snapshot; older snapshots default
to disabled. The TV requires a user-entered key, even in builds with an injected
desktop default. Requests go directly to TMDB, independently of the provider backend.

`@iptvnator/shared/tmdb` owns the framework-free API client, title/year confidence
matching, dead provider-ID recovery, language fallback and metadata orchestration.
The TV adapter enriches the Home feature and selected movie/series details for
all providers. It only replaces artwork and description; provider identity,
stream ID/extension pairs, episode hierarchy and playback commands stay authoritative.
Live channels and episodes do not trigger enrichment. Whole-catalog enrichment,
TMDB discovery, people, trailers and episode metadata are not included here.

Provider content renders before metadata. Each selection has cancellation and
an eight-second deadline; obsolete responses cannot overwrite the current view.
Failures expose a retry without blocking playback. A session-only LRU holds at
most 120 entries, separated by media type and language, with the existing TTLs.
Changing key/language or disabling enrichment replaces the cache. No key or API
response is logged. The settings section includes the official logo and attribution.

## Media feasibility is a separate gate

The API proxy does **not** relay media. Native video opens provider URLs on the
TV. Standard HTML video cannot attach arbitrary MAG Authorization/Cookie,
Referer or User-Agent headers. A tokenized `create_link` URL may work directly;
a provider requiring those headers needs a separately designed media relay.
No relay or transcoder is included in this prototype.

Settings exposes an opt-in direct catalog request and a separate media HEAD
probe. A readable HEAD response establishes HTTP reachability only, not native
codec, audio, seek or HLS support. A failed CORS probe does not prove native
video failure. Real subscription credentials must be entered through Sources.

LG documents the target engine in the [CLI guide](https://webostv.developer.lge.com/develop/tools/webos-tv-cli-dev-guide),
[Back handling](https://webostv.developer.lge.com/develop/guides/back-button),
[mediaOption](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter)
and [streaming support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).
See the [development and device checklist](../development/tv-development.md)
for commands and the exact distinction between mock and hardware verification.
