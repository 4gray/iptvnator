# Accurate Native Playback Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #1159 so unavailable HLS sources are never misreported as unsupported codecs, while retaining an explicit HTTP error status exposed by Video.js.

**Architecture:** Extend the shared native-error input and normalized diagnostic with two safe structured fields: HTTP status and a bounded Video.js error type. Give explicit HTTP evidence precedence, keep independently known unsupported containers, and classify every other native code-4 failure as unknown; reuse the existing network/unknown UI copy and render `HTTP <status>` through existing diagnostic metadata and details surfaces.

**Tech Stack:** Angular 21, TypeScript, Video.js 8, Jest through Nx, ngx-translate JSON catalogs, Markdown release notes.

---

### Task 0: Bootstrap the Nx workspace

**Files:**
- Verify only: `package.json`
- Verify only: `pnpm-lock.yaml`

- [ ] **Step 1: Install the locked dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 without changing `pnpm-lock.yaml`.

- [ ] **Step 2: Verify Nx project discovery**

Run:

```bash
pnpm nx show projects
```

Expected: exit 0 and output containing `ui-playback`, `web`, and `web-e2e`.

### Task 1: Make native classification evidence-based

**Files:**
- Modify: `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts`
- Modify: `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts`
- Test: `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts`

- [ ] **Step 1: Write the failing classifier regressions**

In `playback-diagnostics.util.spec.ts`, replace the MPEG-TS native code-4
expectation with an unknown diagnosis and add the HTTP/opaque HLS cases:

```typescript
it('keeps ambiguous MPEG-TS native source failures unknown', () => {
    const issue = classifyNativePlaybackIssue(
        { code: 4, message: 'source not supported' },
        createPlaybackSourceMetadata({
            url: 'https://example.com/live/stream',
            mimeType: 'video/mp2t',
            player: 'videojs',
        })
    );

    expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
    expect(issue.container).toBe('mp2t');
    expect(issue.externalFallbackRecommended).toBe(false);
});

it('classifies an explicit Video.js HTTP failure as a network error', () => {
    const issue = classifyNativePlaybackIssue(
        {
            code: 4,
            message: 'The media could not be loaded',
            status: 404,
            metadata: { errorType: 'networkrequestfailed' },
        },
        createPlaybackSourceMetadata({
            url: 'https://example.com/missing/playlist.m3u8',
            mimeType: 'application/x-mpegURL',
            player: 'videojs',
        })
    );

    expect(issue).toEqual(
        expect.objectContaining({
            code: PlaybackDiagnosticCode.NetworkError,
            httpStatus: 404,
            nativeErrorType: 'networkrequestfailed',
            externalFallbackRecommended: false,
        })
    );
});

it('keeps native HLS code 4 unknown when no HTTP or codec evidence exists', () => {
    const issue = classifyNativePlaybackIssue(
        {
            code: 4,
            message:
                'The media could not be loaded, either because the server or network failed or because the format is not supported.',
        },
        createPlaybackSourceMetadata({
            url: 'https://example.com/live/playlist.m3u8',
            mimeType: 'application/x-mpegURL',
            player: 'videojs',
        })
    );

    expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
    expect(issue.externalFallbackRecommended).toBe(false);
    expect(issue.httpStatus).toBeUndefined();
});

it('does not treat opaque status zero or unsafe metadata as HTTP evidence', () => {
    const issue = classifyNativePlaybackIssue(
        {
            code: 4,
            status: 0,
            metadata: { errorType: 'request failed: token=secret value' },
        },
        createPlaybackSourceMetadata({
            url: 'https://example.com/live/playlist.m3u8',
            mimeType: 'application/x-mpegURL',
            player: 'videojs',
        })
    );

    expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
    expect(issue.httpStatus).toBeUndefined();
    expect(issue.nativeErrorType).toBeUndefined();
});
```

