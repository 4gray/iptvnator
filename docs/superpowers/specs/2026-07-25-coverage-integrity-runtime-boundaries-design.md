# Coverage Integrity And Electron Runtime Boundaries Design

## Status

Approved in the delegated coverage-audit task on 2026-07-25.

The implementation branch starts from fresh `origin/master` commit
`4e5132cb` (`ci(release): gate PRs on an authored release note (#1257)`).

## Goal

Increase confidence in security-sensitive and runtime-sensitive Electron
behavior while making the merged Tier A coverage report fail closed when Jest
cannot instrument executable production source.

This is a risk-weighted first change. It does not try to maximize a global
percentage by testing type-only modules, re-export shims, or low-risk code.

## Fresh Baseline

`pnpm run coverage:ci` on `4e5132cb` completed successfully and reported:

| Metric     | Covered / total | Percent |
| ---------- | --------------: | ------: |
| Statements | 24,684 / 35,843 |  68.86% |
| Branches   | 17,290 / 29,471 |  58.66% |
| Functions  |   5,728 / 8,524 |  67.19% |
| Lines      | 24,051 / 34,754 |  69.20% |

The successful command nevertheless printed `Failed to collect coverage` for
`libs/m3u-state/src/lib/effects.ts`. TypeScript could not resolve
`@angular/material/snack-bar`, inferred the injected snack bar as `unknown`,
and did not see the shared `window.electron` declaration under the project's
spec compiler configuration. The file was absent from both the project report
and `coverage/merged/coverage-final.json`.

All 30 Tier A projects produced a `coverage-final.json`, so the current merge
included 30 reports and still missed an executable file. This demonstrates
that project-level report existence is necessary but not sufficient.

The audit file status on the same baseline is:

| File                                                                                    | Statement coverage |
| --------------------------------------------------------------------------------------- | -----------------: |
| `apps/electron-backend/src/app/workers/database.worker.ts`                              |       0 / 205 (0%) |
| `apps/electron-backend/src/app/events/remote-control.events.ts`                         |       0 / 115 (0%) |
| `apps/electron-backend/src/app/server/http-server.ts`                                   |        0 / 73 (0%) |
| `apps/electron-backend/src/app/events/database/downloads.events.ts`                     |  69 / 147 (46.93%) |
| `apps/electron-backend/src/app/events/settings.events.ts`                               |   16 / 27 (59.25%) |
| `libs/workspace/dashboard/feature/src/lib/rails/workspace-dashboard-rails.component.ts` |       0 / 206 (0%) |
| `libs/portal/stalker/feature/src/lib/stalker-search/stalker-search.component.ts`        |       0 / 166 (0%) |
| `libs/m3u-state/src/lib/effects.ts`                                                     |             absent |

The original audit is therefore partly stale: `downloads.events.ts` gained a
meaningful regression suite on master, and `settings.events.ts` already had
logging coverage. Both remain in this PR because their uncovered IPC
contracts are part of the approved Electron boundary, but new tests must cover
missing behavior rather than repeat existing assertions.

## Scope

### Included

- Add behavioral coverage for `HttpServer` routing, static serving, traversal
  containment, MIME responses, and lifecycle.
- Add behavioral coverage for the remote-control HTTP and IPC boundary:
  method checks, renderer commands, status, channel-number validation,
  malformed JSON, and the 10 KiB body limit.
- Extend settings IPC coverage for argument normalization, defined-only
  persistence, frame-copy boolean normalization, remote-control fallback, and
  runtime server reconciliation while preserving redacted logging.
- Extend downloads IPC coverage around the managed-file authorization boundary
  before revealing or opening local paths. Preserve the existing destructive
  cleanup and pause/resume regression tests.
- Fix the `m3u-state` spec compiler configuration so `effects.ts` can be
  instrumented and appears in its report.
- Add a fail-closed integrity gate for instrumentation errors, missing Tier A
  reports, missing executable source files, merged metric regressions, and
  regressions in the selected critical Electron files.
- Document the resulting coverage workflow in
  `docs/architecture/validation-map.md`.

### Deferred

- `database.worker.ts`: its 942-line worker-thread dispatcher and database
  operation surface deserve a dedicated worker-contract design and PR.
- `workspace-dashboard-rails.component.ts`: the existing same-name spec tests
  extracted helpers but never instantiates the 660-line component. Component
  coverage belongs in a focused Angular dashboard change.
- `stalker-search.component.ts`: the 510-line search surface and portal store
  interactions belong in a focused Stalker search change.
- Broadly raising every current 0% Tier A file.
- Adding tests to type-only/shared interfaces or pure re-export modules to
  inflate aggregate metrics.
- Unrelated production behavior changes.

## Coverage Integrity Architecture

### Shared integrity module

Create a pure Node module under `tools/coverage/` that owns:

- source-file exclusion rules;
- TypeScript AST classification of runtime-owning files;
- coverage path normalization;
- project-report completeness checks;
- instrumentation-error marker detection;
- merged and critical-file ratchet evaluation; and
- diagnostic formatting.

