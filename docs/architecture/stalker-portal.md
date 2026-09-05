# Stalker Portal Architecture

This document describes the Stalker portal implementation in IPTVnator and where each feature is integrated.

## Related Docs

- [Stalker Portal EPG Architecture](./stalker-epg.md)
- [Playlist Backup/Restore Architecture](./playlist-backup-restore.md)
- [Portal Detail Navigation](./portal-detail-navigation.md)
- [Embedded Inline Playback](./embedded-inline-playback.md)
- [Remote Control Architecture](./remote-control.md)
- [Download Manager](./download-manager.md)
- [Category Management](./category-management.md)
- [Stalker Store API Baseline](./stalker-store-api-baseline.md)

## Scope

Stalker support covers:

- Live TV (`itv`)
- Radio (`radio`)
- VOD (`vod`)
- Series (`series`)
- VOD-as-series flows (`is_series=1` and embedded `series[]`)
- Favorites and recently viewed collections
- Search
- External player playback (shared Xtream player infrastructure)
- Remote control for live ITV navigation

## Routing Structure

Primary route tree lives in
`libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts`
(`createStalkerRoutes()`), mounted under the workspace shell, so every path
below is reached as `/workspace/stalker/:id/…`.

- `/workspace/stalker/:id/vod` (plus `vod/:categoryId` child)
- `/workspace/stalker/:id/series` (plus `series/:categoryId` child)
- `/workspace/stalker/:id/itv`
- `/workspace/stalker/:id/radio`
- `/workspace/stalker/:id/favorites`
- `/workspace/stalker/:id/recent`
- `/workspace/stalker/:id/search`
- `/workspace/stalker/:id/actor/:personId`
- `/workspace/stalker/:id/discover` (facet query params; see
  `docs/architecture/tmdb-metadata-enrichment.md`)
- `/workspace/stalker/:id/downloads` (shared `DownloadsComponent` from `@iptvnator/portal/downloads/feature`)
- `/workspace/stalker/:id/downloads/:downloadId` (focused local movie/series
  detail with no category context panel)

`/workspace/stalker/:id` itself redirects to `vod`.

## Runtime Architecture

1. Angular Stalker screens call methods/resources in `StalkerStore`.
2. `StalkerStore` builds request params based on selected content type and current view state.
3. Catalog, content and playback calls funnel through `executeStalkerRequest()`
   (`libs/portal/stalker/data-access/src/lib/stores/utils/stalker-request.utils.ts`),
   the choke point that decides the transport per portal mode:
   full portals go through `StalkerSessionService` (handshake + Bearer token +
   retry), token-free panels call
   `DataService.sendIpcEvent(STALKER_REQUEST, ...)` directly. It also hooks
   the lazy portal repair (see "Portal Mode and Endpoint Discovery").

    Four callers deliberately sit outside it and issue `STALKER_REQUEST`
    themselves, because each one runs _below_ or _before_ what it routes on:

    - `StalkerAuthApi` — `handshake` / `get_profile` / `do_auth` are what the
      full-portal branch is implemented in terms of, so routing them back
      through it would recurse.
    - `StalkerPortalDiscoveryService` — probes run before a mode exists; the
      mode is what they are determining.
    - `StalkerAccountInfoService.fetchViaProfile()` — the full-mode refresh is
      a profile request, so it takes the same exemption as the auth layer.
    - `StreamResolverService`, for a collection item carrying its own portal
      coordinates with **no playlist row** — there is no meta to route or
      repair with. The playlist-backed branch beside it does use
      `executeStalkerRequest()`, and wins when a row exists, so a repaired
      endpoint beats a stale favorite's snapshot.

    The exemption is from the routing, not from the repair it hooks — but only
    **one** of the four wires `StalkerPortalRepairService` itself, and the
    asymmetry is worth knowing before adding a fifth:

    - `StalkerAccountInfoService.fetchViaProfile()` wires it explicitly,
      because opening the account dialog on a playlist with a stale endpoint
      must be able to fix it instead of waiting for an unrelated catalog
      request.
    - `StalkerPortalDiscoveryService` is what repair _drives_, so it cannot
      repair itself.
    - The auth layer wires nothing. It does not need to: a terminal handshake
      failure propagates out of the full-portal branch and is caught by
      whichever `executeStalkerRequest()` call triggered the authentication,
      which is exactly why "terminal handshake failures" is one of the repair
      triggers listed above.
    - `StreamResolverService`'s row-less branch has no playlist to repair.

    Anything new that is not auth or discovery belongs on
    `executeStalkerRequest()`.

4. Electron main process handles `STALKER_REQUEST` in
   `apps/electron-backend/src/app/events/stalker.events.ts`.
5. Axios calls the portal's persisted API endpoint (`portal.php` on
   reseller panels, `server/load.php` on canonical Stalker/Ministra) with
   required headers/cookies and returns the raw `response.data` to the
   renderer; normalization happens in the store feature slices.

## Portal Mode and Endpoint Discovery

Two portal modes exist, persisted per playlist as
`Playlist.isFullStalkerPortal`:

- **Full portal** (canonical Stalker/Ministra middleware): every request
  except `handshake`, `get_profile`, `get_localization`, and `do_auth`
  requires `Authorization: Bearer <token>`; auth failures are HTTP 200 with a
  plain-text body (`Authorization failed.`, `Access denied.`,
  `Unauthorized request.`), never a 401/403. Detection of those bodies — and
  of the JSON envelope (`{js: {error|msg}}`) some panels answer instead —
  lives in `libs/shared/interfaces/src/lib/stalker-auth-failure.util.ts`, so
  the Electron main process (where the bodies actually arrive) and the
  renderer classify identically; `stalker-portal-discovery.utils.ts`
  re-exports it. The body match is anchored to the whole reply: these are
  bare phrases, and a substring rule also accepted a short proxy or WAF page
  containing one, which then triggered portal reclassification against a
  portal that never answered. The structured `js.error`/`js.msg` fields keep
  the wider phrase set (`Invalid token`, `Auth failed`, bare `unauthorized`),
  since a panel fills those in deliberately. While a full portal is the
  active playlist, `StalkerSessionService` keeps a **watchdog** running —
  periodic authenticated `watchdog/get_events` pings at the cadence the
  portal advertises (`watchdog_timeout`, default 120 s — see "Watchdog"
  below) whose failures are non-fatal.