Keep the existing `.mkv` and `video/x-msvideo` tests unchanged so known
unsupported containers remain covered.

- [ ] **Step 2: Run the focused classifier spec to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts \
  --runInBand
```

Expected: FAIL because code 4 still becomes `unsupported-codec` and the
normalized diagnostic does not retain `httpStatus` or `nativeErrorType`.

- [ ] **Step 3: Extend the diagnostic input and output contracts**

In `playback-diagnostics.model.ts`, replace `NativePlaybackErrorInput` with:

```typescript
export interface NativePlaybackErrorMetadataInput {
    readonly errorType?: unknown;
}

export interface NativePlaybackErrorInput {
    readonly code?: number;
    readonly message?: string;
    readonly status?: number;
    readonly metadata?: NativePlaybackErrorMetadataInput;
}
```

Add these optional properties beside the existing native error properties in
`PlaybackDiagnostic`:

```typescript
readonly httpStatus?: number;
readonly nativeErrorType?: string;
```

- [ ] **Step 4: Implement safe evidence extraction and classification**

In `playback-diagnostics.util.ts`, add:

```typescript
const MIN_HTTP_ERROR_STATUS = 400;
const MAX_HTTP_ERROR_STATUS = 599;
const NATIVE_ERROR_TYPE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function getHttpErrorStatus(
    error: NativePlaybackErrorInput | MediaError | null | undefined
): number | undefined {
    if (!error || !('status' in error)) {
        return undefined;
    }

    const status = error.status;
    return typeof status === 'number' &&
        Number.isInteger(status) &&
        status >= MIN_HTTP_ERROR_STATUS &&
        status <= MAX_HTTP_ERROR_STATUS
        ? status
        : undefined;
}

function getNativeErrorType(
    error: NativePlaybackErrorInput | MediaError | null | undefined
): string | undefined {
    if (!error || !('metadata' in error)) {
        return undefined;
    }

    const errorType = error.metadata?.errorType;
    return typeof errorType === 'string' &&
        NATIVE_ERROR_TYPE_PATTERN.test(errorType)
        ? errorType
        : undefined;
}
```

At the start of `classifyNativePlaybackIssue`, extract the two values:

```typescript
const httpStatus = getHttpErrorStatus(error);
const nativeErrorType = getNativeErrorType(error);
```

Before the existing code-2 branch, add:

```typescript
if (httpStatus !== undefined) {
    return createPlaybackDiagnostic({
        code: DiagnosticCode.NetworkError,
        source: DiagnosticSource.Native,
        metadata,
        httpStatus,
        nativeErrorCode,
        nativeErrorMessage,
        nativeErrorType,
    });
}
```

Pass `nativeErrorType` through every remaining native diagnostic creation.
Change the code-4 branch to:

```typescript
if (nativeErrorCode === SOURCE_NOT_SUPPORTED_CODE) {
    return createPlaybackDiagnostic({
        code: isLikelyContainerIssue(metadata)
            ? DiagnosticCode.UnsupportedContainer
            : DiagnosticCode.UnknownPlaybackError,
        source: DiagnosticSource.Native,
        metadata,
        nativeErrorCode,
        nativeErrorMessage,
        nativeErrorType,
    });
}
```

Extend `createPlaybackDiagnostic` options and return value with:

```typescript
readonly httpStatus?: number;
readonly nativeErrorType?: string;
```

and copy both values into the resulting `PlaybackDiagnostic`.

- [ ] **Step 5: Run the classifier spec to verify GREEN**

Run the focused command from step 2 again.

Expected: PASS, including the HLS 404, ambiguous HLS, status-zero, MPEG-TS,
and known-container cases.

- [ ] **Step 6: Commit the classifier behavior**

```bash
git add \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts
git commit -m "fix(playback): classify native source errors from evidence"
```

Expected: one commit containing the normalized contract, classification rules,
and their regression coverage.

### Task 2: Verify and align the Video.js HTTP boundary

**Files:**
- Modify: `libs/ui/playback/src/lib/vjs-player/vjs-player.types.ts`
- Test: `libs/ui/playback/src/lib/vjs-player/vjs-player.component.spec.ts`

- [ ] **Step 1: Add the Video.js boundary regression**

Import `NativePlaybackErrorInput` in `vjs-player.component.spec.ts`, change the
harness `currentError` type to `NativePlaybackErrorInput | null`, and add:

```typescript
it('preserves safe Video.js HTTP context in playback diagnostics', () => {
    const issues: Array<PlaybackDiagnostic | null> = [];
    component.playbackIssue.subscribe((issue) => issues.push(issue));
    render({
        sources: [
            {
                src: 'https://example.test/missing/playlist.m3u8',
                type: 'application/x-mpegURL',
            },
        ],
    });
    harness.currentError = {
        code: 4,
        message: 'The media could not be loaded',
        status: 404,
        metadata: { errorType: 'networkrequestfailed' },
    };

    harness.emit('error');

    expect(issues.at(-1)).toEqual(
        expect.objectContaining({
            code: 'network-error',
            source: 'native',
            sourceUrl: 'https://example.test/missing/playlist.m3u8',
            httpStatus: 404,
            nativeErrorType: 'networkrequestfailed',
            externalFallbackRecommended: false,
        })
    );
});
```

Keep the existing MKV unsupported-container test.

- [ ] **Step 2: Run the focused component integration spec**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/vjs-player/vjs-player.component.spec.ts \
  --runInBand
```

