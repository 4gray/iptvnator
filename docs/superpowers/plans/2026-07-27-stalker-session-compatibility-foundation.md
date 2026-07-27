# Stalker Session Compatibility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Electron full-portal Stalker authentication with a main-process, cookie-aware, challenge-driven session runtime; preserve the simple/PWA adapter; add deterministic replay evidence, safe persistence/backup behavior, and regression coverage.

**Architecture:** A pure `portal-stalker-protocol` library owns URL recipes, identity presets, response classification, state transitions, and stable DTO-safe reason codes. Electron main owns endpoint discovery, validated redirects, RFC cookies, credentials, token generations, leases, challenges, refresh, watchdogs, and playback contexts. Angular receives only opaque references and sanitized outcomes; it persists a provisional connection before promoting it. A stateful mock/replay server and Node-only fixture tools provide all authentication evidence without real portals.

**Tech Stack:** Nx, TypeScript, Jest, Angular standalone components/signals, Electron IPC/preload, Node HTTP/HTTPS, `tough-cookie`, Playwright Electron E2E, Zod-compatible runtime validation patterns already used in the repository.

**Design source:** `docs/superpowers/specs/2026-07-27-stalker-session-compatibility-foundation-design.md`

---

## Baseline and execution rules

- [ ] Preserve the pre-existing user changes in:
  - `docs/architecture/stalker-portal.md`
  - `docs/architecture/stalker-authentication-compatibility-audit.md`
- [ ] Keep the existing `STALKER_REQUEST` path for stateless/simple portals and PWA.
- [ ] Do not read or write `stalkerToken` from the new full-session path.
- [ ] Do not expose bearer tokens, handshake randoms, cookie values, credentials, optional device identity, challenge refs, or internal session keys through preload, diagnostics, or logs.
- [ ] Apply strict red-green-refactor for every behavior change: add the closest failing test, run it and confirm the expected failure, implement the minimum behavior, rerun it, then run the affected project target.
- [ ] Treat the existing failure in `apps/electron-backend/src/app/workers/worker-performance-capture.spec.ts` (`eventLoopDelay.maxMs > 10`) as a recorded baseline flake. Do not weaken or modify that unrelated test as part of this work; use targeted Electron suites while implementing and rerun the whole project at final verification.
- [ ] Commit after each task with only that task's files staged.

## Task 1: Create the pure Stalker protocol and shared boundary contracts

**Files:**

- Create: `libs/portal/stalker/protocol/project.json`
- Create: `libs/portal/stalker/protocol/jest.config.ts`
- Create: `libs/portal/stalker/protocol/tsconfig.json`
- Create: `libs/portal/stalker/protocol/tsconfig.lib.json`
- Create: `libs/portal/stalker/protocol/tsconfig.spec.json`
- Create: `libs/portal/stalker/protocol/src/index.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-protocol.constants.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-protocol.types.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-url-recipes.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-response-classifier.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-auth-state-machine.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-identity-profile.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-identity-revision.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-request-policy.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-url-recipes.spec.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-response-classifier.spec.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-auth-state-machine.spec.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-identity-profile.spec.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-identity-revision.spec.ts`
- Create: `libs/portal/stalker/protocol/src/lib/stalker-request-policy.spec.ts`
- Create: `libs/shared/interfaces/src/lib/stalker-session.interface.ts`
- Modify: `libs/shared/interfaces/src/index.ts`
- Modify: `libs/shared/interfaces/src/lib/ipc-commands.ts`
- Modify: `libs/shared/interfaces/src/lib/ipc-command.class.ts`
- Create: `libs/shared/interfaces/src/lib/ipc-command.class.spec.ts`
- Modify: `libs/shared/interfaces/src/lib/electron-api.interface.ts`
- Modify: `libs/shared/interfaces/src/lib/portal-playback.interface.ts`
- Modify: `tsconfig.base.json`
- Modify: `tools/coverage/coverage-policy.json`

- [ ] Add an Nx library named `portal-stalker-protocol` with tags `scope:portal`, `domain:stalker`, and `type:util`, and expose it as `@iptvnator/portal/stalker/protocol`.
- [ ] Define finite exported unions for:
  - request recipes (`full-session`, `stateless-mac`);
  - connection/auth stages;
  - stable failure reasons from the design taxonomy;
  - normalized profile results;
  - auth transition events/states;
  - identity preset and override inputs;
  - request operation names and reserved parameter names.
