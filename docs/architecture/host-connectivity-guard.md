# Host Connectivity Guard

Per-host circuit breaker for portal requests, in both processes that make them:
the Electron main process and the self-hosted web backend.

## The problem

Every request to an unreachable portal costs its full axios timeout — 30 s for
`XTREAM_REQUEST`, 15 s for `STALKER_REQUEST` (30 s for `create_link`), and the
same budgets on the web backend's `/xtream` and `/stalker` routes. Browsing a
dead portal's catalog issues dozens of those back to back, which shows up as
30-second spinners and a log full of identical failures. Once a host has refused
to answer twice in a row there is nothing left to learn from waiting again.

The web backend had a worse version of the same problem first: its proxy routes
passed no `timeout` at all, so a provider that accepted a connection and then
went silent held the request until the OS gave up on the TCP connection. A
breaker is only useful once _not answering_ is bounded, which is why the timeouts
and the breaker landed there together.

## Where it lives

`libs/shared/host-health` (`@iptvnator/shared/host-health`, tagged
`scope:shared` / `domain:shared-runtime` / `type:util`) — the breaker class, the
failure classification and the redirect-attribution helpers, with no transport,
logger or process singleton of its own. The owning app supplies the clock and
decides how many guards exist.

Each runtime owns its instance:

- **Electron** — `apps/electron-backend/src/app/util/host-connectivity-guard.ts`
  holds one guard for the whole process, wired into both IPC handlers. The
  handlers are the choke point that sees _all_ traffic to a host. The renderer's
  `executeStalkerRequest` is not: it has four documented bypasses (auth,
  endpoint discovery, account info, the row-less stream resolver), and that is
  exactly the traffic that hits dead hosts.
- **PWA** — `apps/web-backend/src/app/host-guard.ts` guards the `/xtream` and
  `/stalker` proxy routes. The guard instance is injected through
  `WebBackendAppOptions.hostGuard`, alongside `now` and `guid`, so specs drive
  it with a clock they own.

### Request timeouts are the precondition

A breaker keyed on "the endpoint did not answer" is only useful once _not
answering_ is bounded. `apps/web-backend` originally passed no `timeout` at all,
so a silent host hung on OS-level TCP timeouts. Both runtimes now use the same
budgets: Xtream 30 s, Stalker 15 s (30 s for `create_link`, which mints a stream
URL before answering), playlist and XMLTV downloads 30 s.

Those numbers are safe for large downloads. On axios' default
(follow-redirects) transport `timeout` is **not** a wall-clock deadline for the
whole response: it bounds the time to response headers and then continues as the
socket's inactivity timeout for the body. A multi-megabyte XMLTV file that keeps
delivering bytes is never cut off mid-transfer — only a stalled one is.

### Scope: portal calls only

Both runtimes guard the portal API paths and nothing else. Playlist and XMLTV
downloads (`/parse`, `/parse-xml`, and their Electron equivalents) get the
timeouts but not the breaker, deliberately:

- The problem being solved is a catalog fan-out — dozens of requests to one
  endpoint back to back. A download is a single request.
- A download is usually the direct result of the user asking for it (the
  add-playlist dialog sends `PLAYLIST_PARSE_BY_URL`). Refusing an immediate
  retry is a regression, not a protection, and there is no natural reset site on
  that path the way portal Retry has one.
- A large XMLTV transfer can legitimately run for minutes — the timeout is
  idle-based, see above — which outlives the 45 s half-open trial expiry and
  would let a second trial in behind the first.

## Desktop preference and account feedback

Settings > General > Portal connections offers **Pause requests to unavailable
portals**, enabled by default. `Settings.portalConnectivityGuard` is default-on
for missing or non-boolean legacy values; only explicit `false` opts out. The
form stages edits until Save and persists the choice through the normal settings
store. `SETTINGS_UPDATE` mirrors it to Electron's `PORTAL_CONNECTIVITY_GUARD`
config key and applies it immediately. `SettingsEvents.bootstrapSettingsEvents`
loads that mirror before the renderer is loaded, so a saved opt-out already
applies to the first portal request after restarting.

The preference controls both Xtream and Stalker. A real preference transition
replaces the Electron guard and its weak set of admitted request tokens, clearing
existing cooldowns and ignoring completions from the old generation. Disabled
requests return no token and cannot contribute failures when the user re-enables
the guard. Saving an unchanged value preserves existing evidence.
`IPTVNATOR_DISABLE_CONNECTIVITY_GUARD=1` (or `true`) still overrides an enabled
preference. The UI is capability-gated by `supportsPortalConnectivityGuard`
(`updateSettings` plus `resetHostConnectivityGuard`); the PWA has no client-side
switch for its shared server-wide guard.