Expected: PASS after Task 1. JavaScript already passes the complete error
object at runtime; this regression proves that the component does not rebuild
or strip it before classification.

- [ ] **Step 3: Reuse the shared native-error contract**

At the top of `vjs-player.types.ts`, add:

```typescript
import type { NativePlaybackErrorInput } from '../playback-diagnostics/playback-diagnostics.model';
```

Replace the `error` signature with:

```typescript
error: () => NativePlaybackErrorInput | null;
```

No component implementation change is required because
`VjsPlayerComponent.handleVideoJsError` already passes the complete
`player.error()` object to `classifyNativePlaybackIssue`.

- [ ] **Step 4: Verify the aligned Video.js type contract**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/vjs-player/vjs-player.component.spec.ts \
  --runInBand
pnpm exec tsc -p libs/ui/playback/tsconfig.lib.json --noEmit
```

Expected: both commands pass for the HTTP integration case, existing
source/reset behavior, and the production library type graph. The behavioral
RED/GREEN proof lives in Task 1; this task aligns the TypeScript declaration
with the already-tested runtime payload.

- [ ] **Step 5: Commit the Video.js boundary**

```bash
git add \
  libs/ui/playback/src/lib/vjs-player/vjs-player.types.ts \
  libs/ui/playback/src/lib/vjs-player/vjs-player.component.spec.ts
git commit -m "fix(playback): preserve Video.js HTTP error context"
```

Expected: one commit containing only the Video.js type boundary and component
regression.

### Task 3: Render explicit HTTP evidence

**Files:**
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts`
- Test: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`

- [ ] **Step 1: Write the failing rendered-diagnostic regression**

Add this helper in `web-player-view.component.spec.ts`:

```typescript
function createHttpDiagnostic(): PlaybackDiagnostic {
    return {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: 'https://example.com/missing/playlist.m3u8',
        container: 'm3u8',
        mimeType: 'application/x-mpegURL',
        player: 'videojs',
        audioCodecs: [],
        videoCodecs: [],
        httpStatus: 404,
        nativeErrorCode: 4,
        nativeErrorMessage: 'The media could not be loaded',
        nativeErrorType: 'networkrequestfailed',
        externalFallbackRecommended: false,
    };
}
```

Add this component test:

```typescript
it('renders explicit HTTP evidence without recommending an external player', () => {
    runtimeCapabilities.supportsManagedExternalPlayers = true;
    fixture.detectChanges();
    const issue = createHttpDiagnostic();

    component.handlePlaybackIssue(issue);
    fixture.detectChanges();

    const banner = fixture.debugElement.query(
        By.css('[data-test-id="playback-diagnostic-banner"]')
    );
    const mpvButton = fixture.debugElement.query(
        By.css('[data-test-id="playback-fallback-mpv"]')
    );

    expect(banner.nativeElement.textContent).toContain('HTTP 404');
    expect(mpvButton).toBeNull();
    expect(component.getDiagnosticMeta(issue)).toBe('HTTP 404');
    expect(component.getDiagnosticDetails(issue)).toEqual(
        expect.arrayContaining([
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                value: 'HTTP 404 · networkrequestfailed',
            },
        ])
    );
});
```

- [ ] **Step 2: Run the focused view spec to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts \
  --runInBand
```

