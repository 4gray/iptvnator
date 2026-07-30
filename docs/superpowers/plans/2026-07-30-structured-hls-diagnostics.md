# Structured HLS Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broad HLS error-string heuristics with a safe structured
hls.js 1.6.16 evidence contract shared by HTML5 and ArtPlayer.

**Architecture:** Sanitize `ErrorData` at one boundary into an allowlisted
`HlsPlaybackEvidence` object, classify only that object, and return no terminal
diagnostic for recoverable events. Preserve the evidence on
`PlaybackDiagnostic` for deterministic technical details without retaining
engine messages, URLs, headers, response bodies, credentials, or arbitrary
provider payloads.

**Tech Stack:** Angular 21, TypeScript 5.9, hls.js 1.6.16, Jest through Nx,
ngx-translate JSON catalogs, Markdown release notes.

---

### Task 0: Confirm The Clean Baseline

**Files:**
- Verify only: `package.json`
- Verify only: `pnpm-lock.yaml`
- Verify only: `libs/ui/playback/project.json`

- [ ] **Step 1: Install locked dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 without changing `pnpm-lock.yaml`.

- [ ] **Step 2: Verify Nx workspace discovery**

Run:

```bash
pnpm nx show projects
```

Expected: exit 0 and output containing `ui-playback`, `web`, and `web-e2e`.

- [ ] **Step 3: Run the affected project baseline**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache
```

Expected: 84 suites and 741 tests pass before implementation.

### Task 1: Drive The Evidence Contract From Failing Tests

**Files:**
- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/hls-playback-evidence.util.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts`
- Create:
  `libs/ui/playback/src/lib/playback-diagnostics/hls-playback-evidence.util.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts`
- Modify:
  `libs/ui/playback/src/lib/playback-diagnostics/playback-error-patterns.util.ts`

- [ ] **Step 1: Add extractor regressions before the extractor exists**

In `hls-playback-evidence.util.spec.ts`, import hls.js 1.6.16 `ErrorData`,
`ErrorDetails`, and `ErrorTypes`, then exercise the wished-for export through
the existing diagnostics module namespace. Use a helper returning a complete
`ErrorData`:

```typescript
function createErrorData(overrides: Partial<ErrorData> = {}): ErrorData {
    return {
        type: ErrorTypes.OTHER_ERROR,
        details: ErrorDetails.UNKNOWN,
        error: new Error('provider payload must not survive'),
        fatal: true,
        ...overrides,
    };
}
```

Cover these exact shapes:

- manifest 404:
  `networkError`, `manifestLoadError`, `fatal: true`,
  `response.code: 404`;
- level timeout:
  `networkError`, `levelLoadTimeOut`, `fatal: true`;
- recoverable fragment load:
  `networkError`, `fragLoadError`, `fatal: false`;
- key load:
  `networkError`, `keyLoadError`;
- fatal fragment decrypt:
  `mediaError`, `fragDecryptError`;
- buffer codec:
  `mediaError`, `bufferAddCodecError`;
- unknown runtime type/detail values;
- response status boundaries 99/100/599/600 and non-integers;
- a payload containing credential-shaped URLs, headers, response text/data,
  context, `networkDetails`, `error`, and `reason`.

Expected evidence examples:

```typescript
expect(createEvidence(manifest404)).toEqual({
    engineType: ErrorTypes.NETWORK_ERROR,
    engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
    disposition: 'fatal',
    stage: 'manifest',
    failure: 'http',
    httpStatus: 404,
});

expect(createEvidence(recoverableFragment)).toEqual({
    engineType: ErrorTypes.NETWORK_ERROR,
    engineDetails: ErrorDetails.FRAG_LOAD_ERROR,
    disposition: 'recoverable',
    stage: 'segment',
    failure: 'network',
});
```

Serialize the unsafe-shape evidence and assert it contains none of the secret,
URL, header, text, body, or provider-message sentinels.

- [ ] **Step 2: Replace broad HLS classifier cases with structured expectations**

In `playback-diagnostics.util.spec.ts`, make
`classifyHlsPlaybackIssue` consume the wished-for evidence shape. Cover:

```typescript
expect(
    classifyHlsPlaybackIssue(recoverableFragmentEvidence, metadata)
).toBeNull();

expect(
    classifyHlsPlaybackIssue(fatalManifest404Evidence, metadata)
).toEqual(
    expect.objectContaining({
        code: PlaybackDiagnosticCode.NetworkError,
        httpStatus: 404,
        externalFallbackRecommended: false,
    })
);
```

Add exact codec, decrypt/DRM, media/mux, and unknown cases. Add misleading
provider-string-shaped values to the source metadata URL and prove they cannot
change classification, since the classifier receives no message payload.

