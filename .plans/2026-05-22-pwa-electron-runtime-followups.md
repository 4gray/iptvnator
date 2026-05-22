# PWA/Electron Runtime Follow-Up Plan

## Stop Point

Stop implementation after PR #1002:

- #964 through #1002 now form a long stacked runtime-boundary series.
- The latest pushed branch is `agent/settings-backup-file-save-runtime-capability`.
- Do not add more runtime-capability refactor PRs until the current stack is reviewed, merged, and rebased as needed.

## Review And Merge Plan

1. Review and merge bottom-up, starting at #964 and ending at #1002.
2. Prefer a merge strategy that preserves stacked ancestry. If GitHub squash-merges a PR, rebase the next branch onto updated `master` before reviewing or merging it.
3. For each PR:
   - Verify the PR base/head are still correct.
   - Check that the diff is only the intended logical slice.
   - Wait for CI to pass.
   - Merge the PR.
   - Rebase or retarget the next branch before continuing.
4. After the stack lands, run a combined validation pass on `master`:
   - `pnpm nx test services`
   - `pnpm nx test web --runTestsByPath apps/web/src/app/settings/settings.component.spec.ts apps/web/src/app/settings/settings-options.spec.ts`
   - `pnpm nx test ui-epg`
   - `pnpm run typecheck:web`
   - `pnpm nx build web --configuration=electron-e2e --skip-nx-cache`
   - `pnpm nx build web --configuration=pwa --skip-nx-cache`
   - `pnpm nx run web-e2e:e2e-ci--src/self-hosted.e2e.ts`
   - `pnpm nx run web-e2e:e2e-ci--src/settings.e2e.ts`

## Later Continuation

1. Re-audit direct `window.electron` usage after the stack is merged. Focus on places that still make feature decisions outside `RuntimeCapabilitiesService`.
2. Decide whether `supportsEpg` should remain one complete capability or be split into narrower capabilities such as EPG fetch, source freshness, and schedule search.
3. Continue settings cleanup:
   - gate `updateSettings` by an explicit desktop-settings capability if partial Electron bridges remain a supported case,
   - review embedded MPV recording-folder selection against an embedded-MPV capability,
   - keep backup import/export behavior shared and PWA-safe.
4. Review `libs/epg/data-access` and `libs/ui/epg` for direct Electron bridge calls that could be routed through small typed bridge/facade services.
5. Review playback/embedded MPV bridge code separately; it has a wider blast radius and should not be mixed with PWA settings/runtime cleanups.
6. After code cleanup, do a final PWA/Docker documentation pass:
   - confirm unsupported PWA features are documented,
   - confirm troubleshooting tells users to copy stream URLs into external players instead of implying managed MPV/VLC support in PWA,
   - rerun self-hosted e2e and a manual Docker/PWA smoke test.

