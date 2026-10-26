# TV TMDB enrichment and series titles — 2026-10-25

Implementation revision: `0a6184d8ed3364408165541b549493b17b2ecd9d`, branch
`codex/tv-tmdb-enrichment`, TV worktree only. The branch starts from merged
`origin/master` (`aecfb7d7d`) and includes the completed Settings 0.1.15 commits
through `3c0677fb9` so the device update preserves its installed categories.
Neither the main checkout nor the Settings worktree/branch is changed.
This initial validation performs no push, PR, merge to master, CI run or NAS deployment.
Later integration and publication evidence is recorded chronologically below.

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


The third local review of `e7fdb2953` reproduces a lost Back focus after choosing
one of several provider versions. The fix keeps settled chooser snapshots in an
app-owned WeakMap keyed by each exact person-route visit, so nested visits remain
independent and expired routes can be collected. New choices receive remote
focus; detail Back restores the selected version and scroll. A fresh visit has
no previous chooser. The new browser regression fails before the fix and then
passes, including a nested same-person round trip. All **13/13 TMDB browser
workflows**, **101 TV unit tests**, affected lint and TV/spec/E2E types pass;
package, release-note and guidance gates are repeated before committing for the
next review. This is the sixth accepted finding across the three local rounds;
none are declined.


The fourth local review of `c90d8ba83` reproduces a pending search left busy
when foreground reconnect replaces the provider. The hook now settles that
request with retry, and navigation records the initiating filmography focus and
scroll even when a successful result follows the Retry control. A real browser
regression dispatches the network-return event during a held provider lookup,
checks the retry state, completes the retry and verifies exact card/scroll Back.
It fails before the fix and passes afterwards. **14/14 targeted TMDB workflows**,
**101 TV unit tests**, all nine affected lint targets and the three TV type
programs pass. This is the seventh accepted local-review finding; none are
declined. The final package and committed branch enter the fifth local round.

## Resumed review and series navigation — prototype 0.1.21

The fifth review of `d6412f4f9` finds that an exact-year filmography match can
open before later provider pages contribute other versions. The user explicitly
authorizes fixing this finding and starting another local review cycle. Search
now exhausts the relevant pages before selecting a title; an incomplete or
repeated page remains retryable. The split-page exact-year regression fails
before the fix and passes afterwards. No finding is declined.

The subsequent requested series work stores an additive exact parent snapshot
without episode lists or altered playback commands. Home and Continue watching
show the parent series name and cover. Details is available from the Home hero
and fullscreen episode player. Historical items can recover their exact parent
through a bounded, cancellable provider lookup. TMDB/provider episode stills are
stored separately from series covers; episodes with stills have larger cards
with descriptions, while missing artwork keeps compact cards.

The rooted-TV Luma integration from the user's adjacent setup is retained as an
explicit installation opt-in. Its narrow feed contains saved identities, public
TMDB images and display text, without portal credentials or playback commands.
Series selections open the saved parent; historical entries without a recovered
parent can still resume their episode. The packaged configuration is empty.

On 26 October 2026, root SSH replaces the deliberately removed Developer Mode
installation path. Prototype **0.1.20**, then **0.1.21**, are installed using the
native application installer. The 0.1.21 installer reports `state: installed`,
appinfo reports 0.1.21, and the relaunched Home shows **Ted Lasso s04**. The
runtime references `index-C6h2culx.js`; its SHA-256 equals the file extracted
from the installed IPK:

- IPK: `6b35e17a8048e8753dc4c8847a431a36042442c3836cc8f6d355399074e7da3e`.
- Runtime JS: `bcb051553d51e48bc3df01d485628678a695e0ad688e646fc8453f3bbc67faf3`.

Private before/after snapshots retain **3 sources, 20 history entries,
8 favorites and 20 positions**. The key, favorite identities/commands, history
identities/commands/times and position fingerprints match exactly. The only
changed source field is the active Stalker session token; library sync metadata
also refreshes normally. The personal Luma configuration is backed up and
restored byte-for-byte before launch. No secrets or private snapshots enter the
repository. This deployment confirms the current package and data preservation;
the earlier detailed native playback acceptance retains its original revision
scope, and the new controls remain available for the user's physical testing.

### Final local gates — prototype 0.1.22

A repeated fast detail/Back workflow exposes an older route-entry animation
frame resetting the restored filmography's scroll. Deferred focus now checks
that its destination is still current before changing focus or scroll. Initial
person navigation tests await the actual entry focus before scrolling, while
the fast Back assertions retain their immediate navigation and exact card/scroll
requirements. The three filmography round-trip workflows pass **30/30 repeated
executions** after this fix.

The final full TV run passes **122/122 browser scenarios**, including both
provider Home/parent/resume flows, historical parent recovery, fullscreen series
details, mixed rich/compact episode cards and cold/warm Luma selections. All
**110/110 TV unit tests**, nine affected lint targets, and the TV/spec/E2E type
programs pass. The unchanged shared TMDB **90/90** and Angular TMDB **101/101**
results remain applicable. Release notes validate **165 entries** and guidance
validation checks **3 files**; no threshold or baseline changes are made.

