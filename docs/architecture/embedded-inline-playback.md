# Embedded Inline Playback

This document records the current contract for embedded playback in portal detail views.

## Summary

- Embedded web players are `videojs`, `html5`, and `artplayer`.
- `embedded-mpv` exists as a hidden desktop experimental harness backed by a native MPV addon. macOS and Windows use in-process `libmpv`; Linux uses an X11/Xwayland child window with an out-of-process `mpv --wid` backend.
- Controlled external players are `mpv` and `vlc`.
- macOS `.app` bundle paths are resolved only for real MPV/VLC apps. IINA may
  launch through the MPV path field when the user supplies an executable path
  such as `/Applications/IINA.app/Contents/MacOS/iina-cli`, but IPTVnator
  controls, position polling, and instance reuse are not guaranteed for IINA.
- Flatpak launches external players on the host via `flatpak-spawn --host`.
- Live playback stays inline in dedicated live layouts.
- VOD and series detail playback stays inline on canonical detail, collection,
  favorites, recent, and search surfaces.
- Xtream and Stalker series detail heroes expose a quick-start CTA driven by
  saved episode playback positions.
- Embedded playback UI is always hosted by the current view. `PlayerService`
  launches MPV/VLC only and does not open an embedded-player dialog.
- Browser-player failures are diagnosed client-side and produce ranked,
  user-triggered recovery actions without changing the saved player setting.

## Scope

Inline embedded playback is required for these VOD/series entry points:

- Xtream VOD detail route
- Xtream series detail route
- Stalker VOD detail view
- Stalker series detail view
- unified favorites collection details
- unified recently viewed collection details
- Stalker advanced search result details

Collection/search VOD surfaces that expose embedded playback must host
`ResolvedPortalPlayback` inline state locally. They must not call
`PlayerService.openPlayer(...)` or `PlayerService.openResolvedPlayback(...)` to
create embedded UI.

## Logical Playback Identity

Every inline playback host owns a required, URL-independent
`playbackSessionKey`. Live hosts derive it from the playlist/source and the
current channel identity; an M3U session uses `Channel.id` rather than a mutable
stream or catch-up URL. VOD and series hosts use the route or catalog
content identity, with series episode coordinates. Stalker episode identity
also includes the series mode, normalized parent, exact season key, and the
original provider command or episode ID; synthesized episode hashes are not
identity. Selection and pending-resolution guards use that exact provider
episode identity, so colliding tracking hashes cannot select a sibling episode.
Shared wrappers (`VodDetailsComponent` and `PortalInlinePlayerComponent`) pass
the key unchanged to `WebPlayerViewComponent`.

Hosts invalidate both committed playback and pending resolution when the
canonical owner changes (playlist/source, content, and mode where applicable).
Refreshing data for the same canonical owner preserves the mounted player.
Collection UIDs remain a separate persistence concern; legacy M3U collection
UIDs continue to use stream URLs so saved favorites ordering remains compatible.

Temporary portal URLs, catch-up URLs, headers, DRM data, and alternative source
payloads are transport details and must not change this logical identity. A
content or episode change must produce a different key. The serialized key is
created with `createPlaybackSessionKey()` from `@iptvnator/playback/util` so
delimiter-bearing provider IDs remain unambiguous.

The key is host-owned and stable only for the logical selection represented by
that mounted host. In particular, M3U identity uses the current playlist/source
identity and `Channel.id`; it does not claim durability across a refresh that
replaces either identity. Recovery state contains this credential-free key,
target IDs, generation counters, and a finite VOD resume position. It never
uses a playback URL, headers, DRM configuration, or credentials as identity.

Inline hosts capture this identity before asynchronous playback resolution. A
completion may mount only while the same owner is current; stale completions
and embedded starts without a complete canonical identity are ignored without
replacing an already committed session.

## Embedded MPV Harness

The repository now contains a first-pass native embedded MPV harness for Electron:

- shared setting id: `embedded-mpv`
- native addon owner: `/Users/4gray/Code/iptvnator/apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`
- IPC bridge: `/Users/4gray/Code/iptvnator/apps/electron-backend/src/app/events/embedded-mpv.events.ts`
- renderer host: `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.ts`
- native architecture and release-readiness details: `/Users/4gray/Code/iptvnator/docs/architecture/embedded-mpv-native.md`

Current contract:

- desktop only: macOS, Windows x64, and Linux x64 under X11/Xwayland
- experimental opt-in
- enabled in local development only when `IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT=1`
- Linux Wayland sessions must start Electron through Xwayland, for example with `pnpm nx run electron-backend:serve-electron --args=--ozone-platform=x11` during local development or `iptvnator --ozone-platform=x11` for a packaged app
- enabled in packaged desktop builds only when the bundled native addon/runtime prerequisites are present; Linux additionally requires an `mpv` executable on `PATH`
- uses IPTVnator-owned controls and `ResolvedPortalPlayback` payloads
- uses the libmpv render API on macOS and renders through an IPTVnator-owned native `NSView`
- uses mpv `wid` embedding on Windows and Linux through IPTVnator-owned native child windows
- Linux starts `mpv --wid=<x11-window>` out of process so MPV does not share Electron's FFmpeg or graphics symbols
- Linux controls that out-of-process MPV instance through a private JSON IPC socket so duration, position, pause, volume, and seek state come from MPV instead of renderer guesses
- Linux starts that MPV process with `WAYLAND_DISPLAY` removed, `XDG_SESSION_TYPE=x11`, and X11 video output options; otherwise MPV can pick Wayland inside a Wayland desktop session, ignore `--wid`, and open a separate window instead of embedding
- macOS/Windows default to libmpv's OpenGL render backend with `hwdec=auto-safe`
- keeps the previous software renderer as a debug fallback via `IPTVNATOR_EMBEDDED_MPV_RENDERER=sw`
- emits lightweight native diagnostics when `IPTVNATOR_TRACE_EMBEDDED_MPV=1` is set; Linux also writes MPV's own trace log to `/tmp/iptvnator-embedded-mpv.log`
- exposes an IPTVnator-owned fullscreen button that uses the renderer fullscreen API and resyncs the native MPV view bounds after fullscreen transitions
- auto-hides IPTVnator-owned controls while playback is active and restores them on pointer/focus interaction
- exposes audio-track metadata from MPV and switches tracks through the `aid` property without reloading the stream
- passes VOD/episode resume offsets to MPV through the `loadfile` options map; live catchup URLs are treated as already-positioned streams
- applies the initial volume during session creation and uses async libmpv control calls after startup where the in-process libmpv backend is active
- VLC remains external-only

Current limitation:

- the current feasibility harness is still experimental and platform-specific
- the original macOS `wid` embedding path produced audio with a black video surface inside Electron, so the harness now avoids foreign-window embedding on macOS
- Windows and Linux use the mpv `wid` path and still need OS-native packaged smoke coverage before public exposure
- Linux native Wayland is not supported in this implementation; the Electron process must have `DISPLAY` through X11/Xwayland and a real X11 window handle
- the OpenGL render path avoids the old per-frame `CGImage` copy path, but it still needs broader interaction, resize, and packaging coverage
- startup deadlocks seen during early macOS playback bring-up are mitigated, but the feature is still kept behind the explicit experiment flag until more interaction and packaging coverage is proven
- because of that, the setting is auto-sanitized back to the default inline player unless support detection reports that the experimental runtime is available
- this follows the rollout gate: keep the native work in-tree, but do not leave it user-facing until playback, resize, focus, and packaging are stable

## Two-State Detail Layout (Browse ↔ Watch)

Portal VOD/series detail pages are hosted by the shared
`PortalDetailShellComponent`
(`libs/ui/components/src/lib/portal-detail-shell/portal-detail-shell.component.ts`),
which owns the page scroll container and two layout states:

- **Browse** (`playbackActive=false`): the hero (`ContentHeroComponent`,
  now a natural-height, non-scrolling block) renders poster, title, chips,
  description, credits, and actions. Episodes render below.
- **Watch** (`playbackActive=true`, bound by hosts to
  `inlinePlayback() !== null`): the hero collapses (~300ms CSS morph,
  disabled under `prefers-reduced-motion`), the host-projected
  `[detail-player]` slot renders the inline player at full content width,
  and the shell renders an About block (`ContentAboutComponent`) below the
  `[detail-episodes]` slot so the hero metadata stays reachable.

Contracts:

- Hosts provide hero chips/meta/actions as `*appDetailTags` / `*appDetailMeta` /
  `*appDetailActions` templates; the shell stamps them into the hero and again
  into the About block. Degradation stays "missing → not rendered".
- The shell never wraps the `[detail-player]` slot in a conditional; the
  host's `@if (inlinePlayback())` is the only creator/destroyer of the
  player subtree, so shell state changes cannot recreate the `<video>`.
- **External MPV/VLC sessions do not flip the layout to watch** — browse
  layout stays, and the primary CTA keeps its "Stop <player>" behavior.
- Escape closes inline playback: the shell emits `closePlayerRequested`
  when playback is active, the event was not `defaultPrevented`, and no
  element is in browser fullscreen; hosts wire it to `closeInlinePlayer()`.
- The now-playing bar separates two exits: the back arrow emits
  `backClicked`, which hosts wire to their route-level `goBack()` (straight
  back to the list — everything browse offers is also visible in watch, so
  a two-step unwind would be ceremony); the "Close player" button and
  Escape emit `closed`/`closePlayerRequested` and return to browse without
  navigating.
