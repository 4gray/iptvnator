# Shared Web Picture-in-Picture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one capability-gated Picture-in-Picture action to IPTVnator's
shared controls for HTML5, Video.js, and ArtPlayer while keeping Embedded MPV,
AirPlay, Cast, and the legacy controls paths unchanged.

**Architecture:** Extend `PlayerController` with PiP capability/state/command
fields. `WebVideoControlsAdapter` owns standard element PiP against its current
`HTMLVideoElement`, including Video.js Tech replacement, exact ownership,
pending-operation serialization, and stale-request cleanup. The shared Angular
component renders one accessible action; Embedded MPV implements only
capability-false contract compatibility.

**Tech Stack:** Angular signals and standalone components, TypeScript 5.9 DOM
PiP APIs, Jest 30 + jsdom 26, Nx, ngx-translate.

**Design:** `docs/superpowers/specs/2026-07-17-shared-web-picture-in-picture-design.md`

---

## File structure

### New files

- `libs/ui/playback/src/lib/player-controls/player-controls-defaults.spec.ts`
  proves the new contract remains default-off.
- `libs/ui/playback/src/lib/player-controls/picture-in-picture.spec-helpers.ts`
  provides reversible jsdom PiP API doubles shared by focused and engine
  integration specs.
- `libs/ui/playback/src/lib/player-controls/web-video-controls.adapter.picture-in-picture.spec.ts`
  owns browser API, readiness, pending, ownership, detach, and stale-completion
  regression coverage.

### Modified production files

- `libs/ui/playback/src/lib/player-controls/player-controls.model.ts`
  declares PiP capability/state/command fields.
- `libs/ui/playback/src/lib/player-controls/player-controls-defaults.ts`
  supplies safe `false` defaults.
- `libs/ui/playback/src/lib/player-controls/web-video-controls.adapter.ts`
  implements standard element PiP against the active web-engine video.
- `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.ts`
  remains explicitly capability-false with a no-op command.
- `libs/ui/playback/src/lib/player-controls/player-controls.component.ts`
  gates and dispatches the shared action.
- `libs/ui/playback/src/lib/player-controls/player-controls.component.html`
  renders the accessible PiP button immediately before fullscreen.
- `apps/web/src/assets/i18n/*.json` adds enter/exit labels to all 18 locales.

### Modified tests and docs

- Typed command fakes:
  `controls-menu-selection.spec.ts`,
  `player-controls.component.contract.spec.ts`,
  `player-controls.component.interactions.spec.ts`,
  `player-controls.component.spec.ts`,
  `player-controls.component.surface.spec.ts`, and
  `player-controls.component.timeline.spec.ts`.
- Engine coverage:
  `html-video-player.component.shared-controls.spec.ts`,
  `vjs-player.component.reset.spec.ts`,
  `art-player.component.shared-controls.spec.ts`, and
  `embedded-mpv-controls.adapter.spec.ts`.
- Canonical docs:
  `docs/architecture/player-controls-contract.md`, `AGENTS.md`, and
  `CLAUDE.md`.

---

### Task 1: Extend the controller contract with safe default-off PiP fields

**Files:**

- Create:
  `libs/ui/playback/src/lib/player-controls/player-controls-defaults.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/player-controls/player-controls.model.ts`
- Modify:
  `libs/ui/playback/src/lib/player-controls/player-controls-defaults.ts`
- Modify:
  `libs/ui/playback/src/lib/player-controls/web-video-controls.adapter.ts`
- Modify:
  `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.ts`
- Modify:
  `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.spec.ts`
- Modify the six typed command-fake specs listed in the file-structure section.

- [ ] **Step 1: Write the failing defaults test**

Create the focused spec with an indexed read so RED is an assertion failure
rather than a TypeScript declaration failure:

```ts
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';

describe('player-controls defaults', () => {
    it('defaults Picture-in-Picture to unsupported and inactive', () => {
        expect(
            (DEFAULT_PLAYER_CAPABILITIES as Record<string, unknown>)[
                'pictureInPicture'
            ]
        ).toBe(false);
        expect(createEmptyControlsState()).toMatchObject({
            pictureInPictureActive: false,
            canPictureInPicture: false,
        });
    });
});
```

- [ ] **Step 2: Run RED and confirm the missing defaults are detected**

Run:

```bash
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/player-controls --runInBand"
```