- [ ] Add DTOs for `STALKER_SESSION_OPEN`, `STALKER_SESSION_CONTINUE`, `STALKER_SESSION_REQUEST`, and `STALKER_SESSION_CONTROL` to `@iptvnator/shared/interfaces`. Use discriminated outcomes and opaque string refs; do not include token/cookie/header-secret fields.
- [ ] Write failing URL-recipe tests for direct `portal.php`, direct `server/load.php`, root, `/c/`, custom-prefix `/c/`, same-directory document/directory, duplicate removal, six-candidate cap, fragment stripping, embedded user-info rejection, and credential/auth query-key rejection.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test portal-stalker-protocol --testFile=stalker-url-recipes.spec.ts
  ```

  Confirm failure because the recipe module does not exist.

- [ ] Implement deterministic source normalization and versioned candidate derivation. Landing query data must never be copied into derived API candidates.
- [ ] Write failing response-classifier tests for:
  - numeric/string profile statuses `0`, `1`, and `2`;
  - recognized status-less profile success;
  - unknown status and unsupported envelopes;
  - exact `do_auth` `js === true`, explicit `js === false`, and near misses `1`/`"true"`;
  - exact token rejection versus access denial/WAF/ambiguous `403`;
  - JSON, allowlisted JSONP, missing/plain compatibility sniffing, HTML rejection, and response-size failure.
- [ ] Implement bounded media/body classification without network or platform dependencies.
- [ ] Write failing auth-state tests proving:
  - first profile uses step `0`;
  - `do_auth` is legal only after status `2`;
  - second profile is legal only after canonical `do_auth` success and uses step `1`;
  - ready cannot be reached from `do_auth` alone;
  - three explicit credential rejections produce the attempt limit;
  - transport/protection failures remain distinct.
- [ ] Implement the pure transition reducer.
- [ ] Write failing identity tests for `mag250-public-5_1-minimal-v1`, exact `X-User-Agent`, omitted blank native fields, explicit unchanged overrides, normalized locale/language/timezone, conditional metrics fields, exact MAC normalization, length-prefixed UTF-8 principal input, and stable identity-revision serialization.
- [ ] Implement the profile preset and canonical revision serializer. Do not derive serial/device IDs/signatures/prehash/Cloudflare cookies.
- [ ] Write failing request-policy tests rejecting handshake/profile/do-auth actions, reserved auth/query parameters, managed cookies/headers, and raw authorization overrides from application operations.
- [ ] Implement the allowlist/reserved-parameter validator.
- [ ] Extend `libs/shared/interfaces/src/lib/ipc-command.class.spec.ts` and the existing interface compile checks so every new IPC command has one request/response type.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test portal-stalker-protocol
  NX_TUI=false pnpm nx test shared-interfaces
  NX_TUI=false pnpm nx lint portal-stalker-protocol
  NX_TUI=false pnpm nx lint shared-interfaces
  ```

- [ ] Commit:

  ```bash
  git add libs/portal/stalker/protocol libs/shared/interfaces tsconfig.base.json tools/coverage/coverage-policy.json
  git commit -m "feat(stalker): add pure session protocol contracts"
  ```

## Task 2: Add deterministic replay fixtures and capture-safety tools

**Files:**

- Create: `apps/stalker-mock-server/src/app.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay.constants.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay.types.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-schema.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-symbols.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-request-matcher.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-response.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-run.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-server.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-control-plane.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-schema.spec.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-run.spec.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-server.spec.ts`
- Create: `apps/stalker-mock-server/src/app/replay/replay-control-plane.spec.ts`
- Create: `apps/stalker-mock-server/fixtures/replay/resolver/*.json`
- Create: `apps/stalker-mock-server/fixtures/replay/redirects/*.json`
- Create: `apps/stalker-mock-server/fixtures/replay/authentication/*.json`
- Create: `apps/stalker-mock-server/fixtures/replay/classifiers/*.json`
- Create: `apps/stalker-mock-server/fixtures/replay/cookies/*.json`
- Create: `apps/stalker-mock-server/fixtures/replay/refresh/*.json`
- Modify: `apps/stalker-mock-server/src/main.ts`
- Modify: `apps/stalker-mock-server/project.json`
- Modify: `apps/stalker-mock-server/README.md`
- Create: `tools/stalker-fixtures/project.json`
- Create: `tools/stalker-fixtures/jest.config.ts`
- Create: `tools/stalker-fixtures/tsconfig.json`
- Create: `tools/stalker-fixtures/tsconfig.lib.json`
- Create: `tools/stalker-fixtures/tsconfig.spec.json`
- Create: `tools/stalker-fixtures/src/index.ts`
- Create: `tools/stalker-fixtures/src/lib/fixture-secret-scanner.ts`
- Create: `tools/stalker-fixtures/src/lib/fixture-validator.ts`
- Create: `tools/stalker-fixtures/src/lib/har-reader.ts`
- Create: `tools/stalker-fixtures/src/lib/har-to-draft.ts`
- Create: `tools/stalker-fixtures/src/lib/safe-output.ts`
- Create: `tools/stalker-fixtures/src/lib/fixture-secret-scanner.spec.ts`
- Create: `tools/stalker-fixtures/src/lib/fixture-validator.spec.ts`
- Create: `tools/stalker-fixtures/src/lib/har-to-draft.spec.ts`
- Create: `tools/stalker-fixtures/src/cli.ts`
- Modify: `tools/coverage/coverage-policy.json`
- Modify: `nx.json`
- Modify: `package.json`

- [ ] Refactor the mock server to export an application factory without executing the CLI entry point on import. Keep existing catalog scenarios working.
- [ ] Enable a Jest test target on `stalker-mock-server` and classify it in coverage policy.
- [ ] Write failing schema tests for:
  - the response union (`empty`, `json`, `jsonp`, `text`, `generated`);
  - lower-case header keys with array values;
  - request bodies (`absent`, `json`, `form`, `text`);
  - typed `generate`, `ref`, and literal/ref `parts`;
  - named origins, phases, cardinality, barriers, terminal state;
  - 1 MiB fixture, 128-phase, 512-expectation/request, 16 MiB generated-body, ten-minute lifetime, and two-minute inactivity caps.
