# HTML5 Shared Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the useful HTML5 portion of #1152 so the built-in `<video>` player can use shared controls behind the existing default-off feature flag, with correct live/VOD metadata, track lifecycle, diagnostics gating, and cleanup.

**Architecture:** A player-local `HtmlVideoPlayerControlsBridge` owns HLS/native track projection, MPEG-TS VOD duration correction, caption preference, and adapter lifecycle. `HtmlVideoPlayerComponent` owns playback engines and chooses native versus shared chrome from `WEB_PLAYER_SHARED_CONTROLS`; `WebPlayerViewComponent` supplies authoritative playback metadata and interaction availability.

**Tech Stack:** Angular standalone components and signals, hls.js 1.6, mpegts.js, DOM media/text-track APIs, Jest/TestBed, Nx.

---

### Task 1: Add the HTML5 engine-to-controls bridge

**Files:**

- Create: `libs/ui/playback/src/lib/html-video-player/html-video-player-controls.bridge.ts`
- Create: `libs/ui/playback/src/lib/html-video-player/html-video-player-hls-controls.ts`
- Create: `libs/ui/playback/src/lib/html-video-player/html-video-player-native-text-tracks.ts`
- Create: focused `html-video-player-controls.*.spec.ts` suites and
  `html-video-player-controls.spec-fixtures.ts`
- Modify: `libs/ui/playback/tsconfig.lib.json` to exclude test-only fixture
  modules from the production TypeScript program

- [x] **Step 1: Write failing MPEG-TS duration tests**

Create a video fixture whose `duration`, `seekable`, and `buffered` properties
can be replaced. Cover:

```ts
expect(readState({ duration: 120, seekableEnd: 115 }).durationSeconds).toBe(
    120
);
expect(
    readState({ duration: Infinity, seekableEnd: 115 }).durationSeconds
).toBe(115);
expect(
    readState({
        duration: Infinity,
        seekableEnd: NaN,
        bufferedEnd: 112,
    }).durationSeconds
).toBe(112);
expect(
    readState({
        duration: Infinity,
        seekableThrows: true,
        bufferedThrows: true,
    }).durationSeconds
).toBeNull();
```

Assert all cases remain `isLive: false`, and that `canSeek` is false until a
seekable range exists.

- [x] **Step 2: Run the focused test and verify the red state**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns=html-video-player-controls.bridge
```

Expected: failure because `HtmlVideoPlayerControlsBridge` does not exist.

- [x] **Step 3: Add the bridge lifecycle and corrected-duration source**

Define:

```ts
export type HtmlVideoControlsSource =
    | { kind: 'native' }
    | { kind: 'mpegts' }
    | { kind: 'hls'; hls: Hls };