Expected: FAIL in `player-controls-defaults.spec.ts`, because the PiP
capability/state fields are absent.

- [ ] **Step 3: Add the contract and defaults**

Add the following flat fields:

```ts
export interface PlayerControlsCapabilities {
    seek: boolean;
    volume: boolean;
    audioTracks: boolean;
    subtitles: boolean;
    playbackSpeed: boolean;
    aspectRatio: boolean;
    recording: boolean;
    pictureInPicture: boolean;
    fullscreen: boolean;
    seriesNavigation: boolean;
}
```

```ts
export interface PlayerControlsState {
    // Existing playback, track, speed, aspect, and recording fields stay here.
    pictureInPictureActive: boolean;
    canPictureInPicture: boolean;
    canPreviousEpisode: boolean;
    canNextEpisode: boolean;
}
```

```ts
export interface PlayerControlsCommands {
    // Existing commands stay unchanged.
    toggleRecording(): void;
    togglePictureInPicture(): void;
}
```

Add to `DEFAULT_PLAYER_CAPABILITIES`:

```ts
pictureInPicture: false,
```

Add to `createEmptyControlsState()`:

```ts
pictureInPictureActive: false,
canPictureInPicture: false,
```

Remove the temporary indexed cast from the new defaults test:

```ts
expect(DEFAULT_PLAYER_CAPABILITIES.pictureInPicture).toBe(false);
```

- [ ] **Step 4: Make both production controllers contract-complete**

Keep the web adapter temporarily default-off until Task 2:

```ts
// WebVideoControlsAdapter capability result
pictureInPicture: false,
```

```ts
// WebVideoControlsAdapter state result
pictureInPictureActive: false,
canPictureInPicture: false,
```

```ts
// WebVideoControlsAdapter commands
togglePictureInPicture: () => undefined,
```

Keep Embedded MPV explicitly unsupported:

```ts
// EmbeddedMpvControlsAdapter capability result
pictureInPicture: false,
```

```ts
// EmbeddedMpvControlsAdapter state result
pictureInPictureActive: false,
canPictureInPicture: false,
```

```ts
// EmbeddedMpvControlsAdapter commands
togglePictureInPicture: () => undefined,
```

Update both exact capability objects in
`embedded-mpv-controls.adapter.spec.ts` to contain:

```ts
pictureInPicture: false,
```

Add this exact command fake to each of the six typed fake files:

```ts
togglePictureInPicture: jest.fn(),
```

The capability/state fakes already spread `DEFAULT_PLAYER_CAPABILITIES` and
`createEmptyControlsState()`, so do not duplicate new state literals there.

- [ ] **Step 5: Verify GREEN for contract and Embedded MPV**

Run:

```bash
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/player-controls --runInBand"
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/embedded-mpv-player --runInBand"
```

Expected: PASS. Embedded MPV must report PiP unsupported and retain no
PiP-related backend/native command.

- [ ] **Step 6: Commit the contract**

```bash
git add \
  libs/ui/playback/src/lib/player-controls \
  libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.ts \
  libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-controls.adapter.spec.ts
git commit -m "feat(playback): add picture-in-picture controls contract"
```

---

### Task 2: Implement owned web-video PiP with race-safe lifecycle

**Files:**

- Create:
  `libs/ui/playback/src/lib/player-controls/picture-in-picture.spec-helpers.ts`
- Create:
  `libs/ui/playback/src/lib/player-controls/web-video-controls.adapter.picture-in-picture.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/player-controls/web-video-controls.adapter.ts`
- Modify:
  `libs/ui/playback/src/lib/html-video-player/html-video-player.component.shared-controls.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/vjs-player/vjs-player.component.reset.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/art-player/art-player.component.shared-controls.spec.ts`

- [ ] **Step 1: Add a reversible jsdom PiP environment**

Create a test-only helper with configurable document properties, exact
ownership, and ready-state control:

```ts
export interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(reason?: unknown): void;
}

export function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

export class PictureInPictureTestEnvironment {
    private activeElement: Element | null = null;
    private enabled = true;
    private readonly enabledDescriptor = Object.getOwnPropertyDescriptor(
        document,
        'pictureInPictureEnabled'
    );
    private readonly elementDescriptor = Object.getOwnPropertyDescriptor(
        document,
        'pictureInPictureElement'
    );
    private readonly exitDescriptor = Object.getOwnPropertyDescriptor(
        document,
        'exitPictureInPicture'
    );

    readonly exit = jest.fn<Promise<void>, []>(async () => {
        const previous = this.activeElement;
        this.activeElement = null;
        previous?.dispatchEvent(new Event('leavepictureinpicture'));
    });

    constructor() {
        Object.defineProperty(document, 'pictureInPictureEnabled', {
            configurable: true,
            get: () => this.enabled,
        });
        Object.defineProperty(document, 'pictureInPictureElement', {
            configurable: true,
            get: () => this.activeElement,
        });
        Object.defineProperty(document, 'exitPictureInPicture', {
            configurable: true,
            value: this.exit,
        });
    }

    setEnabled(value: boolean): void {
        this.enabled = value;
    }

    setActive(element: Element | null, emit = true): void {
        const previous = this.activeElement;
        this.activeElement = element;
        if (!emit) {
            return;
        }
        if (previous && previous !== element) {
            previous.dispatchEvent(new Event('leavepictureinpicture'));
        }
        if (element && previous !== element) {
            element.dispatchEvent(new Event('enterpictureinpicture'));
        }
    }

    installVideo(
        video: HTMLVideoElement,
        request: () => Promise<PictureInPictureWindow> = async () => {
            this.setActive(video);
            return {} as PictureInPictureWindow;
        }
    ): jest.Mock<Promise<PictureInPictureWindow>, []> {
        const requestMock = jest.fn(request);
        Object.defineProperty(video, 'requestPictureInPicture', {
            configurable: true,
            value: requestMock,
        });
        Object.defineProperty(video, 'disablePictureInPicture', {
            configurable: true,
            writable: true,
            value: false,
        });
        return requestMock;
    }

    setReadyState(video: HTMLVideoElement, value: number): void {
        Object.defineProperty(video, 'readyState', {
            configurable: true,
            value,
        });
    }

    restore(): void {
        restoreDocumentProperty(
            'pictureInPictureEnabled',
            this.enabledDescriptor
        );
        restoreDocumentProperty(
            'pictureInPictureElement',
            this.elementDescriptor
        );
        restoreDocumentProperty('exitPictureInPicture', this.exitDescriptor);
    }
}

function restoreDocumentProperty(
    property:
        | 'pictureInPictureEnabled'
        | 'pictureInPictureElement'
        | 'exitPictureInPicture',
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(document, property, descriptor);
        return;
    }
    delete (document as unknown as Record<string, unknown>)[property];
}
```

If the installed Jest type signature accepts only the newer single generic
form, use `jest.fn<() => Promise<void>>()` and
`jest.MockedFunction<() => Promise<PictureInPictureWindow>>`; do not introduce
`any`.

- [ ] **Step 2: Write focused failing adapter tests**

Use `PictureInPictureTestEnvironment` and add separate tests with these exact
outcomes:

```ts
it.each([
    ['document disabled', false, false],
    ['element disabled', true, true],
] as const)(
    'does not advertise PiP when %s',
    (_label, documentDisabled, elementDisabled) => {
        environment.setEnabled(!documentDisabled);
        const video = createVideo(1);
        environment.installVideo(video);
        video.disablePictureInPicture = elementDisabled;

        adapter.attach(video);

        expect(adapter.capabilities().pictureInPicture).toBe(false);
        expect(adapter.state().canPictureInPicture).toBe(false);
    }
);

it('advertises support before metadata but enables the action after metadata', () => {
    const video = createVideo(0);
    environment.installVideo(video);
    adapter.attach(video);

    expect(adapter.capabilities().pictureInPicture).toBe(true);
    expect(adapter.state().canPictureInPicture).toBe(false);

    environment.setReadyState(video, 1);
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(adapter.state().canPictureInPicture).toBe(true);
});

it('requests entry synchronously and serializes a pending request', async () => {
    const pending = deferred<PictureInPictureWindow>();
    const video = createVideo(1);
    const request = environment.installVideo(video, () => pending.promise);
    adapter.attach(video);

    adapter.commands.togglePictureInPicture();
    adapter.commands.togglePictureInPicture();

    expect(request).toHaveBeenCalledTimes(1);
    expect(adapter.state().canPictureInPicture).toBe(false);

    pending.resolve({} as PictureInPictureWindow);
    await pending.promise;
    await Promise.resolve();
    expect(adapter.state().canPictureInPicture).toBe(true);
});

it('uses browser enter and leave events as active-state authority', () => {
    const video = createVideo(1);
    environment.installVideo(video);
    adapter.attach(video);

    environment.setActive(video);
    expect(adapter.state().pictureInPictureActive).toBe(true);

    environment.setActive(null);
    expect(adapter.state().pictureInPictureActive).toBe(false);
});

it('keeps an owned exit available after request support is disabled', () => {
    const video = createVideo(0);
    environment.installVideo(video);
    adapter.attach(video);
    environment.setActive(video);
    video.disablePictureInPicture = true;
    adapter.refresh();

    expect(adapter.capabilities().pictureInPicture).toBe(true);
    expect(adapter.state().canPictureInPicture).toBe(true);

    adapter.commands.togglePictureInPicture();
    expect(environment.exit).toHaveBeenCalledTimes(1);
});
```