- [ ] Implement strict fixture validation and constants shared by runtime and tests.
- [ ] Write failing run tests for symbol isolation, exact references, no free-form interpolation, request-body matching, cookie attributes, unexpected requests, unmet cardinality, blocked barriers, nonterminal finalization, run disposal, and sanitized ledgers.
- [ ] Implement isolated replay runs with generated locally administered MACs, safe credentials/tokens/cookies, per-run state, deterministic barriers, and secret-free ledger entries.
- [ ] Write failing server tests for multiple loopback listeners, distinct origins, relative redirects, ephemeral ports, application factory lifecycle, and run isolation.
- [ ] Implement the replay listeners.
- [ ] Write failing control-plane tests for loopback binding, exact Host validation, no CORS, 64 KiB control-body cap, repository fixture allowlist, and process-local capability on create/finalize/dispose.
- [ ] Implement the E2E control plane.
- [ ] Add the Stage 1 fixtures needed by Tasks 3–9, grouped by resolver, cross-origin security, authentication, classifier near misses, cookies/identity, and refresh/errors. Each fixture must finalize with exact cardinality.
- [ ] Add the Node-only Nx tool project `stalker-fixture-tools` with tags `scope:tools`, `domain:stalker`, and `type:tool`.
- [ ] Write failing scanner/validator tests for raw, URL-encoded, double-encoded, JSON-escaped, JWT, MAC, cookie, credential, account ID, stream/artwork URL, high-entropy, unknown-origin, oversized, invalid-schema, and nondeterministic timestamp evidence.
- [ ] Implement the fail-closed scanner and deterministic formatter.
- [ ] Write failing HAR converter tests for:
  - no-follow input checks;
  - symlink/non-regular rejection;
  - rejecting input whose real path is in any repository worktree;
  - raw/decoded/nesting/collection/string limits;
  - strict base64;
  - structural redaction into typed symbols;
  - in-memory final validation;
  - exclusive regular temp output plus atomic rename;
  - stable sanitized error codes.
- [ ] Implement the bounded HAR reader/converter and safe output writer.
- [ ] Add Nx inputs so any change under `apps/stalker-mock-server/fixtures/**/*.json` invalidates replay validation/test cache.
- [ ] Add package scripts for fixture validation and draft conversion without importing the tool into runtime bundles.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test stalker-mock-server
  NX_TUI=false pnpm nx test stalker-fixture-tools
  NX_TUI=false pnpm nx lint stalker-mock-server
  NX_TUI=false pnpm nx lint stalker-fixture-tools
  ```

- [ ] Commit:

  ```bash
  git add apps/stalker-mock-server tools/stalker-fixtures tools/coverage/coverage-policy.json nx.json package.json pnpm-lock.yaml
  git commit -m "test(stalker): add stateful authentication replay"
  ```

## Task 3: Build the validated Electron HTTP session, cookie jar, and endpoint resolver

**Files:**

- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-session.types.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-runtime-validation.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-cookie-jar.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-cookie-jar.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-http-session.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-http-session.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-endpoint-resolver.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-endpoint-resolver.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-transport-errors.spec.ts`
- Modify: `apps/electron-backend/src/app/util/validated-axios.ts`
- Modify: `apps/electron-backend/src/app/util/validated-axios.spec.ts`
- Modify: `apps/electron-backend/project.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Add `tough-cookie` as a direct production dependency used by Electron main.
- [ ] Preserve the existing DNS-pinned agents, SSRF checks, finite timeout, per-hop URL validation, cross-origin body-replay block, and five-hop ceiling in `validated-axios`; add backward-compatible per-hop hooks only for cookie preparation/collection, repeated-target detection, and pausing identity-bearing cross-origin redirects.
- [ ] Write failing cookie tests for:
  - Domain, Path, Secure, HttpOnly, expiry, duplicate names, redirect-hop mutation, and fake-clock expiry;
  - public-suffix rejection;
  - managed `mac`, `stb_lang`, and `timezone` values;
  - discarding every server `Set-Cookie` mutation for a managed name, including narrower Domain/Path shadow attempts;
  - no cookie serialization through DTOs.
- [ ] Implement the RFC-aware jar adapter and managed-cookie materialization.
- [ ] Write failing HTTP-session tests proving:
  - the jar is consulted and mutated on every validated hop;
  - authorization, cookies, MAC/device fields, X-User-Agent, SN, Origin, Referer, and credentials are stripped before cross-origin redirects;
  - target user-info and auth-query URLs are rejected;
  - identity-bearing cross-origin redirects return a pause outcome and do not contact the target with identity;
  - response caps are enforced before parsing;
  - DNS/network/timeout/TLS errors map to stable reasons.
- [ ] Implement the HTTP session manually on top of the validated redirect helper. Do not add `axios-cookiejar-support`.
- [ ] Write failing resolver tests against in-process replay runs for:
  - anonymous landing;
  - source/final origin approval;
  - isolated candidate jars;
  - candidate ordering and six-candidate cap;
  - handshake plus first-profile atomic promotion;
  - early stateless evidence followed by later full-session success;
  - downgrade forbidden after auth/protection/transport failure;
  - one learned-endpoint rediscovery;
  - failed-candidate jar poisoning prevention.
- [ ] Implement bounded sequential discovery. The landing request must contain no identity, credential, bearer, device, or managed-cookie values. The winning temporary jar, handshake token/random, and first profile are promoted without repeating either request.
- [ ] Add runtime input validation for source URLs, MAC, identity-field bounds, and non-secret transport configuration.
- [ ] Run targeted red/green suites:

  ```bash
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-cookie-jar.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-http-session.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-endpoint-resolver.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=validated-axios.spec.ts
  ```

- [ ] Run `NX_TUI=false pnpm nx lint electron-backend`.
- [ ] Commit:

  ```bash
  git add apps/electron-backend/src/app/services/stalker-session apps/electron-backend/src/app/util/validated-axios.ts apps/electron-backend/src/app/util/validated-axios.spec.ts apps/electron-backend/project.json package.json pnpm-lock.yaml
  git commit -m "feat(stalker): add validated cookie-aware portal transport"
  ```

## Task 4: Implement authentication, leases, coordinator, refresh, and watchdog

**Files:**

- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-challenge-registry.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-challenge-registry.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-auth-session.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-auth-session.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-base-identity-coordinator.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-base-identity-coordinator.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-watchdog.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-watchdog.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-session-manager.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-session-manager.spec.ts`
- Create: `apps/electron-backend/src/app/services/stalker-session/stalker-session-manager.boundary.spec.ts`

