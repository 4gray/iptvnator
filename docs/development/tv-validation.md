# TV MVP implementation verification — 2026-10-21

Branch: `feat/tv-webos-prototype`, based on
`ac1254185a6d015dfd68a2abe2485217e50f75ec`. Work is confined to the prepared TV
worktree. The final local commit and IPK SHA-256 are recorded in the generated
`dist/tv-verification/validation.json`; that file identifies the tested package,
rather than a moving remote branch. Nothing is pushed, published or merged.

## Delivered scope

The separate Preact/Vite TV app connects actual M3U, Xtream and Stalker sources
through the existing backend, with user-entered credentials. It includes home
compositions, live preview/fullscreen and provider guides, paged catalogs/search,
movie details, regular/embedded/lazy series and episodes, favorites, confirmed
history/positions/resume, source management and local settings. One native
video element owns playback. Source/type/parent-aware identities, cancellation,
focus restoration and bounded rendered pages are covered by automated checks.
Framework-free provider entrypoints share existing authentication, normalization,
series adapters and complete stream-pair resolution with the Angular runtime.

## Local results

All checks use Node 22.23.2 and pnpm 10.33.0. The installed frozen lockfile matches
the repository lockfile. These are local runs, including targets named `ci`.
No GitHub Actions or paid runner is requested. TV projects are classified in
Tier B: the suite uses Node contract tests and Playwright, while the existing
Tier A percentage collector uses Jest. No existing project tier or coverage
threshold changes; TV source percentage coverage is not claimed.

| Check | Result |
| --- | --- |
| `tv:test` | 16 unit tests pass |
| `tv-e2e:e2e` against production build, backend and provider mocks | 16 browser tests pass |
| TV, TV-tests and TV-E2E type checks | Pass |
| TV/provider/mock/tool affected lint targets | Pass |
| Existing Xtream data-access unit suite | 464 pass |
| Existing Stalker data-access unit suite | 592 pass |
| Stalker and Xtream mock unit suites | Pass; Xtream includes 99 checks |
| Existing Angular Xtream Chromium E2E | 38 pass against isolated dev server |
| Existing Angular Stalker Chromium E2E | 32 distinct scenarios pass; one failure remains, detailed below |
| Existing web/Electron entrypoint type checks | Pass |
| Production build, ES2018/classic-script audit, IPK creation and package inspection | Pass |
| Dependency synchronization, release notes, guidance/skills, stylesheet inputs, font weights, focus-ring and local/CI task-graph validators | Pass |

The TV browser suite covers source entry, all providers, all three Stalker
series modes (including actual paged mock seasons/files), guide failure,
preview/Back, native VOD seek and resume, IndexedDB reload and quota failure,
large catalogs, latest search, delayed stream cancellation including Back,
pointer/numeric arrows, remote form exit and MAG disclosure focus, classic
`file://` boot and 1920/1280/1024 widths. The form regression fails before the
focus fix and passes afterwards.
Direct catalog and media HEAD diagnostics are exercised separately. Screenshots
are generated under `dist/tv-verification/` using fictional provider artwork.

Media in browser tests is substituted with a local clear WebM clip. Browser
playback/seek/history results do not establish HLS, MPEG-TS, audio, DRM, header
or Chromium 68 compatibility on LG hardware. No real subscription or physical
TV is used. No Electron IPC, player integration or packaging code changes;
Electron-specific E2E is not run. Shared renderer extraction has unit, typing
and existing Angular browser coverage.

An initial Angular Xtream run using static PWA configuration produced 20 failures
because those scenarios intercept the development `localhost:3000` backend.
The subsequent complete run against the intended isolated development server
passes 38/38; the invalid configuration is not counted as passing evidence.

## Remaining Angular Stalker failure

`apps/web-e2e/src/stalker.e2e.ts:882`, “series watched toggle — embedded series
marks and clears from the header menu”, reproducibly fails at line 932:
after Escape the test expects zero `app-portal-detail-shell` elements and finds
one. The full serial suite passes 24 before this failure and skips the final
eight; those eight pass when run separately. The failing case also fails in
isolation. The test and its expectations are unchanged. A baseline run on the
unmodified source revision has not been performed, so this report does not
claim it is a pre-existing failure. This remains an unresolved validation result.

Publication follow-up: the closing CDK backdrop was still present after the menu
row disappeared, so it correctly owned the next Escape. The test now waits for
backdrop removal before asserting detail dismissal. See
[the final validation](tv-stabilization-validation.md#publication-follow-up).

## Hardware gate

No TV is paired in webOS CLI. Read-only probes of `192.168.178.44` ports 9922,
9998, 3000 and 3001 time out. Installation/cold launch, actual arrows/OK/Back and
Magic Remote, real provider catalogs and media, HLS/TS/VOD/episode audio and
seek, gated media headers, and persistence after an actual TV relaunch remain
unverified. Nothing roots, wakes or changes settings on the TV.

Use the [device checklist](tv-development.md#hardware-status-on-2026-10-21)
when Developer Mode/device access is available. API proxying does not relay
video; providers requiring MAG/Cookie/Authorization/User-Agent/Referer on media
may need a separate media relay. Transcoding and all other approved exclusions
remain outside this prototype. Product implementation and hardware readiness
are separate claims.
