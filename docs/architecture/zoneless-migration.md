# Zoneless change-detection migration

Working checklist for plan item C6 of the performance journeys plan: move the
renderer (`apps/web`) from zone.js to `provideZonelessChangeDetection()`.
The win is measured with the change-detection tick counters described in
[performance journeys](performance-journeys.md#change-detection-ticks); the
[idle work audit](idle-work-audit-2026-09.md) found the Eager roots that
re-render on every tick. Update this file in the same PR that converts an item.

The inventory was taken on `e8b181fce` (2026-10-04, Angular 22.1.6). Run
`pnpm nx run electron-backend-e2e:test-performance-harness` after editing the
Eager list: `zoneless-migration.spec.ts` fails when the list and the code
disagree, so a new Eager component cannot land unnoticed and a converted one
must be ticked here.

## Starting point

- **OnPush is already the default.** Since Angular 22 an unset
  `changeDetection` means OnPush, and the old `Default` strategy is spelled
  `ChangeDetectionStrategy.Eager`. Only components that set `Eager` are
  checked on every tick. `ChangeDetectionStrategy.Default` is not used.
- **Renderer bootstrap.** `apps/web/src/app/app.config.ts` provides
  `provideZoneChangeDetection({ eventCoalescing: true })` and
  `apps/web/project.json` builds with `"polyfills": ["zone.js"]`.
  `apps/remote-control-web` does the same; it is a separate app and outside
  this migration unless a step says otherwise.
- **Unit tests already run zoneless.** Every `src/test-setup.ts` (apps/web,
  apps/remote-control-web and 24 libs) calls `setupZonelessTestEnv` and loads
  `zone.js`/`zone.js/testing` only for `fakeAsync` and `waitForAsync`. A
  component that passes its specs is therefore not proof of zone-free
  production behavior when the spec calls `fixture.detectChanges()` itself.
- **IPC callbacks never ran in the Angular zone.** `window.electron.on*`
  listeners arrive through `contextBridge` and are not zone-patched, so every
  one that works today already writes signals or calls `NgZone.run`.
- **Counters before the migration** (macOS, from
  [performance journeys](performance-journeys.md#change-detection-ticks)):
  `renderer.cdTicksToFirstCard` 20–21 (the one-tick zone.js race),
  `renderer.cdTicksIdle30s` 3, `renderer.cdTicksToFirstPage` 22;
  `renderer.cdTicksToPlaying` has no recorded run yet.

## PR sequence

1. [ ] Keep `@ngrx/store-devtools` out of production bundles (#1810, open). Not a
   zone change; it lowered `renderer.initialBytes` before the migration
   starts moving it.
2. [x] This inventory and its guard spec.
3. [ ] Per-project PRs, in this order, each converting the project's Eager
   components and fixing its zone-dependent sites while zone.js stays on:
   `libs/ui/*`, `libs/workspace/*`, `libs/playlist/*`, `libs/portal/*`,
   playback (`libs/ui/playback`, `libs/playlist/m3u/feature-player`),
   `apps/web`. Each reports the tick counters before and after and runs the
   affected unit and E2E tests.
4. [ ] `provideZonelessChangeDetection()` behind a build-time
   `fileReplacements` flag, off by default; all four journeys and the
   Electron E2E suite run with it on.
5. [ ] Flag on by default, `zone.js` out of `polyfills`, new tick baselines
   (`renderer.cdTicksIdle30s` and any counter that becomes deterministic once
   the zone.js race is gone).

## Eager components

66 production files, 67 components (`epg-progress-panel.component.ts` holds
two). Tick an entry by deleting `changeDetection: ChangeDetectionStrategy.Eager`
(or setting OnPush) once its template state is signals, signal inputs or
explicitly marked. The guard spec compares the unticked entries with the
files that still contain `ChangeDetectionStrategy.Eager`.

### apps/web (15)

- [x] `apps/web/src/app/app.component.ts` (idle audit root)
- [x] `apps/web/src/app/app-update-notification-panel.component.ts` (idle audit root)
- [x] `apps/web/src/app/settings/app-update-release-notes-dialog.component.ts`
- [x] `apps/web/src/app/settings/settings.component.ts`
- [x] `apps/web/src/app/settings/settings-about-section.component.ts`
- [x] `apps/web/src/app/settings/settings-backup-section.component.ts`
- [x] `apps/web/src/app/settings/settings-dashboard-section.component.ts`
- [x] `apps/web/src/app/settings/settings-delete-all-playlists-dialog.component.ts`
- [x] `apps/web/src/app/settings/settings-epg-section.component.ts`
- [x] `apps/web/src/app/settings/settings-general-section.component.ts`
- [x] `apps/web/src/app/settings/settings-playback-section.component.ts`
- [x] `apps/web/src/app/settings/settings-remote-control-section.component.ts`
- [x] `apps/web/src/app/settings/settings-reset-section.component.ts`
- [x] `apps/web/src/app/settings/settings-tmdb-section.component.ts`
- [x] `apps/web/src/app/settings/settings-unsaved-changes-dialog.component.ts`

### libs/ui (20 files, 21 components)

- [x] `libs/ui/components/src/lib/confirm-dialog/confirm-dialog.component.ts`
- [x] `libs/ui/components/src/lib/content-hero/content-hero.component.ts`
- [x] `libs/ui/components/src/lib/expandable-text/expandable-text.component.ts`
- [x] `libs/ui/components/src/lib/portal-detail-shell/content-about.component.ts`
- [x] `libs/ui/components/src/lib/portal-detail-shell/portal-detail-shell.component.ts`
- [x] `libs/ui/components/src/lib/progress-capsule/progress-capsule.component.ts`
- [x] `libs/ui/components/src/lib/season-container/episode-info-dialog.component.ts`
- [x] `libs/ui/components/src/lib/watched-badge/watched-badge.component.ts`
- [x] `libs/ui/epg/src/lib/epg-item-description/epg-item-description.component.ts`
- [x] `libs/ui/epg/src/lib/epg-progress-panel/epg-progress-panel.component.ts` (idle audit root; also `EpgTrustConfirmDialogComponent`)
- [x] `libs/ui/epg/src/lib/epg-source-status/epg-source-status.component.ts`
- [ ] `libs/ui/remote-control/src/lib/remote-control/remote-control.component.ts` (`apps/remote-control-web` only)
- [x] `libs/ui/playback/src/lib/art-player/art-player.component.ts`
- [x] `libs/ui/playback/src/lib/audio-player/audio-player.component.ts`
- [x] `libs/ui/playback/src/lib/external-player-info-dialog/external-player-info-dialog.component.ts`
- [x] `libs/ui/playback/src/lib/html-video-player/html-video-player.component.ts`
- [x] `libs/ui/playback/src/lib/video-player/sidebar/sidebar.component.ts`
- [x] `libs/ui/playback/src/lib/vjs-player/vjs-player.component.ts`
- [x] `libs/ui/playback/src/lib/vod-details/vod-details.component.ts`
- [x] `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`

`libs/ui/playback` (8) goes with the playback PR, not the `libs/ui` one.

### apps/remote-control-web (1)

- [ ] `apps/remote-control-web/src/app/app.ts` (separate app; converts with `remote-control.component.ts`)

### libs/workspace (7)

- [x] `libs/workspace/shell/feature/src/lib/workspace-command-palette/workspace-command-palette.component.ts`
- [x] `libs/workspace/shell/feature/src/lib/workspace-context-panel/workspace-collection-context-panel.component.ts`
- [x] `libs/workspace/shell/feature/src/lib/workspace-context-panel/workspace-context-panel.component.ts`
- [x] `libs/workspace/shell/feature/src/lib/workspace-context-panel/workspace-settings-context-panel.component.ts`
- [x] `libs/workspace/shell/feature/src/lib/workspace-keyboard-shortcuts/workspace-keyboard-shortcuts-dialog.component.ts`
- [x] `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.ts` (idle audit root)
- [x] `libs/workspace/shell/feature/src/lib/workspace-sources/workspace-sources.component.ts`

### libs/playlist (14)

- [x] `libs/playlist/import/feature/src/lib/add-playlist-dialog/add-playlist-dialog.component.ts`
- [x] `libs/playlist/import/feature/src/lib/auto-import/auto-import.component.ts`
- [x] `libs/playlist/import/feature/src/lib/file-upload/file-upload.component.ts`
- [x] `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.ts`
- [x] `libs/playlist/import/feature/src/lib/text-import/text-import.component.ts`
- [x] `libs/playlist/import/feature/src/lib/url-upload/url-upload.component.ts`
- [x] `libs/playlist/import/feature/src/lib/xtream-code-import/xtream-code-import.component.ts`
- [x] `libs/playlist/m3u/feature-player/src/lib/m3u-vod-detail/m3u-vod-detail.component.ts`
- [x] `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts`
- [x] `libs/playlist/shared/ui/src/lib/recent-playlists/empty-state/empty-state.component.ts`
- [x] `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.ts`
- [x] `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-item/playlist-item.component.ts`
- [x] `libs/playlist/shared/ui/src/lib/source-health/source-cleanup-dialog.component.ts`
- [x] `libs/playlist/shared/ui/src/lib/source-health/source-health-indicator.component.ts`

`libs/playlist/m3u/feature-player` (2) goes with the playback PR.

### libs/portal (9)

- [x] `libs/portal/shared/ui/src/lib/components/favorites-layout/favorites-layout.component.ts`
- [x] `libs/portal/shared/ui/src/lib/components/playlist-error-view/playlist-error-view.component.ts`
- [x] `libs/portal/shared/ui/src/lib/components/search-form/search-form.component.ts`
- [x] `libs/portal/shared/ui/src/lib/navigation/portal-rail-links.component.ts`
- [x] `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- [x] `libs/portal/stalker/feature/src/lib/stalker-favorites-button/stalker-favorites-button.component.ts`
- [x] `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- [x] `libs/portal/xtream/feature/src/lib/global-search-results/global-search-results.component.ts`
- [x] `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`

Test-only files that set Eager are not listed; they do not ship. The guard
skips every `*.spec.ts` / `*.test.ts` file with or without a suffix
(`*.spec-stubs.ts`, `*.test-helpers.ts`, `*.test-stubs.ts`, …),
`test-setup.ts` and `test-stubs/` directories.

## Zone-dependent sites

Plain (non-signal) fields read by a template and written from a callback
that is not an Angular template event. Under zone.js the next tick happens to
refresh an Eager view; under zoneless nothing schedules one. Each fix makes
the field a signal (or a `computed`), or writes it through one.

| Done | Site | What depends on the zone | Owning PR |
| --- | --- | --- | --- |
| [x] | `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts` `onChannelNumberInput`/`clearChannelNumberInput` | 2 s `window.setTimeout` hides the channel-number overlay through plain `showChannelNumberOverlay`/`channelNumberInput` | playback |
| [x] | same file, `applySettings` and the settings `effect()` | IndexedDB `storage.get(...).subscribe` and an effect assign plain `playerSettings`, which picks the player in the template | playback |
| [x] | `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-item/playlist-item.component.ts` `checkPortalStatus` | plain `portalStatus` assigned after `await` in `ngOnInit` (PWA only: skipped when source health is supported) | playlist |
| [x] | `libs/playlist/shared/ui/src/lib/recent-playlists/playlist-info/playlist-info.component.ts` (EPG clear and EPG file pick handlers) | plain `playlist` reassigned after `await` | playlist |
| [x] | `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.ts` (device-id derivation) | `form.patchValue` after `await`; no fix needed: while derivation is on `hasManualDeviceIds` is false whatever the IDs are, the controls write their own DOM values, and typing goes through value-accessor listeners that mark the view | playlist |
| [x] | `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts` (favorites load) | `favorites` Map filled in a `subscribe` without `markForCheck`; the component is OnPush already, so this is a latent bug today | portal |
| [x] | `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts` (favorites load) | same pattern; the neighbouring `favoriteMarks.changes$` handler does call `markForCheck` | portal |
| [x] | same file, programme dialog `afterClosed` | deletes from `epgPrograms`/`currentProgramsProgress` after `await` without marking | portal |
| [x] | `apps/web/src/app/settings/settings-backup.facade.ts` (backup import) | `change` listener on a detached file input → `hydrateFromStore()`; section templates read `form().value.theme`/`coverSize`; no fix needed: a value-only `patchValue` re-renders the OnPush sections (`settings.component.form.spec.ts` guards it) | apps/web |
| [x] | `libs/ui/epg/src/lib/epg-guide/epg-guide.component.ts` (jump to now, keyboard focus) | `afterNextRender` registered from CDK/RxJS callbacks; zone.js followed them with a tick, zoneless schedules no render, so the guide opened at midnight. It now marks itself when it registers the hook. Found by `epg-guide.e2e.ts` on the zoneless build | flag |
| [ ] | `libs/ui/remote-control/src/lib/remote-control/remote-control.component.ts` | plain `isLoading`/`error`/`status` written after `await` and from a 2 s `setInterval` | only if `apps/remote-control-web` goes zoneless |

## Explicit zone and change-detector calls

They keep working under zoneless (`NgZone` becomes `NoopNgZone`, so `run`
and `runOutsideAngular` just call through). Remove them in the flip PR, not
before: with zone.js on they still matter.

- [x] `apps/web/src/app/settings/settings-unload-guard.service.ts`: two
  `zone.run` calls around the window-close dialog (IPC
  `onWindowCloseRequested` and `beforeunload`).
- [x] `libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-session-controller.ts`:
  `runOutsideAngular(() => setInterval(...))` for the position poll;
  `embedded-mpv-session-controller.position.spec.ts` asserts the call and
  changes with it.
- [x] `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.ts`:
  18 `ngZone.run(() => signal.set(...))` calls, all redundant around signal
  writes.
- [x] `libs/workspace/dashboard/data-access/src/lib/dashboard-source-expiry.service.ts`:
  one `ngZone.run` around a signal update.
- `ChangeDetectorRef` in `stalker-live-stream-layout.component.ts`
  (4 × `markForCheck`, 1 × `detectChanges` before measuring a row) and
  `portal-channels-list.component.ts` (3 × `markForCheck`, 2 ×
  `detectChanges`): correct under zoneless; replace the Maps with signals in
  the portal PR if it stays small.

## Checked and signal-safe

No change needed; recorded so the flag PR knows where to look if a journey
regresses. Embedded MPV and external players are the riskiest paths because
their events arrive over IPC.

- **IPC listeners** (17 registrations): app update status, external player
  sessions, window close and window state, player errors, playlist open
  requests, embedded MPV sessions, playback history gate, downloads,
  recordings, playlist refresh, DB operation and save progress, EPG progress,
  playback position updates, channel change and remote-control commands. All
  write signals, signal stores or NgRx, or have no UI state.
- **Player libraries** (video.js, mpegts.js, hls.js, artplayer, shaka, native
  `<video>`): callbacks bump signals in the control adapters or emit outputs
  whose parent handlers write signals.
- **Observers** (13 Intersection/Resize/Mutation observers) and **document
  and window listeners** (~40): signals or DOM only. `@HostListener`
  bindings are Angular listeners and mark their view.
- **Timers** (~130 `setTimeout`/`setInterval`/rAF/`queueMicrotask`): all
  write signals, touch the DOM or focus, or have no UI state, apart from the
  two in the table above.
- **Dialogs and snackbars** (20 `afterClosed`/`onAction` sites): signals,
  stores, outputs or navigation, apart from the one in the table above.
- No production code uses `NgZone.onStable`, `onMicrotaskEmpty`, `isStable`,
  `ApplicationRef.tick()`, `Zone.current` or `ngDoCheck`.

## Build, tests and runtime details

- [ ] `provideServiceWorker(..., { registrationStrategy:
  'registerWhenStable:30000' })`: under zoneless "stable" means no pending
  tasks. The 30 s bound still registers the worker; check the PWA build in
  the flag PR.
- [ ] `change-detection-tick-counter.ts` wraps `ApplicationRef._tick`, which
  the zoneless scheduler also calls, so the counters stay comparable.
- [ ] Specs that need zone.js: `fakeAsync` in
  `playlist-switcher.component.spec.ts` and `stalker-live-navigation.spec.ts`,
  `waitForAsync` in 13 files. They keep `zone.js/testing` until rewritten;
  removing zone.js from the build polyfills does not affect them.
- [ ] Unreferenced leftovers to delete in the flip PR:
  `apps/web/src/polyfills.ts`, `apps/web/src/polyfills-test.ts`,
  `apps/web/src/setup-jest.ts` (no project, tsconfig or Jest config uses
  them).

## Zoneless flag

`app.config.ts` takes its change-detection providers from
`apps/web/src/environments/change-detection.providers.ts`
(`provideZoneChangeDetection({ eventCoalescing: true })`). The
`electron-performance-zoneless` and `electron-e2e-zoneless` web
configurations are their base configuration plus one `fileReplacements`
swap to `change-detection.providers.zoneless.ts`
(`provideZonelessChangeDetection()`); a test in
`performance-build-config.spec.ts` pins that and refuses the swap in any
other configuration. zone.js stays in the polyfills, so these builds log
NG0914 in dev mode and nothing schedules through the zone. The Electron app
loads the renderer from `dist/apps/web`, so rebuilding only the web app
switches an existing Electron build:

```bash
pnpm nx run electron-backend:build-performance          # or build-e2e
pnpm nx run web:build:electron-performance-zoneless     # or electron-e2e-zoneless
cd apps/electron-backend-e2e
../../node_modules/.bin/playwright test --config=playwright.journeys.config.ts
../../node_modules/.bin/playwright test --grep-invert packaged
```

Do not run `pnpm run perf:journeys` or `pnpm nx run electron-backend-e2e:e2e`
afterwards: their build dependencies restore the zone.js renderer.

First measurement (macOS, 2026-10-04, the six OnPush PRs merged locally on
the flag branch; the same integration build measured with the flag off and
on, five iterations each):

| Counter | flag off | flag on |
| --- | --- | --- |
| `renderer.cdTicksToFirstCard` | 22, 20, 22, 21, 21 | 7, 7, 7, 7, 7 |
| `renderer.cdTicksIdle30s` | 4, 4, 4, 4, 4 | 3, 3, 3, 3, 3 |
| `renderer.cdTicksToFirstPage` | 22 (all) | 8 (all) |
| `renderer.cdTicksToPlaying` | 16, 15, 15, 17, 15 | 6, 8, 10, 10, 7 |
| DOM mutations J1 / J2 / J3 | 553 / 1,603 / 6,182 | 553 / 1,603 / 6,182 (one J3 iteration 6,199, as on master) |
| `spawnToFirstCardMs` p50 | 3,071 | 828 |
| `clickToFirstPageMs` p50 | 82.8 | 80.4 |
| `clickToLoadedMetadataMs` / `clickToPlayingMs` p50 | 94.8 / 268.7 | 158.3 / 409.3 |

J1 and J2 tick counts become deterministic without the zone.js one-tick
race, and the DOM mutations are unchanged, so nothing renders differently.
J3's tick count still varies with player events and its wall-clock
numbers rose locally; the machine was shared with other runs (load 26 to 58
during these two runs, master itself read 363.8 ms `clickToPlayingMs` p50
earlier the same day), so judge J3 on the CI runner before the flip.

Electron E2E suite on `electron-e2e-zoneless` (all specs except the
packaged frame-copy ones): 203 passed, 7 skipped, 3 failed. `epg-guide`
failed on every run and is fixed above; `playlist-auto-refresh` passed on
`--repeat-each=2`; `dash-clearkey` "reopens from recent and favorites" is the
known local flake (it fails as often on master). The IPC-driven paths
passed zoneless: external-player launch states and the MPV/VLC DASH
fallbacks in `dash-clearkey`, the MPV double-click gate in `settings`,
`remote-control`, `picture-in-picture` and `stream-info`. Their state reaches
the renderer over IPC into signals and never ran in the zone. Embedded MPV
playback itself is covered only by the packaged frame-copy E2E, which these
runs left out; run it on a packaged zoneless build before the flip.

## Measuring a PR

Build `electron-performance` and run the journeys as described in
[performance journeys](performance-journeys.md), then paste
`renderer.cdTicksToFirstCard`, `renderer.cdTicksIdle30s`,
`renderer.cdTicksToFirstPage` and `renderer.cdTicksToPlaying` before and
after. While zone.js is on, removing Eager does not change the number of
ticks, only the work per tick; expect the counters to stay put until the flag
PR and the template work (DOM mutations, profile time) to drop.
