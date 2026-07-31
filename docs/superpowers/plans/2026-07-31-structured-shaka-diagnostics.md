# Structured Shaka Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw Shaka error retention with a version-locked, public,
allowlisted evidence boundary that distinguishes recoverable events from
terminal load failures.

**Architecture:** Normalize only Shaka 5.2.2 public severity/category/code
values and documented HTTP status layouts into `ShakaPlaybackEvidence`.
`ShakaVideoSession` supplies the lifecycle disposition, the classifier maps
only exact category/code pairs, and the existing UI renders only structured
evidence.

**Tech Stack:** Angular 21, TypeScript 5.9, Shaka Player 5.2.2, Jest through
Nx, Markdown architecture and release-note documentation.

---

### Task 0: Establish The Evidence And Baseline

**Files:**

- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `node_modules/shaka-player/lib/util/error.js`
- Verify: `node_modules/shaka-player/lib/net/http_plugin_utils.js`
- Verify: `node_modules/shaka-player/lib/net/networking_engine.js`
- Verify: `node_modules/shaka-player/lib/media/preload_manager.js`
- Verify: `node_modules/shaka-player/lib/player.js`
- Verify: `node_modules/shaka-player/dist/shaka-player.compiled.d.ts`

- [x] **Step 1: Install locked dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0, Shaka Player `5.2.2`, and no lockfile change.

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

Expected: 86 suites and 801 tests pass before implementation.

- [x] **Step 4: Audit the installed public runtime**

Confirm:

```text
shaka.Player.version = v5.2.2
Severity = { RECOVERABLE: 1, CRITICAL: 2 }
Category = {
  NETWORK: 1, TEXT: 2, MEDIA: 3, MANIFEST: 4, STREAMING: 5,
  DRM: 6, PLAYER: 7, CAST: 8, STORAGE: 9, ADS: 10
}
BAD_HTTP_STATUS data[1] = HTTP status
LICENSE_REQUEST_FAILED data[0] = nested Shaka network error
SERVER_CERTIFICATE_REQUEST_FAILED data[0] = nested Shaka network error
```

Confirm the installed event order:

```text
recoverable Player#error -> engine continues
critical PreloadManager error -> public error event -> load rejection
direct manifest/parser throw -> load rejection without required error event
attempts exhausted -> final recoverable-severity error rejects load
```

### Task 1: Drive The Public Shaka Evidence Boundary From Failing Tests

**Files:**

- Create:
  `libs/ui/playback/src/lib/shaka-engine/shaka-error-contract.ts`
- Create:
  `libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.ts`
- Create:
  `libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts`
- Modify:
  `libs/ui/playback/src/lib/shaka-engine/shaka-module.types.ts`

- [ ] **Step 1: Write the failing installed-runtime contract test**

In `shaka-playback-evidence.util.spec.ts`, load the real compiled package in a
child process with `global.self = globalThis` and return:

```typescript
interface InstalledShakaContract {
    readonly version: string;
    readonly severity: Readonly<Record<string, number>>;
    readonly category: Readonly<Record<string, number>>;
    readonly code: Readonly<Record<string, number>>;
}
```

Assert:

```typescript
expect(installed.version).toBe(SHAKA_DIAGNOSTIC_VERSION);
expect(installed.severity).toEqual(SHAKA_ERROR_SEVERITY);
expect(installed.category).toEqual(SHAKA_ERROR_CATEGORY);
for (const [name, value] of Object.entries(SHAKA_ERROR_CODE)) {
    expect(installed.code[name]).toBe(value);
}
```

Run:

```bash
pnpm exec jest \
  libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.spec.ts \
  --config libs/ui/playback/jest.config.ts --runInBand
```

Expected: FAIL because the contract and evidence module do not exist.

- [ ] **Step 2: Add the minimal public model**

Add const-derived types to `playback-diagnostics.model.ts`:

```typescript
export const ShakaPlaybackSeverity = {
    Recoverable: 'recoverable',
    Critical: 'critical',
    Unknown: 'unknown',
} as const;

export const ShakaPlaybackCategory = {
    Network: 'network',
    Text: 'text',
    Media: 'media',
    Manifest: 'manifest',
    Streaming: 'streaming',
    Drm: 'drm',
    Player: 'player',
    Cast: 'cast',
    Storage: 'storage',
    Ads: 'ads',
    Unknown: 'unknown',
} as const;

export const ShakaPlaybackDisposition = {
    Terminal: 'terminal',
    Recoverable: 'recoverable',
} as const;

export const ShakaPlaybackStage = {
    Manifest: 'manifest',
    Segment: 'segment',
    Media: 'media',
    License: 'license',
    Unknown: 'unknown',
} as const;

export const ShakaPlaybackFailure = {
    Network: 'network',
    Drm: 'drm',
    Manifest: 'manifest',
    Media: 'media',
    Unknown: 'unknown',
} as const;

export const ShakaPlaybackUnknownCode = 'unknown' as const;

export interface ShakaPlaybackEvidence {
    readonly severity: ShakaPlaybackSeverity;
    readonly category: ShakaPlaybackCategory;
    readonly engineCode: number | typeof ShakaPlaybackUnknownCode;
    readonly disposition: ShakaPlaybackDisposition;
    readonly stage: ShakaPlaybackStage;
    readonly failure: ShakaPlaybackFailure;
    readonly httpStatus?: number;
}
```

Add `readonly shaka?: ShakaPlaybackEvidence` to `PlaybackDiagnostic`, and
remove `message` from `ShakaErrorLike` so downstream Shaka code has no typed
message access:

```typescript
export interface ShakaErrorLike {
    severity: number;
    category: number;
    code: number;
    data?: readonly unknown[];
}
```

- [ ] **Step 3: Add the exact 5.2.2 public allowlist**

In `shaka-error-contract.ts`, export:

```typescript
export const SHAKA_DIAGNOSTIC_VERSION = 'v5.2.2';
export const SHAKA_ERROR_SEVERITY = {
    RECOVERABLE: 1,
    CRITICAL: 2,
} as const;
export const SHAKA_ERROR_CATEGORY = {
    NETWORK: 1,
    TEXT: 2,
    MEDIA: 3,
    MANIFEST: 4,
    STREAMING: 5,
    DRM: 6,
    PLAYER: 7,
    CAST: 8,
    STORAGE: 9,
    ADS: 10,
} as const;
```

Define `SHAKA_ERROR_CODE` with the exact active public Shaka 5.2.2 online
playback codes from categories NETWORK through PLAYER, including the direct
and nested HTTP codes, media and manifest codes, all DRM codes, and
`LOAD_INTERRUPTED`. Do not include retired numeric gaps. The contract test
must verify every name/value against the installed runtime.

- [ ] **Step 4: Write failing sanitizer and privacy tests**

Use the documented direct bad-status shape:

```typescript
const raw = {
    severity: 1,
    category: 1,
    code: 1001,
    message: 'https://user:secret@provider.example/manifest.mpd',
    data: [
        'https://provider.example/manifest.mpd?token=secret',
        503,
        'provider body secret',
        { Authorization: 'Bearer secret' },
        0,
        'https://provider.example/final?token=secret',
    ],
};
```

Expect:

```typescript
{
    severity: 'recoverable',
    category: 'network',
    engineCode: 1001,
    disposition: 'terminal',
    stage: 'unknown',
    failure: 'network',
    httpStatus: 503,
}
```

Add a nested `DRM + LICENSE_REQUEST_FAILED` shape whose `data[0]` is the same
network error and whose remaining data contains license/session secrets.
Expect only the nested status number to survive.

Cover:

- HTTP boundaries 99/100/599/600 and non-integers;
- status-like values on non-documented codes remain absent;
- unknown severity/category/code values become `unknown`;
- mismatched public category/code pairs have `failure=unknown`;
- no URL, message, header, body, key, license, credential, or arbitrary
  property survives `JSON.stringify(evidence)`;
