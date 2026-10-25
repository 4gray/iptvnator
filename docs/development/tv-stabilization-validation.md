# TV stabilization validation

Date: 2026-10-25. Package: 0.1.12. Branch: `feat/tv-webos-prototype`.

This follow-up addresses the merge-readiness audit. It is an experimental LG TV
client, with selected real-device flows verified in the earlier reports. It is
not a claim of general webOS/provider/codec compatibility.

## Integration and fixes

`origin/master` at `fa8ea00273f27a932de90804f0615775eefea116` is integrated into
the TV branch by merge commit `2b30f406e`. The primary checkout and master branch
are unchanged. The integration preserves upstream Stalker request options, TV
framework-free provider contracts, module boundaries and the canonical skills
directory migration. Frozen dependencies were reinstalled after the merge.

- Failed startup reads block every repository write and show a retry screen.
  Retrying reads the original data; default empty state cannot replace it.
- Failed idle connections retry after 2, 5, 10 and 30 seconds, then stop.
  Manual retry and foreground/network return renew the budget. Existing playback
  sessions are not recreated or automatically resumed on network return.
- Provider requests have a 35-second deadline. An explicitly missing backend
  target is registered again once; upstream 404/authentication failures do not
  trigger that repair. Append-page errors retain the loaded catalog.
- Recovery buttons retry the failed save, selection or playback operation.
  A progress save can be retried after leaving the player; a newer saved position
  wins over the old retry. Stale playback notices clear when leaving the session.
- Native player callbacks use current playback state. Closing the grid or opening
  its category list cancels a pending channel resolution before it can replace
  the player. Split TV browser targets build both TV and phone assets.
- The configured home server is probed for source-library support. Sharing
  sources remains explicit; favorites/history/progress remain local to the TV.
- Backend split-test expectations and the shared EPG coverage classification
  match the actual Nx targets. No existing threshold or test was weakened.

## Local checks

Node 22.23.2 / pnpm 10.33.0. TV unit tests: 71 passed, including storage-read
protection, bounded target repair and progress-save retry after player teardown.
The read-protection regression failed against the old repository implementation.
Web backend: 237 tests passed. Related provider/shared/EPG unit suites and web and
Electron TypeScript checks pass.

The complete TV browser suite passes 83 scenarios across M3U, Xtream and Stalker,
including six recovery/onboarding scenarios and six review regressions. These run against the real local
backend and mock providers, with synthetic media in modern Chromium. They do not
certify webOS decoding or physical remote behavior.
The separately invoked phone-setup split target passes all eight scenarios,
building both clients first. All 125 inferred Playwright task graphs pass in
local and CI configuration; no GitHub CI was dispatched.

The full Tier A coverage run passes all 36 projects. Merged coverage is 84.89%
statements, 75.85% branches, 83.20% functions and 85.25% lines. Coverage health
reports 23 same-name-spec warnings, not failures. TV uses its separately executed
Node test target and browser suite rather than claiming Tier A Jest coverage.

Affected Nx lint/typechecks, production TV and backend builds, ES2018/classic
bundle verification and IPK packaging pass. Dependency policy, release notes,
agent/skill guidance, stylesheet inputs and E2E task graphs pass. Electron E2E
was not run: this follow-up changes TV behavior and retains the already-tested
framework-free extraction; no new Electron IPC or player behavior is introduced.

## Hardware and publication boundary

The paired LG is reachable. A read-only debugger inspection found IPTVnator in
the background with no active media, still on the 0.1.11 bundle. This follow-up
does not foreground or install over the user's current screen without their
answer to the pending device-check question. The 0.1.12 package is built locally.

The earlier native error 4 remains unresolved. Next hardware work is to diagnose
provider media access independently of catalog/EPG, then repeat real-channel
switching, VOD/episode resume, network recovery and long playback. The earlier
successful LG flows remain documented in their dated reports; browser checks
do not close this hardware gate. XMLTV/archive playback on TV and cross-device
favorites/progress remain separate follow-ups.

No push, PR publication, merge into master, paid CI or NAS service change is part
of this validation. Local evidence is held outside tracked source under
`/tmp/iptvnator-tv-*.log`; the build artifact is
`dist/tv-package/com.iptvnator.tv.prototype_0.1.12_all.ipk`.

IPK SHA-256: `dd2d2d72e98eebbfb4e0195494d0e28bc2096f2ea915b8d64b7b8a96ca344bde`.
The local Greptile CLI is unavailable; no installation or account setup was
attempted. Codex round 1 reviewed `aa8e09b7e` against master and reported three
P2 findings: stale native error callbacks, abandoned guide playback resolution
and missing phone assets in split E2E targets. All three were accepted and fixed;
the added regressions cover native retry, both guide exit paths and the Nx graph.
The native retry regression fails before its fix. Subsequent review results and
the final tested commit are recorded in the implementation thread's completion
report rather than implying that the first review was clean.

Round 2 reviewed `32bd8c206` and reported three further P2 findings: source edits
rewrote unchanged MAC bytes, empty Stalker original titles hid the supplied name,
and retained guide selections showed details outside the visible time window.
All were accepted and fixed. Their regression tests fail before each fix; the
MAC flow uses a disconnected server-library source and also checks intentional
MAC changes. Guide coverage checks both leaving and returning to the original
day. The title contract is exercised for Live, movies and series.

Round 3 reviewed `751dcaf13` and found two P2 cases: library-driven source
replacement retained the previous Live category, and nonempty but unusable bulk
EPG suppressed the short guide. Both were accepted and reproduced before fixes.
Coverage now includes a live library deletion flow and invalid/past/future bulk
guides, merge priority and short-guide failure. Existing EPG cache tests keep
their lifecycle assertions and use an explicit clock for current coverage.