Both account-info dialogs classify the existing cross-process guard message and
show a localized **Requests temporarily paused** explanation with **Retry now**.
Stalker keeps cached account data visible and offers the same retry beside the
paused refresh notice. Retry resets before requesting again; actual network
failures retain the generic unavailable state. These notices describe the last
request outcome, not a live countdown. The preference does not fix the separate
same-millisecond sibling-counting issue #1438.

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

**A failure is only charged to the endpoint that produced it.** Reaching any
later hop _proves_ the guarded endpoint answered — the first hop is always the
URL we asked for, and only a redirect status advances the chain — so a failure
there CLEARS the guarded endpoint's record, exactly like any other response.
Merely declining to count it would leave an earlier direct failure standing, and
a single later timeout would then fast-fail an endpoint that answered in between.
Every caller passes the URL it asked for as the baseline.

**Where the failed hop is found depends on the transport, and both are in play.**

| | Electron | Web backend |
| --- | --- | --- |
| Redirects | followed hop by hop (`maxRedirects: 0`), each its own request | followed inside one request by follow-redirects |
| Failed hop is in | `error.config.url` | `error.request._currentUrl` |

`failedRequestUrlOf` reads `_currentUrl` first and falls back to `config.url`,
which is correct for both: a per-hop request exposes no `_currentUrl`, and on the
following transport `config` is built once and keeps the URL we asked for — so
reading `config.url` there would compare a URL with itself, find no redirect, and
charge a dead destination to the provider that answered. Anything added here must
work on both, because the same helper serves both.

**The comparison is origin + path, not the whole URL.** A same-origin redirect
(`/player_api.php` → `/slow/player_api.php`) proves the endpoint answered just as
much as a cross-origin one, and charging it would fast-fail every OTHER call to a
portal that answers — so the path has to be part of it. The query must NOT be:
the web backend passes Xtream credentials through axios' `params`, so the sent
URL always carries a query the baseline does not, and comparing whole URLs made
every ordinary failure look like a redirect and stopped the breaker from ever
opening. What that gives up is a redirect that changes nothing but the query,
which is then counted as an ordinary failure — the safe direction.

It requires positive evidence — anything unparseable or unknown counts the
failure as usual, because guessing "redirect" here would stop the guard from ever
tripping — and a failure that names no URL at all is still counted.

Known gap: the failing hop is not guarded either (it has no token of its own),
so a permanently broken redirect chain keeps costing a full timeout.

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
  which is precisely the expensive case worth protecting. Only a failure that
  was actually counted may trip the threshold: a sibling settling after the open
  window elapsed would otherwise start a fresh one off the existing count and
  push the half-open trial past the intended cooldown.
- **A reset invalidates reports already in flight.** `reset()` bumps a per-host
  epoch instead of deleting the record, and a failure reported under an older
  epoch is discarded. Without that, the 30-second stragglers a user was waiting
  behind settle right after they press Retry and re-open the breaker underneath
  the very retry that cleared it.

A half-open trial that never reports back expires after 45 s, so a leaked token
cannot leave the breaker open forever. That expiry is why the slot has an
identity: a trial can genuinely outlive its window — `requestWithValidatedRedirects`
gives each of up to five redirect hops its own 30 s budget — and once a
replacement has been admitted, the abandoned request's late report must not free
the replacement's slot and let a third request through. `trial: true` alone
cannot tell the two apart, so the token carries the slot id it owns; an
abandoned trial's failure is still counted as ordinary evidence.

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

**The endpoint in that sentence is user data, so the marker outranks the
heuristics.** A portal at `https://authorization.example` would otherwise make
its own fast-fail message match the broad auth phrase set and send an
unreachable host into lazy portal repair. `isStalkerAuthFailureMessage` and
`isStalkerProbeTimeout` therefore both return false for a message
`isHostConnectivityFastFailMessage` recognises, before their phrase matching
runs. (`getStalkerRequestErrorStatus` needs no such guard: `HTTP Error <code>`
contains a space, which a hostname cannot.)
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
works. "Success" here means any observed response, including one attached to a
rejection: `validateStatus` lets 4xx through but rejects 5xx with
`error.response` set, and a 5xx proves the origin answered just as well as a
body does. That is why the exempt path reports through
`reportGuardedHostFailure(token, error, { countFailures: false })` rather than
skipping the report.

The flag has to survive the PWA transport too, or discovery is exempt on the
desktop and policed on the web. `PwaService.forwardStalkerRequest` forwards it
as a `/stalker` control param and the route applies the same semantics — and,
like `macAddress`/`token`/`serialNumber`, it is stripped from the query
forwarded to the portal, because it is our control flag and not protocol
content.

## Explicit reset

`CONNECTIVITY_GUARD_RESET` (`{ url }`) is handled by
`apps/electron-backend/src/app/events/connectivity-guard.events.ts`. One key
derivation is enough: both `normalizeXtreamServerUrl` and
`buildStalkerRequestUrl` rebuild their request URL from `URL.origin`, so the
origin a request ends up using is always the origin of the URL stored on the
playlist.

