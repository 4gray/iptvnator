# Structured mpegts.js Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mpegts.js message heuristics with a version-locked,
allowlisted evidence boundary shared by HTML5, Video.js, and ArtPlayer.

**Architecture:** Normalize only mpegts.js 1.8.0 public error type/detail
constants and the exact HTTP-status slot into `MpegTsPlaybackEvidence`. The
shared classifier maps internally consistent evidence to existing diagnostic
codes, and the existing viewport renders only structured evidence while the
three engine owners keep their current source and lifecycle behavior.

**Tech Stack:** Angular 21, TypeScript 5.9, mpegts.js 1.8.0, Jest through Nx,
Markdown architecture and release-note documentation.

---

### Task 0: Confirm The Isolated Baseline And Public Runtime

**Files:**

- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `node_modules/mpegts.js/src/player/player-errors.js`
- Verify: `node_modules/mpegts.js/src/io/loader.js`
- Verify: `node_modules/mpegts.js/src/core/transmuxing-controller.js`
- Verify: `node_modules/mpegts.js/d.ts/mpegts.d.ts`

- [x] **Step 1: Create the isolated feature branch from current master**

Run:

```bash
git switch -c agent/structure-mpegts-diagnostics origin/master
```

Expected: branch starts at `9f4e11d6d`, the merge of PR #1318.

- [x] **Step 2: Verify dependency and Nx availability**

Run:

```bash
test -d node_modules
pnpm nx show projects --withTarget test
```

Expected: exit 0 and output containing `ui-playback`.

- [x] **Step 3: Run the affected-project baseline**

Run:

```bash
pnpm nx test ui-playback
```

Expected: 87 suites and 849 tests pass before implementation.

- [x] **Step 4: Audit the installed public contract**

Confirm:

```text
mpegts.js version = 1.8.0
ErrorTypes = NetworkError, MediaError, OtherError
ErrorDetails = Exception, HttpStatusCodeInvalid, ConnectingTimeout,
               UnrecoverableEarlyEof, MediaMSEError, FormatError,
               FormatUnsupported, CodecUnsupported
HttpStatusCodeInvalid info = { code: HTTP status, msg: status text }
recoverable EarlyEof is handled internally before the public player error
```

### Task 1: Drive The Public Evidence Boundary From Failing Tests

**Files:**

- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.model.ts`
- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.ts`
- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.spec.ts`

- [ ] **Step 1: Write the failing installed-runtime contract test**

Create `mpegts-playback-evidence.util.spec.ts` and assert the real installed
runtime before using any mocks:

```typescript
import mpegts from 'mpegts.js';
import {
    MpegTsPlaybackEngineDetails,
    MpegTsPlaybackEngineType,
} from './mpegts-playback-evidence.model';
import {
    MPEGTS_DIAGNOSTIC_VERSION,
    createMpegTsPlaybackEvidence,
} from './mpegts-playback-evidence.util';

describe('mpegts.js playback evidence', () => {
    it('locks the accepted public contract to mpegts.js 1.8.0', () => {
        expect(mpegts.version).toBe(MPEGTS_DIAGNOSTIC_VERSION);
        expect(mpegts.ErrorTypes).toEqual({
            NETWORK_ERROR: MpegTsPlaybackEngineType.Network,
            MEDIA_ERROR: MpegTsPlaybackEngineType.Media,
            OTHER_ERROR: MpegTsPlaybackEngineType.Other,
        });
        expect(mpegts.ErrorDetails).toEqual({
            NETWORK_EXCEPTION:
                MpegTsPlaybackEngineDetails.NetworkException,
            NETWORK_STATUS_CODE_INVALID:
                MpegTsPlaybackEngineDetails.HttpStatusCodeInvalid,
            NETWORK_TIMEOUT:
                MpegTsPlaybackEngineDetails.ConnectingTimeout,
            NETWORK_UNRECOVERABLE_EARLY_EOF:
                MpegTsPlaybackEngineDetails.UnrecoverableEarlyEof,
            MEDIA_MSE_ERROR: MpegTsPlaybackEngineDetails.MediaMseError,
            MEDIA_FORMAT_ERROR: MpegTsPlaybackEngineDetails.FormatError,
            MEDIA_FORMAT_UNSUPPORTED:
                MpegTsPlaybackEngineDetails.FormatUnsupported,
            MEDIA_CODEC_UNSUPPORTED:
                MpegTsPlaybackEngineDetails.CodecUnsupported,
        });
    });
});
```

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts --runTestsByPath \
  libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.spec.ts \
  --runInBand
```

