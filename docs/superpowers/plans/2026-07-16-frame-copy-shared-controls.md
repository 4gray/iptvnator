# Frame-Copy Shared Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the shared player controls over embedded MPV's frame-copy canvas while preserving the native-view controls dock unchanged.

**Architecture:** A component-scoped `EmbeddedMpvControlsAdapter` maps `EmbeddedMpvSessionController` into the existing `PlayerController` contract. `EmbeddedMpvPlayerComponent` renders shared controls only for `support.engine === 'frame-copy'` and disables its legacy interaction handlers on that path.

**Tech Stack:** Angular standalone components, signals, ngx-translate, Jest/TestBed, Nx, Electron frame-copy playback.

---

### Task 1: Add the embedded-MPV controls adapter

**Files:**

- Create: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.ts`
- Create: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.spec.ts`
- Create: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.messages.spec.ts`

- [ ] **Step 1: Write failing state and command tests**

Cover a supported VOD session, live session, optional support capabilities,
audio/subtitle labels, series navigation, missing/unsupported/loading/error
states, and every `PlayerControlsCommands` method.

Use a fake controller with writable signals:

```ts
const controller = {
    support: signal<EmbeddedMpvSupport | null>(supported()),
    session: signal<EmbeddedMpvSession | null>(baseSession()),
    stalled: signal(false),
    togglePaused: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    seekBy: jest.fn().mockResolvedValue(true),
    applyVolume: jest.fn().mockResolvedValue(undefined),
    setAudioTrack: jest.fn().mockResolvedValue(undefined),
    setSubtitleTrack: jest.fn().mockResolvedValue(undefined),
    setSpeed: jest.fn().mockResolvedValue(undefined),
    setAspect: jest.fn().mockResolvedValue(undefined),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
};
```

- [ ] **Step 2: Verify the adapter tests fail**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPattern=embedded-mpv-controls.adapter
```

Expected: failure because `EmbeddedMpvControlsAdapter` does not exist.

- [ ] **Step 3: Implement the adapter state and commands**

Create an injectable class that implements `PlayerController`, accepts the host
context once, and derives state with `computed()`:

```ts
export interface EmbeddedMpvControlsContext {
    playback: Signal<ResolvedPortalPlayback>;
    seriesNavigation: Signal<SeriesPlaybackNavigation | null>;
    recordingFolder: Signal<string>;
}

@Injectable()
export class EmbeddedMpvControlsAdapter implements PlayerController {
    private context: EmbeddedMpvControlsContext | null = null;

    configure(context: EmbeddedMpvControlsContext): void {
        this.context = context;
    }

    readonly commands: PlayerControlsCommands = {
        togglePlay: () => void this.controller.togglePaused(),
        seekTo: (seconds) => void this.controller.seekTo(seconds),
        seekBy: (delta) => void this.controller.seekBy(delta),
        setVolume: (value) => void this.controller.applyVolume(value),
        setAudioTrack: (id) => void this.controller.setAudioTrack(id),
        setSubtitleTrack: (id) =>
            void this.controller.setSubtitleTrack(id),
        setPlaybackSpeed: (speed) => void this.controller.setSpeed(speed),
        setAspectRatio: (value) => void this.controller.setAspect(value),
        toggleRecording: () => void this.toggleRecording(),
    };
}
```

Use the existing `audioTrackLabel`, `subtitleTrackLabel`, and
`readStoredVolume` helpers from `embedded-mpv-format.utils.ts`.

- [ ] **Step 4: Add failing recording and translation tests**

Cover all three ngx-translate event sources, successful start, successful stop
with saved path, detailed and generic failures, elapsed time, replacement of an
auto-dismissed message, and destroy-time timer cleanup.

- [ ] **Step 5: Implement message reactivity and cleanup**

Use:

```ts
private readonly translationsTick = toSignal(
    merge(
        this.translate.onLangChange,
        this.translate.onTranslationChange,
        this.translate.onDefaultLangChange
    ),
    { initialValue: null }
);
```

Register `DestroyRef.onDestroy()` to clear the recording-message timeout. Use an
`effect()` cleanup for the one-second elapsed-time interval.

- [ ] **Step 6: Run focused adapter tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPattern=embedded-mpv-controls.adapter
```

Expected: both adapter suites pass.

- [ ] **Step 7: Commit the adapter**

```bash
git add libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter*
git commit -m "feat(embedded-mpv): adapt frame-copy sessions to shared controls"
```

### Task 2: Mount shared controls for frame-copy

**Files:**

- Modify: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.ts`
- Modify: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.html`
- Modify: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.scss`
- Create: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.shared-controls.spec.ts`
- Modify: `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component.spec.ts`

- [ ] **Step 1: Write failing engine-selection tests**

Assert:

```ts
expect(query(By.directive(PlayerControlsComponent))).not.toBeNull();
expect(query(By.css('.embedded-mpv-player__controls'))).toBeNull();
expect(query(By.css('[data-embedded-mpv-frame]'))).not.toBeNull();
```

for `engine: 'frame-copy'`, and the inverse controls assertions for
`engine: 'native'`.

- [ ] **Step 2: Verify the host integration test fails**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPattern=embedded-mpv-player.component.shared-controls
```

