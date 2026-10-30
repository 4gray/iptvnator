# TV TMDB and series navigation — validation

Product scope: optional TMDB metadata, people/filmographies, series presentation,
episode cards and navigation in the framework-free TV application. Work is on
`codex/tv-tmdb-enrichment`; the final tested/reviewed SHA is recorded in
[PR #2009](https://github.com/4gray/iptvnator/pull/2009).

The [TV contract](../architecture/tv-application.md#artwork-and-optional-tmdb-metadata)
and [TMDB contract](../architecture/tmdb-metadata-enrichment.md) remain canonical.
Sensitive device snapshots and older validation records are retained outside the
product checkout. Credentials, provider/media URLs and authentication headers
are excluded from this report.

## Verified behavior and data boundaries

- Metadata requires a saved opt-in and key. Checking a valid key does not enable
  metadata or save an unfinished settings edit. Language-scoped clients support
  localized metadata and an English search fallback without relaxing title/year
  corroboration. Disabled metadata leaves provider browsing and playback usable.
- Round actor/director/creator controls open complete TV filmographies. Angular
  consumers retain their existing bounded defaults and cache/language behavior.
  Selecting a credit searches the active source, preserves provider identities
  and commands, and separates unavailable titles from incomplete/retryable searches.
- Matching completes relevant pages, display/original-title queries and both
  regular/embedded Stalker catalogs before choosing versions. Repeated IDs are
  deduplicated; a failed alternate catalog cannot suppress a complete valid match.
  Twenty-page and fifteen-second limits retain Retry instead of false absence.
- Numeric titles remain titles. Explicit release years, remakes, marked later
  seasons, punctuation and diacritics have dedicated regression coverage.
- Home and Continue watching use parent series identity, title and cover while
  resuming the actual saved episode. Historical repair requires the exact source
  and parent ID; it does not synthesize a parent from title similarity.
- Parent snapshots keep validated series artwork, overview and year through sparse
  catalog refreshes. Episode-specific descriptions remain separate.
  Current parent artwork wins, then the saved parent artwork. Old episode images
  are not cover/backdrop fallbacks when a parent is known. Episode cards use
  `episodeStill`, separate from series artwork, and retain compact text fallback.
- Home Details and fullscreen Series details open the parent episode list. Back
  restores the initiating control/scroll. A selected season survives a person-page
  visit; opening a fresh detail visit starts at its first available season.
- Playback coordinates, raw commands, seconds and existing persisted data remain
  authoritative. Context repair is additive and idempotent. Unknown saved fields
  remain preserved through hydration and subsequent writes.

## Regression evidence

| Scenario | Reproduction and expected result |
| --- | --- |
| Localized provider title | English fallback finds a corroborated result after a localized miss. |
| Filmography versions | Matches on later pages/languages/catalogs join the same ranking and chooser. |
| Alternate-name remake year | Real Stalker normalization prefers the exact original name; a conflicting year in another matching name still rejects the wrong remake. Explicit year fields cannot mask that conflict. Numeric canonical titles and provider commands stay intact. The regression fails before the fix and passes afterwards. |
| Incomplete search | Failure, repeated pages or deadline show Retry, never false absence. |
| Stale detail response | Back/source replacement cancels browsing before an old response can consume restored focus. |
| Virtual filmography rows | Mixed short/long character captions previously measured 424px/441px; two reserved subtitle lines keep row height and scroll stable. |
| Person navigation | The selected season and originating person-card focus survive a detail round trip. |
| Slow fullscreen details | Back cancels a held parent lookup; late responses cannot navigate away from Home. |
| Slow Home details | A newer playback request cancels the old details action without cancelling its own successful stop/persist/open flow. |
| Retained Retry | A valid same-source retry restores its original control; an old retained click cannot reopen the previous source. |
| Delayed episode stills | With 200 episodes and a held TMDB season response, focus and viewport offset remain on episode 73 or 181 when compact rows grow. Enter plays that same episode; DOM remains bounded to 30 cards. Both cases lose focus before the fix and pass afterwards. |
| Sparse series metadata | Detail-only cover/backdrop/overview survive Home and relaunch; deliberately injected legacy episode images stay unused, and newer parent art takes priority. Unit checks retain the series year without replacing episode descriptions. |
| Browser Home Back | With catalog responses held, a no-op platform Back keeps requests alive and loading completes after release. |

The navigation, artwork, season and virtual-row fixes have fail-before/pass-after
browser coverage. Artwork repair also checks idempotence and rejects a foreign
source snapshot. Avatar assertions retry across metadata replacement and require
a connected, positive-sized square; both provider flows passed five repetitions
each after replacing a detached-element geometry snapshot.

## Local verification

Use Node 22.23.2 and pnpm 10.33.0. The TV worktree has its own frozen installation;
its installed lockfile matches the repository and Nx project discovery succeeds.
Master `00c8284ac` (Vite 8.1.6) is integrated in this branch. The production
Angular build and initial-byte guard passed: 1,200,005 bytes against the existing
1,200,301-byte limit. TV checks cover the final source scope; no threshold,
probe or performance baseline was changed.

The unchanged shared TMDB implementation passed **94 tests** with coverage:
80.38% statements, 60.43% branches, 69.04% functions and 80.65% lines. The affected
Angular TMDB consumers passed **101 tests**. Thresholds are unchanged.

Final results: **110 TV unit tests**, **128 TV E2E scenarios**, lint for all
nine affected projects and typechecks for all three TV projects passed. All
**167 release notes**, three agent guidance files and eight repository skills
validate. The sparse-overview browser assertion failed before the fix with the
Home placeholder instead of the saved series description, then passed after
preserving the validated parent fields. The full suite was repeated afterwards.

Relevant commands:

```sh
pnpm nx test tv-tests
pnpm nx test shared-tmdb --runInBand --coverage
pnpm nx test services --runInBand --testPathPatterns=libs/services/src/lib/tmdb/
pnpm nx run-many -t lint -p tv,tv-feature,tv-ui,tv-data-access,tv-util,tv-tests,tv-e2e,shared-tmdb,services --parallel=3
pnpm nx run-many -t typecheck -p tv,tv-tests,tv-e2e --parallel=3
TV_E2E_PORT_OFFSET=700 pnpm nx e2e tv-e2e
pnpm nx package tv
pnpm run release:notes:validate
pnpm run agents:validate
pnpm run skills:validate
```

A prior offset-900 run collided with an unrelated IPv6 listener on localhost:4321
and received HTTP 403 for mock artwork. That process was left untouched; the
established offset-700 ports isolate the complete TV suite.

No Electron IPC, SQLite schema, native player implementation or Electron
packaging changes belong to this feature. TV browser/native-video checks and
shared/Angular consumer tests cover the affected runtime boundaries.

## LG hardware evidence — prototype 0.1.24

Target: LG OLED55BX9LB, webOS 5.6.2 / Chromium 68. These observations are scoped
to the previously installed 0.1.24 application, not the latest local package.

- Initial device inspection found a saved key and Russian language with metadata
  disabled. Saving the explicit opt-in enabled real API requests with HTTP 200.
- Край чудес corroborated TMDB movie 1628675; Ted Lasso s04 corroborated TV 97546
  and season 4. The Chestnut Man required an English search fallback.
- Home showed the parent series title, poster and show backdrop rather than an
  episode title/still. Continue watching resumed the saved episode around 1210s.
- Fullscreen Series details stopped playback and opened ten parent episodes.
  All ten available episode images loaded in 480px cards; Back restored the
  hero Continue watching control. The application was left on Home, paused.
- Before/after installation retained 3 sources, 20 history entries, 8 favorites
  and 20 positions. Key, saved media identities/commands, favorites and progress
  matched during installation. Native playback tests then advanced the tested
  position normally; a Stalker session token also rotated normally.
- Archived/runtime `index-B9V1GZ3G.js` SHA-256:
  `44cbc11811c452edfa604bd373afb1d11759783b4d839b1a0cf212b53ff87c08`.

The latest package has not received a new physical-device run: the last root SSH
connection attempts timed out. No television, native service or home configuration
is changed as part of the current source-scope cleanup.

## Packaging and review

Prototype 0.1.25 ships one classic deferred IIFE targeting Chrome 68 / ES2018.
Both the build and the JavaScript extracted from the IPK are parsed and scanned
for unsupported builtins; the package can minify differently from the raw build.
Final package SHA-256: `362755396dd14e1c3203729c9d30fc5aeefee074aa307948ba2449e891838ef7`.
The archived `index-ALf9djH-.js` is 270,970 bytes; SHA-256:
`710a47d49b009580cf0bd84ca9ab25bc9b5a2942f6a621254f5eb18ed3b7241b`.

Local Codex review of published head `75b94f071` found no actionable regressions.
GitHub then reported three P2 follow-ups: no-op Home Back cancelling loading,
a saved series cover lost to an incomplete catalog row, and a stale install
filename. The first two reproduce before their fixes; the install example now
matches the package/inspection version. The fixes and source-scope cleanup are collected into one update; it passes the
same local review gate before the next push. The final reviewed head is recorded
in the PR. The subsequent local round also found a delayed episode-layout
transition that could move focus from episode 73 to 37; the new anchor regression
covers both the middle and end of a long season, including actual playback. Greptile CLI is unavailable under the documented
[local-review exception](agent-workflow.md#local-review-before-a-pull-request);
its GitHub review supplied the cover/documentation findings.

Master `bc4d24e14` (Angular UI/search PR #2008) and `00c8284ac` (Vite 8.1.6)
are integrated. Dependencies were installed from the new frozen lockfile before
Nx discovery and validation; no unrelated master change is overwritten.

The second GitHub review round confirmed Codex clean on `0828273e0`; Greptile
found one P1 alternate-name remake-year conflict. The regression uses the real
Stalker adapter with fresh provider instances so cached catalog pages cannot
hide changes to fixture rows. Matching now checks every supplied corroborating
year rather than discarding suffix years after an exact name match.
