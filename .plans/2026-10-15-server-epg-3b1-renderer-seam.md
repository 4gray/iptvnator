# Server EPG 3b-1: Renderer EPG Backend Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every renderer EPG call and every `supportsEpg*` capability through one injectable EPG runtime backend (default: `window.electron`), without changing behavior, so PR 3d can provide a server-backed backend with the same method shapes.

**Architecture:** `@iptvnator/shared/interfaces` gains the method list and the `EpgRuntimeBackend` type; `@iptvnator/services` gains the `EPG_RUNTIME_BACKEND` token whose default resolver returns `window.electron` on every call. A new internal class `EpgRuntimeCapabilities` answers every `supportsEpg*` flag on the resolved backend ("a capability is: the method is present on the backend"), and `RuntimeCapabilitiesService` keeps its public getters as one-line delegates to it, which also keeps that file under 300 lines; `EpgRuntimeBridgeService` and `EpgSourceSettingsService` call the resolved backend; the four Xtream portal places that still read `window.electron` move behind `EpgRuntimeBridgeService`. Because `RuntimeCapabilitiesService` now injects a token, the pre-bootstrap server probe stops constructing it with `new` and uses a new injector-free `isElectronRuntime()`.

**Tech Stack:** Angular 22 (`inject`, `InjectionToken`, signals), NgRx Signals, Jest 30 with jest-preset-angular (TestBed), Nx 23, Playwright (Electron and web E2E).

Spec: `docs/superpowers/specs/2026-10-15-server-epg-design.md` (sections 4, 6.3 "Seam (3b)", 9, 13). Overview and shared contract A: `.plans/2026-10-15-server-epg.md`.

---

## Contract deviations

None to the shapes of shared contract A: `EPG_RUNTIME_BACKEND_METHODS`, `EpgRuntimeBackendMethod`, `EpgRuntimeBackend`, `EpgRuntimeBackendResolver` and `EPG_RUNTIME_BACKEND` are implemented as written (Prettier may wrap the token declaration; the code is the same).

Additions and clarifications, none of which changes contract A:

1. **`isElectronRuntime()` (new export of `@iptvnator/services`).** `apps/web/src/main.ts:30` calls `probeServerInstance()` before Angular bootstraps, and `apps/web/src/app/server-storage/server-instance-probe.ts:38-39` evaluates `new RuntimeCapabilitiesService().isElectron` there. Once the service has a field `inject(EPG_RUNTIME_BACKEND)`, that `new` throws NG0203 (no injection context) and the app never bootstraps. The probe switches to `isElectronRuntime()`, which `RuntimeCapabilitiesService.isElectron` also uses, so the runtime has one definition (Task 3).
2. **"`bridge` returns `inject(EPG_RUNTIME_BACKEND)()`"** is implemented as a field `resolveEpgBackend = inject(EPG_RUNTIME_BACKEND)` plus a getter that calls it: `inject()` cannot run inside a getter after construction.
3. **No new bridge method.** The Xtream fallback needs `getChannelPrograms` and `getCurrentProgramsBatch`, the mapping callers need `getEpgMapping` and `getEpgMappingsBatch`; `EpgRuntimeBridgeService` already has all four (`libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts:171-203, 274-297`). `getEpgChannels` exists on `ElectronBridgeApi` (`electron-api.interface.ts:901`) but no renderer code calls it, so it stays out of `EPG_RUNTIME_BACKEND_METHODS`.
4. **Location fix.** `epg-queue.service.ts` lives in `libs/portal/xtream/data-access/src/lib/services/`, not in `libs/portal/xtream/feature`.
5. **One gate becomes the capability.** `EpgQueueService.enqueue` gated the mapping lookup on `typeof window.electron?.getEpgMappingsBatch === 'function'`; it now gates on `EpgRuntimeBridgeService.supportsEpgMapping` (four mapping methods), as Stalker does (`with-stalker-epg.feature.ts:362`). The preload exposes all five mapping methods together (`apps/electron-backend/src/app/api/main.preload.ts:710-727`), so desktop and PWA answers are identical; a hypothetical preload with only `getEpgMappingsBatch` no longer resolves mappings. Accepted by the maintainer.
6. **The resolver is stored, never its result.** PR 3d provides `EPG_RUNTIME_BACKEND` with a lazily created resolver (the server backend is created on the first call, to avoid a DI cycle with `ServerStorageSession`). Every consumer in this plan (`EpgRuntimeCapabilities`, `EpgRuntimeBridgeService`, `EpgSourceSettingsService`) keeps the resolver function and calls it at use time; no field holds a backend object. `EpgSourceSettingsService.reconcile` holds the backend only in a local variable for one call. `EpgRuntimeCapabilities` and `RuntimeCapabilitiesService` specs assert that a backend changed after construction is seen on the next read.
7. **EPG flag logic in its own file.** By the maintainer's decision, `runtime-capabilities.service.ts` stays under 300 counted lines: the flags move to `libs/services/src/lib/epg-runtime-capabilities.ts` (internal, not exported from the barrel) with its own table-driven spec, and the service's `supportsEpg*` getters delegate to it unchanged in name and type.

## Findings this plan relies on (verified on `origin/master` at `002faebb0`)

- **Direct EPG uses of `window.electron` in renderer code** (`git grep` over `libs`, `apps/web/src`, `apps/remote-control-web/src`, specs excluded):
  - `libs/services/src/lib/epg-source-settings.service.ts:83-87, 120-121` (`reconcileEpgSources`)
  - `libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts:10-38` (`getChannelPrograms`, `getCurrentProgramsBatch` through a private `bridge` getter)
  - `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts:188-203` (`getEpgMapping`)
  - `libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts:195, 291-294` (`getEpgMappingsBatch`)
  - `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts:770-790` (`getEpgMapping`)
  - `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts:349-355` (the bridge itself) and `libs/services/src/lib/runtime-capabilities.service.ts:113-169` (the EPG flags)
  - Not EPG, left alone: `recordings.service.ts:120` (`recordingsUpdatePrograms`), `xtream-api.service.ts:99-105`, `xtream-url.service.ts:326`, `with-recent-items.ts:304-313`, `live-stream-layout.component.ts:1059`.
  - Already on the bridge: `epg-mapping-dialog.component.ts`, `playlist-info.component.ts`, `with-stalker-epg.feature.ts`, `stream-resolver.service.ts`, `global-favorites-list.component.ts`, `apps/web/src/app/settings/settings-epg.facade.ts`.
- **Who constructs the changed services outside a root injector.**
  - `new RuntimeCapabilitiesService()`: `server-instance-probe.ts:39` (production, pre-bootstrap) and 24 times in `runtime-capabilities.service.spec.ts`. 80 spec files replace the service with `useValue`; they never construct it and are unaffected.
  - `Injector.create` has no `root` scope (`R3Injector.injectableDefInScope`), so a root-provided token does not resolve there. `EpgSourceSettingsService` is a class provider in `Injector.create` in `epg-source-settings.service.spec.ts` (5×), `settings-store.service.spec.ts:50, 613` and `settings-store.embedded-mpv.spec.ts:63`; those providers lists get the token.
  - TestBed injectors have the `root` scope; every other spec keeps working because the default resolver reads `window.electron`, as the code does today.
- **Nx boundaries.** `portal-xtream-data-access` (`scope:portal`, `domain:xtream`, `type:data-access`) and `portal-xtream-feature` (`type:feature`) may import `@iptvnator/epg/data-access` (`scope:shared`, `domain:playback`, `type:data-access`): `type:data-access` → `type:data-access` and `type:feature` → `type:data-access` are allowed, and `domain:xtream` lists `domain:playback` (`eslint.config.mjs:89-95, 73-80, 179-190`). `epg-data-access` depends only on `services`, `shared-interfaces` and `shared/m3u-utils`, so the new edge creates no cycle. Precedent: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-epg.feature.ts:10`. Routing through the token from `@iptvnator/services` instead is therefore not needed.
- **File sizes.** `runtime-capabilities.service.ts` has 296 counted lines on master; with the EPG flags moved to `epg-runtime-capabilities.ts` (about 75 lines) and one-line delegates left behind, it ends near 285, below the 300 target. `portal-channels-list.component.ts` is baselined in `tools/eslint/max-lines-baseline.mjs:46` and shrinks; the baseline is not touched. Every other production file stays under 300.
- **Coverage.** All six touched projects are Tier A and `collectCoverageFrom` includes every source file, so the new `epg-runtime-backend.ts` gets its own spec in `shared-interfaces`.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/shared/interfaces/src/lib/epg-runtime-backend.ts` | create | `EPG_RUNTIME_BACKEND_METHODS`, `EpgRuntimeBackendMethod`, `EpgRuntimeBackend` |
| `libs/shared/interfaces/src/lib/epg-runtime-backend.spec.ts` | create | Method list sanity |
| `libs/shared/interfaces/src/index.ts` | modify | Export the contract |
| `libs/services/src/lib/epg-runtime-backend.token.ts` | create | `EpgRuntimeBackendResolver`, `EPG_RUNTIME_BACKEND` |
| `libs/services/src/lib/epg-runtime-backend.token.spec.ts` | create | Default resolver, override |
| `libs/services/src/index.ts` | modify | Export the token |
| `libs/services/src/lib/epg-runtime-capabilities.ts` | create | `EpgRuntimeCapabilities`: every `supportsEpg*` flag on the resolved backend |
| `libs/services/src/lib/epg-runtime-capabilities.spec.ts` | create | Table-driven flag tests, composition, resolver read per check |
| `libs/services/src/lib/runtime-capabilities.service.ts` | modify | `isElectronRuntime()`; EPG getters delegate to `EpgRuntimeCapabilities` |
| `libs/services/src/lib/runtime-capabilities.service.spec.ts` | modify | Construct through TestBed; delegation tests |
| `apps/web/src/app/server-storage/server-instance-probe.ts` | modify | Use `isElectronRuntime()` |
| `apps/web/src/app/server-storage/server-instance-probe.spec.ts` | modify | Pre-bootstrap guard test |
| `libs/services/src/lib/epg-source-settings.service.ts` | modify | Reconcile through the backend |
| `libs/services/src/lib/epg-source-settings.service.spec.ts` | modify | Provide the token; backend tests |
| `libs/services/src/lib/settings-store.service.spec.ts`, `settings-store.embedded-mpv.spec.ts` | modify | Provide the token in `Injector.create` |
| `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts` | modify | Call the backend; drop `EpgElectronBridge` |
| `libs/epg/data-access/src/lib/epg-runtime-bridge.service.spec.ts` | modify | Delegation to a provided backend |
| `libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts` (+ spec) | modify | XMLTV reads through the bridge |
| `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts` (+ spec) | modify | Mapping lookup through the bridge |
| `libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts` (+ spec) | modify | Batch mapping lookup through the bridge |
| `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts` (+ spec) | modify | Mapping read through the bridge |
| `docs/architecture/pwa-self-hosted.md` | modify | Capabilities paragraph |
| `docs/architecture/m3u-playlist-module.md` | modify | Source reconciliation |

Test commands: the five libraries use `@nx/jest:jest` with their `jest.config.ts` (jest-preset-angular, TestBed via `setupZonelessTestEnv`), so `pnpm nx test <project> --testPathPatterns=<regex>` (Jest 30 spells the flag in the plural). `web`'s `test` target is `nx:run-commands` running `node ./node_modules/jest/bin/jest.js --config apps/web/jest.config.ts` with `NODE_OPTIONS=--experimental-vm-modules` and `forwardAllArgs`, so the same flag reaches Jest.