Expected: failure because the component does not import or render
`PlayerControlsComponent`.

- [ ] **Step 3: Add the component-scoped adapter and template branch**

Add `PlayerControlsComponent` to component imports and
`EmbeddedMpvControlsAdapter` to providers. Configure it with the component input
signals and expose the player root element:

```ts
readonly sharedControls = inject(EmbeddedMpvControlsAdapter);
readonly playerSurface = computed(
    () => this.playerRoot()?.nativeElement ?? null
);

this.sharedControls.configure({
    playback: this.playback,
    seriesNavigation: this.seriesNavigation,
    recordingFolder: this.recordingFolder,
});
```

Render:

```html
@if (isFrameCopyEngine() && isSupported()) {
    <app-player-controls
        [controller]="sharedControls"
        [playerSurface]="playerSurface()"
        [showControls]="showControls()"
        (previousEpisodeRequested)="requestPreviousEpisode()"
        (nextEpisodeRequested)="requestNextEpisode()"
    />
}
```

Render the existing `.embedded-mpv-player__controls` only when the engine is not
frame-copy. Apply `.embedded-mpv-player--controls-enabled` only to that legacy
path so the frame-copy canvas fills the player.

- [ ] **Step 4: Add failing exactly-once interaction tests**

Cover click-to-pause, double-click fullscreen, keyboard play/pause, disabled
shared controls, and previous/next outputs. Spy on controller methods and assert
one invocation after the 250 ms single-click grace period.

- [ ] **Step 5: Disable legacy interaction ownership for frame-copy**

Make the old shortcut availability predicate require
`!this.isFrameCopyEngine()`. Return early from legacy player interaction,
viewport click, double-click, and document pointer handlers on frame-copy.
Keep the fullscreen listener's bounds-sync call for both engines, but reveal
legacy controls only for native-view.

- [ ] **Step 6: Preserve native regression fixtures**

Make existing component specs explicitly set:

```ts
engine: 'native',
```

so every legacy dock, timeline, popover, and shortcut assertion remains pinned
to the native-view path.

- [ ] **Step 7: Run component and shared-controls tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPattern='embedded-mpv-player.component|player-controls'
```

Expected: all selected suites pass.

- [ ] **Step 8: Commit host integration**

```bash
git add libs/ui/playback/src/lib/embedded-mpv-player/
git commit -m "feat(embedded-mpv): use shared controls for frame-copy"
```

### Task 3: Update canonical architecture documentation

**Files:**

- Modify: `docs/architecture/player-controls-contract.md`
- Modify: `docs/architecture/embedded-mpv-native.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update player-controls ownership**

Change the current-status section from “no existing player consumes this layer”
to state that frame-copy embedded MPV is the first consumer. Keep web engines
default-off and native-view on its dock.

- [ ] **Step 2: Update embedded-MPV renderer architecture**

Add `embedded-mpv-controls.adapter.ts` to the renderer file map. Document that
frame-copy mounts shared controls over the canvas and native-view retains
compositor workarounds.

- [ ] **Step 3: Keep agent guidance synchronized**

Update the matching embedded-MPV/shared-controls statements in `AGENTS.md` and
`CLAUDE.md` with the same ownership boundary.

- [ ] **Step 4: Verify Markdown and commit**

Run:

```bash
git diff --check
rg -n "no existing player consumes|not wired" \
  docs/architecture/player-controls-contract.md AGENTS.md CLAUDE.md
```

Expected: no stale claim that every player is unwired.

Commit:

```bash
git add docs/architecture/player-controls-contract.md \
  docs/architecture/embedded-mpv-native.md AGENTS.md CLAUDE.md
git commit -m "docs(embedded-mpv): document frame-copy shared controls"
```

### Task 4: Full validation and PR preparation

**Files:**

- Verify all files changed by Tasks 1-3.

- [ ] **Step 1: Run UI playback tests**

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand
```

Expected: all suites pass.

- [ ] **Step 2: Run lint, typecheck, and i18n validation**

```bash
pnpm nx lint ui-playback --skip-nx-cache
pnpm run typecheck:ci
pnpm run i18n:check
```

Expected: all commands pass; the existing identical-English i18n warning is
acceptable.

- [ ] **Step 3: Run Electron smoke coverage**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/smoke.e2e.ts --skip-nx-cache
```

Expected: smoke tests pass. If the local frame-copy runtime is absent, record
that native frame rendering could not be exercised locally and rely on
cross-platform PR CI for the packaged runtime gate.

- [ ] **Step 4: Run repository hygiene checks**

```bash
pnpm exec prettier --check \
  libs/ui/playback/src/lib/embedded-mpv-player \
  docs/architecture/player-controls-contract.md \
  docs/architecture/embedded-mpv-native.md \
  AGENTS.md CLAUDE.md
git diff --check origin/master..HEAD
git status --short
```

Expected: formatting passes, no whitespace errors, and the worktree is clean.

- [ ] **Step 5: Request review and merge only after the exact-head gate**

Push the branch, open a focused replacement PR, request Greptile and Codex
reviews, address actionable findings with regression tests, and merge only when
all exact-head CI checks pass, Greptile reports 5/5, Codex is clean, and no
review thread remains unresolved.