Also add individual tests for:

- missing `requestPictureInPicture` and missing `exitPictureInPicture`;
- synchronous throws and rejected promises for request and exit;
- pending exit serialization;
- `loadstart`, `emptied`, and `loadedmetadata` on the same target never calling
  exit;
- active old target to replacement target calling exit exactly once;
- unrelated `pictureInPictureElement` never being exited;
- repeated detach being idempotent;
- old target events not refreshing/mutating a new binding;
- a stale successful ENTER cleaning up the old target if it becomes owner after
  replacement; and
- a stale completion never clearing the replacement target's newer pending
  operation.

For the final two regressions, use two `Deferred<PictureInPictureWindow>`
instances and assert both `adapter.state().canPictureInPicture === false` for
the replacement while its own request remains unresolved and
`environment.exit` is called only when the old target is the exact owner.

- [ ] **Step 3: Add failing integration assertions before production code**

HTML5 shared mode:

```ts
const video = fixture.debugElement.query(By.css('video'))
    .nativeElement as HTMLVideoElement;
environment.installVideo(video);
environment.setReadyState(video, 1);
video.dispatchEvent(new Event('loadedmetadata'));
expect(adapter.capabilities().pictureInPicture).toBe(true);
expect(adapter.state().canPictureInPicture).toBe(true);
```

Video.js reset:

```ts
environment.installVideo(initialVideo);
environment.setReadyState(initialVideo, 1);
environment.setActive(initialVideo);

playerHarness.currentVideo = replacementVideo;
environment.installVideo(replacementVideo);
environment.setReadyState(replacementVideo, 1);
playerHarness.emit('playerreset');

expect(environment.exit).toHaveBeenCalledTimes(1);
expect(component.controlsAdapter.state().pictureInPictureActive).toBe(false);
expect(component.controlsAdapter.capabilities().pictureInPicture).toBe(true);
```

ArtPlayer rebuild:

```ts
const firstVideo = artPlayerInstances[0].video;
environment.installVideo(firstVideo);
environment.setReadyState(firstVideo, 1);
firstVideo.dispatchEvent(new Event('loadedmetadata'));
environment.setActive(firstVideo);

fixture.componentRef.setInput('channel', replacementChannel);
fixture.detectChanges();

expect(environment.exit).toHaveBeenCalledTimes(1);
expect(component.controlsAdapter.state().pictureInPictureActive).toBe(false);
```

Preserve the existing ArtPlayer assertion that shared mode passes
`pip: false`; legacy `art-player-setup.spec.ts` must continue asserting
`pip: true`.

- [ ] **Step 4: Run RED for focused and engine suites**

Run:

```bash
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/player-controls --runInBand"
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/html-video-player --runInBand"
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/vjs-player --runInBand"
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/art-player --runInBand"
```

Expected: FAIL because the web adapter still reports PiP unsupported and does
not request/exit/rebind PiP.

- [ ] **Step 5: Implement feature detection and operation identity**

Add constants/types near the existing media constants:

```ts
const HAVE_METADATA = 1;
const PICTURE_IN_PICTURE_ACTION = {
    ENTER: 'enter',
    EXIT: 'exit',
} as const;

type PictureInPictureAction =
    (typeof PICTURE_IN_PICTURE_ACTION)[keyof typeof PICTURE_IN_PICTURE_ACTION];

interface PictureInPictureOperation {
    readonly action: PictureInPictureAction;
    readonly generation: number;
    readonly video: HTMLVideoElement;
}

interface PictureInPictureSnapshot {
    readonly active: boolean;
    readonly canExit: boolean;
    readonly canRequest: boolean;
    readonly canToggle: boolean;
    readonly supported: boolean;
}
```