Formatting: run `pnpm exec prettier --write` on files a task **creates**. The snippets for modified files are already in the repository's Prettier style (4 spaces, single quotes, width 80); do not run Prettier on whole existing files.

---

### Task 1: Worktree and baseline

**Files:** none.

- [ ] **Step 1: Create the worktree from `origin/master`**

This plan lives on `claude/server-epg` (worktree `.claude/worktrees/server-epg`); read it from there. From the main checkout's root:

```bash
git fetch origin
git worktree add .claude/worktrees/server-epg-seam -b claude/server-epg-seam origin/master
cd .claude/worktrees/server-epg-seam
git log -1 --oneline
```

Expected: a new worktree on `claude/server-epg-seam`, HEAD equal to `origin/master` (`002faebb0` or later).

- [ ] **Step 2: Install and verify discovery**

```bash
node --version && cat .nvmrc
pnpm install --frozen-lockfile
pnpm nx show projects | grep -xE 'shared-interfaces|services|epg-data-access|portal-xtream-data-access|portal-xtream-feature|web|web-e2e|electron-backend-e2e'
node tools/testing/ensure-electron-binary.mjs
```

Expected: the Node major matches `.nvmrc` (22); install exits 0; grep prints all eight project names; the Electron binary check reports the pinned version.

- [ ] **Step 3: Record the baseline**

```bash
BASELINE="${TMPDIR:-/tmp}/server-epg-seam-baseline.txt"
: > "$BASELINE"
for p in shared-interfaces services epg-data-access portal-xtream-data-access portal-xtream-feature; do
  echo "== $p" >> "$BASELINE"
  pnpm nx test "$p" 2>&1 | grep -E "Test Suites:|Tests:" >> "$BASELINE"
done
echo "== web (probe)" >> "$BASELINE"
pnpm nx test web --testPathPatterns=server-instance-probe 2>&1 | grep -E "Test Suites:|Tests:" >> "$BASELINE"
cat "$BASELINE"
```

Expected: every project passes. If anything fails before a change, stop and report it; do not fix unrelated failures on this branch.

---

### Task 2: The EPG runtime backend contract

**Files:**
- Create: `libs/shared/interfaces/src/lib/epg-runtime-backend.ts`
- Create: `libs/shared/interfaces/src/lib/epg-runtime-backend.spec.ts`
- Modify: `libs/shared/interfaces/src/index.ts:13`
- Create: `libs/services/src/lib/epg-runtime-backend.token.ts`
- Create: `libs/services/src/lib/epg-runtime-backend.token.spec.ts`
- Modify: `libs/services/src/index.ts:26`

- [ ] **Step 1: Write the failing specs**

Create `libs/shared/interfaces/src/lib/epg-runtime-backend.spec.ts`:

```ts
import { EPG_RUNTIME_BACKEND_METHODS } from './epg-runtime-backend';

describe('EPG_RUNTIME_BACKEND_METHODS', () => {
    it('lists each renderer EPG bridge method once', () => {
        expect(EPG_RUNTIME_BACKEND_METHODS).toHaveLength(19);
        expect(new Set(EPG_RUNTIME_BACKEND_METHODS).size).toBe(19);
    });

    it('includes the calls the renderer makes without a capability flag', () => {
        expect(EPG_RUNTIME_BACKEND_METHODS).toEqual(
            expect.arrayContaining([
                'reconcileEpgSources',
                'getEpgMappingsBatch',
                'onEpgProgress',
            ])
        );
    });
});
```

Create `libs/services/src/lib/epg-runtime-backend.token.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { EPG_RUNTIME_BACKEND } from './epg-runtime-backend.token';

describe('EPG_RUNTIME_BACKEND', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        testWindow.electron = originalElectron;
        TestBed.resetTestingModule();
    });

    it('resolves window.electron on every call by default', () => {
        const resolve = TestBed.inject(EPG_RUNTIME_BACKEND);

        testWindow.electron = undefined;
        expect(resolve()).toBeUndefined();

        const bridge = { fetchEpg: jest.fn() };
        testWindow.electron = bridge;
        expect(resolve()).toBe(bridge);
    });

    it('lets a provider replace the default resolver', () => {
        const backend = { fetchEpg: jest.fn() };
        TestBed.configureTestingModule({
            providers: [
                { provide: EPG_RUNTIME_BACKEND, useValue: () => backend },
            ],
        });
        testWindow.electron = { fetchEpg: jest.fn() };

        expect(TestBed.inject(EPG_RUNTIME_BACKEND)()).toBe(backend);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm nx test shared-interfaces --testPathPatterns=epg-runtime-backend
pnpm nx test services --testPathPatterns=epg-runtime-backend
```

Expected: both FAIL with `Cannot find module './epg-runtime-backend'` and `Cannot find module './epg-runtime-backend.token'`.

- [ ] **Step 3: Create the contract in `@iptvnator/shared/interfaces`**

Create `libs/shared/interfaces/src/lib/epg-runtime-backend.ts`:

```ts
import type { ElectronBridgeApi } from './electron-api.interface';

/**
 * Bridge methods the renderer's EPG layer calls. A capability is "the method
 * is present on the selected backend".
 */
export const EPG_RUNTIME_BACKEND_METHODS = [
    'fetchEpg',
    'forceFetchEpg',
    'openEpgFileDialog',
    'clearEpgData',
    'clearEpgDataForSource',
    'reconcileEpgSources',
    'getChannelPrograms',
    'getCurrentProgramsBatch',
    'getEpgChannelMetadata',
    'checkEpgFreshness',
    'getEpgProgramsForChannels',
    'getEpgProgramCoverage',
    'searchEpgPrograms',
    'onEpgProgress',
    'getEpgMapping',
    'getEpgMappingsBatch',
    'setEpgMapping',
    'deleteEpgMapping',
    'searchEpgChannels',
] as const;

export type EpgRuntimeBackendMethod =
    (typeof EPG_RUNTIME_BACKEND_METHODS)[number];

export type EpgRuntimeBackend = Partial<
    Pick<ElectronBridgeApi, EpgRuntimeBackendMethod>
>;
```

In `libs/shared/interfaces/src/index.ts`, replace

```ts
export * from './lib/electron-api.interface';
```

with

```ts
export * from './lib/electron-api.interface';
export * from './lib/epg-runtime-backend';
```

- [ ] **Step 4: Create the token in `@iptvnator/services`**

Create `libs/services/src/lib/epg-runtime-backend.token.ts`:

```ts
import { InjectionToken } from '@angular/core';
import type { EpgRuntimeBackend } from '@iptvnator/shared/interfaces';

/** Resolves the EPG backend on every call, as `window.electron` is read today. */
export type EpgRuntimeBackendResolver = () => EpgRuntimeBackend | undefined;

export const EPG_RUNTIME_BACKEND = new InjectionToken<EpgRuntimeBackendResolver>(
    'EPG_RUNTIME_BACKEND',
    {
        providedIn: 'root',
        factory: () => () =>
            typeof window === 'undefined' ? undefined : window.electron,
    }
);
```

In `libs/services/src/index.ts`, replace

```ts
export * from './lib/epg-source-settings.service';
```

with

```ts
export * from './lib/epg-runtime-backend.token';
export * from './lib/epg-source-settings.service';
```

Format the new files:

```bash
pnpm exec prettier --write libs/shared/interfaces/src/lib/epg-runtime-backend.ts libs/shared/interfaces/src/lib/epg-runtime-backend.spec.ts libs/services/src/lib/epg-runtime-backend.token.ts libs/services/src/lib/epg-runtime-backend.token.spec.ts
```

- [ ] **Step 5: Run the specs to verify they pass**

```bash
pnpm nx test shared-interfaces --testPathPatterns=epg-runtime-backend
pnpm nx test services --testPathPatterns=epg-runtime-backend
pnpm nx run-many -t lint -p shared-interfaces services
```

Expected: PASS (2 tests each); lint clean. `Pick<ElectronBridgeApi, EpgRuntimeBackendMethod>` would not compile if a listed name were not a bridge method, so the list is checked against `ElectronBridgeApi` by the type checker.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/interfaces/src/lib/epg-runtime-backend.ts libs/shared/interfaces/src/lib/epg-runtime-backend.spec.ts libs/shared/interfaces/src/index.ts libs/services/src/lib/epg-runtime-backend.token.ts libs/services/src/lib/epg-runtime-backend.token.spec.ts libs/services/src/index.ts
git commit -m "refactor(epg): add the EPG runtime backend contract and token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: An injector-free Electron check for the pre-bootstrap probe

**Files:**
- Modify: `libs/services/src/lib/runtime-capabilities.service.ts:22-32`
- Modify: `libs/services/src/lib/runtime-capabilities.service.spec.ts:1, 9-11`
- Modify: `apps/web/src/app/server-storage/server-instance-probe.ts:1, 36-39`
- Modify: `apps/web/src/app/server-storage/server-instance-probe.spec.ts` (after the test `skips the probe in Electron`)

This task must land before Task 5: after Task 5 `new RuntimeCapabilitiesService()` throws outside an injection context, and `main.ts` would never bootstrap.

- [ ] **Step 1: Write the failing test and the probe guard**

In `libs/services/src/lib/runtime-capabilities.service.spec.ts`, replace line 1

```ts
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
```

with

```ts
import {
    isElectronRuntime,
    RuntimeCapabilitiesService,
} from './runtime-capabilities.service';
```

and replace

```ts
    afterEach(() => {
        testWindow.electron = originalElectron;
    });
```

with

```ts
    afterEach(() => {
        testWindow.electron = originalElectron;
    });

    it('detects the Electron runtime without an injector', () => {
        testWindow.electron = undefined;
        expect(isElectronRuntime()).toBe(false);

        testWindow.electron = {};
        expect(isElectronRuntime()).toBe(true);
    });
```

In `apps/web/src/app/server-storage/server-instance-probe.spec.ts`, insert after the test `'skips the probe in Electron'` (it ends with `expect(fetchFn).not.toHaveBeenCalled();` and `});`):

```ts
    it('detects Electron before bootstrap, without an injector', async () => {
        const originalElectron = window.electron;
        window.electron = {} as typeof window.electron;
        try {
            const fetchFn = answer(instance);
            await expect(
                probeServerInstance({
                    runtimeConfig: { BACKEND_URL: '/api' },
                    fetchFn: fetchFn as never,
                })
            ).resolves.toEqual({ kind: 'skipped' });
            expect(fetchFn).not.toHaveBeenCalled();
        } finally {
            window.electron = originalElectron;
        }
    });
```

- [ ] **Step 2: Run them**

```bash
pnpm nx test services --testPathPatterns=runtime-capabilities
pnpm nx test web --testPathPatterns=server-instance-probe
```

Expected: `services` FAILS with `isElectronRuntime is not a function` (or a TS import error). The probe test PASSES already: it is the guard that fails with NG0203 if Task 5 ever runs without this task's probe change.

- [ ] **Step 3: Add `isElectronRuntime()` and use it in `isElectron`**

In `libs/services/src/lib/runtime-capabilities.service.ts`, replace

```ts
];

@Injectable({ providedIn: 'root' })
export class RuntimeCapabilitiesService {
    get environment(): RuntimeEnvironment {
        return this.isElectron ? 'electron' : 'pwa';
    }

    get isElectron(): boolean {
        return !!this.electronBridge;
    }
```

with

```ts
];

/**
 * True when the Electron preload exposed `window.electron`. It needs no
 * injector, so code that runs before Angular bootstraps (the server instance
 * probe in `main.ts`) shares the definition of `isElectron`.
 */
export function isElectronRuntime(): boolean {
    return typeof window !== 'undefined' && !!window.electron;
}

@Injectable({ providedIn: 'root' })
export class RuntimeCapabilitiesService {
    get environment(): RuntimeEnvironment {
        return this.isElectron ? 'electron' : 'pwa';
    }

    get isElectron(): boolean {
        return isElectronRuntime();
    }
```