- [ ] Write failing fake-clock registry tests proving origin/credential challenges are cryptographically opaque, sender-bound, attempt-bound, single-use, two-minute expiry, and invalid after attempt termination.
- [ ] Implement the challenge registry. Refs must never be logged.
- [ ] Write failing auth tests over replay fixtures for:
  - handshake with/without random;
  - first profile step `0`;
  - status `0`, `1`, `2`, and recognized status-less success;
  - `do_auth` only after status `2`;
  - exact `js === true`;
  - second profile step `1`;
  - rejected saved credentials followed by fresh successful credentials;
  - three-submission limit;
  - transport/WAF/rate-limit during `do_auth`;
  - no token persistence despite `store_auth_data_on_stb`.
- [ ] Implement the auth executor using one identity revision and one jar through the complete trusted attempt. Retain accepted credentials only in memory for same-principal refresh.
- [ ] Write failing coordinator tests for:
  - keying by approved origin plus normalized MAC;
  - concurrent readers on the active epoch;
  - exclusive handshake/refresh/principal switch/provisional auth;
  - two usernames remaining isolated;
  - alternating principals without interleaved token generations;
  - suspension of stale epochs;
  - monotonic mutation epochs.
- [ ] Implement the read/write gate and active-principal ownership.
- [ ] Write failing session-manager tests for:
  - canonical session key (endpoint + MAC + identity revision + confirmed principal);
  - provisional attempts never joining ready sessions before `commit`;
  - separate sender-bound leases for matching rows;
  - same-principal commit collision atomically transferring existing leases;
  - stale provisional promotion revalidation;
  - failed provisional edit restoring/revalidating the previous ready session;
  - activate/deactivate/close/discard/idempotent commit;
  - renderer destruction, playlist deletion, and shutdown cleanup;
  - one operation budget for rediscovery, refresh, and retry;
  - one single-flight refresh for concurrent failures;
  - immutable-principal refresh and `principal-transition-required`;
  - no recursive refresh and terminal `auth-refresh-exhausted`.
- [ ] Implement the session manager and generation-aware request pipeline. The renderer must never provide reserved auth parameters.
- [ ] Write failing watchdog tests for profile-derived interval parsing, min/max clamp, jitter, conservative default, activation, last-lease deactivation, wire-active principal ownership, joining in-flight refresh, and cleanup.
- [ ] Implement the fake-clock-injectable watchdog.
- [ ] Add boundary tests recursively scanning every open/continue/request/control outcome for forbidden token/random/cookie/credential/device-identity values.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-challenge-registry.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-auth-session.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-base-identity-coordinator.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-session-manager.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-session-manager.boundary.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-watchdog.spec.ts
  ```

- [ ] Commit:

  ```bash
  git add apps/electron-backend/src/app/services/stalker-session
  git commit -m "feat(stalker): manage authenticated portal sessions in main"
  ```

## Task 5: Wire typed IPC/preload and main-owned playback contexts

**Files:**

- Create: `apps/electron-backend/src/app/events/stalker-session.events.ts`
- Create: `apps/electron-backend/src/app/events/stalker-session.events.spec.ts`
- Modify: `apps/electron-backend/src/app/events/stalker.events.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.spec-data.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.spec.ts`
- Modify: `apps/electron-backend/src/app/services/stalker-playback-context.service.ts`
- Modify: `apps/electron-backend/src/app/services/stalker-playback-context.service.spec.ts`
- Modify: `apps/electron-backend/src/main.ts`
- Modify: `apps/electron-backend/src/app/events/player.events.ts`
- Modify: `apps/electron-backend/src/app/events/player.events.spec.ts`
- Modify: `apps/electron-backend/src/app/events/external-player-playback-request.ts`
- Modify: `apps/electron-backend/src/app/events/embedded-mpv.events.ts`
- Modify: `apps/electron-backend/src/app/events/embedded-mpv.events.spec.ts`
- Modify: `apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`

- [ ] Write failing IPC tests that reject malformed descriptors, invalid control commands, unknown application operations, reserved parameters/actions/headers, foreign-renderer refs, expired refs, and raw secret fields.
- [ ] Implement `STALKER_SESSION_OPEN`, `CONTINUE`, `REQUEST`, and `CONTROL` handlers with sender binding and sanitized error translation. Preserve legacy `STALKER_REQUEST`.
- [ ] Bootstrap the injected session handlers from `apps/electron-backend/src/main.ts`, attach renderer cleanup once through `event.sender.once('destroyed', ...)`, and destroy all session state during `before-quit`.
- [ ] Write failing preload contract tests for the four new typed methods and assert no generic raw full-auth request surface is added.
- [ ] Expose only typed operations through preload.
- [ ] Extend playback-context tests to prove a context is bound to sender, lease, session key, auth generation, coordinator epoch, and exact normalized stream URL; is single-purpose; expires after two minutes; and is invalidated by refresh, lease close, endpoint/identity change, renderer destruction, and base-principal switch.
- [ ] Move full-session `create_link` header ownership into main. Return only the stream URL, safe metadata, and an opaque playback context reference.
- [ ] Integrate the existing external MPV/VLC and Embedded MPV main-process launch paths so they consume the opaque context and never return resolved secret headers to the renderer.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-session.events.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=main.preload.spec.ts
  NX_TUI=false pnpm nx test electron-backend --testFile=stalker-playback-context.service.spec.ts
  ```

