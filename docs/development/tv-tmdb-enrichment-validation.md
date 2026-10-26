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


## Integrated Settings update and completed LG gate — prototype 0.1.18

On 2026-10-26, fetch observes merged Settings PR #2006 at `5b9724cb3`.
The isolated TMDB branch merges that master revision locally in `513729116`,
retaining the newer stable focus keys, remote form navigation, modal focus and
committed phone-draft refresh. Prototype metadata and package examples advance
to **0.1.18**. Main and Settings checkouts/branches are not modified.
Frozen installation completes with the required Node/pnpm versions, the local
lockfile matches, and Nx discovery succeeds after integration.

The live device reveals an additional compatibility case: this portal's
`series/get_ordered_list` replies with `js: false`, while its VOD catalog holds
embedded series. The previous filmography lookup stops at that response.
Revision `037f91cd0dc5e3044b4f0bc5bd8fd83c5b83006f` adds an explicit Stalker
VOD-series capability and tries both relevant catalogs and display/original
queries. A failed lookup cannot suppress a later match; any unresolved lookup
still prevents a false absence message. Provider identity and playback commands
remain authoritative. A unit regression reproduces the original failure before
the fix, then passes, including a same-title movie collision and unresolved
availability. A production-browser regression covers the VOD-series round trip.

Local validation of the final runtime revision:

| Check | Result |
| --- | --- |
| TV unit tests | **97/97** |
| Shared TMDB unit/coverage suite | **90/90**, unchanged cached inputs/results |
| Angular TMDB service/helper tests | **101/101**, 11 suites |
| Lint | **9 affected projects pass**, existing warnings only |
| TV, TV-tests and TV-E2E types | Pass |
| Production-browser regression selection | **31/31** |
| TV build/package, classic deferred IIFE, ES2018 and builtin scans | Pass |
| Archived IPK JavaScript ES2018 and builtin scans | Pass |
| Release-note/guidance/diff checks | Pass |

The 31 browser cases include all current Settings category/remote scenarios,
phone settings confirmation and unchanged-value draft refresh, storage failures,
Home resume/relaunch, actor/director filmographies, errors/cancellation, complete
long filmographies, selected seasons, and obsolete metadata responses. They run
against the production bundle, local backend/provider fixtures and port offset
700. Shared TMDB coverage remains 80.38% statements / 60.60% branches / 69.04%
functions / 80.65% lines. Earlier Angular entrypoint/spec type checks remain
applicable because integration does not alter their TMDB inputs. No thresholds
or baselines change. Full unrelated workspace/Electron suites are not repeated:
the new runtime fix is TV-only and unrelated merged master changes are retained
as published. No push, paid CI, PR, merge to master or NAS deployment is performed.

Final package: `dist/tv-package/com.iptvnator.tv.prototype_0.1.18_all.ipk`.
SHA-256: `932bf560ce743db9fd9b1181473fa258cb5bc52bc615e09bde1180bff0235823`.
Installation and launch succeed; installed-app inventory reports **0.1.18**.
CDP reads `index-CuHfTAtL.js` from the running LG: **263,387 bytes**, with a
SHA-256 **exactly matching the archived IPK script**. This replaces the earlier
filename/size-only runtime provenance limitation. Before/after comparisons of
the full source snapshot and TMDB key match; saved enablement/language and all
source/favorite/history/position counts are unchanged by installation.

Real-device workflow evidence, using the active Stalker source:

- After relaunch, Settings still has six categories. A remote Right from
  Metadata enters the stable `tmdb:enabled` control; enablement and Russian
  language remain saved and the existing key stays present in a password field.
- Actor and creator photos load inside 96px circular containers; a missing
  creator photo retains initials. The real Jason Sudeikis page has **112**
  filmography credits. Denis Chernov opens from the movie director control,
  with a circular loaded profile and **19** credits. The checked pages have
  no horizontal overflow.
- Choosing **An SNL Thanksgiving** finishes with the portal-unavailable
  message. Denis Chernov → **Край чудес** opens the actual provider movie
  with its Watch action. The latter two observations first run on 0.1.17;
  their implementation is retained in 0.1.18.
