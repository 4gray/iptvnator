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
directory migration. A subsequent upstream update through `fee8411f7` (Stalker
lazy episode file resolution, #1996) is integrated by `8fe0236cc`. Frozen
dependencies were reinstalled after both merges.

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

Node 22.23.2 / pnpm 10.33.0. TV unit tests: 73 passed, including storage-read
protection, bounded target repair and progress-save retry after player teardown.
The read-protection regression failed against the old repository implementation.
Web backend: 237 tests passed. Related provider/shared/EPG unit suites and web and
Electron TypeScript checks pass.

The complete TV browser suite passes 88 scenarios across M3U, Xtream and Stalker,
including six recovery/onboarding scenarios, ten review regressions and the
upstream episode/file-ID case. These run against the real local
backend and mock providers, with synthetic media in modern Chromium. They do not
certify webOS decoding or physical remote behavior.
The separately invoked phone-setup split target passes all eight scenarios,
building both clients first. All 125 inferred Playwright task graphs pass in
local and CI configuration; no GitHub CI was dispatched.

The full Tier A coverage run passes all 36 projects. Merged coverage is 84.90%
statements, 75.89% branches, 83.21% functions and 85.26% lines after rerunning
the affected shared/Angular EPG and Stalker coverage. Shared EPG implementation moved out
of the coverage-excluded barrel into `timeline.ts`; its five geometry tests now
measure 100% statements, branches, functions and lines. Existing Angular EPG
tests also pass. Final coverage health has five same-name-spec warnings for
Stalker barrels, models, the helper and test harness, not failures. The helper
is exercised through the existing resolver tests. TV uses its separately executed
Node test target and browser suite rather than claiming Tier A Jest coverage.

Affected Nx lint/typechecks, production TV and backend builds, ES2018/classic
bundle verification and IPK packaging pass. Dependency policy, release notes,
agent/skill guidance, stylesheet inputs and E2E task graphs pass. After the latest
master integration, Stalker data-access and feature coverage suites pass 630 and
501 tests respectively. Four real Electron regression scenarios for lazy-series
file resolution pass with isolated mock ports and temporary profiles; the Nx
target rebuilds the Electron main process and Angular renderer first.

## Hardware and publication boundary

The paired LG is reachable. The initial read-only debugger inspection found
IPTVnator in the background with no active media, on the 0.1.11 bundle.
Following the user's explicit installation request on 2026-10-25, the package
below was installed and launched on `iptvnator-lg-bx` (192.168.178.44).
The device's installed-app metadata confirms version 0.1.12. Installation and
launch succeeded; playback acceptance remains with the user and is not implied
by these deployment checks.

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

IPK SHA-256: `431e18f2b784ac568041715a11a5960fb3344ddedea1b1f2f211489543ddde7c`.
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

Round 4 reviewed `80c7a52b7` and found a P1 blank fullscreen after failed retry,
plus a P2 stale detail/playback identity after automatic source replacement.
Both were accepted and reproduced before fixes. The player surface stays visible,
source navigation is reset, and requests are guarded by source ownership and
connection readiness. New browser checks exercise a second retry after a failed
one and two sources with overlapping provider IDs, including Back and saved
playback identity. The independent shared EPG coverage correction described
above is behavior preserving and uses the same public entry point.

Round 5 reviewed `7e2baed06` and found two P2 cases: remote Stop returned Live
to preview without ending playback, and a delayed catalog append stole focus
after the user moved to search. Both regressions fail before the fixes. Stop now
tears down playback and restores focus; deferred row navigation is cancelled
when focus moves away from its origin. The existing positive test for remote
navigation across a loaded boundary also passes. After extracting the event
binding hook, all 35 matching remote/fullscreen/Back/resume browser cases pass. Remote event binding is extracted
into a small hook to keep production files within the repository line limit.

All twelve findings across the five Codex rounds were accepted and fixed.
The repository's local review policy stops after five rounds. These final two
fixes have automated regression coverage but have not received a sixth independent
review; the branch does not claim a clean final-review verdict. Greptile remains
unavailable. No push or PR was attempted.

After the fifth review, upstream master advanced. Integrating it exposed the
same episode/file-ID confusion in TV: the new upstream mock reproduced show A
playing show B's file. Its regression failed before the TV fix. The upstream
selection algorithm now lives in a framework-free helper shared by the Angular
resolver and TV, preserving authentication/cancellation and custom-protocol file
identity. Older saved TV episodes refresh their exact parent-scoped coordinates
without changing persisted identity/progress. Two TV unit cases cover new and
legacy entries; the upstream Angular resolver tests exercise the same helper.
This integration and correction are also outside the five-round review cap.


## Publication follow-up

On 2026-10-25 the maintainer authorized publishing this experimental TV branch
and merging through a pull request, and waived another full local review round.
The five prior Codex rounds and their twelve fixed findings above remain the
review evidence; there is no claim of a clean final independent-review verdict.
Greptile is still unavailable. The separate settings-category worktree is not
included in this pull request.

Runtime revision `27c36b1dc` merges upstream `703a7e1a9` into the TV branch without
conflicts. Frozen dependencies were reinstalled, lockfiles match, and Nx
project discovery passes. The first publication edits only change documentation
and the browser regression's synchronization; runtime source stays at that
validated revision. The repository is public and its default branch is `master`;
automatic PR/master CI triggers were inspected before publication.

The old Angular Stalker watched-menu failure was reproduced three times with
exactly one closing CDK backdrop still in the DOM after its menu row disappeared.
The detail shell deliberately ignores Escape while a backdrop exists. The test
now awaits that backdrop's removal before sending the second Escape; its detail
count, URL and original-card assertions are unchanged. Three focused repetitions
then pass. This is a test synchronization correction, with no runtime behavior
change or lowered gate.

Final local gates:

- Tier A coverage passes all 36 projects and existing thresholds: statements
  84.91%, branches 75.91%, functions 83.21%, lines 85.27%. Coverage health has
  three nonfatal same-name-spec warnings for the upstream components barrel,
  removed view-in-portal component and handoff token.
- All 59 affected lint targets pass, plus lint after the E2E correction.
  Web/Electron runtime typing, TV/phone/test typing, and all 41 spec programs
  pass.
- All 79 TV unit cases pass. All 90 TV browser cases pass; the final Nx invocation
  reuses the successful same-input result from the preceding watchdog validation.
- All 74 Chromium Stalker/Xtream/provider-EPG scenarios pass on `6e305d654`,
  including the formerly failing watched-menu flow in its full serial suite.
- Four Electron Stalker lazy-series regressions pass after fresh Electron/Angular
  builds, including old favorites/recent entries after restart.
- Production TV/backend builds, classic ES2018 verification and IPK packaging
  pass. Dependency alignment, all 128 E2E task graphs, stylesheet inputs/font
  weights, release notes and agent/skill validation pass.

An initial targeted browser invocation accidentally selected all three configured
browsers: Chromium's two watched-menu cases passed, while four Firefox/WebKit
launches could not run because those browser binaries are not installed. They
are not counted as application failures or passing coverage; the final browser
scope is explicitly Chromium, matching the repository's documented local gate.

Real LG evidence is in [the Live investigation](tv-live-playback-investigation.md).
Installed 0.1.14 plays First Channel, First Channel HD and Setanta; the final
observed First Channel run reached 96.406 seconds with readyState 4/no alert.
The first First Channel start immediately after installation still failed before
Retry; that residual is retained. XMLTV/archive support, viewing-data sync and
general provider/codec certification are outside this experimental merge.
The NAS and the primary checkout remain unchanged. Existing `.changes/tv-*.md`
notes cover runtime behavior; publication docs/test-only edits need no new note.


### Automatic PR review follow-up

The first published head was `4d97adfd2`. Its automatic Codex review completed
without findings. Greptile identified two additional cases, both accepted:
server-row account replacement reused old media identity, and a manual source
rename trimmed exact MAG serial/device/signature bytes. CodeQL also reported
three unthrottled public setup-file handlers. No finding was dismissed or
suppressed; another local CLI review round remains waived by the maintainer.

The setup HTML/CSS/JS handlers now share an express-rate-limit 8.3.0 middleware,
pinned explicitly beside Express. It admits 60 requests per minute per direct
network peer, groups IPv6 subnets, ignores spoofed forwarding headers, returns
429/Retry-After and leaves discovery/pairing polling available. The HTTP
regression fails before the middleware and passes after it. All 238 backend
tests pass, including actual file serving and capability polling after saturation.
The affected backend coverage suite was rerun and merged with the other 35
reports: statements 84.92%, branches 75.92%, functions 83.22%, lines 85.27%;
coverage health passes with existing thresholds.

Server account changes now receive fresh opaque TV media IDs. Old viewing data
is retained separately and a linked local original is restored; ordinary renames,
password rotation and stored-file M3U refreshes retain identity. Four new account
cases fail against the previous merge implementation; six unit cases now cover
Xtream/Stalker/provider changes, stable refresh and original-source recovery.
The browser regression checks stale-detail dismissal, old favorites/history,
new-account playback and identity across reload. The MAG rename regression
first reproduces trimming of all five fields, then passes after preserving the
raw form strings, including after reload and explicit MAC editing.

These corrections are covered by `.changes/tv-phone-setup-request-limit.md` and
`.changes/tv-source-account-identity.md`, with the canonical contracts updated.


Final post-review validation passes 85 TV unit cases and all 91 TV browser cases,
including account replacement and exact MAG preservation. The new MAG test uses
its own mock MAC namespace: otherwise its intentionally pinned device identity
contaminated later tests sharing the minimal account. The full isolated suite
now passes without resetting or weakening provider authentication.

The initial CI Tier B/C gate also exposed two stale assertions missed by the
Tier A run: the extracted Xtream API no longer belongs in the max-lines baseline,
and per-file TV E2E builds need both TV and phone assets. The baseline generator
removes exactly that one exemption (54 remain); the test now asserts both build
dependencies. No file-size/coverage/test threshold is raised. The full CI
`check-coverage-policy.mjs --run-non-tier-a` command now passes locally, including
both mock servers, lint tooling, packaging, release tooling and skills. Targeted
runtime/spec typing, lint, backend coverage and production TV/backend/IPK builds
also pass. These changes are sent together as one PR follow-up batch.