- [ ] Commit:

  ```bash
  git add apps/electron-backend/src/app/events apps/electron-backend/src/app/api/main.preload.ts apps/electron-backend/src/app/api/main.preload.spec-data.ts apps/electron-backend/src/app/api/main.preload.spec.ts apps/electron-backend/src/app/services/stalker-playback-context.service.ts apps/electron-backend/src/app/services/stalker-playback-context.service.spec.ts
  git commit -m "feat(stalker): expose opaque session IPC and playback contexts"
  ```

## Task 6: Cut full-portal data access over to opaque leases

**Files:**

- Modify: `libs/portal/stalker/data-access/src/lib/stalker-session.service.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stalker-session.service.spec.ts`
- Create: `libs/portal/stalker/data-access/src/lib/stalker-session-descriptor.ts`
- Create: `libs/portal/stalker/data-access/src/lib/stalker-session-descriptor.spec.ts`
- Create: `libs/portal/stalker/data-access/src/lib/stalker-request-adapter.ts`
- Create: `libs/portal/stalker/data-access/src/lib/stalker-request-adapter.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/utils/stalker-request.utils.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/utils/stalker-request.utils.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/utils/stalker-player-request.utils.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/utils/stalker-player-request.utils.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-portal.feature.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-content.feature.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-snapshot-refresh.feature.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-player.feature.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stalker-itv-channel-loader.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stalker-live-playback.utils.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stalker-live-playback.utils.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-portal.feature.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-content.feature.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-snapshot-refresh.feature.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-player.feature.spec.ts`
- Modify: `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.ts`
- Modify: `libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.spec.ts`
- Modify: `apps/web/src/app/services/player.service.ts`
- Modify: `libs/portal/stalker/data-access/src/index.ts`

- [ ] Write failing descriptor tests mapping legacy/new playlist records into source URL, learned endpoint hint, normalized MAC, profile preset/overrides, credentials, and persisted/provisional mode without using `stalkerToken`.
- [ ] Implement the descriptor mapper and lazy source fallback order: `stalkerSourceUrl`, then `portalUrl`, then legacy `url`.
- [ ] Rewrite `StalkerSessionService` tests around outcomes and opaque refs. Assert it has no token cache, handshake random, timers, cookie construction, raw full-auth methods, or `getCachedToken()`.
- [ ] Implement the thin facade:
  - Electron full-session calls the four typed preload methods;
  - explicit simple/stateless and PWA retain the existing adapter;
  - activate/deactivate/commit/discard/close/force-redetect route through control;
  - full-session request operations pass only operation-specific non-reserved parameters.
