# Structured Video.js/VHS Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, exact-value Video.js/VHS evidence contract for the
default web player without depending on private VHS internals.

**Architecture:** Read the public Video.js `MediaError` inside the existing
`Player#error` listener, detect active VHS through the documented
`player.tech().vhs` runtime property, and sanitize the error into a small
allowlisted evidence value. Classify only confirmed public values, keep
generic non-VHS Video.js errors on the native path, and render only the
sanitized evidence.

**Tech Stack:** Angular 21, TypeScript 5.9, Video.js 8.23.9, VHS 3.17.5, Jest
through Nx, Markdown architecture and release-note documentation.

---

### Task 0: Establish The Evidence And Baseline

**Files:**
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify:
  `node_modules/.pnpm/video.js@8.23.9/node_modules/video.js/dist/types/media-error.d.ts`
- Verify:
  `node_modules/.pnpm/@videojs+http-streaming@3.17.5_video.js@8.23.9/node_modules/@videojs/http-streaming/README.md`
- Verify:
  `node_modules/.pnpm/@videojs+http-streaming@3.17.5_video.js@8.23.9/node_modules/@videojs/http-streaming/src/videojs-http-streaming.js`

- [x] **Step 1: Install locked dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 without changing `pnpm-lock.yaml`.

- [x] **Step 2: Verify Nx workspace discovery**

Run:

```bash
pnpm nx show projects
```

Expected: exit 0 and output containing `ui-playback`, `web`, and `web-e2e`.

- [x] **Step 3: Run the affected-project baseline**

Run:

```bash
pnpm nx test ui-playback
```

Expected: 85 suites and 765 tests pass before implementation.

- [x] **Step 4: Audit exact installed and upstream versions**

Confirm:

```text
video.js = 8.23.9
@videojs/http-streaming = 3.17.5
Video.js v8.23.9 tag = 81b3cb429fae8dd00659ac5d3b0b1d2d20a283cb
VHS v3.17.5 tag = a9f9d7ac0264b373f14da1bb2f2e7fe8f2775c4f
```

Read the public Video.js `MediaError` and player error API, the VHS README
runtime properties/events, and the tagged upstream error/recovery tests.
Reject private request/loaders and undocumented retry/exclusion events from
the production design.

### Task 1: Drive The VHS Evidence Boundary From Failing Tests

**Files:**
- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/vhs-playback-evidence.util.spec.ts`
- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/vhs-playback-evidence.util.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts`

- [ ] **Step 1: Write the failing allowlist and sanitizer tests**

In `vhs-playback-evidence.util.spec.ts`, import the actual installed Video.js
runtime and the wished-for boundary:

```typescript
import videoJs from 'video.js';
import {
    VhsPlaybackEngineType,
    createVhsPlaybackEvidence,
} from './vhs-playback-evidence.util';

it('matches the installed public videojs.Error identifiers', () => {
    expect(Object.values(VhsPlaybackEngineType).sort()).toEqual(
        Object.values(videoJs.Error).sort()
    );
});
```

Add installed-runtime-shaped inputs for:

```typescript
const unsafeError = {
    code: 4,
    status: 503,
    message:
        'HLS playlist request error at URL: ' +
        'https://provider.example/live.m3u8?token=secret',
    metadata: {
        errorType: videoJs.Error.NetworkBadStatus,
        requestType: 'hls-playlist',
        uri: 'https://provider.example/live.m3u8?token=secret',
        headers: { Authorization: 'Bearer secret' },
        responseText: 'provider body secret',
    },
};
```

Expect only:

```typescript
{
    engineType: 'networkbadstatus',
    mediaErrorCode: 4,
    disposition: 'terminal',
    stage: 'unknown',
    httpStatus: 503,
}
```

Serialize the evidence and prove it contains none of the URL, token, header,
body, message, request type, or arbitrary metadata sentinels.

Cover:

- every public `videojs.Error` value;
- unknown and malformed error types;
- standard code boundaries 0/5 and invalid values;
- HTTP boundaries 399/400/599/600 and non-integers;
- exact HLS playlist, DASH manifest, and segment-operation stage mappings.

- [ ] **Step 2: Write failing classifier tests**

In `playback-diagnostics.util.spec.ts`, add wished-for
`classifyVhsPlaybackIssue` cases:

```typescript
expect(classifyVhsPlaybackIssue(networkError, metadata)).toEqual(
    expect.objectContaining({
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Vhs,
        httpStatus: 503,
        externalFallbackRecommended: false,
    })
);
```

Add regressions proving:

- exact network types classify as `network-error` without message matching;
- exact `streamingfailedtodecryptsegment` classifies as
  `drm-or-encryption`;