- exact manifest, segment, media, license, and unknown stages;
- exact network, DRM, manifest, media, restrictions, and unknown failures.

- [ ] **Step 5: Implement the minimal sanitizer**

In `shaka-playback-evidence.util.ts`, expose:

```typescript
export function createShakaPlaybackEvidence(
    error: Partial<ShakaErrorLike> | null | undefined,
    disposition: ShakaPlaybackDisposition
): ShakaPlaybackEvidence;
```

Use only:

```typescript
error?.severity;
error?.category;
error?.code;
error?.data?.[1]; // exact direct BAD_HTTP_STATUS only
error?.data?.[0]; // exact documented nested DRM network error only
```

Build severity/category/code through exact sets, derive stage/failure through
exact category/code pairs, and return a fresh flat evidence object. Do not
read or serialize any other field.

Run the focused spec again.

Expected: PASS.

### Task 2: Drive Exact Classification And Shared Diagnostic Retention

**Files:**

- Modify:
  `libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts`

- [ ] **Step 1: Replace heuristic expectations with failing exact-code tests**

Change the classifier API to:

```typescript
classifyShakaPlaybackIssue(
    error,
    metadata,
    disposition
): PlaybackDiagnostic | null;
```

Add expectations:

```text
NETWORK + BAD_HTTP_STATUS -> network-error
DRM + REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE -> drm-or-encryption
MANIFEST + DASH_NO_COMMON_KEY_SYSTEM -> drm-or-encryption
MANIFEST + DASH_INVALID_XML -> unknown-playback-error
MANIFEST + DASH_UNSUPPORTED_CONTAINER -> unsupported-container
MANIFEST + CONTENT_UNSUPPORTED_BY_BROWSER -> unknown-playback-error
MEDIA + MEDIA_SOURCE_OPERATION_FAILED -> media-decode-error
MANIFEST + RESTRICTIONS_CANNOT_BE_MET -> unknown-playback-error
mismatched category/code -> unknown-playback-error
unknown values -> unknown-playback-error
recoverable disposition -> null
```

Put misleading `message` and `data` strings such as `CORS codec license`
alongside unknown or mismatched structured values and prove they do not change
classification.

Run the focused classifier spec.

Expected: FAIL against the current category/message heuristic classifier.

- [ ] **Step 2: Implement exact classification**

Create evidence first:

```typescript
const evidence = createShakaPlaybackEvidence(error, disposition);
if (evidence.disposition === ShakaPlaybackDisposition.Recoverable) {
    return null;
}
```

Select the top-level code only from exact evidence:

```typescript
network -> NetworkError
drm -> DrmOrEncryption
DASH_UNSUPPORTED_CONTAINER -> UnsupportedContainer
MEDIA_SOURCE_OPERATION_FAILED -> MediaDecodeError
MEDIA_SOURCE_OPERATION_THREW -> MediaDecodeError
VIDEO_ERROR -> MediaDecodeError
everything else -> UnknownPlaybackError
```

Call `createPlaybackDiagnostic` with `httpStatus` and `shaka`, but no raw
`details` or native message.

Extend `createPlaybackDiagnostic` to accept and retain:

```typescript
readonly shaka?: ShakaPlaybackEvidence;
```

Run the focused evidence and classifier specs.

Expected: PASS.

- [ ] **Step 3: Sanitize the pre-engine DRM diagnostic**

Change `createUnsupportedDrmDiagnostic` to ignore the provider-supplied
license string in technical details:

```typescript
details: 'Unsupported DRM license configuration';
```

Add a secret-bearing license string test and prove the diagnostic JSON and
details omit it while the top-level code remains `drm-or-encryption` and
external fallback remains disabled.

### Task 3: Drive Session Lifecycle And Adapter Routing

**Files:**

- Modify:
  `libs/ui/playback/src/lib/shaka-engine/shaka-video-session.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/shaka-engine/shaka-video-session.ts`
- Modify:
  `libs/ui/playback/src/lib/shaka-engine/shaka-player-test-double.ts`