- **Simple portal** (typically a reseller-style `portal.php` panel): no auth
  lifecycle at all — no handshake, no Bearer token, no watchdog. The requests
  are not stripped down to a bare cookie either: every Stalker request goes
  through the shared identity builder, so a simple portal receives everything
  that builder can derive from a MAC alone — the `mac`/`stb_lang`/`timezone`
  cookie, the MAG `User-Agent` / `X-User-Agent` pair and the
  `Accept`/`Accept-Language`/`Connection` set (see "Request Transport and
  `cmd` Encoding").

    What it does **not** get is anything carried by the session. The direct
    branch of `dispatchStalkerRequest()` forwards only `url`, `macAddress` and
    `params`, so the builder never sees a token _or_ a serial: no
    `Authorization: Bearer` (there is none to send), and no `SN` header or
    serial-derived `__cfduid` cookie **even when the playlist stores a serial**.
    The full-portal branch forwards both, because `makeAuthenticatedRequest()`
    passes `token` and `serialNumber`. This covers portal API requests only —
    playback headers are built from the playlist row by a different helper and
    are NOT mode-gated, so the same simple-mode playlist does send its serial
    with a portal-owned stream (see "Stalker Identity Policy").
    Whether a simple panel ought to receive
    the serial is unproven: no reference portal is known to require it, and the
    `sn` _parameter_ only ever travels on `get_profile`, which a simple portal
    never calls. Treat it as an open question rather than a bug to fix blind.

Neither label is tied to a URL shape: mode follows OBSERVED behavior, so a
`portal.php` panel that enforces the token is classified — and treated
everywhere — as a full portal, and a canonical `server/load.php` endpoint that
answers without one is a simple portal.

The single predicate lives in `@iptvnator/shared/interfaces`
(`stalker-portal-mode.util.ts`): `isFullStalkerPortalPlaylist()` treats the
persisted flag as authoritative and falls back to the URL shape
(`isFullStalkerPortalUrl()`: `/stalker_portal` or `/server/load.php`) only
for legacy rows where the flag is undefined. Historically three diverging
copies of this rule existed (import, session service, legacy-flag migration)
and their drift shipped broken configurations (#850, #686, #755); no new
consumer may re-implement the rule.

**Endpoint discovery (import and edit).** The address field requires an
explicit `http://` or `https://` scheme, but accepts a bare host, a browser
entry point such as `…/c`, or a concrete `.php` API endpoint. `portal.php`
does not exist in official Stalker/Ministra — it is a reseller-panel alias;
the canonical endpoint derived from a `…/c` URL is
`<base>/server/load.php`. Instead of guessing from the URL shape,
`StalkerPortalDiscoveryService` (`libs/portal/stalker/data-access`) probes
candidates in order — the pasted URL itself when it already names a `.php`
endpoint, then `<base>/portal.php` → `<base>/server/load.php` →
`<base>/stalker_portal/server/load.php` — and classifies each endpoint by
observed behavior: a token-less
`itv/get_genres` that returns data proves a token-free panel; the plain-text
auth failure proves the endpoint enforces the token, which is confirmed by
running the real handshake + `get_profile`. The import dialog persists the
proven endpoint and mode, and that resolved API endpoint is what Edit shows.
When no candidate answers at all, panel-style URLs fall back to the
pre-discovery behavior (a bare host becomes `<base>/portal.php`; legacy
`…/c` becomes the matching `portal.php`; simple mode, import succeeds with a
warning) so temporarily offline panels can still be added. Canonical-shaped
URLs abort like the old mandatory handshake did (both classifications run on
the normalized `origin + pathname` form). Probe failure sequencing: ANY
resolvable HTTP status moves to the next candidate — 4xx means the endpoint
is absent, a 5xx can be one broken handler beside a healthy sibling — and
401/403 specifically classify as auth-required (the handshake is attempted,
for middlewares that answer HTTP auth codes instead of the stock 200 +
plain-text body). Status-less TIMEOUTS also continue (a single handler can
hang); only connection-level failures (refused, unresolvable host) abort
discovery, since every candidate shares the host.

The playlist-info Edit dialog compares URL, MAC, username/password, serial,
device IDs and signatures as one connection identity. A metadata-only edit
does not run discovery; its queued write omits every connection/mode field so
the current stored connection stays byte-for-byte, including when the dialog
was hydrated before an older discovery result committed.
Before enabling a Stalker form, the dialog loads the complete persisted
playlist row by ID. Electron's startup metadata projection omits payload-only
identity fields, so editing that summary directly could otherwise display and
then persist empty serial, device ID, signature, or mode values.
Changing any connection field disables the form while the same discovery
service validates the draft. Auth rejection or an unreachable portal leaves
the dialog open and writes nothing. Escape/backdrop closure is disabled for the
validation window. If navigation or another owner starts closing/destroys the
dialog while discovery is in flight, a successful result still crosses the
atomic persistence boundary: the submitted `get_profile` may already have
pinned the new serial/device identity remotely and cannot be recalled. The
late commit uses `transformPlaylistMeta()` inside the per-playlist write queue
to merge only the resolved connection/session fields into the current row, so
a newer title, EPG, or other metadata edit wins. The returned merged row feeds
the state-only update, while dialog close and success UI are suppressed after
destruction. Both the ordinary resolved metadata update and this late transform
require the storage-current row to retain the source connection authority
captured when Edit began. Electron performs the check inside its per-playlist
write queue; PWA performs the read, predicate, and cursor update in one
IndexedDB readwrite transaction so another tab cannot interleave a replacement.
The one-time legacy mode-flag migration likewise scans and updates rows through
one readwrite cursor transaction; it never replays a snapshot collected before
another tab's delete/restore or replacement.
Delete/restore or replacement under the same ID therefore aborts instead of
receiving a portal/session write. A row identified by its persisted `portalUrl`
stays on the Stalker save path even if legacy Xtream fields remain, so an
unrelated Xtream write cannot strand the Edit reservation. Before discovery
starts, PWA Edit acquires a shared playlist-authority barrier plus an exclusive
origin-wide Web Lock keyed by playlist ID and, while holding both, verifies that
the persisted row still has the source connection shown when Edit began.
Add/delete, backup restore, and bulk replacement paths take the same row lock;
Delete All takes the barrier exclusively. The checked authority therefore
cannot be replaced between that preflight and the identity-bearing discovery
request. Another tab fails before overlapping discovery, while a replacement
waits for the existing Edit owner; a stale dialog also fails before it can touch
the remote session. PWA fails closed when Web Locks are unavailable, while
Electron relies on its single-instance local owner. Lazy repair tries the same
barrier and row reservation before its persisted-source preflight; contention
or unavailable PWA locking declines repair without discovery, while an acquired
reservation stays held through its conditional row transform. The reservation
blocks every new authentication (including a URL edit with the same normalized
fingerprint) and repair, and drains any work already in flight.
When Save follows a lazy repair in the same tab, Edit publishes its local
authentication owner first, drains that repair through the actual Web Lock
request completion, and only then requests the row reservation itself. Repair
callers already queued behind that owner observe the Edit block and return
without trying to reserve the row again.
Ownership is rechecked after every asynchronous drain or authority rebase.
Ordinary failure releases that reservation with the previous runtime untouched;
if a bounded discovery result still has an abandoned authentication on the
wire, Edit keeps both reservations until the transport operation actually
settles.
Success atomically replaces the endpoint, mode and normalized identity together
with session metadata: simple mode
clears token/fingerprint/watchdog/account state, while full mode replaces it
with the confirmed authorization result. That awaited write returns the
complete merged playlist row before NgRx receives its state-only update and
before the app adapter replaces the active `StalkerStore` snapshot and
session/watchdog state, so persistence failure cannot expose a partial runtime
edit and metadata absent from the form (such as playback `Referer`/`Origin`)
survives the replacement. The state-only update reattaches the transient
session patch from discovery, because the persisted flat row deliberately does
not contain that field; this lets NgRx replace or clear its session projection.
Runtime configuration authority combines the session fingerprint with the
observed full/simple mode. Both authenticated calls and direct simple-mode
requests cross that guard before dispatch and again after transport, so a
same-endpoint mode-only Edit rejects stale playlist objects in either direction
before they can authenticate or issue a token-free portal request, and discards
an older portal response that completes after Edit commits. A different
authority may rebase only after the current persisted row proves that it owns
the same playlist ID; this keeps delete/restore and backup merge flows usable
without letting an in-flight stale request overrule Edit.
`PlaylistMetaUpdate` carries the persisted part as a transient
`stalkerSessionPatch` (`undefined` preserves, `null` clears, an object fully
replaces); `PlaylistsService` projects it onto the existing flat playlist
fields, so the patch itself never enters SQLite, IndexedDB or a backup and no
schema or backup-version migration is required.

The shared playlist UI exposes only
`STALKER_PLAYLIST_CONNECTION_EDITOR` and its
`resolved | auth-rejected | unreachable` result contract. The web composition
layer implements the token with Stalker data-access; the UI library must not
import Stalker discovery directly.

**Lazy repair (existing playlists).** The flag is frozen in the DB, so
records persisted by the old guess stay broken without repair — but a large
share of users are on working reseller panels, and only probing can tell the
two apart, so there is deliberately **no eager one-shot migration**. Instead
`StalkerPortalRepairService` re-probes a portal only after a request
actually failed with a shape that a wrong endpoint/mode produces (the
plain-text auth bodies AND their JSON envelopes (`js.error`/`js.msg`),
HTTP 404 (endpoint absent), HTTP 401/403 (endpoint behind an HTTP auth
gate), and terminal handshake/profile errors — never timeouts or other
network failures), at most once per SOURCE CONFIGURATION (endpoint + mode + MAC +
identity fingerprint + credentials) per playlist per session — an edited configuration
may probe when it fails, while every already-probed one stays latched for
the session. Before an unrecorded probe makes any portal request, it verifies
that the persisted row still carries the failing source; a request that failed
late after Edit committed is declined before discovery can authenticate against
the old portal and invalidate the edited session. A repair installs a
per-playlist authentication fence before probing, drains authentication that
already owns the runtime token slot, and makes request routing wait before it
chooses the effective connection. The fence normally ends with the repair; an
abandoned authentication keeps both it and `pendingRepairs` alive until the
transport settles. Repair persists only a
configuration discovery has proven to answer, and only when it differs from the
failing one. A repaired configuration is applied immediately via an
in-session override inside `executeStalkerRequest()` (stale store snapshots
keep working). The override is bound to that source's endpoint, mode, device
identity, and credentials; an Edit or backup restore under the same playlist
ID retires it when any connection field differs, but only after the persisted
row confirms ownership and only if no explicit Edit took ownership during
that read — a delayed stale request cannot globally remove the current
override or a token negotiated by the overlapping Edit. The repair is persisted
through `PlaylistsService.transformPlaylistMeta`
— the verification and the patch run in ONE slot of the per-playlist write
queue, so a user edit that is queued but not yet committed wins over the
repair instead of being overwritten; the transform patches the freshly read
row (`portalUrl` + `isFullStalkerPortal` only, so user state can never be
clobbered) and returns null to abort. Explicit Edit also advances an in-run
generation before replacing the session. Repair captures it before any
history-path row read and rechecks it together with the active Edit fence
before reserving discovery, so restoring a discarded configuration cannot
start a probe alongside Edit; a repair that already verified its row but
finishes later likewise cannot install its older override or token.
Deletion runs through the same queue,
so a repair can never resurrect a playlist deleted mid-probe. Portals
that work are never probed, let alone rewritten. E2E coverage:
`apps/electron-backend-e2e/src/stalker-portal-discovery.e2e.ts` against the
mock's tolerant `/portal.php`, strict `/server/load.php`, and
`portal.php`-less `/ministra/*` hosts.

## Main UI Components

- `CategoryContentViewComponent` from `@iptvnator/portal/catalog/feature` (`libs/portal/catalog/feature`)
    - Shared category + content layout used by the `vod` and `series` routes (wired in `stalker-feature.routes.ts` via `loadCategoryContentViewComponent`)
- `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`
    - ITV live playback, radio playback, channel/station navigation, EPG panel integration
- `libs/ui/playback/src/lib/audio-player/audio-player.component.ts`
    - Shared inline audio player used by M3U radio channels and Stalker radio stations
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
    - Season/episode UI for all Stalker series modes
- `libs/portal/stalker/feature/src/lib/stalker-collection-route.component.ts`
    - Favorites and recently-viewed collection views (`mode = 'favorites' | 'recent'` route data), rendering `stalker-collection-detail.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`

## Store and Data Flow

Stalker store is now feature-composed:

- Facade: `libs/portal/stalker/data-access/src/lib/stalker.store.ts`
- Feature slices: `libs/portal/stalker/data-access/src/lib/stores/features/*`
- Shared helpers: `libs/portal/stalker/data-access/src/lib/*`

Important store responsibilities:

- Selected content/category/item state
- Category and content resources. VOD/series content is an infinite-scroll
  append: portal pages (server-side size, typically 14) accumulate into one
  deduplicated `paginatedContent` list; page 1 replaces it, `hasMoreContent`
  derives from the accumulated length versus `total_items` (so a portal that
  ignores requested page sizes still terminates), and a failed page > 1 sets
  `appendError` while keeping the accumulated pages on screen —
  `retryContentPage()` re-runs the same page via the resource's `reload()`.
  The facade splits the resource's loading flag by page: page 0 is the grid
  skeleton, later pages are the tail spinner, and `loadMore()` refuses to
  advance past an unresolved append error (a skipped page would leave a
  silent hole in the list).
- ITV channel list + pagination (full-list session cache when the portal
  supports it, legacy 14-per-page lazy loading otherwise)
- Radio category/station list + pagination
- Regular series seasons resource
- VOD-series (`is_series=1`) seasons + episodes resources
- Playback link creation (`create_link` flow)
- Favorites and recently viewed persistence helpers

Internal structure to preserve:

- `stalker.store.ts` stays as the thin facade that composes feature slices.
- Cross-slice contracts live in `stores/stalker-store.contracts.ts` so
  feature dependencies are declared instead of repeated `unknown` casts.
- Request execution is centralized in `stores/utils/stalker-request.utils.ts`
  for both authenticated full-portal calls and simple IPC-backed requests.
- Playback link resolution and Stalker collection persistence live in
  dedicated `stores/utils/` helpers so player/favorites/recent slices stay
  focused on orchestration.
- Category/content resources stay internal to the store slices. Feature
  consumers should read `getCategoryResource()` and `getPaginatedContent()`,
  which now always return arrays, and pair them with
  `isCategoryResourceFailed()` / `isPaginatedContentFailed()` for explicit
  error handling.

Failure-handling rule:

- Failed category or content requests must degrade into empty/error UI state,
  not `undefined` collections or renderer exceptions. The workspace Stalker
  context panel and live layout rely on this guarantee.

## Stalker Identity Policy

Full Stalker/Ministra portal authentication defaults to MAC-only identity. The
import UI can capture optional serial number, device IDs, and signatures, but a
field the user leaves blank stays blank — nothing is invented for it, and
nothing empty is forwarded to `get_profile`. The one way a value appears
without being typed is the explicit import-time opt-in described under
"Deriving device IDs from the MAC" below, which writes into the visible fields
first. (The fixed MAG250 description `get_profile` reports is separate: it
describes the emulated box, not the account — see "Reported device profile".)

- User-provided `sn`, `device_id`, `device_id2`, `signature`, and `signature2`
  values are trimmed, persisted under the canonical `stalker*` playlist fields,
  and reused for initial auth, token refresh, retry auth, normal API requests,
  and same-origin playback headers.

    Those last two reach the wire by different routes, and **only one is
    mode-gated** — the asymmetry is easy to get backwards:

    - **Portal API requests** receive the serial through
      `makeAuthenticatedRequest()`, which only the full-portal branch of
      `dispatchStalkerRequest()` calls. A simple-mode playlist therefore sends
      no serial on any API call, whatever it has stored (see "Portal Mode and
      Endpoint Discovery").
    - **Same-origin playback headers** are built by
      `buildStalkerExternalPlaybackHeaders()`, which reads
      `playlist.stalkerSerialNumber` straight off the row with no mode check
      at all. So a simple-mode playlist holding a real serial _does_ send `SN`
      and the serial-derived `__cfduid` on portal-owned streams — while its
      API calls do not.

- Empty optional identity fields remain absent. IPTVnator must never generate a
  device ID behind the user's back, and must never duplicate `device_id2` from
  `device_id1` on its own.
- The legacy default serial value `BEDACD4569BAF` is treated as absent at
  runtime so older blank imports do not keep sending a synthetic serial number.
- Playback headers use the same serial normalization, so the legacy default is
  not sent as `SN` or as a serial-derived `__cfduid`. MAC-only API and
  playback requests do not synthesize `__cfduid`; when a real serial is
  present, same-origin playback uses a canonical 32-character `__cfduid`
  protocol cookie.
- Stalker workspace routes must initialize `StalkerStore` from a playlist object
  with an explicit `isFullStalkerPortal` mode. If the active route metadata is a
  lightweight playlist record without that field, the route session must load the
  full playlist by id before category/content resources run. Stalker auth
  metadata is independent from M3U playlist EPG metadata and must not depend on
  M3U-specific EPG fields.

### MAC address normalization

The MAC is canonicalized to the uppercase colon form a real STB sends
(`normalizeStalkerMacAddress` in
`libs/shared/interfaces/src/lib/stalker-mac-address.util.ts`), accepting
hyphens, dots, embedded whitespace or no separator at all. The same module
exports `validateStalkerMacAddressControl`, used as a form validator by the
import dialog and the playlist-info edit dialog; it is typed structurally
(`{ value: unknown }`) rather than as Angular's `ValidatorFn`, because this
library is the contract layer the Electron main process imports and must stay
framework-free.

Normalization runs **only at the input boundary** — on blur and again on
submit, in both dialogs. The submit pass is not redundant: clicking Add or
pressing Enter inside the field submits without the field necessarily losing
focus, so the blur handler never runs and the raw `00-1a-79-…` would be the
value that gets persisted and sent. Stored MAC addresses are deliberately
never rewritten on read:

- the MAC is the account key, and the bytes an already-working playlist puts
  in its `mac` cookie are the bytes that portal accepted;
- rewriting them at the transport would move `stalkerSessionFingerprint` for
  every existing playlist at once, with no user action and no way to opt out.

An edit therefore _does_ move the fingerprint and force a re-authentication.
That is intended: the user changed the identity, and the field shows exactly
what will be sent.

Format validity is enforced; the Infomir OUI is **advisory only**. The stock
server's MAC filter (`enable_mac_format_validation`) is on by default and only
accepts `00:1A:79:XX:XX:XX`, answering a bare `{status: 1}` for anything else —
which is why `hasInfomirMacOui` drives a hint on the import field. It must stay
a hint: reseller panels, which is what most users actually run, do not check
the format at all, so a large share of working installations use a non-Infomir
MAC. Refusing one would stop those users adding or editing a portal that works
for them. The mock encodes the same split (`enforceMacFormat` is set only on
the strict endpoint; `/portal.php` ignores it), and `AUTH_REJECTED_MAC` in
`stalker.e2e.ts` depends on it — a non-Infomir MAC that must reach the strict
endpoint and be refused _there_, not in the form.

In the edit dialog **both** passes — blur and submit — normalize only a MAC the
user actually changed, compared against the value the dialog was opened with
(`isStalkerMacAddressEdited`). Renaming a playlist, or editing its EPG sources,
must not rewrite a non-canonical MAC as a side effect: those bytes are what a
permissive portal registered, and rewriting them would move the session
fingerprint and re-authenticate under a spelling the portal never saw — the
same reason a stored MAC is not rewritten on load.

Guarding the submit pass alone is not enough, and this is the subtle part:
tabbing through the dialog fires blur with no edit, and a blur that rewrites
the control both marks the form dirty and makes the value differ from the
stored one — which is precisely what the submit guard reads. The identity would
then ride out on a title-only save.

The edit dialog goes one step further: `createStalkerMacAddressValidator`
grandfathers the value a playlist already stored. Before there was any
validation the field accepted arbitrary text, and on a panel that ignores the
MAC such a playlist works today — marking the form invalid on open would
disable Save and strand the user's title, URL and EPG-source edits in the same
dialog. Newly typed values are still held to the format.

### Deriving device IDs from the MAC

`deriveStalkerDeviceIdsFromMac`
(`libs/shared/interfaces/src/lib/stalker-identity.utils.ts` — note the
same-named file in `libs/portal/stalker/data-access` is a different module)
returns the pair
StbEmu and `stalker-to-m3u` generate: uppercase hex `SHA256` of the canonical
MAC for `device_id`, and of that MAC plus a `stalker` salt for `device_id2`.
The import dialog offers it behind an opt-in checkbox that fills both fields.

**The two values must differ.** On a real box they come from separate firmware
calls (`gSTB.GetUID()` and `gSTB.GetUID('device_id', token)`) and are never
equal, so an identical pair is a fingerprint no STB produces — and since the
first non-empty value is pinned to the MAC permanently, it cannot be corrected
afterwards. They are derived by one function returning both, so nothing can
fill one without the other.

The shape of that feature is dictated by the pinning semantics: the stock
server binds the **first non-empty** `device_id`/`device_id2` it sees to the
MAC permanently, refuses a different one as a device conflict, and treats a
later empty value as a permanent lockout. Therefore:

- the derived value is written into the **visible form fields** and persisted
  as a literal string. Nothing recomputes it at request time, where a MAC edit
  would silently re-derive it into a conflict;
- the checkbox is offered at import only — the point where the identity is
  being established for the first time — and is disabled when the user has
  typed a device ID by hand;
- while it is ticked, correcting the MAC re-derives, because nothing is pinned
  until the import actually runs;
- **derivation is asynchronous, and every way out of it is guarded.**
  `applyDerivedDeviceIds` can only read the toggle before it awaits, so three
  things protect what happens after:
    - submitting re-runs `settleMacAddressIdentity()` and awaits it before
      reading the form — clicking Add blurs the MAC field, so the blur's
      `SHA256` is still in flight when the click handler runs, and a snapshot
      taken then pairs the corrected MAC with the previous MAC's IDs;
    - a generation stamp discards every completion but the newest, so two
      edits in quick succession cannot leave the older pair in the fields;
    - `invalidatePendingDerivation()` bumps that stamp whenever the user stops
      wanting derived IDs — unticking the box, clearing the form — because an
      outstanding digest would otherwise resolve into fields that were
      deliberately emptied, and the import would pin IDs the user opted out
      of.

    All three are mutation-verified. Note the tests have to control when the
    digest settles (hold it behind a gate, or delay the older invocation):
    Node resolves digests this small in start order, so the naive versions pass
    with the guards removed;

- **the MAC and its device IDs travel as one value.**
  `settleMacAddressIdentity()` reads the MAC once, before it awaits, and
  returns it together with the IDs derived from exactly it; `addPlaylist()`
  uses that triple rather than re-reading the form. Taking the MAC from
  `getRawValue()` after the digest would ship a newly typed address paired
  with the previous one's IDs, which the portal pins as a permanent device
  conflict. The whole form is also frozen (`form.disable()`) for the duration
  of an import and restored in `finally`, since an edit made then can neither
  reach the portal nor be undone on it;
- **the snapshot `addPlaylist()` takes is authoritative for the whole import,
  by design.** Discovery authenticates with exactly those values, and
  `get_profile` is what pins them to the MAC — so by the time a slow discovery
  answers, the portal has already committed. Re-reading the form afterwards to
  pick up a mid-flight edit would persist device IDs that differ from the
  pinned ones, or none at all, and sending nothing after a value was pinned is
  the permanent lockout. The identity toggle is therefore locked while
  `isLoading()` rather than the submission being re-snapshotted: the UI must
  not imply an opt-out that cannot exist;
- an unusable MAC (or a runtime without WebCrypto) derives nothing rather than
  hashing a typo into a permanent binding;
- the playlist-info edit dialog offers no derivation. It shows
  `DEVICE_ID_PINNED_WARNING` instead once a device ID has actually reached the
  portal. **Storage is not transmission**: `device_id` travels only on
  `get_profile`/`do_auth`, which a simple panel-style portal never runs, and
  the import's offline fallback persists whatever was typed while recording
  the playlist as simple. `hasStoredStalkerDeviceIds` therefore gates on
  `isFullStalkerPortal` — telling those users a change "will lock this source
  out" would be false and would discourage them from fixing an ID that was
  never pinned.

    **Known imprecision, deliberately not closed here.** The gate proves that
    _some_ device ID reached the portal, not that the currently stored one did:
    a user who edits the ID after import keeps `isFullStalkerPortal` true while
    the new value has never seen `get_profile`. The copy is hedged for exactly
    that ("a device ID", not "this one") and the fields stay editable, so the
    remedy — restoring the ID that was pinned — is never blocked. Making it
    exact needs a per-identity confirmation signal;
    `Playlist.stalkerSessionIdentity` already carries a session fingerprint that
    would serve, but reading it here would make a `type:ui` playlist library
    depend on the Stalker data-access lib, which the Nx boundaries forbid. Worth
    revisiting behind a shared contract, not worth a boundary exception.

The trade-off the option exists for is interoperability, not obfuscation: a
user who reaches the same account from StbEmu already has this exact value
pinned, and IPTVnator has to send it or be refused.

### Reported device profile

`get_profile` carries a fixed MAG250 description from
`STALKER_STB_PROFILE_PARAMS`
(`libs/shared/interfaces/src/lib/stalker-stb-profile.const.ts`): `ver`,
`stb_type` (`MAG250`, previously sent as an empty string), `hw_version`,
`image_version`, `client_type`, plus the `num_banks`/`video_out`/`hd` the
request already carried. The stock middleware stores these for the admin panel
and only an operator's optional `access_filter.php` inspects them, so they are
free to send — but they must describe the same box as `metrics.model` and the
`STALKER_MAG_USER_AGENT` header, or the profile reads as a forgery.

They are constants, identical for every playlist, and deliberately excluded
from `stalkerIdentityFingerprint` / `stalkerSessionFingerprint`: including them
would invalidate every persisted session for no gain, since the portal binds
nothing to them.

## Session Authentication Lifecycle

Full portals authenticate through `StalkerSessionService`
(`libs/portal/stalker/data-access/src/lib/stalker-session.service.ts`), which
is a thin facade over focused modules (it was split when the single file
outgrew the `max-lines` budget; never re-add it to the baseline):

- `stalker-auth.api.ts` — the raw `handshake` / `get_profile` / `do_auth`
  requests and the `authenticate()` orchestration.
- `stalker-watchdog.controller.ts` — the periodic `get_events` keep-alive.
- `stalker-token-cache.ts` — the in-run token and pending-auth state, tagged
  with the identity fingerprint each session was negotiated for.
- `stalker-session-store.ts` — the session persisted on the playlist row.
- `stalker-response-classification.ts` + `stalker-portal-error.ts` — failure
  detection and the typed `StalkerPortalError` the UI layers render.

### Handshake and token persistence

The handshake token is **idempotent** (Stalker 4.9.35 `stb.class.php`):
re-presenting the MAC's current session token returns it unchanged, and tokens
have no TTL — they are only invalidated when another device runs `get_profile`
on the same MAC. `ensureToken()` exploits this: when the in-memory cache is
cold it re-presents the persisted `Playlist.stalkerToken` (from the playlist
object, falling back to the stored row via `PlaylistsService`, since store
metas do not carry payload fields). A token that comes back unchanged is an
already-adopted session, so the `get_profile` round trip is skipped entirely —
unless the handshake also set `not_valid`, which vetoes the shortcut: adopting
a token the portal just called dead would be unrecoverable, since the reuse
path writes no replacement back and every later start would re-present it.
A renegotiated session is written back best-effort
(`PlaylistsService.updateStalkerSession`) so the next app start can reuse it.
The handshake's `not_valid` flag is propagated into the follow-up
`get_profile` as `not_valid_token`.

Reuse is gated on a session fingerprint (`stalkerSessionFingerprint`) covering
the **portal endpoint (origin, path, and URL Basic-auth userinfo), the device
identity and the account credentials**, stored
next to the token as `Playlist.stalkerSessionIdentity` and used for the
in-run cache as well, so an edit applies without a restart. All three halves
are load-bearing: `ensureToken()` re-presents tokens in a handshake, so an
endpoint edit would otherwise disclose the previous portal's bearer token to
another portal — and origin alone is not enough, since discovery deliberately
preserves tenant base paths, so `/tenant-a/…` and `/tenant-b/…` on one host
are different portals. The URL parser omits `user:pass@` from `origin`, so that
userinfo is fingerprinted separately; changing a reverse proxy's Basic-auth
identity must not reuse a bearer token negotiated through the previous one.
Endpoints without userinfo retain their previous fingerprint across upgrades.
An identity edit must not inherit the old session; and for a status-2 portal
the login decides which account the token represents. A token
with no recorded fingerprint (written before this existed) counts as
unverified and is never re-presented — such a row owes a full profile anyway,
and the write-back then records the fingerprint.

The Edit coordinator deliberately keeps a separate, in-run configuration
authority key containing that session fingerprint plus the observed portal
mode. The mode is not added to `stalkerSessionIdentity`, so existing persisted
sessions remain compatible, but a full↔simple Edit at the same endpoint still
retires stale runtime snapshots. The token-free dispatch path calls
`ensureToken()` as a network-free authority guard before its direct IPC request.

Because that reuse skips the only response carrying the watchdog cadence, the
cadence is persisted **with** the token (`Playlist.stalkerWatchdogTimeout` /
`stalkerTimeslot`, payload fields like `stalkerToken` itself — no schema
change) and re-applied on the reuse path. The import dialog persists what its
own `get_profile` advertised, which for a portal whose token never goes stale
is the only profile the app ever sees.

The skip is therefore conditional on the cadence being **known**: a playlist
imported before the cadence was persisted has a reusable token and no
cadence, and skipping would strand it on the 120 s default permanently, since
the profile is the only thing that could teach it. Such a playlist runs one
profile, persists what it learns, and skips from then on. What gets persisted
is the _effective_ cadence (the 120 s default when the portal advertises
none), so stored absence keeps meaning exactly one thing — never profiled —
rather than sending a portal that advertises nothing back through a profile on
every start.

### `get_profile` status decoding

`authenticate()` decodes `js.status` the way the stock middleware means it:

- full profile / `status: 0` — OK; `watchdog_timeout` and `timeslot` are read
  for the watchdog cadence.
- `status: 1` — refused (device conflict, malformed MAC, disabled account).
  `msg`/`block_msg` carry the portal's own explanation; they are
  markup-stripped, combined, and thrown as `StalkerPortalError`. The kind is
  `device-conflict` when `isStalkerDeviceConflictMessage` matches the combined
  text, otherwise `blocked` — see "Device conflicts" below. A **bare**
  `{status: 1}` with no message is a refusal too: it used to be read as success
  whenever the portal sent no `msg`, which imported dead sources (the stock
  MAC-format rejection is exactly that shape). A profile that carries refusal
  text without setting the status is likewise refused.
- `status: 2` — login/password required. The client runs `do_auth`
  (`login`, `password`, plus `device_id`/`device_id2` when configured) and
  retries `get_profile` with `auth_second_step=1`. Only that retry claims the
  second auth step — the initial request sends `auth_second_step=0`. Missing
  credentials throw `StalkerPortalError('login-required')`; a `{js: false}`
  verdict (the operator billing script refused) throws `'login-rejected'`.

Credentials come from the import dialog's username/password fields and are
persisted on the playlist, so runtime re-authentication can repeat `do_auth`
after the portal drops the session.

### Plain-text failure bodies

Auth failures are **HTTP 200 + a text/html body**, never a 401/403. The three
exact bodies (`Authorization failed.` — stale/missing token, optionally with a
numeric debug suffix; `Access denied.` — blocked account;
`Unauthorized request.` — missing mac cookie) are classified at the transport
boundary: the Electron main process
(`apps/electron-backend/src/app/events/stalker.events.ts`) converts them into
a structured `{ stalkerAuthFailure }` marker
(`libs/shared/interfaces/src/lib/stalker-auth-failure.util.ts`) — returned,
not thrown, because `ipcRenderer.invoke` strips custom properties from
rejections. The PWA proxy path still delivers the raw string; the renderer
classifier accepts both shapes plus the legacy `{ js: '<body>' }` envelope.
`makeAuthenticatedRequest` retries once with fresh authentication and
otherwise throws `StalkerPortalError('auth-failed')` carrying the body.

### Error surfacing

`StalkerPortalError.portalText` holds the portal's own words. The import
dialog shows them in its failure snackbar (with kind-specific i18n headlines,
`HOME.STALKER_PORTAL.*`); the workspace context panel replaces the generic
"could not load categories" hint with the portal text (or the login-required
guidance) when category loading failed with a portal refusal
(`stalkerCategoryErrorDescription` in `workspace-context-panel.component.ts`).

Both renderers are kind-agnostic — they append `portalText` whenever it is
present — so the obligation sits entirely on the throw sites: **every** exit
out of the status-2 branch carries the text, not just the terminal `blocked`
one. A login refusal is precisely where the portal says something actionable
("wrong password", "subscription expired"), and dropping it leaves the user
with a generic line while the useful sentence sits unread in the payload.
Each exit reads the response IN HAND: after the `auth_second_step=1` retry the
text is the retry's, since quoting the first profile back would describe a
request that already succeeded. `do_auth` itself answers a bare `{js: false}`,
so a rejection there keeps the profile's text — the one that asked for the
login.

### Device conflicts

A device conflict is the one refusal with a concrete remedy, and the one where
relaying the portal verbatim actively misleads: the stock server answers
`{status: 1, msg: "device conflict — device_id mismatch", block_msg: "Your STB
is damaged…"}`, and hardware failure is not what happened. It therefore gets
its own `StalkerPortalErrorKind` and its own headline — the import dialog maps
it to `HOME.STALKER_PORTAL.DEVICE_CONFLICT`, and the workspace context panel is
the single place that overrides its otherwise kind-agnostic "portal text wins"
rule: `PORTALS.ERROR_VIEW.STALKER_DEVICE_CONFLICT` leads, the portal's own
sentence follows.

`isStalkerDeviceConflictMessage` (`stalker-portal-error.ts`) matches a small
phrase set against `msg`/`block_msg`. Two boundaries are deliberate: it reads a
STRUCTURED field the middleware wrote, so a phrase set is safe here in a way it
would not be against a raw HTML body (the asymmetry documented for
`isStalkerAuthFailureBody`); and it stays narrow around the binding itself,
because "device limit reached" or "no device selected" are different refusals
and offering "restore your first device ID" for them is a dead end.

### Abandoning an authentication

`authenticate()` takes an optional `AbortSignal` and checks it before every
portal call. Endpoint discovery gives each confirmation attempt its own
controller and aborts it when the attempt exceeds its budget, before moving to
the next candidate.

This matters because `get_profile` — not the handshake — is what adopts a
token for the MAC portal-side. Without the check, a timed-out attempt could
still send its `get_profile` after a later candidate had authenticated,
invalidating that healthy candidate's token and making discovery report a
working portal as refused.

Cancellation is deliberately cooperative rather than a socket-level abort
threaded to axios: once a request is on the wire the server processes it
regardless of what the client does, so tearing the socket down would not
prevent the adoption. Only not sending the request does, which is exactly what
the between-calls check guarantees.

That leaves the window where the timer fires while a `get_profile` is already
dispatched — which the check cannot cover, but sequencing can: discovery
**drains** the abandoned attempt (bounded by one request budget) before probing
the next candidate, instead of racing it. The request cannot be un-sent, but
nothing forces us to have a competing session in flight while it lands.

**A drain that times out stops discovery.** Draining is bounded, and the bound
has to mean something: an attempt still unsettled after its own 65 s budget
plus the 15 s drain is one no transport can recall — the PWA `fetch()` takes no
signal at all, and the Electron main process runs its HTTP request to
completion. Advancing anyway would stake the next candidate's freshly issued
session on that request never landing. So the rejection carries
`abandonedInFlight` plus a settlement promise and the candidate loop returns
instead of probing on,
preferring an honest "could not confirm this portal" the user can retry over a
session that looks established and dies later. It costs nothing in the normal
case: an aborted attempt settles as soon as its in-flight request errors out,
so the drain returns at once and the loop continues. Edit may return that
bounded error to the dialog, but its session and repair fences remain installed
until the settlement promise resolves. Import reports the refusal immediately
but keeps Add and the form disabled for the same lifetime. Lazy repair retains
its pending/runtime-authentication fences. Catalog, watchdog, repair, Add and
retry authentication therefore cannot race the abandoned `get_profile`.

The budget itself covers the longest real flow: a status-2 portal costs four
sequential requests (handshake, profile, `do_auth`, profile retry) and the
Electron transport allows each 15 s, so a two-request budget would have failed
valid but slow login portals.

### Watchdog

The portal expects `get_events` every `watchdog_timeout` seconds — **120 by
default**, echoed in the profile together with a per-user `timeslot` jitter
that offsets the first periodic ping. `StalkerWatchdogController` starts with
an immediate `init=1` ping on activation, applies the profile cadence when a
profile is decoded (clamped to 30–3600 s against garbage), and otherwise uses
the documented 120 s default. Failing to ping never invalidates the session —
it only affects the portal's admin-panel "online" reporting — so ping failures
are logged and never retried or escalated.

## Request Transport and `cmd` Encoding

Requests to an unreachable portal are short-circuited by the main process' host
connectivity guard rather than hanging their full 15/30 s timeout again. That
guard's refusal is classified by the same message-text rules discovery uses (it
lands in the "connection-level failure" slot below), and endpoint-discovery
probes are exempt from it via `skipConnectionGuard` — see
[`host-connectivity-guard.md`](./host-connectivity-guard.md).

A real MAG/STB sends `cmd` unencoded: the portal's client JS concatenates raw
`key=value` pairs, the browser URL layer escapes only what a URL cannot carry,
and PHP's `$_GET` applies exactly one form-urldecode. The portal therefore sees
the stored `cmd` decoded **once** — a pre-encoded `%3A` arrives as `:` and a
literal `+` arrives as a space. IPTVnator reproduces that reference wire format
on both transports with the shared `encodeStalkerCmdValue()`
(`libs/shared/interfaces/src/lib/stalker-cmd-encoding.util.ts`):

- `%` passes through untouched, so a `cmd` that already contains percent
  sequences is never double-encoded (the pre-0.23 `encodeURIComponent`
  transport delivered `%253A` and strict panels no longer matched the string).
- Characters the WHATWG URL serializer keeps raw in a query stay raw
  (`/ : ? = + , @ $ [ ]` …), so the emitted bytes survive the axios/`new URL`
  transport unchanged.
- Everything else is percent-encoded. This keeps the injection protection from
  the 0.22 hardening: `&`, `#` (and `;` for PHP setups with a `;` argument
  separator) inside `cmd` cannot append or truncate query parameters — they
  decode back to the original byte server-side, so the portal-visible value is
  unaffected.

Both transports assemble the portal request from the same two shared builders
in `@iptvnator/shared/interfaces`, so their wire format cannot drift apart:

- `buildStalkerRequestUrl()`
  (`libs/shared/interfaces/src/lib/stalker-request-url.util.ts`) builds the
  full portal URL: `cmd` uses the reference encoding, every other param stays
  fully `encodeURIComponent`-encoded, `JsHttpRequest=1-xml` is appended when
  missing, and any query carried by the portal URL itself is dropped.
- `buildStalkerIdentityRequestContext()`
  (`libs/shared/interfaces/src/lib/stalker-request-identity.util.ts`) builds
  the STB identity: the `mac`/`stb_lang`/`timezone` cookie (plus a
  serial-derived `__cfduid`), the MAG `User-Agent`/`X-User-Agent` pair
  (`STALKER_MAG_USER_AGENT`), `Accept`/`Accept-Language`/`Connection`, the
  `SN` header and `Authorization: Bearer` when present, and the serial
  parameter rule: `sn` travels only on `get_profile` (injected there, stripped
  everywhere else, mirrored into the `metrics` JSON).

Consumers:

- Electron: the `STALKER_REQUEST` handler
  (`apps/electron-backend/src/app/events/stalker.events.ts`) feeds both
  builders directly.
- PWA: the renderer (`PwaService.forwardStalkerRequest`) sends `macAddress`,
  `token`, and `serialNumber` as **control params** on the renderer→proxy leg
  (`URLSearchParams`, which Express decodes losslessly). The web-backend
  `/stalker` proxy consumes them into the identity headers via the same shared
  builders and **never forwards them in the portal's query string** — portal
  credentials must not land in portal or intermediary access logs. The one
  protocol exception is `handshake`, whose candidate token is genuine query
  content (the portal reads it for the idempotent-handshake path) and is
  re-injected there.
- Mock: the stalker-mock-server's `/stalker` route
  (`apps/stalker-mock-server/src/main.ts`) mirrors the proxy with the same
  shared identity builder, so PWA E2E runs exercise the real contract
  (including `query_keys_received` diagnostics matching what a real portal
  would log).

The mock portal's `create_link` response carries mock-only `cmd_received` and
`query_keys_received` diagnostics so E2E can pin this contract
(`apps/electron-backend-e2e/src/providers.e2e.ts`).

Response-side `cmd` normalization is also shared: both the Stalker store and
the cross-portal collection resolver (`StreamResolverService`) use
`normalizeStalkerPlaybackCommand()` / `resolveStalkerPlaybackUrl()` from
`libs/portal/stalker/data-access`, which strip the `<solution> ` prefix and
resolve relative (`/media/...`) or query-only (`?token=...`) `create_link`
replies against the portal base URL.

## Playback Link Resolution

### When `create_link` is called

A Stalker catalog row decides for itself whether it needs a temporary link.
The portal's own `player.js` — mirrored by Kodi's `pvr.stalker` — calls
`create_link` only when the row sets `use_http_tmp_link` (the portal proxies
the stream through a per-session URL) or `use_load_balancing` (the portal
picks a storage server per request). Every other row plays the static `cmd`
that `get_all_channels` / `get_ordered_list` already returned. Until PR 8 the
app called `create_link` unconditionally, so every playback paid a round trip
and gained a failure point that the reference client does not have.

One helper owns the decision:
`resolveStalkerStaticPlaybackUrl(row, cmd)` in
`libs/portal/stalker/data-access/src/lib/stores/utils/stalker-link-semantics.utils.ts`.
It returns the playable URL when the static path applies and `null` when the
portal has to resolve the command. `null` is deliberately wider than the flag
check alone; the extra guards can only push a row back onto the `create_link`
path, so they cannot regress a portal that works today:

| Input                                                                                                                                                                                                                                                                                                    | Verdict       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Either flag truthy (`1`, `'1'`, `true`)                                                                                                                                                                                                                                                                  | `create_link` | The portal asked for a temporary link.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| No row supplied at all                                                                                                                                                                                                                                                                                   | `create_link` | A caller that cannot show the flags gets no verdict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A row carrying neither flag KEY                                                                                                                                                                                                                                                                          | `create_link` | Absence means "no evidence", not "no". A stock portal returns both flags on every row, so their PRESENCE is the provenance signal — and the only one available, because rows persisted into Favorites/Recently Viewed before this change were stripped of them by `buildStalkerSelectedVodItem`'s whitelist, making a legacy snapshot indistinguishable from a genuinely unflagged row. There is no migration for those. **Radio is the documented exception**: a directly playable radio command has always played as-is, so a flagless radio row keeps that rather than newly minting. |
| Relative `/media/file_12.mpg` or query-only `?token=…`                                                                                                                                                                                                                                                   | `create_link` | Only the portal turns those into an address; the VOD `has_files` rewrite produces exactly the first shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Non-HTTP scheme (`ffrt4://ch/live/…`)                                                                                                                                                                                                                                                                    | `create_link` | Portal-internal pseudo-URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Portal-local host — `localhost` and any `*.localhost` name (RFC 6761 §6.3 reserves the whole suffix for loopback), `localhost.localdomain`, all of `127.0.0.0/8`, `0.0.0.0`, `::1`, `::`, and the IPv4-mapped forms `URL` normalizes to hex (`::ffff:7f00:1`); a terminal DNS root dot is stripped first | `create_link` | `ffrt3 http://localhost/ch/1234_` is an instruction to the portal, not an address a set-top box could open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Otherwise                                                                                                                                                                                                                                                                                                | static `cmd`  | Solution prefix stripped by `normalizeStalkerPlaybackCommand()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

`fetchStalkerPlaybackLink()` applies the verdict for ITV, VOD and radio, and
short-circuits before the request. It never applies it when `series` is set:
an episode is selected server-side by that parameter, so the parent row's
static `cmd` addresses the series, not the episode.

**The flags must survive normalization.** `buildStalkerSelectedVodItem()`
(`stalker-vod.utils.ts`) narrows a raw portal row to a whitelist, so a field it
does not name is silently dropped — and it feeds both VOD playback
(`selectedItem()`) and the download payload (`createStalkerVodItem` passes its
`data` straight through). Losing a flag there fails **open**: the row reads as
"no temporary link needed" and the static path plays the portal's non-final
URL. Both flags are therefore on the whitelist, on `StalkerVodSource` /
`StalkerSelectedVodItem`, and pinned by tests in `stalker-vod.utils.spec.ts`.
Any new normalizer between a portal response and a playback call has the same
obligation.

Callers pass the row they resolved the `cmd` from:

- ITV and radio — the channel/station row (`withStalkerPlayer`); radio
  previously bypassed `create_link` for any directly playable command, which
  meant a proxied station played a URL the portal never intended to serve.
- VOD and series — `selectedItem()`.
- Downloads — the movie payload, through the optional `linkFlags` argument on
  `fetchLinkToPlay()`, but only for a credential-free URL (see below).
- Favorites and Recently Viewed — `StreamResolverService.resolveStalker()`
  reads the flags off the persisted raw row (`UnifiedCollectionItem.stalkerItem`).
  Radio keeps its long-standing "directly usable command plays as-is"
  behaviour, keyed off flag EVIDENCE rather than snapshot presence — a radio
  row persisted before the flags were carried has a snapshot that simply lacks
  them, and testing presence would skip the fallback for exactly those rows.
  `withStalkerPlayer`'s radio branch applies the identical rule; the two must
  not drift.

### The static path still needs the session

`create_link` was also the request that warmed the portal session, and tokens
live in memory only (`StalkerSessionService.tokenCache`). Skipping it therefore
has to account for streams that are still gated on the Bearer token — and
"which routes are already warm" is not a question worth answering per route:
the global collection detail sets the playlist and the selected item straight
from a persisted row, with no catalog load in between, so a VOD opened from
Favorites reaches the store's playback path stone cold.

Every static return therefore warms first, through one primitive —
`ensureStalkerSession()` in `stalker-request.utils.ts`, wrapping
`StalkerSessionService.ensureToken()`:

- `fetchStalkerPlaybackLink()` calls it before returning a static URL, which
  covers ITV, VOD, radio and downloads at a single choke point.
- `StreamResolverService` calls it on its own static branch, which does not go
  through that function.

`ensureToken` performs handshake + `get_profile` with no link minted, and
validates the identity the cached token was negotiated for — which the raw
`getCachedToken()` cannot. It is cheap where it is not needed: a simple portal
runs only the in-memory configuration-authority guard and returns immediately,
while a warm cache with a matching fingerprint resolves without a request.

The store's player feature reads `getCachedToken()` for its header set, which
is safe there because it runs immediately after the warm above populated the
cache for that same playlist. `StreamResolverService` cannot make that
assumption — a direct-URL favorite reaches it with nothing warmed — so it goes
through `ensureToken` instead; see "Playback Header Contract" below.

The classification happens BEFORE the handshake, not after: a **foreign-host**
static URL never needs the session at all, and warming it anyway would stall
playback behind a request worth up to 15 s against a portal that may be slow
or offline while the CDN is perfectly reachable — for a result that is then
discarded.

A **foreign-host** static URL is returned before the handshake is even
attempted — it never needed the session. A **portal-owned** one with no usable
session (handshake failed, or threw) would be served knowing it will 401, so
both call sites fall back to `create_link` instead — which mints a URL
carrying its own token and, crucially, is the only path that can observe a
failure and trigger the lazy portal repair. That keeps a playlist still
misclassified as token-free, or pointing at an unrepaired endpoint, on the
self-healing path it was on before this change.

`ensureStalkerSession` returns that verdict: `true` for a portal that needs no
token and for one holding a usable token, `false` for a full portal left
without one. It swallows a throwing handshake rather than propagating it — an
unreachable portal must not surface as an exception mid-playback — which
simply makes the verdict `false` and routes the row to `create_link`.

**Known trade-off: a cached token is not revalidated.** `ensureToken` returns a
same-identity cache entry without touching the network, so the static path no
longer self-heals a token the server has retired — something `create_link`
used to do for free, since `makeAuthenticatedRequest` retires and re-auths on
an authorization failure. This is narrower than it sounds: per the 4.9.35
reference, handshake tokens have **no TTL**, and failing to send the watchdog
does **not** invalidate auth (it only clears the admin panel's "online"
status). The one real vector left is another device performing `get_profile`
on the same MAC — common enough on shared subscriptions, but wherever a
watchdog is running it still self-heals within a ping cycle, because the ping
goes through `makeAuthenticatedRequest` too. What is left uncovered is a
same-host static stream played while no watchdog is up.

Revalidating on every static playback would cost exactly the round trip this
section exists to remove, so it is deliberately not done here. The right home
for a fix is the auth lifecycle (PR 6): refresh on an observed playback
authorization failure, rather than pre-emptively on every play.

**Downloads are the exception, and cannot use this.** A download request cannot
carry portal credentials at all — the main-process stored-header allowlist is
`User-Agent` / `Origin` / `Referer` only
(`download-request-headers.ts`), with no `Cookie` or `Authorization`. So
`startStalkerVodDownload` offers the static shortcut only for a URL that needs
none: it classifies the candidate with `isStalkerStreamCredentialSafe()` and
withholds the row (forcing `create_link`) for anything portal-owned. A
same-host movie keeps using the minted URL, which carries its own access token;
a CDN-hosted one keeps the permanent URL that survives retry.

### Resolved links are never stored

A temporary link lives about 5 seconds (`tv_tmp_link_ttl` /
`vclub_tmp_link_ttl`, both default 5). It is time-limited but not single-use,
so the rule is to resolve immediately before playback and never persist,
cache or replay the result. What each persisting path actually stores:

| Path                                                                  | Stores                                                                             | Verdict                                                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Recently Viewed                                                       | the raw row including `cmd` (`buildStalkerRecentlyViewedPayload` spreads the item) | Re-resolves on replay.                                                                                                          |
| Favorites                                                             | the raw row including `cmd` (`addStalkerFavorite`, `toggleFavorite`)               | Re-resolves on replay.                                                                                                          |
| Playback positions                                                    | `playlist_id` + `content_xtream_id` + content type only — no URL column            | Not applicable.                                                                                                                 |
| Main-process playback context (`stalker-playback-context.service.ts`) | header sets keyed by the stream URL's origin + path, 15 min TTL                    | Stores no URL. The key drops the query, so a re-minted link with a fresh token still finds its headers instead of playing bare. |
| ITV full-list cache (`StalkerItvCacheService`)                        | catalog rows                                                                       | Rows, not links.                                                                                                                |
| Downloads                                                             | the resolved `url` on the `downloads` row                                          | **The one exception** — see below.                                                                                              |

The download row is the only place a resolved URL outlives the playback that
produced it, because the main-process downloader needs a URL it can retry and
resume with. Honouring the flags shrinks the exposure: an unflagged movie on a
host that needs no portal credentials now yields a permanent URL that survives
retry. A movie that needs a temporary link — or one on the portal host, which a
download cannot authenticate against — still stores a link that is dead by the
time retry runs. Fixing that needs the `cmd` on the download row plus a
re-resolution step before retry/resume, which is a schema change and is
deliberately out of scope here.

### `forced_storage` and `play_token`

Both are deliberately unused, and neither appears in the 4.9.35 reference
fact set as a parameter the stock server enforces:

- **`forced_storage`** is a `create_link` request parameter that pins VOD
  playback to one storage server. It exists for clients that let the user pick
  a storage; IPTVnator has no such concept, and omitting the parameter is what
  produces the empty value the portal treats as "no preference". Wiring it
  would first need storage discovery and a picker in the VOD detail view.
- **`play_token`** is a `create_link` response field for clients that assemble
  the stream URL themselves. IPTVnator plays the `cmd` the portal returns
  verbatim (after the solution-prefix strip and base resolution above), so the
  token the stream needs is already in the URL. Note the coupling with the
  section above: on the static path no `create_link` runs at all, so no
  `play_token` is ever produced — which is consistent, because a row that
  wants neither flag is announcing that its `cmd` needs no portal-minted
  credential.

Revisit both only with a portal that demonstrably fails without them.

### Regression coverage

**Writing tests against this section:** the decision chain has several exits —
no flag evidence, unresolvable command shape, `series` set, foreign host,
session unusable — and more than one of them can satisfy the same assertion.
Four tests in the PR that introduced this were found passing through an exit
other than the one they named (a foreign-host command reaches neither the
handshake nor `create_link`, so it silently stands in for "simple portal" or
"handshake failed"). Mutation testing does not catch it: it proves a test is
coupled to its target, not that it reached the mechanism in its name. Check the
mock setup against the execution path, and assert the step you mean was
actually taken — `expect(ensureToken).toHaveBeenCalled()` rather than only the
returned URL.

- `stalker-link-semantics.utils.spec.ts` — the decision table above.
- `stalker-vod.utils.spec.ts` — both flags survive
  `buildStalkerSelectedVodItem` / `normalizeStalkerVodDetailsItem` /
  `normalizeStalkerFavoriteItem`, and an unflagged row gains no flags.
- `stalker-player-request.utils.spec.ts` — static short-circuit, both flags,
  the `series` exception, relative VOD commands, the session warm-up (simple
  portal skipped, repaired endpoint used, failure degraded) and the
  portal-owned-without-session fallback to `create_link`.
- `with-stalker-player.feature.spec.ts` — ITV/radio store paths and proof that
  Recently Viewed stores the `cmd`, never the stream URL.
- `stream-resolver.service.spec.ts` — the collection route, plus the cold
  full-portal session warm-up and its best-effort degradation.
- `stalker-vod-download.spec.ts` — a CDN movie takes the static shortcut, a
  same-host one keeps minting.
- `stalker-playback-context.service.spec.ts` — headers only, query-insensitive
  key.
- `apps/web-e2e/src/stalker.e2e.ts` — mock scenario `00:1A:79:00:00:0A` serves
  unflagged ITV rows with a playable `cmd`; the spec asserts NO `create_link`
  request reaches the portal, and a companion test on the default (flagged)
  scenario proves the recorder does see one when a link is due.

## Playback Header Contract

Every playback kind — ITV, VOD, series episodes, and radio — resolves its
stream and attaches the same portal header set through
`buildStalkerExternalPlaybackHeaders()`
(`libs/portal/stalker/data-access/src/lib/stalker-live-playback.utils.ts`).
The collection routes (Favorites/Recently Viewed) share the contract:
`StreamResolverService.resolveStalker()` builds the identical profile for the
streams it resolves, so a channel opened from a collection carries the same
credentials as one opened from the portal.
The resolved `ResolvedPortalPlayback.headers` feed both the external players
(MPV/VLC/Embedded MPV via the launch IPC) and the built-in players via the
scoped Electron request-header override (`ElectronStreamHeadersService` — see
`docs/architecture/electron-security.md`, "Scoped Request Header Overrides").
Three surfaces apply that override, because `WebPlayerViewComponent` owns it
only for the video players and radio renders `AudioPlayerComponent` outside it:

- `WebPlayerViewComponent` — every built-in video player, on every route.
- `StalkerLiveStreamLayoutComponent` — the Stalker radio route's audio player.
- `UnifiedLiveTabComponent` (`libs/portal/shared/ui`) — the radio audio player
  of the Favorites / Recently Viewed collection routes.

Each owns a single scope slot and clears it only while it still owns it, so a
handover between them cannot drop the other's credentials.

Two stream profiles exist, selected by one shared predicate:

- **Portal-owned** (`isStalkerStreamCredentialSafe()` in
  `@iptvnator/shared/interfaces`): the stream host equals the portal host
  (compared with a terminal DNS root dot normalized away, since
  `portal.example.` and `portal.example` are the same host but `URL` keeps
  the dot) —
  including a different port or an http→https upgrade, the routine IPTV panel
  shape (#1158 class). These streams get the full MAG profile: `Cookie`
  (`mac=…` plus protocol cookies), `Authorization: Bearer <token>` when a
  session token exists, `User-Agent` (playlist override or the MAG UA — the
  API path always sent both, the playback set historically sent only
  `X-User-Agent`), `X-User-Agent`, `SN` when a real serial exists, and
  `Origin`/`Referer` set to the portal origin.
- **Foreign / direct** (different host, or an https→http downgrade): the
  credential-free `KSPlayer` direct-stream profile (`User-Agent: KSPlayer`,
  `Accept`, `Icy-MetaData`, `Connection`). Portal credentials must
  never reach a third-party host; direct stream URLs carry their access token
  in the URL minted by `create_link`.

Neither playback profile sets `Range`; byte ranges belong to the media
transport and must change with each seek. A static `Range: bytes=0-` overrides
mpv's requested offset, making the server return the beginning again. After
resuming a movie or episode this can send playback forward or to EOF instead
of the selected time. Regression coverage in
`stalker-live-playback.utils.spec.ts` checks both profiles and TLS downgrades;
`with-stalker-player.feature.spec.ts` verifies the resumed CDN episode path.

**The token is bound to the endpoint the headers claim.** Both header inputs —
the portal coordinates and the Bearer token — must describe the same portal, or
a session negotiated for one host is presented to another. In
`StreamResolverService` that is structural: the token is resolved from the same
`headerPlaylist` object the headers are built from, never from the row it was
derived from. The live case is a completed lazy repair, which moves the
endpoint in the override but not in the stored row. Resolving from the override
also keys the session cache the way `ensureStalkerSession()` and
`executeStalkerRequest()` already do, so the collection route reuses their
session instead of handshaking again for a second fingerprint.

For the same reason `headerPlaylist` is built by applying the override to the
row rather than folding in the two resolved coordinates: a repair rewrites the
portal **mode** as well as the URL, and the token resolver is mode-aware. A
playlist repaired from simple to full would otherwise keep its stale
`isFullStalkerPortal: false` here — the `create_link` request having already
run under the repaired mode and adopted a token — and the same-host gated
stream would go out with no Bearer header on the very playback the repair
existed to rescue.

That resolution is skipped for a foreign host, whose profile carries no token
anyway — obtaining one would only stall playback behind a handshake, exactly
the trade the static branch avoids by classifying first.

The Electron main process keeps a fallback header context per resolved
`create_link` URL (`stalker-playback-context.service.ts`) for external-player
launches that arrive without renderer headers. It classifies streams with the
same shared predicate — if the two ever diverged,
`isStalkerDirectStreamProfile` in the external-player path would discard the
renderer's credentialed headers for streams the main process misread as
direct.

The fallback also leaves `Range` unset, covered by
`stalker-playback-context.service.spec.ts`, so external launches cannot
reintroduce a fixed byte offset when renderer headers are absent.

The mock server's `gated-stream` scenario (MAC `00:1A:79:00:00:09`) makes
`create_link` return a local `/stream/gated/video.mp4` that answers 403
without the mac cookie and current Bearer token;
`apps/electron-backend-e2e/src/stalker-playback-headers.e2e.ts` uses it to
prove a built-in player's media requests really carry the credentials.

## Live TV and Radio

The Stalker live route and radio route intentionally share
`StalkerLiveStreamLayoutComponent`:

- `itv` uses `type=itv&action=get_ordered_list`, stores results in
  `itvChannels`, resolves playback through `resolveItvPlayback(...)`, and keeps
  the EPG panel visible.
- ITV additionally loads the COMPLETE channel list once per portal session (see
  "Full ITV channel list cache" below), so category views and search are not
  limited to the lazily loaded 14-item pages.
- `radio` uses `type=radio&action=get_ordered_list`, stores results in
  `radioChannels`, resolves playback through `resolveRadioPlayback(...)`, and
  renders `AudioPlayerComponent` instead of a video player.
- Radio hides the EPG panel and must not call Stalker EPG endpoints because
  radio stations do not have EPG data.
- Radio always uses the inline audio player. External player settings are
  ignored for Stalker radio, matching M3U radio behavior.
- Radio stations opened from favorites or recently viewed remain live
  collection items with `radio: 'true'`; the shared collection resolver uses
  `create_link` with `type=radio`, skips EPG loading, and renders the same
  `AudioPlayerComponent` layout instead of the Stalker VOD detail layout.
- Some Stalker portals do not expose radio categories. Radio category loading
  falls back to a synthetic `PORTALS.ALL_RADIO` category with
  `category_id: '*'` so the station list can still be loaded.
- A category click in the shell context panel only re-filters the channel
  sidebar; the selected channel or station keeps playing (Xtream live #936 and
  M3U group parity). `onStalkerCategoryClicked` therefore must NOT
  `clearSelectedItem()` for `itv`/`radio` — the layout gates its player on
  `selectedItem` — while VOD/series clicks still drop the open detail before
  navigating to the list route. The layout's category-change reset effect
  clears only list state (channels on the legacy paged flow, page, row EPG
  previews); the active channel's short-EPG fallback and a fallback load still
  in flight belong to the selection and survive the switch. Only a section
  change (`itv` ↔ `radio`, where the route session clears the selection)
  invalidates that request and drops the fallback. A playing channel outside
  the newly selected category simply has no highlighted row, and remote
  channel up/down finds no neighbour until a channel from the visible list is
  played.

## Full ITV Channel List Cache

Stalker portals paginate `get_ordered_list` with a server-side page size
(typically 14 items), so lazy loading alone can never power a complete local
search — this used to limit ITV search to whatever pages the user had scrolled
through. `StalkerItvCacheService`
(`libs/portal/stalker/data-access/src/lib/stalker-itv-cache.service.ts`) fixes
this with a per-portal, in-memory session cache of the complete live channel
list:

- Load strategy: first try the Ministra `get_all_channels` action (`type=itv`,
  returns ALL channels in one response — the same call STB clients use); if
  the portal does not implement it, crawl `get_ordered_list` pages
  (`category=*`, `genre=*`, concurrency 4, one retry per page, early stop on
  an empty page **or a page that adds no new channel ids** — some portals
  ignore `p` and repeat — 30k-channel hard cap) with progress reporting. The
  assembled list is de-duplicated by channel id (both strategies) so it never
  collides with the template's `track item.id`. The loading strategy itself is
  a stateless helper (`stalker-itv-channel-loader.ts`); the service owns state.
- Outcomes: a well-formed but unusable response marks the portal
  `unsupported` for the session (legacy paged flow stays in charge); a
  transient failure (network, or a page that failed both attempts) is retried
  later but throttled by a per-portal cooldown (`ERROR_COOLDOWN_MS`, 30s) so a
  deterministically-failing page can't trigger an unbounded re-crawl loop.
- Per-portal reactivity: the "cache ready / refreshed" trigger is a
  **per-portal** version signal (`versionFor(playlist)`), not one global
  counter, and the content resource reads it **only for ITV**. This is
  load-bearing: a global counter re-fired the resource for whatever was on
  screen (radio, another portal), and the legacy paged branch appends at
  `pageIndex > 1`, so an unrelated load completing duplicated the visible page
  (colliding `track item.id` → NG0955). The `isCurrentRequest` guard is scoped
  the same way.
- Integration: the `getContentResource` loader in
  `with-stalker-content.feature.ts` serves ITV categories from the cache when
  ready (local `tv_genre_id` filtering via `filterItvChannelsByGenre`,
  `hasMoreChannels=false`), and otherwise runs the legacy paged fetch while
  `ensureLoaded()` fills the cache in the background; the resource re-fires
  via the `cacheVersion` signal once the full list arrives.
- UI: `StalkerLiveStreamLayoutComponent` windows the rendered list
  (100-item chunks extended by the existing scroll handler) so multi-thousand
  channel lists do not blow up the DOM; the header count and search cover the
  whole category; a refresh button re-loads the list in place; a progress line
  shows crawl status.
- Loading state contract (important — regressions here strand the sidebar on a
  skeleton): in full-list mode the content loader serves the filtered list
  **synchronously** from the cache. The category-change reset effect therefore
  must NOT `setItvChannels([])` while `itvFullListActive()` is true — it runs
  after the store resource and would clobber the freshly served list, leaving
  every category after the first stuck on a skeleton. The initial-loading
  skeleton (`isInitialChannelsLoading`) must key off an actual in-flight load
  (`itvFullListLoading()` or `isPaginatedContentLoading()`), not merely an empty
  channel list; an empty result once loading has settled is an empty category
  and renders `PORTALS.NO_CHANNELS_IN_CATEGORY`, not a spinner.
- Search: with the cache active, the header search spans the ENTIRE portal
  (all genres) — filtering the store's `itvFullChannelList`, not just the
  selected category — so searching "CNN" while a "Sports" genre is selected
  still finds it; clearing the term returns to the selected category. The
  workspace shell drops the `degraded-loaded-only` / "loaded only" status for
  Stalker ITV once `itvFullListActive`; radio (no full-list cache) always keeps
  the loaded-only hint (`workspace-shell-search.service.ts`).
- Windowed selection: remote channel-up/down and numeric select operate over
  the full filtered category, so the render window (`renderLimit`) grows to
  include a selection beyond it (`ensureChannelWithinRenderWindow`) instead of
  drifting off-screen.
- Category count badges: the context panel shows per-genre channel counts on
  Stalker **Live TV** categories (like Xtream/M3U), fed by the store computed
  `itvCategoryItemCounts` (the full list grouped by numeric `tv_genre_id`; the
  `'*'` "All" row's total is stored under the `NaN` key that
  `Number('*')` produces). Badges are ITV-only — VOD/series/radio still page
  lazily so their per-category totals are unknown — and show a loading shimmer
  while the full list is still loading (`workspace-context-panel` →
  `stalkerShowCounts` / `stalkerCountDisplayMode`).
- Censored (adult) genres: portals typically EXCLUDE these channels from
  `get_all_channels` (sometimes without even flagging the genre `censored` in
  `get_genres`), so the cache legitimately has zero channels for them. The
  content loader therefore serves a genre from the cache only when the
  genre-filtered result is non-empty; otherwise it falls back to the legacy
  paged `get_ordered_list` fetch, which still returns those channels. The
  store computed `itvSelectedCategoryFromCache` is the single source of truth
  for this mode — the live layout keys windowing/infinite-scroll/`loadMore`
  and the category-change reset off it, NOT off `itvFullListActive`. Count
  badges: genres with no cached channels get NO map entry and the category
  view omits their badge (`omitMissingCounts`) instead of showing a
  misleading "0". The mock server ships a censored `For adults` ITV category
  (id 1099) to exercise this path.
- Eager preload + all-channels view (Xtream parity): entering the Live TV
  section immediately starts the full-list load (`preloadItvChannels()`, fired
  from an effect in `StalkerLiveStreamLayoutComponent` — not from the first
  category click), so the count badges and the all-channels view are available
  right away. Before a category is selected, the main area shows
  `StalkerItvAllItemsComponent` — an infinite-scroll card grid of every
  channel in the portal (a purely client-side render window over the cached
  list; it must never touch the store's legacy `page` state, which would
  re-fire portal requests). Clicking a card runs the same `playChannel` flow
  as the sidebar. Portals without a usable full list keep the "select a
  category" placeholder.
- Scope: ITV only. VOD/series append server pages on scroll and page their
  search portal-side; radio keeps legacy paging (station lists are small).
- The stalker-mock-server implements `get_all_channels` and provides the
  `legacy-pagination` scenario MAC (`00:1A:79:00:00:06`) to exercise the
  crawl fallback.

## VOD/Series Modes

Stalker has multiple real-world data shapes. The current implementation supports all three:

Within Stalker portal data access and feature code,
`isStalkerSeriesFlag()` is the canonical predicate for `is_series`.
`normalizeStalkerSeriesFlag()` delegates to it and produces the normalized
positive marker `true` or `undefined`. The activity normalizer in
`libs/shared/interfaces` keeps its dependency-neutral equivalent for dashboard
records. Both accept the same closed set: boolean `true`, numeric `1`, or string
`'1'`. Unsupported values do not by themselves classify a VOD item as a series.

1. Regular Series (`/series`):

- Seasons come from API resource (`serialSeasonsResource`).
- Episodes are derived from season payload.
- This is the only mode that sets `selectedSerialId`, which is what drives
  `serialSeasonsResource`. It is set purely from `selectedContentType ===
'series'` — the `series` detail branch renders `<app-stalker-series-view />`
  with no `vodWithSeries` input, so the API resource is its only episode
  source and the fetch must never be gated on item shape.
- Modes 2 and 3 below are always opened under the `vod` content type, which
  leaves the id unset — otherwise every VOD detail open would fire a
  `get_ordered_list&type=series` request whose result is discarded.

2. VOD with Embedded `series[]`:

- Item is opened under VOD, but already contains episodes.
- `StalkerSeriesViewComponent` creates a pseudo-season and renders episodes directly.

3. VOD with `is_series=1` (Ministra plugin behavior):

- Treated as series flow from VOD context.
- Seasons are fetched lazily.
- Episodes are fetched on season select.
- The season resource depends on the VOD item id and series mode, so a TMDB
  metadata patch does not reload seasons or discard loaded episodes. Pending
  episode requests belong to the exact loading season VM; replies from an old
  selection cannot fill a replacement list with reused provider season ids.
- A single-season item's explicit title marker (`s02`, `season2`, `(2 сезон)`,
  etc., in `name` or `o_name`) supplies the displayed season number, quick-start
  code and episode/playback/download metadata, independently of UI language and
  TMDB availability. Regular and embedded VOD series apply the same rule.
  Multi-season items keep provider numbering. Lazy VOD retains the original
  season key/number separately for stable tracking IDs and compatible legacy
  progress; provider request ids remain unchanged.
- The series quick-start CTA can load the first unloaded VOD-series season
  before playback. Unloaded seasons are considered unplayed in full season
  order, so an earlier unloaded season is not skipped just because a later
  season was loaded manually. If all currently loaded episodes are watched and
  more season metadata exists, quick start loads the next unloaded season
  instead of showing the completed state. After a lazy load, quick start is
  recomputed from the mapped episodes before playback so provider episode
  ordering cannot start the wrong episode.
- For unloaded VOD-series seasons, the CTA target label is derived from season
  metadata and rendered as `SxxE01` until episode details are loaded.
- Lazy VOD-series episodes use scoped tracking IDs derived from the parent
  series ID, provider episode ID, season key, and episode number. The season
  key follows the mapping fallback (`season_number`, then name, then ID).
- The previous season/episode hash remains available only as a compatibility
  alias in `legacyTrackingId`. The scoped ID is the in-memory episode key, and
  new playback positions always use it.
- Quick-start actions preserve both their translation key and interpolation
  parameters when adapted for the Stalker CTA. Dropping `labelParams` exposes
  the raw `{{episode}}` placeholder.

Series inline playback behavior is shared across all three modes:

- Episode downloads preserve those three origins separately through the
  persisted `episode_identity_scope`. Coordinate compatibility may reuse only
  a row with the same proven scope. A pre-scope coordinate row is ambiguous and
  blocks the action rather than binding regular, embedded, or lazy VOD content
  to another mode; an exact canonical episode id still wins.

- `StalkerSeriesViewComponent` maps every mode into `mappedSeasons()` and uses
  two episode identities. A pending playback request keeps an exact,
  request-local provider command or episode ID so command rotation and hash
  collisions reject stale completion. Once mounted, the component freezes only
  the credential-free structural identity and session key (source, normalized
  parent, mode, season key, season number, and episode number).
- The mounted structural identity is re-resolved against the current
  `mappedSeasons()` for metadata, Previous/Next, and autoplay. Same-owner
  provider and TMDB refreshes therefore expose current episode objects and
  commands without remounting the player; if the episode is missing or its
  structural coordinates are ambiguous, those surfaces and commands fail
  closed. Provider commands and IDs are never retained in mounted session
  state.
- The inline player header shows the current episode metadata below the title, for example `S01E03 - Episode title`.
- Embedded players receive previous/next episode state for the current season only.
- Inline series autoplay is enabled by default. On player EOF (`ended`), Stalker starts the next episode only when it already exists in the current season's mapped episode list.
- Autoplay and Next stop at the last episode of the current season. They do not jump to the next season and do not lazy-load an unloaded `is_series=1` season. Quick start remains the only flow that may load another VOD-series season before playback.
- Previous is disabled on the first episode of the current season and otherwise switches directly to the previous episode.
- Before either inline or external playback starts, the resolved content info
  includes the parent `seriesXtreamId` and the mapped `seasonNumber` /
  `episodeNumber`. Future playback-position rows therefore carry enough
  metadata for workspace surfaces to render an episode badge. Existing rows
  without those fields are intentionally not migrated and remain badge-less
  until the episode is played again.
- Ministra payloads may omit `season_number`. Episode mapping and lazy
  quick-start labels share the same naturally ordered season fallback so later
  seasons are not persisted as season 1.

### Playback Position Identity and Compatibility

Legacy playback positions are reconciled lazily when the current parent
series' positions and mapped episodes are available:

- The lookup is scoped to the current parent series. A legacy row is eligible
  only when its stored season and episode metadata, when present, match the
  mapped episode.
- An exact scoped tracking-ID row always wins. The old tracking ID may supply
  an in-memory compatibility alias only when no exact row exists.
- On the next position write, IPTVnator persists the scoped row through the
  strict, failure-propagating persistence boundary before removing a confirmed
  legacy row. If the scoped write fails, the legacy row remains intact.
- This is an on-read/on-write compatibility path, not a database schema
  migration or a bulk rewrite of saved positions.

The VOD-series contract is cross-surface:

- Favorites and recently viewed records preserve the raw `is_series` flag and
  VOD origin so reopening still uses the lazy Ministra resources.
- `extractStalkerItemType()` normalizes those activity records to dashboard
  type `series`.
- The dashboard resolves episode progress by the parent `seriesXtreamId` and
  renders the saved season/episode metadata. It does not infer episode numbers
  from provider payloads.
- Episode downloads from regular series, embedded VOD `series[]`, and lazy
  Ministra VOD `is_series=1` capture the rendered parent/episode metadata and
  provider category in a versioned offline snapshot. The focused Download
  Manager detail uses only locally available episode rows; it does not reuse
  the provider season resource as an offline availability list.
- `View in portal` first looks for a matching recently-viewed Stalker snapshot.
  Candidates must match both identity and the requested movie/series mode, so
  overlapping provider ids cannot bind an episode to a movie or vice versa.
  When found, the handoff preserves the raw regular-series, embedded
  `series[]`, or lazy `is_series=1` shape; an exact numeric category from the
  download snapshot replaces a virtual `vod`/`series` collection category.
- Without that compatible snapshot, only a movie with an exact persisted
  numeric category can form a metadata-only VOD target. Episodes and legacy
  movies without that proof leave the provider handoff unavailable rather than
  inventing a regular-series or generic VOD target. When a target does resolve,
  the provider host renders its content in identity-scoped provider-only
  presentation while Offline/local/download controls stay hidden.

Core decision logic and normalization are centralized in:

- `libs/portal/stalker/data-access/src/lib/stalker-vod.utils.ts`
- `libs/portal/stalker/data-access/src/lib/models/*.ts`

## Favorites and Recently Viewed

Current implementation is shared via Stalker-specific helpers:

- `createPortalCollectionResource(...)` generic collection loader
- `createPortalFavoritesResource(...)` favorites wrapper
- `createStalkerDetailViewState(...)` unified "open detail" decision
- `toggleStalkerVodFavorite(...)` shared add/remove behavior
- `normalizeStalkerEntityId(...)` and `normalizeStalkerEntityIdAsNumber(...)` for stable ID matching
- `matchesFavoriteById(...)` for cross-shape favorite matching

Where this is used:

- `libs/portal/stalker/feature/src/lib/stalker-collection-detail.component.ts` (favorites + recently viewed)
- `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- `libs/portal/stalker/feature/src/lib/stalker-favorites-button/stalker-favorites-button.component.ts`

Navigation rule to preserve:

- Stalker favorites, recently viewed, and search stay in their current screen and open inline detail state.
- They should not redirect into a canonical content/category/item route because Stalker detail rendering is currently store-state/inline driven, not route driven.
- Stalker radio favorites/recent items are the exception to VOD/series inline
  detail opening: they are normalized as live items and must open through the
  shared live collection audio-player path.
- VOD-backed series favorites can be displayed in series collections, but detail
  opening must preserve their VOD origin: `is_series=1` favorites set the
  selected content type to `vod` so the lazy Ministra season/episode resources
  run, and embedded `series[]` favorites render through the embedded VOD-series
  branch.
- See [Portal Detail Navigation](./portal-detail-navigation.md).

### Embedded-series snapshot refresh

Favorites and recently-viewed rows store the whole Stalker item as a JSON
snapshot, so an embedded `series[]` episode list (and its playback `cmd`)
freezes at the moment the row was written — newly released episodes would
never appear when the item is reopened from favorites, recents, or the
dashboard rails. `withStalkerSnapshotRefresh()`
(`stores/features/with-stalker-snapshot-refresh.feature.ts`) fixes this with a
snapshot-first + background re-fetch contract:

- The stored snapshot renders immediately; the store method
  `refreshEmbeddedSeriesSelection()` then re-fetches the item via a portal
  title search (`get_ordered_list&type=vod&search=<title>`, item matched by
  id, paginated up to 5 pages, wildcard-category retry) in the background.
- When the episode list or `cmd` changed, the selection is patched in place.
  The guard requires both the item id **and** the active playlist id to be
  unchanged, because Stalker ids are only unique per portal.
- Only the in-memory selection is patched — the stored snapshot row is
  deliberately left alone. Every entry path into the detail view runs this
  refresh, so a stale stored episode list is never rendered for longer than
  one background request, and writing it back would add an uncontrolled
  background writer to the whole-playlist read-modify-write that every
  favorite/recent mutation performs (lost-update risk).
- Triggers: `stalker-collection-detail.component.ts` (favorites/recent tabs,
  global collections, dashboard handoffs) and the optional catalog-facade hook
  `refreshSnapshotSelection()` for snapshot-injected browse detail
  (`openStalkerItem` navigation state).
- Regular `type=series` and Ministra `is_series` favorites are unaffected —
  their seasons/episodes are always fetched fresh on open.

## Backup and Restore

Versioned playlist backups include Stalker connection metadata plus playlist-
scoped favorites/recent snapshots.

Exported fields:

- `portalUrl`
- `macAddress`
- `isFullStalkerPortal`
- optional `username` / `password`
- optional request headers (`userAgent`, `referrer`, `origin`)
- full-portal serial/device/signature fields when present
- favorites and recently viewed collections

Excluded fields — everything that describes a negotiated session rather than
the connection:

- `stalkerToken`
- `stalkerSessionIdentity` (the fingerprint the token was negotiated for)
- `stalkerWatchdogTimeout` / `stalkerTimeslot` (the cadence the profile
  advertised)
- `stalkerAccountInfo`
- playback positions in backup v1

Import rule:

- backups restore the saved portal definition and replace the stored
  favorites/recent state for the matched playlist
- a fresh handshake must happen after import for full-portal sessions; imported
  backups never trust a serialized token

## Account Info Dialog

`StalkerAccountInfoComponent`
(`libs/portal/stalker/feature/src/lib/stalker-account-info/`) mirrors the
Xtream account-info dialog's visual language and shows subscription facts
for a portal: status, login, tariff plan, expiry date with a days-left
counter, MAC/phone, and portal details.

Data flow (two sources, cached-first):

- Cached: `Playlist.stalkerAccountInfo`, captured from `get_profile` at
  import time for portals discovery classified as FULL (endpoint discovery
  decides this by behavior, so a token-enforcing `portal.php` panel is a
  full portal too). The dialog loads it by playlist id (the meta row does
  not carry it) and renders instantly with a "Saved data" badge.
- Fresh: `StalkerAccountInfoService`
  (`libs/portal/stalker/data-access/src/lib/stalker-account-info.service.ts`).
  Routing follows the observed MODE, never the endpoint shape: full-mode
  portals re-run handshake + `get_profile`, simple-mode panels are queried
  with `account_info/get_main_info`, whose field set varies between panels
  and is mapped best-effort (absent fields render nothing). Both directions
  re-route after a lazy repair changes the mode mid-request, so a portal
  repaired from simple to full switches to the profile flow and vice
  versa. A failed
  refresh keeps the cached snapshot and flags it. The two no-data outcomes
  differ: a portal that answers but publishes no account facts (and no
  cached snapshot exists) renders the ready-state "No account details"
  panel, while only an unreachable portal without a cached snapshot enters
  the error state with retry.

Entry points are shared with Xtream and gated on the shared predicates in
`libs/shared/interfaces/src/lib/portal-account-playlist.utils.ts`
(`isXtreamAccountPlaylist` / `isStalkerAccountPlaylist`): the header playlist
switcher (bottom section for the active playlist and the per-row ⋮ menu),
the dashboard source card ⋮ menu, and the command palette. The
`WorkspaceShellHeaderService.openAccountInfoFor()` branch picks the dialog
by playlist type; `WORKSPACE_SHELL_ACTIONS.openStalkerAccountInfo()` lazy
loads the component. The stalker-mock-server implements `get_main_info` for
dev/E2E.

## Remote Control Integration

Stalker live remote control is implemented in:

- `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`

Supported today:

- Channel up/down
- Numeric channel selection (list-position based)
- Status publish for remote UI (portal/channel/current program)

See full backend and web-remote flow in [Remote Control Architecture](./remote-control.md).

## EPG Integration

Stalker ITV now splits EPG usage:

- active channel panel: bulk `get_epg_info` cached once per playlist and rendered
  through the shared EPG panel (`app-epg-timeline`, or `app-epg-list-view` in list mode)
- channel row preview: once ITV channels render, a post-reset effect eagerly
  starts the de-duplicated bulk `get_epg_info` load; rows issue no per-row
  request and derive previews from that cache
- active panel fallback: `get_short_epg` when bulk EPG is missing or unsupported

Full details are documented in [Stalker Portal EPG Architecture](./stalker-epg.md).

## Shared/Reusable Infrastructure

Stalker reuses some Xtream UI infrastructure deliberately:

- Category content rendering route uses Xtream category content component
- Season container for episodes uses shared Xtream season UI component
- Playback position handling for series episodes reuses Xtream store position mechanisms
- Downloads route reuses shared downloads feature

This reduces duplicate UI logic across portal types and keeps compatibility behavior aligned.

## Regression Coverage

The compatibility helper and focused regression coverage for Stalker VOD mode
branching and the cross-surface series contract live in:

- `libs/portal/stalker/data-access/src/lib/stalker-vod.utils.spec.ts`
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.ts`
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.spec.ts`
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.position-compatibility.spec.ts`
- `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.spec.ts`

Identity hardening (MAC normalization, derived device IDs, the reported device
profile and device-conflict classification) is covered by:

- `libs/shared/interfaces/src/lib/stalker-mac-address.util.spec.ts`
- `libs/shared/interfaces/src/lib/stalker-identity.utils.spec.ts`
- `libs/portal/stalker/data-access/src/lib/stalker-portal-error.spec.ts`
- `libs/portal/stalker/data-access/src/lib/stalker-auth.api.spec.ts`
- `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.spec.ts`
- `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.spec.ts`
- `apps/web-e2e/src/stalker.e2e.ts` — "explains a device conflict instead of
  relaying 'STB is damaged'", which pins a device ID through the proxy and then
  imports with a different one. Its negative assertion (the generic "refused
  access" headline must be absent) is what makes it fail if the classification
  is removed; verified by mutation.

Covered scenarios include:

- Embedded `series[]` opens series view state
- `is_series=1` opens lazy series state
- VOD-backed series favorites keep VOD-series loading semantics when opened from
  favorites/global favorites
- Favorite toggle helper path invokes the expected add/remove flow
- Quick-start episode labels interpolate their episode number
- Inline and external episode handoffs carry resolved season/episode metadata
- Dashboard activity classifies `is_series` VOD as series and resolves its
  saved episode position