The runner, merge script, health script, and Node unit tests use this module so
the definition of an expected executable file does not drift between stages.

### Runtime-owning source classification

For each Tier A `sourceRoot`, recursively consider production `.ts` files.
Exclude:

- `*.spec.ts` and `*.test.ts`;
- `*.d.ts`;
- `test-setup.ts`, test stubs, and generated files;
- environment files; and
- `index.ts`, matching the existing Jest collection exclusions.

Parse each candidate with the TypeScript compiler API. A file is expected in
coverage when it has at least one top-level runtime-owning statement.
Import declarations, interfaces, type aliases, pure export declarations,
empty statements, and ambient `declare` statements do not make a file
runtime-owning by themselves. Classes, functions, variables, enums,
expressions, control flow, and other emitted statements do.

This rule intentionally checks executable ownership rather than all TypeScript
text. It excludes type-only contracts and re-export shims without maintaining
a large hand-authored manifest. A discovery prototype over the fresh baseline
classified 588 of 652 Tier A TypeScript source files as runtime-owning and
identified exactly one absent file: `libs/m3u-state/src/lib/effects.ts`.

Coverage keys and expected source paths are normalized to absolute POSIX-style
paths before comparison so diagnostics are stable across supported CI
platforms.

### Runner behavior

`run-tier-a-coverage.mjs` must continue relaying each child process's stdout and
stderr as it arrives. It also scans a bounded rolling text window, with ANSI
escapes removed, for Jest's `Failed to collect coverage` marker.

After each project command finishes, the runner must fail if:

- the Nx/Jest command exits nonzero or terminates by signal;
- the output contains an instrumentation failure marker;
- `coverage/<project-root>/coverage-final.json` is missing or invalid; or
- a runtime-owning file under that project's source root is absent from the
  report.

The implementation should use asynchronous child-process streams rather than
buffering the full multi-project Jest output in memory.

### Merge behavior

`merge-coverage.mjs` must require exactly one valid report for every configured
Tier A project. It must list all missing or invalid reports and exit before
deleting or rewriting `coverage/merged`.

The current `.filter(existsSync)` behavior is removed because it silently
merges partial input.

### Health behavior

`coverage-health.mjs --require-report` independently reruns:

- per-project report existence and JSON validity;
- runtime-owning source completeness;
- merged metric ratchets; and
- selected critical-file ratchets.

This defense in depth catches stale or manually merged reports even when the
runner was not the process that generated them. Local health checks without
`--require-report` retain their current warning behavior when report artifacts
are not available, but any present invalid report remains an error.

### Ratchets

The policy stores four merged minimum percentages and per-file statement
minimums for:

- `http-server.ts`;
- `remote-control.events.ts`;
- `settings.events.ts`; and
- `downloads.events.ts`.

The implementation begins with the fresh master aggregate baseline shown
above. After the approved behavioral suites and the `effects.ts`
instrumentation fix are complete, the policy is updated to the reproducible
post-change values. Those final values become the ratchet: they may stay level
or rise in future changes, but must not be lowered merely to make CI green.

Per-file minimums are likewise recorded from the achieved behavioral suites,
not from an arbitrary aspirational percentage. The two currently uncovered
files must become nonzero; the existing `settings` and `downloads` coverage
must not regress.

## Behavioral Test Design

### HTTP server

Use a temporary static directory and a real loopback Node HTTP server. Verify:

- `/` serves `index.html`;
- known static assets return their content and correct MIME type;
- an unknown client-side route falls back to `index.html`;
- a missing `index.html` returns a plain-text 404;
- registered remote-control API routes bypass static serving;
- unknown remote-control API routes return JSON 404;
- normalized traversal input cannot escape the configured static root;
- `start`, duplicate `start`, `stop`, enable/disable, and port-change restart
  preserve the current lifecycle contract.

Tests should prefer public behavior over direct calls to private methods. If
an ephemeral port or temporary static root is not observable through the
current API, introduce only the smallest constructor dependency seam required
to use real Node HTTP and filesystem behavior. The production singleton keeps
identical defaults.

### Remote control events

Capture the HTTP handlers registered during bootstrap and exercise them with
real readable request streams plus response-contract assertions. Verify:

- bootstrap registers every documented endpoint and starts the server only
  when stored settings enable it;
- channel up/down and volume commands accept only their documented HTTP
  methods and send the expected renderer event;
- channel selection accepts finite positive values, floors fractional input,
  and rejects missing, non-finite, or sub-one values;
- status updates merge partial IPC state and refresh `updatedAt`;
- status reads return the latest merged state;
- malformed JSON returns 400 without dispatching a command;
- payloads over 10 KiB return 413, destroy the request, and do not dispatch;
  and
- missing BrowserWindows are contained without throwing.

The existing Electron E2E remote-control suite remains the end-to-end check for
real volume commands and renderer status.