- Modify:
  `libs/ui/playback/src/lib/art-player/art-player-source-session.dash.spec.ts`

- [ ] **Step 1: Write failing recoverable/terminal routing tests**

Add session regressions for:

```text
recoverable Player#error -> no diagnostic, same current player
unknown-severity Player#error -> no diagnostic, same current player
critical Player#error -> one terminal diagnostic, player destroyed
recoverable-severity load rejection -> one terminal diagnostic
critical event during stalled load -> one diagnostic, later interruption ignored
module-loader Error with URL/token -> terminal unknown evidence without message
```

For the terminal rejected `BAD_HTTP_STATUS`, expect:

```typescript
expect(issue.shaka).toEqual({
    severity: 'recoverable',
    category: 'network',
    engineCode: 1001,
    disposition: 'terminal',
    stage: 'unknown',
    failure: 'network',
    httpStatus: 503,
});
```

Run:

```bash
pnpm exec jest \
  libs/ui/playback/src/lib/shaka-engine/shaka-video-session.spec.ts \
  --config libs/ui/playback/jest.config.ts --runInBand
```

Expected: FAIL because the current session suppresses only event severity,
passes arbitrary messages on rejection, and has no structured disposition.

- [ ] **Step 2: Implement route-owned disposition**

In `ShakaVideoSession`:

- call the classifier with `Terminal` for module rejection, unsupported
  browser support, and `load()` rejection;
- call it with `Recoverable` for exact recoverable events and emit nothing
  when it returns null;
- call it with `Terminal` only for exact critical events;
- ignore unknown-severity events;
- suppress interruption only for the exact
  `CRITICAL + PLAYER + LOAD_INTERRUPTED` triple;
- remove `toErrorMessage` and every Shaka message fallback;
- tear down only after a non-null terminal diagnostic.

Run the focused session spec.

Expected: PASS.

- [ ] **Step 3: Write and pass the ArtPlayer adapter regression**

Configure the fake Shaka player's load promise to reject with a documented
bad-status shape, pass `emitPlaybackIssue` into
`ArtPlayerSourceSession`, invoke the `mpd` custom type, and expect one
diagnostic with:

```typescript
{
    source: PlaybackDiagnosticSource.Shaka,
    player: InlinePlaybackPlayer.ArtPlayer,
    code: PlaybackDiagnosticCode.NetworkError,
    httpStatus: 503,
    shaka: expect.objectContaining({
        engineCode: 1001,
        disposition: 'terminal',
    }),
}
```

Prove the response body/header/token sentinel is absent from serialized
diagnostic data other than the pre-existing active `sourceUrl`.

### Task 4: Drive Safe Rendered Technical Details

**Files:**

- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts`

- [ ] **Step 1: Write the failing rendered-detail regression**

Create a Shaka diagnostic with safe evidence plus malicious legacy fields:

```typescript
details: 'Authorization: Bearer shaka-render-secret',
nativeErrorMessage:
    'https://provider.example/license?token=shaka-render-secret',
shaka: {
    severity: 'recoverable',
    category: 'network',
    engineCode: 1001,
    disposition: 'terminal',
    stage: 'unknown',
    failure: 'network',
    httpStatus: 503,
},
```

Expect the error-details row to equal:

```text
stage=unknown · failure=network · severity=recoverable · category=network · code=1001 · disposition=terminal · HTTP 503
```

Prove the rendered values omit the secret, provider hostname,
`Authorization`, raw body text, and legacy details.

Run the focused component spec.

Expected: FAIL because the UI has no Shaka structured branch.

- [ ] **Step 2: Render only Shaka evidence**

Add the Shaka branch before the HLS/VHS/legacy branches:

```typescript
if (issue.shaka) {
    return [
        `stage=${issue.shaka.stage}`,
        `failure=${issue.shaka.failure}`,
        `severity=${issue.shaka.severity}`,
        `category=${issue.shaka.category}`,
        `code=${issue.shaka.engineCode}`,
        `disposition=${issue.shaka.disposition}`,
        issue.shaka.httpStatus === undefined
            ? ''
            : `HTTP ${issue.shaka.httpStatus}`,
    ]
        .filter((value) => value.length > 0)
        .join(' · ');
}
```

Run the focused component spec.

Expected: PASS.

### Task 5: Documentation, Release Note, And Full Validation

**Files:**

- Modify: `docs/architecture/embedded-inline-playback.md`
- Modify: `docs/architecture/m3u-playlist-module.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Create: `.changes/playback-structured-shaka-diagnostics.md`

