# Embedded Inline Playback

This document records the current contract for embedded playback in portal detail views.

## Summary

- Embedded web players are `videojs`, `html5`, and `artplayer`.
- `embedded-mpv` exists as a hidden macOS-only feasibility harness backed by a native `libmpv` addon.
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
- Browser-player failures are diagnosed client-side and can offer explicit MPV/VLC fallback actions without changing the saved player setting.

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

## Embedded MPV Harness

The repository now contains a first-pass native embedded MPV harness for Electron:

- shared setting id: `embedded-mpv`
- native addon owner: `/Users/4gray/Code/iptvnator/apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`
- IPC bridge: `/Users/4gray/Code/iptvnator/apps/electron-backend/src/app/events/embedded-mpv.events.ts`
- renderer host: `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.ts`
- native architecture and release-readiness details: `/Users/4gray/Code/iptvnator/docs/architecture/embedded-mpv-native.md`

Current contract:

- macOS only
- experimental opt-in
- enabled in local development only when `IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT=1`
- enabled in packaged macOS builds only when the bundled native addon and `vendored-lgpl` libmpv runtime load successfully
- uses IPTVnator-owned controls and `ResolvedPortalPlayback` payloads
- uses the libmpv render API on macOS and renders through an IPTVnator-owned native `NSView`
- defaults to libmpv's OpenGL render backend with `hwdec=auto-safe`
- keeps the previous software renderer as a debug fallback via `IPTVNATOR_EMBEDDED_MPV_RENDERER=sw`
- emits lightweight render diagnostics when `IPTVNATOR_TRACE_EMBEDDED_MPV=1` is set
- exposes an IPTVnator-owned fullscreen button that uses the renderer fullscreen API and resyncs the native MPV view bounds after fullscreen transitions
- auto-hides IPTVnator-owned controls while playback is active and restores them on pointer/focus interaction
- exposes audio-track metadata from MPV and switches tracks through the `aid` property without reloading the stream
- passes VOD/episode resume offsets to MPV through the `loadfile` options map; live catchup URLs are treated as already-positioned streams
- applies the initial volume during session creation and uses async libmpv control calls after startup
- VLC remains external-only

Current limitation:

- the current feasibility harness is still experimental and macOS-specific
- the original macOS `wid` embedding path produced audio with a black video surface inside Electron, so the harness now avoids foreign-window embedding on macOS
- the OpenGL render path avoids the old per-frame `CGImage` copy path, but it still needs broader interaction, resize, and packaging coverage
- startup deadlocks seen during early macOS playback bring-up are mitigated, but the feature is still kept behind the explicit experiment flag until more interaction and packaging coverage is proven
- because of that, the setting is auto-sanitized back to the default inline player unless support detection reports that the experimental runtime is available
- this follows the rollout gate: keep the native work in-tree, but do not leave it user-facing until playback, resize, focus, and packaging are stable

## Components

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

Diagnostics and fallback UI:

- `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts`
- `/Users/4gray/Code/iptvnator/libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`

## Playback Decision Rule

When a detail view starts playback:

1. Resolve or construct a typed playback payload.
2. Check the active player setting.
3. If the player is embedded, render the inline player inside the current detail view.
4. If the player is external, hand the same payload to `PlayerService` for MPV/VLC playback.

The detail or collection/search host owns inline state. `PlayerService` is not
an owner of embedded UI playback state.

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
- if no episode is in progress, play the first unwatched episode in season order
- if watched episodes end at a season boundary, play the first episode of the
  next loaded season
- if every loaded episode is watched, render a disabled completed state

The click path must continue through each detail host's normal episode playback
method so recent-item updates, inline/external player selection, resume offsets,
and playback-position saving keep the same behavior as manual episode clicks.

## Codec And Container Diagnostics

The shared `WebPlayerViewComponent` is the central browser-player viewport for M3U, Xtream, and Stalker inline playback. Video.js, HTML5, and ArtPlayer report native media errors, HLS.js errors, mpegts.js errors, and HLS manifest codec metadata into the shared diagnostics classifier.

The diagnostics remain client-only:

- no ffprobe or server-side probing
- no extra manifest fetch beyond the active player
- no automatic failover to an external player
- no embedded MPV macOS diagnostics

Supported diagnostic codes are:

- `unsupported-container`
- `unsupported-codec`
- `media-decode-error`
- `network-error`
- `drm-or-encryption`
- `unknown-playback-error`

When a diagnostic is actionable in Electron, the inline banner may offer `Open in MPV`, `Open in VLC`, and `Copy URL`. Web builds only expose copy/help text. MPV/VLC fallback requests carry the original `ResolvedPortalPlayback` payload so headers, referer, origin, user-agent, content metadata, and resume offset stay intact.

`PortalPlayer.openExternalPlayback(playback, player)` is the forced external launch API. It sends the playback payload to MPV or VLC regardless of the current saved player setting, so fallback buttons do not mutate preferences.

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
