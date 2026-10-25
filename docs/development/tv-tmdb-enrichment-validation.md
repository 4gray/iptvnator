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

## Device update status

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
Person pages, discovery, trailers and whole-catalog enrichment remain outside
the TV integration. Movie directors and series creators remain distinct roles.