**The rule: every user-driven retry or refresh that issues portal requests must
reset the guard before its first request.** The failures that opened the breaker
are usually the very ones the user is retrying, so a reset placed after the
request — or missing — makes the affordance do nothing until the window expires.
Automatic and first-load paths deliberately do NOT reset: only a user action
means "contact this host now", and clearing evidence the guard just collected
would defeat it.

Call sites:

- `retryContentInitialization` (`with-content.feature.ts`) — the Xtream
  content-gate Retry button. The reset is the **first** awaited statement, before
  the portal status check: a tripped guard fast-fails that check, its
  `unavailable` verdict returns early, and a reset placed any later would never
  run.
- `StalkerPortalDiscoveryService.discover()` — one site covering import, the Edit
  dialog and lazy repair, which also guarantees a freshly edited address never
  inherits a refusal recorded for the previous one.
- `retryContentPage` (`with-stalker-content.feature.ts`) — the Stalker grid
  tail's append retry.
- `StalkerSearchComponent`'s search-page retry — the search results have their
  own append error and retry, separate from the catalog's.
- `StalkerItvCacheService.refresh()` — the Live TV refresh button, on the same
  path that already clears the cache's own error cooldown. This also covers
  `refreshChannels()` in the live layout.
- Both account-info dialogs' Retry buttons (`AccountInfoComponent.reload()` for
  Xtream, `StalkerAccountInfoComponent.reload()` for Stalker). Their automatic
  load on open goes through a private `load()` that does not reset.
- The destructive Xtream refresh — before anything is deleted. It removes the
  cached catalog and then bootstraps a re-import whose status request an open
  guard would fast-fail, leaving the user with no catalog at all until the
  cooldown expires. The reset lives in `XtreamRefreshFlowService.runRefresh()`
  (`libs/playlist/shared/ui`), which owns the whole flow for both of its entry
  points: `PlaylistRefreshActionService.refreshXtream()` and
  `RecentPlaylistsComponent.refreshXtreamPlaylist()` (the Workspace sources
  page). Those two used to be independent near-duplicates, which is exactly why
  the second one was missed first time round; they now differ only in the
  `XtreamRefreshProgressReporter` they hand over, and a reporter cannot reach
  the reset. Keep it that way — a third entry point should pass a reporter, not
  copy the sequence.
- `PortalStatusService.checkPortalStatusDetails` when `skipCache` is set — the
  user-initiated "Test Connection".

Two retry paths deliberately have no reset: Xtream's `retryAppend()` is a no-op
because in-memory appends cannot fail, and the guard's own half-open trial is not
a user action.

Where a retry clears a UI error flag, that flag is cleared **synchronously**
before awaiting the reset — otherwise the retry branch stays re-enterable and
the next `nearEnd` event fires a second retry.

They all go through `resetHostConnectivityGuard()`
(`libs/services/src/lib/host-connectivity-reset.ts`), which holds the one rule
they share: the reset is best effort, because the guard only ever _delays_ a
request and a failed reset must not block the action that asked for it. Both
runtimes honour it, so neither keeps fast-failing an endpoint the user just
asked to retry — in the PWA `PwaService` forwards it to the web backend's
`POST /connectivity-guard/reset`, since the breaker lives in the backend
process and a local reset would clear nothing. That route takes the raw
provider URL rather than a registered `targetId`, because callers reset
precisely when the address may have changed, which is before any target exists
for it; it fetches nothing, reads only the origin, and never logs the URL.

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

- `libs/shared/host-health/src/lib/host-connectivity-guard.spec.ts` — the state
  machine, with an injected clock.
- `apps/electron-backend/src/app/util/host-connectivity-guard.spec.ts` — the
  main-process singleton and redirect attribution through it.
- `apps/web-backend/src/app/web-backend-app.host-guard.spec.ts` — the proxy
  routes: the HTTP 200 refusal shape, that the outbound request really is
  skipped, that an open endpoint is refused before a DNS lookup is spent on it,
  redirect attribution, the discovery exemption, half-open, the reset endpoint,
  and that playlist/EPG downloads are never fast-failed. The per-route timeouts
  are asserted in `web-backend-app.spec.ts`, which pins the whole outbound
  request shape.
- `apps/web/src/app/services/pwa.service.spec.ts` — that a fast-fail reaches the
  renderer with no numeric `status` and no `HTTP Error <code>` in its message,
  that the discovery bypass is forwarded, and that a reset calls the backend.
- `apps/electron-backend/src/app/events/stalker.events.spec.ts` and
  `xtream.events.spec.ts` — trip, fast-fail without contacting axios, reset,
  exemption, and the absence of per-request log spam.
- `libs/portal/stalker/data-access/src/lib/stalker-portal-discovery.utils.spec.ts`
  and `stalker-portal-repair.service.spec.ts` — the message contract.