Expected: FAIL because the model and evidence modules do not exist.

- [ ] **Step 2: Add the focused evidence model**

Create `mpegts-playback-evidence.model.ts` with const-derived unions:

```typescript
export const MpegTsPlaybackEngineType = {
    Network: 'NetworkError',
    Media: 'MediaError',
    Other: 'OtherError',
    Unknown: 'unknown',
} as const;

export type MpegTsPlaybackEngineType =
    (typeof MpegTsPlaybackEngineType)[keyof typeof MpegTsPlaybackEngineType];

export const MpegTsPlaybackEngineDetails = {
    NetworkException: 'Exception',
    HttpStatusCodeInvalid: 'HttpStatusCodeInvalid',
    ConnectingTimeout: 'ConnectingTimeout',
    UnrecoverableEarlyEof: 'UnrecoverableEarlyEof',
    MediaMseError: 'MediaMSEError',
    FormatError: 'FormatError',
    FormatUnsupported: 'FormatUnsupported',
    CodecUnsupported: 'CodecUnsupported',
    Unknown: 'unknown',
} as const;

export type MpegTsPlaybackEngineDetails =
    (typeof MpegTsPlaybackEngineDetails)[keyof typeof MpegTsPlaybackEngineDetails];

export const MpegTsPlaybackDisposition = { Terminal: 'terminal' } as const;
export type MpegTsPlaybackDisposition =
    (typeof MpegTsPlaybackDisposition)[keyof typeof MpegTsPlaybackDisposition];
export const MpegTsPlaybackStage = {
    Loader: 'loader',
    Demux: 'demux',
    MediaSource: 'media-source',
    Unknown: 'unknown',
} as const;
export type MpegTsPlaybackStage =
    (typeof MpegTsPlaybackStage)[keyof typeof MpegTsPlaybackStage];
export const MpegTsPlaybackFailure = {
    Http: 'http',
    Timeout: 'timeout',
    Network: 'network',
    TruncatedStream: 'truncated-stream',
    Format: 'format',
    Codec: 'codec',
    MediaSource: 'media-source',
    Unknown: 'unknown',
} as const;
export type MpegTsPlaybackFailure =
    (typeof MpegTsPlaybackFailure)[keyof typeof MpegTsPlaybackFailure];

export interface MpegTsPlaybackEvidence {
    readonly engineType: MpegTsPlaybackEngineType;
    readonly engineDetails: MpegTsPlaybackEngineDetails;
    readonly disposition: MpegTsPlaybackDisposition;
    readonly stage: MpegTsPlaybackStage;
    readonly failure: MpegTsPlaybackFailure;
    readonly httpStatus?: number;
}
```

Use const-derived aliases for disposition, stage, and failure rather than
duplicating string unions if TypeScript reports drift.

- [ ] **Step 3: Add failing sanitization and mapping cases**

Extend the spec with a table covering every consistent pair and expected
stage/failure. Add explicit cases proving:

```typescript
expect(
    createMpegTsPlaybackEvidence('NetworkError', 'HttpStatusCodeInvalid', {
        code: 404,
        msg: 'Not Found secret',
        url: 'https://provider.example/live.ts?token=secret',
    })
).toEqual({
    engineType: 'NetworkError',
    engineDetails: 'HttpStatusCodeInvalid',
    disposition: 'terminal',
    stage: 'loader',
    failure: 'http',
    httpStatus: 404,
});

expect(
    createMpegTsPlaybackEvidence('OtherError', 'CodecUnsupported', {
        code: 503,
    })
).toEqual({
    engineType: 'OtherError',
    engineDetails: 'CodecUnsupported',
    disposition: 'terminal',
    stage: 'unknown',
    failure: 'unknown',
});
```

Also assert status strings, 399, 600, nested `code`, lowercase constants,
unknown objects, and circular payloads do not add `httpStatus` or throw.