Remove HLS expectations that arbitrary error objects, CORS phrases, or
provider messages appear in `details`. Keep native and mpegts.js coverage
unchanged.

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/playback-diagnostics/hls-playback-evidence.util.spec.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts \
  --runInBand
```

Expected: FAIL because no structured evidence creator exists and the current
classifier still accepts broad strings and always returns a diagnostic.

- [ ] **Step 4: Add the evidence model**

In `playback-diagnostics.model.ts`, replace `HlsPlaybackErrorInput` with const
objects and extracted types:

```typescript
export const HlsPlaybackDisposition = {
    Fatal: 'fatal',
    Recoverable: 'recoverable',
} as const;

export const HlsPlaybackStage = {
    Manifest: 'manifest',
    Level: 'level',
    Segment: 'segment',
    Key: 'key',
    Media: 'media',
    Unknown: 'unknown',
} as const;

export const HlsPlaybackFailure = {
    Http: 'http',
    Timeout: 'timeout',
    Network: 'network',
    Access: 'access',
    Unknown: 'unknown',
} as const;
```

Define `HlsPlaybackEvidence` with allowlisted engine type/detail types,
disposition, stage, failure, and optional status. Add optional
`hls?: HlsPlaybackEvidence` to `PlaybackDiagnostic`.

- [ ] **Step 5: Implement exact extraction**

In `hls-playback-evidence.util.ts`:

- validate `type` against `Object.values(ErrorTypes)`, otherwise `unknown`;
- validate `details` against `Object.values(ErrorDetails)`, otherwise
  `ErrorDetails.UNKNOWN`;
- validate only `response.code` as an integer from 100 through 599;
- map stage through readonly sets of exact `ErrorDetails`;
- map timeout and network failure through readonly exact sets;
- prefer timeout, then 4xx/5xx HTTP failure, then network, else unknown;
- return only the six evidence keys and optional `httpStatus`.

Do not read any other `ErrorData` property.

- [ ] **Step 6: Implement exact classification**

In `playback-diagnostics.util.ts`:

- change the HLS classifier input to `HlsPlaybackEvidence`;
- return `null` for `Recoverable`;
- use exact detail sets for incompatible/add-codec and decrypt evidence;
- use exact key-system type/details for DRM;
- use exact network type/failure for network diagnostics;
- use exact media/mux types for decode diagnostics;
- use unknown otherwise;
- retain the evidence and HTTP status through `createPlaybackDiagnostic`.

Remove `HlsPlaybackErrorInput` from `playback-error-patterns.util.ts`.
`normalizeErrorDetails`, `isNetworkFailure`, `isCodecFailure`, and
`isDrmOrEncryptionFailure` remain only where mpegts.js still needs them, or are
deleted when HLS was their only consumer. Do not redesign mpegts.js behavior.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run the focused command from step 3.

Expected: PASS for exact real shapes, unknown values, privacy exclusions,
recoverable suppression, and all unchanged native/mpegts behavior.

- [ ] **Step 8: Commit the evidence contract**

Run:

```bash
git add \
  libs/ui/playback/src/lib/playback-diagnostics/hls-playback-evidence.util.spec.ts \
  libs/ui/playback/src/lib/playback-diagnostics/hls-playback-evidence.util.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.model.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-error-patterns.util.ts
git commit -m "fix(playback): classify HLS errors from structured evidence"
```

Expected: one contract/classifier commit with its RED/GREEN regressions.

### Task 2: Route HTML5 And ArtPlayer Through The Boundary

**Files:**
- Modify:
  `libs/ui/playback/src/lib/html-video-player/html-video-player-diagnostics.ts`
- Modify:
  `libs/ui/playback/src/lib/html-video-player/html-video-player.component.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/art-player/art-player-source-session.ts`
- Modify:
  `libs/ui/playback/src/lib/art-player/art-player-source-session.spec.ts`
- Modify:
  `libs/ui/playback/src/lib/art-player/art-player.component.spec.ts`

- [ ] **Step 1: Write adapter regressions**

Update HTML5 and ArtPlayer tests first:

- fatal manifest 404 emits `network-error`, stage `manifest`, failure `http`,
  disposition `fatal`, and `httpStatus: 404`;
- recoverable fragment error emits nothing;
- payload sentinels placed in `error`, `reason`, response URL/text/data,
  request headers, and `networkDetails` do not appear in the emitted
  diagnostic JSON;
- stale ArtPlayer HLS callbacks remain ignored after a source change.

Use hls.js-shaped values, not prose-only test objects.

- [ ] **Step 2: Run adapter tests to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/html-video-player/html-video-player.component.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player.component.spec.ts \
  --runInBand
```

