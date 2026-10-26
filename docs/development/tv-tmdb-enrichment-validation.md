# TV TMDB enrichment and series titles — 2026-10-25

Implementation revision: `0a6184d8ed3364408165541b549493b17b2ecd9d`, branch
`codex/tv-tmdb-enrichment`, TV worktree only. The branch starts from merged
`origin/master` (`aecfb7d7d`) and includes the completed Settings 0.1.15 commits
through `3c0677fb9` so the device update preserves its installed categories.
Neither the main checkout nor the Settings worktree/branch is changed.
No push, PR, merge to master, CI run or NAS deployment is performed.

## Confirmed on LG before the change

Target: OLED55BX9LB, webOS 5.6.2 / Chromium 68, `iptvnator-lg-bx`.
The session first observes the open movie card, before navigation or restart.
The later installed-app inventory confirms prototype 0.1.15.

- The initial card is **Край чудес**. IndexedDB has a nonblank TMDB key and
  language `ru`, but the saved opt-in is `enabled=false`. No TMDB resource
  requests are present. Key validation alone does not activate enrichment.
- After enablement is saved, actual search/detail requests return HTTP 200
  with `ru-RU` metadata. Край чудес matches movie ID **1628675** (2026), with
  overview, backdrop and 12 cast members available. Its backdrop renders in
  the installed application.
- **Ted Lasso s04** searches as `Ted Lasso` and matches TV ID **97546**,
  premiere 2020. The show payload has backdrop, localized overview, 12 members
  in the latest-season cast and 4 creators. It lists season 4 with 10 episodes.
  The provider detail renders numbered episodes and a saved resume position.
- A localized search for **The Chestnut Man** returns Каштановый человечек
  (ID 127865), but no show-details request follows. The added regression
  reproduces an English provider title whose localized and original names
  cannot corroborate it; an English search then passes the existing strict gate.
- Historical episodes retain parent-scoped identities and commands, but only
  titles such as `Episode 1` / `Episode 3`; they have no parent display name.
- The previous TV adapter explicitly discards credits and has no season
  metadata integration. This is separate from network/key validity.

Only safe flags, cleaned titles, match IDs, field counts and HTTP statuses are
reported. API keys, provider addresses, media URLs, MACs and authentication
headers are excluded from evidence.

## Implemented behavior

