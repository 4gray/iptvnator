# HTML5 Shared Controls Design

## Status

Implemented and branch-validated as part of the
embedded-MPV/shared-controls merge plan. This rebuilds the unique HTML5
integration proposed in #1152 on top of the merged shared-controls contract and
frame-copy implementation, without merging the obsolete stacked history from
#1150/#1151. The guarded integration is pending pull-request review and merge;
the rollout default remains off.

## Goal

Use `app-player-controls` as the optional controls UI for the built-in HTML5
player while preserving its current native controls and behavior when
`WEB_PLAYER_SHARED_CONTROLS` is disabled.

## Non-goals

- Do not enable `WEB_PLAYER_SHARED_CONTROLS` by default.
- Do not change the generic `PlayerController` or
  `WebVideoControlsAdapter` contracts.
- Do not infer live/VOD state from `HTMLVideoElement.duration`.
- Do not migrate Video.js or ArtPlayer in this PR.
- Do not redesign playback diagnostics or replace their existing banner.
- Do not add engine-specific knowledge to the generic shared-controls adapter.

## Why the old #1152 commit is not merged directly

The old commit correctly identified the HTML5 `<video>` element as a natural
consumer of `WebVideoControlsAdapter`, but its implementation predates the
current playback metadata, diagnostic overlay, MPEG-TS VOD handling, and
track-lifecycle requirements. In particular, it:

- classified live playback from `video.duration`;
- attached only a bare video adapter with no HLS/native track bridge;
- did not cleanly rebind engine listeners on source replacement;
- did not disable interactions while playback diagnostics own the UI; and
- used the custom-element host instead of the actual player shell as the
  fullscreen and pointer surface.

The new implementation keeps the useful feature-flagged UI switch while
rebuilding its lifecycle against the current architecture.

## Architecture

### Authoritative playback classification

`WebPlayerViewComponent` exposes one `resolvedIsLive` computed value:

1. an explicit `ResolvedPortalPlayback.isLive` value wins;
2. otherwise playback with `contentInfo` is VOD; and
3. playback without `contentInfo` is live.

The same value configures Video.js and is passed to
`HtmlVideoPlayerComponent`. The HTML5 player passes it to mpegts.js and to the
shared-controls adapter. Media duration is never used to decide whether a
source is live.

### HTML5 controls bridge

Add a player-local `HtmlVideoPlayerControlsBridge`. It owns all glue between
the engine-specific source lifecycle and the engine-agnostic
`WebVideoControlsAdapter`:

```ts
type HtmlVideoControlsSource =
    | { kind: 'native' }
    | { kind: 'mpegts' }
    | { kind: 'hls'; hls: Hls };

interface HtmlVideoPlayerControlsBridgeConfig {
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}
```

The bridge:

- attaches the adapter once;
- supplies authoritative live/VOD and corrected duration accessors;
- projects HLS audio and subtitle tracks into shared `PlayerTrack` values;
- projects native text tracks for native and mpegts.js sources;
- refreshes the adapter when engine track state changes;
- applies caption preference until the user makes an explicit per-source
  subtitle choice;
- removes listeners before an HLS instance is destroyed; and
- supports idempotent source clearing and destruction.

The implementation keeps the bridge focused by delegating HLS projection and
caption policy to `HtmlVideoPlayerHlsControls`, and native text-track identity
and policy to `HtmlVideoPlayerNativeTextTracks`.

`HtmlVideoPlayerComponent` remains responsible for creating and destroying
native, HLS, and mpegts.js playback engines. Before replacing a source it asks
the bridge to clear the current source, then tears down the old engine. Once
the new engine exists it binds the corresponding source to the bridge.

Angular calls the initial `ngOnChanges` before `ngOnInit`, so the component
retains the current controls source even when playback starts before the bridge
is created. `ngOnInit` creates the bridge, attaches the adapter, and binds that
retained source.

### MPEG-TS VOD duration

Raw MPEG-TS VOD can leave `video.duration` at `Infinity`. For a non-live
mpegts.js source, the corrected duration accessor uses the first finite,
positive value from:

1. `video.duration`;
2. the last finite, positive `video.seekable.end(index)` value; and
3. the last finite, positive `video.buffered.end(index)` value.

Ranges are scanned from the end and accessor failures are ignored. If no
duration is known, the accessor returns `NaN`. The adapter still classifies the
source as VOD, but disables seeking until a positive duration and seekable
range are available.

### HLS tracks

Shared track IDs are HLS list indices because the hls.js setters accept list
indices.

Audio tracks:

- map `hls.audioTracks`;
- select the item whose index equals `hls.audioTrack`;
- label with `name`, then `lang`, then a translated-neutral numbered fallback;
- reject non-integer and out-of-range selections; and
- refresh on `AUDIO_TRACKS_UPDATED`, `AUDIO_TRACK_SWITCHING`, and
  `AUDIO_TRACK_SWITCHED`.

