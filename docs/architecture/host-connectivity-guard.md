# Host Connectivity Guard

Per-host circuit breaker for portal requests in the Electron main process.

## The problem

Every request to an unreachable portal costs its full axios timeout — 30 s for
`XTREAM_REQUEST`, 15 s for `STALKER_REQUEST` (30 s for `create_link`). Browsing a
dead portal's catalog issues dozens of those back to back, which shows up as
30-second spinners and a main-process log full of identical failures. Once a host
has refused to answer twice in a row there is nothing left to learn from waiting
again.

## Where it lives

`apps/electron-backend/src/app/util/host-connectivity-guard.ts` — a pure module
(no Electron imports) wired into both IPC handlers.

The handlers are the choke point that sees _all_ traffic to a host. The
renderer's `executeStalkerRequest` is not: it has four documented bypasses
(auth, endpoint discovery, account info, the row-less stream resolver), and that
is exactly the traffic that hits dead hosts.

**The PWA is deliberately not covered yet.** `apps/web-backend` sets no
per-request timeout at all, so a dead host there hangs on OS-level TCP timeouts
rather than a 15/30 s budget — a timeout-driven breaker would rarely trip. The
guard is written dependency-free so it can move into a `domain:shared-runtime`
library and be shared with `web-backend` when that gap is closed.

## Rules

Being wrong here means refusing to talk to a portal that works, so every rule
errs towards contacting the host:

|             |                                                                        |
| ----------- | ---------------------------------------------------------------------- |
| Trip        | 2 consecutive host-level failures within an inclusive 120 s window     |
| Open for    | 30 s (`OPEN_DURATION_MS`), matching the repo's other cooldowns         |
| Half-open   | exactly ONE trial request; the rest keep fast-failing until it settles |
| Reset       | any HTTP response — 200, 404, even 502 — the host answered             |
| Key         | `URL.origin` — scheme, host **and** port (see below)                   |
| Kill switch | `IPTVNATOR_DISABLE_CONNECTIVITY_GUARD=1` (read per call)               |

**Host-level failure** means an error with no HTTP response whose code is one of
`ETIMEDOUT`, `ECONNABORTED`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`,
`EHOSTUNREACH`, `ENETUNREACH`. `ECONNRESET` is deliberately excluded: a reset
mid-transfer happens on hosts that are very much alive. Cancelled requests
(`ERR_CANCELED`) and SSRF-policy refusals are `inconclusive` — they say nothing
about reachability and only release the half-open slot.

**The key is the origin, not the host.** `URL.host` omits a default port, so
`http://panel.example` and `https://panel.example` would share one record —
two genuinely different endpoints, and a panel whose TLS listener is broken
while plain HTTP works is a routine IPTV setup. Sharing state there would let
the dead one fast-fail the working one without ever contacting it.
`URL.origin` also leaves out any `user:pass@` userinfo, so no credential
reaches the key or the log line.

Two more rules exist because of specific failure modes:

- **Siblings are not a streak.** Catalog initialization fans out three category
  requests at once; one network hiccup failing all three is one piece of
  evidence, not a trip. A failure counts only if its request started at or after
  the moment the previous failure was recorded. Timestamps are millisecond
  coarse, so this only separates siblings once a request actually took time —
  which is precisely the expensive case worth protecting.
- **A reset invalidates reports already in flight.** `reset()` bumps a per-host
  epoch instead of deleting the record, and a failure reported under an older
  epoch is discarded. Without that, the 30-second stragglers a user was waiting
  behind settle right after they press Retry and re-open the breaker underneath
  the very retry that cleared it.

A half-open trial that never reports back expires after 45 s (above the longest
request timeout), so a leaked token cannot leave the breaker open forever.

## The fast-fail error is a renderer contract

`HostConnectivityGuardError` is a real `Error`: Electron serializes a rejected
plain object to `[object Object]`, which would destroy the renderer's
classification. It carries no `status` property, because
`getStalkerRequestErrorStatus` reads that field first.

The message comes from `buildHostConnectivityFastFailMessage()` in
`libs/shared/interfaces/src/lib/host-connectivity.util.ts`. It names the full
endpoint, scheme included, so a user who imported the same panel over both HTTP
and HTTPS can tell which one was skipped. Its wording is load-bearing — the
Stalker renderer classifies transport failures purely from message text:

| Must not contain                                                                                     | Otherwise                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP Error <code>`                                                                                  | reads as "endpoint absent, probe the next candidate"; 404/401/403 also fire lazy portal repair against a host we just declared dead |
| `timed out`, `timeout of Nms`, `ETIMEDOUT`                                                           | discovery walks every candidate instead of aborting early                                                                           |
| `authorization`, `unauthorized`, `access denied`, `invalid token`, `auth failed`, `handshake failed` | fires lazy portal repair (a bare `authorization` matches)                                                                           |

What remains is the "connection-level failure" slot the renderer already has for
ECONNREFUSED/ENOTFOUND: discovery stops probing and reports the host
unreachable, `shouldAttemptRepair` returns false, and the message reaches error
snackbars verbatim — which is why it reads like a sentence and names the
endpoint.
`stalker-portal-discovery.utils.spec.ts` pins all three properties for the bare
and the IPC-wrapped form.

## Exemption: endpoint discovery

`STALKER_REQUEST` accepts `skipConnectionGuard`, set **only** by
`StalkerPortalDiscoveryService.probeContent`. Semantics: bypass the check, never
count failures, **but still report successes.**

Discovery walks several candidate paths on one host and expects most of them to
fail; counting that would let it declare a slow-but-alive portal unreachable.
Reporting successes is equally load-bearing: `confirmFullPortal` runs the full
non-exempt authentication flow against auth-gated candidates, so without it two
hung handshakes could open the breaker mid-discovery and the next authenticate
would fast-fail into the "host unreachable" slot — abandoning a portal that
works.

## Explicit reset

`CONNECTIVITY_GUARD_RESET` (`{ url }`) is handled by
`apps/electron-backend/src/app/events/connectivity-guard.events.ts`. One key
derivation is enough: both `normalizeXtreamServerUrl` and
`buildStalkerRequestUrl` rebuild their request URL from `URL.origin`, so the
origin a request ends up using is always the origin of the URL stored on the
playlist.

Call sites:

- `retryContentInitialization` (`with-content.feature.ts`) — the Xtream
  content-gate Retry button. The reset is the **first** awaited statement, before
  the portal status check: a tripped guard fast-fails that check, its
  `unavailable` verdict returns early, and a reset placed any later would never
  run — the button would silently do nothing for the whole window.
- `StalkerPortalDiscoveryService.discover()` — one site covering import, the Edit
  dialog and lazy repair, which also guarantees a freshly edited address never
  inherits a refusal recorded for the previous one.
- `retryContentPage` (`with-stalker-content.feature.ts`) — the Stalker grid
  tail's append retry, for the same reason: two failed appends are exactly what
  opens the breaker, so the reset precedes the resource reload.
- `PortalStatusService.checkPortalStatusDetails` when `skipCache` is set — the
  user-initiated "Test Connection".

All four go through `resetHostConnectivityGuard()`
(`libs/services/src/lib/host-connectivity-reset.ts`), which holds the one rule
they share: the reset is best effort, because the guard only ever _delays_ a
request and a failed reset must not block the action that asked for it. In the
PWA the channel is unknown and `sendIpcEvent` no-ops, which is correct —
nothing there records per-host failures yet.

## Interaction with VOD multi-source

No exemption is needed. Multi-source resolution reaches `get_vod_info` over
`XTREAM_REQUEST`, but `VodSourceResolverService.loadVodDetails` already catches
that failure and falls back to its learned container cache or `null`, and
`probeSource` maps `null` to the verdict `unknown` — which
`VodSourceProbeCacheService` deliberately does not cache. A guard fast-fail
therefore degrades to a retryable "could not check", exactly matching the
module's contract that unreachable ≠ contacted-and-refused. The
`STREAM_PROBE_URL` reachability half never rejects and is untouched.

## Tests

- `apps/electron-backend/src/app/util/host-connectivity-guard.spec.ts` — the
  state machine, with an injected clock.
- `apps/electron-backend/src/app/events/stalker.events.spec.ts` and
  `xtream.events.spec.ts` — trip, fast-fail without contacting axios, reset,
  exemption, and the absence of per-request log spam.
- `libs/portal/stalker/data-access/src/lib/stalker-portal-discovery.utils.spec.ts`
  and `stalker-portal-repair.service.spec.ts` — the message contract.