The [TV contract](../architecture/tv-application.md#artwork-and-optional-tmdb-metadata)
and [TMDB contract](../architecture/tmdb-metadata-enrichment.md) describe ownership.
TV now displays shared cast and movie-director/series-creator extraction.
The shared season client serves Angular and TV, preserving existing cache keys,
language fallback and provider playback authority. Selected seasons gain the
available episode still, description and a real name for generic placeholders.
Explicit single-season suffixes select the appropriate TMDB season without
rewriting provider coordinates. Missing/foreign/unnumbered episodes pass through.

The saved parent title is independent of episode title. Historical history,
favorites and retained positions repair it when the exact source/parent appears
in available catalogs or selections; unknown titles are not guessed. Seconds,
timestamps, identities and commands are preserved. Settings explains saved
enablement and unsaved changes after a successful key check.

## Local verification

Node 22.23.2, pnpm 10.33.0, frozen dependencies match the repository lockfile.
The implementation revision above passes:

| Check | Result |
| --- | --- |
| TV unit tests | 89/89 |
| Shared TMDB unit tests | 87/87 |
| Angular TMDB service/helper tests | 101/101, 11 suites |
| Affected lint | 9 projects pass |
| TV, TV-tests and TV-E2E types | Pass |
| Shared TMDB and services spec types | Pass |
| Angular application entrypoint types | Pass |
| Focused production-browser E2E | 13/13 |
| TV package and classic-IIFE/ES2018/builtin verification | Pass |
| Release-note, guidance and diff checks | Pass |

The browser selection covers Home navigation/resume/relaunch, credits, episode
images/descriptions, retry after 503, obsolete show/season responses, failed
artwork, disabled/invalid keys, saved language/enablement and all five Settings
category scenarios. Test fixtures contain no real keys. Tests run against the
production TV bundle with the actual backend and local provider mocks, using
`TV_E2E_PORT_OFFSET=700` to avoid other worktrees' servers.

Both key regressions are observed failing before the corresponding fix:
localized English-title matching returns no ID; the old TV adapter drops the
expected actor field. Restoring the fixes passes the suites. Shared TMDB
coverage: statements 78.30%, branches 59.23%, functions 66.66%, lines 78.39%.
No thresholds or baselines change. A whole-workspace coverage/merge gate and
full unrelated TV/Electron E2E are not run; no merge is requested and this change
adds no Electron IPC, native player or database migration behavior.

Package: `dist/tv-package/com.iptvnator.tv.prototype_0.1.16_all.ipk`.
SHA-256: `f63606ff9f07beedd69b1f40cb991a38be01cd8f5a0f9551e84df58bdb182014`.

## Device update status on 2026-10-25

The first installation attempt fails before installation: the TV stops replying
to ICMP and its Developer Mode SSH port 9922; `ares-install` reports a connection
timeout. No successful update or post-fix LG validation is claimed. The user has
authorized installation and has been asked to restore device availability.

Remaining device checks: install/confirm 0.1.16 and bundle fingerprint, verify
actual movie credits, series creators, selected-season episode fields and images,
repair the existing episode titles by visiting their parents, and verify Home
plus saved resume after relaunch. Real season-4 episode descriptions/stills have
not yet been inspected; a show listing ten episodes does not prove those fields
exist. TMDB cannot supply fields absent from its selected show/season/language.
At 0.1.16, person pages, discovery, trailers and whole-catalog enrichment remain
outside the TV integration; the 0.1.17 follow-up below adds person pages. Movie directors and series creators remain distinct roles.

## Person filmographies — prototype 0.1.17

The requested follow-up adds person pages to the earlier 0.1.16 scope.
Implementation revision: `71c52fe136f50e7b8005cbbfe7db246f13e59290` on the same
isolated branch. Actor, movie-director and series-creator controls now have
circular photos (or initials) and names, with a shared cached person client and
complete filmography projection. Angular keeps its existing 80-credit default;
TV requests all deduplicated acting/directing/creating credits and virtualizes
its display.

Choosing a filmography title searches only the active provider by display and
original title. Normalization/year evidence distinguishes remakes and canonical
numeric titles, and an exact title/year match may open immediately when a portal
ignores search filtering. Provider versions can be chosen when several match.
Found entries open provider details; TMDB IDs never become playback IDs. Only a
finished empty search reports unavailable. Connection/incomplete-search failures
have retry; cancellation, timeout and navigation cannot open obsolete results.
Back restores card focus and scroll even for a distant virtualized card.

Final local checks on that implementation:

- TV unit tests: **96/96**; shared TMDB: **90/90**; Angular TMDB: **101/101**.
- Affected lint: **9 projects pass**; TV, TV-tests and TV-E2E types pass.
  Angular application entrypoint and both shared-TMDB/services spec programs
  also pass after extraction of the shared person implementation.
- Focused production-browser regression selection: **17/17 pass**, including
  four person scenarios: real backend plus Xtream and Stalker mock lookups,
  actor/director navigation, absent titles, retry/cancel, person API failure,
  a 103-credit list and distant-card focus/scroll after detail Back.
- Screenshots of circular people controls and filmographies at 1920/1280 px
  are visually inspected; the checked layouts have no horizontal overflow.
  Evidence uses fictional people, images and credentials under
  `dist/.playwright/apps/tv-e2e/test-output/tmdb-person.e2e.ts-*`.
- IPK packaging, classic deferred IIFE, ES2018 syntax and unsupported builtin
  checks pass. Shared TMDB coverage: statements **80.38%**, branches **60.60%**,
  functions **69.04%**, lines **80.65%**. No thresholds/baselines change.
- A new user-facing release note and canonical TMDB/TV contracts are updated;
  release-note, guidance and diff checks pass.

Package: `dist/tv-package/com.iptvnator.tv.prototype_0.1.17_all.ipk`.
SHA-256: `6addbbadcfab52646ad59185481f01de4fb3d6fec5fdcc0bdb1382b60a4904ef`.
The LG Developer Mode port is unavailable during this 2026-10-25 follow-up, so
this package is not installed then. The next section records the subsequent
installation separately. These mocked browser checks alone do not certify real
cast/director clicks or provider matching. No push, CI, master merge or NAS
deployment is performed.


## Real LG update — 2026-10-26

After the user restores device availability, Developer Mode SSH connects and
`ares-install --listfull` confirms the previous app is 0.1.15. The TV worktree is
clean at `c7e87bf13`; the previously verified 0.1.17 package retains SHA-256
`6addbbadcfab52646ad59185481f01de4fb3d6fec5fdcc0bdb1382b60a4904ef`.
Installation reports **Success**, launch succeeds, and the installed-app inventory
now confirms **0.1.17**. This update does not change the NAS or other clients.

Safe, in-device comparisons before/after installation confirm:

- The full source snapshot and saved TMDB key have identical fingerprints;
  all three sources remain present and metadata stays enabled.
- Favorites, history and retained-position counts remain unchanged (20 history
  entries / 20 retained positions).
- Both historical episodes keep their exact playback-identity/command
  fingerprints. Their parent display names now read **Ted Lasso s04** and
  **Полдень (6 серий)**, separately from their original episode names.
- The Полдень saved position and timestamp remain identical. Ted Lasso has a
  fresh position update while the application is being used; this is not a
  claim of byte-for-byte preservation of actively updated viewing progress.

The real device opens the **Анна Михалкова** person page with a biography and
**103 filmography credits**, independently of the earlier fictional browser
fixtures. Subsequent captured TMDB search/detail replies, including TV ID 97546,
return HTTP 200. These observations confirm a real person/filmography screen and
show-level API access; they do not by themselves prove image loading or every
filmography-to-provider result.

The running script name `index-CBP7qzoY.js` and its CDP-reported size (260,791
bytes / 260,410 characters) match the script archived in the installed IPK.
The webOS CLI enables minification by default (`bin/ares-package.js`), so its
archived script differs from the pre-package Vite output. The archived script
is separately parsed with ES2018 and passes the unsupported-builtin scan.
A byte-hash comparison of the running script is not captured before the next
connection loss; filename/size and the successfully installed package are the
recorded provenance, not an asserted runtime SHA comparison.

The connection then drops again: the Mac is still in the TV's subnet and the
NAS responds, while the TV stops responding to ICMP and SSH port 9922. The user
is asked to confirm its current Developer Mode IP and leave IPTVnator open.
The remaining physical-device gate is **not complete**: actual avatar image
loading, director navigation, matched/missing filmography titles, season episode
fields, and a controlled resume/relaunch observation remain pending. No new LG
screenshots are captured in this reconnect session. Local implementation checks
above remain valid; no runtime source changes are made for this installation.