- On installed **0.1.18**, Jason Sudeikis → **Тед Лассо** now opens the real
  VOD series **Ted Lasso (1 season)** despite the unsupported regular-series
  catalog. Names, descriptions and loaded episode stills appear. Back restores
  focus to the exact `filmography:tv:97546` card.
- Selecting **Ted Lasso s04** uses TMDB season **4**. Its actual HTTP-200
  payload contains **10 episodes, 10 descriptions and 10 still paths**.
  The LG displays localized episode titles (Дом, Любопытнее и любопытнее!,
  Ричмонд ищет таланты), descriptions and loaded still images.
- Episode 3 resumes from saved **1197.544 s**; native video reports
  **1198.732 s**, ready state 4, unpaused and no media error. The player shows
  the series name separately from **Ричмонд ищет таланты**. After Back the
  saved position is **1210.573 s**, with the playback identity/command
  fingerprint unchanged.
- A controlled `ares-launch --close` followed by launch preserves that exact
  **1210.573 s** value. Home and Continue watching show the parent, localized
  episode and season/episode coordinates. Home Continue resumes playback near
  that point (**1208.025 s** observed; normal native stream seek granularity),
  ready state 4 and no media error. Back stops the test playback.

Locally retained device screenshots: `dist/tv-verification/lg17-credits.png`,
`lg17-director.png`, `lg18-season1.png` and `lg18-season4.png`. They show artwork
and cleaned titles without keys, portal/media addresses, MACs or auth headers;
raw network events are never printed. The previously pending physical gate is
now complete for the exercised source and titles. Other providers retain the
mocked Xtream/Stalker coverage; this is not a claim of exhaustive real-portal
compatibility.


## Local pre-PR hardening — prototype 0.1.19

The user subsequently authorizes PR publication and merge to master. The first
local Codex review of `50ddde63c` identifies three P2 issues: unrestricted later
TV years can select a same-title remake, literal Xtream/M3U catalog filtering
can hide punctuation-equivalent titles, and overflowing biographies cannot be
scrolled with the remote. All three findings are accepted and fixed.

The year exception now requires an explicit season marker after season 1;
unmarked shows retain premiere-year corroboration. The actual local provider
filters reuse shared title normalization while retaining literal partial search.
Biography Up/Down scrolls the focused text and releases focus at its boundaries.
Unit regressions for both real provider adapters and the remake, plus the
browser biography regression, fail before the fixes and pass afterwards.

After the fixes: **99/99 TV unit tests**, **116/116 full TV browser scenarios**,
nine-project affected lint and all three TV type programs pass. The unchanged
shared/Angular TMDB test results above remain applicable. The prototype advances
to **0.1.19**; its package is rebuilt and audited for the classic deferred IIFE,
ES2018 syntax and unsupported builtins. Release-note and guidance validation
pass, without threshold or baseline changes. Canonical TV behavior and the
existing filmography release note describe the final behavior.

The local Greptile CLI is absent; the agent-workflow contract explicitly allows
that unavailable reviewer to be reported without blocking Codex review. Local
review logs remain outside the repository. The device observations and exact
0.1.18 package/runtime provenance above keep their original revision scope;
publication, final review and CI results are recorded with the PR head SHA.


The second local Codex review of `ca6171ad7` finds two further input shapes:
M3U release years stored only in bracketed title tags, and Stalker season
markers present only in an alternate raw name. Both are accepted. Matching now
checks explicit bracketed years before treating a year as unknown, and season
selection uses `pickSeasonMarkedTitle` across all available provider title fields.
Actual M3U and single/multi-season regressions fail before the fixes. Afterwards
**101/101 TV unit tests**, **12/12 focused TMDB browser workflows**, affected
nine-project lint and TV/spec/E2E types pass. The earlier full **116/116** TV
browser run covers the remaining unchanged workflows. The 0.1.19 package is
rebuilt and verified before the next committed-branch review; the master base
remains `5b9724cb3`. No review finding is declined.
