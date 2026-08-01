# Stalker/Ministra API Compatibility — Roadmap

Date: 2026-08-01. Source: full audit (codebase map + reference implementations + GitHub issues).
Status legend: [ ] planned · [~] in progress · [x] merged.

## Reference facts (from Stalker 4.9.35 plaintext source `zfix/stalker-portal-4.9.x`, 5.1.1 client JS, Kodi pvr.stalker, stalkerhek)

These are the ground-truth rules a compatible client must follow. Re-verified 2026-08-01; do not re-research unless contradicted.

- Auth failure is **HTTP 200 + text/html body** — exact strings: `Authorization failed.`, `Access denied.`, `Unauthorized request.` Never a 401/403.
- `Cookie: mac=<URL-encoded, UPPERCASE>` required on every request; `Authorization: Bearer <token>` required for everything except `handshake`, `get_profile`, `get_localization`, `do_auth`.
- The **only** identity params the stock server enforces are `device_id`/`device_id2`: first non-empty value is pinned to the MAC forever; mismatch → `{status:1, msg:"device conflict …", block_msg:"Your STB is damaged…"}`. Empty on a fresh MAC is fine; empty after a value was pinned = permanent lockout.
- `signature` is read but never verified (only passed to optional operator `access_filter.php`). `metrics`, `prehash`, `timestamp`, `api_signature` are **never read** by the server.
- `signature` on a real box = `gSTB.GetUID(nonce)` firmware call; 4.9.x signs `access_token`, 5.x signs handshake `random`. Not reproducible client-side; `stalker-to-m3u` fabricates `SHA256(mac)`-based values and works.
- MAC format validation is ON by default: `/^00:1A:79:[0-9A-F]{2}:…$/` (Infomir OUI, uppercase). Failure → bare `{status:1}`.
- `get_profile` `status` decoded: full profile = OK; `1` = blocked (see `msg`/`block_msg`); `2` = login/password required → `do_auth` (params `login,password,device_id,device_id2`; response `{js:true|false}`) then `get_profile` with `auth_second_step=1`.
- Handshake token = random 32 uppercase hex; **idempotent** (re-presenting a valid token returns it) → tokens can be persisted across restarts. Tokens have **no TTL**; they are only invalidated when another device does `get_profile` on the same MAC.
- Watchdog `get_events` expected every **120 s** (`watchdog_timeout` echoed in profile + per-user `timeslot` jitter). Not calling it does NOT invalidate auth (only admin-panel "online" status); calling every 25 s is ~5× too often.
- `create_link` should be called only when the channel row sets `use_http_tmp_link`/`use_load_balancing`; otherwise the static `cmd` plays directly. Temp links live **5 s** (`tv_tmp_link_ttl`), not single-use → resolve immediately before playback, never cache.
- `cmd` format: `<solution> <url>` where solution ∈ {ffrt, ffrt2, ffrt3, ffmpeg, auto…} — strip by splitting on the FIRST space if present; bare URL is legal. Real MAG sends `cmd` **unencoded**.
- `portal.php` does not exist in official Stalker/Ministra — it's a reseller-panel alias. Canonical endpoint derives from `/c/` → `<base>/server/load.php`. Robust discovery: probe `portal.php` → `server/load.php` → `stalker_portal/server/load.php` (→ optionally parse `ajax_loader` out of `/c/xpcom.common.js`).
- Timezone cookie must be a valid PHP timezone or omitted (server does `new DateTimeZone()` on it).
- Response envelope `{js, text}`: ignore `text` (carries `var_dump` noise).

## Audit findings (what's wrong in our code)

