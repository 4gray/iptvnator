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
