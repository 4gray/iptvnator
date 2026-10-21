# IPTVnator TV prototype

The TV client is a separate Preact 10 application (`apps/tv`), with feature,
UI, data-access and pure contracts under `libs/tv`. It does not load the Angular
renderer, Electron bridge, Node runtime, TMDB or another player engine.
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

## Playback and local data

One `HTMLVideoElement` exists for preview and fullscreen. Focus movement never
switches streams. First OK starts live preview; repeated OK opens fullscreen.
Fullscreen Back restores the opening control, and detail Back restores item
identity and catalog page. Controls appear on demand; remote media keys and
native VOD seeking use the same adapter.

Single-line text fields keep Left/Right caret movement and use Up/Down for
spatial focus. Native select controls keep Up/Down for choices and leave with
Left/Right. Disclosure summaries, including explicit MAG identity fields, are
part of the remote focus order. Actual webOS keyboard interaction remains a
physical-device check.

Separate request lanes own catalog/detail, EPG and playback resolution.
Superseding requests abort transport and lose publication rights, even if a
transport later delivers a response. Catalog pages render at most 60 Xtream/M3U
items or at most 60 Stalker items, translating larger provider pages without
gaps; episode views render at most 30 rows. Home rails are capped. Arrow
navigation does not initiate catalog pagination. Guide focus and search
requests are debounced and superseded work is cancelled.

`iptvnator-tv-user-data` is a separate IndexedDB database (schema 1 and payload
version 1). Sources, active source, backend settings, favorites, history and
positions survive browser relaunch. Updates serialize and become visible only
when the read/write transaction completes. Quota, open and write failures are
visible; the application never reports an uncommitted favorite as saved.
History begins on `playing`, then saves every 10 seconds, on pause/leave/hide.
Recent history is bounded to 200 entries; playback positions are retained
independently, so an older title still resumes. Additive reads recover positions
from older TV snapshots that only contain history. Closing an OS process can lose the interval
since the last committed write; asynchronous pagehide writes are best effort.

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
