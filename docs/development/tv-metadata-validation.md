# TV backdrop and TMDB verification — 2026-10-22

This follow-up extends the approved MVP with user-requested TMDB support.
Work stays on `feat/tv-webos-prototype` in the isolated TV worktree. The exact
tested local revision, package size and SHA-256 are recorded in generated
`dist/tv-verification/metadata-validation.json`. No push, PR, merge, remote CI
or TV configuration operation is performed.

## Delivered behavior

Home and detail artwork starts at the top of the content viewport, behind the
header, and fades into the page. Both Кинозал and Витрина retain their layout
widths. Screenshots of the production app using fictional provider artwork
are saved as `cinema-home.png`, `cinema-detail.png` and `showcase-home.png` under
`dist/tv-verification`; all three were visually inspected. The change uses
paint-only gradients without blur, filters or animation.

Settings has an optional TMDB v3 key/v4 read token, language, connection check,
explicit save result and attribution. Artwork and descriptions enrich Home's
featured title and selected movie/series details. All providers use the same
title/year matching core; this does not enrich the entire catalog or episodes.
Provider identities and playback commands remain unchanged. Metadata errors,
missing images and stale requests leave provider navigation/playback usable.

The API, resolver, metadata orchestration and pure helpers now belong to
`shared-tmdb`. Angular retains compatible injectable wrappers and its existing
cache. The four moved pure test files are unchanged. TV uses a bounded session
cache; settings persist in its existing atomic IndexedDB snapshot.

## Local checks

Node 22.23.2 and pnpm 10.33.0 are used throughout. Dependencies and the lockfile
are unchanged. No existing coverage tier or threshold is weakened; the new
shared TMDB project is Tier A. A whole-workspace merged coverage gate was not
run for this local follow-up, and no merge is requested.

| Check | Result |
| --- | --- |
| `nx test tv` | 20 pass |
| `nx e2e tv-e2e` | 19 pass against production TV, backend and provider mocks |
| `nx test shared-tmdb --runInBand --coverage` | 76 pass; statements 75.45%, branches 53.18%, functions 61.60%, lines 75.66% |
| `nx test services --runInBand --testPathPatterns=tmdb` | 101 pass |
| TV, TV-tests, TV-E2E, web and Electron entrypoint types | Pass |
| Angular development build after shared-core extraction | Pass |
| Affected lint | 9 projects pass |
| TV production build and classic-script/ES2018/builtin audit | Pass; 121,123-byte bundle |
| IPK creation and inspection | Pass; prototype version 0.1.1 |
| TMDB default-key injection | Disposable fake-key fixture passes; source default remains empty |
| Dependency sync, release notes, guidance and skills | Pass |
| Font weights, stylesheet inputs and focus-ring validators | Pass |
| Coverage tooling and policy | 75 tooling tests pass; project classification passes |
| Playwright task graphs | 110 local and 110 CI-mode graphs pass locally |

New browser scenarios cover opt-in/no requests when disabled, v3/v4 key checks,
language, artwork/description replacement, unchanged provider playback URLs,
saved settings after reload, invalid keys, late response ownership and broken
artwork. Existing all-provider navigation, native video, persistence, focus,
bounded catalogs and file-protocol tests remain included. TMDB API responses
and images use synthetic fixtures; no real key or subscription is used.

Initial Angular type checking found missing type-only re-exports and one type
import after extraction; these were fixed and the checks rerun successfully.
The font validator initially enumerated unstaged old paths for moved tests;
after staging the moves it passes without validator changes.

## Separate remaining checks

These browser tests run in modern Playwright Chromium, with local clear WebM.
They do not certify Chromium 68, LG image decoding/memory, TLS access to TMDB,
native HLS/TS/audio, remote keyboard or cold relaunch on the real TV. The user
cannot test the LG yet; no new device probe or installation is attempted.
Use the [device checklist](tv-development.md#hardware-status-on-2026-10-21),
including TMDB key entry, language, images and provider fallback on the device.

No Electron IPC/native packaging/player code changes, so Electron-specific E2E
is not rerun. Existing Angular provider E2E and full provider unit suites are
not rerun for this metadata/UI follow-up; their earlier evidence remains in
the [MVP report](tv-validation.md), including its unresolved Stalker Escape
failure. That failure is not claimed fixed or baseline-verified here.

Architecture, development/setup, Nx boundaries and the context map are updated.
User-facing note: `.changes/tv-backdrop-tmdb.md`.