export interface HtmlVideoPlayerControlsBridgeConfig {
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}
```

Implement an exported class with:

```ts
attach(): void;
setSource(source: HtmlVideoControlsSource): void;
refreshInputs(): void;
clearSource(): void;
destroy(): void;
```

`attach()` must be idempotent and call:

```ts
this.adapter.attach(this.video, {
    isLive: this.isLive,
    getDuration: () => this.readDuration(),
    getAudioTracks: () => this.getAudioTracks(),
    setAudioTrack: (id) => this.setAudioTrack(id),
    getSubtitleTracks: () => this.getSubtitleTracks(),
    setSubtitleTrack: (id) => this.setSubtitleTrack(id),
});
```

For non-live mpegts sources, `readDuration()` must return the first finite,
positive value from the video duration, last seekable end, then last buffered
end. For every other source return `NaN`, allowing the adapter to read the
native element duration.

- [x] **Step 4: Write failing HLS projection and lifecycle tests**

Use a fake HLS object with stable `on`/`off` spies and mutable:

```ts
audioTracks;
audioTrack;
subtitleTracks;
subtitleTrack;
subtitleDisplay;
```

Cover:

- audio IDs are current-list indices and selection follows `audioTrack`;
- subtitle selection requires both `subtitleDisplay` and matching index;
- labels prefer `name`, then `lang`, then `Audio N` / `Subtitle N`;
- valid audio/subtitle choices update HLS;
- subtitle `-1` disables display and selection;
- non-integer, stale, and out-of-range IDs are no-ops;
- adapter refresh occurs for `AUDIO_TRACKS_UPDATED`,
  `AUDIO_TRACK_SWITCHING`, `AUDIO_TRACK_SWITCHED`,
  `SUBTITLE_TRACKS_UPDATED`, `SUBTITLE_TRACKS_CLEARED`,
  `SUBTITLE_TRACK_SWITCH`, and `MANIFEST_LOADING`;
- rebinding unregisters the exact old callback references before the old HLS
  instance can be destroyed.

- [x] **Step 5: Implement HLS track mapping and listeners**

Use current-list indices:

```ts
return hls.audioTracks.map((track, index) => ({
    id: index,
    label: track.name || track.lang || `Audio ${index + 1}`,
    selected: index === hls.audioTrack,
}));
```

Use the corresponding subtitle projection:

```ts
selected: hls.subtitleDisplay === true && index === hls.subtitleTrack;
```

Register one named refresh callback per bridge/source and unregister it with
the same function reference. Do not call `hls.off(event)` without a listener.

- [x] **Step 6: Write failing native text-track and preference tests**

Provide a fake `TextTrackList` implementing indexed access and
`addEventListener`/`removeEventListener`. Cover:

- only `captions` and `subtitles` tracks are projected;
- labels prefer `label`, then `language`, then `Subtitle N`;
- IDs remain stable when an earlier track is removed;
- selecting a valid ID shows it and hides other eligible tracks;
- selecting `-1` hides all eligible tracks;
- invalid/stale IDs are no-ops;
- `addtrack`, `removetrack`, and `change` refresh the adapter;
- `showCaptions = false` suppresses a default track arriving later;
- without a user override, returning the preference to true restores the
  engine/default showing state that was suppressed;
- explicit selection and explicit off survive later track events and
  `refreshInputs()` calls;
- source replacement clears the override and resets per-source IDs; and
- destroy removes all listeners and detaches the adapter exactly once even
  when called twice.

- [x] **Step 7: Implement native tracks, caption preference, and cleanup**

Use per-source maps:

```ts
private nativeTrackIds = new WeakMap<TextTrack, number>();
private suppressedNativeModes = new WeakMap<TextTrack, TextTrackMode>();
private nextNativeTrackId = 0;
private subtitleOverride: number | null = null;
```

On preference suppression, remember a track's original mode only once and
hide any showing caption/subtitle. When preference returns to true and no
explicit override exists, restore remembered modes. Track selection sets the
override before changing modes. `clearSource()` resets all per-source maps and
the override, removes listeners, clears the active source, and refreshes the
adapter. `destroy()` calls `clearSource()` and `adapter.detach()` once.

- [x] **Step 8: Run bridge tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns=html-video-player-controls.bridge
```

Expected: all bridge tests pass.

- [x] **Step 9: Commit the bridge**

```bash
git add \
  libs/ui/playback/src/lib/html-video-player/html-video-player-controls.bridge.ts \
  libs/ui/playback/src/lib/html-video-player/html-video-player-controls.bridge.spec.ts
git commit -m "feat(html-player): bridge engine state to shared controls"
```

### Task 2: Mount shared controls in the HTML5 player

**Files:**

- Modify: `libs/ui/playback/src/lib/html-video-player/html-video-player.component.ts`
- Modify: `libs/ui/playback/src/lib/html-video-player/html-video-player.component.html`
- Create: focused `html-video-player.component.shared-controls*.spec.ts` suites
  and `html-video-player.component.shared-controls.spec-fixtures.ts`
- Modify: `libs/ui/playback/src/lib/html-video-player/html-video-player.component.spec.ts`

- [x] **Step 1: Write failing feature-flag selection tests**

In the default-off suite assert:

```ts
expect(video.controls).toBe(true);
expect(query(By.directive(PlayerControlsComponent))).toBeNull();
expect(queryLegacySeriesControls()).not.toBeNull();
expect(adapter.attach).not.toHaveBeenCalled();
```

In a dedicated flag-on suite override:

```ts
{ provide: WEB_PLAYER_SHARED_CONTROLS, useValue: true }
```

and assert one shared-controls instance, `video.controls === false`, and no
legacy series-controls instance.

- [x] **Step 2: Write failing surface, interaction, and context tests**

For the shared-controls instance assert:

```ts
expect(playerControls.playerSurface()).toBe(
    fixture.debugElement.query(By.css('.html-video-player-shell')).nativeElement
);
expect(playerControls.showControls()).toBe(false);
expect(playerControls.shortcutsEnabled()).toBe(false);
```

after setting `interactionEnabled = false`. Change `seriesNavigation` after
initial render and assert the adapter state/capabilities reflect the new value.

