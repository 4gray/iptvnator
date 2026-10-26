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


## Rebase and LG installation — TV 0.1.15

The Settings commit is rebased onto `origin/master` at `aecfb7d7d` (merged TV
PR #2003). The only conflict was the library browser test's import/server
constant; both the upstream `UserData` import and offset-based library URL are
retained. Stalker watchdog, source identity and phone security fixes from master
remain unchanged. The rebased feature commit is `38826f25b`.

The prototype package advances from 0.1.14 to 0.1.15. This is a local TV package
release, not a desktop `v*` release: global package version, changelog consumption,
release tags and public desktop assets are unchanged.

Frozen dependencies were reinstalled after rebase. Final local gates:

- All 85 TV unit tests pass through `pnpm nx test tv-tests`.
- The full TV browser suite passes all 96 scenarios using
  `TV_E2E_PORT_OFFSET=10000 pnpm nx e2e tv-e2e`, including watchdog activation,
  provider identity/security, Settings drafts, remote navigation and phone setup.
- Lint/typecheck passes for TV, feature, UI, data-access, util, tests, E2E and
  phone setup, through each project's available target (12 tasks total).
- Production build, classic IIFE/ES2018 audit and IPK packaging pass.
- All 161 release notes, 3 agent guidance files and 8 repository skills validate.

`com.iptvnator.tv.prototype_0.1.15_all.ipk` is installed over 0.1.14 on the
existing paired `iptvnator-lg-bx` device, without uninstalling the application.
The installed app's local appinfo confirms 0.1.15; its engine reports
Chrome 68.0.3440.106 at 1920×1080.

On-device CDP checks pass: six categories, one visible panel, no outer overflow,
Right into a native select, Left to its category, Down to EPG, Right into its
checkbox, webOS 461 Back to categories, retained category/control on leaving and
returning, native text-caret ownership, and no visible alerts. Screenshots of
Metadata and remote help were inspected. The source selector was hidden only
while capturing these local screenshots, then restored; no saved setting or key
was edited. A pointer probe ran while the app had returned to the background and
did not move focus; it is not counted as a pointer pass. Actual physical arrows,
Magic Remote feel and media playback were not exercised in this Settings check.
Browser pointer coverage passes. The prior first-launch playback limitation from
the Stalker investigation remains outside this change.

Before/after read-only snapshots agree on all compared SHA-256 digests: source
configuration (excluding renewable Stalker session tokens), active source and TV
preferences, library configuration (excluding last-sync timestamp), favorites,
history and progress. Both contain 3 sources, 8 favorites and 19 history/position
records. Only counts and digests were saved locally; source details and keys were
not written to the report. Initially the debugger's IndexedDB read was suspended
because the app was hidden; bringing the app forward completed it normally.

Evidence lives under `dist/tv-verification/settings-0.1.15/`: `before.json`,
`after.json`, `lg-checks.json`, `lg-metadata.png` and `lg-remote.png`. Browser layout
screenshots remain under `dist/tv-verification/settings-categories/`.
Package: `dist/tv-package/com.iptvnator.tv.prototype_0.1.15_all.ipk`.
SHA-256: `71c758d018df10bef27b437f7ec7d39bd5760304d10ee5c18d60500028a3412f`.
No NAS service, desktop release, push, PR or merge was performed during this
local installation. The user subsequently authorizes publication and merging through a PR on
2026-10-26; the initial installation remains a local-package operation.


## Publication follow-up — 2026-10-26

The first local Codex review of `3c0677fb9` was interrupted by model capacity
before a final verdict; it is not recorded as a clean review. Greptile CLI is
not installed and was not installed or configured on the user's behalf.

A dynamic-control focus issue investigated during that review is independently
reproduced by a regression: two discovered backend buttons duplicate a retained
control's positional focus key. Before the fix, 8 controls have only 7 unique
keys, and returning can select the wrong control. Settings controls now declare
stable semantic keys in their owning components; the positional assignment effect
is removed. The new test checks uniqueness, an unchanged probe key, category Back
and Right restoration, and leaving/re-entering Settings. It fails before the fix
and passes afterwards. All six dedicated Settings E2E scenarios pass.


After this focus correction, all 85 unit tests and all 97 TV browser E2E cases
pass. The TV/feature/UI/data-access/util/tests/E2E/phone lint and available
typechecks (12 tasks), production build, ES2018 audit, packaging, agent guidance
and release notes validation pass again. The package remains the local 0.1.15
prototype; no public package with that version has been published.


The completed second local Codex review identifies three additional issues:
background pointer/programmatic focus can escape the QR modal, disabled controls
can defeat focus restoration, and a category selected after remount loses its
remembered scroll. Each has a failing pre-fix browser regression. A viewport
backdrop plus document focus guard retains modal focus; restoration excludes
disabled controls and restores scroll whenever a category becomes visible.
All 10 focused Settings/phone scenarios pass after the fixes.


After the modal/restoration fixes, all 85 TV unit tests and all 100 TV browser
E2E cases pass; lint/typechecks, ES2018 verification and packaging also pass.
The corrected 0.1.15 IPK SHA-256 is
`e6ee58d43a93fa0f2765c8822b4e57fd5575925fae40e105105fe33adde17217`
(bundle `index-E4_eqUog.js`). This supersedes the initial local 0.1.15 artifact
for publication; the earlier on-device checks above describe the initial build.


The third completed review identifies a missing select-to-Save remote path,
closed-disclosure fields retained as focus candidates, and vertical navigation
escaping Metadata into another category. New browser regressions cover Save at
1920×1080 and 1280×720, Metadata's complete control sequence, and closed token
entry/restoration. Settings now owns panel control traversal while retaining
native caret and select-choice keys. A separate before/after regression also
confirms OK toggles the EPG checkbox without implicit form submission; only the
explicit Save action commits it and the result survives relaunch.


At the last control, Down now scrolls remaining panel explanations instead of
switching categories or blocking access to the diagnostic help. This also has a
failing pre-fix regression. The final navigation batch passes all 19 focused
Settings/phone/presentation scenarios, all 106 full TV E2E scenarios, 85 unit
tests, 12 lint/typecheck tasks, build/ES2018/package and notes/guidance checks.

Latest publication package (0.1.15) SHA-256:
`64f5a55fb0090386a1fe84d501c674d20f922f7e7dc12ffbe878871e54c6105b`
(bundle `index-DpwqkW9E.js`). Prior artifact hashes and on-device checks above
are historical; the publication package includes the subsequent review fixes.
The first attempt to reconnect to LG on 2026-10-26 times out, so that attempt
cannot certify installation of the corrected artifact. The existing initial
0.1.15 installation and its matching before/after data digests remain valid.


GitHub Greptile review of PR #2006 identifies one additional draft-refresh case:
explicitly applying unchanged committed phone defaults leaves different unsaved
local drafts behind. The regression reproduces this for Appearance, EPG and
TMDB, including a failed first write, while retaining a separate library draft.
Phone setup now notifies Settings only after its atomic write commits. Settings
then refreshes only the three phone-managed forms, including unchanged values;
a failed write never refreshes them, and an acknowledgement retry does not
repeat the refresh. Connection and library components retain their drafts.


The initial GitHub Unit Tests and Typechecks job fails one web-backend contract
that still expects literal TV ports. Its updated assertions retain the isolated
backend/library defaults, token, origin, single-process launch and phone-asset
packaging checks, and now cover the optional offset declarations. All 238
web-backend tests pass with coverage (92.76% statements, 85.66% branches,
92.05% functions, 93.02% lines); no threshold or gate is changed.

After the Greptile fix, all 107 TV browser E2E cases, 85 TV unit tests and 13
available lint/typecheck tasks pass, as do build/ES2018/package and notes/guidance
checks. Latest candidate package SHA-256:
`be33258c5f1d36a4100c80bd7c5ee9ba4ca36c4f3f46ca7c55b59aee91d72461`
(bundle `index-BgdQ5yf9.js`). Static QR instructions are extracted into the
existing phone-panel module to keep PhoneSetup below 300 production lines.
The fourth local review is clean on `d9912eb6f`; the phone-refresh and stale-test
corrections are committed together for the next local review and single PR push.