- [ ] **Step 4: Switch the probe**

In `apps/web/src/app/server-storage/server-instance-probe.ts`, replace

```ts
import { RuntimeCapabilitiesService, takeSlowStart } from '@iptvnator/services';
```

with

```ts
import { isElectronRuntime, takeSlowStart } from '@iptvnator/services';
```

and replace

```ts
    // The capability service has no dependencies, so it works before
    // bootstrap and keeps one definition of the desktop runtime.
    const isElectron =
        options.isElectron ?? new RuntimeCapabilitiesService().isElectron;
```

with

```ts
    // Runs before bootstrap, without an injector; `isElectronRuntime()` is
    // the same check as `RuntimeCapabilitiesService.isElectron`.
    const isElectron = options.isElectron ?? isElectronRuntime();
```

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm nx test services --testPathPatterns=runtime-capabilities
pnpm nx test web --testPathPatterns=server-instance-probe
git grep -n "new RuntimeCapabilitiesService" -- apps
pnpm nx run-many -t lint -p services web
```

Expected: both PASS; the grep prints nothing (exit code 1); lint clean.

- [ ] **Step 6: Commit**

```bash
git add libs/services/src/lib/runtime-capabilities.service.ts libs/services/src/lib/runtime-capabilities.service.spec.ts apps/web/src/app/server-storage/server-instance-probe.ts apps/web/src/app/server-storage/server-instance-probe.spec.ts
git commit -m "refactor(services): detect Electron before bootstrap without the capability service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The EPG capability logic in its own file

**Files:**
- Create: `libs/services/src/lib/epg-runtime-capabilities.ts`
- Create: `libs/services/src/lib/epg-runtime-capabilities.spec.ts`

