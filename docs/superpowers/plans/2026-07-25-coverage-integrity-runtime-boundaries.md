# Coverage Integrity And Electron Runtime Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tier A coverage fail closed and add meaningful regression coverage for the HTTP server, remote control, settings, and download-file Electron boundaries.

**Architecture:** A shared pure Node module classifies runtime-owning TypeScript, validates per-project Istanbul reports, scans child output for collection failures, and evaluates aggregate/per-file ratchets. Existing Electron contracts stay unchanged except for the TDD-backed rejection of a discovered static-path traversal escape; tests use real loopback/filesystem behavior where practical and mock only process, persistence, or native-shell boundaries.

**Tech Stack:** Node.js ESM and `node:test`, TypeScript compiler API, Istanbul coverage maps, Jest/ts-jest, Electron main-process IPC, Node HTTP streams, Angular Jest configuration, Nx, Playwright.

**Execution note (2026-07-26):** The branch was rebased onto
`origin/master` commit `7e8c2ccce16b71d72a64c45f1d96dd090dc8e077`
before the final ratchet run. A real-loopback HTTP regression exposed a Windows
double-leading-slash traversal escape; the implementation adds a tested pure
resolver and a user-facing Electron fix note. A final integrity follow-up also
validates the merged Istanbul map itself before evaluating its recomputed
summary and ratchets.

---

## Scope And File Map

Create:

- `tools/coverage/coverage-integrity.mjs` — shared source classification,
  report validation, output scanning, and ratchet evaluation.
- `tools/coverage/coverage-integrity.test.mjs` — deterministic Node tests using
  temporary source/report fixtures.
- `apps/electron-backend/src/app/server/http-server.spec.ts` — real loopback
  and temporary-directory HTTP server contracts.
- `apps/electron-backend/src/app/events/remote-control.events.spec.ts` —
  registered HTTP handler, IPC, status, validation, and size-limit contracts.

Modify:

- `tools/coverage/run-tier-a-coverage.mjs` — stream child output, detect
  collection failures, require complete project reports.
- `tools/coverage/merge-coverage.mjs` — reject missing/invalid Tier A inputs
  before touching merged output.
- `tools/coverage/coverage-health.mjs` — independently validate completeness
  and ratchets.
- `tools/coverage/coverage-policy.json` — store achieved aggregate and
  critical-file ratchets.
- `package.json` — run coverage-tool unit tests inside `coverage:ci`.
- `libs/m3u-state/tsconfig.spec.json` — use bundler resolution and include the
  shared Electron window declaration so `effects.ts` instruments.
- `apps/electron-backend/src/app/server/http-server.ts` — optional static-root
  and server-factory seam, port `0` support for loopback tests, and a tested
  static-root containment resolver.
- `apps/electron-backend/src/app/events/remote-control.events.ts` — export the
  class for isolated instances while preserving the default singleton.
- `apps/electron-backend/src/app/events/settings.events.spec.ts` — persistence,
  normalization, remote-control reconciliation, and redaction contracts.
- `apps/electron-backend/src/app/events/database/downloads.events.spec.ts` —
  managed-path checks before native shell access.
- `docs/architecture/validation-map.md` — canonical fail-closed and ratchet
  maintenance workflow.
- `docs/superpowers/specs/2026-07-25-coverage-integrity-runtime-boundaries-design.md`
  — retain the corrected Istanbul-rounded baseline values.

Do not modify:

- `apps/electron-backend/src/app/workers/database.worker.ts`;
- workspace dashboard or Stalker search production code;
- type-only/shared-interface source for percentage gain;
- `AGENTS.md` or `CLAUDE.md`, unless execution discovers that the implemented
  commands contradict text already present there.

### Task 0: Rebase And Bootstrap Immediately Before Implementation

**Files:**

- Verify only: `package.json`
- Verify only: `pnpm-lock.yaml`
- Verify only: `tools/coverage/coverage-policy.json`

- [ ] **Step 1: Load the execution skills**

Read completely before code changes:

```text
using-superpowers
executing-plans
test-driven-development
electron-pro
typescript
angular-testing
iptvnator-nx-architecture
```

Use `systematic-debugging` before changing code in response to any unexpected
failure, and `verification-before-completion`, `release-notes`, and
`github-pr` during the final tasks.

- [ ] **Step 2: Confirm a clean branch and rebase onto fresh master**

Run:

```bash
git status --short --branch
git fetch origin master --prune
git rebase origin/master
git status --short --branch
git log -2 --oneline --decorate
```

Expected: the branch is `agent/coverage-integrity-runtime-boundaries`, the
rebase exits 0, and only the committed design/plan are ahead of the latest
`origin/master`. If master changed a scoped source, spec, Jest config, or
coverage tool, re-run the baseline checks below and update this plan's numeric
seed before implementation rather than resolving by assumption.

- [ ] **Step 3: Refresh locked dependencies and Nx discovery**

Run:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
pnpm nx show projects --withTarget test
```

Expected: all commands exit 0; the project list contains
`electron-backend`, `electron-backend-e2e`, and `m3u-state`; the lockfile stays
unchanged.

- [ ] **Step 4: Reconfirm the fresh baseline**

Run even when Step 2 reports no new master commits:

```bash
NX_SKIP_NX_CACHE=true pnpm run coverage:ci
```

Expected on unchanged
`7e8c2ccce16b71d72a64c45f1d96dd090dc8e077`: the command exits 0 while printing
`Failed to collect coverage` for `libs/m3u-state/src/lib/effects.ts`, and the
30 project reports merge 709 files while omitting that runtime-owning source.
The aggregate remains 69.27/58.92/67.44/69.57, with HTTP and remote control at
0%, settings at 16 / 27 (59.25%), and downloads at 69 / 147 (46.93%). Record
the fresh aggregate and selected-file values. If master changed them, replace
the numeric ratchet seed in Task 3; do not lower a baseline already present on
newer master.

### Task 1: Build And Unit-Test The Shared Coverage Integrity Module

**Files:**

- Create: `tools/coverage/coverage-integrity.test.mjs`
- Create: `tools/coverage/coverage-integrity.mjs`

- [ ] **Step 1: Write the failing source-classification and output-scanner tests**

Create `tools/coverage/coverage-integrity.test.mjs` with Node built-ins and
these contracts:

```javascript
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
    createCoverageOutputScanner,
    evaluateCoverageRatchets,
    hasRuntimeOwnedStatement,
    validateProjectCoverage,
    validateRequiredProjectReports,
} from './coverage-integrity.mjs';

const temporaryRoots = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('hasRuntimeOwnedStatement', () => {
    it('excludes type-only, import-only, and pure re-export source', () => {
        assert.equal(
            hasRuntimeOwnedStatement(
                'import type { Settings } from "./settings";'
            ),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('interface Settings { enabled: boolean }'),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('export type Mode = "live" | "vod";'),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('export { value } from "./value";'),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('declare const injected: string;'),
            false
        );
    });

    it('includes emitted declarations and executable statements', () => {
        assert.equal(
            hasRuntimeOwnedStatement('export const enabled = true;'),
            true
        );
        assert.equal(
            hasRuntimeOwnedStatement(
                'export class RuntimeBoundary { start() {} }'
            ),
            true
        );
        assert.equal(hasRuntimeOwnedStatement('console.log("runtime");'), true);
    });
});

