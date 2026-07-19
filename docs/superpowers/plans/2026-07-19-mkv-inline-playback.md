# Native Matroska Inline Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Video.js inline player attempt MKV playback through Chromium's native Matroska pipeline while preserving codec-dependent diagnostics and external-player fallback.

**Architecture:** Keep `WebPlayerViewComponent` as the single Video.js source-type router and keep `getPlaybackMediaExtensionFromUrl()` as the canonical parser for path and query metadata. Add only an explicit MKV MIME branch; ArtPlayer and HTML5 remain on their existing native-video paths, and native playback errors remain authoritative.

**Tech Stack:** Angular 21, TypeScript, Jest/Nx, Electron 41/Chromium 146, agent-browser CDP

---

## Task 1: Add failing Video.js MIME regression tests

**Files:**

- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`
- Test: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`

- [x] **Step 1: Add a path-extension regression test**

Add this test beside the existing query-declared HLS test:

```ts
it('uses the Matroska mime type for MKV paths', () => {
    const streamUrl = 'https://example.com/archive/movie.mkv';

    component.setVjsOptions(streamUrl);

    expect(component.vjsOptions.sources).toEqual([
        {
            src: streamUrl,
            type: 'video/matroska',
        },
    ]);
});
```

- [x] **Step 2: Add a query-metadata regression test**

```ts
it('uses the Matroska mime type for query-declared MKV streams', () => {
    const streamUrl =
        'https://example.com/play?container=mkv&token=signed';

    component.setVjsOptions(streamUrl);

    expect(component.vjsOptions.sources).toEqual([
        {
            src: streamUrl,
            type: 'video/matroska',
        },
    ]);
});
```

- [x] **Step 3: Run the focused spec and verify RED**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
```

Expected: the two new expectations fail because the actual source type is still `video/mp4`; existing tests continue to pass.

## Task 2: Route MKV sources as Matroska

**Files:**

- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
- Test: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts`

- [x] **Step 1: Add the smallest production change**

Change the MIME decision to:

```ts
const mimeType =
    extension === 'm3u' || extension === 'm3u8'
        ? 'application/x-mpegURL'
        : extension === 'ts' || !extension
          ? 'video/mp2t'
          : extension === 'mkv'
            ? 'video/matroska'
            : 'video/mp4';
```

Do not add `canPlayType()` preflight or a codec list: the actual native load result remains authoritative.

- [x] **Step 2: Run the focused spec and verify GREEN**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
```

Expected: all tests in the spec pass.

- [x] **Step 3: Run the complete affected unit-test target**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand
```

Expected: PASS.

## Task 3: Document the native MKV contract

**Files:**

- Modify: `docs/architecture/embedded-inline-playback.md`

- [x] **Step 1: Extend the codec/container diagnostics section**

After the URL extension metadata paragraph, document:

```md
MKV sources are attempted through Chromium's native Matroska path. Video.js
receives `video/matroska` for `.mkv` URLs and explicit query metadata such as
`extension=mkv` or `container=mkv`; ArtPlayer and HTML5 continue to use their
native video paths. This is container support rather than a universal codec
guarantee: native source/decode failures still produce the existing diagnostic
and explicit MPV/VLC fallback.
```

- [x] **Step 2: Verify Markdown and whitespace**

Run:

```bash
git diff --check
git diff -- docs/architecture/embedded-inline-playback.md
```

Expected: no whitespace errors; the diff describes only the new MKV contract.

## Task 4: Verify the Electron runtime with a supported MKV

**Files:**

- Temporary fixture only: `/tmp/iptvnator-mkv-inline-playback/video.mkv`
- No committed binary fixture

- [x] **Step 1: Download a small H.264/AAC Matroska fixture**

Run:

```bash
mkdir -p /tmp/iptvnator-mkv-inline-playback
curl --fail --location https://remotion.media/video.mkv --output /tmp/iptvnator-mkv-inline-playback/video.mkv
```

Record the downloaded SHA-256 in the verification notes:

```bash
shasum -a 256 /tmp/iptvnator-mkv-inline-playback/video.mkv
```

- [x] **Step 2: Start an isolated IPTVnator Electron runtime**

If the standard IPTVnator development ports are free, run in a long-lived
terminal:

```bash
IPTVNATOR_TRACE_RENDERER_CONSOLE=1 pnpm nx serve electron-backend
```

Wait for the IPTVnator renderer target on `127.0.0.1:9222`. If another
worktree already owns the development ports, do not stop it; instead launch
the repository's Electron 41 binary with a temporary BrowserWindow harness on
an unused CDP port and remove the harness after the smoke.

- [x] **Step 3: Exercise Chromium's native Matroska pipeline in an Electron renderer**

Use the repository's documented Electron CDP workflow and `agent-browser` to
attach to the IPTVnator page. In the renderer:

1. Read `/tmp/iptvnator-mkv-inline-playback/video.mkv` through a temporary
   localhost range server that returns `Content-Type: video/matroska`.
2. Create a temporary `<video muted autoplay>` smoke element using that URL.
3. Wait for `loadedmetadata`.
4. Assert `videoWidth > 0`, `duration > 0`, and `currentTime` advances.
5. Remove the temporary element and stop the server.

This is a runtime capability check, while the focused component tests prove
that the Video.js application path supplies the same `video/matroska` MIME.

- [x] **Step 4: Reconfirm unsupported-MKV fallback coverage**

Run the existing WebPlayerView spec containing the synthetic native MKV error:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
```

Expected: PASS, including the existing MKV diagnostic and MPV fallback
assertions.

## Task 5: Run final validation

**Files:**

- Verify only

- [x] **Step 1: Verify workspace discovery**

Run:

```bash
pnpm nx show projects
```

Expected: projects are discovered successfully.

- [x] **Step 2: Run affected lint**

Run:

```bash
pnpm nx lint ui-playback --skip-nx-cache
```

Expected: PASS.

- [x] **Step 3: Run web type checking**

Run:

```bash
pnpm run typecheck:web
```

Expected: PASS.

- [x] **Step 4: Inspect the complete change**

Run:

```bash
git diff --check
git diff --stat origin/master...HEAD
git status --short
```

Expected: no whitespace errors and only the design, plan, implementation,
regression tests, and canonical playback documentation are in scope.

## Task 6: Perform local Codex review and address findings

**Files:**

- Review all branch changes against `origin/master`

- [x] **Step 1: Commit the implementation checkpoint**

Stage only the MKV plan, implementation, tests, and documentation, then commit:

```bash
git add docs/superpowers/plans/2026-07-19-mkv-inline-playback.md \
  docs/architecture/embedded-inline-playback.md \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts
git commit -m "fix(playback): route MKV sources as Matroska"
```

- [x] **Step 2: Run local Codex code review**

Run:

```bash
codex review --base origin/master
```

Classify every finding by severity and verify it against the code. Fix all
confirmed correctness, regression, security, or maintainability findings before
publication. Re-run the targeted tests, lint, type check, and review after any
material correction.

- [x] **Step 3: Confirm a clean, reviewed branch**

Run:

```bash
git status --short
git log --oneline --decorate origin/master..HEAD
```

Expected: clean worktree and a focused two-commit branch (design plus
implementation), unless the review required a clearly named follow-up commit.

## Task 7: Push and open the pull request

**Files:**

- GitHub branch and PR metadata only

- [ ] **Step 1: Confirm GitHub authentication**

Run:

```bash
gh auth status
```

- [ ] **Step 2: Push the reviewed branch**

Run:

```bash
git push --set-upstream origin agent/mkv-inline-playback
```

- [ ] **Step 3: Open a focused draft PR**

Create a draft PR targeting `master` with title:

```text
fix(playback): route MKV sources as Matroska
```

The body must summarize:

- Video.js now sends `.mkv` and query-declared MKV as `video/matroska`;
- ArtPlayer/HTML5 behavior and error-driven fallback are unchanged;
- codec support remains Chromium/platform-dependent;
- automated test, lint, type-check, Electron smoke, and local Codex review
  results;
- the temporary runtime fixture URL and SHA-256.

- [ ] **Step 4: Verify the published PR**

Run:

```bash
gh pr view --json number,title,url,isDraft,baseRefName,headRefName,state
```

Expected: an OPEN draft PR from `agent/mkv-inline-playback` into `master`.