Run the focused spec. Expected: FAIL because the factory is missing.

- [ ] **Step 4: Implement the minimal sanitizer**

Create `mpegts-playback-evidence.util.ts` with:

```typescript
export const MPEGTS_DIAGNOSTIC_VERSION = '1.8.0';

export function createMpegTsPlaybackEvidence(
    type: unknown,
    details: unknown,
    info: unknown
): MpegTsPlaybackEvidence {
    const engineType = normalizeEngineType(type);
    const engineDetails = normalizeEngineDetails(details);
    const { stage, failure } = deriveMpegTsStageAndFailure(
        engineType,
        engineDetails
    );
    const httpStatus =
        engineType === MpegTsPlaybackEngineType.Network &&
        engineDetails ===
            MpegTsPlaybackEngineDetails.HttpStatusCodeInvalid
            ? readHttpStatus(info)
            : undefined;

    return {
        engineType,
        engineDetails,
        disposition: MpegTsPlaybackDisposition.Terminal,
        stage,
        failure,
        ...(httpStatus === undefined ? {} : { httpStatus }),
    };
}
```

Implement exact `switch` statements for type/detail normalization and the
eight accepted pairs. `readHttpStatus` reads only top-level `code` and accepts
integers 400–599. Do not stringify, clone, enumerate, or inspect any message or
unknown property.

- [ ] **Step 5: Run the evidence spec green**

Run the focused Jest command from Step 1.

Expected: PASS with the runtime contract and sanitizer cases green.

- [ ] **Step 6: Commit the evidence boundary**

```bash
git add -- \
  libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.model.ts \
  libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.ts \
  libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.spec.ts
git commit -m "fix(playback): sanitize mpegts error evidence"
```

### Task 2: Replace Heuristic Classification With Structured Evidence

**Files:**

- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-error-patterns.util.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts`
- Test:
  `libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.spec.ts`

- [ ] **Step 1: Write failing classifier tests**

Add table-driven expectations that pass evidence, not raw errors:

```typescript
const issue = classifyMpegTsPlaybackIssue(
    createMpegTsPlaybackEvidence(
        'NetworkError',
        'HttpStatusCodeInvalid',
        { code: 404, msg: 'secret' }
    ),
    createPlaybackSourceMetadata({
        url: 'https://example.test/missing.ts',
        mimeType: 'video/mp2t',
        player: InlinePlaybackPlayer.VideoJs,
    })
);