- [x] **Step 3: Verify the component tests fail**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns='html-video-player.component'
```

Expected: failures because the HTML5 component does not yet import shared
controls or expose the new inputs.

- [x] **Step 4: Add feature-flagged template ownership**

Import and provide:

```ts
(PlayerControlsComponent, WEB_PLAYER_SHARED_CONTROLS, WebVideoControlsAdapter);
```

Add:

```ts
readonly sharedControls = inject(WEB_PLAYER_SHARED_CONTROLS);
readonly controlsAdapter = inject(WebVideoControlsAdapter);
private readonly seriesNavigationSignal =
    signal<SeriesPlaybackNavigation | null>(null);

@Input() isLive = true;
@Input() interactionEnabled = true;
```

Use the actual shell as the template surface:

```html
<div #playerRoot class="html-video-player-shell">
    <video
        #videoPlayer
        id="video-player"
        autoplay
        [controls]="!sharedControls"
    ></video>

    @if (sharedControls) {
    <app-player-controls
        [controller]="controlsAdapter"
        [playerSurface]="playerRoot"
        [showControls]="interactionEnabled"
        [shortcutsEnabled]="interactionEnabled"
        (previousEpisodeRequested)="previousEpisodeRequested.emit()"
        (nextEpisodeRequested)="nextEpisodeRequested.emit()"
    />
    } @else {
    <app-series-playback-navigation-controls
        [navigation]="seriesNavigation"
        (previousEpisodeRequested)="previousEpisodeRequested.emit()"
        (nextEpisodeRequested)="nextEpisodeRequested.emit()"
    />
    }
</div>
```

- [x] **Step 5: Write failing source-order and mpegts metadata tests**

Cover the Angular initial order where `ngOnChanges` starts a source before
`ngOnInit` creates the bridge. Assert that the retained HLS source is bound
after initialization.

For a raw TS channel assert:

```ts
expect(mpegts.createPlayer).toHaveBeenCalledWith({
    type: 'mpegts',
    isLive: false,
    url: expect.any(String),
});
```

when the input is VOD. Replace HLS with native playback and assert old HLS
listeners are removed before `destroy()`.

- [x] **Step 6: Integrate bridge and source lifecycle**

Make `hls` nullable and retain:

```ts
private controlsBridge: HtmlVideoPlayerControlsBridge | null = null;
private controlsSource: HtmlVideoControlsSource | null = null;
```

In `ngOnInit`, only for the enabled flag:

```ts
this.controlsAdapter.setContext({
    seriesNavigation: this.seriesNavigationSignal,
});
this.controlsBridge = new HtmlVideoPlayerControlsBridge({
    video: this.videoPlayer.nativeElement,
    adapter: this.controlsAdapter,
    isLive: () => this.isLive,
    showCaptions: () => this.showCaptions,
});
this.controlsBridge.attach();
if (this.controlsSource) {
    this.controlsBridge.setSource(this.controlsSource);
}
```

At the start of every source replacement:

```ts
this.controlsBridge?.clearSource();
this.controlsSource = null;
```

Then tear down old mpegts/HLS engines. After creating a new engine, assign and
bind exactly one source:

```ts
this.controlsSource = { kind: 'hls', hls: this.hls };
this.controlsBridge?.setSource(this.controlsSource);
```

Use `{ kind: 'mpegts' }` or `{ kind: 'native' }` for the other paths. Pass
`this.isLive` into `mpegts.createPlayer`.

In `ngOnChanges`, update the series signal and call `refreshInputs()` when
`isLive` or `showCaptions` changes. Keep the existing flag-off
`handlePlayOperation()` caption behavior unchanged.

- [x] **Step 7: Make destruction idempotent and ordered**

Destroy the controls bridge before destroying the HLS instance so listener
removal is observable and deterministic:

```ts
this.controlsBridge?.destroy();
this.controlsBridge = null;
this.controlsSource = null;
```

Then perform existing mpegts/HLS teardown and set the engine fields to null.

- [x] **Step 8: Run HTML5 component and bridge tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns='html-video-player'
```

Expected: all HTML5 suites pass in both flag states.

- [x] **Step 9: Commit the host integration**

```bash
git add libs/ui/playback/src/lib/html-video-player/
git commit -m "feat(html-player): add feature-flagged shared controls"
```

### Task 3: Supply playback metadata and diagnostic interaction gating

**Files:**

- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.html`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`
- Create:
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.shared-controls.spec.ts`

- [x] **Step 1: Extend the HTML5 test stub and write failing metadata tests**

Add stub inputs:

```ts
readonly isLive = input(true);
readonly interactionEnabled = input(true);
```

Cover:

```ts
{ isLive: false }                         // explicit VOD wins
{ isLive: true, contentInfo: vodInfo }    // explicit live wins
{ contentInfo: vodInfo }                  // inferred VOD
{}                                        // inferred live
```

Select the HTML5 player and assert the stub receives the resolved value.

- [x] **Step 2: Write failing diagnostic interaction tests**

Select HTML5, emit a playback issue, and assert:

```ts
expect(htmlPlayer.interactionEnabled()).toBe(false);
```

Call `retryPlayback()` and assert it becomes true. Also call
`handlePlaybackIssue(null)` after a new issue and assert interactions are
re-enabled.

- [x] **Step 3: Verify web-player-view tests fail**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns=web-player-view.component
```