- Entering watch scrolls the shell to the top; leaving keeps the scroll
  position.

### Inline player stage (theater + ambient fill)

`PortalInlinePlayerComponent`
(`libs/ui/playback/src/lib/portal-inline-player/`) wraps the projected
`WebPlayerViewComponent` in a `.player-shell__viewport` "theater stage".
The stage spans the full content width and is capped at
`min(70vh, 720px)`; on wide-short windows it becomes wider than 16:9. The
player is sized as the largest 16:9 box that fits the stage height and is
centered, so the leftover is always the stage's own black background — never
a stray strip of app surface. This is the YouTube-style letterbox and is the
default behavior for every inline engine.

The optional `playerAmbientMode` setting (Settings → Playback, default off,
shown only for the built-in web players) renders a blurred, dimmed copy of the
poster (`ResolvedPortalPlayback.thumbnail`) behind the player via the
`--ambient-image` custom property, turning the letterbox margins into
atmosphere (YouTube "Ambient mode" / Netflix backdrops). The component also
enforces the web-player scope at runtime (HTML5, Video.js, ArtPlayer): with
Embedded MPV selected, a persisted `playerAmbientMode=true` never renders the
layer, keeping extra DOM out of the native-video compositing path. Live
channels are excluded (their `thumbnail` is a logo), and only
`http(s):`/`data:` poster URLs are accepted to avoid CSS `url()` breakout.

### Up Next side rail (series)

For inline **series** playback the stage can trade its centered letterbox for
a Netflix/Plex-style layout: the player docks left and the leftover column
becomes an "Up Next" episode rail (`app-up-next-rail`,
`libs/ui/playback/src/lib/portal-inline-player/up-next-rail.component.ts`).
The rail lists the currently playing episode (highlighted, click-inert)
followed by the rest of its season and a spillover into the following
seasons, with per-episode watch-progress bars from playback positions.

- Data flow: the hosts (Xtream `SerialDetailsComponent`, Stalker
  `StalkerSeriesViewComponent`) build the entries with
  `buildUpNextRailItems()` (`up-next-rail.util.ts`) from their
  season→episodes map, the inline episode state, and the playback-position
  map, and pass them into `PortalInlinePlayerComponent` via the
  `upNextEpisodes` input. Selection comes back through
  `upNextEpisodeSelected`, carrying the host's raw episode object, and is
  routed into the host's existing episode-play flow — the same path the
  season container uses.
- Width gating: a ResizeObserver on `.player-shell__viewport` feeds the
  component's `stageSize` with the stage's **border-box** size, and the gate
  computes the width the rail would actually receive — stage minus the docked
  layout's padding, minus the 16:9 player sized to the remaining height, minus
  the flex gap (`RAIL_STAGE_PADDING` / `RAIL_STAGE_GAP`, kept in sync with the
  stylesheet). The rail docks in only when that is ≥ 320px
  (`UP_NEXT_RAIL_MIN_WIDTH`). Measuring the border box matters: the docked
  modifier adds padding to the same element being observed, so a content-box
  measurement would change the input the moment the rail appears and could
  oscillate around the threshold. On near-16:9 or taller windows the rail
  auto-hides and the centered theater/ambient behavior above remains.
- Lazy Stalker seasons: Ministra VOD-series seasons carry no episodes until
  their tab is opened, so `StalkerSeriesViewComponent` prefetches the season
  after the playing one while inline playback is active — otherwise the rail's
  next-season spillover would silently stop at the current season's end. The
  prefetch is claimed synchronously and answered seasons (including genuinely
  empty ones) are never re-requested: a failed request leaves `episodes` empty
  with `isLoading` back to false, which would otherwise re-run the effect that
  issued it and loop. A _failed_ request releases the claim but is pinned to
  the episode that triggered it, so a transient portal error retries on the
  next playback change instead of either looping or giving up permanently.
- Gating mirrors ambient mode: the `playerUpNextRail` setting (Settings →
  Playback, **default on**, shown only for the built-in web players) plus a
  runtime web-engine check; the rail also requires
  `contentInfo.contentType === 'episode'` and non-live playback, so movies
  and live channels always keep the centered stage.
- Layering: the rail is an opaque panel rendered on top of the stage, so the
  ambient fill stays behind it and shows in the flexible gap between the
  docked player and the rail on very wide stages.