expect(issue).toEqual(
    expect.objectContaining({
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.MpegTs,
        httpStatus: 404,
        mpegTs: expect.objectContaining({ failure: 'http' }),
        externalFallbackRecommended: false,
    })
);
expect(issue.details).toBeUndefined();
```

Cover timeout/exception → network, early EOF/format/MSE → media decode,
unsupported format → container, codec → codec, and inconsistent/other/unknown
→ unknown. Verify only decode/container/codec outcomes recommend fallback.

Run the evidence and diagnostics specs. Expected: FAIL because the classifier
still accepts raw `MpegTsPlaybackErrorInput` and emits `details`.

- [ ] **Step 2: Wire evidence into the shared diagnostic model**

In `playback-diagnostics.model.ts`:

```typescript
import type { MpegTsPlaybackEvidence } from './mpegts-playback-evidence.model';
export * from './mpegts-playback-evidence.model';
```

Remove `MpegTsPlaybackErrorInput` and add:

```typescript
readonly mpegTs?: MpegTsPlaybackEvidence;
```

to `PlaybackDiagnostic`.

- [ ] **Step 3: Implement evidence-only classification**

Change the signature to:

```typescript
export function classifyMpegTsPlaybackIssue(
    evidence: MpegTsPlaybackEvidence,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic
```

Map the exact failures from the approved design, pass
`httpStatus: evidence.httpStatus` and `mpegTs: evidence` to
`createPlaybackDiagnostic`, and add `mpegTs` to that factory's options,
destructuring, and result. Export `createMpegTsPlaybackEvidence` from the
diagnostics facade.

- [ ] **Step 4: Remove obsolete mpegts text helpers**

Delete `normalizeErrorDetails`, `isNetworkFailure`, `isEarlyEofFailure`, and
their serialization helpers from `playback-error-patterns.util.ts`. Keep
`isBrowserAccessFailure` for native browser errors. Remove other now-unused
text helpers only when `rg` proves they have no callers.

Run:

```bash
rg -n "normalizeErrorDetails|isNetworkFailure|isEarlyEofFailure|MpegTsPlaybackErrorInput" \
  libs/ui/playback/src/lib
```

Expected: no matches.

- [ ] **Step 5: Run classifier tests green**

Run both focused specs by path.

Expected: PASS with no raw message or arbitrary payload retained.

- [ ] **Step 6: Commit structured classification**

```bash
git add -- \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-error-patterns.util.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts \
  libs/ui/playback/src/lib/playback-diagnostics/mpegts-playback-evidence.util.spec.ts
git commit -m "fix(playback): classify exact mpegts failures"
```

### Task 3: Route HTML5 Through The Shared Boundary

**Files:**

- Modify:
  `libs/ui/playback/src/lib/html-video-player/html-video-player-diagnostics.ts`
- Modify:
  `libs/ui/playback/src/lib/html-video-player/html-video-player.component.shared-controls.spec-fixtures.ts`
- Modify:
  `libs/ui/playback/src/lib/html-video-player/html-video-player.component.shared-controls.sources.spec.ts`

- [ ] **Step 1: Make the mpegts fixture emit registered events**

Give `MockMpegTsPlayer` a listener map and `emit(event, ...args)` helper, matching
the existing VJS and ArtPlayer test doubles. Preserve lifecycle logging for
`on`, `off`, attachment, and load.

- [ ] **Step 2: Write the failing HTML5 HTTP regression**

Start a `.ts` source, emit:

```typescript
engine.emit('error', 'NetworkError', 'HttpStatusCodeInvalid', {
    code: 404,
    msg: 'Not Found html-secret',
    url: 'https://provider.example/error?token=html-secret',
});
```

Assert the component emits HTML5 source metadata, `network-error`, HTTP 404,
structured `mpegTs` evidence, no raw `details`, and no external fallback.

Run the focused sources spec. Expected: FAIL because the HTML5 helper still
passes a raw error object to the classifier.

- [ ] **Step 3: Normalize before classification**

Import `createMpegTsPlaybackEvidence` in
`html-video-player-diagnostics.ts` and change:

```typescript
classifyMpegTsPlaybackIssue(
    createMpegTsPlaybackEvidence(error.type, error.details, error.info),
    createHtml5SourceMetadata(url, 'video/mp2t')
)
```

Accept unknown callback values so normalization owns validation.

- [ ] **Step 4: Run the HTML5 regression green and commit**

Run the focused sources spec, then:

```bash
git add -- \
  libs/ui/playback/src/lib/html-video-player/html-video-player-diagnostics.ts \
  libs/ui/playback/src/lib/html-video-player/html-video-player.component.shared-controls.spec-fixtures.ts \
  libs/ui/playback/src/lib/html-video-player/html-video-player.component.shared-controls.sources.spec.ts
git commit -m "fix(playback): structure HTML5 mpegts errors"
```

### Task 4: Route Video.js And ArtPlayer Through The Same Boundary

**Files:**

- Modify: `libs/ui/playback/src/lib/vjs-player/vjs-mpegts-session.ts`
- Modify: `libs/ui/playback/src/lib/vjs-player/vjs-mpegts-session.spec.ts`
- Modify: `libs/ui/playback/src/lib/art-player/art-player-source-session.ts`
- Modify: `libs/ui/playback/src/lib/art-player/art-player-source-session.spec.ts`
- Modify: `libs/ui/playback/src/lib/art-player/art-player.component.spec.ts`

- [ ] **Step 1: Replace the misleading VJS CORS regression**

Change the existing synthetic `FetchError`/CORS case to the real public event:

```typescript
mpegTsPlayer.emit(
    'error',
    'NetworkError',
    'HttpStatusCodeInvalid',
    { code: 503, msg: 'provider secret', headers: { Authorization: 'secret' } }
);
```

Expect `network-error`, HTTP 503, `player=videojs`, exact mpegts evidence, no
fallback, and serialized output without either secret. Add a generic
`NetworkError + Exception` case proving message text that says CORS remains a
generic network diagnostic.

Run the VJS session spec. Expected: FAIL under the raw classifier contract.

- [ ] **Step 2: Normalize in VjsMpegTsSession**

Import the factory and call:

```typescript
classifyMpegTsPlaybackIssue(
    createMpegTsPlaybackEvidence(type, details, info),
    createPlaybackSourceMetadata({
        url,
        mimeType: 'video/mp2t',
        player: InlinePlaybackPlayer.VideoJs,
    })
)
```

Keep duration sync, listener cleanup, play, and teardown unchanged.

- [ ] **Step 3: Add the failing ArtPlayer structured regression**

Emit `MediaError + CodecUnsupported` with a secret-bearing `info` object.
Assert `unsupported-codec`, `player=artplayer`, structured evidence, fallback
enabled, and no secret in the emitted issue. Update old lowercase/message-based
fixtures to exact public constants.

Run the ArtPlayer source-session and component specs. Expected: FAIL until the
session uses the factory.

- [ ] **Step 4: Normalize in ArtPlayerSourceSession**

Import `createMpegTsPlaybackEvidence` and pass the callback arguments through
it before the shared classifier. Change the stored listener parameter types to
`unknown` so the sanitizer, not the adapter, owns validation. Preserve the
destroyed/current-engine guard.

- [ ] **Step 5: Run all three engine-owner specs green and commit**

Run HTML5 sources, VJS session, ArtPlayer source-session, and ArtPlayer
component specs by path. Then:

```bash
git add -- \
  libs/ui/playback/src/lib/vjs-player/vjs-mpegts-session.ts \
  libs/ui/playback/src/lib/vjs-player/vjs-mpegts-session.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player.component.spec.ts
git commit -m "fix(playback): share mpegts evidence across players"
```

### Task 5: Render Only Structured mpegts.js Details

**Files:**

- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts`
- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`

- [ ] **Step 1: Write the failing rendering and privacy regression**

Add `createStructuredMpegTsDiagnostic()` with structured HTTP 404 evidence plus
legacy `details` and native message fields containing sentinels. Assert:

```typescript
expect(component.getDiagnosticDetails(issue)).toEqual(
    expect.arrayContaining([
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
            value:
                'stage=loader · failure=http · type=NetworkError · ' +
                'details=HttpStatusCodeInvalid · disposition=terminal · HTTP 404',
        },
    ])
);
expect(renderedDetails).not.toContain('mpegts-render-secret');
expect(component.getDiagnosticMeta(issue)).toBe('HTTP 404');
```

Run the component spec. Expected: FAIL because mpegts evidence is not formatted.

- [ ] **Step 2: Add the structured formatter branch**

Before VHS/HLS legacy formatting, add:

```typescript
if (issue.mpegTs) {
    return [
        `stage=${issue.mpegTs.stage}`,
        `failure=${issue.mpegTs.failure}`,
        `type=${issue.mpegTs.engineType}`,
        `details=${issue.mpegTs.engineDetails}`,
        `disposition=${issue.mpegTs.disposition}`,
        issue.mpegTs.httpStatus === undefined
            ? ''
            : `HTTP ${issue.mpegTs.httpStatus}`,
    ]
        .filter((value) => value.length > 0)
        .join(' · ');
}
```

Also suppress the native-message row when `issue.mpegTs` exists, matching the
HLS/VHS/Shaka structured boundaries.

- [ ] **Step 3: Run the view regression green and commit**

```bash
git add -- \
  libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