1. **0.22 regression (issue #1158):** `requestWithValidatedRedirects` strips `Cookie`/`Authorization` when `nextUrl.origin !== validatedUrl.origin` — scheme/port changes (http→https, :80→:8080) on the SAME host count as cross-origin, so redirected portals lose mac-cookie + token → `Authorization failed.` → no categories, no `create_link`, MPV "won't even launch". Introduced in 2c032cd3c (0.22). File: `apps/electron-backend/src/app/util/validated-axios.ts` (~line 240).
2. Same commit made `cmd` percent-encoded (`encodeURIComponent` + slash restore); real MAG sends it raw → possible double-encoding when portal cmd already contains `%` and strict panels compare strings. Needs verification.
3. Portal mode (`isFullStalkerPortal`) is guessed from URL shape, with TWO diverging predicates (`/stalker_portal/` w/ slash in session svc vs w/o slash at import); simple portals get NO handshake/token/watchdog; `…/c` is rewritten to `portal.php` which official portals don't have; no endpoint probing. Issues #850, #686, #755, #910.
4. Built-in web players receive only User-Agent/Referer/Origin — `request-header-overrides.service.ts` cannot set Cookie/Authorization; token/mac-gated streams can never play in HTML5/Video.js/ArtPlayer/Shaka → the perennial "works only in VLC" cluster (#849, #910, #732).
5. Stalker playback headers built ONLY for ITV (`with-stalker-player.feature.ts:244`); VOD/series/radio go to players with none. Cross-origin streams get `User-Agent: KSPlayer` profile with no cookie/token and it overrides caller headers. Same-origin sets `X-User-Agent` but not `User-Agent`.
6. No `js.status` handling (status 2 → do_auth is dead code, import form login/password commented out), `msg`/`block_msg` never surfaced, only `Authorization failed` string caught (not `Access denied.` / `Unauthorized request.`), `not_valid`/`keep_alive` ignored, persisted `stalkerToken` never reused despite idempotent handshake.
7. No MAC normalization/validation at import; raw string goes into cookie and `sha1(mac.toUpperCase())` prehash.
8. Watchdog interval hardcoded 25 s (should be `watchdog_timeout` from profile, default 120).
9. `create_link` called unconditionally; `use_http_tmp_link`/`use_load_balancing` never checked.
10. PWA path much weaker than Electron: no MAG UA/X-User-Agent, cookie only `mac=`, no `JsHttpRequest=1-xml` injection, `sn` not stripped for non-get_profile, mac+token leak into portal query string, `cmd` slashes become `%2F`.
11. Never-sent profile params: `ver`, `hw_version`, `image_version`, `client_type`; `stb_type` always `''`. Free to send, some `access_filter.php` deployments inspect them.
12. Mock server implements neither `get_profile` nor `get_events`, validates no auth at all; e2e uses `portal.php` → full-portal auth surface has ZERO coverage.
13. Two divergent `cmd` normalizers (`stalker-player-request.utils.ts` strong vs `stream-resolver.service.ts` weak, no base-path resolution).
14. `.claude/skills/stalker-portal/SKILL.md` + `.codex` twin point at deleted `apps/web/src/app/stalker/*` paths.

## PR series (ordered for safety)

### PR 1 — fix(electron): keep auth headers on same-host redirects  [PR #1322 open]
Fixes the #1158 regression. In `validated-axios.ts`, strip `Cookie`/`Authorization`/`Proxy-Authorization` only when the redirect changes **host**, not on scheme/port change of the same host (curl semantics). Regression tests: http→https same host keeps headers; host change strips. Release note required. Branch: `claude/stalker-api-compatibility-7a1ecb` → https://github.com/4gray/iptvnator/pull/1322

### PR 2 — test(stalker): mock-server auth enforcement + e2e for the full-portal surface  [~ in progress, branch claude/stalker-mock-auth-e2e]
Pull coverage FORWARD before risky refactors: mock `get_profile` (validates Bearer, returns profile w/ configurable `status` 0/1/2, `msg`/`block_msg`), `get_events`, token enforcement returning literal `Authorization failed.` (200 text/html!) for missing/invalid Bearer, scenario MACs for device-conflict and status-2. E2E: full-portal import → handshake → get_profile → content → create_link → re-auth after token invalidation. This is the regression safety net for PRs 3–7.

### PR 3 — fix(stalker): verify/fix cmd encoding against reference behavior
Reproduce with a `%`-containing cmd; decide raw-with-safe-charset vs decode-before-encode. Keep the injection protection from 2c032cd3c but avoid double-encoding. Unit tests with real-world cmd corpus (`ffrt3 http://…`, `/media/123.mpg`, tokens with `%3A`).

### PR 4 — feat(stalker): endpoint probing + behavior-based portal mode
Replace URL-shape guessing: probe `portal.php` → `server/load.php` → `stalker_portal/server/load.php` at import (and once at runtime for legacy records); classify full/simple by observed handshake success, persist the resolved endpoint + mode; unify the two predicates. Migration for existing playlists. Fixes #850/#686/#755 class.

### PR 5 — feat(playback): forward Cookie/Authorization to built-in players + headers for VOD/series/radio
Extend `request-header-overrides.service.ts` (scoped per stream origin/URL, cleared on playback end) to set Cookie + Authorization; extract headers in `web-player-view.component.ts`; build Stalker header set for VOD/series/radio, not just ITV; fix same-origin `User-Agent`; revisit KSPlayer cross-origin profile override. Fixes the "only VLC works" cluster (#849/#910/#732 for Stalker).

### PR 6 — feat(stalker): protocol-correct auth lifecycle
- Parse `js.status`: 2 → revive `do_auth` (uncomment import form login/password), then `get_profile` with `auth_second_step=1`.
- Surface `msg`/`block_msg` to the user (import dialog + portal error state).
- Detect all three plain-text bodies (`Authorization failed.`, `Access denied.`, `Unauthorized request.`) at the transport level instead of JSON.stringify regex.
- Reuse persisted `stalkerToken` (handshake is idempotent), propagate `not_valid_token`.
- Watchdog interval from profile `watchdog_timeout` (+`timeslot`), default 120 s instead of 25 s.

### PR 7 — feat(stalker): identity hardening
- MAC normalization (uppercase, colon format) + validation with OUI `00:1A:79` hint in the import UI.
- Optional deterministic device_id derivation (SHA256(mac), opt-in checkbox like StbEmu) with an explanation of the pinning/lockout semantics; never auto-change once set.
- Send the free plausible params: `ver`, `stb_type` (real value), `hw_version`, `image_version`, `client_type`, `num_banks`, `video_out`, `hd`.
- Device-conflict `msg` mapped to a human-readable error.

### PR 8 — fix(stalker): playback link semantics
Respect `use_http_tmp_link`/`use_load_balancing` (static cmd when unset); never cache resolved links (5 s TTL); unify the two cmd normalizers into one shared util.

### PR 9 — fix(pwa): Stalker parity with Electron transport
MAG UA/X-User-Agent, full cookie, `JsHttpRequest=1-xml` injection, strip `sn` for non-get_profile, stop leaking mac/token into the portal query string, slash-preserving cmd encoding in web-backend proxy.

### PR 10 — chore(docs/skills): sync
Update `docs/architecture/stalker-portal.md` (watchdog, endpoint probing, auth lifecycle), fix stale `.claude/skills/stalker-portal/SKILL.md` + `.codex` twin paths, document protocol reference facts.

## Process
- One PR per numbered item; each in its own thread/worktree with this file as the handoff. Update the status legend here as PRs land (and renumber if scope shifts).
- Before opening each PR from a worktree: check `git log origin/master..HEAD` for inherited local commits (known trap).
- Every behavior PR: `.changes/` release note; targeted tests per Regression Prevention policy.

## Related issues
#1158 (0.22 regression, PR 1), #910/#849/#732 (VLC-only cluster, PR 5), #850/#686/#755 (URL/portal-mode, PR 4), #927/#860/#345/#448/#453 (identity fields, PR 7), #1146 (search, mostly shipped via #1209).