Append exact browser events:

```ts
'enterpictureinpicture',
'leavepictureinpicture',
```

Add fields:

```ts
private bindingGeneration = 0;
private pictureInPictureOperation: PictureInPictureOperation | null = null;
```

Read one safe snapshot per capability/state computation:

```ts
private readPictureInPicture(
    video: HTMLVideoElement
): PictureInPictureSnapshot {
    try {
        const ownerDocument = video.ownerDocument;
        const active = ownerDocument.pictureInPictureElement === video;
        const canExit =
            typeof ownerDocument.exitPictureInPicture === 'function';
        const canRequest =
            ownerDocument.pictureInPictureEnabled === true &&
            typeof video.requestPictureInPicture === 'function' &&
            canExit &&
            video.disablePictureInPicture !== true;
        const supported = canRequest || (active && canExit);
        const ready = video.readyState >= HAVE_METADATA;
        return {
            active,
            canExit,
            canRequest,
            supported,
            canToggle:
                this.pictureInPictureOperation === null &&
                ((active && canExit) || (canRequest && ready)),
        };
    } catch {
        return {
            active: false,
            canExit: false,
            canRequest: false,
            canToggle: false,
            supported: false,
        };
    }
}
```

Project it into the public contract:

```ts
const pictureInPicture = this.readPictureInPicture(this.video);

return {
    ...DEFAULT_PLAYER_CAPABILITIES,
    // existing capabilities
    pictureInPicture: pictureInPicture.supported,
};
```

```ts
const pictureInPicture = this.readPictureInPicture(video);

return {
    // existing state
    pictureInPictureActive: pictureInPicture.active,
    canPictureInPicture: pictureInPicture.canToggle,
};
```

- [ ] **Step 6: Implement synchronous command invocation and stale cleanup**

Wire the command:

```ts
togglePictureInPicture: () => this.togglePictureInPicture(),
```

Implement:

```ts
private togglePictureInPicture(): void {
    const video = this.video;
    if (!video || this.pictureInPictureOperation) {
        return;
    }

    const snapshot = this.readPictureInPicture(video);
    if (!snapshot.canToggle) {
        return;
    }

    if (snapshot.active && snapshot.canExit) {
        this.startPictureInPictureOperation(
            PICTURE_IN_PICTURE_ACTION.EXIT,
            video,
            () => video.ownerDocument.exitPictureInPicture()
        );
        return;
    }

    if (snapshot.canRequest) {
        this.startPictureInPictureOperation(
            PICTURE_IN_PICTURE_ACTION.ENTER,
            video,
            () => video.requestPictureInPicture()
        );
    }
}

private startPictureInPictureOperation(
    action: PictureInPictureAction,
    video: HTMLVideoElement,
    invoke: () => Promise<unknown>
): void {
    const operation: PictureInPictureOperation = {
        action,
        generation: this.bindingGeneration,
        video,
    };
    this.pictureInPictureOperation = operation;
    this.refresh();

    let result: Promise<unknown>;
    try {
        result = invoke();
    } catch {
        this.settlePictureInPictureOperation(operation, false);
        return;
    }

    void Promise.resolve(result).then(
        () => this.settlePictureInPictureOperation(operation, true),
        () => this.settlePictureInPictureOperation(operation, false)
    );
}

private settlePictureInPictureOperation(
    operation: PictureInPictureOperation,
    succeeded: boolean
): void {
    const isCurrent =
        this.pictureInPictureOperation === operation &&
        this.bindingGeneration === operation.generation &&
        this.video === operation.video;

    if (isCurrent) {
        this.pictureInPictureOperation = null;
        this.refresh();
        return;
    }

    if (
        succeeded &&
        operation.action === PICTURE_IN_PICTURE_ACTION.ENTER
    ) {
        this.exitPictureInPictureIfOwned(operation.video);
    }
}

private exitPictureInPictureIfOwned(video: HTMLVideoElement): void {
    try {
        const ownerDocument = video.ownerDocument;
        if (
            ownerDocument.pictureInPictureElement !== video ||
            typeof ownerDocument.exitPictureInPicture !== 'function'
        ) {
            return;
        }
        const result = ownerDocument.exitPictureInPicture();
        void Promise.resolve(result).then(
            () => undefined,
            () => undefined
        );
    } catch {
        // PiP teardown is best-effort during target replacement.
    }
}
```