- [ ] Write failing adapter tests proving every full catalog/search/detail/EPG/create-link operation maps to a typed application operation while stateless/PWA requests remain byte-compatible.
- [ ] Update all provider features to use the adapter/facade. Remove renderer bearer/header/cookie synthesis and `getCachedToken()` from playback.
- [ ] Update every listed feature/stream/search spec to cover full-session lease routing and simple/PWA preservation.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test portal-stalker-data-access
  NX_TUI=false pnpm nx test portal-shared-data-access
  NX_TUI=false pnpm nx test portal-stalker-feature --testFile=stalker-search.component.spec.ts
  NX_TUI=false pnpm nx lint portal-stalker-data-access
  NX_TUI=false pnpm nx lint portal-shared-data-access
  NX_TUI=false pnpm nx test web --testFile=stalker
  ```

- [ ] Verify:

  ```bash
  rg -n "getCachedToken|stalkerToken|Authorization.*Bearer|__cfduid" libs/portal/stalker libs/playlist/import apps/web
  ```

  The new full-session renderer path must contain no token/cookie construction; any remaining legacy field references must be migration/removal tests or explicitly simple/PWA compatibility code.

- [ ] Commit:

  ```bash
  git add libs/portal/stalker/data-access libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.ts libs/portal/shared/data-access/src/lib/collection/stream-resolver.service.spec.ts libs/portal/stalker/feature/src/lib/stalker-search apps/web/src/app/services/player.service.ts
  git commit -m "refactor(stalker): route full portals through session leases"
  ```

## Task 7: Implement import, route reconnection, and atomic persistence UX

**Files:**

- Modify: `libs/shared/interfaces/src/lib/playlist.interface.ts`
- Modify: `libs/shared/interfaces/src/lib/playlist-meta.type.ts`
- Modify: `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.ts`
- Modify: `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.html`
- Modify: `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.scss`
- Modify: `libs/playlist/import/feature/src/lib/stalker-portal-import/stalker-portal-import.component.spec.ts`
- Modify: `libs/playlist/import/feature/src/lib/add-playlist-dialog/add-playlist-dialog.component.html`
- Modify: `libs/playlist/import/feature/src/lib/add-playlist-dialog/add-playlist-dialog.component.ts`
- Modify: `libs/playlist/import/feature/src/lib/add-playlist-dialog/add-playlist-dialog.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-workspace-route-session.service.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-workspace-route-session.service.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-collection-detail.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-collection-detail.component.spec.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-connection-flow/stalker-origin-approval-dialog.component.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-connection-flow/stalker-credentials-dialog.component.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-connection-flow/stalker-connection-flow.service.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-connection-flow/stalker-connection-flow.service.spec.ts`
- Modify: `libs/portal/stalker/feature/src/index.ts`
- Modify: `libs/services/src/lib/playlists.service.ts`
- Modify: `libs/services/src/lib/playlists.service.spec.ts`
- Modify: `libs/m3u-state/src/lib/reducers/playlist.reducers.ts`
- Modify: `libs/m3u-state/src/lib/reducers/playlist.reducers.spec.ts`
- Modify: `libs/m3u-state/src/lib/effects.ts`
- Modify: `libs/m3u-state/src/lib/effects.spec.ts`

- [ ] Add backward-compatible playlist fields:
  - `stalkerSourceUrl`;
  - `stalkerLandingUrl`;
  - `stalkerRequestRecipe`;
  - `stalkerRecipeClassifierVersion`;
  - profile preset ID/version;
  - explicit profile/transport overrides;
  - last verified timestamp.
- [ ] Keep `portalUrl` and derived `isFullStalkerPortal` for compatibility. Do not persist tokens, randoms, cookies, leases, challenges, or playback contexts.
- [ ] Write failing import tests for all progress stages, exact cross-origin display/approval, collapsed credential disclosure after status `2`, masked password/reveal, advanced identity section, saved-credential automatic continuation, failed replacement preserving old credentials, explicit values forwarded unchanged, and blank optional fields omitted.
- [ ] Implement the import state machine. Keep form values and safe attempt context after failure.
- [ ] Write failing persistence tests proving:
  - no row is saved before network ready;
  - the full playlist draft is written atomically before `commit`;
  - successful commit is required before Connected;
  - failed writes retain the provisional attempt for Save Again;
  - cancel/navigation/expiry calls `discard`;
  - failed connection leaves existing data unchanged;
  - successful lazy upgrade writes learned fields and removes `stalkerToken`.
- [ ] Add a serialized, awaitable playlist add/patch boundary that can explicitly remove `stalkerToken`; reflect confirmed persistence through the reducer/effect before session commit.
- [ ] Implement save/commit/discard with the two-minute provisional lifetime and idempotent promotion handling.
- [ ] Write failing route-level flow tests for first-open lazy classification, origin and credential dialogs, saved-credential rejection, one request reissue after reconnect, cancellation/navigation cleanup, persistence retry, force-redetect, and `principal-transition-required`.
- [ ] Implement UI-free data access plus route-owned dialogs/flow.
- [ ] Ensure explicitly simple legacy records stay simple unless Test Connection/edit/endpoint-shape failure requests reclassification; full/ambiguous legacy Electron records classify lazily; PWA stays unchanged.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test playlist-import-feature
  NX_TUI=false pnpm nx test portal-stalker-feature
  NX_TUI=false pnpm nx test shared-interfaces
  NX_TUI=false pnpm nx test services
  NX_TUI=false pnpm nx test m3u-state
  NX_TUI=false pnpm nx lint playlist-import-feature
  NX_TUI=false pnpm nx lint portal-stalker-feature
  NX_TUI=false pnpm nx lint services
  NX_TUI=false pnpm nx lint m3u-state
  ```

- [ ] Commit:

  ```bash
  git add libs/shared/interfaces/src/lib/playlist.interface.ts libs/shared/interfaces/src/lib/playlist-meta.type.ts libs/playlist/import/feature libs/portal/stalker/feature libs/services/src/lib/playlists.service.ts libs/services/src/lib/playlists.service.spec.ts libs/m3u-state/src/lib/reducers/playlist.reducers.ts libs/m3u-state/src/lib/reducers/playlist.reducers.spec.ts libs/m3u-state/src/lib/effects.ts libs/m3u-state/src/lib/effects.spec.ts
  git commit -m "feat(stalker): add challenge-driven connection flow"
  ```

## Task 8: Make backup secret exclusion explicit and restore redacted providers safely

**Files:**

- Modify: `libs/shared/interfaces/src/lib/playlist-backup.interface.ts`
- Modify: `libs/services/src/lib/playlist-backup.service.ts`
- Modify: `libs/services/src/lib/playlist-backup.service.spec.ts`
- Modify: `libs/services/src/lib/playlist-backup.service.roundtrip.spec.ts`
- Modify: `libs/services/src/lib/playlist-backup.service.xtream-restore.spec.ts`
- Create: `libs/services/src/lib/playlist-backup.service.stalker-restore.spec.ts`
- Modify: `libs/services/src/lib/playlist-backup.service.test-helpers.ts`
- Modify: `apps/web/src/app/settings/settings-backup.facade.ts`
- Modify: `apps/web/src/app/settings/settings-backup-section.component.ts`
- Modify: `apps/web/src/app/settings/settings-backup-section.component.html`
- Create: `apps/web/src/app/settings/settings-backup-credentials-dialog.component.ts`
- Create: `apps/web/src/app/settings/settings-backup-credentials-dialog.component.html`
- Create: `apps/web/src/app/settings/settings-backup-credentials-dialog.component.scss`
- Create: `apps/web/src/app/settings/settings-backup-credentials-dialog.component.spec.ts`
- Modify: `apps/web/src/app/settings/settings.component.spec.ts`
- Modify: `apps/web/src/assets/i18n/*.json`