Expected: FAIL because the metadata still renders `m3u8` and the details helper
does not include the structured HTTP context.

- [ ] **Step 3: Format HTTP metadata and safe error details**

At the start of `getDiagnosticMeta`, add:

```typescript
if (issue.httpStatus !== undefined) {
    return `HTTP ${issue.httpStatus}`;
}
```

Replace the final error-details item in `getDiagnosticDetails` with:

```typescript
{
    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
    value: formatDiagnosticErrorDetails(issue),
},
```

Add:

```typescript
function formatDiagnosticErrorDetails(issue: PlaybackDiagnostic): string {
    return [
        issue.httpStatus === undefined ? '' : `HTTP ${issue.httpStatus}`,
        issue.nativeErrorType ?? '',
        issue.details ?? '',
    ]
        .filter((value) => value.length > 0)
        .join(' · ');
}
```

Keep the existing translation keys and template unchanged.

- [ ] **Step 4: Run the view spec to verify GREEN**

Run the focused command from step 2 again.

Expected: PASS with visible `HTTP 404`, no MPV action, and the combined safe
details row.

- [ ] **Step 5: Run all affected unit tests and lint**

Run:

```bash
pnpm nx test ui-playback
pnpm nx lint ui-playback
```

Expected: both commands exit 0 with no failed tests or lint errors.

- [ ] **Step 6: Commit the rendered evidence**

```bash
git add \
  libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
git commit -m "fix(playback): show explicit HTTP playback errors"
```

Expected: one commit containing the diagnostic presentation and component
coverage.

### Task 4: Document the behavior and add the release note

**Files:**
- Modify: `docs/architecture/embedded-inline-playback.md`
- Create: `.changes/playback-accurate-source-errors.md`

- [ ] **Step 1: Update the canonical playback documentation**

Add this paragraph after the supported diagnostic-code list in
`docs/architecture/embedded-inline-playback.md`:

```markdown
Native `MediaError` code 4 is not codec evidence by itself. A source already
known to use a browser-incompatible container remains
`unsupported-container`; otherwise the native failure stays
`unknown-playback-error`. When Video.js exposes an explicit HTTP error status,
the failure is classified as `network-error`, the status is shown in the
diagnostic, and an external decoder is not presented as a likely fix for the
same failed request.
```

- [ ] **Step 2: Add the user-facing release note**

Create `.changes/playback-accurate-source-errors.md` with:

```markdown
---
type: fix
area: playback
issues: [1159]
---

Unavailable streams no longer appear as unsupported codecs. When Video.js
exposes a server error such as HTTP 404, the player shows that status; otherwise
ambiguous source errors remain unidentified instead of guessing.
```

- [ ] **Step 3: Validate documentation and release metadata**

Run:

```bash
git diff --check
pnpm run release:notes:validate
pnpm run i18n:check
```

Expected: all commands exit 0. The release note validates, and no translation
catalog drift is introduced because the implementation reuses existing keys.

- [ ] **Step 4: Commit documentation and release note**