Do not defer `invoke()` through a microtask: `requestPictureInPicture()` must be
called synchronously inside the user click.

- [ ] **Step 7: Make attach/detach generation-safe**

After `this.detach()` in `attach`, capture the current generation and guard the
event callback:

```ts
const generation = this.bindingGeneration;
const onEvent = () => {
    if (this.video === video && this.bindingGeneration === generation) {
        this.refresh();
    }
};
```

Replace detach ordering with:

```ts
detach(): void {
    const previousVideo = this.video;
    this.bindingGeneration += 1;
    this.detachFn?.();
    this.detachFn = null;
    this.video = null;
    this.opts = {};
    this.pictureInPictureOperation = null;
    if (previousVideo) {
        this.exitPictureInPictureIfOwned(previousVideo);
    }
    this.refresh();
}
```

This cleanup must recheck exact ownership immediately before global document
exit. It must not close another element's PiP.

- [ ] **Step 8: Run GREEN for all focused and engine suites**

Repeat the four commands from Step 4.

Expected: PASS with no unhandled rejection warnings.

- [ ] **Step 9: Commit web PiP behavior**

```bash
git add \
  libs/ui/playback/src/lib/player-controls \
  libs/ui/playback/src/lib/html-video-player/html-video-player.component.shared-controls.spec.ts \
  libs/ui/playback/src/lib/vjs-player/vjs-player.component.reset.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player.component.shared-controls.spec.ts
git commit -m "feat(playback): add shared web picture-in-picture"
```

---

### Task 3: Add the accessible shared PiP action and translations

**Files:**

- Modify:
  `libs/ui/playback/src/lib/player-controls/player-controls.component.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/player-controls/player-controls.component.ts`
- Modify:
  `libs/ui/playback/src/lib/player-controls/player-controls.component.html`
- Modify all JSON files in `apps/web/src/assets/i18n/`.

- [ ] **Step 1: Write failing shared-component tests**

Add English fixture values:

```ts
ENTER_PICTURE_IN_PICTURE: 'Enter picture-in-picture',
EXIT_PICTURE_IN_PICTURE: 'Exit picture-in-picture',
```

Extend the "all optional controls hidden" assertion:

```ts
expect(query('[aria-label="Enter picture-in-picture"]')).toBeNull();
```

Add separate tests:

```ts
it('disables Picture-in-Picture while the engine cannot toggle it', () => {
    setCapabilities({ pictureInPicture: true });
    setState({ canPictureInPicture: false });
    fixture.detectChanges();

    const button = query(
        '[aria-label="Enter picture-in-picture"]'
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
});

it('exposes the active Picture-in-Picture state', () => {
    setCapabilities({ pictureInPicture: true });
    setState({
        canPictureInPicture: true,
        pictureInPictureActive: true,
    });
    fixture.detectChanges();

    const button = query(
        '[aria-label="Exit picture-in-picture"]'
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent?.trim()).toBe('picture_in_picture_alt');
});

it('invokes Picture-in-Picture exactly once when available', () => {
    setCapabilities({ pictureInPicture: true });
    setState({ canPictureInPicture: true });
    fixture.detectChanges();

    query('[aria-label="Enter picture-in-picture"]')?.click();

    expect(fake.commands.togglePictureInPicture).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run RED**

Run the focused player-controls command from Task 1.

Expected: FAIL because no PiP button or component command exists.

- [ ] **Step 3: Implement the guarded component command**

Add:

```ts
togglePictureInPicture(): void {
    this.reveal();
    if (
        !this.capabilities().pictureInPicture ||
        !this.state().canPictureInPicture
    ) {
        return;
    }
    this.controller().commands.togglePictureInPicture();
}
```

- [ ] **Step 4: Render the action immediately before fullscreen**

Add:

```html
@if (capabilities().pictureInPicture) {
<button
    mat-icon-button
    type="button"
    class="player-controls__button"
    [disabled]="!state().canPictureInPicture"
    [attr.aria-pressed]="state().pictureInPictureActive"
    (click)="togglePictureInPicture()"
    [attr.aria-label]="
            (state().pictureInPictureActive
                ? 'EMBEDDED_MPV.PLAYER.EXIT_PICTURE_IN_PICTURE'
                : 'EMBEDDED_MPV.PLAYER.ENTER_PICTURE_IN_PICTURE'
            ) | translate
        "
    [matTooltip]="
            (state().pictureInPictureActive
                ? 'EMBEDDED_MPV.PLAYER.EXIT_PICTURE_IN_PICTURE'
                : 'EMBEDDED_MPV.PLAYER.ENTER_PICTURE_IN_PICTURE'
            ) | translate
        "
    matTooltipPosition="above"
>
    <mat-icon
        >{{ state().pictureInPictureActive ? 'picture_in_picture_alt' :
        'picture_in_picture' }}</mat-icon
    >
</button>
}
```

No SCSS, menu, view-model, surface, or shortcut change is needed.

- [ ] **Step 5: Add localized labels to all 18 locales**

Add `ENTER_PICTURE_IN_PICTURE` and `EXIT_PICTURE_IN_PICTURE` beside fullscreen
labels using this exact value map:

| Locale | Enter                                  | Exit                                    |
| ------ | -------------------------------------- | --------------------------------------- |
| `ar`   | `تشغيل صورة داخل صورة`                 | `إنهاء صورة داخل صورة`                  |
| `ary`  | `شغّل صورة داخل صورة`                  | `خرج من صورة داخل صورة`                 |
| `by`   | `Уключыць рэжым «выява ў выяве»`       | `Выйсці з рэжыму «выява ў выяве»`       |
| `de`   | `Bild-in-Bild starten`                 | `Bild-in-Bild beenden`                  |
| `el`   | `Έναρξη εικόνας εντός εικόνας`         | `Έξοδος από εικόνα εντός εικόνας`       |
| `en`   | `Enter picture-in-picture`             | `Exit picture-in-picture`               |
| `es`   | `Activar imagen en imagen`             | `Salir de imagen en imagen`             |
| `fr`   | `Activer le mode image dans l’image`   | `Quitter le mode image dans l’image`    |
| `it`   | `Attiva Picture-in-Picture`            | `Esci da Picture-in-Picture`            |
| `ja`   | `ピクチャーインピクチャーを開始`       | `ピクチャーインピクチャーを終了`        |
| `ko`   | `PIP 모드 시작`                        | `PIP 모드 종료`                         |
| `nl`   | `Beeld-in-beeld starten`               | `Beeld-in-beeld sluiten`                |
| `pl`   | `Włącz obraz w obrazie`                | `Wyłącz obraz w obrazie`                |
| `pt`   | `Ativar imagem em imagem`              | `Sair de imagem em imagem`              |
| `ru`   | `Включить режим «картинка в картинке»` | `Выйти из режима «картинка в картинке»` |
| `tr`   | `Resim içinde resim modunu aç`         | `Resim içinde resim modundan çık`       |
| `zh`   | `进入画中画`                           | `退出画中画`                            |
| `zhtw` | `進入子母畫面`                         | `退出子母畫面`                          |

Format and validate:

```bash
pnpm exec prettier --write apps/web/src/assets/i18n/*.json
pnpm run i18n:check
```

Expected: every locale has zero missing/extra keys.

- [ ] **Step 6: Run GREEN and commit UI/locales**

Run:

```bash
pnpm nx run ui-playback:test --skip-nx-cache \
  --command="node ./tools/testing/run-web-esm-lib-tests.mjs libs/ui/playback/src/lib/player-controls --runInBand"
pnpm run i18n:check
```

Expected: PASS.

Commit:

```bash
git add \
  libs/ui/playback/src/lib/player-controls/player-controls.component.ts \
  libs/ui/playback/src/lib/player-controls/player-controls.component.html \
  libs/ui/playback/src/lib/player-controls/player-controls.component.spec.ts \
  apps/web/src/assets/i18n
git commit -m "feat(playback): expose shared picture-in-picture action"
```

---

### Task 4: Update canonical architecture and agent guidance

**Files:**

- Modify: `docs/architecture/player-controls-contract.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the canonical contract**

Document:

- `pictureInPicture` capability;
- `pictureInPictureActive` and `canPictureInPicture` state;
- `togglePictureInPicture()` command;
- standard element PiP support/readiness gating;
- browser events as authoritative state;
- exact ownership and target-replacement cleanup;
- same-element source preservation;
- Video.js Tech replacement and ArtPlayer rebuild behavior;
- OS/browser-managed PiP controls and browser-dependent subtitles;
- no keyboard shortcut; and
- explicit non-support for Embedded MPV, AirPlay, Cast, and Document PiP.

Update the Commands section so only fullscreen and episode navigation remain
outside the controller contract.

- [ ] **Step 2: Mirror concise behavior in both living guidance files**

Add the same concise claim to `AGENTS.md` and the Shared player-controls
paragraph in `CLAUDE.md`:

```md
Shared web controls expose standard element Picture-in-Picture through
`WebVideoControlsAdapter` for HTML5, Video.js, and ArtPlayer when the browser
supports it. Browser enter/leave events own active state; pending requests are
serialized, same-element source changes preserve PiP, and adapter detach or
Video.js/ArtPlayer video replacement exits only PiP owned by the old element.
Embedded MPV, AirPlay, Cast, and Document PiP remain out of scope.
```

- [ ] **Step 3: Format and verify documentation**

Run:

```bash
pnpm exec prettier --write \
  docs/architecture/player-controls-contract.md \
  AGENTS.md \
  CLAUDE.md
pnpm exec prettier --check \
  docs/architecture/player-controls-contract.md \
  docs/superpowers/specs/2026-07-17-shared-web-picture-in-picture-design.md \
  docs/superpowers/plans/2026-07-17-shared-web-picture-in-picture.md \
  AGENTS.md \
  CLAUDE.md
git diff --check
```

Expected: formatting passes and no whitespace errors.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/architecture/player-controls-contract.md AGENTS.md CLAUDE.md
git commit -m "docs(playback): document shared web picture-in-picture"
```

---

### Task 5: Run full validation and perform a real-runtime smoke test

**Files:**

- No expected source changes. If validation exposes a defect, add the closest
  regression test first, observe RED, then fix and rerun the affected ladder.

- [ ] **Step 1: Run the complete project test target**

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand
```

Expected: all `ui-playback` suites pass with zero unhandled promise warnings.

- [ ] **Step 2: Run lint, translation parity, and the consuming web build**

```bash
pnpm nx lint ui-playback --skip-nx-cache
pnpm run i18n:check
pnpm nx build web --configuration=development --skip-nx-cache
```

Expected: all commands exit 0.

- [ ] **Step 3: Audit the explicit scope exclusions**

Run:

```bash
git diff origin/master -- \
  apps/electron-backend \
  libs/ui/playback/src/lib/embedded-mpv-player \
  | rg -i "airplay|cast|picture.?in.?picture|popup|browserwindow" || true
```

Expected: only the Embedded MPV adapter's contract-false state/no-op and its
unit assertion appear; no backend, native addon, popup, AirPlay, or Cast
implementation exists.

- [ ] **Step 4: Perform real Chromium/Electron smoke coverage**

Use the repository's Electron CDP workflow and a playable local or test stream.
For each HTML5, Video.js, and ArtPlayer:

1. enable unified web controls in Settings;
2. open a stream and wait for metadata;
3. confirm the PiP button appears before fullscreen;
4. enter PiP and confirm the OS-managed window opens;
5. return and exit PiP;
6. change source on a retained video and confirm PiP remains;
7. switch/rebuild the player and confirm old owned PiP closes; and
8. disable unified controls and confirm native/vendor PiP remains unchanged.

Record any platform limitation explicitly. If the current automation
environment cannot inspect the OS-managed window, verify the user-gesture
request and browser enter/leave events through CDP and report the OS-window
check as manual follow-up rather than claiming it.

- [ ] **Step 5: Review the final diff against every requirement**

Check:

```bash
git status --short
git diff --check origin/master...HEAD
git diff --stat origin/master...HEAD
git log --oneline origin/master..HEAD
```

Requirement checklist:

- HTML5, Video.js, and ArtPlayer shared controls expose PiP.
- Unsupported/not-ready/pending states are correctly gated.
- Active state is browser-event authoritative.
- Target replacement and stale requests cannot orphan or cross-close PiP.
- Embedded MPV has no PiP implementation or popup.
- AirPlay and Cast are untouched.
- Legacy controls paths remain unchanged.
- Tests, lint, i18n parity, build, docs, and smoke evidence are accounted for.

Expected: no missing requirement and a clean worktree.