- [ ] **Step 1: Update canonical documentation**

Document:

- Shaka 5.2.2 public version lock;
- evidence fields and rejected raw fields;
- direct and nested documented HTTP status layouts;
- exact failure/stage classification and ambiguous unknown cases;
- recoverable event versus terminal load-rejection semantics;
- sanitized technical detail output;
- unchanged source routing, ClearKey fallback rule, and VOD failover.

Keep the high-level Shaka summaries in `CLAUDE.md` and `AGENTS.md`
consistent.

- [ ] **Step 2: Add the user-facing release note**

Create:

```markdown
---
type: fix
area: playback
---

Shaka playback errors now use exact engine evidence, keep recoverable errors from interrupting playback, and omit provider URLs, credentials, and response data from technical details.
```

- [ ] **Step 3: Run focused and affected validation**

Run:

```bash
pnpm exec jest \
  libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.spec.ts \
  libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.spec.ts \
  libs/ui/playback/src/lib/shaka-engine/shaka-video-session.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.dash.spec.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts \
  --config libs/ui/playback/jest.config.ts --runInBand
pnpm nx test ui-playback
pnpm nx lint ui-playback
pnpm nx typecheck web
pnpm run i18n:check
pnpm run release:notes:validate
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Complete the test-impact pass**

Confirm:

```text
Affected project: ui-playback
Unit/component coverage: required and run
Lint: required and run
Web typecheck: required and run
i18n validation: required and run
Release-note validation: required and run
E2E: not required; no workflow, routing, player selection, or integration
     lifecycle changed, and event/rejection behavior is covered at the
     session plus ArtPlayer adapter boundaries
```

### Task 6: Independent Review, Fixes, And Ready PR

**Files:**

- Review: complete diff from `origin/master` to branch HEAD

- [ ] **Step 1: Commit the implementation before review**

Create focused conventional commits for the evidence boundary/runtime change
and documentation/release note. Confirm:

```bash
git status --short
git log --oneline origin/master..HEAD
```

- [ ] **Step 2: Dispatch an independent local Codex review**

Give the reviewer:

```text
Base: origin/master
Head: branch HEAD
Requirements: the structured Shaka design and this implementation plan
Focus: actionable P0/P1/P2 correctness, privacy, public-contract drift,
       lifecycle duplication/suppression, classification accuracy, and tests
```

Require a full-diff review. If the reviewer reports an issue, verify it
against the installed Shaka 5.2.2 source before changing code.

- [ ] **Step 3: Fix confirmed findings through TDD**

For every confirmed P0/P1/P2:

1. add or tighten a regression test;
2. run it and observe the expected failure;
3. implement the minimal fix;
4. rerun the focused test and affected suite;
5. commit the fix.

- [ ] **Step 4: Repeat independent review**

Review the updated full diff from `origin/master`. Expected: no actionable
P0/P1/P2 findings.

- [ ] **Step 5: Repeat the complete validation ladder**

Rerun every command from Task 5 Step 3 after the final review fix. Expected:
all exit 0 with fresh output.

- [ ] **Step 6: Push and create a ready PR**

Push `agent/structured-shaka-diagnostics` and create a non-draft PR with:

```text
Title: fix(playback): structure Shaka diagnostics
Base: master
Summary: exact Shaka 5.2.2 evidence, lifecycle-aware recoverable handling,
         safe technical details
Testing: list every fresh validation command and result
```

Inspect the created PR and confirm it is ready for review.