Expected: failures because the HTML5 inputs and public computed values do not
exist.

- [x] **Step 4: Add shared authoritative computed values**

Replace the private duplicated classification helper with:

```ts
readonly resolvedIsLive = computed(() => {
    const playback = this.resolvedPlayback();
    return typeof playback.isLive === 'boolean'
        ? playback.isLive
        : !playback.contentInfo;
});

readonly playbackInteractionEnabled = computed(
    () => this.visiblePlaybackDiagnostic() === null
);
```

Read `resolvedIsLive()` inside the constructor effect and use it for
`setVjsOptions`. Use it again in `retryPlayback()`.

- [x] **Step 5: Pass values to HTML5**

Add:

```html
[isLive]="resolvedIsLive()" [interactionEnabled]="playbackInteractionEnabled()"
```

to the `app-html-video-player` branch.

- [x] **Step 6: Run focused view and HTML5 tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns='web-player-view.component|html-video-player'
```

Expected: all selected suites pass.

- [x] **Step 7: Commit metadata and gating**

```bash
git add \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.html \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
git commit -m "feat(html-player): use authoritative playback metadata"
```

### Task 4: Document and validate the HTML5 consumer

**Files:**

- Modify: `docs/architecture/player-controls-contract.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Add: `docs/superpowers/specs/2026-07-16-html5-shared-controls-design.md`
- Add: `docs/superpowers/plans/2026-07-16-html5-shared-controls.md`

- [x] **Step 1: Update canonical player-controls documentation**

Document:

- HTML5 is the second shared-controls consumer, behind the default-off web
  feature flag;
- the player-local bridge owns HLS/native tracks and MPEG-TS duration;
- live/VOD state comes from resolved playback metadata;
- diagnostics disable shared pointer and keyboard ownership; and
- Video.js/ArtPlayer remain future migrations.

- [x] **Step 2: Mirror the ownership contract**

Update the shared-player-controls sections in `AGENTS.md` and `CLAUDE.md` with
the same behavior and key file paths. Keep the mirrored process text
consistent.

- [x] **Step 3: Run the complete validation ladder**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand
pnpm nx lint ui-playback --skip-nx-cache
pnpm run typecheck:ci
pnpm run i18n:check
pnpm exec prettier --check \
  libs/ui/playback/src/lib/html-video-player \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.html \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts \
  docs/architecture/player-controls-contract.md \
  docs/superpowers/specs/2026-07-16-html5-shared-controls-design.md \
  docs/superpowers/plans/2026-07-16-html5-shared-controls.md \
  AGENTS.md CLAUDE.md
git diff --check
```

Expected: every command exits successfully.

- [x] **Step 4: Perform the test-impact pass**

Record that:

- `ui-playback` unit tests cover the flag switch, track lifecycle, metadata,
  diagnostics, and cleanup;
- no new runtime behavior is enabled by default;
- broad Electron E2E is deferred to PR CI because the shared-controls flag is
  compile-time default-off; and
- manual visual verification is required before enabling the flag globally,
  not before merging this guarded integration.

Recorded on 2026-07-16:

- `ui-playback`: 51 suites and 491 tests passed;
- `ui-playback` lint, repository web/backend typecheck, i18n drift check,
  Prettier, and `git diff --check` passed;
- no E2E suite was added because the compile-time rollout flag remains
  default-off and the existing runtime workflow is unchanged; and
- visual/manual playback verification remains a prerequisite for changing the
  rollout default, not for merging this guarded consumer.

- [ ] **Step 5: Commit docs and final validation fixes**

```bash
git add \
  docs/architecture/player-controls-contract.md \
  docs/superpowers/specs/2026-07-16-html5-shared-controls-design.md \
  docs/superpowers/plans/2026-07-16-html5-shared-controls.md \
  AGENTS.md CLAUDE.md
git commit -m "docs(player-controls): describe HTML5 shared-controls bridge"
```

- [ ] **Step 6: Review the complete branch**

Run a spec-compliance review followed by a code-quality review against
`origin/master...HEAD`. Resolve every important finding, rerun affected tests,
then request GitHub Codex and Greptile reviews after opening the fresh PR.