- [ ] Keep manifest version `1` and add optional fields backward-compatibly.
- [ ] Write failing schema/service tests proving default `includeSecrets=false`:
  - structured Xtream/Stalker login/password are omitted;
  - explicit serial/device IDs/signatures/prehash/native hash/custom firmware tuple are omitted;
  - Xtream emits `{ credentialsOmitted: true }` with neither username nor password;
  - Stalker retains source URL, MAC, preset, non-secret transport/profile overrides, compatibility fields, and portable user state;
  - learned runtime state is not authoritative backup data;
  - a manifest declaring `includeSecrets=false` while containing gated fields is rejected.
- [ ] Implement export validation and writing.
- [ ] Write failing include-secret tests proving structured credentials and explicit device identity are present only after opt-in, while blank explicit fields retain patch semantics.
- [ ] Implement opt-in export.
- [ ] Write failing restore tests for:
  - old version-1 compatibility;
  - duplicate/non-empty `exportedId` enforcement;
  - patch-style present/empty/omitted rules;
  - exact Stalker matching by source/MAC/profile/identity/username;
  - ambiguous legacy `portalUrl + MAC` creating a separate row;
  - redacted Stalker preserving local credentials only on exact exportedId/source/MAC/profile match;
  - otherwise creating a credential-less Stalker row that later uses normal status `2`;
  - redacted Xtream exact-match preservation;
  - unmatched redacted Xtream becoming an in-memory pending item;
  - validated credentials before creation;
  - skip reporting without creating an unusable row.