`runtime-capabilities.service.ts` must stay under 300 counted lines, so the EPG flags move into a plain class that takes the `EpgRuntimeBackendResolver`. It keeps the resolver and calls it on every read; it never stores the backend object (PR 3d's resolver creates its backend lazily on the first call). The class is internal to `libs/services` and not exported from the barrel. Its spec is plain Jest, no TestBed.

- [ ] **Step 1: Write the failing spec**

Create `libs/services/src/lib/epg-runtime-capabilities.spec.ts`:

```ts
import {
    EPG_RUNTIME_BACKEND_METHODS,
    EpgRuntimeBackend,
    EpgRuntimeBackendMethod,
} from '@iptvnator/shared/interfaces';
import { EpgRuntimeCapabilities } from './epg-runtime-capabilities';

/** Every narrow EPG flag; `supportsEpg` is their composition. */
type EpgFlag = Exclude<
    Extract<keyof EpgRuntimeCapabilities, `supportsEpg${string}`>,
    'supportsEpg'
>;

/**
 * The methods each flag required when `RuntimeCapabilitiesService` checked
 * it on `window.electron` (master, lines 113-169). `satisfies` forces an
 * entry for every flag, so a new flag cannot skip this table.
 */
const EPG_FLAG_METHODS = {
    supportsEpgImport: ['fetchEpg'],
    supportsEpgFilePicker: ['openEpgFileDialog'],
    supportsEpgProgress: ['onEpgProgress'],
    supportsEpgProgramLookup: ['getChannelPrograms'],
    supportsEpgCurrentProgramBatch: ['getCurrentProgramsBatch'],
    supportsEpgChannelMetadata: ['getEpgChannelMetadata'],
    supportsEpgSourceFreshness: ['checkEpgFreshness'],
    supportsEpgDataManagement: [
        'forceFetchEpg',
        'clearEpgData',
        'clearEpgDataForSource',
    ],
    supportsEpgGuide: ['getEpgProgramsForChannels', 'getEpgProgramCoverage'],
    supportsEpgProgramSearch: ['searchEpgPrograms'],
    supportsEpgMapping: [
        'getEpgMapping',
        'setEpgMapping',
        'deleteEpgMapping',
        'searchEpgChannels',
    ],
} as const satisfies Record<EpgFlag, readonly EpgRuntimeBackendMethod[]>;

const EPG_FLAG_CASES = Object.entries(EPG_FLAG_METHODS) as [
    EpgFlag,
    readonly EpgRuntimeBackendMethod[],
][];

/** What `supportsEpg` needs: import, lookup, freshness, management, guide, search. */
const FULL_EPG_METHODS: readonly EpgRuntimeBackendMethod[] = [
    'fetchEpg',
    'getChannelPrograms',
    'checkEpgFreshness',
    'forceFetchEpg',
    'clearEpgData',
    'clearEpgDataForSource',
    'getEpgProgramsForChannels',
    'getEpgProgramCoverage',
    'searchEpgPrograms',
];

describe('EpgRuntimeCapabilities', () => {
    it('names every backend method in a flag except the two flagless calls', () => {
        const flagged = new Set<string>(Object.values(EPG_FLAG_METHODS).flat());

        expect(
            EPG_RUNTIME_BACKEND_METHODS.filter((method) => !flagged.has(method))
        ).toEqual(['reconcileEpgSources', 'getEpgMappingsBatch']);
    });

    it.each(EPG_FLAG_CASES)(
        '%s is true exactly when the backend has %j',
        (flag, methods) => {
            let backend: EpgRuntimeBackend | undefined = backendWith(methods);
            const capabilities = new EpgRuntimeCapabilities(() => backend);

            expect(capabilities[flag]).toBe(true);

            for (const missing of methods) {
                backend = backendWith(
                    methods.filter((method) => method !== missing)
                );
                expect(capabilities[flag]).toBe(false);
            }

            backend = undefined;
            expect(capabilities[flag]).toBe(false);
        }
    );

    it('composes supportsEpg from import, lookup, freshness, management, guide and search', () => {
        let backend: EpgRuntimeBackend | undefined =
            backendWith(FULL_EPG_METHODS);
        const capabilities = new EpgRuntimeCapabilities(() => backend);

        // No file picker, progress push, batch, metadata or mapping needed.
        expect(capabilities.supportsEpg).toBe(true);

        for (const missing of FULL_EPG_METHODS) {
            backend = backendWith(
                FULL_EPG_METHODS.filter((method) => method !== missing)
            );
            expect(capabilities.supportsEpg).toBe(false);
        }
    });

    it('asks the resolver on every read and never at construction', () => {
        let backend: EpgRuntimeBackend | undefined = undefined;
        const resolve = jest.fn(() => backend);
        const capabilities = new EpgRuntimeCapabilities(resolve);

        expect(resolve).not.toHaveBeenCalled();
        expect(capabilities.supportsEpgImport).toBe(false);

        // A backend created after construction (lazily, as server mode
        // does) answers the next read.
        backend = backendWith(['fetchEpg']);
        expect(capabilities.supportsEpgImport).toBe(true);
        expect(resolve).toHaveBeenCalledTimes(2);
    });
});

function backendWith(
    methods: readonly EpgRuntimeBackendMethod[]
): Record<string, jest.Mock> {
    return Object.fromEntries(methods.map((method) => [method, jest.fn()]));
}
```

The table is a literal copy of today's checks, not an import from the production file, so it pins the desktop behavior: on Electron the resolver returns `window.electron`, and these are the method sets each flag needed there.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test services --testPathPatterns=epg-runtime-capabilities`
Expected: FAIL with `Cannot find module './epg-runtime-capabilities'`.

- [ ] **Step 3: Create the class**

Create `libs/services/src/lib/epg-runtime-capabilities.ts`:

```ts
import type { EpgRuntimeBackendMethod } from '@iptvnator/shared/interfaces';
import type { EpgRuntimeBackendResolver } from './epg-runtime-backend.token';

/**
 * The renderer's EPG capabilities. A capability is "its methods are present
 * on the EPG runtime backend". The resolver is called on every read and its
 * result is never kept: the server backend (PR 3d) is created lazily on the
 * first call, and the desktop preload is read live, as before.
 * `RuntimeCapabilitiesService` exposes these flags under the same names.
 */
export class EpgRuntimeCapabilities {
    constructor(private readonly resolveBackend: EpgRuntimeBackendResolver) {}

    /** The full M3U EPG: import, lookup, freshness, management, guide, search. */
    get supportsEpg(): boolean {
        return (
            this.supportsEpgImport &&
            this.supportsEpgProgramLookup &&
            this.supportsEpgSourceFreshness &&
            this.supportsEpgDataManagement &&
            this.supportsEpgGuide &&
            this.supportsEpgProgramSearch
        );
    }

    get supportsEpgImport(): boolean {
        return this.has('fetchEpg');
    }

    /** Native file picker for local XMLTV sources (Settings → EPG, playlist dialog). */
    get supportsEpgFilePicker(): boolean {
        return this.has('openEpgFileDialog');
    }

    get supportsEpgProgress(): boolean {
        return this.has('onEpgProgress');
    }

    get supportsEpgProgramLookup(): boolean {
        return this.has('getChannelPrograms');
    }

    get supportsEpgCurrentProgramBatch(): boolean {
        return this.has('getCurrentProgramsBatch');
    }

    get supportsEpgChannelMetadata(): boolean {
        return this.has('getEpgChannelMetadata');
    }

    get supportsEpgSourceFreshness(): boolean {
        return this.has('checkEpgFreshness');
    }

    get supportsEpgDataManagement(): boolean {
        return this.has(
            'forceFetchEpg',
            'clearEpgData',
            'clearEpgDataForSource'
        );
    }

    /** Both guide reads exist: programmes for a channel batch and coverage. */
    get supportsEpgGuide(): boolean {
        return this.has('getEpgProgramsForChannels', 'getEpgProgramCoverage');
    }

    get supportsEpgProgramSearch(): boolean {
        return this.has('searchEpgPrograms');
    }

    get supportsEpgMapping(): boolean {
        return this.has(
            'getEpgMapping',
            'setEpgMapping',
            'deleteEpgMapping',
            'searchEpgChannels'
        );
    }

    private has(...methods: EpgRuntimeBackendMethod[]): boolean {
        const backend = this.resolveBackend();
        return methods.every(
            (method) => typeof backend?.[method] === 'function'
        );
    }
}
```

Format the new files:

```bash
pnpm exec prettier --write libs/services/src/lib/epg-runtime-capabilities.ts libs/services/src/lib/epg-runtime-capabilities.spec.ts
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm nx test services --testPathPatterns=epg-runtime-capabilities
pnpm run typecheck:spec libs/services
pnpm nx lint services
```

Expected: PASS (1 + 11 + 2 tests); spec typecheck and lint clean. The file has about 75 counted lines.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/epg-runtime-capabilities.ts libs/services/src/lib/epg-runtime-capabilities.spec.ts
git commit -m "refactor(services): answer EPG capabilities from the EPG runtime backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `RuntimeCapabilitiesService` delegates its EPG flags

**Files:**
- Modify: `libs/services/src/lib/runtime-capabilities.service.ts` (imports, class head, EPG getters at master lines `102-169`)
- Modify: `libs/services/src/lib/runtime-capabilities.service.spec.ts`

The public `supportsEpg*` getters stay on the service as one-line delegates to a private `EpgRuntimeCapabilities`, so no consumer changes. The service keeps the resolver from `inject(EPG_RUNTIME_BACKEND)` inside that object, never a backend.

Decision for the spec: it constructs the service through `TestBed.inject` instead of `new`. A no-injection fallback inside the service would duplicate the token's default and hide a missing provider; TestBed keeps every existing assertion and exercises the real DI path. The 24 `new RuntimeCapabilitiesService()` calls become `createService()`. The existing tests that set EPG methods on `window.electron` (`requires the complete EPG preload surface`, `exposes EPG capabilities by the specific preload surface they need`, `does not report guide support with only one of the two guide reads`, and the PWA, Electron and partial-bridge overviews) keep pinning the desktop defaults through the default resolver.

- [ ] **Step 1: Construct through TestBed and add the delegation tests**

Convert the constructions:

```bash
perl -pi -e 's/new RuntimeCapabilitiesService\(\)/createService()/g' libs/services/src/lib/runtime-capabilities.service.spec.ts
grep -c "createService()" libs/services/src/lib/runtime-capabilities.service.spec.ts
```

Expected: `24`.

Replace the import block at the top of the spec (from Task 3)

```ts
import {
    isElectronRuntime,
    RuntimeCapabilitiesService,
} from './runtime-capabilities.service';
```

with this block. The constants stay above `describe(...)`: `it.each` reads them while the suite is collected.

```ts
import { TestBed } from '@angular/core/testing';
import {
    EPG_RUNTIME_BACKEND_METHODS,
    EpgRuntimeBackend,
    EpgRuntimeBackendMethod,
} from '@iptvnator/shared/interfaces';
import { EPG_RUNTIME_BACKEND } from './epg-runtime-backend.token';
import {
    isElectronRuntime,
    RuntimeCapabilitiesService,
} from './runtime-capabilities.service';

type EpgFlag = Extract<
    keyof RuntimeCapabilitiesService,
    `supportsEpg${string}`
>;

/** Every EPG flag of the service; `satisfies` keeps the list complete. */
const EPG_FLAGS = Object.keys({
    supportsEpg: true,
    supportsEpgImport: true,
    supportsEpgFilePicker: true,
    supportsEpgProgress: true,
    supportsEpgProgramLookup: true,
    supportsEpgCurrentProgramBatch: true,
    supportsEpgChannelMetadata: true,
    supportsEpgSourceFreshness: true,
    supportsEpgDataManagement: true,
    supportsEpgGuide: true,
    supportsEpgProgramSearch: true,
    supportsEpgMapping: true,
} satisfies Record<EpgFlag, true>) as EpgFlag[];

/** What a server backend offers (spec section 9): no file picker, no mapping. */
const SERVER_LIKE_EPG_METHODS: readonly EpgRuntimeBackendMethod[] = [
    'fetchEpg',
    'forceFetchEpg',
    'clearEpgData',
    'clearEpgDataForSource',
    'reconcileEpgSources',
    'getChannelPrograms',
    'getCurrentProgramsBatch',
    'getEpgChannelMetadata',
    'checkEpgFreshness',
    'getEpgProgramsForChannels',
    'getEpgProgramCoverage',
    'searchEpgPrograms',
    'onEpgProgress',
];
```

Replace the suite's `afterEach` (as left by Task 3)

```ts
    afterEach(() => {
        testWindow.electron = originalElectron;
    });
```

with

```ts
    afterEach(() => {
        testWindow.electron = originalElectron;
        TestBed.resetTestingModule();
    });

    /** Through DI, as the app gets it: the EPG flags need the backend token. */
    function createService(): RuntimeCapabilitiesService {
        return TestBed.inject(RuntimeCapabilitiesService);
    }
```

Insert this block as the last member of the top-level `describe('RuntimeCapabilitiesService', ...)`, right before its closing `});` (after the test `supports Xtream section navigation in Electron when only the SQLite data source is available`):

```ts
    describe('EPG flags', () => {
        it('keeps the desktop defaults on window.electron', () => {
            const service = createService();

            testWindow.electron = backendWith(EPG_RUNTIME_BACKEND_METHODS);
            expect(EPG_FLAGS.filter((flag) => !service[flag])).toEqual([]);

            testWindow.electron = undefined;
            expect(EPG_FLAGS.filter((flag) => service[flag])).toEqual([]);
        });

        it.each(EPG_FLAGS)(
            '%s follows the injected EPG backend, not window.electron',
            (flag) => {
                let backend: EpgRuntimeBackend | undefined = {};
                TestBed.configureTestingModule({
                    providers: [
                        {
                            provide: EPG_RUNTIME_BACKEND,
                            useValue: () => backend,
                        },
                    ],
                });
                const service = createService();
                testWindow.electron = backendWith(EPG_RUNTIME_BACKEND_METHODS);

                expect(service[flag]).toBe(false);

                // Changed after construction: the service keeps the
                // resolver, never the backend it returned.
                backend = backendWith(EPG_RUNTIME_BACKEND_METHODS);
                expect(service[flag]).toBe(true);

                backend = undefined;
                expect(service[flag]).toBe(false);
            }
        );

        it('turns supportsEpg on for a server-like backend and keeps the other flags on window.electron', () => {
            TestBed.configureTestingModule({
                providers: [
                    {
                        provide: EPG_RUNTIME_BACKEND,
                        useValue: () => backendWith(SERVER_LIKE_EPG_METHODS),
                    },
                ],
            });
            testWindow.electron = undefined;
            const service = createService();

            expect(service.isPwa).toBe(true);
            expect(service.supportsEpg).toBe(true);
            expect(service.supportsEpgFilePicker).toBe(false);
            expect(service.supportsEpgMapping).toBe(false);
            expect(service.supportsAppStateStorage).toBe(false);

            testWindow.electron = {
                dbGetAppState: jest.fn(),
                dbSetAppState: jest.fn(),
            };

            expect(service.isElectron).toBe(true);
            expect(service.supportsAppStateStorage).toBe(true);
            expect(service.supportsEpgFilePicker).toBe(false);
        });
    });
```

Append this helper at the end of the file, after `createXtreamSqliteBridge` (function declarations are hoisted):

```ts
function backendWith(
    methods: readonly EpgRuntimeBackendMethod[]
): Record<string, jest.Mock> {
    return Object.fromEntries(methods.map((method) => [method, jest.fn()]));
}
```

- [ ] **Step 2: Run the spec to verify the delegation tests fail**

Run: `pnpm nx test services --testPathPatterns=runtime-capabilities`

Expected: FAIL in the 12 cases `… follows the injected EPG backend, not window.electron` (the flag is `true` while the backend is `{}`, because `window.electron` still decides) and in `turns supportsEpg on for a server-like backend …`. The 24 converted tests and `keeps the desktop defaults on window.electron` PASS.

- [ ] **Step 3: Delegate the EPG getters**

In `libs/services/src/lib/runtime-capabilities.service.ts`, replace

```ts
import { Injectable } from '@angular/core';
import { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
```

with

```ts
import { inject, Injectable } from '@angular/core';
import { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { EPG_RUNTIME_BACKEND } from './epg-runtime-backend.token';
import { EpgRuntimeCapabilities } from './epg-runtime-capabilities';
```

Replace

```ts
@Injectable({ providedIn: 'root' })
export class RuntimeCapabilitiesService {
    get environment(): RuntimeEnvironment {
```

with

```ts
@Injectable({ providedIn: 'root' })
export class RuntimeCapabilitiesService {
    /**
     * The EPG flags, answered on the EPG runtime backend (`window.electron`
     * unless a deployment provides another); it keeps the resolver and calls
     * it on every read. Every other flag reads the preload bridge. The field
     * needs an injection context: construct the service through DI.
     */
    private readonly epg = new EpgRuntimeCapabilities(
        inject(EPG_RUNTIME_BACKEND)
    );

    get environment(): RuntimeEnvironment {
```

Replace the EPG getters, from `get supportsEpg(): boolean {` through the end of `get supportsEpgMapping()` (master lines 102-169), with:

```ts
    get supportsEpg(): boolean {
        return this.epg.supportsEpg;
    }

    get supportsEpgImport(): boolean {
        return this.epg.supportsEpgImport;
    }

    /** Native file picker for local XMLTV sources (Settings → EPG, playlist dialog). */
    get supportsEpgFilePicker(): boolean {
        return this.epg.supportsEpgFilePicker;
    }

    get supportsEpgProgress(): boolean {
        return this.epg.supportsEpgProgress;
    }

    get supportsEpgProgramLookup(): boolean {
        return this.epg.supportsEpgProgramLookup;
    }

    get supportsEpgCurrentProgramBatch(): boolean {
        return this.epg.supportsEpgCurrentProgramBatch;
    }

    get supportsEpgChannelMetadata(): boolean {
        return this.epg.supportsEpgChannelMetadata;
    }

    get supportsEpgSourceFreshness(): boolean {
        return this.epg.supportsEpgSourceFreshness;
    }

    get supportsEpgDataManagement(): boolean {
        return this.epg.supportsEpgDataManagement;
    }

    /** Both guide reads exist: programmes for a channel batch and coverage. */
    get supportsEpgGuide(): boolean {
        return this.epg.supportsEpgGuide;
    }

    get supportsEpgProgramSearch(): boolean {
        return this.epg.supportsEpgProgramSearch;
    }

    get supportsEpgMapping(): boolean {
        return this.epg.supportsEpgMapping;
    }
```

Verify the move and the size:

```bash
grep -c "return this.epg\." libs/services/src/lib/runtime-capabilities.service.ts
grep -nE "hasElectronMethod\('[A-Za-z]*(Epg|ChannelPrograms|ProgramsBatch)" libs/services/src/lib/runtime-capabilities.service.ts
grep -cvE '^\s*$|^\s*(//|/\*|\*)' libs/services/src/lib/runtime-capabilities.service.ts
```

Expected: `12`; the second grep prints nothing; the counted-line approximation is about 285 and must be below 300 (master: 296).

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test services
pnpm nx test web --testPathPatterns=server-instance-probe
pnpm run typecheck:spec libs/services
pnpm nx lint services
```

Expected: all `services` suites PASS (baseline plus the new tests); the probe spec PASSES; spec typecheck and lint clean, `max-lines` included.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/runtime-capabilities.service.ts libs/services/src/lib/runtime-capabilities.service.spec.ts
git commit -m "refactor(services): read EPG capabilities through the EPG runtime backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
---

### Task 6: `EpgSourceSettingsService` reconciles through the backend

**Files:**
- Modify: `libs/services/src/lib/epg-source-settings.service.ts:10, 42, 82-87, 120-121`
- Modify: `libs/services/src/lib/epg-source-settings.service.spec.ts`
- Modify: `libs/services/src/lib/settings-store.service.spec.ts` (imports, providers at `47-56` and `610-619`)
- Modify: `libs/services/src/lib/settings-store.embedded-mpv.spec.ts` (imports, providers at `60-66`)

- [ ] **Step 1: Provide the token in every `Injector.create` and add the backend tests**

`Injector.create` has no `root` scope, so these three specs provide the token with the default resolver's behavior. In each of the three files add the import next to the other relative imports:

```ts
import { EPG_RUNTIME_BACKEND } from './epg-runtime-backend.token';
```

and, after the last import of the file, the provider:

```ts
/** `Injector.create` has no root scope; this keeps the default resolver. */
const defaultEpgBackend = {
    provide: EPG_RUNTIME_BACKEND,
    useValue: () => window.electron,
};
```

Then list it next to every `EpgSourceSettingsService` class provider:

```bash
for f in libs/services/src/lib/epg-source-settings.service.spec.ts libs/services/src/lib/settings-store.service.spec.ts libs/services/src/lib/settings-store.embedded-mpv.spec.ts; do
  perl -0pi -e 's/^(\s+)EpgSourceSettingsService,\n/$1EpgSourceSettingsService,\n$1defaultEpgBackend,\n/mg' "$f"
  echo "$f $(grep -c '^\s*defaultEpgBackend,$' "$f")"
done
```

Expected: `5`, `2` and `1` respectively.

In `libs/services/src/lib/epg-source-settings.service.spec.ts`, add these two tests at the end of the `describe`, before its closing `});`:

```ts
    it('reconciles through a provided EPG backend without reading window.electron', async () => {
        const electronReconcile = jest.fn();
        window.electron = {
            reconcileEpgSources: electronReconcile,
        } as unknown as typeof window.electron;
        const backend = {
            reconcileEpgSources: jest.fn().mockResolvedValue({ success: true }),
        };
        const injector = Injector.create({
            providers: [
                EpgSourceSettingsService,
                { provide: EPG_RUNTIME_BACKEND, useValue: () => backend },
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists: () => of([]) },
                },
            ],
        });
        const service = injector.get(EpgSourceSettingsService);

        await service.synchronize([' b ', 'b']);

        expect(backend.reconcileEpgSources).toHaveBeenCalledWith(['b']);
        expect(electronReconcile).not.toHaveBeenCalled();
        expect(service.revision()).toBe(2);
    });

    it('does nothing without a backend that reconciles sources', async () => {
        const getAllPlaylists = jest.fn(() => of([]));
        const injector = Injector.create({
            providers: [
                EpgSourceSettingsService,
                {
                    provide: EPG_RUNTIME_BACKEND,
                    useValue: () => ({ fetchEpg: jest.fn() }),
                },
                { provide: PlaylistsService, useValue: { getAllPlaylists } },
            ],
        });
        const service = injector.get(EpgSourceSettingsService);

        await service.synchronize(['a']);

        expect(getAllPlaylists).not.toHaveBeenCalled();
        expect(service.revision()).toBe(0);
    });