git commit -m "fix(playback): render structured mpegts evidence"
```

### Task 6: Update Canonical Documentation And Release Note

**Files:**

- Modify: `docs/architecture/embedded-inline-playback.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `.changes/playback-structured-mpegts-diagnostics.md`

- [ ] **Step 1: Update the canonical diagnostic contract**

Replace the current early-EOF-only mpegts paragraph with the 1.8.0 public
boundary: exact type/detail pairs, terminal player events, validated HTTP
status, classification mapping, rejected raw fields, all three owners, and the
absence of message-based browser-access guesses.

- [ ] **Step 2: Keep repository guidance current**

Add the same concise contract to the mpegts ownership summaries in `AGENTS.md`
and `CLAUDE.md`: all three owners use the shared version-locked evidence
boundary; raw payloads do not cross it; shared controls remain unchanged.

- [ ] **Step 3: Add the user-facing release note**

Create:

```markdown
---
type: fix
area: playback
issues: [1159]
---

MPEG-TS playback errors now show exact engine evidence, including HTTP status,
without exposing provider response details. Format, codec, truncated-stream,
and MediaSource failures now produce more accurate fallback guidance.
```

Keep the body below 400 characters.

- [ ] **Step 4: Validate docs and note, then commit**

Run:

```bash
git diff --check
pnpm run release:notes:validate
```

