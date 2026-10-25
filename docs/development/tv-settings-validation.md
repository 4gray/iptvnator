# TV Settings categories validation — 2026-10-25

Implemented in `codex/tv-settings-categories`, based on TV revision
`9841741d35ef50d1c1799df98992f0a30cc2e1e2`, in the dedicated
`/Users/fourgray/.codex/worktrees/tv-settings-categories/iptvnator` worktree.
No other checkout, device or NAS service is modified.

## Behavior

Settings keeps the application's main navigation and adds six categories beside
one scrolling content panel. Connection includes the existing direct-access
probe; the phone action stays available above every category. Category changes
preserve mounted forms and their drafts. Appearance and programme-guide forms
commit only their own field against the current storage snapshot. The storage
schema and phone settings protocol are unchanged.

Right/OK enters a category, Left returns from controls except text caret fields,
and Back returns to categories before leaving Settings. Native select Up/Down
remains available. Category/control and scroll hints survive navigating away and
back during the current application session. The phone dialog owns directional
and Tab focus, and webOS Back closes it before navigating away.

## Local checks

Node 22.23.2, pnpm 10.33.0; this worktree has its own frozen dependency install.
Nx project discovery and the owning targets were inspected before checks.

- `pnpm nx test tv`: 74/74 pass.
- `pnpm nx run-many -t lint,typecheck -p tv,tv-feature,tv-e2e,tv-tests`: pass
  (the feature library's typecheck is covered by the TV application target).
- `TV_E2E_PORT_OFFSET=10000 pnpm nx e2e tv-e2e` with the grep below: 47/47 pass.
- `pnpm nx run tv:package`: production build, ES2018 syntax and unsupported
  builtin verification, classic IIFE validation and local IPK packaging pass.
- `pnpm exec ares-package -i` confirms app/version/main metadata.
- Release notes (156), agent guidance (3) and repository skills (8) validate.
- `git diff --check`: pass.

E2E selection:
`settings-categories.e2e|phone-settings.e2e|phone-setup.e2e|presentation.e2e|library.e2e|stabilization.e2e|recovery.e2e|tmdb.e2e`.
This includes five dedicated Settings cases: draft/save isolation, focus/Back and
return, pointer/layout checks, modal arrows/Tab/461 Back, and library drafts plus
TMDB write-error recovery. Existing phone confirmation/blank-key/relaunch,
library/source identity, quota/retry and mock playback flows also pass.
The full unrelated TV catalog/guide suite was not rerun.

An initial run stopped because another worktree owned standard E2E ports.
The servers were left running; the test configuration now supports an optional
port offset. The final isolated run takes about two minutes, including the
production QR-session rate-limit window. Tests retain that limit.

## Evidence and limits

Browser screenshots at 1920×1080 and 1280×720 were visually inspected. They show
Connection, Library, Metadata and remote help with stable panel geometry and no
outer scrolling. At 720 px height the category list scrolls to retain large rows.
Screenshots contain no configured sources or keys.

Ignored local evidence:

- `dist/tv-verification/settings-categories/1920-*.png`
- `dist/tv-verification/settings-categories/1280-*.png`
- `dist/tv-verification/settings-categories-unit.log`
- `dist/test-results/tv-e2e/results.json`
- `dist/tv-package/com.iptvnator.tv.prototype_0.1.13_all.ipk`

IPK SHA-256:
`efb07540c84f910d859fee760471d62976c05057cfb30a21a55a64a8b472f9e2`.
The final classic bundle is `index-DqPIQej8.js` (240508 bytes).
The package retains the branch's existing 0.1.13 prototype version.

No LG connection, install, launch or physical remote test was performed. Browser
Chromium and static ES2018 checks do not certify Chromium 68/webOS keyboard,
Magic Remote feel or real media playback. Stream investigation is outside this
change. There was no push, PR, CI dispatch, merge or NAS change.

Canonical behavior is documented in `docs/architecture/tv-application.md`;
release note: `.changes/tv-settings-categories.md`.