Season navigation inside `SeasonContainerComponent` uses season tabs
(`SeasonTabsComponent`; a dropdown beyond 6 seasons) instead of the old
seasons-grid + "Back to seasons" level. A season is auto-selected
(inline-playing episode's season → most recently updated in-progress
episode's season → first) and the auto-selection emits `seasonSelected`,
so host lazy-load/enrichment hooks (Stalker VOD-series episode fetch,
TMDB season fetch, Xtream `enrichSelectedSerialSeason`) fire on open
without a click. Switching tabs never stops playback; a "back to playing
episode" chip appears when the playing episode is outside the opened
season. Season descriptions come from `get_series_info` seasons (Xtream)
or `TmdbEnrichmentService.getSeason` (Stalker).

## Components

Shared detail layout shell:

- `/Users/4gray/Code/iptvnator/libs/ui/components/src/lib/portal-detail-shell/portal-detail-shell.component.ts`

Shared inline player shell:

- `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/portal-inline-player/portal-inline-player.component.ts`

Xtream detail hosts:

- `/Users/4gray/Code/iptvnator/libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`

Stalker detail hosts:

- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-collection-detail.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`

Embedded playback does not have a fallback dialog path.
`PlayerService.openResolvedPlayback(...)` remains the MPV/VLC external launch
entry point; for embedded players it returns without creating UI.

Diagnostics, recovery policy, and recovery UI:

- `/Users/4gray/Code/iptvnator/libs/playback/util/src/index.ts`
- `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`

## Playback Decision Rule

When a detail view starts playback:

1. Resolve or construct a typed playback payload.
2. Check the active player setting.
3. If the player is embedded, render the inline player inside the current detail view.
4. If the player is external, hand the same payload to `PlayerService` for MPV/VLC playback.

The detail or collection/search host owns inline state. `PlayerService` is not
an owner of embedded UI playback state.

After a successful external episode launch, the detail host immediately
persists that episode as the latest playback-position entry, preserving an
existing resume offset or using zero for a newly opened episode. MPV/VLC
position telemetry overwrites this launch marker when available. This keeps the
last-watched season and episode correct even when an external player's progress
interface is unavailable; exact external timestamps remain best-effort.

## Series Quick Start CTA

Xtream and Stalker series detail views share the quick-start decision helper in
`libs/portal/shared/util/src/lib/series-quick-start.ts`.
The helper flattens the loaded season/episode map, sorts seasons and episodes in
natural order, and returns the hero CTA state.

Current contract:

- the CTA shows the action label plus a compact episode target such as
  `S01E02 · Episode title`
- if an episode is in progress, resume the latest updated in-progress episode
  with its saved offset
- if the newest episode entry is a successful external-player launch marker
  with no meaningful progress yet, target it with `Play episode N` instead of
  falling back to the first episode
- if no episode is in progress, play the first unwatched episode in season order
- if watched episodes end at a season boundary, play the first episode of the
  next loaded season
- if every loaded episode is watched, render a disabled completed state

The click path must continue through each detail host's normal episode playback
method so recent-item updates, inline/external player selection, resume offsets,
and playback-position saving keep the same behavior as manual episode clicks.

## Series Inline Episode Continuation

Xtream and Stalker series detail views own current-episode state and pass a
`SeriesPlaybackNavigation` payload through `PortalInlinePlayerComponent` and
`WebPlayerViewComponent` to the active embedded player.

Current contract:

- Video.js, HTML5, ArtPlayer, and embedded MPV emit `playbackEnded` only for
  real media EOF/`ended` events.
- Teardown, replacement, manual close, player reload, idle state, and playback
  errors must not emit `playbackEnded`.
- Series previous/next controls render only when the series navigation payload is
  present. Movies, live streams, radio streams, and non-series VOD must not show
  those buttons.
- The shared navigation payload contains `canPrevious`, `canNext`, and
  `autoplayEnabled`. Player controls disable previous on the first episode and
  next on the last episode of the current season.
- Autoplay is enabled by default for series playback. On `playbackEnded`, the
  portal detail host starts the next episode only when `canNext` is true for the
  current season.
- Autoplay and Next never cross season boundaries or lazy-load another season.
  Quick start remains the flow that may choose an episode from another loaded or
  newly loaded season before playback begins.
- Previous switches directly to the previous episode in the current season. It
  does not implement a restart-threshold behavior.

## Codec And Container Diagnostics

The shared `WebPlayerViewComponent` is the central browser-player viewport for
M3U, Xtream, and Stalker inline playback, including live streams opened from
favorites and recently viewed collections. Video.js, HTML5, and ArtPlayer
report native media errors, hls.js errors, Video.js/VHS errors, Shaka errors,
mpegts.js errors, and HLS manifest codec metadata into the DOM-free classifiers
exported by `@iptvnator/playback/util`.

The canonical recovery flow is:

```text
engine public error
  -> sanitized PlaybackDiagnostic (@iptvnator/playback/util)
  -> recommendPlaybackRecovery(context)
  -> ranked maximum-three action model
  -> WebPlayerView session-local user action
```

Engine adapters own public-event collection and sanitation. The playback
utility owns diagnostic contracts, evidence classification, source/engine
mapping, capability contracts, and the pure recommendation policy.
`WebPlayerViewComponent` owns only the current session state and execution of a
user-selected action. Diagnostic producers do not decide which player to show,
and the recommendation policy does not inspect Angular, the DOM, settings,
storage, or Electron globals.

The diagnostics remain client-only:

- no ffprobe or server-side probing
- no extra manifest fetch beyond the active player
- no automatic failover to an external player
- no embedded MPV diagnostics

Supported diagnostic codes are:

- `unsupported-container`
- `unsupported-codec`
- `media-decode-error`
- `network-error`
- `browser-access-error`
- `drm-or-encryption`
- `unknown-playback-error`

Native `MediaError` code 4 alone is not codec evidence. A source with a known
browser-incompatible container remains `unsupported-container`; otherwise, a
code 4 error without stronger evidence is `unknown-playback-error`. An explicit
Video.js HTTP error is `network-error` and shows its status. Because an HTTP
status is server/network evidence rather than decoding evidence, external
decoding is not presented as a likely fix.

Video.js `8.23.9`, the default web player, runs HTTP streaming through bundled
VHS `3.17.5`. Its terminal `Player#error` crosses a separate allowlisted
boundary built only from the public Video.js `MediaError` code/status,
`metadata.errorType`, and the documented `player.tech().vhs` runtime property.
The engine type must exactly match an installed `videojs.Error` value;
unrecognized values remain unknown. Exact network identifiers, HTTP 4xx/5xx
status, and standard network code 2 produce `network-error`; exact
`streamingfailedtodecryptsegment` or standard encrypted code 5 produce
`drm-or-encryption`. A generic VHS code 3 remains
`unknown-playback-error` because VHS also assigns code 3 to terminal internal
objects and strings that do not establish a decode cause. Non-VHS native code
3 keeps its standard media-decode meaning.

VHS stage evidence is derived only where the public engine identifier names
the operation: HLS playlist parsing is `playlist`, DASH manifest parsing is
`manifest`, and select/decrypt/transmux/append segment errors are `segment`;
everything else is `unknown`. In particular, IPTVnator does not read internal
`requestType` values to guess manifest, playlist, segment, or key stages. VHS
handles retries, rendition exclusions/re-inclusions, segment timeout recovery,
and request aborts before a final player error; IPTVnator observes only the
public terminal event and does not subscribe to undocumented recovery events
or private loaders.

Video.js/VHS error messages, request or response URLs, headers, xhr objects,
response text/bodies, credentials, request types, and arbitrary metadata are
neither retained nor rendered. Technical details contain only the sanitized
stage, exact/unknown engine type, standard/unknown media error code, terminal
disposition, and validated HTTP status. The active playback URL remains
available only through the pre-existing playback metadata used by Retry, Copy
URL, and explicit external-player actions; it is never copied from VHS error
metadata.

HLS.js errors cross one shared sanitizer boundary before HTML5 or ArtPlayer can
emit a diagnostic. The boundary retains only allowlisted engine `type` and
`details` identifiers, the final fatal/recoverable disposition, a stage derived
from exact details (`manifest`, `level`, `segment`, `key`, `media`, or
`unknown`), a structured failure kind, and a validated `response.code`.
Recoverable events return no terminal diagnostic. Exact codec, decrypt/key
system, network/timeout/HTTP, and media/mux evidence select the corresponding
diagnostic; insufficient evidence stays `unknown-playback-error`.

HLS.js does not expose a reliable structured CORS, mixed-content, CSP, or
private-network-access cause. Status zero and generic fetch failures therefore
remain network/unknown evidence instead of becoming browser-access guesses.
Error URLs, request context and headers, loader/network objects, response
URL/text/body, error messages, reasons, and arbitrary provider payloads are
neither retained nor rendered. Technical details show only the sanitized stage,
failure, engine type/details, disposition, and HTTP status. The active playback
URL remains available to the pre-existing retry, copy, and explicit
external-player workflows; it is not copied from the HLS error payload into
the evidence or technical details. HLS startup development logs are event-only:
they do not include provider-supplied channel names or source URLs.

Shaka Player `5.2.2` errors cross a separate structured boundary before the
HTML5 or ArtPlayer DASH session emits a diagnostic. Version-locked tests assert
the installed Shaka version plus the public `Severity`, `Category`, and selected
online-playback `Code` values used by the boundary. Evidence retains only
validated severity/category/code, the lifecycle disposition, an exact
code-derived stage and failure kind, and a validated HTTP status. A direct
`Network.BAD_HTTP_STATUS` may expose `data[1]` as the status; the same status is
accepted from the documented nested networking error for
`Drm.LICENSE_REQUEST_FAILED` and
`Drm.SERVER_CERTIFICATE_REQUEST_FAILED`. No other `error.data` value is read.

A recoverable Shaka `error` event does not become a terminal playback
diagnostic because the engine continues its retry/recovery lifecycle. A
critical event is terminal. A rejected `Player.load()` is also terminal even
when its last networking error still carries recoverable severity, because the
load lifecycle has ended; the structured evidence preserves both facts as
`severity=recoverable` and `disposition=terminal`. Unknown event severity does
not prove terminal failure and is ignored. Exact public code/category pairs may
classify network, DRM/encryption, manifest/parsing, or media/decode failures.
Ambiguous evidence stays `unknown-playback-error`: in particular, the Manifest
category alone is not container incompatibility, and Shaka messages never infer
CORS, codec, DRM, container, or stage. The public critical
`STREAMING_ENGINE_STARTUP_INVALID_STATE` code remains exact evidence while its
stage and failure stay unknown because the code does not identify a user-facing
media cause. Public DASH text-parser codes are also retained exactly; their
`TEXT` category proves the parser subsystem, but not a safe manifest, segment,
or media cause, so stage and failure remain unknown.

A failed public `Player.isBrowserSupported()` preflight is not a Shaka error
and therefore retains fully unknown technical evidence instead of being
mislabelled as an unsupported container. Clear DASH can still rank configured
MPV/VLC actions when the structured diagnostic and runtime capabilities permit
them. KODIPROP DRM sources never rank external players because the external
launch contract does not transfer their key configuration.

Shaka messages, URLs, headers, request/response bodies, credentials,
license/key payloads, and arbitrary `error.data` objects are neither retained
nor rendered. Technical details show only sanitized stage, failure, severity,
category, code, disposition, and optional HTTP status. Unsupported playlist
DRM uses a fixed safe description rather than echoing provider license
configuration.

`network-error` is reserved for provider/network loading failures. Engines that expose concrete browser security evidence, such as CORS, mixed content, Content Security Policy, or private-network-access blocks, use `browser-access-error` so the UI can explain that the browser player was blocked before playback reached decoding.

mpegts.js `1.8.0` errors cross one shared structured boundary before the HTML5,
Video.js, or ArtPlayer owner emits a diagnostic. Version-locked tests compare
the installed public `ErrorTypes` and `ErrorDetails` exports with the accepted
contract. Evidence retains only an exact type/detail pair, terminal
disposition, a pair-derived stage and failure, and a validated HTTP 4xx/5xx
status from the top-level `info.code` slot of
`NetworkError + HttpStatusCodeInvalid`.

Exact public pairs classify HTTP/timeout/exception as network failures,
`FormatUnsupported` as an unsupported container, `CodecUnsupported` as an
unsupported codec, and `FormatError`/`MediaMSEError` as media failures.
`UnrecoverableEarlyEof` remains a `media-decode-error` that may rank a distinct
engine or external player:
mpegts.js has already exhausted its internal finite-source early-EOF recovery,
and another demuxer may tolerate the truncated transport stream. Mismatched or
unknown pairs fail closed to `unknown-playback-error`.

Arbitrary `info`, messages, URLs, headers, bodies, credentials, and provider
objects are neither retained nor rendered. A generic `Exception` does not
prove CORS, mixed content, CSP, or private-network access, so mpegts.js no
longer creates `browser-access-error` from message text. HTTP and other network
failures do not claim an external decoder will fix the provider response;
container, codec, truncated-stream, format, and MediaSource failures retain
evidence that can rank an explicit MPV/VLC action when the payload and runtime
permit it.

The diagnostic surface covers the inline player viewport when playback fails,
with a compact warning badge, one primary recommendation, at most two secondary
recommendations, and always-available Copy URL and Technical details utilities.
An alternative-source recommendation consumes one of those three slots even
when its bounded source list renders several rows. Technical details contain
the diagnostic code, reporting player/source, detected container/MIME,
video/audio codecs, native browser error fields, and sanitized structured
Video.js/VHS, HLS, Shaka, and mpegts.js evidence. HLS manifest codec metadata
also drives a concise browser-support hint for codecs that Chromium/Electron
commonly cannot decode inline, such as HEVC, AC-3, E-AC-3, DTS, and MPEG-2
video.

URL extension metadata is filtered before diagnostics and player selection use it. Web script extensions such as `.php` are not shown as stream containers; explicit media query metadata such as `extension=ts` or `format=m3u8` is preferred when present.

MKV sources are attempted through Chromium's native Matroska path. Video.js
receives `video/matroska` for `.mkv` URLs and explicit query metadata such as
`extension=mkv` or `container=mkv`; ArtPlayer and HTML5 continue to use their
native video paths. This is container support rather than a universal codec
guarantee: native source or decode failures still produce a diagnostic whose
ranked actions may include MPV/VLC.

Portal VOD and episode payloads with `contentInfo` are treated as non-live by the inline players unless `isLive` is explicitly set. If Chromium leaves the underlying MediaSource duration at `Infinity` for a finite TS VOD, the Video.js wrapper normalizes its UI duration from the finite `seekable` or `buffered` range. Embedded MPV uses the same live decision rule and shows an unknown duration placeholder for VOD/episode snapshots until MPV reports a finite duration. This removes the misleading `LIVE` control state without changing stream decoding, diagnostics, or external fallback behavior.

## Recovery Recommendation Policy

Recommendations change playback paths only when structured evidence supports
that conclusion. A different skin over the same engine family is not a distinct
recovery target.

| Source path                              | Active engine family            | Distinct built-in recommendation |
| ---------------------------------------- | ------------------------------- | -------------------------------- |
| HLS in Video.js                          | Video.js/VHS                    | HTML5 through hls.js             |
| HLS in HTML5 or ArtPlayer                | hls.js                          | Video.js/VHS                     |
| MPEG-TS in any web player                | shared mpegts.js                | None                             |
| DASH in HTML5 or ArtPlayer               | Shaka                           | None                             |
| DASH in Video.js                         | unsupported recommendation path | None                             |
| Native media/container in any web player | browser native-media            | None                             |

HTML5 is the canonical hls.js alternative to Video.js/VHS; ArtPlayer is not a
second independent hls.js choice. MPEG-TS, DASH/Shaka, and native media never
offer a same-family built-in alternative. Unknown source or engine-family facts
also suppress built-in recommendations.

The pure policy builds the following order, filters the current, unavailable,
incompatible, and already attempted targets, and then returns at most three
actions. The first surviving action is primary and later actions are secondary.

| Sanitized evidence                        | Candidate order                                              |
| ----------------------------------------- | ------------------------------------------------------------ |
| HTTP, timeout, or generic network failure | Retry -> Alternative source                                  |
| Unknown playback error                    | Retry -> Alternative source                                  |
| Browser access/CORS/CSP-class failure     | MPV -> VLC -> Alternative source                             |
| Unsupported codec or container            | MPV -> VLC -> Alternative source                             |
| Media/decode/engine processing failure    | Distinct built-in family -> MPV -> VLC -> Alternative source |
| DRM/encryption failure                    | Compatible built-in path -> Alternative source -> MPV -> VLC |

Network and unknown evidence fail closed: they never claim that changing a
decoder will repair the provider response. Contradictory or incomplete
capability facts fail closed to Retry and an available alternative source.
External targets require both managed external-player support and a transferable
payload. PWA builds therefore never rank MPV/VLC. Any ClearKey/KODIPROP DRM
payload is non-transferable and suppresses both external targets; the policy
does not infer transferability from a message or URL. Eligible Electron portal
fallback requests keep using the original `ResolvedPortalPlayback`, so the
existing host path can forward its required headers and playback metadata.

## Recovery Session Lifecycle And Privacy

Each mounted `WebPlayerViewComponent` owns one in-memory recovery session for
its required `playbackSessionKey`. Retry and an alternative source for the same
logical content keep the key and attempted-target set. A different channel,
movie, or exact episode changes the key and synchronously clears the diagnostic,
attempts, temporary player override, and handoff position. Destroying the
component also ends the session; the same key in a later component is a new
session.

On a terminal failure, the current binding is accepted only when both its
generation and inline target still match. The current target becomes attempted,
the sanitized diagnostic is stored, and recommendations are reranked. The
`PlaybackBinding` contains exactly `{ generation, target }`. Changes to the
playback URL, headers, DRM, live/VOD mode, target, or reload generation are
instead correlated with a fieldless opaque `Symbol` application token. Neither
object embeds source material, and recovery ownership state never stores URLs,
headers, DRM keys, error payloads, or credentials.

Selecting a built-in recommendation records the target, clears the diagnostic,
and installs a temporary local override ahead of the host override and saved
player setting. The new engine receives the latest finite VOD position as a
best-effort resume point; live playback starts at the live edge. Retry reloads
the active target without clearing attempts. Selecting MPV or VLC records the
external target before emitting the existing fallback request. The system does
not infer whether the external process ultimately played the stream.

No recommendation mutates `Settings.player` or another persisted setting.
Recovery recommendations never auto-switch a player or source and do not
replace the separate source-owner auto-failover feature. Attempts, overrides,
resume handoff, and diagnostics are session-local: there is no persistent
history, cross-session learning, correlation, or telemetry.

Only allowlisted public engine evidence crosses the structured sanitizers.
Provider/engine messages, request and response objects, arbitrary `error.data`
or `info`, bodies, URLs copied from error payloads, headers, DRM material, and
credentials do not enter recommendation evidence or recovery ownership state.
The active playback URL remains available only through the pre-existing
playback metadata needed by Retry, Copy URL, and eligible explicit
external-player actions.

`PortalPlayer.openExternalPlayback(playback, player)` remains the forced
external launch API. It sends the resolved playback payload to MPV or VLC
regardless of the current saved player setting, so a recommendation never
mutates preferences.

## External Player Arguments

Electron settings expose optional MPV and VLC command-line argument fields only
when the corresponding external player is selected. The executable path remains a
path-only setting; extra flags are stored separately as `mpvPlayerArguments` and
`vlcPlayerArguments`.

Argument fields are line-oriented: one non-empty trimmed line becomes one argv
entry. IPTVnator prepends those custom entries before its stream-specific runtime
arguments, then keeps the stream URL last. This avoids shell parsing, keeps paths
with spaces safe, and preserves existing settings for users who never configured
extra arguments.

The arguments apply only when IPTVnator spawns a new external player process. If
MPV or VLC instance reuse is active and an existing process is reused, subsequent
streams are loaded through MPV IPC or VLC RC commands and new process arguments
are not re-applied until a fresh process starts.

## Electron External Player Ownership

External MPV/VLC integration is split across focused main-process modules:

- `apps/electron-backend/src/app/events/player.events.ts` registers IPC handlers
  and settings updates only.
- `apps/electron-backend/src/app/events/external-player-launch-context.ts`
  resolves Flatpak spawning, default executable paths, macOS `.app` bundles,
  custom argv merging, spawn specs, and reuse decisions.
- `apps/electron-backend/src/app/events/external-player-playback-request.ts`
  builds the effective playback request, including Stalker direct-stream fallback
  metadata and external-player request headers.
- `apps/electron-backend/src/app/events/external-player-runtime.ts` owns shared
  session tracking, trace logging, renderer notifications, playback-position
  forwarding, and user-facing start errors.
- `apps/electron-backend/src/app/events/mpv-session.service.ts` owns MPV process,
  socket, reuse, cleanup, and progress polling lifecycle.
- `apps/electron-backend/src/app/events/vlc-session.service.ts` owns VLC process,
  RC interface, reuse, cleanup, command parsing, and progress polling lifecycle.

Keep player-specific process state in the MPV/VLC session modules. Shared spawn,
request-header, session-registry, and notification helpers belong in the
`external-player-*` modules so IPC registration stays small and reviewable.

## Flatpak External Players

Flatpak cannot execute host-installed `mpv` or `vlc` binaries directly from the sandbox.

Current contract:

- Flatpak launches external players through `flatpak-spawn --host`.
- AppImage, deb/rpm, snap, macOS, and Windows keep the existing direct process spawn flow.
- VLC keeps the current external-session flow in Flatpak, including the RC port used for progress polling.
- MPV is intentionally reduced in Flatpak: the app does not reuse an existing MPV instance there and does not open the Unix socket bridge used for non-Flatpak progress polling.
- VLC instance reuse is also gated off in Flatpak. Outside Flatpak the user can opt in via the "Reuse VLC instance" setting; the app then keeps a single tracked VLC process and drives subsequent stream loads through its RC interface (`clear` + `add <url> :http-*`) instead of spawning a new window per click.

This keeps non-Flatpak behavior unchanged while allowing Flatpak builds to open host-installed external players.

## Typed Playback Payload

Shared playback payloads live in:

- `/Users/4gray/Code/iptvnator/libs/shared/interfaces/src/lib/portal-playback.interface.ts`

Types introduced:

- `PlayerContentInfo`
- `ResolvedPortalPlayback`

These provide a single shape for:

- `streamUrl`
- `title`
- optional thumbnail and resume start time
- playback-position metadata
- optional external-player headers and request metadata

## Xtream Behavior

Xtream detail views already own canonical routes, so they construct playback locally and decide inline vs external locally.

Behavior to preserve:

- resume/playback position continues saving from `timeUpdate`
- back navigation clears inline playback with the route
- favorites, recent, and search still route into canonical Xtream detail screens before playback

## Stalker Behavior

Stalker previously resolved playback and opened UI in the same method.

Current contract:

- `resolveVodPlayback(...)` returns a `ResolvedPortalPlayback`
- `createLinkToPlayVod(...)` remains as a compatibility API but collection,
  search, and canonical detail views use the resolver directly
- Stalker detail, collection, and search views decide inline vs external locally

This keeps:

- inline/store-state detail navigation intact
- series and VOD-as-series support intact
- external MPV/VLC launches unchanged

## Playback Position Saving

The old dialog path saved playback positions from inside the removed Xtream
player dialog.

The new contract is:

- inline detail hosts listen to `timeUpdate`
- each host throttles saves
- each host persists via existing playback-position infrastructure

This avoids coupling inline UI state to a global dialog.

## Future Migration Rule

If a non-detail surface needs embedded playback:

- give that surface a canonical inline host
- switch it to `ResolvedPortalPlayback`
- do not move portal-specific navigation into `PlayerService`

The preferred direction is view-owned inline playback, not a larger dialog manager.