Subtitle tracks:

- map `hls.subtitleTracks`;
- mark a track selected only when `hls.subtitleDisplay` is true and its index
  equals `hls.subtitleTrack`;
- selecting `-1` sets `subtitleTrack = -1` and disables
  `subtitleDisplay`;
- selecting a valid index enables `subtitleDisplay` and assigns the index;
- reject other invalid values; and
- refresh on `SUBTITLE_TRACKS_UPDATED`, `SUBTITLE_TRACKS_CLEARED`, and
  `SUBTITLE_TRACK_SWITCH`.

The bridge also refreshes on `MANIFEST_LOADING`, because the installed hls.js
version clears its internal audio/subtitle groups at manifest start without
emitting an audio-track-cleared event.

### Native text tracks

Native and mpegts.js sources expose `video.textTracks`. The bridge includes
only `subtitles` and `captions` tracks and assigns stable numeric IDs through a
per-source `WeakMap<TextTrack, number>`, so removals or reordering do not change
the identity of remaining tracks.

It listens for `addtrack`, `removetrack`, and `change`. Selecting a valid ID
sets that track to `showing` and hides other caption/subtitle tracks. Selecting
`-1` hides all of them. A stale or invalid ID is a no-op.

### Caption preference and user override

Each source starts without an explicit subtitle override:

- `showCaptions = false` actively hides default tracks, including tracks added
  after playback starts;
- `showCaptions = true` preserves the engine-selected/default state and does
  not arbitrarily select the first track. If the bridge previously suppressed
  that state while the preference was off, it restores the remembered engine
  modes when the preference returns to on.

Once the user selects a subtitle track or explicitly turns subtitles off, that
choice wins over later track events and settings emissions for the rest of the
source. Replacing or clearing the source resets the override.

The feature-flag-off path keeps the current post-play caption behavior
unchanged.

### Shared-controls host and interaction ownership

When `WEB_PLAYER_SHARED_CONTROLS` is enabled,
`HtmlVideoPlayerComponent`:

- removes the native video skin;
- renders exactly one `app-player-controls`;
- passes `.html-video-player-shell` as `playerSurface`;
- forwards series-navigation events; and
- uses a reactive signal for series-navigation context.

When the flag is disabled, the native video controls and existing standalone
series-navigation controls remain unchanged and the adapter is never attached.

`WebPlayerViewComponent` derives
`playbackInteractionEnabled = visiblePlaybackDiagnostic() === null` and passes
it to the HTML5 player. The HTML5 shared-controls instance binds both
`showControls` and `shortcutsEnabled` to that input. This hides the bar,
detaches click/double-click ownership, and disables shortcuts while the
diagnostic banner is active. Retrying or clearing the diagnostic re-enables
interactions. Because the diagnostic banner is outside the HTML5 fullscreen
shell, disabling interactions also exits fullscreen when that shell is the
current fullscreen owner; unrelated fullscreen elements are not affected.

## Error handling and cleanup

- Invalid or stale track selections are ignored.
- Track/range accessors tolerate transient browser exceptions.
- Old HLS listeners are removed before `hls.destroy()`.
- `clearSource()` and `destroy()` are idempotent.
- Destroying the component removes native media listeners, destroys active
  playback engines, removes text/HLS track listeners, and detaches the adapter.

## Testing

### Bridge unit coverage

- MPEG-TS duration priority, invalid ranges, and throwing range accessors;
- HLS audio/subtitle projection, selection, off state, and invalid IDs;
- HLS update/switch refresh;
- native text-track filtering, stable IDs, selection, and off state;
- native add/remove/change refresh;
- suppression of late default captions when the preference is off;
- preservation of explicit selection/off across later events and preference
  changes;
- source replacement resetting the override;
- old HLS listener removal on rebind; and
- listener/adapter cleanup with idempotent destroy.

### Component integration coverage

- flag on: one shared-controls instance, no native skin or legacy series
  controls;
- flag off: native skin and legacy series controls, no adapter attachment;
- the player shell is the interaction/fullscreen surface;
- the interaction input gates both shared-controls inputs;
- a diagnostic exits only the HTML5 player's own fullscreen shell;
- series-navigation context remains reactive;
- mpegts.js receives authoritative live/VOD metadata; and
- source replacement does not retain old HLS tracks/listeners.

### Web-player-view coverage

- explicit `isLive` wins;
- otherwise `contentInfo` means VOD and its absence means live;
- the resolved value reaches the HTML5 player;
- a visible diagnostic disables HTML5 shared interactions; and
- retrying or clearing the diagnostic re-enables them.

## Documentation impact

Update `docs/architecture/player-controls-contract.md`, `AGENTS.md`, and
`CLAUDE.md` to document the feature-flagged HTML5 consumer, authoritative
live/VOD metadata, engine track bridge, and diagnostic interaction gating.
The root README remains unchanged while the feature flag defaults to off.