- [ ] Implement safe merge/pending-credential behavior.
- [ ] Write failing web tests for the off-by-default checkbox, precise residual-sensitivity warning (MACs, hosts/source URLs, private raw M3U URLs), explicit inclusion, redacted Xtream prompt, validation, and skip result.
- [ ] Implement the settings/facade UI without rewriting raw M3U content.
- [ ] Add identical translation keys to all locale files and validate locale-key parity.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx test services
  NX_TUI=false pnpm nx test web --testFile=settings
  NX_TUI=false pnpm nx lint services
  NX_TUI=false pnpm nx lint web
  pnpm run i18n:check
  ```

- [ ] Commit:

  ```bash
  git add libs/shared/interfaces/src/lib/playlist-backup.interface.ts libs/services apps/web/src/app/settings apps/web/src/assets/i18n
  git commit -m "feat(backup): gate portal credentials and device identity"
  ```

## Task 9: Add atomized Electron E2E over replay and preserve provider regressions

**Files:**

- Create: `apps/electron-backend-e2e/src/stalker-auth.e2e.ts`
- Modify: `apps/electron-backend-e2e/src/backup-roundtrip.e2e.ts`
- Modify: `apps/electron-backend-e2e/src/providers.e2e.ts` only where fixture setup must be shared
- Create: `apps/electron-backend-e2e/src/support/stalker-replay.ts`
- Modify: the Electron E2E fixture/startup helpers under `apps/electron-backend-e2e/src/support/`
- Modify: `apps/electron-backend-e2e/project.json` only if an inferred atomized target needs explicit inputs

- [ ] Add a replay harness that starts the control plane with an unexposed process-local capability, creates allowlisted runs, returns only the synthetic portal URL/identity to the app, and always finalizes/disposes in `finally`.
- [ ] Write the first failing atomized E2E for root/custom-path discovery, status `2`, credential continuation, cookie rotation, successful second profile, catalog request, `create_link`, and playback-context registration.
- [ ] Implement only integration defects uncovered by that E2E; keep production logic in the owning projects.
- [ ] Add a concurrent rejection E2E proving one refresh generation, exact one retry per original operation, cookie/session isolation, and successful finalization ledger.
- [ ] Add a legacy full-portal first-open E2E proving route credential flow, atomic persistence, promotion, removal of `stalkerToken`, and reopen through the persisted recipe.
- [ ] Extend backup roundtrip E2E for default exclusion, explicit inclusion, residual warning, redacted Xtream prompt/skip, and patch-style restore.
- [ ] Run:

  ```bash
  NX_TUI=false pnpm nx run electron-backend-e2e:e2e-ci--src/stalker-auth.e2e.ts
  NX_TUI=false pnpm nx run electron-backend-e2e:e2e-ci--src/backup-roundtrip.e2e.ts
  NX_TUI=false pnpm nx run electron-backend-e2e:e2e-ci--src/providers.e2e.ts
  NX_TUI=false pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts
  ```

- [ ] Commit:

  ```bash
  git add apps/electron-backend-e2e
  git commit -m "test(stalker): cover authenticated Electron sessions"
  ```

## Task 10: Redaction, canonical docs, release note, full review, and verification

**Files:**

- Modify: the Stalker-related redaction files/specs under `libs/shared/logging/`
- Modify: `docs/architecture/stalker-portal.md`
- Modify: `docs/architecture/playlist-backup-restore.md`
- Modify: `CLAUDE.md`
- Modify: `.codex/skills/stalker-portal/SKILL.md`
- Modify: `AGENTS.md` only if an ownership/process statement changed
- Create: `.changes/stalker-session-compatibility.md`

- [ ] Add failing shared-logging tests with representative session descriptors, outcomes, failures, diagnostics, nested request payloads, URL query secrets, and refs. Assert MAC, credentials, tokens, randoms, cookies, serial/device/signature values, and opaque refs are redacted.
- [ ] Implement the minimum redaction rules and route all new diagnostics through the existing redacting logger.
- [ ] Reconcile the pre-existing edits in `docs/architecture/stalker-portal.md` and `docs/architecture/stalker-authentication-compatibility-audit.md` with the final implementation without discarding the user's work.
- [ ] Update canonical docs to describe main-process ownership, recipe classification, challenges, persistence fields, simple/PWA compatibility, backup secret policy, replay maintenance, and validation commands.
- [ ] Update `CLAUDE.md` where Stalker/preload/persistence/backup descriptions changed.
- [ ] Update `.codex/skills/stalker-portal/SKILL.md` so future agents preserve the session boundary and test checklist.
- [ ] Add a user-facing release note under `.changes/`, at most 400 characters.
- [ ] Run the fail-closed committed fixture validator and release-note validator:

  ```bash
  NX_TUI=false pnpm nx test stalker-fixture-tools
  pnpm run coverage:policy:check
  pnpm run i18n:check
  pnpm run release:notes:validate
  ```

- [ ] Run targeted project tests:

  ```bash
  NX_TUI=false pnpm nx test portal-stalker-protocol
  NX_TUI=false pnpm nx test stalker-mock-server
  NX_TUI=false pnpm nx test portal-stalker-data-access
  NX_TUI=false pnpm nx test portal-stalker-feature
  NX_TUI=false pnpm nx test playlist-import-feature
  NX_TUI=false pnpm nx test services
  NX_TUI=false pnpm nx test web
  NX_TUI=false pnpm nx test shared-logging
  NX_TUI=false pnpm nx test electron-backend
  ```

- [ ] If the unrelated worker performance assertion flakes again, rerun `worker-performance-capture.spec.ts` alone and report both results. Do not claim a green full Electron target unless the rerun or full target is genuinely green.
- [ ] Run atomized E2E:

  ```bash
  NX_TUI=false pnpm nx run electron-backend-e2e:e2e-ci--src/stalker-auth.e2e.ts
  NX_TUI=false pnpm nx run electron-backend-e2e:e2e-ci--src/backup-roundtrip.e2e.ts
  NX_TUI=false pnpm nx run electron-backend-e2e:e2e-ci--src/providers.e2e.ts
  NX_TUI=false pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts
  ```

- [ ] Run affected lint:

  ```bash
  NX_TUI=false pnpm nx run-many -t lint -p portal-stalker-protocol,stalker-fixture-tools,stalker-mock-server,electron-backend,portal-stalker-data-access,portal-stalker-feature,playlist-import-feature,services,shared-interfaces,shared-logging,web,electron-backend-e2e,web-e2e --parallel=3
  ```

- [ ] Run affected builds/type checks using the exact discovered Nx targets:

  ```bash
  pnpm nx show project electron-backend
  pnpm nx show project web
  NX_TUI=false pnpm nx build electron-backend
  NX_TUI=false pnpm nx build web
  ```

- [ ] Scan the diff and tracked files:

  ```bash
  git diff --check
  rg -n "getCachedToken|__cfduid|stalkerToken" apps libs tools
  rg -n "Authorization|Cookie|password|device_id|signature|challengeRef|leaseRef" apps/electron-backend/src/app/services/stalker-session apps/electron-backend/src/app/events libs/portal/stalker
  git status --short
  ```

  Classify every remaining match as an intentional server-side implementation, redaction/test fixture, migration removal, or simple/PWA compatibility path.

- [ ] Request a specification-compliance review against the design document. Fix every missing requirement or document an explicit, approved deferral.
- [ ] Request a code-quality/security review focused on SSRF/redirect behavior, cookie ownership, sender-bound refs, refresh concurrency, secret leakage, persistence ordering, backup merge safety, and regression tests. Fix every material finding.
- [ ] Rerun every affected test after review fixes.
- [ ] Commit:

  ```bash
  git add libs/shared/logging docs/architecture/stalker-portal.md docs/architecture/stalker-authentication-compatibility-audit.md docs/architecture/playlist-backup-restore.md CLAUDE.md .codex/skills/stalker-portal/SKILL.md AGENTS.md .changes/stalker-session-compatibility.md
  git commit -m "docs(stalker): document session compatibility runtime"
  ```

## Final acceptance audit

- [ ] Root/custom `/c/`/direct URLs choose the tested endpoint and recipe.
- [ ] Stateless evidence cannot mask a later full endpoint or survive an auth/protection failure.
- [ ] No origin receives MAC, identity, bearer, cookies, or credentials before approval and its own fresh status-2 flow.
- [ ] The winning handshake/first profile are reused; auth step ordering is exact.
- [ ] Blank identity fields remain absent; no device identity is invented.
- [ ] Cookies rotate/expire correctly and managed names cannot be shadowed.
- [ ] Same base identity serializes principal mutations; different principals never share generations.
- [ ] Concurrent token failures perform one refresh and one retry per operation.
- [ ] Refresh cannot re-key a committed principal in place.
- [ ] Renderer/preload receives no token, random, cookie, credential, or secret playback headers.
- [ ] Playback contexts are sender/session/generation/epoch/URL-bound and invalidated on transition.
- [ ] New credentials and learned hints persist only after ready; Connected appears only after save plus commit.
- [ ] Failed import/migration/edit leaves the stored playlist and prior good credentials intact.
- [ ] Backup excludes structured secrets by default and never creates an unusable redacted Xtream row.
- [ ] Existing simple Stalker and PWA flows still pass.
- [ ] Every committed fixture validates and contains no secret-like evidence.
- [ ] Canonical docs, repo skill, release note, tests, lint, build, and E2E results are recorded in the final handoff.