- standard code 5 classifies as `drm-or-encryption`;
- generic VHS code 3 stays `unknown-playback-error`;
- unknown provider values and misleading messages stay unknown;
- the diagnostic contains no `nativeErrorMessage`;
- the top-level status and structured evidence are retained.

Keep the existing generic native code-3 expectation unchanged.

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/playback-diagnostics/vhs-playback-evidence.util.spec.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts \
  --runInBand
```

Expected: FAIL because the VHS evidence model, extractor, source, and
classifier do not exist.

- [ ] **Step 4: Add the minimal evidence model**

In `playback-diagnostics.model.ts`, add const objects and extracted types:

```typescript
export const VhsPlaybackDisposition = {
    Terminal: 'terminal',
} as const;

export const VhsPlaybackStage = {
    Manifest: 'manifest',
    Playlist: 'playlist',
    Segment: 'segment',
    Unknown: 'unknown',
} as const;

export const VhsPlaybackMediaErrorCode = {
    Custom: 0,
    Aborted: 1,
    Network: 2,
    Decode: 3,
    SourceNotSupported: 4,
    Encrypted: 5,
    Unknown: 'unknown',
} as const;
```

Define `VhsPlaybackEngineType`, including an `unknown` fallback, and
`VhsPlaybackEvidence` with engine type, validated media error code, terminal
disposition, stage, and optional status. Add:

```typescript
readonly vhs?: VhsPlaybackEvidence;
```

to `PlaybackDiagnostic`, and add `Vhs: 'vhs'` to
`PlaybackDiagnosticSource`.

- [ ] **Step 5: Implement the allowlisted extractor**

In `vhs-playback-evidence.util.ts`:

- define one const object containing the exact installed public
  `videojs.Error` strings;
- validate `metadata.errorType` through a readonly set;
- validate only standard error codes 0 through 5;
- validate only integer HTTP status 400 through 599;
- map only exact public parser/segment identifiers to stages;
- return a fresh object containing only the evidence fields;
- never read the message or any metadata key other than `errorType`.

- [ ] **Step 6: Implement exact classification**

In `playback-diagnostics.util.ts`, add:

```typescript
export function classifyVhsPlaybackIssue(
    error: NativePlaybackErrorInput,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic
```

Create evidence once, then classify by validated HTTP status, exact network
types, standard network code, exact decrypt type, standard encrypted code, or
known unsupported container. Keep all remaining evidence unknown. Store the
evidence on the diagnostic, copy its status into the existing `httpStatus`,
copy its validated code into `nativeErrorCode`, and do not copy the error
message or arbitrary metadata.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run the command from step 3.

Expected: PASS for allowlisting, privacy, exact classification, code-3
unknown behavior, and unchanged native tests.

### Task 2: Route Only Active VHS Errors Through The Boundary

**Files:**
- Modify:
  `libs/ui/playback/src/lib/vjs-player/vjs-player.types.ts`
- Modify:
  `libs/ui/playback/src/lib/vjs-player/vjs-player.types.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/vjs-player/vjs-player.component.ts`
- Modify:
  `libs/ui/playback/src/lib/vjs-player/vjs-player.component.spec.ts`

- [ ] **Step 1: Write failing active-VHS detection tests**

In `vjs-player.types.spec.ts`, add expectations for a wished-for
`hasActiveVhsSourceHandler` helper:

```typescript
expect(hasActiveVhsSourceHandler(playerWithVhs)).toBe(true);
expect(hasActiveVhsSourceHandler(playerWithoutVhs)).toBe(false);
expect(hasActiveVhsSourceHandler(throwingPlayer)).toBe(false);
```

The helper may inspect only the documented `player.tech().vhs` property.

- [ ] **Step 2: Write failing component routing regressions**

Extend the player harness with an optional `vhs` object on the current tech.
Add tests proving:

- active VHS + real network error shape emits a structured VHS network
  diagnostic;
- the unsafe VHS message and metadata are absent;
- active VHS + generic code 3 emits unknown;
- no VHS + native code 3 retains `media-decode-error`;
- a populated `player.error()` still wins over `video.error`.

- [ ] **Step 3: Run the focused component tests to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/vjs-player/vjs-player.types.spec.ts \
  libs/ui/playback/src/lib/vjs-player/vjs-player.component.spec.ts \
  --runInBand
```

Expected: FAIL because active VHS detection and routing do not exist.

- [ ] **Step 4: Implement the public runtime check and routing**

Add a guarded helper in `vjs-player.types.ts` that returns true only when
`player.tech()?.vhs` is a non-null object. In
`VjsPlayerComponent.handleVideoJsError`, call
`classifyVhsPlaybackIssue` only when that helper is true and
`player.error()` returned an error. Otherwise keep
`classifyNativePlaybackIssue(playerError ?? video.error, metadata)`.

Do not add xhr hooks, VHS loader access, retry listeners, or private fields.

- [ ] **Step 5: Run the focused component tests to verify GREEN**

Run the command from step 3.

Expected: PASS.

### Task 3: Render Only Structured VHS Details

**Files:**
- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts`
- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`

- [ ] **Step 1: Write the failing safe rendering regression**

Create a VHS diagnostic carrying sanitized evidence plus provider-secret
sentinels in fields that must not be rendered. Expect:

```typescript
{
    labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
    value:
        'stage=unknown · type=networkbadstatus · code=4 · ' +
        'disposition=terminal · HTTP 503',
}
```

Prove the rendered details do not contain the provider URL, token, headers,
message, response body, or arbitrary metadata.

- [ ] **Step 2: Run the focused view test to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts \
  --runInBand
```

Expected: FAIL because the formatter has no VHS evidence branch.

- [ ] **Step 3: Implement deterministic VHS formatting**

In `formatDiagnosticErrorDetails`, add a VHS branch before generic native
formatting. Build the summary only from evidence stage, engine type, media
error code, disposition, and optional status. Add `vhs` to the diagnostic
source formatter as `Video.js / VHS`.

- [ ] **Step 4: Run the focused view test to verify GREEN**

Run the command from step 2.

Expected: PASS and the existing HLS summary remains unchanged.

### Task 4: Document, Release-Note, And Validate

**Files:**
- Modify: `docs/architecture/embedded-inline-playback.md`
- Create: `.changes/playback-structured-videojs-diagnostics.md`
- Verify: `AGENTS.md`
- Verify: `CLAUDE.md`

- [ ] **Step 1: Update the canonical diagnostic contract**

Document:

- Video.js 8.23.9 / VHS 3.17.5 public evidence boundary;
- exact allowlist and conservative classification;
- safe stage mapping;
- terminal `Player#error` semantics and recoverable VHS suppression;
- rejected private request/loader fields and unsafe payloads;
- active-VHS code 3 remaining unknown.

No `AGENTS.md` or `CLAUDE.md` change is expected because neither currently
describes this diagnostic boundary. Re-check both after the runtime diff.

- [ ] **Step 2: Add the release note**

Create:

```markdown
---
type: fix
area: playback
---

The default web player now reports safer, more accurate streaming errors:
confirmed network and encrypted-segment failures keep structured details,
while ambiguous Video.js errors remain unknown instead of suggesting the
wrong cause.
```

- [ ] **Step 3: Run targeted and affected validation**

Run:

```bash
pnpm nx test ui-playback
pnpm nx lint ui-playback
pnpm nx typecheck web
pnpm run i18n:validate
pnpm run release:notes:validate
```

If `web:typecheck` is not the actual target name, inspect
`pnpm nx show project web` and run the repository's declared typecheck target.

Expected: all commands exit 0.

- [ ] **Step 4: Complete the test-impact pass**

Use:

```bash
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget e2e
```

Record that `ui-playback` unit/component tests, lint, web typecheck, i18n, and
release-note validation cover the changed boundary. E2E is skipped unless the
implementation changes workflow, routing, playback lifecycle, or player
recovery behavior.

### Task 5: Independent Review, Final Verification, And Ready PR

**Files:**
- Review: complete diff from `origin/master...HEAD`

- [ ] **Step 1: Run an independent local Codex review**

Provide the reviewer with the user constraints, exact installed versions, and
the full diff. Ask only for actionable P0/P1/P2 correctness, privacy, public
API stability, event-ordering, regression, test, and scope findings.

- [ ] **Step 2: Fix every valid P0/P1/P2 finding with TDD**

For each finding, add or adjust a failing regression test first, verify RED,
apply the minimal fix, and verify GREEN. Reject incorrect findings with
specific source/test evidence.

- [ ] **Step 3: Repeat the independent review**

Run the same full-diff review again. Expected: no actionable P0/P1/P2
findings.

- [ ] **Step 4: Run fresh full validation**

Repeat every command from Task 4 step 3 after the final review fix. Inspect
the complete output and confirm zero failures.

- [ ] **Step 5: Inspect final scope and documentation**

Run:

```bash
git status --short
git diff --check origin/master...HEAD
git diff --stat origin/master...HEAD
git diff origin/master...HEAD
```

Confirm:

- no hls.js contract changes unless a real regression required one;
- no Shaka/mpegts redesign;
- no private VHS production access;
- no unsafe error payload retention/rendering;
- docs and one release note are present;
- no unrelated files changed.

- [ ] **Step 6: Commit, push, and create the ready PR**

Use a conventional `fix(playback): ...` commit for runtime behavior. Push
`agent/structured-vhs-diagnostics` and create a non-draft PR with the evidence
summary, privacy boundary, tests, validation, E2E rationale, and review result.
