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

## Connection Input

Xtream server URLs are normalized through
`normalizeXtreamServerUrl` from `@iptvnator/shared/interfaces`.

Rules:

1. Only `http` and `https` URLs are accepted.
2. URL username/password credentials are rejected.
3. Leading and trailing whitespace is ignored.
4. Trailing slashes are removed.
5. Full API or playlist URLs ending in `/player_api.php` or `/get.php` are
   reduced to the portal base URL.
6. Provider subpaths are preserved. For example,
   `https://example.test/panel/player_api.php?...` becomes
   `https://example.test/panel`.

The Xtream import form may extract `username` and `password` from full
`get.php` or `player_api.php` URLs, but stored playlist metadata should keep
the normalized `serverUrl` plus trimmed credentials.

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

## User-Agent

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
player clients; a player-style User-Agent (currently a VLC signature) avoids
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
resolving the stream id and container extension as one source. Fields from
`movie_data` take priority, with the top-level catalog fields used as a
fallback when extended metadata is absent or incomplete. A source requires a
positive integer id and a non-empty container extension; otherwise URL
construction returns an empty string.

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
already-rendered item safely unplayable. Detail requests are generation- and
playlist-guarded, and detail teardown invalidates the active generation, so a
late response cannot replace a newer selection or repopulate a closed detail.
In-memory VOD category and stream arrays record the playlist that populated
them. Cross-portal Favorites/Recent details ignore arrays owned by another
playlist, so colliding Xtream ids cannot suppress recovery or contribute a
foreign playback extension, title, poster, category, or recommendation.

Metadata availability and VOD playability are independent. An empty or sparse
`get_vod_info` response keeps the curated fallback detail page, but that page
offers the same Play/Resume, Favorite, and Download actions when the source
resolves. An unresolved source exposes no actions. Playback and download
descriptors also fall back to the catalog title and poster after `info` and
`movie_data`.

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
