# Optional self-hosted favorites synchronization

Date: 2026-11-02. Implementation authorized by the handoff.
Base at start: origin/master, 2f788b80d980215b08e495662bbebde1d600f823 (#2062).
Rebased before final review onto cf9b66c7171d6771a971f0460ee4443ff2888cb2.
Branch: codex/favorites-sync, isolated managed worktree. Main checkout is untouched.

## Reconciled scope

Stages 1–2 of the 2026-10-29 activity plan are delivered by #2062. Their
historical implementation statuses do not describe current master. This stage
implements favorites only; Recently Viewed, shared ordering, accounts, cross-provider
matching and server XMLTV remain future work. Issues #2059/#1616 are broader
and must not be closed automatically.

- Separate device/profile consent, initially off. Sources/progress consent does
  not authorize favorite reads or uploads. Standalone remains local.
- First enable downloads server state while retaining original local favorites.
  Existing rows upload only through explicit preview/import or a new action.
  Missing local rows never imply removal.
- Disable retains local projection and server state; pending intents remain
  parked. Re-enable requires an explicit send/keep-local choice for old intents.
- Per-item conditional membership, durable negative states, revisions and
  idempotency receipts. Independent items merge; stale changes to the same item
  require explicit local/server choice. A duplicate old add cannot undo removal.
- Shared source context uses the persisted incarnation lifecycle from activity,
  extended to M3U, with independent favorites capability/reducer.
- M3U v1 references hash the exact URL (SHA-256), retaining URL membership and
  resolving legacy IDs through local channels. No title/tvg-id inference.
  URL changes/unresolvable legacy IDs remain unresolved. Duplicate URLs share
  membership. No private URL enters protocol diagnostics or shared fixtures.
- Xtream references contain normalized kind/provider ID; Stalker references also
  preserve radio and regular/embedded/lazy series origin. Display snapshots use
  an allowlist; no cmd, stream URL, session tokens or credentials.
- Profile, consent and source incarnation fence every async response and CAS
  retry. Queues never migrate automatically across those boundaries.
- Atomic local projection/outbox in IndexedDB or SQLite worker. No correctness
  dependency on Web Locks and no generic synchronization framework.

## Implementation sequence and acceptance

1. Narrow favorite contracts, validation, reducer, safe snapshots and tests.
2. Additive SQLite local/server stores, persisted receipts and authenticated API;
   extend existing source lifecycle for M3U without changing activity support.
3. IndexedDB/native adapters and consented client with atomic mutation, pull,
   durable offline queue, explicit conflicts and parked intent handling.
4. Wire M3U/Stalker playlist actions and Xtream data-source collection APIs;
   preserve local history, order, historical data and catalog identity guards.
5. Settings opt-in/status/preview/import/queue/conflict controls in both themes.
6. Verify real SQLite historical rows, overlapping operations and native CAS;
   mixed PWA↔Electron add/remove, restart/offline/concurrency, profile/source
   retirement, no-consent privacy, narrow/light/dark settings.
7. Owning tests/types/lint/coverage, builds/worker and initial bundle gate;
   canonical docs and .changes note. Record exact checked revision/results.
8. Commit, local Codex review until clean (repository five-round rule).
   Greptile CLI unavailable: documented exception, no install/sign-in.
   Check visibility/workflow triggers before push, then open and attach a
   separate PR. Do not merge.

## Validation record

Implemented in the isolated worktree with Node 24.22.1 / pnpm 10.33.0;
frozen install, lockfile parity and Nx discovery verified. Main checkout and
user servers/windows are untouched. Tests own ports 3357/4317/3417/3418,
temporary browser contexts, Electron profiles and a disposable Docker container.

- Owning unit suites pass, including real historical SQLite schemas, rollback,
  durable negative states/receipts, multi-tab IndexedDB without Web Locks,
  consent/incarnation fences, native CAS races and typed Stalker ID collisions.
- Full coverage gates pass without threshold changes; the PR records the final
  measured coverage and exact tested/reviewed commit.
- All 42 spec programs and frontend/backend application typechecks pass.
  Lint passes for all 15 affected projects.
- All 20 existing source/activity mixed-runtime scenarios pass. The three new
  favorites scenarios pass after fixing typed removal of numeric Stalker
  categories; active hearts update without navigation. M3U verifies offline
  conflicts, independent adds, duplicate URLs and narrow light/dark settings.
- Production Electron/frontend/worker builds and the initial-byte gate pass:
  1,199,491 bytes against 1,200,301 allowed; no baseline changes.
- Docker linux/arm64 PWA/backend build and HTTP smoke pass, including restart,
  persisted server identity, removals and old idempotency receipts.
- Canonical subsystem docs, Docker guidance and the feature release note are
  updated. Guidance, skill and release-note validation pass.

No physical Synology NAS or packaged Windows/Linux Electron runtime is available
in this environment; mixed macOS Electron and local Linux arm64 Docker supply
the runtime evidence. Greptile CLI is absent, so its documented exception applies.
Local Codex review follows the committed-branch gate before the first push. The
separate PR must remain unmerged and must not close #2059 or #1616.

Local review round 1 identified six real regressions; all were accepted for repair:
HTTP crypto availability, Stalker projection-to-archive writes, typed collection
removal IDs, recent-row membership comparison, new local sources after opt-out,
and Xtream requested-identity checks. Each repair has regression coverage; the
real browser IndexedDB harness also exercises client mutation and SHA-256 at an
insecure HTTP origin. Mixed favorites scenarios remove secure-context crypto APIs
from PWA contexts to exercise the fallback through Settings and provider actions.

Local review round 2 identified three additional real issues; all were accepted:
receiving-device Stalker playback without a shared command, native Xtream hearts
without a local catalog row, and indistinguishable conflict controls. Regression
coverage now exercises exact typed Stalker lookup, parental locking, portable
native targets, and per-item conflict labels/actions. Actual receiving-device
playback checks additionally guard against polling destroying the open detail.

Final repair validation: all 20 existing source/activity scenarios pass, and all
three favorites scenarios pass on the final production build. Receiving-device
Stalker movie/live/radio media advances in both PWA and Electron. Default mock
radio now serves its local progressive audio fixture instead of video HLS.
Narrow conflict controls and light/dark settings were visually inspected.
Coverage: statements 85.30%, branches 76.81%, functions 83.62%, lines 85.80%.
Latest fetched master c5b333e9f adds only unrelated website documentation/assets;
there is no application overlap with this branch's tested base.

Local review round 3 identified three additional real issues; all were accepted:
legacy untyped Stalker removal, live Xtream channel-map invalidation, and stable
Dashboard identities for received Xtream snapshots without local catalog rows.
New regressions fail before repair. Typed Stalker collisions stay protected;
channel-map requests cancel superseded reads and stop after list destruction.

Local review round 4 identified three additional real issues; all were accepted:
sparse Xtream identity snapshots, conflict snapshots lagging a newer server
revision, and local ordering with an empty shared membership store. Additional
entry-point inspection repaired Dashboard Stalker membership removal and M3U
metadata/cache refresh. Regressions cover both conflict choices, both local-order
providers and Dashboard mutations; each fails before its repair.

Dashboard typed Stalker identities are also verified across movie, regular,
embedded and lazy series with the same provider ID. The display key remains
separate from the provider ID used for navigation and explicit removal.

Final validation passes after the final repairs: all 42 spec programs, app types,
15-project lint, full coverage, production build/worker, initial bytes, all three
favorites mixed-runtime scenarios, and Docker HTTP/restart smoke. The helper
extraction keeps the favorites client below the 400-line production limit.

## Publication stopped after local review round 5

Last reviewed runtime revision: 70596e06ea18c752281a62062b281a8b17ad0963.
The main validation suite passes, but focused review probes reproduce two open
findings. Both are accepted and remain unfixed:

- P1: same-item polling reuses the outer global detail host but recreates the
  nested Xtream detail injector, destroying its component and closing playback.
- P2: a replayed older conflict receipt overwrites a newer polled server base
  and conflict snapshot in favorites-sync-delivery.ts.

The repository's five-round local review limit is reached. No push or PR was
created, and no merge occurred. Continue only after the maintainer authorizes
work beyond that review limit. Greptile CLI remains unavailable under the
existing documented exception. The worktree and local branch are retained.
Review output: /tmp/iptvnator-favorites-review-5.out.

## Resumed after maintainer authorization

The maintainer explicitly requested continued review beyond the five-round stop
and an additional `ponytail-review` pass. The new focused regressions reproduce
both open findings before repair: nested movie/series detail recreation, and an
older conflict receipt replacing a newer polled state. The source-edit reset
still passes. Repairs retain nested detail identity and compare both receipt
kinds with the newest known server copy. Mixed-runtime Xtream playback now must
advance beyond the five-second polling interval. Ponytail is a checklist skill,
not an additional external review service.

Resumed validation passes: movie/series injector regressions and both old-receipt
resolution paths; affected types/lint, full coverage, production build and worker,
initial bytes 1,199,493 / 1,200,301, Docker add/remove/retry/restart smoke.
The mixed Xtream test confirms the same playing media element survives a full
polling cycle in both PWA and Electron. Stalker and M3U mixed cases also pass.
Ponytail connected-code inspection assumes one shared home server with a few
clients. It found no additional confirmed issue after these repairs; it checked
authorization, transactions, durable receipts, source/profile fences and callers.

Local review round 6 identified four additional real issues, all accepted:
Stalker hydrated detail resets during polling, legacy embedded/lazy reference
classification, string radio markers, and shared identity/conflict overlay in
Xtream backups. New focused regressions fail before repair for each. The fixes
reuse the source session fingerprint and the same identity guard for display
and backup; archive ordering/timestamps and the strict series predicate remain.

Round-6 repairs pass all 42 spec programs, affected lint and full coverage:
statements 85.31%, branches 76.88%, functions 83.63%, lines 85.81%.
Production Electron/frontend/worker and Linux arm64 Docker builds pass; the
initial payload is 1,199,591 / 1,200,301 bytes. All three mixed favorites flows
and Docker HTTP add/remove/receipt/restart smoke pass. Radio classification reuses
the existing shared predicate with transport-command fields excluded.

Local Codex round 7 is clean at f45a347ed02e3ad763accc30b801912a749df609.
The additional Ponytail pass found one concrete ID-precedence mismatch: a row
with id 42 and stream_id 84 displays as 42 but exported as 84. Its regression
fails before repair; portable references now match existing canonical field
precedence without adopting synthetic display fallbacks. No other Ponytail
finding was confirmed at the documented household load assumption.

Ponytail ID-precedence repair passes owning tests/types/lint, full coverage
(statements 85.31%, branches 76.89%, functions 83.64%, lines 85.81%), production
Electron/frontend/worker build and initial bytes (1,199,586 / 1,200,301).
Linux arm64 Docker build and HTTP add/remove/receipt/restart smoke pass too.
The synthetic regression observes the canonical display ID and portable ID
agree after repair. A fresh committed-branch Codex gate follows this final fix.

Local review round 8 found an additional accepted issue: background favorite
reloads bypassed page content-type selection. The first shared Xtream movie or
series received on an empty page stayed hidden behind the selected live type.
Both regressions fail before repair. The page now owns renderer invalidation
and routes refreshes through its existing guarded load; the redundant service
listener and remembered request are removed. The mixed Electron receiver stays
on the empty page during PWA import and must display the first movie unaided.

Round-8 repair passes 224 portal UI tests, owning data tests/lint/types and E2E
types, full coverage (85.32% statements, 76.90% branches, 83.64% functions,
85.82% lines), production Electron/frontend/worker, initial bytes
1,199,588 / 1,200,301, all three mixed favorites E2E cases, and Linux arm64
Docker build plus HTTP add/remove/receipt/restart smoke. Canonical PWA docs
describe guarded background type selection. No findings were declined.

Local review round 9 found two accepted issues: operations-only failures were
hidden from runtime status, and overlapping Stalker live favorite reads could
publish old membership after newer reads or acknowledged local changes. All
six new regressions fail before repair. Delivery retains queued intents,
continues independent keys, then propagates the first failure. Stalker fences
read publication by request generation and invalidates reads on local callbacks.

Round-9 repairs pass owning tests/types/lint, full coverage (85.32% statements,
76.90% branches, 83.64% functions, 85.82% lines), production Electron/frontend/
worker, initial bytes 1,199,593 / 1,200,301, all three mixed favorites E2E cases,
and Linux arm64 Docker build plus HTTP add/remove/receipt/restart smoke.
The M3U E2E case now verifies a visible error when only operation delivery fails,
then restores delivery and confirms the saved queue drains. Canonical PWA docs
describe delivery failure reporting and Stalker read fencing. No findings declined.

Local review round 10 and the requested Ponytail review confirmed two accepted
issues: strict wire title validation rejected retained local display hints, and
native HTTP 5xx context failures prevented durable offline edits. The user
authorized both repairs. Seven new regression cases fail before the fixes.

All three provider adapters now normalize only the outgoing display-title copy;
original archives and strict incoming validation remain unchanged. The client
uses a previously verified context for transient HTTP 5xx, with existing consent,
profile, incarnation and request-owner fences. Tests also cover recovery delivery,
missing context, rejected access/source responses and superseded requests.
The optional M3U digest-cache optimization remains deferred.

Round-10 repairs pass web (804 tests), services (1,385 tests), the final focused
client run (36 tests), both owning lint targets, application types and all 42
spec programs. Full coverage passes unchanged gates: 85.32% statements, 76.91%
branches, 83.64% functions and 85.82% lines. Production Electron/frontend/worker
builds pass; initial bytes are 1,199,595 / 1,200,301. All three mixed favorites
E2E cases pass. Release notes (231), guidance (3), formatting and whitespace
checks pass. The existing feature release note covers these pre-release repairs.
No server, container or packaging behavior changed, so the Docker smoke is not
repeated in this repair. Physical Synology and packaged Windows/Linux runtimes
remain unavailable. A fresh committed-branch local review follows.

Round 11 reviewed runtime commit 0a3c348ae8e79d977dd553d053efe4eaadbd1159.
The two round-10 fixes are accepted; web/services suites pass. Review remains
non-clean: legacy embedded Stalker episode lists containing nonnumeric values
still fail local snapshot conversion; unchanged M3U projections repeat URL
hashing (the already deferred Ponytail finding); and server favorite context
authorization reads the complete M3U payload instead of metadata. The reviewer
measured 100,000 hashes on each unchanged 100,000-channel read (971/941 ms),
and ten full reads of a synthetic 30 MiB source for ten context requests (321 ms).
Code inspection confirms the archive converter uses unfiltered `map(Number)`
and server authorization calls the payload-reading `playlists.get()`.
No findings are declined. No branch push or PR publication is performed while
these remain open; the repeated M3U finding is recorded under the local-review
stop/report rule. Greptile CLI remains unavailable. Output is retained outside
the repository in /tmp/iptvnator-favorites-review-11.out.

On 2026-11-04 the user authorizes repair of all three remaining findings and a
new review. Legacy embedded episode hints now filter positive safe integers;
non-array, empty-after-filtering and oversized archives remain unresolved locally.
Original records and strict incoming wire validation are preserved.

The M3U URL index keeps one build per source version/update/count/incarnation.
Versioned payload clones reuse it; unversioned legacy payloads also require the
same array. Concurrent reads share the promise, failures evict only their own
entry, and changed versions replace the index. Server favorite authorization uses
the existing payload-free metadata table. A missing text-M3U lifecycle context
still reads the payload once; transactional source writes and deletion retire it.
Regression tests cover projection/preview, invalid archives, overlapping reads,
version/date/count/incarnation changes, cloned payloads, retry, authorization,
source replacement and deletion. The three initial regressions fail before repair.

Matching synthetic probes on Node 24.22.1/macOS arm64 (local evidence, with other
checks running; timings are single samples, not journey/CI baseline measurements):

| Probe | Before | After |
| --- | --- | --- |
| 100,000-channel first projection | 100,000 hashes / 1,125 ms | 100,000 hashes / 951 ms |
| Same unchanged projection again | 100,000 hashes / 966 ms | 0 hashes / under 1 ms |
| Ten verified contexts, 30 MiB source | 10 full payload reads / 334 ms | 0 full payload reads / 21 ms |

No performance ratchet or UX behavior is changed. Canonical PWA and Stalker docs
describe the cache, lifecycle and legacy-archive rules. The existing unreleased
feature note covers these repairs; no duplicate release note is added.

Final repair checks pass: adapter regressions (19), server storage/router checks
(20), full 36-project coverage gates (85.33% statements, 76.93% branches,
83.65% functions, 85.83% lines), owning lint, application types including the
web backend, and all 42 spec programs. Production Electron/frontend/worker builds
pass; initial bytes are 1,199,594 / 1,200,301. Three mixed favorites E2E flows
pass, with M3U repeated after the cloned-payload cache refinement. Docker Linux
arm64 build and HTTP add/remove/duplicate-receipt/restart smoke pass for text M3U.
Formatting, whitespace, guidance (3) and release-note validation (231) pass.
Greptile is still unavailable; committed-branch Codex review is next. Physical
Synology and packaged Windows/Linux Electron remain unavailable.

Round 12 reviews 9cdb6cef8ea4460c0ae0908b81592eef06fe83f5. All three prior
findings are repaired; the reviewer confirms web (810) and services (1,385) pass.
Three further findings are accepted and repaired in the same resumed local loop:
normalized Stalker movie names were lost during command lookup, unverified PWA
retries could reinterpret known authorization refusal as offline intent, and
typed Stalker collection UIDs bypassed saved historical global-order keys.

Command lookup now accepts the normalized `info.name`. Browser source proof
retains a selected-connection refusal across retries and malformed access-error
bodies until successful instance verification; true outages still permit cached
offline edits. Global ordering accepts only an unambiguous historical Stalker UID,
with exact typed keys taking precedence and no rewrite of saved order on read.
Seven regression cases fail before repair and pass afterward; additional cases
cover failed instance proof, recovery, ordinary outages and ambiguous provider IDs.
Canonical PWA and Stalker docs are updated. No findings are declined.

The next repair passes full coverage (85.36% statements, 76.98% branches,
83.66% functions, 85.85% lines), owning lint and application typechecks, and all
42 spec programs. Production Electron/frontend/worker build passes; initial bytes
are 1,199,588 / 1,200,301. The full 23-case mixed source/activity/favorites suite
is run because the browser transport is shared across those domains.

All 23 mixed flows pass. The final selected-connection fence also has a failing-
before/passing-after late-401 regression: an old response cannot mark the new
profile as refused. Unsupported instance discovery blocks later source requests
as an identity refusal, not a synthetic per-source 404. Its negative regression
also fails before repair. Four affected mixed favorites/PWA-auth flows are repeated
successfully after the connection-fence refinement. Services coverage is refreshed
and merged with the other 35 reports after the final discovery-status repair;
coverage health remains 85.36/76.98/83.66/85.85 with unchanged gates.
Final production initial bytes are 1,199,587 / 1,200,301. Docker Linux arm64 build
and HTTP add/remove/receipt/restart smoke pass. All 42 spec programs, owning lint,
formatting, guidance, release-note and whitespace checks pass. The existing feature
note covers this repair. A new committed-branch local review follows; Greptile
is unavailable. Physical Synology and packaged Windows/Linux remain unchecked.

Round 13 reviews runtime commit 82927a02f3de74950e36ef2630416a48ee286fc0.
The reviewer reruns services (1,392 tests) and web (810 tests) successfully, then
reproduces two open boundary cases. The instance-refusal finding repeats: the
actual `SourceSyncService.refresh()` discovery-validation path rejects a changed
HTTP-200 instance before `verifySourceInstance()` can record refusal, so a later
cached-context edit is still queued. The probe records one pending intent after
`SOURCE_SYNC.INSTANCE_CHANGED`, with the refusal marker absent.

The second finding affects Electron opt-out: a new/restored source without a
favorites context uses raw SQLite favorites, but the profile-wide `active()` gate
disables native favorite-ID removal. A retained row with no catalog link is sent
through the raw data source with ID zero, losing its valid favorite ID; individual
removal and bulk clear do not delete it. Code inspection confirms both paths.

No findings are declined. The loop stops under the repeated-finding rule in
`docs/development/agent-workflow.md`; the branch is not pushed and no PR is opened.
All requested initial three repairs remain committed, together with the subsequent
normalized-title/global-order fixes and refusal guards. This repeat shows that
the actual discovery rejection still needs integration coverage. Greptile remains
unavailable. Review outputs remain in /tmp/iptvnator-favorites-review-13.out/.log.

The user explicitly resumes repairs and reviews until the branch reaches a good
state, with no PR while it remains unready. This authorizes continuing beyond the
previous repeated-finding stop. The next repair moves ordinary discovery validation
into the common verifier and checks recorded refusal before either renderer transport.
The pending-browser adoption branch retains its shape validation and reload semantics.
Four integration regressions exercise actual `SourceSyncService.refresh()` with a
changed HTTP-200 instance or incompatible storage in browser and Electron paths;
rejected edits do not touch projection/outbox, and valid refresh restores proof.

Xtream collection operations now select native/portable behavior per source. Native
unlinked records retain their favorite ID for removal. Bulk clear delegates to the
single-item path, and mixed reordering writes only native source positions while
keeping the full local UID order. New tests reproduce failed removal, clear and
mixed ordering after opt-out. The mixed Xtream E2E adds a second source after opt-out,
restores a synthetic unlinked favorite through real worker IPC, and removes it from
the global collection UI, checking actual persisted rows. Canonical PWA and Xtream
contracts are updated. The existing unreleased feature note covers these repairs.

The same refusal boundary also covers native transport exceptions. Wrapped IPC
`LOCKED`, `INSTANCE_CHANGED` and `INCOMPATIBLE` errors now remain hard refusals,
as do native HTTP access/identity responses; a later outage cannot turn them into
queued intent. Native instance probes distinguish incompatible metadata/404 from
network/5xx outages and reject 403 without reading the token. Six renderer and
three main-process regression cases fail before repair and pass afterward.
Late access rejection from either transport cannot revoke a newer profile.

Round 14 validation: services 1,404 tests and Electron 2,890 tests pass with
coverage; collection regression checks pass (29 tests). The refreshed 36-project
merge passes unchanged gates: 85.37/77.02/83.69/85.87 percent. Coverage health's
same-name-spec warning for source authorization is covered by the actual transport
and refresh integration specs. Application typechecks pass. All 42 spec programs
are checked; two test-double casts initially fail in services/web and their
corrected programs pass on rerun. Owning lint, formatting, whitespace, guidance
(3 files) and release notes (231) pass. Production Electron/frontend/workers build;
initial payload is 1,199,588 / 1,200,301 bytes, with no baseline changes.

The first full 23-flow run has 22 passes and one new test-selector failure: the
movies-only collection has no Movies switch. Removing that redundant test step
and extending the regression to bulk clear passes the focused Xtream run. After
the final native refusal repair, all six affected favorites/authentication/identity
PWA/Electron flows pass again. Linux arm64 Docker build a17d41c433c0 succeeds;
HTTP add/remove/idempotency and restart-preservation smoke checks pass. Isolated
containers are removed. Physical Synology, packaged Windows/Linux and optional
vendored Embedded MPV remain unavailable. A committed-branch review follows;
Greptile CLI remains unavailable under the documented exception.

The next base fetch advances origin/master to 0a5eac1c6, including provider,
worker, navigation and Nx 23.3.1 changes. The initial round-14 reviewer is stopped
before further work, and the updated base is merged locally. The only textual
conflict is Hungarian activity copy: retain upstream translations, the new
favorites section and a Hungarian explanation of separate favorites consent.
The frozen install and Nx discovery pass with the updated lockfile.

The merged production initial payload reproduces a 404-byte limit violation:
1,200,705 / 1,200,301. Repository-wide caller searches identify five obsolete
PlaylistsService favorite APIs with no production callers: updateFavorites,
setFavorites, setPortalFavorites, getFavoriteChannels and
getPortalLiveStreamFavorites. Remove those aliases/getters and inline the now
single-use projection helper. Preserve the serialized-write regression through
the canonical transformPlaylistFavorites path; remove only the two tests of the
deleted getters. No runtime path, performance probe, baseline or coverage gate
is weakened. The rebuilt initial payload is 1,200,164 bytes, down 541 bytes and
within the unchanged limit.

The merged branch passes full 36-project coverage, all 42 spec programs,
application typechecks, affected lint (47 tasks), guidance, eight skills and
250 release notes. All 23 mixed PWA/Electron flows pass. After deleting the unused
APIs, services coverage is refreshed (1,403 tests), affected spec programs and
lint pass, and the 36-report merge remains healthy at
85.56/77.30/83.84/86.05 percent. Same-name-spec warnings cover upstream barrels,
interfaces and modules with focused coverage; they do not fail the gate.
The final Linux arm64 Docker image is 5a8a4d8163ec; HTTP add/remove/receipt and
restart smoke checks pass and the isolated container is removed. Three favorites
flows pass again after the deletion before committing for a fresh review.

Round 15 reviews 1f6e103bb2326b6eec4aa652aeae00d3b6221dd4 and reports two
boundaries. The Dashboard removal method routes a context-free native source
incorrectly, but a repository-wide caller trace shows this obsolete method has
no production caller: Dashboard favorite cards navigate to the common collection.
Remove that duplicate API and its private metadata helper rather than maintain
a second mutation path. Keep read/navigation coverage and the actual collection
removal regressions. The review's runtime-impact premise is declined for this
method; its faulty, unused implementation is removed.

Backup restore does have a live failure: opted-out negative local sidecars can
hide a restored membership from the separate favorites preview. Settings now
supplies an optional post-entry restoration callback, capturing the original
client/consent/context. It reconciles only restored keys with existing local
choices, using the client's guarded local-write path. Enabled shared state,
base revisions, conflicts and pending operations remain intact; no favorites
request is authorized by restoring. Omitted choices are untouched. The callback
uses the accepted source ID after inventory deduplication and runs only after
local user-state restore succeeds. Its failing-before/passing-after regression
checks that actual hook; adapter integration covers M3U, Xtream and Stalker,
enabled/disabled state, parked queue retention and expired ownership. The canonical
backup contract is updated. The mixed M3U flow restores a synthetic backup through
Settings in PWA and Electron, then uses preview/import and explicit conflict choice.

Independent boundary checks also reproduce malformed successful discovery being
treated as an outage. Discovery client errors and malformed success now retain
refusal evidence; native probes classify non-outage incompatible responses too.
Network/5xx outages remain queueable, with regression coverage for later outages
after both renderer transports reject discovery. The PWA contract is updated.
Finally, upstream now supplies @noble/hashes directly to shared interfaces; use
its lazy SHA-256 fallback and delete the duplicate hand-written implementation.
Exact UTF-8 URL and block-boundary vectors continue to match Node SHA-256.

Round 16 validation refreshes the five affected coverage projects: web 851,
services 1,409, Electron 3,000 tests; shared interfaces and Dashboard pass too.
The 36-report merge passes unchanged gates at 85.54/77.30/83.84/86.04 percent.
The extended full mixed PWA/Electron suite passes all 23 cases (5.4 minutes),
including real Settings restoration, preview and conflict resolution on both
platforms. All 42 spec programs, application typechecks, owning lint, formatting,
whitespace, guidance and 250 release notes pass. Production frontend/Electron/
workers build; initial bytes are 1,200,152 / 1,200,301. Linux arm64 Docker image
eb055070a05d builds, and HTTP add/remove/receipt/restart smoke passes. Isolated
containers are removed. The eight discovery regressions also fail against the
previous implementations and pass after restoring the fixes (30 focused tests).
The restore hook regression fails before its implementation and passes afterward.
The existing unreleased feature note covers these fixes. Physical Synology,
packaged Windows/Linux and optional vendored Embedded MPV remain unavailable.
Commit and repeat the local review; Greptile remains unavailable.

Round 16 reviews d5cf6f307c509b9c6a08d368517bb896326cee76 and reproduces one
remaining issue: a first offline HTTP/LAN edit may need an unfetched mutation
chunk or SHA-256 fallback. Existing mixed flows warm these through online edits.
The repair moves only the small write bridge into its already-eager token module;
no first local M3U write needs a script fetch, including with sync never enabled.
Portal favorite reads load sorting and the companion typed removal logic together
in the renamed private playlist-favorites module before publishing favorites.
The HTTP hash fallback is prepared before enabling consent and before projecting
a retained favorite profile. Keep the hash library's lazy ESM boundary for CJS
consumers and avoid shipping the whole crypto dependency on the initial path.
The canonical PWA contract records this readiness requirement.

Two isolated PWA regressions disable Service Worker and SubtleCrypto, perform no
online favorite action, and abort all later scripts plus favorites requests.
They inspect actual IndexedDB persistence before unblocking the network and
verify the saved choice after reload. Both pass on the repair and fail on the
previous bridge/runtime implementation, with no durable record written. The tests
cover both default-off local favorites and explicit sync. A complete 25-flow mixed
run follows after restoring the repaired files.

Merge the already-fetched final upstream Stalker season fix at 6bbe0eb09 without
conflicts; repeat frozen install and discovery. This also adopts the canonical
synthetic-data guidance. A restore compatibility regression additionally verifies
that unusable legacy Xtream favorite IDs cannot make sidecar reconciliation fail:
use canonical restore normalization and ignore IDs that cannot have a valid
portable sidecar. Existing valid local choices, archives and pending state remain
protected. The refreshed full 36-project coverage and all 42 spec programs pass.

Round 17 validation: all 25 mixed PWA/Electron cases pass (5.5 minutes), including
both cold offline regressions after their failing-before run. Full coverage passes
unchanged gates at 85.56/77.35/83.86/86.06 percent; web has 852 passing tests,
services 1,409, Electron 3,001 and shared interfaces 848. Application and all 42
spec-program typechecks, owning lint, formatting, whitespace, three guidance files,
eight skills and 251 release notes pass. Production frontend/Electron/workers build;
initial bytes are 1,200,281 / 1,200,301 without baseline changes. Linux arm64 Docker
image 8d32fe7a4fc2 builds and HTTP add/remove/receipt/restart smoke passes; the
isolated container is removed. The feature release note remains sufficient.
Physical Synology, packaged Windows/Linux and optional vendored Embedded MPV are
still unavailable. Commit the merged repair and repeat the review before any push.

Round 17 reviews 84eb26ba5 and reproduces two Xtream issues: a fresh PWA receiver
cannot resolve received favorites before browsing its catalog, and SQLite lookup
drops saved/requested identity hints when duplicate provider IDs exist. The repair
loads only needed typed catalogs on collection reads, reuses normal PWA caching
and visibility filtering, shares pending loads, and retains unavailable snapshots
for retry after provider failure. Writes remain cache-only. Re-read membership
after loading and reject retired source incarnations; pending loads are keyed by
incarnation. SQLite lookups forward normalized saved/requested TMDB and year hints.
Compatible duplicate rows never clear an explicit retained identity conflict.

The original receiver regression set fails four cases before the repair. Ten
focused cases now cover both lookups, fresh/concurrent PWA reads, retry, filtered
visibility, offline writes, retained conflicts and ownership/membership changes.
The added catalog scan guard fails at 3,003 property reads for three favorites in
1,000 rows before indexing; one pass now indexes only requested IDs and passes
the unchanged linear bound. The mixed Xtream flow adds an isolated blank PWA
receiver, which plays a received favorite without first browsing its provider.
The canonical Xtream contract records the receiving behavior and identity hints.

Round 18 validation: all 862 web tests pass; the refreshed report merges with
the other 35 passing project reports at 85.57/77.39/83.86/86.07 percent, unchanged
gates. Application typechecks, all 42 spec programs, owning lint, formatting,
whitespace, three guidance files and 251 release notes pass. Production frontend,
Electron and workers build; initial bytes remain 1,200,281 / 1,200,301. The three
affected mixed flows pass (1.3 minutes), including the blank receiver's decoded
playback and both cold offline edits. The complete 25-flow suite passed at the
preceding commit; unchanged flows are not repeated. Linux arm64 Docker image
0c4d84258928 builds; HTTP add/remove/receipt/restart smoke passes, and the isolated
container is removed. The existing feature note covers these fixes. Physical
Synology, packaged Windows/Linux and optional vendored Embedded MPV remain
unavailable. Fetch confirms master remains 6bbe0eb09. Commit and repeat local
review before any push; Greptile CLI remains unavailable.