Expected: FAIL because adapters still build broad HLS input and retain
arbitrary errors.

- [ ] **Step 3: Use the shared extractor/classifier**

In both adapters:

```typescript
const issue = classifyHlsPlaybackIssue(
    createHlsPlaybackEvidence(data),
    sourceMetadata
);
if (issue) {
    emitPlaybackIssue(issue);
}
```

Remove duplicated `if (!data.fatal)` gates and all copying of `data.error`
messages or objects.

- [ ] **Step 4: Run adapter tests to verify GREEN**

Run the focused command from step 2.

Expected: PASS for HTML5, ArtPlayer, recoverable suppression, privacy
exclusions, and stale-session guards.

- [ ] **Step 5: Commit adapter integration**

Run:

```bash
git add \
  libs/ui/playback/src/lib/html-video-player/html-video-player-diagnostics.ts \
  libs/ui/playback/src/lib/html-video-player/html-video-player.component.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player.component.spec.ts
git commit -m "fix(playback): sanitize HLS adapter errors"
```

Expected: one adapter-boundary commit.

### Task 3: Render Only Sanitized HLS Evidence

**Files:**
- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts`
- Modify:
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`

- [ ] **Step 1: Add the rendered-detail regression**

Create a diagnostic carrying structured manifest-404 evidence and expect its
technical error-details row to equal:

```text
stage=manifest · failure=http · type=networkError · details=manifestLoadError · disposition=fatal · HTTP 404
```

Include credential-shaped source/provider sentinels in fields that the HLS
extractor rejects and assert the banner/details text does not contain them.
Keep the existing direct native `HTTP 404 · networkrequestfailed` expectation.

- [ ] **Step 2: Run the view spec to verify RED**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts \
  --runInBand
```

Expected: FAIL because the formatter does not render structured HLS evidence.

- [ ] **Step 3: Format HLS evidence deterministically**

In `formatDiagnosticErrorDetails`, prefer `issue.hls` and format only:

```typescript
[
    `stage=${evidence.stage}`,
    `failure=${evidence.failure}`,
    `type=${evidence.engineType}`,
    `details=${evidence.engineDetails}`,
    `disposition=${evidence.disposition}`,
    evidence.httpStatus === undefined ? '' : `HTTP ${evidence.httpStatus}`,
]
```

Filter empty values and join with ` · `. Leave native, mpegts.js, and Shaka
formatting unchanged.

- [ ] **Step 4: Run the view spec to verify GREEN**

Run the focused command from step 2.

Expected: PASS with safe deterministic evidence and unchanged native HTTP
rendering.

- [ ] **Step 5: Commit the UI formatting**

Run:

```bash
git add \
  libs/ui/playback/src/lib/web-player-view/web-player-view-diagnostics.utils.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
git commit -m "fix(playback): show safe HLS diagnostic evidence"
```

Expected: one focused UI/test commit without new translation keys.

### Task 4: Update Canonical Documentation And Release Notes

**Files:**
- Modify: `docs/architecture/embedded-inline-playback.md`
- Create: `.changes/playback-structured-hls-diagnostics.md`
- Verify only: `CLAUDE.md`
- Verify only: `AGENTS.md`

- [ ] **Step 1: Update the canonical diagnostic contract**

Replace the statement that technical details expose raw HLS information with:

- exact hls.js fields retained;
- stage/failure/disposition mapping;
- recoverable events suppressed;
- status zero/access ambiguity stays unknown/network;
- unsafe HLS fields are neither retained nor rendered;
- HTML5 and ArtPlayer share the same boundary.

Do not add history, probes, failover, Shaka, or mpegts redesign material.

- [ ] **Step 2: Assess living root docs**

Check the shared-player descriptions in `CLAUDE.md` and `AGENTS.md`. Update
both only if their existing claims become stale. If neither describes HLS error
payload details, leave both unchanged and record that assessment.

- [ ] **Step 3: Add the user-facing release note**

Create `.changes/playback-structured-hls-diagnostics.md`:

```markdown
---
type: fix
area: playback
---

HLS failures now use confirmed player evidence such as the failed stage, timeout, and HTTP status. Recoverable retries stay silent, and technical details no longer include raw provider error payloads.
```

Keep the body below 400 characters.

- [ ] **Step 4: Validate Markdown and release-note format**

Run:

```bash
git diff --check
pnpm run release:notes:validate
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit docs and release note**

Run:

```bash
git add \
  docs/architecture/embedded-inline-playback.md \
  .changes/playback-structured-hls-diagnostics.md
git commit -m "docs(playback): document structured HLS evidence"
```