The 0.1.22 package passes the classic deferred IIFE, ES2018 and unsupported
builtin audits. Its SHA-256 is
`7229ed2015672e0b5b7726ab874d57fd34a6aeb464c67fcc8c5adcdf10e228b0`.
The current committed branch enters the resumed local Codex review; Greptile
remains unavailable under the documented missing-CLI exception. No Electron
IPC, database migration or native player implementation is changed. Browser
native-video workflows and the separately scoped LG observations above cover
the relevant playback paths. Publication and merge remain gated on review of
the committed PR revision.

### Coordinated device restore and resumed-review fixes — prototype 0.1.23

The user reports episode artwork/title returning on Home. Device inspection
confirms a different `index-C30JouBY.js` from the primary checkout has replaced
the earlier deployment, despite appinfo still reporting 0.1.21. With explicit
user permission, the adjacent Luma task agrees to stop deploying the TV client.
The verified 0.1.22 IPK is restored through root SSH. Installer status, appinfo
and packaged/runtime `index-Bu790X2H.js` provenance agree; runtime JS SHA-256 is
`21f0f66380ab25def6c28c2a12e63d5017298e1027c98107e03768a63e4fab10`.
Home again shows **Ted Lasso s04**, the lower cover matches its saved parent,
and a direct TMDB TV-details comparison confirms the background is the show's
backdrop, not the episode still. Before/after key, favorites, history and position
fingerprints match; only the Stalker session token changes. Personal Luma config
is preserved byte-for-byte. The adjacent task provides a separate artwork bridge
patch, merged here without replacing series context or navigation.

The resumed review of `eae1e934e` completes after one capacity-related attempt
produces no verdict. It finds three accepted issues: M3U IDs can embed stream
URLs in Luma cards, warm Luma detail launches can leave the old player fullscreen,
and localized/original-title or regular/VOD catalog lookups can choose a version
before later completed lookups contribute candidates. Random Luma handles are now
committed in an additive local mapping before publishing and survive relaunch;
unprepared items are never exported. Saved provider identities and commands stay
unchanged. Warm detail launches stop playback. Matching combines/deduplicates
completed lookup results before ranking. Regression tests fail before these fixes.

The artwork bridge adds static provider covers, exact-name M3U logo fallback,
year/season/episode metadata and a bounded best-effort library read. Artwork
rejects query/fragment/basic-auth URLs and known source credentials in its path.
All **113/113 TV unit tests**, **14 focused TV browser workflows**, and the three
Luma workflows, including credential-bearing M3U identity/cold-launch coverage,
pass. Nine affected lint targets, three TV type programs, **166 release notes**
and the guidance gate pass. No local review finding is declined.

The final 0.1.23 full run passes **123/123 TV browser scenarios**. Its audited
IPK SHA-256 is
`a119c0adca10102df6e1e226dc8773b95ff1e82de484d503992f014ce3a06637`.
Root installation reports installed/0.1.23; the running `index-C0xc9e41.js`
matches the packaged SHA-256
`6ddd862cd6ef8f14e1e688afb6fe83e04f4c6d2cd1417bb7abca411aa44becd6`.
The same Home title, parent cover and TMDB series-backdrop checks pass on this
version. All **8 published Luma cards have artwork and opaque handles**;
the two recent series retain their parent names and kind. The 3 sources,
20 history entries, 8 favorites, 20 positions and TMDB key retain their before/
after identity/command/progress fingerprints, with the expected Stalker session
token refresh. Personal config is unchanged. These deployment observations use
sanitized summaries; full private snapshots remain outside the checkout.

### Playback-origin and live-launch hardening — prototype 0.1.24

The next review of `f47a12f8e` finds two accepted regressions. Reopening an already
playing live channel through Luma stops its video before the existing same-channel
shortcut, leaving an empty player. The stop now applies only to movie/series
detail launches. A real-playing WebM mock output exercises decoded live video in
Chromium, while the separate native HLS selection coverage retains its scope.
The new same-channel browser regression fails with the old stop and passes
afterwards, checking fullscreen, a retained source and continued playback.

Fullscreen series-details Back also assumed every launch came from a resume
card, losing Home's hero control. A small playback-origin hook captures the
initiating control and main scroll before asynchronous stream resolution, and
restores that snapshot for player Back/Stop and series-details navigation.
Both Xtream and Stalker hero regressions fail before the fix and pass after it;
the resume-card round trip additionally asserts its original scroll position.
The owning hook stays within the 400-line lint cap without a baseline exception.

All three focused browser regressions, **113 TV unit tests**, nine affected lint
targets, TV/spec/E2E types, **166 release notes** and guidance validation pass.
No finding from either review is declined. The unchanged TMDB shared/Angular
results and version-scoped device observations above remain applicable.