### Settings events

Extend the existing same-name spec. Use the real external-player argument
normalizer and mocked persistent store/server boundaries to verify:

- MPV and VLC arguments are normalized before persistence;
- undefined values are not written;
- reuse flags preserve explicit false values;
- frame-copy persistence coerces to boolean;
- a partial remote-control update reads the missing half from the store;
- only explicitly supplied remote-control fields are persisted; and
- `httpServer.updateSettings` receives the resolved enabled/port pair.

Retain the existing assertions that logging redacts TMDB and player-argument
credentials.

### Downloads events

Extend the current event suite rather than replacing its destructive cleanup
coverage. Verify the local-file boundary:

- a path not present in the downloads database is never revealed or opened,
  even when it exists on disk;
- a database-managed path missing on disk is never revealed or opened;
- only a database-managed path that exists reaches
  `shell.showItemInFolder` or `shell.openPath`; and
- a database lookup failure returns the existing structured not-found response
  and never reaches the shell.

Folder authorization internals remain covered by
`download-directory-authorization.spec.ts`; this event suite tests only the
IPC-to-authorizer and managed-path integration where it adds distinct signal.

## TDD Sequence

1. Add failing Node tests for runtime classification, ANSI instrumentation
   marker detection, missing/invalid reports, partial merge input, aggregate
   ratchets, and critical-file ratchets.
2. Implement the shared integrity module and wire the runner, merge, and health
   scripts until those tests pass.
3. Enable the selected critical-file policy; confirm fresh targeted coverage
   fails because `http-server.ts` and `remote-control.events.ts` are 0%.
4. For each Electron boundary, add one contract test at a time, observe the
   intended failure, and make only the smallest testability refactor needed to
   pass it.
5. Add a failing integrity assertion for the absent `effects.ts`, align the
   `m3u-state` spec compiler configuration, and confirm the real file appears.
6. If a behavioral test exposes a production defect, add a direct regression
   assertion first and make a separately justified minimal fix. Otherwise
   preserve production behavior.
7. Record fresh aggregate and per-file post-change ratchets only after all
   behavioral suites are green.

## Error Handling And Diagnostics

Integrity failures must identify:

- the project;
- the expected report path;
- each missing runtime-owning source path;
- the metric or critical file that fell below its ratchet; and
- the observed and required values.

The runner must preserve the original Nx/Jest output and child exit semantics.
Integrity diagnostics are additive and must not hide the underlying
instrumentation error.

Tests use temporary directories and deterministic synthetic coverage maps.
They must not depend on a previously generated workspace `coverage/` tree.

## Success Criteria

- Fresh `pnpm run coverage:ci` exits nonzero for synthetic or real
  instrumentation collection failures.
- All 30 Tier A project reports are mandatory merge inputs.
- Every runtime-owning Tier A TypeScript source file is present in its project
  report.
- `libs/m3u-state/src/lib/effects.ts` is present in coverage.
- The four selected Electron boundary files meet their recorded behavioral
  statement ratchets; `http-server.ts` and `remote-control.events.ts` are no
  longer 0%.
- Final merged statements, branches, functions, and lines are each at least
  the fresh master baseline and become the new ratchet.
- Assertions verify observable contracts rather than merely invoking mocks for
  line execution.
- No untested production behavior change or unrelated source change is
  included.
- Deferred database worker, dashboard, and Stalker search coverage is listed
  in the draft PR.

## Validation Ladder

Run fresh, uncached validation in this order:

```bash
node --test tools/coverage/*.test.mjs
pnpm nx test electron-backend --skip-nx-cache --runInBand
pnpm nx test m3u-state --skip-nx-cache --runInBand
pnpm run coverage:unit:ci -- --projects=electron-backend,m3u-state
pnpm nx lint electron-backend --skip-nx-cache
pnpm nx lint m3u-state --skip-nx-cache
pnpm run typecheck:backend
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/remote-control.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/settings.e2e.ts
pnpm nx build electron-backend --configuration=production --skip-nx-cache
pnpm run coverage:ci
```

The final report records exact command results, aggregate before/after metrics,
and before/after metrics for the selected critical files. If an environment
prevents an Electron E2E or production build, report the exact blocker and run
the strongest available lower-level contract validation; do not silently omit
it.

## Documentation Impact

Update `docs/architecture/validation-map.md` to make the fail-closed coverage
contract and ratchet maintenance workflow canonical.

`AGENTS.md` and `CLAUDE.md` do not currently describe coverage commands or
integrity behavior, so no update is expected unless implementation changes a
process they do describe.

## Draft PR Handoff

The draft PR body will include:

- fresh master baseline and post-change aggregate metrics;
- selected-file before/after metrics;
- behavioral contracts added;
- any production-only testability refactor and why it preserves behavior;
- coverage integrity and ratchet changes;
- all validation commands and results;
- the documentation decision; and
- deferred 0%-coverage follow-ups.