describe('createCoverageOutputScanner', () => {
    it('detects an ANSI-colored marker split across chunks', () => {
        const scanner = createCoverageOutputScanner(128);

        scanner.push('\u001b[31mFailed to collect');
        scanner.push(' coverage from /workspace/effects.ts\u001b[39m');

        assert.equal(scanner.collectionFailed, true);
    });

    it('keeps only a bounded rolling tail', () => {
        const scanner = createCoverageOutputScanner(32);

        scanner.push('x'.repeat(256));

        assert.equal(scanner.tail.length, 32);
        assert.equal(scanner.collectionFailed, false);
    });
});
```

- [ ] **Step 2: Add failing temporary-report tests**

In the same file, add helpers that write one runtime source plus a synthetic
Istanbul entry:

```javascript
function makeProjectFixture() {
    const workspaceRoot = mkdtempSync(
        path.join(tmpdir(), 'iptvnator-coverage-integrity-')
    );
    temporaryRoots.push(workspaceRoot);
    const sourceRoot = 'libs/example/src';
    const projectRoot = 'libs/example';
    const sourcePath = path.join(workspaceRoot, sourceRoot, 'runtime.ts');
    const reportPath = path.join(
        workspaceRoot,
        'coverage',
        projectRoot,
        'coverage-final.json'
    );

    mkdirSync(path.dirname(sourcePath), { recursive: true });
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(sourcePath, 'export const runtime = true;\n');

    const project = {
        name: 'example',
        root: projectRoot,
        sourceRoot,
    };

    return { project, reportPath, sourcePath, workspaceRoot };
}

function coverageEntry(filePath, hits = [0]) {
    const statementMap = Object.fromEntries(
        hits.map((_, index) => [
            index,
            {
                start: { line: index + 1, column: 0 },
                end: { line: index + 1, column: 28 },
            },
        ])
    );
    const statementHits = Object.fromEntries(
        hits.map((hit, index) => [index, hit])
    );

    return {
        path: filePath,
        statementMap,
        fnMap: {},
        branchMap: {},
        s: statementHits,
        f: {},
        b: {},
    };
}

describe('validateProjectCoverage', () => {
    it('accepts a report containing every runtime-owning file', () => {
        const fixture = makeProjectFixture();
        writeFileSync(
            fixture.reportPath,
            JSON.stringify({
                [fixture.sourcePath]: coverageEntry(fixture.sourcePath),
            })
        );

        const result = validateProjectCoverage(fixture);

        assert.deepEqual(result.errors, []);
        assert.equal(result.report?.project.name, 'example');
    });

    it('reports a runtime-owning source omitted from a valid report', () => {
        const fixture = makeProjectFixture();
        writeFileSync(fixture.reportPath, '{}');

        const result = validateProjectCoverage(fixture);

        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /runtime\.ts/);
    });

    it('reports missing and invalid project reports', () => {
        const missing = makeProjectFixture();
        const invalid = makeProjectFixture();
        writeFileSync(invalid.reportPath, '{ invalid json');

        assert.match(
            validateProjectCoverage(missing).errors[0],
            /did not produce/
        );
        assert.match(
            validateProjectCoverage(invalid).errors[0],
            /invalid JSON/
        );
    });

    it('requires every configured Tier A report', () => {
        const fixture = makeProjectFixture();

        const result = validateRequiredProjectReports({
            projects: [fixture.project],
            workspaceRoot: fixture.workspaceRoot,
        });

        assert.equal(result.reports.length, 0);
        assert.match(result.errors[0], /example/);
    });
});
```

- [ ] **Step 3: Add failing aggregate and critical-file ratchet tests**

Add:

```javascript
describe('evaluateCoverageRatchets', () => {
    it('reports aggregate percentage regression', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: {
                statements: { covered: 68, total: 100, pct: 68 },
                branches: { covered: 57, total: 100, pct: 57 },
                functions: { covered: 67, total: 100, pct: 67 },
                lines: { covered: 69, total: 100, pct: 69 },
            },
            ratchet: {
                merged: {
                    statements: 68.86,
                    branches: 58.66,
                    functions: 67.19,
                    lines: 69.2,
                },
                criticalFiles: [],
            },
            workspaceRoot: '/workspace',
        });

        assert.equal(errors.length, 4);
        assert.match(errors[0], /statements.*68.*68\.86/);
    });

    it('requires both covered statements and percentage for a critical file', () => {
        const workspaceRoot = '/workspace';
        const filePath = path.join(workspaceRoot, 'apps/runtime.ts');
        const errors = evaluateCoverageRatchets({
            coverageData: {
                [filePath]: coverageEntry(filePath, [1, 0]),
            },
            mergedSummary: {
                statements: { covered: 1, total: 1, pct: 100 },
                branches: { covered: 0, total: 0, pct: 100 },
                functions: { covered: 0, total: 0, pct: 100 },
                lines: { covered: 1, total: 1, pct: 100 },
            },
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [
                    {
                        path: 'apps/runtime.ts',
                        statements: {
                            minimumCovered: 2,
                            minimumPercent: 75,
                        },
                    },
                ],
            },
            workspaceRoot,
        });

        assert.equal(errors.length, 2);
        assert.match(errors[0], /apps\/runtime\.ts/);
    });

    it('reports a critical file missing from merged coverage', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: {
                statements: { covered: 0, total: 0, pct: 100 },
                branches: { covered: 0, total: 0, pct: 100 },
                functions: { covered: 0, total: 0, pct: 100 },
                lines: { covered: 0, total: 0, pct: 100 },
            },
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [
                    {
                        path: 'apps/missing.ts',
                        statements: {
                            minimumCovered: 1,
                            minimumPercent: 0,
                        },
                    },
                ],
            },
            workspaceRoot: '/workspace',
        });

        assert.match(errors[0], /missing from merged coverage/);
    });
});
```

- [ ] **Step 4: Run the Node tests to verify RED**

Run:

```bash
node --test tools/coverage/coverage-integrity.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`tools/coverage/coverage-integrity.mjs`.

- [ ] **Step 5: Implement source classification and the bounded scanner**

Create `tools/coverage/coverage-integrity.mjs`. Use `unknown`-equivalent
runtime validation rather than trusting parsed JSON shapes. The core
classification and scanner must follow:

```javascript
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');

export const COVERAGE_COLLECTION_FAILURE = 'Failed to collect coverage';
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

function hasDeclareModifier(statement) {
    const modifiers = ts.canHaveModifiers(statement)
        ? (ts.getModifiers(statement) ?? [])
        : [];
    return modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword
    );
}

export function hasRuntimeOwnedStatement(sourceText, fileName = 'source.ts') {
    const source = ts.createSourceFile(
        fileName,
        sourceText,
        ts.ScriptTarget.Latest,
        true
    );

    return source.statements.some((statement) => {
        if (hasDeclareModifier(statement)) {
            return false;
        }
        return !(
            ts.isImportDeclaration(statement) ||
            ts.isImportEqualsDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isExportDeclaration(statement) ||
            ts.isEmptyStatement(statement)
        );
    });
}

export function createCoverageOutputScanner(maxCharacters = 4096) {
    let tail = '';
    let collectionFailed = false;

    return {
        get collectionFailed() {
            return collectionFailed;
        },
        get tail() {
            return tail;
        },
        push(chunk) {
            tail = `${tail}${String(chunk).replace(ANSI_ESCAPE, '')}`.slice(
                -maxCharacters
            );
            if (tail.includes(COVERAGE_COLLECTION_FAILURE)) {
                collectionFailed = true;
            }
        },
    };
}
```

Add recursive enumeration with exactly these exclusions:

```javascript
function isExcludedSource(filePath) {
    const file = toPosix(filePath);
    return (
        /\.(spec|test)\.ts$/.test(file) ||
        file.endsWith('.d.ts') ||
        file.endsWith('/test-setup.ts') ||
        file.includes('/test-stubs/') ||
        /\.generated\./.test(file) ||
        file.includes('/environments/') ||
        file.endsWith('/index.ts')
    );
}
```

`runtimeOwningSourceFiles(workspaceRoot, sourceRoot)` must recursively read
only `.ts` files, apply `isExcludedSource`, parse the file, and return sorted
absolute paths whose source has a runtime-owned statement.

- [ ] **Step 6: Implement report validation**

Implement these stable return shapes:

```javascript
// validateProjectCoverage(...)
{
    errors: string[],
    report: undefined | {
        data: Record<string, object>,
        path: string,
        project: object,
    },
}

// validateRequiredProjectReports(...)
{
    errors: string[],
    reports: Array<{
        data: Record<string, object>,
        path: string,
        project: object,
    }>,
}
```

`validateProjectCoverage({ workspaceRoot, project })` must:

1. resolve `coverage/<project.root>/coverage-final.json`;
2. report a missing file using the project name and relative report path;
3. parse JSON and reject arrays, `null`, and invalid JSON;
4. normalize report keys with `path.resolve`;
5. compare them to `runtimeOwningSourceFiles`; and
6. emit one diagnostic per missing source, including project and relative
   source path.

`validateRequiredProjectReports` must call it for every project and preserve
policy order in `reports`.

- [ ] **Step 7: Implement ratchet evaluation**

`evaluateCoverageRatchets` must:

- compare each merged metric with its numeric minimum;
- build an Istanbul map from `coverageData`;
- require every critical path to exist;
- obtain `fileCoverage.toSummary().toJSON().statements`;
- compare both `covered` and `pct`; and
- return diagnostics rather than exiting.

Use messages of the form:

```text
Merged statements coverage regressed: observed 68%, required at least 68.86%.
Critical coverage apps/runtime.ts statements covered regressed: observed 1, required at least 2.
Critical coverage apps/runtime.ts statements percent regressed: observed 50%, required at least 75%.
```

- [ ] **Step 8: Run the module tests to verify GREEN**

Run:

```bash
node --test tools/coverage/coverage-integrity.test.mjs
```

Expected: all classification, marker, report, and ratchet tests pass.

- [ ] **Step 9: Commit the pure integrity module**

Run:

```bash
git add \
  tools/coverage/coverage-integrity.mjs \
  tools/coverage/coverage-integrity.test.mjs
git commit -m "test(coverage): add integrity primitives"
```

Expected: one commit containing only the pure module and its Node tests.

### Task 2: Wire The Gate And Fix The Real `m3u-state` Instrumentation Failure

**Files:**

- Modify: `tools/coverage/run-tier-a-coverage.mjs`
- Modify: `tools/coverage/merge-coverage.mjs`
- Modify: `tools/coverage/coverage-health.mjs`
- Modify: `package.json`
- Modify: `libs/m3u-state/tsconfig.spec.json`

- [ ] **Step 1: Replace synchronous inherited child output with streamed scanning**

In `run-tier-a-coverage.mjs`, replace `spawnSync` with `spawn`, import
`createCoverageOutputScanner` and `validateProjectCoverage`, and add:

```javascript
async function runCoverageProject(project) {
    const args = buildNxArgs(project);
    console.log(`\n==> Collecting coverage for ${project.name}`);
    console.log(`pnpm ${args.join(' ')}`);

    const scanner = createCoverageOutputScanner();
    const child = spawn('pnpm', args, {
        cwd: workspaceRoot,
        env: {
            ...process.env,
            CI: process.env.CI ?? 'true',
            NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false',
        },
        stdio: ['inherit', 'pipe', 'pipe'],
    });

    for (const [stream, destination] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
    ]) {
        stream.on('data', (chunk) => {
            scanner.push(chunk);
            destination.write(chunk);
        });
    }

    const result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
    });

    if (result.code !== 0 || result.signal) {
        return result.code ?? 1;
    }
    if (scanner.collectionFailed) {
        console.error(
            `Coverage collection failed while testing ${project.name}.`
        );
        return 1;
    }

    const validation = validateProjectCoverage({
        project,
        workspaceRoot,
    });
    for (const error of validation.errors) {
        console.error(`Error: ${error}`);
    }
    return validation.errors.length === 0 ? 0 : 1;
}
```

Replace the final `spawnSync` loop with top-level awaited sequential calls.
Exit immediately after a nonzero project result so later projects cannot hide
the failed owner.

- [ ] **Step 2: Make merge input fail closed before output mutation**

In `merge-coverage.mjs`, remove the `.filter(existsSync)` construction. Call:

```javascript
const validation = validateRequiredProjectReports({
    projects: policy.unitCoverage.tierA,
    workspaceRoot,
});

if (validation.errors.length > 0) {
    for (const error of validation.errors) {
        console.error(`Error: ${error}`);
    }
    process.exit(1);
}

const coverageInputs = validation.reports;
```

Perform this before `rmSync(outputDir, ...)`. Merge each `input.data` instead
of reopening its path. Log `coverageInputs.length`, which must be exactly 30
on the current policy.

- [ ] **Step 3: Add independent health validation**

In `coverage-health.mjs`:

- import `evaluateCoverageRatchets`, `validateMergedCoverage`,
  `validateProjectCoverage`, and `validateRequiredProjectReports`;
- under `--require-report`, validate every Tier A report and append all
  diagnostics to `errors`;
- without `--require-report`, validate only report files that actually exist,
  treating invalid JSON or missing runtime source in a present report as an
  error rather than printing 30 missing-report warnings;