```bash
git add \
  docs/architecture/embedded-inline-playback.md \
  .changes/playback-accurate-source-errors.md
git commit -m "docs(playback): document native error evidence"
```

Expected: one commit containing the canonical behavior contract and the
issue-linked release note.

### Task 5: Complete verification and local Codex review

**Files:**
- Verify: all files changed from `origin/master`

- [ ] **Step 1: Run the final affected validation ladder**

Run:

```bash
pnpm nx test ui-playback
pnpm nx lint ui-playback
pnpm run typecheck:web
pnpm run i18n:check
pnpm run release:notes:validate
git diff --check origin/master...HEAD
git status --short
```

Expected: every command exits 0, all `ui-playback` tests pass, and the worktree
is clean. E2E is not required because no player selection, route, interaction,
or overlay layout changes; classifier, boundary, and rendered output are
covered by focused component tests.

- [ ] **Step 2: Dispatch a fresh local Codex reviewer**

Resolve the exact review range:

```bash
git rev-parse origin/master
git rev-parse HEAD
```

Dispatch a fresh reviewer agent with no implementation-history context and
this request:

```text
Review origin/master...HEAD for issue #1159 against
docs/superpowers/specs/2026-07-30-accurate-native-playback-diagnostics-design.md.
Focus on correctness, regressions, unsafe disclosure, TypeScript/runtime
contract mismatches, and missing tests. Report only actionable P0/P1/P2
findings with exact file and line references; do not report style-only nits.
Do not modify files.
```

Expected: a local Codex review report before any push or PR creation.

- [ ] **Step 3: Verify and resolve every P1/P2 finding**

For each reported finding:

1. Reproduce or prove it from the code and tests.
2. Add or update a regression test first when behavior changes.
3. Run the focused test and observe the expected RED result.
4. Apply the smallest valid fix.
5. Run the focused test to GREEN.

If the review has confirmed P1/P2 findings, stage the tracked files changed by
the verified fixes and commit them with:

```bash
git add -u
git commit -m "fix(playback): address local review findings"
```

If a finding is invalid, record the concrete code/test evidence for rejecting
it in the task summary instead of changing the implementation.

- [ ] **Step 4: Re-review after fixes**

If step 3 changed any file, send the same reviewer a follow-up request to
re-check the new `origin/master...HEAD` diff for remaining P0/P1/P2 findings.
Repeat steps 3 and 4 until no confirmed P1/P2 findings remain.

- [ ] **Step 5: Re-run final verification after review**

Run the complete validation command set from step 1 again.

Expected: all commands exit 0 after the final review changes, and
`git status --short` is empty.

### Task 6: Push and create the focused pull request

**Files:**
- Verify only: `.github/pull_request_template.md` when present

- [ ] **Step 1: Inspect the final commit range**

Run:

```bash
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
git status --short --branch
```

Expected: only the design/plan, focused diagnostic implementation, regression
tests, canonical documentation, and release note are present; the worktree is
clean.

- [ ] **Step 2: Push the branch**

Run:

```bash
git push -u origin agent/fix-playback-diagnostic-1159
```

Expected: push succeeds and configures the upstream branch.

- [ ] **Step 3: Create the ready pull request**

Create a non-draft PR with title:

```text
fix(playback): avoid false codec diagnostics
```

Use this body:

```markdown
## Summary

- stop treating an ambiguous native `MediaError` code 4 as proof of an unsupported codec
- preserve and show explicit Video.js HTTP error statuses such as 404
- keep confirmed container/codec diagnostics and external fallback behavior evidence-based

## Testing

- `pnpm nx test ui-playback`
- `pnpm nx lint ui-playback`
- `pnpm run typecheck:web`
- `pnpm run i18n:check`
- `pnpm run release:notes:validate`
- local Codex review completed with no unresolved P1/P2 findings

Closes #1159
```

Expected: a ready PR targeting `master`, created only after local review and
final validation succeed.