The full 0.1.24 run passes **124/124 TV browser scenarios**. Its package and
archived JavaScript both pass ES2018/unsupported-builtin checks:

- IPK SHA-256: `20e013399dc7a1a7aa920dd607cdb4178fb2361cd8d19adc3c313bcf485b4fd7`.
- Archived `index-COpQfkKa.js` SHA-256: `a8d29a139605cf93367ed095119ad55e2dc6df678512b5ad43a78aa88b816917`.

The adjacent Luma task supplies a final native LG Home screenshot after 0.1.23
integration; visual inspection confirms all eight pictures, parent series covers/
names and the two channel logos. The local copy is retained at
`dist/tv-verification/luma-artwork-ship-tv.jpg`. Native Luma and its rollback now
leave the TV client package intact. The final committed fixes enter the next
local review round; the 0.1.23 hardware observations retain that revision scope.

### Final integration with master

Local Codex review of `623431b31` is clean, independently passing 304 unit tests,
22 focused TV scenarios, types and affected lint. While this work is in progress,
master advances to `e2699e920` through Portuguese regional-locale PR #1901,
including the shared TMDB language configuration. Merge `cb714b83d` integrates
that base without conflicts, preserving both regional language normalization and
the TV English-title fallback. Frozen installation is repeated, the installed
lockfile matches the repository, and Nx discovery succeeds.

On the integrated tree: **124/124 full TV browser scenarios, 113 TV unit tests,
94 shared TMDB tests and 101 Angular TMDB consumer tests** pass. Shared coverage
is 80.38% statements, 60.43% branches, 69.04% functions and 80.65% lines, with
unchanged thresholds. Nine affected lint targets, the three TV type programs,
**167 release notes** and guidance validation pass. The final 0.1.24 package and
its archived JavaScript pass the compatibility audits; these fingerprints
supersede the earlier pre-integration 0.1.24 local build:

- IPK: `c22369d5b946596683844328eb9daf6724315a8bdd7d2c2b01d21776378585ec`.
- Archived `index-B9V1GZ3G.js`: `44cbc11811c452edfa604bd373afb1d11759783b4d839b1a0cf212b53ff87c08`.

The integrated committed branch receives the final local review before its first
push. The exact reviewed/tested PR head and eventual merge are recorded in the
PR description; Greptile remains unavailable under the documented CLI exception.

### Integrated review: stable filmography rows and cancelled player lookup

The next committed-branch review identifies two additional P2 issues. Mixed
one/two-line character captions change the virtual grid's measured row height;
the regression observes 424px versus 441px cards before the fix. Filmography
subtitles now reserve two 22px lines. The extended fixture includes separate
blocks of short and long captions and checks identical heights across windows,
then exact focus/scroll restoration after a provider detail round trip.

A held historical parent lookup also survives fullscreen Back because the route
does not change when playback stops. Its regression fails on the still-disabled
Home Details button before the fix. A player-scoped controller now cancels the
lookup when fullscreen or playback identity changes. Completing the lookup retires
that scope before its own stop/persist/open sequence, preserving successful
navigation. The test releases both held responses and verifies that only the
background context repair persists, with Home retained and no player or error.

Both regressions and the Xtream/Stalker successful series-details round trips
pass (**4/4 scenarios**). TV unit tests (**113**), nine affected lint targets,
three TV type programs, **168 release notes** and guidance validation pass.
Shared TMDB/Angular sources are unchanged since the integrated 94/101-test run;
those results and coverage thresholds remain applicable.

The first full run exposes a pre-existing Stalker sort-test assumption: a single
scroll reaches page two but need not reach the newly extended list's page three.
The test now continues scrolling the appended end until it observes page three;
its required server sort, page number and reset assertions remain unchanged.
The full suite is restarted after this fixture correction.

Prototype **0.1.25** and its archived JavaScript pass the classic-bundle, ES2018
and unsupported-builtin audits:

- IPK: `7695ac638fd997536b1eba0530877bcc927c529d649c9be29eb39ef666a24725`.
- Archived `index-B_7mUoYM.js`: `3b15d93bf212cd1aa5714f2dab61f77cc25323b8ef6878e3bf9fe6d65c1040f9`.

The rooted LG currently times out and then reports no route on SSH port 22, so
0.1.25 is not yet installed. Device observations remain scoped to 0.1.24; its
native resume/details/Back flow, parent artwork, ten loaded episode images and
Luma artwork/opaque handles were confirmed before these final two fixes.

The corrected full run passes **125/125 TV browser scenarios** in six minutes.
E2E lint/types, release-note and guidance validation also pass after the fixture
and documentation changes. These committed fixes enter the fifth round of the
renewed local-review cycle; the exact reviewed SHA/verdict is recorded in the PR.
The maintainer explicitly accepts opening the first suitable provider version,
so that earlier requested behavior is not a publication blocker; the completed
version chooser remains available.