- after loading merged `coverage-summary.json`, load and independently validate
  merged `coverage-final.json` for every runtime-owning Tier A file;
- recompute the aggregate summary from the validated merged map, compare it
  with the serialized summary, and evaluate
  `policy.reporting.coverageRatchet` when the policy has one.

Do not change existing source-root/spec ownership checks, E2E tag warnings, or
changed-file warnings.

- [ ] **Step 4: Run targeted `m3u-state` coverage to verify the real RED**

Run:

```bash
node --test tools/coverage/coverage-integrity.test.mjs
pnpm run coverage:unit:ci -- --projects=m3u-state
```

Expected:

- Node tests PASS.
- Targeted coverage exits nonzero after relaying the existing TypeScript
  diagnostics and reports `Coverage collection failed while testing
m3u-state`.

This is the real regression proof: before the runner wiring, the same Jest
failure exited 0.

- [ ] **Step 5: Align the `m3u-state` spec compiler configuration**

Replace `libs/m3u-state/tsconfig.spec.json` with:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "outDir": "../../dist/out-tsc",
        "module": "preserve",
        "target": "es2016",
        "types": ["jest", "node"],
        "moduleResolution": "bundler"
    },
    "files": ["src/test-setup.ts", "../../global.d.ts"],
    "include": [
        "jest.config.ts",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/*.d.ts"
    ]
}
```

This matches the working Angular services test compiler mode, lets TypeScript
honor Angular Material package exports, and includes the shared
`Window.electron` contract. Do not add a local fake Material declaration to
`m3u-state`.

- [ ] **Step 6: Add coverage-tool tests to `coverage:ci`**

In `package.json`, add:

```json
"coverage:tools:test": "node --test tools/coverage/coverage-integrity.test.mjs"
```

Change `coverage:ci` so it starts with:

```json
"coverage:ci": "pnpm run coverage:tools:test && pnpm run coverage:policy:check && pnpm run coverage:unit:ci && pnpm run coverage:merge && node tools/coverage/coverage-health.mjs --require-report"
```

- [ ] **Step 7: Verify targeted instrumentation is GREEN and complete**

Run:

```bash
pnpm run coverage:tools:test
pnpm nx test m3u-state --skip-nx-cache --runInBand
pnpm run coverage:unit:ci -- --projects=m3u-state
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; const report=JSON.parse(fs.readFileSync("coverage/libs/m3u-state/coverage-final.json","utf8")); const target=path.resolve("libs/m3u-state/src/lib/effects.ts"); if (!report[target]) throw new Error(`${target} missing`); console.log("effects.ts present");'
```

Expected: all commands exit 0, no `Failed to collect coverage` appears, and
the final command prints `effects.ts present`.

- [ ] **Step 8: Commit the fail-closed runner and instrumentation fix**

Run:

```bash
git add \
  package.json \
  tools/coverage/run-tier-a-coverage.mjs \
  tools/coverage/merge-coverage.mjs \
  tools/coverage/coverage-health.mjs \
  libs/m3u-state/tsconfig.spec.json
git commit -m "fix(coverage): fail on incomplete instrumentation"
```

Expected: one commit with the gate wiring and the real `effects.ts` fix.

### Task 3: Establish A Real Failing Critical-File Ratchet

**Files:**

- Modify but do not yet commit:
  `tools/coverage/coverage-policy.json`

- [ ] **Step 1: Add the provisional ratchet**

Under `reporting`, add:

```json
"coverageRatchet": {
    "merged": {
        "statements": 68.86,
        "branches": 58.66,
        "functions": 67.19,
        "lines": 69.2
    },
    "criticalFiles": [
        {
            "path": "apps/electron-backend/src/app/server/http-server.ts",
            "statements": {
                "minimumCovered": 1,
                "minimumPercent": 0
            }
        },
        {
            "path": "apps/electron-backend/src/app/events/remote-control.events.ts",
            "statements": {
                "minimumCovered": 1,
                "minimumPercent": 0
            }
        },
        {
            "path": "apps/electron-backend/src/app/events/settings.events.ts",
            "statements": {
                "minimumCovered": 17,
                "minimumPercent": 59.25
            }
        },
        {
            "path": "apps/electron-backend/src/app/events/database/downloads.events.ts",
            "statements": {
                "minimumCovered": 70,
                "minimumPercent": 46.93
            }
        }
    ]
}
```

The existing files use their fresh master percentage and require one
additional covered statement. The two 0% files require one covered statement.
These are minimal progress probes, not final thresholds.

- [ ] **Step 2: Verify the critical acceptance test is RED**

Use the fresh baseline reports from Task 0:

```bash
pnpm run coverage:merge
node tools/coverage/coverage-health.mjs --require-report
```

Expected: merge succeeds with exactly 30 reports; health exits nonzero and
names all selected files still below the provisional ratchet. In particular,
`http-server.ts` and `remote-control.events.ts` report zero covered
statements.

- [ ] **Step 3: Keep the provisional policy change unstaged**

Run:

```bash
git status --short
```

Expected: only `tools/coverage/coverage-policy.json` is intentionally dirty.
Do not stage it in Tasks 4–7; it remains the real red acceptance test until
the behavioral suites raise the observed values.

### Task 4: Cover The HTTP Server Through Real Loopback And Filesystem Contracts

**Files:**

- Create: `apps/electron-backend/src/app/server/http-server.spec.ts`
- Modify: `apps/electron-backend/src/app/server/http-server.ts`

- [ ] **Step 1: Write the complete HTTP contract suite before the seam exists**

The spec must:

- create a temporary static directory with `index.html`, `app.js`,
  `styles.css`, `data.json`, and an unknown-extension asset;
- inject a real `http.createServer` wrapper that captures the Node server;
- call `start(0)`, await `listening`, and request
  `127.0.0.1:<assigned-port>`;
- stop and remove the temporary tree in `afterEach`.

Use these test helpers:

```typescript
interface HttpResponseSnapshot {
    body: Buffer;
    contentType: string | undefined;
    statusCode: number;
}

function request(
    port: number,
    requestPath: string,
    method = 'GET'
): Promise<HttpResponseSnapshot> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                method,
                path: requestPath,
                port,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        body: Buffer.concat(chunks),
                        contentType: res.headers['content-type'],
                        statusCode: res.statusCode ?? 0,
                    })
                );
            }
        );
        req.once('error', reject);
        req.end();
    });
}
```

Add assertions for:

1. `/` returns the exact index body as `text/html`;
2. `.js`, `.css`, `.json`, and an unknown extension return the expected MIME;
3. a client route falls back to the exact index body;
4. missing index returns plain-text 404;
5. a registered API handler receives the request and bypasses static serving;
6. unknown `/api/remote-control/...` returns JSON 404;
7. `/../../outside-secret.txt` never returns an outside file;
8. duplicate `start` creates/listens once;
9. disable stops the server; and
10. an enabled port change stops then starts once with the new port.

- [ ] **Step 2: Run the focused spec to verify RED**

Run:

```bash
pnpm nx test electron-backend \
  --testPathPattern=http-server.spec.ts \
  --runInBand
```

Expected: FAIL at TypeScript compilation because `HttpServer` does not yet
accept the injected `distPath` and `createServer` options, and `start(0)`
currently ignores port zero.

- [ ] **Step 3: Add the minimal constructor seam**

In `http-server.ts`, add flat types:

```typescript
type HttpServerFactory = (requestListener: http.RequestListener) => http.Server;

interface HttpServerOptions {
    createServer?: HttpServerFactory;
    distPath?: string;
}
```

Add a factory field and constructor:

```typescript
private readonly createServer: HttpServerFactory;

constructor(options: HttpServerOptions = {}) {
    this.createServer =
        options.createServer ??
        ((requestListener) => http.createServer(requestListener));
    this.distPath = options.distPath ?? null;
}
```

Replace:

```typescript
if (port) {
```

with:

```typescript
if (port !== undefined) {
```

and replace the direct `http.createServer` call with `this.createServer`.
Leave the production singleton as:

```typescript
export const httpServer = new HttpServer();
```

No production caller passes port zero or constructor options, so normal
runtime behavior stays unchanged.

- [ ] **Step 4: Run HTTP tests and Electron coverage**

Run:

```bash
pnpm nx test electron-backend \
  --testPathPattern=http-server.spec.ts \
  --runInBand
pnpm run coverage:unit:ci -- --projects=electron-backend
pnpm run coverage:merge
node tools/coverage/coverage-health.mjs --require-report
```

Expected:

- the focused suite PASSes;
- `http-server.ts` is nonzero;
- health remains RED only for the not-yet-expanded selected boundaries and any
  aggregate dip caused by adding `effects.ts`.

- [ ] **Step 5: Commit only the HTTP slice**

Run:

```bash
git add \
  apps/electron-backend/src/app/server/http-server.ts \
  apps/electron-backend/src/app/server/http-server.spec.ts
git commit -m "test(electron): cover remote HTTP server"
```

Expected: the provisional policy remains unstaged.

### Task 5: Cover Remote-Control HTTP, IPC, And Renderer Dispatch

**Files:**

- Create:
  `apps/electron-backend/src/app/events/remote-control.events.spec.ts`
- Modify:
  `apps/electron-backend/src/app/events/remote-control.events.ts`

- [ ] **Step 1: Write the isolated remote-control suite**

Mock only:

- `BrowserWindow.getAllWindows`;
- `ipcMain.handle` and `ipcMain.on`;
- `httpServer.registerRemoteControlHandler` and `httpServer.start`; and
- `store.get`.

Import a named `RemoteControlEvents` class and instantiate it in each test.
Capture registered handlers in maps. Use a `PassThrough` request for JSON body
tests and a response recorder with typed `writeHead`/`end` methods.

Use this complete exchange helper:

```typescript
interface ResponseSnapshot {
    body: string;
    headers: Record<string, string>;
    statusCode: number;
}

function createExchange(method: string) {
    const requestStream = new PassThrough();
    Object.defineProperty(requestStream, 'method', { value: method });

    let resolveResponse!: (snapshot: ResponseSnapshot) => void;
    const snapshot: ResponseSnapshot = {
        body: '',
        headers: {},
        statusCode: 0,
    };
    const completed = new Promise<ResponseSnapshot>((resolve) => {
        resolveResponse = resolve;
    });
    const response = {
        writeHead(statusCode: number, headers: Record<string, string>) {
            snapshot.statusCode = statusCode;
            snapshot.headers = headers;
            return response;
        },
        end(body?: string) {
            snapshot.body = body ?? '';
            resolveResponse(snapshot);
            return response;
        },
    };

    return {
        completed,
        request: requestStream as unknown as http.IncomingMessage,
        requestStream,
        response: response as unknown as http.ServerResponse,
    };
}

function getHttpHandler(path: string) {
    const handler = mockRegisteredHttpHandlers.get(path);
    if (!handler) {
        throw new Error(`Expected remote-control HTTP handler for ${path}`);
    }
    return handler;
}
```

Add exact contract cases:

```typescript
it.each([
    ['/api/remote-control/channel/up', 'CHANNEL_CHANGE', { direction: 'up' }],
    [
        '/api/remote-control/channel/down',
        'CHANNEL_CHANGE',
        { direction: 'down' },
    ],
    [
        '/api/remote-control/volume/up',
        'REMOTE_CONTROL_COMMAND',
        { type: 'volume-up' },
    ],
    [
        '/api/remote-control/volume/down',
        'REMOTE_CONTROL_COMMAND',
        { type: 'volume-down' },
    ],
    [
        '/api/remote-control/volume/toggle-mute',
        'REMOTE_CONTROL_COMMAND',
        { type: 'volume-toggle-mute' },
    ],
] as const)(
    'dispatches POST %s to the first renderer',
    async (path, channel, payload) => {
        const exchange = createExchange('POST');

        getHttpHandler(path)(exchange.request, exchange.response);
        exchange.requestStream.end();
        const response = await exchange.completed;

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(JSON.stringify({ success: true }));
        expect(mockWebContentsSend).toHaveBeenCalledWith(channel, payload);
    }
);
```

Also test:

- all seven endpoint paths are registered;
- stored enabled/port starts HTTP once; disabled does not;
- GET on POST-only handlers and POST on status return 405 without dispatch;
- select-number accepts `7.9` and sends integer `7`;
- missing, zero, negative, `Infinity`, and nonnumeric values return 400;
- malformed JSON returns 400 and sends nothing;
- a 10,241-byte body returns 413, destroys the request, and sends nothing;
- partial status IPC updates merge with previous state and refresh
  `updatedAt`;
- GET status returns that merged state; and
- no BrowserWindow logs a warning but does not throw.

- [ ] **Step 2: Run the focused spec to verify RED**

Run:

```bash
pnpm nx test electron-backend \
  --testPathPattern=remote-control.events.spec.ts \
  --runInBand
```

Expected: FAIL because `RemoteControlEvents` is not exported as a named class.

- [ ] **Step 3: Export the existing class without changing its singleton**

Change:

```typescript
class RemoteControlEvents {
```

to:

```typescript
export class RemoteControlEvents {
```

Keep:

```typescript
export default new RemoteControlEvents();
```

Do not change endpoint names, methods, payloads, body limit, stored defaults,
or renderer channels unless a correct regression assertion exposes an actual
defect. If that happens, invoke `systematic-debugging`, keep the failing test,
and document the separately justified behavior fix.

- [ ] **Step 4: Verify remote-control behavior and coverage**

Run:

```bash
pnpm nx test electron-backend \
  --testPathPattern=remote-control.events.spec.ts \
  --runInBand
pnpm run coverage:unit:ci -- --projects=electron-backend
pnpm run coverage:merge
node tools/coverage/coverage-health.mjs --require-report
```

Expected: the focused suite PASSes, `remote-control.events.ts` is nonzero, and
health no longer reports either formerly 0% selected file.

- [ ] **Step 5: Commit only the remote-control slice**

Run:

```bash
git add \
  apps/electron-backend/src/app/events/remote-control.events.ts \
  apps/electron-backend/src/app/events/remote-control.events.spec.ts
git commit -m "test(electron): cover remote control events"
```

Expected: the provisional policy remains unstaged.

### Task 6: Expand Settings Runtime Reconciliation Coverage

**Files:**

- Modify:
  `apps/electron-backend/src/app/events/settings.events.spec.ts`
- Verify only:
  `apps/electron-backend/src/app/events/settings.events.ts`

- [ ] **Step 1: Make the existing test harness deterministic**

Keep real `normalizeExternalPlayerArguments`. Add stable mocks:

```typescript
type SettingsUpdateHandler = (
    event: unknown,
    settings: Record<string, unknown>
) => void;

const mockStoreGet = jest.fn();
const mockStoreSet = jest.fn();
const mockUpdateSettings = jest.fn();
let handler: SettingsUpdateHandler;
```

Include every imported key in the store mock:

```typescript
EMBEDDED_MPV_FRAME_COPY: 'embeddedMpvFrameCopy',
MPV_PLAYER_ARGUMENTS: 'mpvPlayerArguments',
MPV_REUSE_INSTANCE: 'mpvReuseInstance',
VLC_PLAYER_ARGUMENTS: 'vlcPlayerArguments',
VLC_REUSE_INSTANCE: 'vlcReuseInstance',
store: {
    get: mockStoreGet,
    set: mockStoreSet,
},
```

In `beforeEach`, clear the handler map, reset modules and mocks, silence
`console.log`, import `./settings.events`, and retrieve the registered
`SETTINGS_UPDATE` handler. Preserve both existing credential-redaction tests.

- [ ] **Step 2: Confirm the provisional settings ratchet is RED before new cases**

Run:

```bash
node tools/coverage/coverage-health.mjs --require-report
```

Expected: settings reports fewer than the provisional 17 covered statements or
less than its retained 59.25% floor.

- [ ] **Step 3: Add normalization and defined-only persistence assertions**

Add:

```typescript
it('normalizes player arguments and preserves explicit false reuse flags', () => {
    handler(
        {},
        {
            mpvPlayerArguments: [' --screen=1 ', '', ' --hwdec=auto-safe '],
            mpvReuseInstance: false,
            vlcPlayerArguments: ' --fullscreen \n\n --no-video-title-show ',
            vlcReuseInstance: false,
        }
    );

    expect(mockStoreSet).toHaveBeenCalledWith(
        'mpvPlayerArguments',
        '--screen=1\n--hwdec=auto-safe'
    );
    expect(mockStoreSet).toHaveBeenCalledWith('mpvReuseInstance', false);
    expect(mockStoreSet).toHaveBeenCalledWith(
        'vlcPlayerArguments',
        '--fullscreen\n--no-video-title-show'
    );
    expect(mockStoreSet).toHaveBeenCalledWith('vlcReuseInstance', false);
});

it('does not persist undefined settings', () => {
    handler({}, {});

    expect(mockStoreSet).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
});

it('coerces the frame-copy startup preference to boolean', () => {
    handler({}, { embeddedMpvFrameCopy: 1 });

    expect(mockStoreSet).toHaveBeenCalledWith('embeddedMpvFrameCopy', true);
});
```

- [ ] **Step 4: Add partial remote-control reconciliation assertions**

Add two tests:

```typescript
it('uses the stored port when only remote-control enabled changes', () => {
    mockStoreGet.mockImplementation((key: string) =>
        key === 'remoteControlPort' ? 9988 : undefined
    );

    handler({}, { remoteControl: true });

    expect(mockStoreSet).toHaveBeenCalledWith('remoteControl', true);
    expect(mockStoreSet).not.toHaveBeenCalledWith(
        'remoteControlPort',
        expect.anything()
    );
    expect(mockUpdateSettings).toHaveBeenCalledWith(true, 9988);
});

it('uses stored enabled state when only the remote-control port changes', () => {
    mockStoreGet.mockImplementation((key: string) =>
        key === 'remoteControl' ? true : undefined
    );

    handler({}, { remoteControlPort: 9123 });

    expect(mockStoreSet).toHaveBeenCalledWith('remoteControlPort', 9123);
    expect(mockStoreSet).not.toHaveBeenCalledWith(
        'remoteControl',
        expect.anything()
    );
    expect(mockUpdateSettings).toHaveBeenCalledWith(true, 9123);
});
```

- [ ] **Step 5: Run settings tests and refresh Electron coverage**

Run:

```bash
pnpm nx test electron-backend \
  --testPathPattern=settings.events.spec.ts \
  --runInBand
pnpm run coverage:unit:ci -- --projects=electron-backend
pnpm run coverage:merge
node tools/coverage/coverage-health.mjs --require-report
```

Expected: all settings tests PASS; settings covered statements and percentage
are above the fresh master baseline. These are characterization tests for
unchanged behavior, so no production edit is expected.

- [ ] **Step 6: Commit only the settings spec**

Run:

```bash
git add apps/electron-backend/src/app/events/settings.events.spec.ts
git commit -m "test(electron): cover settings runtime updates"
```

Expected: the provisional policy remains unstaged.

### Task 7: Expand Download Managed-Path Security Coverage

**Files:**

- Modify:
  `apps/electron-backend/src/app/events/database/downloads.events.spec.ts`
- Verify only:
  `apps/electron-backend/src/app/events/database/downloads.events.ts`

- [ ] **Step 1: Add filesystem and shell spies to the existing harness**

Add:

```typescript
const mockExistsSync = jest.fn();
const mockOpenPath = jest.fn();
const mockShowItemInFolder = jest.fn();
```

Return the two shell spies from the existing Electron mock. Reset them in
`beforeEach`; make `mockOpenPath` resolve an empty string by default.
Before importing `downloads.events`, register:

```typescript
jest.doMock('node:fs', () => ({
    existsSync: mockExistsSync,
}));
```

Add a database helper whose `limit(1)` returns either `[{ id: 42 }]`, `[]`, or
rejects:

```typescript
function mockManagedPath(result: 'managed' | 'unmanaged' | 'error') {
    const limit =
        result === 'error'
            ? jest.fn().mockRejectedValue(new Error('database unavailable'))
            : jest
                  .fn()
                  .mockResolvedValue(result === 'managed' ? [{ id: 42 }] : []);
    mockGetDatabase.mockResolvedValue({
        select: jest.fn(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({ limit })),
            })),
        })),
    });
}
```

- [ ] **Step 2: Confirm the provisional downloads ratchet is RED**

Run:

```bash
node tools/coverage/coverage-health.mjs --require-report
```

Expected: downloads is below the provisional 70-covered-statement target or
its retained 46.93% floor.

- [ ] **Step 3: Add the managed-path rejection cases**

For both `DOWNLOADS_REVEAL_FILE` and `DOWNLOADS_PLAY_FILE`, assert:

```typescript
it.each(['DOWNLOADS_REVEAL_FILE', 'DOWNLOADS_PLAY_FILE'])(
    '%s rejects a path not owned by a download row',
    async (channel) => {
        mockManagedPath('unmanaged');
        mockExistsSync.mockReturnValue(true);

        await expect(
            getHandler(channel)(null, '/tmp/unmanaged.mp4')
        ).resolves.toEqual({
            error: 'File not found',
            success: false,
        });

        expect(mockShowItemInFolder).not.toHaveBeenCalled();
        expect(mockOpenPath).not.toHaveBeenCalled();
    }
);

it.each(['DOWNLOADS_REVEAL_FILE', 'DOWNLOADS_PLAY_FILE'])(
    '%s rejects a managed path missing on disk',
    async (channel) => {
        mockManagedPath('managed');
        mockExistsSync.mockReturnValue(false);

        await expect(
            getHandler(channel)(null, '/downloads/missing.mp4')
        ).resolves.toEqual({
            error: 'File not found',
            success: false,
        });

        expect(mockShowItemInFolder).not.toHaveBeenCalled();
        expect(mockOpenPath).not.toHaveBeenCalled();
    }
);
```

- [ ] **Step 4: Add the authorized shell and database-failure cases**

Add one reveal success, one play success, and a parameterized database failure:

```typescript
it('reveals only a managed file that exists', async () => {
    mockManagedPath('managed');
    mockExistsSync.mockReturnValue(true);

    await expect(
        getHandler('DOWNLOADS_REVEAL_FILE')(null, '/downloads/movie.mp4')
    ).resolves.toEqual({ success: true });

    expect(mockShowItemInFolder).toHaveBeenCalledWith('/downloads/movie.mp4');
});

it('opens only a managed file that exists', async () => {
    mockManagedPath('managed');
    mockExistsSync.mockReturnValue(true);

    await expect(
        getHandler('DOWNLOADS_PLAY_FILE')(null, '/downloads/movie.mp4')
    ).resolves.toEqual({ success: true });

    expect(mockOpenPath).toHaveBeenCalledWith('/downloads/movie.mp4');
});
```

For the database-error cases, silence `console.error`, use
`mockManagedPath('error')`, expect the existing structured not-found response,
and assert neither shell spy ran.

- [ ] **Step 5: Run download tests and refresh Electron coverage**

Run:

```bash
pnpm nx test electron-backend \
  --testPathPattern=downloads.events.spec.ts \
  --runInBand
pnpm run coverage:unit:ci -- --projects=electron-backend
pnpm run coverage:merge
node tools/coverage/coverage-health.mjs --require-report
```

Expected: all existing destructive cleanup/pause/resume tests and all new
managed-path tests PASS. Downloads covered statements and percentage exceed
the fresh master values.

- [ ] **Step 6: Commit only the downloads spec**

Run:

```bash
git add \
  apps/electron-backend/src/app/events/database/downloads.events.spec.ts
git commit -m "test(electron): cover managed download paths"
```

Expected: the provisional policy remains the only unstaged source change.

### Task 8: Record Achieved Ratchets And Document The Integrity Contract

**Files:**

- Modify:
  `tools/coverage/coverage-policy.json`
- Modify:
  `docs/architecture/validation-map.md`
- Modify:
  `docs/superpowers/specs/2026-07-25-coverage-integrity-runtime-boundaries-design.md`
- Modify:
  `docs/superpowers/plans/2026-07-25-coverage-integrity-runtime-boundaries.md`
- Create:
  `.changes/electron-remote-static-paths.md`

- [ ] **Step 1: Generate a complete fresh candidate report**

Run:

```bash
NX_SKIP_NX_CACHE=true pnpm run coverage:ci
```

Expected: 30 Tier A reports, no `Failed to collect coverage`, no missing
runtime-owning files, and all four aggregate metrics at or above the fresh
master baseline. If any metric is lower, do not lower the baseline. Inspect
the approved boundary cases for a missing meaningful assertion, add that
failing assertion, and rerun the directly affected suite before repeating this
command.

- [ ] **Step 2: Print exact achieved aggregate and per-file values**

Run:

```bash
node --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const data = JSON.parse(
    fs.readFileSync('coverage/merged/coverage-final.json', 'utf8')
);
const map = createCoverageMap(data);
const targets = [
    'apps/electron-backend/src/app/server/http-server.ts',
    'apps/electron-backend/src/app/events/remote-control.events.ts',
    'apps/electron-backend/src/app/events/settings.events.ts',
    'apps/electron-backend/src/app/events/database/downloads.events.ts',
];
const criticalFiles = targets.map((file) => {
    const statements = map
        .fileCoverageFor(path.resolve(file))
        .toSummary()
        .toJSON().statements;
    return {
        path: file,
        statements: {
            minimumCovered: statements.covered,
            minimumPercent: statements.pct,
        },
    };
});
const summary = map.getCoverageSummary().toJSON();
console.log(
    JSON.stringify(
        {
            merged: {
                statements: summary.statements.pct,
                branches: summary.branches.pct,
                functions: summary.functions.pct,
                lines: summary.lines.pct,
            },
            criticalFiles,
        },
        null,
        4
    )
);
NODE
```

Expected: a complete `coverageRatchet` value with nonzero HTTP/remote values
and settings/download values no lower than their baseline. Copy this exact
JSON object over the provisional `reporting.coverageRatchet`; do not round
manually or retain the provisional one-statement probes.

- [ ] **Step 3: Verify the achieved ratchet passes and rejects regressions**

Run:

```bash
pnpm run coverage:health -- --require-report
node --test tools/coverage/coverage-integrity.test.mjs
```

Expected: both exit 0. The synthetic Node tests still prove below-ratchet
metrics, missing critical files, missing reports, and collection markers fail.

- [ ] **Step 4: Update the canonical validation map**

Under `## Coverage Tiers` in `docs/architecture/validation-map.md`, add:

```markdown
Tier A coverage is fail-closed. `coverage:unit:ci` relays Jest output but exits
nonzero on `Failed to collect coverage`, a missing/invalid project report, or
a runtime-owning production TypeScript file absent from that report.
`coverage:merge` requires every configured Tier A report before replacing the
merged output, and `coverage:health --require-report` repeats completeness plus
aggregate and critical-file ratchets.

Runtime-owning files are discovered from the TypeScript AST. Specs, declarations,
test setup/stubs, generated/environment files, `index.ts`, type-only files, and
pure re-export shims do not count as executable coverage inputs.

Ratchets live under `reporting.coverageRatchet` in
`tools/coverage/coverage-policy.json`. Update them only from a fresh full
`coverage:ci` report when every value stays level or rises; never lower a
ratchet to accept a regression. The only exception is a reviewed production
source shrink: `minimumCovered` may follow a lower statement total when the PR
identifies the removed executable statements and fresh coverage proves that
the file percentage, aggregate ratchets, and remaining behavioral coverage do
not decrease.
```

Also include `pnpm run coverage:tools:test` in the local coverage command block.

- [ ] **Step 5: Confirm documentation and release-note decisions**

Because the real-loopback regression exposed and fixed an observable Windows
static-path traversal escape, add `.changes/electron-remote-static-paths.md`:

```markdown
---
type: fix
area: electron
---

The desktop remote-control server now blocks crafted static paths from escaping
bundled web files on Windows.
```

Run:

```bash
pnpm exec prettier --check \
  docs/architecture/validation-map.md \
  docs/superpowers/specs/2026-07-25-coverage-integrity-runtime-boundaries-design.md \
  docs/superpowers/plans/2026-07-25-coverage-integrity-runtime-boundaries.md \
  .changes/electron-remote-static-paths.md
pnpm run release:notes:validate
```

Expected: both pass. The release note records the narrow user-visible security
fix; do not apply `no-release-note` in Task 10.

- [ ] **Step 6: Commit ratchets and docs**

Run:

```bash
git add \
  tools/coverage/coverage-policy.json \
  docs/architecture/validation-map.md \
  docs/superpowers/specs/2026-07-25-coverage-integrity-runtime-boundaries-design.md \
  docs/superpowers/plans/2026-07-25-coverage-integrity-runtime-boundaries.md \
  .changes/electron-remote-static-paths.md
git commit -m "ci(coverage): ratchet runtime boundaries"
```

Expected: the provisional policy is replaced by achieved values, the security
fix has a valid release note, and the worktree becomes clean.

### Task 9: Run Fresh Validation And Audit The Final Diff

**Files:**

- Verify only: all changed files
- Verify only:
  `apps/electron-backend-e2e/src/downloads.e2e.ts`
- Verify only:
  `apps/electron-backend-e2e/src/remote-control.e2e.ts`
- Verify only:
  `apps/electron-backend-e2e/src/settings.e2e.ts`

- [ ] **Step 1: Run targeted unit, lint, and type checks**

Run:

```bash
pnpm run coverage:tools:test
pnpm nx test electron-backend --skip-nx-cache --runInBand
pnpm nx test m3u-state --skip-nx-cache --runInBand
pnpm nx lint electron-backend --skip-nx-cache
pnpm nx lint m3u-state --skip-nx-cache
pnpm run typecheck:backend
```

Expected: every command exits 0; no Jest suite, lint rule, or backend type
check fails.

- [ ] **Step 2: Run the three existing Electron E2E contracts**

Run:

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/remote-control.e2e.ts --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/settings.e2e.ts --skip-nx-cache
```

Expected: all targets PASS. These prove the real packaged-style Electron IPC,
native folder/download flow, remote loopback server, renderer command, and
settings persistence contracts beyond unit mocks.

- [ ] **Step 3: Build the production Electron target**

Run:

```bash
pnpm nx build electron-backend \
  --configuration=production \
  --skip-nx-cache
```

Expected: exit 0, including worker, web, and remote-control-web dependencies.

- [ ] **Step 4: Run final full coverage from scratch**

Run:

```bash
NX_SKIP_NX_CACHE=true pnpm run coverage:ci
```

Expected:

- all coverage-tool tests PASS;
- policy sees 30 Tier A projects;
- all 30 project reports are merged;
- `effects.ts` is present;
- no collection marker or runtime-owning source omission is reported;
- achieved aggregate and critical-file ratchets PASS.

- [ ] **Step 5: Inspect exact metrics and scoped diff**

Run:

```bash
git diff origin/master...HEAD --check
git diff --stat origin/master...HEAD
git diff --name-only origin/master...HEAD
git status --short --branch
```

Expected:

- no whitespace errors;
- only the files in this plan appear;
- no database worker, dashboard, Stalker search, type-only interface, lockfile,
  AGENTS, or CLAUDE changes appear;
- the worktree is clean.

- [ ] **Step 6: Apply verification-before-completion**

Read and follow `verification-before-completion`. Record, without paraphrasing
away failures:

- exact unit suite/test counts;
- exact E2E results;
- lint/typecheck/build exit results;
- 30/30 Tier A report integrity;
- aggregate before/after;
- all selected-file before/after values;
- docs and release-note decisions.

Do not claim completion from cached or earlier output.

### Task 10: Recheck Master, Push, And Open The Draft PR

**Files:**

- Verify only: current branch history and GitHub PR metadata

- [ ] **Step 1: Recheck master before publication**

Run:

```bash
git fetch origin master --prune
git log --oneline HEAD..origin/master
```

Expected: no output. If master advanced, rebase, rerun dependency bootstrap and
all of Task 9, then refresh ratchets only upward before publication.

- [ ] **Step 2: Review conventional history**

Run:

```bash
git log --oneline origin/master..HEAD
git status --short --branch
```

Expected: concise conventional commits, including the design and plan docs,
with a clean worktree.

- [ ] **Step 3: Push the agent branch**

Run:

```bash
git push -u origin agent/coverage-integrity-runtime-boundaries
```

Expected: push succeeds and sets the upstream.

- [ ] **Step 4: Create a draft PR**

Read and follow `github-pr`. Create a draft targeting `master` with title:

```text
test(electron): harden runtime coverage integrity
```

The body must contain:

- fresh baseline commit and aggregate metrics;
- exact after metrics;
- selected-file before/after table;
- behavioral contracts for HTTP, remote control, settings, and downloads;
- the two behavior-preserving production seams;
- the `effects.ts` compiler/instrumentation correction;
- runner, merge, health, and ratchet behavior;
- exact validation commands/results;
- docs update;
- the Electron fix release note for Windows static-path containment; and
- deferred `database.worker.ts`, dashboard rails, and Stalker search.

Use:

```bash
gh pr create \
  --draft \
  --base master \
  --head agent/coverage-integrity-runtime-boundaries \
  --title "test(electron): harden runtime coverage integrity" \
  --body-file -
```

Provide the fully populated body on standard input; do not leave metric or
validation placeholders.

- [ ] **Step 5: Verify release-note metadata**

Run:

```bash
gh pr view --json url,isDraft,headRefName,baseRefName,labels,files,commits,statusCheckRollup
```

Expected: the PR is draft, head/base are correct,
`.changes/electron-remote-static-paths.md` is included, `no-release-note` is
absent, and the command prints the PR URL.

- [ ] **Step 6: Return the exact handoff**

Return:

- draft PR URL;
- branch;
- final commit SHA;
- aggregate and selected-file before/after metrics;
- exact command results and any explicit environment-only skip;
- docs updated (`docs/architecture/validation-map.md`);
- release note added (`.changes/electron-remote-static-paths.md`) with no
  `no-release-note` label;
- deferred zero-coverage follow-ups.