Expected: exit 0. Then:

```bash
git add -- \
  docs/architecture/embedded-inline-playback.md \
  AGENTS.md CLAUDE.md \
  .changes/playback-structured-mpegts-diagnostics.md
git commit -m "docs(playback): document structured mpegts diagnostics"
```

### Task 7: Complete Validation And Local P1/P2 Review

**Files:**

- Verify all files changed since `origin/master`

- [ ] **Step 1: Run focused regression tests**

Run all new and changed spec files by path with the web ESM Jest config.

Expected: every focused suite passes.

- [ ] **Step 2: Run the affected validation ladder**

```bash
pnpm nx test ui-playback
pnpm nx lint ui-playback
pnpm run typecheck:web
pnpm run i18n:check
pnpm run release:notes:validate
```

Expected: all commands exit 0. No new E2E is required because source routing,
player lifecycle, actions, and UI layout do not change; engine events, all
three adapters, classification, privacy, and rendered output have deterministic
unit/integration coverage.

- [ ] **Step 3: Inspect size, scope, and accidental raw-data retention**

```bash
git diff --check origin/master...HEAD
git diff --stat origin/master...HEAD
rg -n "JSON\.stringify|info\.msg|error\.message|normalizeErrorDetails|isNetworkFailure|isEarlyEofFailure" \
  libs/ui/playback/src/lib/playback-diagnostics \
  libs/ui/playback/src/lib/html-video-player/html-video-player-diagnostics.ts \
  libs/ui/playback/src/lib/vjs-player/vjs-mpegts-session.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.ts
```

Expected: no mpegts error serialization/message inference; any unrelated
matches are inspected and justified.

- [ ] **Step 4: Perform the requested local Codex review**

Review `origin/master...HEAD` specifically for P1/P2 defects:

- false classification from mismatched type/detail pairs;
- unvalidated or duplicated HTTP status;
- raw provider data escaping through top-level or rendered fields;
- different behavior among HTML5, Video.js, and ArtPlayer;
- missing stale-listener/teardown guards;
- incorrect fallback behavior;
- version-lock drift;
- missing tests or stale canonical docs.

Fix every confirmed P1/P2 finding through a new failing regression first, rerun
the focused and affected validation ladders, and commit the fixes. Repeat until
the review is clean.

- [ ] **Step 5: Verify the final branch state**

```bash
git status --short --branch
git log --oneline origin/master..HEAD
git diff --check origin/master...HEAD
```

Expected: clean worktree, focused commits only, and no whitespace errors.

### Task 8: Publish The Pull Request After Explicit Authorization

**Files:**

- Inspect: all changes in `origin/master...HEAD`

- [ ] **Step 1: Confirm final staged and branch scope**

Do not stage unrelated files. Verify the exact branch and commits before push.

- [ ] **Step 2: Push only after user authorization**

```bash
git push -u origin agent/structure-mpegts-diagnostics
```

- [ ] **Step 3: Create one ready PR only after user authorization**

Use base `master`, head `agent/structure-mpegts-diagnostics`, and summarize:

- version-locked public mpegts.js evidence;
- exact HTTP/format/codec/EOF/MSE classification;
- shared HTML5, Video.js, and ArtPlayer integration;
- privacy boundary and future recommendation-layer compatibility;
- tests and validation run.

Link issue #1159 and include the release note. Do not create multiple or draft
PRs unless the user requests that state.