```

- [ ] **Step 2: Run to verify the new backend test fails**

Run: `pnpm nx test services --testPathPatterns="epg-source-settings|settings-store"`

Expected: FAIL only in `reconciles through a provided EPG backend …` with `Failed to reconcile EPG sources` (the service still calls `window.electron.reconcileEpgSources`, whose mock returns `undefined`). All other tests PASS.

- [ ] **Step 3: Reconcile through the backend**

In `libs/services/src/lib/epg-source-settings.service.ts`, replace

```ts
import { PlaylistsService } from './playlists.service';
```

with

```ts
import { EPG_RUNTIME_BACKEND } from './epg-runtime-backend.token';
import { PlaylistsService } from './playlists.service';
```

Replace

```ts
    private readonly injector = inject(Injector);
```

with

```ts
    private readonly injector = inject(Injector);
    /** Called per use, never its result kept: 3d creates its backend lazily. */
    private readonly resolveEpgBackend = inject(EPG_RUNTIME_BACKEND);
```

Replace

```ts
    async synchronize(urls: string[] | string | undefined): Promise<void> {
        if (
            typeof window === 'undefined' ||
            !window.electron?.reconcileEpgSources
        )
            return;
```

with

```ts
    async synchronize(urls: string[] | string | undefined): Promise<void> {
        // Without a backend that owns XMLTV sources (the PWA without server
        // EPG) there is nothing to reconcile.
        if (!this.resolveEpgBackend()?.reconcileEpgSources) return;
```

Replace

```ts
            const result =
                await window.electron.reconcileEpgSources(normalized);
```

with

```ts
            // Read again: the backend can change while playlists migrate.
            const backend = this.resolveEpgBackend();
            if (!backend?.reconcileEpgSources)
                throw new Error('EPG source reconciliation is unavailable');
            const result = await backend.reconcileEpgSources(normalized);
```

The explicit `throw` takes the same `catch` path as today's `TypeError` when `window.electron` disappears mid-way: `failedReconciliation` is kept and `EpgSourceReconciliationError` is thrown.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test services
pnpm nx test epg-data-access --testPathPatterns=epg.service
pnpm run typecheck:spec libs/services
pnpm nx lint services
```

Expected: PASS. `epg.service.spec.ts:162-195` still drives reconciliation through `window.electron` in TestBed, which proves the default resolver path.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/epg-source-settings.service.ts libs/services/src/lib/epg-source-settings.service.spec.ts libs/services/src/lib/settings-store.service.spec.ts libs/services/src/lib/settings-store.embedded-mpv.spec.ts
git commit -m "refactor(services): reconcile EPG sources through the EPG runtime backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `EpgRuntimeBridgeService` calls the backend

**Files:**
- Modify: `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts:1-21, 44-68, 349-355`
- Modify: `libs/epg/data-access/src/lib/epg-runtime-bridge.service.spec.ts:1-3` and end of file

- [ ] **Step 1: Write the failing delegation tests**

In `libs/epg/data-access/src/lib/epg-runtime-bridge.service.spec.ts`, replace

```ts
import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
```

with

```ts
import { TestBed } from '@angular/core/testing';
import {
    EPG_RUNTIME_BACKEND,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import type { EpgRuntimeBackend } from '@iptvnator/shared/interfaces';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
```

Add this block as the last member of `describe('EpgRuntimeBridgeService', ...)`, after the test `subscribes to EPG progress only when progress events are supported`:

```ts
    describe('with a provided EPG runtime backend', () => {
        function createWithBackend(
            backend: EpgRuntimeBackend | undefined
        ): EpgRuntimeBridgeService {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    EpgRuntimeBridgeService,
                    {
                        provide: RuntimeCapabilitiesService,
                        useValue: runtimeCapabilities,
                    },
                    { provide: EPG_RUNTIME_BACKEND, useValue: () => backend },
                ],
            });
            return TestBed.inject(EpgRuntimeBridgeService);
        }

        it('calls the provided backend and never window.electron', async () => {
            const electronFetchEpg = jest.fn();
            const electronGetEpgMappingsBatch = jest.fn();
            window.electron = {
                ...window.electron,
                fetchEpg: electronFetchEpg,
                getEpgMappingsBatch: electronGetEpgMappingsBatch,
            } as unknown as typeof window.electron;
            const backend = {
                fetchEpg: jest.fn().mockResolvedValue({ success: true }),
                getCurrentProgramsBatch: jest
                    .fn()
                    .mockResolvedValue({ 'channel-1': null }),
                getEpgMappingsBatch: jest
                    .fn()
                    .mockResolvedValue({ 'xtream:p:1': 'mapped' }),
                onEpgProgress: jest.fn(),
            };
            runtimeCapabilities.supportsEpgImport = true;
            runtimeCapabilities.supportsEpgCurrentProgramBatch = true;
            runtimeCapabilities.supportsEpgMapping = true;
            runtimeCapabilities.supportsEpgProgress = true;
            const bridge = createWithBackend(backend);
            const callback = jest.fn();

            await expect(
                bridge.fetchEpg(['https://example.com/epg.xml'])
            ).resolves.toEqual({ success: true });
            await expect(
                bridge.getCurrentProgramsBatch(['channel-1'], { nowMs: 5 })
            ).resolves.toEqual({ 'channel-1': null });
            await expect(
                bridge.getEpgMappingsBatch(['xtream:p:1'])
            ).resolves.toEqual({ 'xtream:p:1': 'mapped' });
            bridge.onProgress(callback);

            expect(backend.fetchEpg).toHaveBeenCalledWith(
                ['https://example.com/epg.xml'],
                undefined
            );
            expect(backend.getCurrentProgramsBatch).toHaveBeenCalledWith(
                ['channel-1'],
                { nowMs: 5 }
            );
            expect(backend.getEpgMappingsBatch).toHaveBeenCalledWith([
                'xtream:p:1',
            ]);
            expect(backend.onEpgProgress).toHaveBeenCalledWith(callback);
            expect(electronFetchEpg).not.toHaveBeenCalled();
            expect(electronGetEpgMappingsBatch).not.toHaveBeenCalled();
        });

        it('answers null when the backend is missing or lacks the method', async () => {
            runtimeCapabilities.supportsEpgImport = true;
            runtimeCapabilities.supportsEpgProgramLookup = true;

            const empty = createWithBackend({});
            await expect(
                empty.fetchEpg(['https://example.com/epg.xml'])
            ).resolves.toBeNull();
            await expect(
                empty.getChannelPrograms('channel-1')
            ).resolves.toBeNull();

            const none = createWithBackend(undefined);
            await expect(
                none.fetchEpg(['https://example.com/epg.xml'])
            ).resolves.toBeNull();
        });
    });
```

- [ ] **Step 2: Run to verify the delegation test fails**

Run: `pnpm nx test epg-data-access --testPathPatterns=epg-runtime-bridge`

Expected: FAIL in `calls the provided backend and never window.electron` (`fetchEpg` resolves `null`: the service still calls `window.electron.fetchEpg`, whose mock returns `undefined`). The other tests PASS, including the existing ones that set `window.electron`; they keep proving the default resolver.

- [ ] **Step 3: Call the resolved backend**

In `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts`, replace the import block

```ts
import { inject, Injectable } from '@angular/core';
import {
    ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES,
    ElectronBridgeApi,
    ElectronBridgeCurrentProgramsOptions,
```

with

```ts
import { inject, Injectable } from '@angular/core';
import {
    ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES,
    ElectronBridgeCurrentProgramsOptions,
```

then replace

```ts
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
```

with

```ts
    EpgChannelMetadata,
    EpgProgram,
    EpgRuntimeBackend,
} from '@iptvnator/shared/interfaces';
import {
    EPG_RUNTIME_BACKEND,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
```

Delete the local type (master lines 44-64):

```ts
type EpgElectronBridge = Pick<
    Partial<ElectronBridgeApi>,
    | 'checkEpgFreshness'
    | 'clearEpgData'
    | 'clearEpgDataForSource'
    | 'fetchEpg'
    | 'forceFetchEpg'
    | 'openEpgFileDialog'
    | 'getChannelPrograms'
    | 'getCurrentProgramsBatch'
    | 'getEpgChannelMetadata'
    | 'getEpgProgramsForChannels'
    | 'getEpgProgramCoverage'
    | 'onEpgProgress'
    | 'searchEpgPrograms'
    | 'getEpgMapping'
    | 'getEpgMappingsBatch'
    | 'setEpgMapping'
    | 'deleteEpgMapping'
    | 'searchEpgChannels'
>;

```

Replace

```ts
export class EpgRuntimeBridgeService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
```

with

```ts
export class EpgRuntimeBridgeService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    /**
     * Called on every access, never its result kept: the preload bridge by
     * default, and PR 3d's server backend is created on the first call.
     */
    private readonly resolveEpgBackend = inject(EPG_RUNTIME_BACKEND);
```

Replace

```ts
    private get bridge(): EpgElectronBridge | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return window.electron;
    }
```

with

```ts
    private get bridge(): EpgRuntimeBackend | undefined {
        return this.resolveEpgBackend();
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test epg-data-access
git grep -n "window.electron\|EpgElectronBridge" -- libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts
pnpm run typecheck:spec libs/epg/data-access
pnpm nx lint epg-data-access
```

Expected: PASS; the grep prints nothing (exit code 1); spec typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts libs/epg/data-access/src/lib/epg-runtime-bridge.service.spec.ts
git commit -m "refactor(epg): call the EPG runtime backend from the runtime bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Xtream XMLTV fallback through the bridge

**Files:**
- Modify: `libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts:1-106`
- Modify: `libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.spec.ts:1-3, 24-26, 34, 48-50, 61-63, 186-188, 209-211`

- [ ] **Step 1: Point the spec at the backend token**

The spec keeps its tests; the backend replaces `window.electron` as the place the bridge double lives. Edit `xtream-xmltv-fallback.service.spec.ts`:

Replace

```ts
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
```

with

```ts
import { TestBed } from '@angular/core/testing';
import { EPG_RUNTIME_BACKEND, SettingsStore } from '@iptvnator/services';
import type {
    EpgProgram,
    EpgRuntimeBackend,
} from '@iptvnator/shared/interfaces';
```

Replace

```ts
    let bridge: Bridge;
    let epgOffsetMinutes = 0;
```

with

```ts
    let bridge: Bridge;
    /** What `EPG_RUNTIME_BACKEND` resolves in the current test. */
    let backend: EpgRuntimeBackend | undefined;
    let epgOffsetMinutes = 0;
```

Replace (in `beforeEach`)

```ts
        (window as { electron?: unknown }).electron = bridge;
    });
```

with

```ts
        backend = bridge;
    });
```

Replace (in `makeService`)

```ts
            providers: [
                XtreamXmltvFallbackService,
                {
                    provide: SettingsStore,
```

with

```ts
            providers: [
                XtreamXmltvFallbackService,
                { provide: EPG_RUNTIME_BACKEND, useValue: () => backend },
                {
                    provide: SettingsStore,
```

Replace

```ts
    it('returns [] when window.electron bridge is unavailable', async () => {
        delete (window as { electron?: unknown }).electron;
        const service = makeService();
```

with

```ts
    it('returns [] when no EPG runtime backend is available', async () => {
        backend = undefined;
        const service = makeService();
```

and insert this test right after that one (after its closing `});`):

```ts
    it('reads the EPG runtime backend, never window.electron', async () => {
        const electron = {
            getChannelPrograms: jest.fn(),
            getCurrentProgramsBatch: jest.fn(),
        };
        (window as { electron?: unknown }).electron = electron;
        bridge.getChannelPrograms.mockResolvedValue([]);
        bridge.getCurrentProgramsBatch.mockResolvedValue({});
        const service = makeService();

        await service.getProgramsForChannel('rtl.de');
        await service.getCurrentProgramsBatch(['rtl.de']);

        expect(bridge.getChannelPrograms).toHaveBeenCalledWith('rtl.de');
        expect(bridge.getCurrentProgramsBatch).toHaveBeenCalledWith(
            ['rtl.de'],
            { nowMs: expect.any(Number) }
        );
        expect(electron.getChannelPrograms).not.toHaveBeenCalled();
        expect(electron.getCurrentProgramsBatch).not.toHaveBeenCalled();
    });
```

In the test `uses getChannelPrograms even when getCurrentProgramsBatch is missing`, replace

```ts
        (window as { electron?: unknown }).electron = {
            getChannelPrograms: bridge.getChannelPrograms,
        };
```

with

```ts
        backend = { getChannelPrograms: bridge.getChannelPrograms };
```

In the test `uses getCurrentProgramsBatch even when getChannelPrograms is missing`, replace

```ts
        (window as { electron?: unknown }).electron = {
            getCurrentProgramsBatch: bridge.getCurrentProgramsBatch,
        };
```

with

```ts
        backend = { getCurrentProgramsBatch: bridge.getCurrentProgramsBatch };
```

Keep the `afterEach` that restores `window.electron`: the new test sets it.

Check that no test still installs the double on `window.electron`:

```bash
grep -n "electron = bridge\|delete (window" libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.spec.ts
```

Expected: only the `delete` inside `afterEach`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test portal-xtream-data-access --testPathPatterns=xtream-xmltv-fallback`

Expected: FAIL in `reads the EPG runtime backend, never window.electron`, `maps EpgProgram rows …`, `derives timestamps …`, `skips empty …`, `asks the bridge …` and both `uses … even when …` tests: the service still reads `window.electron`, which the spec no longer sets up.

- [ ] **Step 3: Read XMLTV through `EpgRuntimeBridgeService`**

In `libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts`, replace everything from the first line through the end of `getCurrentProgramsBatch` (master lines 1-106; `resolveCurrentEpg` and `mapEpgProgramToEpgItem` below stay unchanged) with:

```ts
import { inject, Injectable } from '@angular/core';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';

@Injectable({ providedIn: 'root' })
export class XtreamXmltvFallbackService {
    private readonly logger = createLogger('XtreamXmltvFallback');
    private readonly settingsStore = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    /**
     * XMLTV reads go through the EPG runtime bridge. Each method below gates
     * on the capability of the one backend method it needs, so a partial
     * backend (e.g. `getChannelPrograms` without `getCurrentProgramsBatch`)
     * only disables the affected path.
     */
    private readonly epgBridge = inject(EpgRuntimeBridgeService);

    /**
     * Returns the full schedule for a channel from local XMLTV, mapped into
     * the `EpgItem` shape the Xtream UI consumes. Returns `[]` when nothing
     * is found or the backend has no programme lookup.
     */
    async getProgramsForChannel(
        epgChannelId: string | null | undefined
    ): Promise<EpgItem[]> {
        const revision = this.sources.revision();
        const id = (epgChannelId ?? '').trim();
        if (!id) return [];
        if (!this.epgBridge.supportsProgramLookup) return [];

        try {
            const programs = await this.epgBridge.getChannelPrograms(id);
            if (revision !== this.sources.revision()) return [];
            return (programs ?? []).map((p) => mapEpgProgramToEpgItem(p, id));
        } catch (error) {
            this.logger.error(`Failed to load XMLTV programs for ${id}`, error);
            return [];
        }
    }

    async getCurrentProgramsBatch(
        epgChannelIds: ReadonlyArray<string | null | undefined>
    ): Promise<Record<string, EpgItem>> {
        const revision = this.sources.revision();
        if (!this.epgBridge.supportsCurrentProgramBatch) return {};

        const ids = Array.from(
            new Set(
                epgChannelIds
                    .map((id) => (id ?? '').trim())
                    .filter((id): id is string => id.length > 0)
            )
        );
        if (ids.length === 0) return {};

        try {
            // "Now" in the provider's EPG clock (`epg-display-offset.util.ts`,
            // clock form), like every other current-programme lookup.
            const rows = await this.epgBridge.getCurrentProgramsBatch(ids, {
                nowMs: epgProviderClockMs(
                    Date.now(),
                    this.settingsStore.resolvedEpgOffsetMinutes()
                ),
            });
            if (revision !== this.sources.revision()) return {};
            const out: Record<string, EpgItem> = {};
            for (const id of ids) {
                const row = rows?.[id];
                if (row) {
                    out[id] = mapEpgProgramToEpgItem(row, id);
                }
            }
            return out;
        } catch (error) {
            this.logger.error(
                'Failed to load XMLTV current-programs batch',
                error
            );
            return {};
        }
    }
```

The capability checks are the same tests as before (`supportsProgramLookup` is `getChannelPrograms` present, `supportsCurrentProgramBatch` is `getCurrentProgramsBatch` present), and they return before any `await`, as the old `typeof fn !== 'function'` checks did. The bridge answers `null` instead of `undefined` for "unsupported"; `programs ?? []` and `rows?.[id]` treat both the same.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test portal-xtream-data-access --testPathPatterns=xtream-xmltv-fallback
pnpm run typecheck:spec libs/portal/xtream/data-access
pnpm nx lint portal-xtream-data-access
```

Expected: PASS (9 tests); spec typecheck clean; lint clean, including `@nx/enforce-module-boundaries` for the new `@iptvnator/epg/data-access` import.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.spec.ts
git commit -m "refactor(xtream): read the XMLTV fallback through the EPG runtime bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `withEpg()` resolves the manual mapping through the bridge

**Files:**
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts:15-25, 107-111, 186-203`
- Modify: `libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.spec.ts:1-7, 45-50, 95-97` and end of file

- [ ] **Step 1: Write the failing test**

In `with-epg.feature.spec.ts`, replace

```ts
import { signalStore, withState } from '@ngrx/signals';
```

with

```ts
import { signalStore, withState } from '@ngrx/signals';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
```

Replace

```ts
interface TestStoreSetup {
    appEnvironment?: 'electron' | 'pwa';
    selectedItem: { xtream_id: number; epg_channel_id?: string | null };
    preferUploaded?: boolean;
    epgOffsetMinutes?: number;
}
```

with

```ts
interface TestStoreSetup {
    appEnvironment?: 'electron' | 'pwa';
    selectedItem: { xtream_id: number; epg_channel_id?: string | null };
    preferUploaded?: boolean;
    epgOffsetMinutes?: number;
    /** Replaces the EPG runtime bridge; the real one reads the default backend. */
    epgBridge?: Pick<
        EpgRuntimeBridgeService,
        'supportsEpgMapping' | 'getEpgMapping'
    >;
}
```

Replace

```ts
            { provide: SettingsStore, useValue: settingsStore },
        ],
    });