Add `CLAUDE.md` and `AGENTS.md` only if step 2 required synchronized changes.

### Task 5: Complete The Test-Impact Pass

**Files:**
- Verify only: all files changed from `origin/master`

- [ ] **Step 1: Run focused RED/GREEN suites together**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules \
node node_modules/jest/bin/jest.js \
  --config jest.web-esm.workspace.ts \
  --runTestsByPath \
  libs/ui/playback/src/lib/playback-diagnostics/hls-playback-evidence.util.spec.ts \
  libs/ui/playback/src/lib/playback-diagnostics/playback-diagnostics.util.spec.ts \
  libs/ui/playback/src/lib/html-video-player/html-video-player.component.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player-source-session.spec.ts \
  libs/ui/playback/src/lib/art-player/art-player.component.spec.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts \
  --runInBand
```

Expected: all focused suites pass.

- [ ] **Step 2: Run the affected Nx project tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache
```

Expected: all `ui-playback` suites pass with the new regressions.

- [ ] **Step 3: Run lint and typechecks**

Run:

```bash
pnpm nx lint ui-playback --skip-nx-cache
pnpm exec tsc -p libs/ui/playback/tsconfig.lib.json --noEmit
pnpm run typecheck:web
```

Expected: all commands exit 0.

- [ ] **Step 4: Run repository validation**

Run:

```bash
pnpm run i18n:check
pnpm run release:notes:validate
git diff --check origin/master...HEAD
```

Expected: translations remain aligned, the release note is valid, and the diff
has no whitespace errors.

- [ ] **Step 5: Record the E2E decision**

No E2E is required: this PR does not change navigation, control interactions,
playback engine selection, or retry/fallback workflows. Unit/component tests
exercise the real hls.js public shape, both adapters, terminal suppression,
classification, and rendered technical details.

### Task 6: Run Independent Local Review And Revalidation

**Files:**
- Review only: `origin/master...HEAD`

- [ ] **Step 1: Inspect the complete diff**

Run:

```bash
git status --short --branch
git diff --stat origin/master...HEAD
git diff --check origin/master...HEAD
```

Expected: only the focused design/plan, HLS contract, tests, two adapters,
minimal diagnostic formatting, canonical doc, and release note are present.

- [ ] **Step 2: Dispatch an independent reviewer**

Give a fresh reviewer only the requirements, design path, base SHA, head SHA,
and full diff. Require actionable P0/P1/P2 findings with exact file/line
references, including:

- incorrect hls.js 1.6.16 shape assumptions;
- recoverable-to-terminal regressions;
- unsafe data retention or rendering;
- broad string inference;
- classification precedence errors;
- HTML5/ArtPlayer divergence;
- missing tests, type safety, or scope creep.

The reviewer must not modify files.

- [ ] **Step 3: Resolve findings with TDD**

For each valid finding, add or update the closest regression first, observe the
expected failure, apply the smallest fix, and return the focused suite to
green. Reject invalid findings only with concrete code/type/test evidence.

- [ ] **Step 4: Repeat review after fixes**

If any file changed, re-run the same independent review against the new
`origin/master...HEAD` range until no actionable P0/P1/P2 remains.

- [ ] **Step 5: Re-run final validation**

Repeat every command in Task 5 after the last review change.

Expected: all tests and validations exit 0 on the exact commit range that will
be pushed.

### Task 7: Publish The Ready Pull Request

**Files:**
- Verify only: `.github/pull_request_template.md` if present

- [ ] **Step 1: Commit any final reviewed fixes**

Run:

```bash
git status --short
git diff
git add -u
git commit -m "fix(playback): address structured HLS review findings"
```

Create this commit only when review produced verified changes.

- [ ] **Step 2: Inspect final history and scope**

Run:

```bash
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
git status --short --branch
```

Expected: a clean focused branch.

- [ ] **Step 3: Push the branch**

Run:

```bash
git push -u origin agent/structured-hls-diagnostics
```

Expected: push succeeds without force.

- [ ] **Step 4: Create a ready PR**

Create a non-draft PR targeting `master`:

```text
fix(playback): structure HLS diagnostics
```

The body summarizes:

- exact hls.js evidence and recoverable suppression;
- shared HTML5/ArtPlayer sanitizer;
- safe technical details without raw provider payloads;
- tests and validation commands;
- independent review status.

Link a relevant open issue only if one was found or created. Do not reopen or
close #1159, which PR #1314 already resolved.

- [ ] **Step 5: Verify PR state**

Run:

```bash
gh pr view --json number,title,state,isDraft,baseRefName,headRefName,url,body
```

Expected: `OPEN`, `isDraft: false`, base `master`, head
`agent/structured-hls-diagnostics`.