```

with

```ts
            { provide: SettingsStore, useValue: settingsStore },
            ...(setup.epgBridge
                ? [
                      {
                          provide: EpgRuntimeBridgeService,
                          useValue: setup.epgBridge,
                      },
                  ]
                : []),
        ],
    });
```

Add this test at the end of `describe('withEpg', ...)`, before its closing `});`:

```ts
    it('resolves the manual EPG mapping through the EPG runtime bridge, not window.electron', async () => {
        const electronGetEpgMapping = jest.fn();
        const originalElectron = window.electron;
        window.electron = {
            getEpgMapping: electronGetEpgMapping,
        } as unknown as typeof window.electron;
        try {
            const getEpgMapping = jest.fn().mockResolvedValue({
                id: 1,
                channelKey: 'xtream:playlist-1:101',
                epgChannelId: ' mapped.id ',
                playlistId: 'playlist-1',
            });
            const { store, xtreamApiService, fallbackService } =
                configureStore({
                    selectedItem: {
                        xtream_id: 101,
                        epg_channel_id: 'provider.id',
                    },
                    epgBridge: { supportsEpgMapping: true, getEpgMapping },
                });
            xtreamApiService.getFullEpg.mockResolvedValue([]);
            fallbackService.getProgramsForChannel.mockResolvedValue([]);

            await store.loadEpg();

            expect(getEpgMapping).toHaveBeenCalledWith(
                'xtream:playlist-1:101'
            );
            expect(fallbackService.getProgramsForChannel).toHaveBeenCalledWith(
                'mapped.id'
            );
            expect(electronGetEpgMapping).not.toHaveBeenCalled();
        } finally {
            window.electron = originalElectron;
        }
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test portal-xtream-data-access --testPathPatterns=with-epg`

Expected: FAIL in the new test: `getEpgMapping` was not called (the feature gates on `runtime.supportsEpgMapping`, which the spec's runtime double does not define) and the fallback receives `provider.id`.

- [ ] **Step 3: Use the bridge in the feature**

In `with-epg.feature.ts`, replace

```ts
import {
    EpgSourceSettingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
```

with

```ts
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    EpgSourceSettingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
```

Replace

```ts
            const fallbackService = inject(XtreamXmltvFallbackService);
            const runtime = inject(RuntimeCapabilitiesService);
```

with

```ts
            const fallbackService = inject(XtreamXmltvFallbackService);
            const epgBridge = inject(EpgRuntimeBridgeService);
            const runtime = inject(RuntimeCapabilitiesService);
```

Replace

```ts
                    if (runtime.supportsEpgMapping && playlistId) {
                        try {
                            const mapping =
                                await window.electron?.getEpgMapping?.(
                                    buildXtreamEpgMappingKey(
                                        playlistId,
                                        xtreamId
                                    )
                                );
```

with

```ts
                    if (epgBridge.supportsEpgMapping && playlistId) {
                        try {
                            const mapping = await epgBridge.getEpgMapping(
                                buildXtreamEpgMappingKey(playlistId, xtreamId)
                            );
```

`runtime` stays: `supportsEpg` (line 114) still reads it. `epgBridge.supportsEpgMapping` delegates to `runtime.supportsEpgMapping`, so the gate is unchanged, and `getEpgMapping` answers `null` when unsupported, which the existing `mapping?.epgChannelId` check already handles.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test portal-xtream-data-access --testPathPatterns="with-epg|xtream.store"
git grep -n "window.electron" -- libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts
pnpm nx lint portal-xtream-data-access
```

Expected: PASS; the grep prints nothing (exit code 1); lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.spec.ts
git commit -m "refactor(xtream): resolve the manual EPG mapping through the runtime bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `EpgQueueService` batch mappings through the bridge

**Files:**
- Modify: `libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts:8-11, 50-51, 188-197, 288-331`
- Modify: `libs/portal/xtream/data-access/src/lib/services/epg-queue.service.spec.ts:1-6` and end of the top-level `describe`

- [ ] **Step 1: Write the failing tests**

In `epg-queue.service.spec.ts`, replace

```ts
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
```

with

```ts
import { TestBed } from '@angular/core/testing';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { SettingsStore } from '@iptvnator/services';
```

Add this block as the last member of `describe('EpgQueueService', ...)`, after the test `does not re-emit on empty→empty transitions`:

```ts
    describe('manual EPG mappings', () => {
        const entry = {
            streamId: 7,
            epgChannelId: 'provider.id',
            playlistId: 'playlist-1',
        };

        function createWithBridge(
            epgBridge: Pick<
                EpgRuntimeBridgeService,
                'supportsEpgMapping' | 'getEpgMappingsBatch'
            >
        ): EpgQueueService {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    EpgQueueService,
                    { provide: XtreamApiService, useValue: xtreamApi },
                    { provide: XtreamXmltvFallbackService, useValue: fallback },
                    { provide: SettingsStore, useValue: settings },
                    { provide: EpgRuntimeBridgeService, useValue: epgBridge },
                ],
            });
            return TestBed.inject(EpgQueueService);
        }

        it('resolves mappings through the EPG runtime bridge, not window.electron', async () => {
            const electronGetEpgMappingsBatch = jest.fn();
            const originalElectron = window.electron;
            window.electron = {
                getEpgMappingsBatch: electronGetEpgMappingsBatch,
            } as unknown as typeof window.electron;
            try {
                const getEpgMappingsBatch = jest
                    .fn()
                    .mockResolvedValue({
                        'xtream:playlist-1:7': ' mapped.id ',
                    });
                const queue = createWithBridge({
                    supportsEpgMapping: true,
                    getEpgMappingsBatch,
                });

                await queue.enqueue([entry], new Set([7]), credentials);

                expect(getEpgMappingsBatch).toHaveBeenCalledWith([
                    'xtream:playlist-1:7',
                ]);
                expect(fallback.getCurrentProgramsBatch).toHaveBeenCalledWith(
                    ['mapped.id']
                );
                expect(electronGetEpgMappingsBatch).not.toHaveBeenCalled();
            } finally {
                window.electron = originalElectron;
            }
        });

        it('skips the lookup when the backend has no manual mappings', async () => {
            const getEpgMappingsBatch = jest.fn();
            const queue = createWithBridge({
                supportsEpgMapping: false,
                getEpgMappingsBatch,
            });

            await queue.enqueue([entry], new Set([7]), credentials);

            expect(getEpgMappingsBatch).not.toHaveBeenCalled();
            expect(fallback.getCurrentProgramsBatch).toHaveBeenCalledWith([
                'provider.id',
            ]);
        });
    });
```

- [ ] **Step 2: Run to verify the bridge test fails**

Run: `pnpm nx test portal-xtream-data-access --testPathPatterns=epg-queue`

Expected: FAIL in `resolves mappings through the EPG runtime bridge …`: the service calls `window.electron.getEpgMappingsBatch` (its mock returns `undefined`, the lookup throws and is swallowed), the bridge double is never called, and the fallback gets `provider.id`. `skips the lookup …` and the existing tests PASS.

- [ ] **Step 3: Resolve mappings through the bridge**

In `epg-queue.service.ts`, replace

```ts
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';
```

with

```ts
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';
```

Replace

```ts
    private readonly fallbackService = inject(XtreamXmltvFallbackService);
    private readonly settingsStore = inject(SettingsStore);
```

with

```ts
    private readonly fallbackService = inject(XtreamXmltvFallbackService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
```

Replace

```ts
        // Guarded so environments without the bridge (PWA) skip the await
        // entirely and the enqueue keeps its original microtask timing.
        if (typeof window.electron?.getEpgMappingsBatch === 'function') {
            await this.resolveManualMappings(normalized);
        }
```

with

```ts
        // Guarded so runtimes without manual mappings (PWA) skip the await
        // entirely and the enqueue keeps its original microtask timing.
        if (this.epgBridge.supportsEpgMapping) {
            await this.resolveManualMappings(normalized);
        }
```

Replace

```ts
    private async resolveManualMappings(
        entries: EpgQueueEntry[]
    ): Promise<void> {
        const getEpgMappingsBatch =
            typeof window.electron?.getEpgMappingsBatch === 'function'
                ? window.electron.getEpgMappingsBatch
                : null;
        if (!getEpgMappingsBatch) {
            return;
        }

        const keyByStreamId = new Map<number, string>();
```

with

```ts
    private async resolveManualMappings(
        entries: EpgQueueEntry[]
    ): Promise<void> {
        const keyByStreamId = new Map<number, string>();
```

Replace

```ts
        try {
            // One IPC round-trip for the whole viewport — a per-entry
            // lookup would put O(N) IPC calls on every scroll event.
            const mappings = await getEpgMappingsBatch([
                ...keyByStreamId.values(),
            ]);
            for (const entry of entries) {
```

with

```ts
        try {
            // One round-trip for the whole viewport — a per-entry lookup
            // would put O(N) backend calls on every scroll event.
            const mappings = await this.epgBridge.getEpgMappingsBatch([
                ...keyByStreamId.values(),
            ]);
            if (!mappings) {
                return;
            }
            for (const entry of entries) {
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test portal-xtream-data-access
git grep -n "window.electron" -- libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts
pnpm run typecheck:spec libs/portal/xtream/data-access
pnpm nx lint portal-xtream-data-access
```

Expected: the whole project PASSES; the grep prints nothing (exit code 1); spec typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts libs/portal/xtream/data-access/src/lib/services/epg-queue.service.spec.ts
git commit -m "refactor(xtream): resolve queued EPG mappings through the runtime bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Channel list mapping read through the bridge

**Files:**
- Modify: `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts:53, 136-137, 770-790`
- Modify: `libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.spec.ts:1-19` and end of the top-level `describe`

- [ ] **Step 1: Write the failing test**

In `portal-channels-list.component.spec.ts`, replace

```ts
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
```

with

```ts
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
```

Add this test at the end of `describe('PortalChannelsListComponent', ...)`, after `shares favorite toggles with the other list instances of the playlist`:

```ts
    it('reads a manual EPG mapping through the EPG runtime bridge, not window.electron', async () => {
        const electronGetEpgMapping = jest.fn();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: { platform: 'darwin', getEpgMapping: electronGetEpgMapping },
        });
        // `supportsEpgMapping` is read once, when the component is created.
        Object.defineProperty(
            TestBed.inject(RuntimeCapabilitiesService),
            'supportsEpgMapping',
            { configurable: true, get: () => true }
        );
        const getEpgMapping = jest
            .spyOn(TestBed.inject(EpgRuntimeBridgeService), 'getEpgMapping')
            .mockResolvedValue({
                id: 1,
                channelKey: 'xtream:playlist-1:50',
                epgChannelId: ' mapped.id ',
                playlistId: 'playlist-1',
            });
        fixture.destroy();
        fixture = TestBed.createComponent(PortalChannelsListComponent);
        const component = fixture.componentInstance as unknown as {
            readEpgMapping(channelKey: string): Promise<string | null>;
        };

        await expect(
            component.readEpgMapping('xtream:playlist-1:50')
        ).resolves.toBe('mapped.id');
        expect(getEpgMapping).toHaveBeenCalledWith('xtream:playlist-1:50');
        expect(electronGetEpgMapping).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test portal-xtream-feature --testPathPatterns=portal-channels-list.component`

Expected: FAIL in the new test: `readEpgMapping` resolves `null` because the component calls `window.electron.getEpgMapping` (mock returns `undefined`) and never the bridge.

- [ ] **Step 3: Use the bridge in the component**

In `portal-channels-list.component.ts`, replace

```ts
import { EpgQueueService } from '@iptvnator/portal/xtream/data-access';
```

with

```ts
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { EpgQueueService } from '@iptvnator/portal/xtream/data-access';
```

Replace

```ts
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly dialog = inject(MatDialog);
```

with

```ts
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly dialog = inject(MatDialog);
```

Replace

```ts
    /** Read the current mapped EPG channel id, or null (PWA / no mapping). */
    private async readEpgMapping(channelKey: string): Promise<string | null> {
        if (!this.supportsEpgMapping) {
            return null;
        }
        const bridge = (
            window as unknown as {
                electron?: {
                    getEpgMapping?: (
                        key: string
                    ) => Promise<{ epgChannelId?: string } | null>;
                };
            }
        ).electron;
        try {
            const mapping = await bridge?.getEpgMapping?.(channelKey);
            return mapping?.epgChannelId?.trim() || null;
        } catch {
            return null;
        }
    }
```

with

```ts
    /** Read the current mapped EPG channel id, or null (PWA / no mapping). */
    private async readEpgMapping(channelKey: string): Promise<string | null> {
        if (!this.supportsEpgMapping) {
            return null;
        }
        try {
            const mapping = await this.epgBridge.getEpgMapping(channelKey);
            return mapping?.epgChannelId?.trim() || null;
        } catch {
            return null;
        }
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm nx test portal-xtream-feature
git grep -n "electron" -- libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts
pnpm run typecheck:spec libs/portal/xtream/feature
pnpm nx lint portal-xtream-feature
```

Expected: PASS; the grep prints nothing (exit code 1); spec typecheck and lint clean (the file stays in the max-lines baseline; do not edit the baseline).

- [ ] **Step 5: Commit**

```bash
git add libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.spec.ts
git commit -m "refactor(xtream): read channel EPG mappings through the runtime bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Documentation

**Files:**
- Modify: `docs/architecture/pwa-self-hosted.md:155-168`
- Modify: `docs/architecture/m3u-playlist-module.md:1793-1794`

Edit only these lines; never run Prettier on `docs/**`.

- [ ] **Step 1: PWA capabilities paragraph**

In `docs/architecture/pwa-self-hosted.md`, replace

```markdown
and EPG renderer code should use `EpgRuntimeBridgeService` from
`@iptvnator/epg/data-access` instead of calling `window.electron` directly.
```

with

```markdown
and EPG renderer code should use `EpgRuntimeBridgeService` from
`@iptvnator/epg/data-access` instead of calling `window.electron` directly.
The bridge and `EpgSourceSettingsService` call the EPG runtime backend that
the `EPG_RUNTIME_BACKEND` token from `@iptvnator/services` resolves on every
call; the default resolver returns `window.electron`, and the methods a backend
may offer are `EPG_RUNTIME_BACKEND_METHODS` in `@iptvnator/shared/interfaces`.
```

Replace

```markdown
`supportsEpg` remains the aggregate full EPG capability, while narrower runtime
capabilities cover individual EPG surfaces: import/progress, current-program
lookup, optional current-program batch reads, optional channel metadata,
freshness checks, clear/force-fetch management, channel browsing, and program
search. `supportsPlaylistRefresh` requires the native playlist
```

with

```markdown
`supportsEpg` remains the aggregate full EPG capability, while narrower runtime
capabilities cover individual EPG surfaces: import, progress events, the local
file picker, programme lookup, optional current-programme batch reads, optional
channel metadata, freshness checks, clear/force-fetch management, the guide
(programmes for a channel batch and their coverage), programme search and
manual channel mapping. Each EPG capability means "its methods are present on
the EPG runtime backend", so a backend without a file picker or mapping methods
turns exactly those surfaces off; the other capabilities read the preload
bridge. Code that runs before bootstrap, such as the server instance probe,
uses `isElectronRuntime()` instead of constructing the service.
`supportsPlaylistRefresh` requires the native playlist
```

- [ ] **Step 2: Source reconciliation**

In `docs/architecture/m3u-playlist-module.md`, replace

```markdown
`EpgSourceSettingsService` waits for `PlaylistsService.getAllPlaylists()` (which
performs the legacy playlist migration) before invoking `EPG_RECONCILE_SOURCES`.
```

with

```markdown
`EpgSourceSettingsService` waits for `PlaylistsService.getAllPlaylists()` (which
performs the legacy playlist migration) before calling `reconcileEpgSources` on
the EPG runtime backend (`EPG_RUNTIME_BACKEND`; on the desktop that is the
`EPG_RECONCILE_SOURCES` IPC). Without a backend that offers the method,
`synchronize` returns at once and nothing is reconciled.
```

- [ ] **Step 3: Validate and commit**

```bash
git diff --stat -- docs
grep -n "channel browsing" docs/architecture/pwa-self-hosted.md
pnpm run agents:validate
git add docs/architecture/pwa-self-hosted.md docs/architecture/m3u-playlist-module.md
git commit -m "docs(epg): describe the EPG runtime backend seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the diff touches only the two paragraphs; the grep prints nothing; `agents:validate` passes.

---

### Task 13: Full validation

**Files:** none (fixes found here go into the task they belong to, as new commits).

- [ ] **Step 1: Bring in `master` if it moved**

```bash
git fetch origin
git log --oneline HEAD..origin/master
```

If the list is not empty (for example PR 3a, `feat(pwa): show Xtream and Stalker EPG in the browser version`, merged), run `git merge origin/master` (never rebase) and resolve:

- `runtime-capabilities.service.ts`: keep both sides. 3a's `supportsProviderEpg` keeps its own checks and does not use the EPG backend (overview, contract A).
- `runtime-capabilities.service.spec.ts`: turn every new `new RuntimeCapabilitiesService()` from master into `createService()`.
- `with-epg.feature.ts` and its spec: keep master's provider-EPG gate together with this branch's `epgBridge` mapping lookup and `epgBridge` test option.
- `docs/architecture/pwa-self-hosted.md`: keep both paragraphs' changes.

Then `pnpm install --frozen-lockfile` if `pnpm-lock.yaml` changed, and commit the merge.

- [ ] **Step 2: Inventory guards**

```bash
git grep -nE "window\.electron\??\.(fetchEpg|forceFetchEpg|openEpgFileDialog|clearEpgData|clearEpgDataForSource|reconcileEpgSources|getChannelPrograms|getCurrentProgramsBatch|getEpgChannelMetadata|checkEpgFreshness|getEpgProgramsForChannels|getEpgProgramCoverage|searchEpgPrograms|onEpgProgress|getEpgMapping|getEpgMappingsBatch|setEpgMapping|deleteEpgMapping|searchEpgChannels|getEpgChannels)\b" -- libs apps/web/src apps/remote-control-web/src ':(exclude)*.spec.ts'
git grep -n "electron" -- libs/services/src/lib/epg-source-settings.service.ts libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts libs/portal/xtream/data-access/src/lib/services/xtream-xmltv-fallback.service.ts libs/portal/xtream/data-access/src/lib/stores/features/with-epg.feature.ts libs/portal/xtream/data-access/src/lib/services/epg-queue.service.ts libs/portal/xtream/feature/src/lib/portal-channels-list/portal-channels-list.component.ts
git grep -n "new RuntimeCapabilitiesService" -- libs apps
git grep -nE "EpgElectronBridge|ElectronEpgBridge" -- libs
```

Expected: every command prints nothing (exit code 1). The second grep is case-sensitive: type names such as `ElectronBridgeResult` do not match.

- [ ] **Step 3: Types, lint and unit tests**

```bash
pnpm run typecheck:ci
pnpm run typecheck:spec
pnpm nx run-many -t lint -p shared-interfaces services epg-data-access portal-xtream-data-access portal-xtream-feature web
pnpm nx affected -t test --base=origin/master --parallel=3
```

Expected: all pass. `affected` covers every project that depends on `services` (almost all renderer libraries), which is the right scope because `RuntimeCapabilitiesService`, `EpgSourceSettingsService` and `EpgRuntimeBridgeService` are injected nearly everywhere. Compare the six touched projects against the Task 1 baseline: the same tests plus the new ones.

- [ ] **Step 4: Build and initial bytes**

```bash
pnpm nx build web
pnpm run perf:initial-bytes:check
```

Expected: the production build succeeds (AOT DI checks pass) and the initial bytes stay within `tools/performance/journey-baselines.json`. `EPG_RUNTIME_BACKEND_METHODS` is only imported by specs, so production code pulls in the token, `isElectronRuntime()` and a few lines, and drops the old `window.electron` casts.

- [ ] **Step 5: Electron E2E (no behavior change on the desktop)**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/epg.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-epg.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/epg-guide.e2e.ts
```

Expected: PASS. `epg.e2e.ts` is the overview's regression signal for M3U EPG; `xtream-epg.e2e.ts` covers the XMLTV fallback, manual mappings for Xtream and Stalker and the source-removal fence (all four portal call sites and `EpgSourceSettingsService`); `epg-guide.e2e.ts` covers the guide flags.

- [ ] **Step 6: Web E2E (PWA gating and the pre-bootstrap probe)**

```bash
pnpm nx run web-e2e:e2e -- --project=chromium basic.e2e.ts stalker.e2e.ts server-storage.e2e.ts self-hosted.e2e.ts
```

Expected: PASS. `stalker.e2e.ts` still asserts that the PWA hides EPG (unless 3a already flipped those tests, in which case they assert its behavior); `server-storage.e2e.ts` and `self-hosted.e2e.ts` start the app through `probeServerInstance()`, which now uses `isElectronRuntime()`.

If an E2E run cannot start (for example a missing browser), record the command, the reason and the strongest substitute (the unit suites above) for the PR's Checks section; do not mark it passed.

---

### Task 14: Local review gate, push and pull request

**Files:** none.

- [ ] **Step 1: Review the committed branch (at most five rounds)**

```bash
git status --short
git fetch origin
REVIEW_DIR="${TMPDIR:-/tmp}/server-epg-seam-review"
mkdir -p "$REVIEW_DIR"
codex review --base origin/master -c model_reasoning_effort=high > "$REVIEW_DIR/codex-round-1.txt" 2> "$REVIEW_DIR/codex-round-1.log"
greptile review --json > "$REVIEW_DIR/greptile-round-1.json"
tail -40 "$REVIEW_DIR/codex-round-1.txt"
jq '{confidence, comments: (.comments | length)}' "$REVIEW_DIR/greptile-round-1.json"
```

Expected: `git status` is clean before the reviews. Clean means Codex reports no findings and Greptile has `confidence` 5 with an empty `comments` list. For every finding: check it against the code, fix the real ones in a new commit with a conventional message and the `Co-Authored-By` line, write a one-line reason for each declined one, rerun the affected unit tests and lint, then repeat this step with `round-2`, `round-3`, … Stop when both are clean on the same commit, when a round repeats the previous findings, or after round five; in the last two cases report what remains to the maintainer instead of pushing. A reviewer whose CLI is missing or signed out does not block the other; say which one did not run.

- [ ] **Step 2: Push once**

```bash
REVIEWED=$(git rev-parse --short HEAD)
git push -u origin claude/server-epg-seam
```

- [ ] **Step 3: Open the pull request**

```bash
gh label list --search no-release-note
PR_BODY="${TMPDIR:-/tmp}/server-epg-seam-pr.md"
cat > "$PR_BODY" <<'EOF'
## What changed

- `@iptvnator/shared/interfaces`: `EPG_RUNTIME_BACKEND_METHODS`, `EpgRuntimeBackendMethod` and `EpgRuntimeBackend`, the EPG subset of the preload bridge.
- `@iptvnator/services`: the `EPG_RUNTIME_BACKEND` token (`EpgRuntimeBackendResolver`); its default resolver returns `window.electron` on every call.
- `EpgRuntimeCapabilities` (internal to `libs/services`) answers every `supportsEpg*` flag on the resolved backend, calling the resolver on every read; `supportsEpg` keeps its composition. `RuntimeCapabilitiesService` keeps the public getters as delegates, and its other flags still read the preload bridge. Because the service now injects the token, the pre-bootstrap server probe uses the new injector-free `isElectronRuntime()` instead of `new RuntimeCapabilitiesService()`.
- `EpgRuntimeBridgeService` and `EpgSourceSettingsService` call the resolved backend.
- `XtreamXmltvFallbackService`, `withEpg()`, `EpgQueueService` and `PortalChannelsListComponent` use `EpgRuntimeBridgeService` instead of `window.electron`. `EpgQueueService` gates the batch mapping lookup on `supportsEpgMapping`, like Stalker; the preload exposes all mapping methods together, so desktop and PWA behave as before.
- Docs: `docs/architecture/pwa-self-hosted.md` (capabilities, stale "channel browsing" removed) and `docs/architecture/m3u-playlist-module.md` (source reconciliation).

## Why

Server-side EPG for the self-hosted PWA, PR 3b-1 of `docs/superpowers/specs/2026-10-15-server-epg-design.md` (section 6.3). PR 3d provides a server-backed EPG runtime backend with the same method shapes; the EPG capabilities then follow from the methods it has, and no renderer EPG code reads `window.electron` directly any more.

## Release note

None: behavior-preserving refactor, label `no-release-note`.

## Checks

- `pnpm run typecheck:ci`, `pnpm run typecheck:spec`: passed
- `pnpm nx run-many -t lint -p shared-interfaces services epg-data-access portal-xtream-data-access portal-xtream-feature web`: passed
- `pnpm nx affected -t test --base=origin/master`: passed; new specs pin the desktop default of every EPG flag and prove a provided backend drives the flags, the bridge, source reconciliation and the four Xtream call sites
- `pnpm nx build web`, `pnpm run perf:initial-bytes:check`: passed
- Electron E2E `epg.e2e.ts`, `xtream-epg.e2e.ts`, `epg-guide.e2e.ts`: passed
- Web E2E (chromium) `basic`, `stalker`, `server-storage`, `self-hosted`: passed
- Local review gate: Codex and Greptile clean on REVIEWED_SHA

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
sed -i.bak "s/REVIEWED_SHA/$REVIEWED/" "$PR_BODY" && rm "$PR_BODY.bak"
gh pr create --base master --head claude/server-epg-seam \
  --title "refactor(epg): pluggable EPG runtime backend" \
  --label no-release-note \
  --body-file "$PR_BODY"
```

Expected: the label exists and the PR opens. Before `gh pr create`, edit any Checks line whose command was skipped or failed in Task 13 so it states the actual result and reason; list declined review findings under Checks.

- [ ] **Step 4: Report**

Report to the maintainer: the PR URL, the reviewed commit, checks run with results, skipped checks with reasons, the two docs changed, and that no release note was added because behavior is unchanged (label `no-release-note`). GitHub bot findings and CI failures are handled as one round: collect all of them, fix locally, pass the local review gate again, push once.
