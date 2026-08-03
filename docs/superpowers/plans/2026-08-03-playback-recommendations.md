# Playback Recovery Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank evidence-based playback recovery actions and let users try a
recommended built-in web player for the current content without changing their
saved setting.

**Architecture:** Extract the existing pure diagnostic contracts into a new
`@iptvnator/playback/util` Nx project, then add a total ranked-policy function
over structured evidence and explicit target capabilities. Keep playback-session
state in `WebPlayerViewComponent` through a focused helper, render recommendations
through a presentational diagnostic panel, and make every host provide stable
content identity so Retry/source changes preserve attempts while new content
resets them.

**Tech Stack:** Angular 21 signals and standalone components, TypeScript 5.9,
Nx 22, Jest, Playwright for web and Electron, hls.js, Video.js/VHS, Shaka Player,
mpegts.js, ngx-translate, Angular Material/CDK.

---

## File Map

Create the pure project and keep each file focused:

- `libs/playback/util/project.json` — Nx ownership, tags, test, and lint targets.
- `libs/playback/util/tsconfig.json` and `tsconfig.lib.json` — strict library
  compilation.
- `libs/playback/util/src/index.ts` — the only public playback-util barrel.
- `libs/playback/util/src/lib/diagnostics/` — the moved native/HLS/VHS/
  mpegts.js/Shaka evidence and classification boundary.
- `libs/playback/util/src/lib/playback-recommendation.model.ts` — target,
  capability, source-context, reason, priority, and recommendation contracts.
- `libs/playback/util/src/lib/playback-target-capabilities.ts` — deterministic
  source-kind and engine-family mapping.
- `libs/playback/util/src/lib/playback-recommendation-policy.ts` — the total,
  ordered, maximum-three recommendation function.
- `libs/playback/util/src/lib/playback-session-key.ts` — stable content identity
  encoding shared by M3U and portal hosts.

Keep UI ownership under `ui-playback`:

- `libs/ui/playback/src/lib/web-player-view/playback-recovery-session.ts` —
  memory-only attempts, temporary override, resume point, generation, and
  single-flight switch state.
- `libs/ui/playback/src/lib/web-player-view/web-player-playback-state.ts` — pure
  construction of resolved playback, channel, and Video.js options extracted
  from the near-limit host component.
- `libs/ui/playback/src/lib/playback-diagnostic-panel/` — presentational ranked
  recommendation overlay and its formatting helpers, template, styles, and
  specs.
- `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts` —
  orchestration only: engine host, session state, policy input, and outputs.

Host changes stay with their existing owners. E2E uses repository-owned media
under `apps/web-e2e/src/fixtures/playback/`. No production diagnostic-injection
hook is added.

## Task 0: Refresh The Isolated Baseline

**Files:**

- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `docs/superpowers/specs/2026-08-03-playback-recommendations-design.md`
- Verify: `docs/superpowers/plans/2026-08-03-playback-recommendations.md`

- [ ] **Step 1: Rebase the local design/plan commits onto the latest master**

Run:

```bash
git status --short
git fetch origin master --prune
git rebase origin/master
test "$(git merge-base HEAD origin/master)" = "$(git rev-parse origin/master)"
```

Expected: the worktree is clean, the rebase succeeds, and the final command
exits 0. Do not start implementation from the older merged diagnostics branch.

- [ ] **Step 2: Verify dependency and Nx discovery**

Run:

```bash
test -d node_modules || pnpm install --frozen-lockfile
pnpm nx show projects
pnpm nx show projects --withTarget test
pnpm nx show projects --withTarget e2e
```

Expected: exit 0 with `ui-playback`, `web-e2e`, and
`electron-backend-e2e` present.

- [ ] **Step 3: Re-run the affected baseline**

Run:

```bash
pnpm nx test ui-playback
pnpm nx lint ui-playback
```

Expected: the pre-change baseline remains green (currently 91 suites and 915
tests), and lint succeeds. A Jest worker-teardown warning is non-fatal only when
Nx still reports success.

## Task 1: Extract The Pure Playback Diagnostic Boundary

**Files:**

- Create: `libs/playback/util/project.json`
- Create: `libs/playback/util/tsconfig.json`
- Create: `libs/playback/util/tsconfig.lib.json`
- Create: `libs/playback/util/src/index.ts`
- Create: `libs/playback/util/src/lib/playback-util-boundary.spec.ts`
- Move: `libs/ui/playback/src/lib/playback-diagnostics/*`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.ts`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.spec.ts`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-error-contract.ts`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-error-lifecycle.ts`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-error-mapping.ts`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.ts`
- Move: `libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.spec.ts`
- Create: `libs/playback/util/src/lib/diagnostics/shaka-error.types.ts`
- Create: `libs/ui/playback/src/lib/web-video-support/browser-media-type-support.ts`
- Modify: `libs/ui/playback/src/lib/shaka-engine/shaka-module.types.ts`
- Modify: HTML5 and ArtPlayer HLS manifest-codec probe call sites
- Modify: `tsconfig.base.json`
- Modify: `libs/ui/playback/src/index.ts`
- Modify: imports under `libs/ui/playback/src/lib/**/*.ts`

- [ ] **Step 1: Scaffold the pure Nx project**

Create `project.json`:

```json
{
    "name": "playback-util",
    "$schema": "../../../node_modules/nx/schemas/project-schema.json",
    "sourceRoot": "libs/playback/util/src",
    "prefix": "lib",
    "projectType": "library",
    "tags": ["scope:shared", "domain:playback", "type:util"],
    "targets": {
        "test": {
            "executor": "nx:run-commands",
            "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
            "options": {
                "command": [
                    "node",
                    "./tools/testing/run-web-esm-lib-tests.mjs",
                    "libs/playback/util/src"
                ],
                "env": {
                    "NODE_OPTIONS": "--experimental-vm-modules"
                },
                "forwardAllArgs": true
            }
        },
        "lint": {
            "executor": "@nx/eslint:lint"
        }
    }
}
```

Create `tsconfig.json`:

```json
{
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": {
        "isolatedModules": true,
        "target": "es2022",
        "moduleResolution": "bundler",
        "strict": true,
        "noImplicitOverride": true,
        "noPropertyAccessFromIndexSignature": true,
        "noImplicitReturns": true,
        "noFallthroughCasesInSwitch": true,
        "emitDecoratorMetadata": false,
        "module": "preserve"
    },
    "files": [],
    "include": [],
    "references": [{ "path": "./tsconfig.lib.json" }]
}
```

Create `tsconfig.lib.json`:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "outDir": "../../../dist/out-tsc",
        "declaration": true,
        "declarationMap": true,
        "inlineSources": true,
        "types": []
    },
    "include": ["src/**/*.ts"],
    "exclude": ["src/**/*.spec.ts", "src/**/*.test.ts"]
}
```

Add the scoped alias to `tsconfig.base.json`:

```json
"@iptvnator/playback/util": ["libs/playback/util/src/index.ts"]
```

Run:

```bash
pnpm nx show project playback-util
```

Expected: Nx reports `scope:shared`, `domain:playback`, `type:util`, plus test
and lint targets.

- [ ] **Step 2: Move the pure diagnostic files without changing behavior**

Run these repository moves:

```bash
mkdir -p libs/playback/util/src/lib/diagnostics
git mv libs/ui/playback/src/lib/playback-diagnostics/* libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.ts libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-error-classifier.spec.ts libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-error-contract.ts libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-error-lifecycle.ts libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-error-mapping.ts libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.ts libs/playback/util/src/lib/diagnostics/
git mv libs/ui/playback/src/lib/shaka-engine/shaka-playback-evidence.util.spec.ts libs/playback/util/src/lib/diagnostics/
```

Because all moved Shaka files now share the same directory as the diagnostic
model, replace their old `../playback-diagnostics/...` imports with local
`./playback-diagnostics...` imports.

Do not move `shaka-module.types.ts`: it owns the lazy vendor loader and DOM
player surface. Instead, create the DOM-free structural seam in
`shaka-error.types.ts`:

```typescript
export interface ShakaErrorLike {
    readonly severity: number;
    readonly category: number;
    readonly code: number;
    readonly data?: readonly unknown[];
}
```

Import that type locally from the moved Shaka classifier/evidence/lifecycle
files. Remove its old declaration from `shaka-module.types.ts`, import it from
`@iptvnator/playback/util`, and re-export the type there so the UI session keeps
its current local module surface. Keep `shaka-video-session`, the lazy module
loader, `shaka-player-test-double`, and text-track suppression in
`ui-playback`.

Remove the two remaining production DOM references from the moved diagnostic
boundary. Narrow `classifyNativePlaybackIssue` to the already-public
`NativePlaybackErrorInput | null | undefined` structural input; real
`MediaError` values remain assignable. Change the HLS codec preflight to accept
an explicit probe:

```typescript
export type MediaTypeSupportProbe = (mimeType: string) => boolean | undefined;

export function classifyUnsupportedHlsManifestCodecs(
    metadata: PlaybackSourceMetadata,
    isTypeSupported: MediaTypeSupportProbe
): PlaybackDiagnostic | null;
```

The classifier returns null when there are no codecs or the probe returns
`true`/`undefined`, and returns `unsupported-codec` only for exact `false`.
Create the UI-owned adapter:

```typescript
export function isBrowserMediaTypeSupported(
    mimeType: string
): boolean | undefined {
    return typeof MediaSource === 'undefined'
        ? undefined
        : MediaSource.isTypeSupported(mimeType);
}
```

Pass this adapter from the existing HTML5 and ArtPlayer manifest-codec call
sites. Update the closest specs first to prove supported, unsupported, and
unavailable-probe behavior is unchanged.

Add `playback-util-boundary.spec.ts` as a source-boundary regression test. It
must recursively parse every non-spec `.ts` file under the project with the
TypeScript compiler API and fail when an import starts with `@angular/`,
`@iptvnator/ui/`, `electron`, or `@ngx-pwa/`, or when a non-property identifier
references `window`, `document`, `localStorage`, `sessionStorage`,
`MediaSource`, `MediaError`, `HTMLMediaElement`, or `HTMLElement`. Ignoring
property names is required because app-owned evidence values such as
`MpegTsPlaybackFailure.MediaSource` are not DOM access. Assert the current file
set produces an empty violation array.

- [ ] **Step 3: Publish the new barrel and compatibility re-export**

Create `libs/playback/util/src/index.ts`:

```typescript
export * from './lib/diagnostics/playback-diagnostics.util';
export * from './lib/diagnostics/shaka-error-classifier';
export * from './lib/diagnostics/shaka-error-contract';
export * from './lib/diagnostics/shaka-error-lifecycle';
export type * from './lib/diagnostics/shaka-error.types';
```

In `libs/ui/playback/src/index.ts`, replace the deleted relative diagnostic
export with the compatibility export:

```typescript
export * from '@iptvnator/playback/util';
```

Change every internal source and spec import that names
`playback-diagnostics/` or a moved `shaka-error-*` module to the new scoped
alias. Do not add a legacy bare alias or a deep import.

Run:

```bash
rg -n "playback-diagnostics/|shaka-engine/shaka-error-(classifier|contract|lifecycle|mapping)" libs apps --glob '*.ts'
rg -n "typeof (window|document|MediaSource)|\b(window|document|MediaSource)\.|\b(MediaError|HTMLMediaElement|HTMLElement)\s*[|&>,)]" libs/playback/util/src --glob '*.ts' --glob '!*.spec.ts'
```

Expected: no import references a deleted path, and the production
`playback-util` scan prints no Angular, UI, Electron, storage, or DOM
dependency. Documentation may still mention the old path until Task 10.

- [ ] **Step 4: Verify the behavior-preserving extraction**

Run:

```bash
pnpm nx test playback-util
pnpm nx lint playback-util
pnpm nx test ui-playback
pnpm nx lint ui-playback
```

Expected: all migrated diagnostic contract/redaction/version-lock specs and all
remaining UI playback suites pass.

- [ ] **Step 5: Commit the extraction**

```bash
git add tsconfig.base.json libs/playback/util libs/ui/playback
git commit -m "refactor(playback): extract diagnostic utilities"
```

## Task 2: Define Targets, Capabilities, Engine Families, And Session Keys

**Files:**

- Create: `libs/playback/util/src/lib/playback-recommendation.model.ts`
- Create: `libs/playback/util/src/lib/playback-target-capabilities.ts`
- Create: `libs/playback/util/src/lib/playback-target-capabilities.spec.ts`
- Create: `libs/playback/util/src/lib/playback-session-key.ts`
- Create: `libs/playback/util/src/lib/playback-session-key.spec.ts`
- Modify: `libs/playback/util/src/index.ts`

- [ ] **Step 1: Write failing capability and engine-family tests**

Cover the approved matrix with this table:

```typescript
it.each([
    ['hls', 'videojs', 'vhs'],
    ['hls', 'html5', 'hls.js'],
    ['hls', 'artplayer', 'hls.js'],
    ['mpegts', 'videojs', 'mpegts.js'],
    ['mpegts', 'html5', 'mpegts.js'],
    ['mpegts', 'artplayer', 'mpegts.js'],
    ['dash', 'videojs', null],
    ['dash', 'html5', 'shaka'],
    ['dash', 'artplayer', 'shaka'],
    ['native', 'videojs', 'native-media'],
    ['native', 'html5', 'native-media'],
    ['native', 'artplayer', 'native-media'],
] as const)('%s maps %s to %s', (sourceKind, target, expectedFamily) => {
    expect(getInlinePlaybackEngineFamily(sourceKind, target)).toBe(
        expectedFamily
    );
});
```

Also assert that engine-specific `hls`, `mpegts`, `shaka`, and `native`
diagnostic sources are authoritative even when generic metadata disagrees.
For generic `source` and multi-format `vhs`, accept only normalized exact base
MIME/container evidence: `m3u`/`m3u8` and the established HLS MIME aliases,
or `mpd` and `application/dash+xml`. Cover parameters/casing, MIME-only DASH
and HLS, symmetric container/MIME contradictions, malformed MIME substrings,
and insufficient evidence. Contradictory or insufficient evidence stays
`unknown`.

Run:

```bash
pnpm nx test playback-util -- --runTestsByPath libs/playback/util/src/lib/playback-target-capabilities.spec.ts --runInBand
```

Expected: FAIL because the contracts and mapper do not exist.

- [ ] **Step 2: Add the recommendation contracts**

Create `playback-recommendation.model.ts` with these exact public shapes:

```typescript
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';
import type {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
} from './diagnostics/playback-diagnostics.model';

export const PlaybackRecommendationReason = {
    RetryTransientFailure: 'retry-transient-failure',
    RetryUnknownFailure: 'retry-unknown-failure',
    AlternativeSourceAvailable: 'alternative-source-available',
    DifferentEngineFamily: 'different-engine-family',
    ExternalCodecOrContainerSupport: 'external-codec-or-container-support',
    ExternalBrowserAccess: 'external-browser-access',
    CompatibleDrmPath: 'compatible-drm-path',
} as const;

export type PlaybackRecommendationReason =
    (typeof PlaybackRecommendationReason)[keyof typeof PlaybackRecommendationReason];

export type PlaybackRecommendationPriority = 'primary' | 'secondary';
export type PlaybackRecommendationTarget =
    InlinePlaybackPlayer | ExternalPlayerName;

export const PlaybackSourceKind = {
    Hls: 'hls',
    MpegTs: 'mpegts',
    Dash: 'dash',
    Native: 'native',
    Unknown: 'unknown',
} as const;
export type PlaybackSourceKind =
    (typeof PlaybackSourceKind)[keyof typeof PlaybackSourceKind];

export const PlaybackEngineFamily = {
    Vhs: 'vhs',
    HlsJs: 'hls.js',
    MpegTsJs: 'mpegts.js',
    Shaka: 'shaka',
    NativeMedia: 'native-media',
} as const;
export type PlaybackEngineFamily =
    (typeof PlaybackEngineFamily)[keyof typeof PlaybackEngineFamily];

export type PlaybackTargetCapability =
    | {
          readonly kind: 'inline';
          readonly target: InlinePlaybackPlayer;
          readonly available: boolean;
          readonly engineFamily: PlaybackEngineFamily | null;
      }
    | {
          readonly kind: 'external';
          readonly target: ExternalPlayerName;
          readonly available: boolean;
      };

export interface PlaybackRecommendationSourceContext {
    readonly kind: PlaybackSourceKind;
    readonly isLive: boolean;
    readonly drm: 'none' | 'untransferable';
    readonly externalTransferable: boolean;
}

export interface PlaybackRecommendationContext {
    readonly diagnostic: PlaybackDiagnostic;
    readonly activeTarget: PlaybackRecommendationTarget;
    readonly attemptedTargets: ReadonlySet<PlaybackRecommendationTarget>;
    readonly targetCapabilities: readonly PlaybackTargetCapability[];
    readonly source: PlaybackRecommendationSourceContext;
    readonly alternativeSourceCount: number;
}

export type PlaybackRecommendation =
    | {
          readonly action: 'retry';
          readonly reason: PlaybackRecommendationReason;
          readonly priority: PlaybackRecommendationPriority;
      }
    | {
          readonly action: 'alternative-source';
          readonly reason: PlaybackRecommendationReason;
          readonly priority: PlaybackRecommendationPriority;
      }
    | {
          readonly action: 'player';
          readonly target: PlaybackRecommendationTarget;
          readonly reason: PlaybackRecommendationReason;
          readonly priority: PlaybackRecommendationPriority;
      };
```

- [ ] **Step 3: Implement the exact capability mapper**

In `playback-target-capabilities.ts`, export:

```typescript
export function resolvePlaybackSourceKind(
    diagnostic: PlaybackDiagnostic
): PlaybackSourceKind;

export function getInlinePlaybackEngineFamily(
    sourceKind: PlaybackSourceKind,
    target: InlinePlaybackPlayer
): PlaybackEngineFamily | null;

export function createPlaybackTargetCapabilities(options: {
    readonly sourceKind: PlaybackSourceKind;
    readonly managedExternalPlayersAvailable: boolean;
}): readonly PlaybackTargetCapability[];
```

Use this fail-closed mapping. Engine-specific sources identify the diagnostic
boundary that emitted the failure and therefore outrank generic metadata:

```typescript
switch (diagnostic.source) {
    case PlaybackDiagnosticSource.Hls:
        return PlaybackSourceKind.Hls;
    case PlaybackDiagnosticSource.MpegTs:
        return PlaybackSourceKind.MpegTs;
    case PlaybackDiagnosticSource.Shaka:
        return PlaybackSourceKind.Dash;
    case PlaybackDiagnosticSource.Source:
    case PlaybackDiagnosticSource.Vhs:
        return resolveSourceOrVhsKind(diagnostic);
    case PlaybackDiagnosticSource.Native:
        return PlaybackSourceKind.Native;
    default:
        return PlaybackSourceKind.Unknown;
}
```

`resolveSourceOrVhsKind` normalizes MIME to its trimmed, lowercased base
value with parameters stripped. It recognizes exact
`application/vnd.apple.mpegurl`, `application/x-mpegurl`, and the repository's
established `audio/x-mpegurl` alias as HLS, and exact
`application/dash+xml` as DASH. Gather container and MIME evidence separately;
if both are recognized and disagree, return `Unknown`. Otherwise return the
single recognized kind, the shared kind when both agree, or `Unknown`. Never
use substring MIME matching.

Return inline capabilities in canonical order `videojs`, `html5`, `artplayer`
and external capabilities in `mpv`, `vlc` order. Video.js is unavailable for
DASH recommendations; the other matrix rows use the engine families asserted
in Step 1.

- [ ] **Step 4: Drive and implement collision-safe session keys**

Write tests proving callers can reuse one host-owned canonical logical identity
across different provider copies and source URLs, while changing channel,
movie, or episode identity changes the key. Include `:` and `|` in identifiers
to prove parts cannot collide, and assert the module does not expose an adapter
that guesses identity from provider-scoped playback metadata.

Create `playback-session-key.ts`:

```typescript
/**
 * Host-owned canonical logical content identity. Source and content IDs must
 * not come from the currently selected provider copy or playback URL.
 */
export type PlaybackSessionIdentity =
    | {
          readonly kind: 'live';
          readonly sourceId: string;
          readonly contentId: string | number;
      }
    | {
          readonly kind: 'vod';
          readonly sourceId: string;
          readonly contentId: string | number;
      }
    | {
          readonly kind: 'episode';
          readonly sourceId: string;
          readonly contentId: string | number;
          readonly seriesId?: string | number;
          readonly seasonNumber?: number;
          readonly episodeNumber?: number;
      };

export function createPlaybackSessionKey(
    identity: PlaybackSessionIdentity
): string {
    const parts = [
        identity.kind,
        identity.sourceId,
        String(identity.contentId),
        identity.kind === 'episode' ? String(identity.seriesId ?? '') : '',
        identity.kind === 'episode' ? String(identity.seasonNumber ?? '') : '',
        identity.kind === 'episode' ? String(identity.episodeNumber ?? '') : '',
    ];

    return parts.map((part) => `${part.length}:${part}`).join('|');
}
```

Do not add a `PlayerContentInfo` adapter: multi-source resolution replaces its
playlist/content IDs with the selected provider copy, so it cannot represent a
stable recovery session.

Run:

```bash
pnpm nx test playback-util -- --runTestsByPath libs/playback/util/src/lib/playback-target-capabilities.spec.ts libs/playback/util/src/lib/playback-session-key.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Export and commit the contracts**

Add the three new modules to `libs/playback/util/src/index.ts`, then run:

```bash
pnpm nx test playback-util
pnpm nx lint playback-util
git add libs/playback/util
git commit -m "feat(playback): define recovery recommendation contracts"
```

## Task 3: Implement The Ranked Recovery Policy With TDD

**Files:**

- Create: `libs/playback/util/src/lib/playback-recommendation-policy.ts`
- Create: `libs/playback/util/src/lib/playback-recommendation-policy.spec.ts`
- Modify: `libs/playback/util/src/index.ts`

- [ ] **Step 1: Write the failing table for the complete policy matrix**

Use a diagnostic/capability factory and assert exact ordered outputs for:

```typescript
const cases = [
    ['network-error', ['retry', 'alternative-source']],
    ['unknown-playback-error', ['retry', 'alternative-source']],
    ['browser-access-error', ['mpv', 'vlc', 'alternative-source']],
    ['unsupported-codec', ['mpv', 'vlc', 'alternative-source']],
    ['unsupported-container', ['mpv', 'vlc', 'alternative-source']],
    ['media-decode-error:hls-vhs', ['html5', 'mpv', 'vlc']],
    ['media-decode-error:hls-hlsjs', ['videojs', 'mpv', 'vlc']],
    ['media-decode-error:mpegts', ['mpv', 'vlc', 'alternative-source']],
    ['media-decode-error:dash', ['mpv', 'vlc', 'alternative-source']],
    ['media-decode-error:native', ['mpv', 'vlc', 'alternative-source']],
    ['drm-or-encryption:dash-clearkey', ['alternative-source']],
] as const;
```

Add separate tests proving:

- the current and attempted targets are excluded;
- filtering promotes the first survivor to `primary`;
- output is capped at three and later entries are `secondary`;
- HLS returns one representative per distinct engine family;
- ClearKey/KODIPROP context excludes both external targets;
- unavailable managed players are excluded in the PWA;
- missing/contradictory active capability returns only Retry plus alternative
  source;
- the function does not mutate the input Set or capability array and never
  throws for `unknown` source kind.

Run the focused spec. Expected: FAIL because
`recommendPlaybackRecovery` does not exist.

- [ ] **Step 2: Implement ordered candidates and filtering**

Create `playback-recommendation-policy.ts` around this complete flow:

```typescript
type PlaybackRecommendationCandidate =
    | Omit<
          Extract<PlaybackRecommendation, { readonly action: 'retry' }>,
          'priority'
      >
    | Omit<
          Extract<
              PlaybackRecommendation,
              { readonly action: 'alternative-source' }
          >,
          'priority'
      >
    | Omit<
          Extract<PlaybackRecommendation, { readonly action: 'player' }>,
          'priority'
      >;

export function recommendPlaybackRecovery(
    context: PlaybackRecommendationContext
): readonly PlaybackRecommendation[] {
    const capabilityIndex = isPlayerOrientedDiagnostic(context.diagnostic.code)
        ? createCapabilityIndex(context)
        : null;
    const candidates = buildCandidates(context, capabilityIndex).filter(
        (candidate): candidate is PlaybackRecommendationCandidate =>
            candidate !== null
    );
    const seenTargets = new Set<PlaybackRecommendationTarget>();
    const filtered = candidates.filter((candidate) => {
        if (candidate.action !== 'player') {
            return true;
        }
        if (
            candidate.target === context.activeTarget ||
            context.attemptedTargets.has(candidate.target) ||
            seenTargets.has(candidate.target)
        ) {
            return false;
        }
        if (capabilityIndex?.get(candidate.target)?.available !== true) {
            return false;
        }
        if (
            isExternalTarget(candidate.target) &&
            (context.source.drm === 'untransferable' ||
                !context.source.externalTransferable)
        ) {
            return false;
        }
        seenTargets.add(candidate.target);
        return true;
    });

    return filtered
        .slice(0, 3)
        .map<PlaybackRecommendation>((candidate, index) => ({
            ...candidate,
            priority: index === 0 ? 'primary' : 'secondary',
        }));
}
```

`buildCandidates` must use these exact sequences before filtering:

```typescript
switch (context.diagnostic.code) {
    case PlaybackDiagnosticCode.NetworkError:
        return [retryTransient(), alternative(context)];
    case PlaybackDiagnosticCode.UnknownPlaybackError:
        return [retryUnknown(), alternative(context)];
    case PlaybackDiagnosticCode.BrowserAccessError:
        return [
            external('mpv', PlaybackRecommendationReason.ExternalBrowserAccess),
            external('vlc', PlaybackRecommendationReason.ExternalBrowserAccess),
            alternative(context),
        ];
    case PlaybackDiagnosticCode.UnsupportedCodec:
    case PlaybackDiagnosticCode.UnsupportedContainer:
        return [
            external(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            external(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            alternative(context),
        ];
    case PlaybackDiagnosticCode.MediaDecodeError:
        return [
            distinctInline(
                context,
                capabilityIndex,
                PlaybackRecommendationReason.DifferentEngineFamily
            ),
            external(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            external(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            alternative(context),
        ];
    case PlaybackDiagnosticCode.DrmOrEncryption:
        return [
            distinctInline(
                context,
                capabilityIndex,
                PlaybackRecommendationReason.CompatibleDrmPath
            ),
            alternative(context),
            external('mpv', PlaybackRecommendationReason.CompatibleDrmPath),
            external('vlc', PlaybackRecommendationReason.CompatibleDrmPath),
        ];
    default:
        return [retryUnknown(), alternative(context)];
}
```

`buildCandidates` returns
`readonly (PlaybackRecommendationCandidate | null)[]`.
`alternative(context)` returns null unless `alternativeSourceCount` is a
positive safe integer. Before building candidates for a player-oriented
diagnostic, validate one complete, unique capability record for each canonical
target, including exact target/kind pairing and source-kind engine-family
mapping. Any malformed matrix returns Retry plus a valid alternative instead
of trusting player candidates. `distinctInline` then selects the fixed HLS
representative from that validated index independently of capability-array
order: HTML5 represents hls.js after a Video.js/VHS failure, while Video.js
represents VHS after an HTML5 or ArtPlayer hls.js failure. If HTML5 is current,
unavailable, or already attempted, filtering proceeds to external and
alternative candidates without substituting ArtPlayer. For MPEG-TS, DASH,
native, and unknown matrices this naturally returns null.

If a player-oriented diagnostic has no coherent active inline capability,
return `retryUnknown()` plus `alternative(context)` instead of trusting any
player candidate.

- [ ] **Step 3: Run the full policy and project suites**

```bash
pnpm nx test playback-util -- --runTestsByPath libs/playback/util/src/lib/playback-recommendation-policy.spec.ts --runInBand
pnpm nx test playback-util
pnpm nx lint playback-util
```

Expected: every ordered case passes, with no mutation or thrown-error failures.

- [ ] **Step 4: Export and commit the policy**

```bash
git add libs/playback/util
git commit -m "feat(playback): rank recovery recommendations"
```

## Task 4: Add A Focused In-Memory Recovery Session

**Files:**

- Create: `libs/ui/playback/src/lib/web-player-view/playback-recovery-session.ts`
- Create: `libs/ui/playback/src/lib/web-player-view/playback-recovery-session.spec.ts`

- [ ] **Step 1: Write failing lifecycle and race tests**

Cover:

```typescript
session.syncSession('movie-a');
const first = session.beginPlayback('videojs');
expect(session.recordFailure(first)).toBe(true);
expect(session.attemptedTargets()).toEqual(new Set(['videojs']));

session.recordTimeUpdate({ currentTime: 42, duration: 120 }, false);
expect(session.beginPlayerSwitch('html5', false)).toBe(true);
const switched = session.beginPlayback('html5');
expect(switched.target).toBe('html5');
expect(session.temporaryPlayerOverride()).toBe('html5');
expect(session.resumeStartTime(0, false)).toBe(42);

session.syncSession('movie-b');
expect(session.attemptedTargets().size).toBe(0);
expect(session.temporaryPlayerOverride()).toBeNull();
expect(session.resumeStartTime(0, false)).toBe(0);
expect(session.recordFailure(first)).toBe(false);
```

Also test Retry preserves attempts, source changes with the same key preserve
attempts, live sessions never retain a resume point, external attempts are
recorded, an accepted failure or settle clears pending state, and concurrent
switch/retry attempts accept only the first operation.

Run the focused spec. Expected: FAIL because the class does not exist.

- [ ] **Step 2: Implement the signal-backed UI session**

Create the class with this public contract:

```typescript
export interface PlaybackBinding {
    readonly generation: number;
    readonly target: InlinePlaybackPlayer;
}

export class PlaybackRecoverySession {
    readonly attemptedTargets = signal<
        ReadonlySet<PlaybackRecommendationTarget>
    >(new Set());
    readonly temporaryPlayerOverride = signal<InlinePlaybackPlayer | null>(
        null
    );
    readonly switchPending = signal(false);
    readonly activeBinding = signal<PlaybackBinding | null>(null);

    private readonly sessionKey = signal<string | null>(null);
    private readonly generation = signal(0);
    private readonly resumePosition = signal<number | null>(null);

    syncSession(key: string): boolean;
    beginPlayback(target: InlinePlaybackPlayer): PlaybackBinding;
    clearPlaybackBinding(): void;
    recordFailure(binding: PlaybackBinding): boolean;
    recordInlineAttempt(target: InlinePlaybackPlayer): void;
    recordExternalAttempt(target: ExternalPlayerName): void;
    recordTimeUpdate(
        event: { readonly currentTime: number; readonly duration: number },
        isLive: boolean
    ): void;
    beginPlayerSwitch(target: InlinePlaybackPlayer, isLive: boolean): boolean;
    beginRetry(): boolean;
    settle(binding: PlaybackBinding): void;
    resumeStartTime(inputStartTime: number, isLive: boolean): number;
    accepts(binding: PlaybackBinding): boolean;
}
```

Implementation rules:

- `syncSession` is a no-op for the same key; a new key clears attempts,
  override, pending state, resume position, and active binding, then increments
  generation.
- `beginPlayback` always advances the generation and installs the exact active
  target binding. Call it for every applied source, including a same-content
  alternative URL, so delayed events from the replaced source become stale
  without clearing attempts. `clearPlaybackBinding` advances the generation
  and stores null for Embedded MPV/non-diagnostic playback.
- `recordInlineAttempt`, `recordExternalAttempt`, and every failure update copy
  the Set before adding.
- `recordFailure` and `settle` first call `accepts`; stale generations do
  nothing. Both clear `switchPending` for an accepted binding; a replacement
  target that fails before emitting a success/clear event must not leave every
  recovery action disabled.
- `beginPlayerSwitch` returns false while pending; otherwise it records the
  target, clears live resume, sets the override and pending state, and returns
  true. The component's playback effect then calls `beginPlayback` for the new
  selected target.
- `beginRetry` returns false while pending or without an active binding;
  otherwise it keeps attempts/override, marks the reload pending, and returns
  true. Incrementing the component reload token reruns the playback effect and
  installs the next binding.
- `recordTimeUpdate` stores only finite non-negative VOD positions; live,
  `NaN`, `Infinity`, and negative positions are ignored.
- `resumeStartTime` always returns 0 for live playback and otherwise prefers
  the stored finite position over the host input.
- `accepts` compares both the generation and exact target against
  `activeBinding`; a binding for the old target is stale even if a caller
  accidentally reuses its generation.

- [ ] **Step 3: Verify and commit the session helper**

```bash
pnpm nx test ui-playback -- --runTestsByPath libs/ui/playback/src/lib/web-player-view/playback-recovery-session.spec.ts --runInBand
pnpm nx lint ui-playback
git add libs/ui/playback/src/lib/web-player-view/playback-recovery-session.ts libs/ui/playback/src/lib/web-player-view/playback-recovery-session.spec.ts
git commit -m "feat(playback): track session recovery attempts"
```

## Task 5: Bind Stable Content Session Keys In Every Host

**Files:**

- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.html`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.ts`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.html`
- Modify: `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.html`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.spec.ts`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.ts`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.html`
- Modify: `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.spec.ts`
- Modify: `libs/ui/playback/src/lib/portal-inline-player/portal-inline-player.component.ts`
- Modify: `libs/ui/playback/src/lib/portal-inline-player/portal-inline-player.component.html`
- Modify: `libs/ui/playback/src/lib/portal-inline-player/portal-inline-player.component.spec.ts`
- Modify: `libs/ui/playback/src/lib/portal-inline-player/portal-inline-player-sources.spec.ts`
- Modify: `libs/ui/playback/src/lib/portal-inline-player/portal-inline-player-up-next.spec.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.html`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.html`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route-playback.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`
- Modify: `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.html`
- Modify: `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.html`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.html`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.html`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`

- [ ] **Step 1: Add failing host identity tests**

Prove these invariants in the closest existing specs:

- M3U: playlist ID + `Channel.id`; catch-up URL changes keep the key, changing
  channel changes it.
- Xtream live: current playlist ID + selected `xtream_id`.
- Stalker live: current playlist `_id` + normalized selected channel ID.
- Unified live: active item playlist ID + `uid`; timeshift URL changes keep the
  key.
- Portal inline VOD/episode: the Xtream/Stalker route or series host derives a
  canonical key from its original route/catalog identity and passes it through
  unchanged. Replacing playback with an alternative provider copy changes its
  URL and provider-scoped `contentInfo` but keeps the key; selecting a
  different original movie or episode changes it.
- Transfer contract: M3U preserves the resolved request URL plus active-channel
  User-Agent/Referer/Origin; Xtream, Stalker, unified live, and portal inline
  pass the exact `ResolvedPortalPlayback` (including headers and content info)
  to their existing external-launch owner. These assertions justify marking
  current non-DRM Electron playback externally transferable in Task 7.

Run:

```bash
pnpm nx test playlist-m3u-feature-player -- --runTestsByPath libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.spec.ts --runInBand
pnpm nx test portal-xtream-feature -- --runTestsByPath libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.spec.ts --runInBand
pnpm nx test portal-stalker-feature -- --runTestsByPath libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.spec.ts --runInBand
pnpm nx test portal-shared-ui -- --runTestsByPath libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.spec.ts --runInBand
pnpm nx test ui-playback -- --runTestsByPath libs/ui/playback/src/lib/portal-inline-player/portal-inline-player.component.spec.ts libs/ui/playback/src/lib/portal-inline-player/portal-inline-player-sources.spec.ts libs/ui/playback/src/lib/portal-inline-player/portal-inline-player-up-next.spec.ts --runInBand
pnpm nx test portal-xtream-feature -- --runTestsByPath libs/portal/xtream/feature/src/lib/vod-details/vod-details-route-playback.spec.ts libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.spec.ts --runInBand
pnpm nx test portal-stalker-feature -- --runTestsByPath libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.spec.ts libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.spec.ts libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts --runInBand
```

Expected: FAIL because neither the required input nor the host bindings exist.

- [ ] **Step 2: Make content identity required through the player chain**

Add this input to `WebPlayerViewComponent`; Task 7 will consume it, while this
task first makes every current caller compile with a stable key. Add the same
required input to `PortalInlinePlayerComponent` and `VodDetailsComponent`,
which only thread the host-owned value to their nested player:

```typescript
readonly playbackSessionKey = input.required<string>();
```

Update every stub for these three components with the same required input:

```typescript
readonly playbackSessionKey = input.required<string>();
```

- [ ] **Step 3: Bind direct live hosts**

Use `createPlaybackSessionKey` in each component. The M3U shape is:

```typescript
readonly playbackSessionKey = computed(() => {
    const playlistId = this.activePlaylistId();
    const channel = this.activeChannel();
    return playlistId && channel
        ? createPlaybackSessionKey({
              kind: 'live',
              sourceId: playlistId,
              contentId: channel.id,
          })
        : '';
});
```

Xtream and Stalker use their current playlist and selected item IDs in the same
shape. Unified live uses `activeItem().playlistId` and `activeItem().uid`.
Bind every direct view:

```html
<app-web-player-view [playbackSessionKey]="playbackSessionKey()" />
```

Add that binding to each existing component tag without deleting or changing
any of its other input/output bindings. Do not include the current
stream/catch-up URL in these keys.

- [ ] **Step 4: Derive VOD and episode keys in their owning hosts**

Xtream VOD derives its key from the current route playlist and original
`selectedVodId`, not `inlinePlayback().contentInfo`. Xtream series derives an
episode key from the route playlist/series plus the host's active original
episode, season, and episode coordinates. The shapes are:

```typescript
readonly vodPlaybackSessionKey = computed(() =>
    createPlaybackSessionKey({
        kind: 'vod',
        sourceId: this.xtreamStore.currentPlaylist()?.id ?? '',
        contentId: this.selectedVodId(),
    })
);

readonly episodePlaybackSessionKey = computed(() => {
    const originalEpisode = this.playback.inlineEpisodeState()?.episode;
    return createPlaybackSessionKey({
        kind: 'episode',
        sourceId: this.xtreamStore.currentPlaylist()?.id ?? '',
        contentId: originalEpisode?.id ?? '',
        seriesId: this.routeParams().serialId ?? '',
        seasonNumber: originalEpisode?.season,
        episodeNumber: originalEpisode?.episode_num,
    });
});
```

Use the equivalent original catalog/route item and active episode identity in
Stalker VOD and series hosts. Thread the required key through any
`StalkerInlineDetailComponent`/`VodDetailsComponent` intermediary, bind it to
`PortalInlinePlayerComponent`, and have that component pass the exact input to
its nested `WebPlayerViewComponent`.

Do not derive or fall back from `playback.contentInfo`, `streamUrl`, or title.
Alternative-source resolution intentionally rewrites `contentInfo.playlistId`
and `contentXtreamId` for the selected provider copy; those fields remain
playback/resume metadata and are not recovery-session identity. Host specs must
replace the full playback payload with such an alternative copy and prove the
required key is unchanged.

- [ ] **Step 5: Verify every required binding and host project**

Run:

```bash
rg -l "<app-web-player-view|<app-portal-inline-player|<app-vod-details" libs apps --glob '*.html'
```

Inspect every returned template and confirm each required link in the player
chain binds `[playbackSessionKey]`. Then run:

```bash
pnpm nx test playlist-m3u-feature-player
pnpm nx test portal-xtream-feature
pnpm nx test portal-stalker-feature
pnpm nx test portal-shared-ui
pnpm nx test ui-playback
pnpm nx lint playlist-m3u-feature-player
pnpm nx lint portal-xtream-feature
pnpm nx lint portal-stalker-feature
pnpm nx lint portal-shared-ui
pnpm nx lint ui-playback
```

Expected: all host identity and existing playback tests pass.

- [ ] **Step 6: Commit stable key wiring**

```bash
git add libs/playlist/m3u/feature-player libs/portal/xtream/feature libs/portal/stalker/feature libs/portal/shared/ui libs/ui/playback
git commit -m "feat(playback): identify content recovery sessions"
```

## Task 6: Build The Presentational Ranked Diagnostic Panel

**Files:**

- Create: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.ts`
- Create: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.html`
- Create: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.scss`
- Create: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.spec.ts`
- Create: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.ts`
- Create: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.spec.ts`
- Modify: `apps/web/src/assets/i18n/*.json`

- [ ] **Step 1: Write failing view-model and component tests**

Assert the exact mappings:

```typescript
expect(getRecommendationTestId(player('videojs'))).toBe(
    'playback-recommendation-videojs'
);
expect(getRecommendationTestId(player('html5'))).toBe(
    'playback-recommendation-html5'
);
expect(getRecommendationTestId(player('artplayer'))).toBe(
    'playback-recommendation-artplayer'
);
expect(getRecommendationTestId(player('mpv'))).toBe('playback-fallback-mpv');
expect(getRecommendationTestId(player('vlc'))).toBe('playback-fallback-vlc');
expect(getRecommendationTestId(retry())).toBe('playback-retry');
```

The component spec must prove one primary and at most two secondary actions,
native button semantics, disabled buttons while pending, the bounded
`VodSourceRow` block for an alternative-source recommendation, Copy URL and
Technical details always present, and output events for Retry/player/source
selection. Assert the template has no autofocus/focus-trap behavior, and read
the component stylesheet in the spec to preserve the existing `:focus-visible`
outline plus the new narrow container query, one-column grid, wrapping, and
`min-width: 0` guards.

Run:

```bash
pnpm nx test ui-playback -- --runTestsByPath libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.spec.ts libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.spec.ts --runInBand
```

Expected: FAIL because the files do not exist.

- [ ] **Step 2: Add the standalone component contract**

Create the component with these inputs and outputs:

```typescript
@Component({
    selector: 'app-playback-diagnostic-panel',
    templateUrl: './playback-diagnostic-panel.component.html',
    styleUrl: './playback-diagnostic-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ClipboardModule,
        MatIconModule,
        MatTooltipModule,
        TranslateModule,
        VodSourceRowComponent,
    ],
    host: { class: 'playback-diagnostic-panel' },
})
export class PlaybackDiagnosticPanelComponent {
    readonly diagnostic = input.required<PlaybackDiagnostic>();
    readonly recommendations =
        input.required<readonly PlaybackRecommendation[]>();
    readonly playback = input.required<ResolvedPortalPlayback>();
    readonly alternativeSources = input<readonly VodSourceDescriptor[]>([]);
    readonly pending = input(false);

    readonly retryRequested = output<void>();
    readonly playerRequested = output<PlaybackRecommendationTarget>();
    readonly alternativeSourceRequested = output<string>();
    readonly sourceCheckRequested = output<string>();
}
```

Keep the existing `ERROR_SCREEN_ALTERNATIVES = 5`, `visibleAlternatives`, and the hidden
count inside this panel. Move the existing diagnostic title/meta/codec/detail
formatters into this folder unchanged; add small exhaustive functions mapping
recommendation reasons to translation keys, player names, icons, and the stable
test IDs asserted above. Derive `hasExternalPlayerRecommendation` from actual
ranked `mpv`/`vlc` entries. Use it for the existing native-vs-inline headline
choice and as the boolean passed to `getDiagnosticDescriptionKey`; this keeps
the browser-access PWA description accurate when policy or DRM filtering
removes managed external actions.

- [ ] **Step 3: Render the ranked action list without redesigning the overlay**

Copy the current badge, headline, description, metadata, codec hint, source-row,
Copy URL, and details markup verbatim. Replace the fixed action areas with this
ordered loop:

```html
<div
    class="web-player-diagnostic__recommendations"
    [attr.aria-label]="'PLAYBACK_DIAGNOSTICS.RECOMMENDATIONS_LABEL' | translate"
>
    @for (recommendation of recommendations(); track
    getRecommendationKey(recommendation)) { @if (recommendation.action ===
    'alternative-source') {
    <fieldset
        class="web-player-diagnostic__alternatives"
        [class.web-player-diagnostic__alternatives--primary]="recommendation.priority === 'primary'"
        [disabled]="pending()"
        data-test-id="playback-alternative-sources"
    >
        <h3 class="web-player-diagnostic__alternatives-title">
            {{ 'PORTALS.MULTI_SOURCE.TRY_ANOTHER_SOURCE' | translate }}
        </h3>
        @for (source of visibleAlternatives(); track source.id) {
        <app-vod-source-row
            [source]="source"
            [showPin]="false"
            (playRequested)="alternativeSourceRequested.emit($event)"
            (checkRequested)="sourceCheckRequested.emit($event)"
        />
        } @if (hiddenAlternativeCount() > 0) {
        <p class="web-player-diagnostic__alternatives-more">
            {{ 'PORTALS.MULTI_SOURCE.MORE_SOURCES' | translate : { count:
            hiddenAlternativeCount() } }}
        </p>
        }
    </fieldset>
    } @else {
    <button
        type="button"
        class="web-player-diagnostic__player-card"
        [class.web-player-diagnostic__player-card--primary]="recommendation.priority === 'primary'"
        [attr.data-test-id]="getRecommendationTestId(recommendation)"
        [disabled]="pending()"
        (click)="activate(recommendation)"
    >
        <mat-icon aria-hidden="true"
            >{{ getRecommendationIcon(recommendation) }}</mat-icon
        >
        <span class="web-player-diagnostic__player-copy">
            <span class="web-player-diagnostic__player-label">
                {{ getRecommendationLabelKey(recommendation) | translate:
                getRecommendationParams(recommendation) }}
            </span>
            <span class="web-player-diagnostic__player-hint">
                {{ getRecommendationReasonKey(recommendation.reason) | translate
                }}
            </span>
            @if (isTemporaryBuiltInRecommendation(recommendation)) {
            <span class="web-player-diagnostic__player-hint">
                {{ 'PLAYBACK_DIAGNOSTICS.ACTION_TRY_PLAYER_HINT' | translate }}
            </span>
            }
        </span>
    </button>
    } }
</div>
```

`activate` emits Retry for `retry`, emits the target for `player`, and leaves
individual `VodSourceRow` buttons responsible for source selection.
`isTemporaryBuiltInRecommendation` returns true only when `action === 'player'`
and the target is one of `videojs`, `html5`, or `artplayer`; external targets
must not show the saved-player hint.
Do not add autofocus or a focus trap.

- [ ] **Step 4: Copy and adapt the existing diagnostic styles**

Copy `.web-player-diagnostic*` rules from
`web-player-view.component.scss` into the panel stylesheet. Add:

```scss
:host {
    display: contents;
}

.web-player-diagnostic__recommendations {
    display: grid;
    grid-template-columns: repeat(2, minmax(168px, 192px));
    gap: 12px;
    margin-top: 28px;
}

.web-player-diagnostic__player-card {
    min-width: 0;
}

.web-player-diagnostic__alternatives {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

@container (max-width: 520px) {
    .web-player-diagnostic__recommendations {
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        margin-top: 16px;
    }
}
```

Keep the current focus-visible outline and mobile detail layout. Do not change
the overlay colors or typography.

- [ ] **Step 5: Add translation-key parity**

Add these keys under `PLAYBACK_DIAGNOSTICS` in every locale file:

```json
{
    "RECOMMENDATIONS_LABEL": "Recommended recovery actions",
    "ACTION_TRY_PLAYER": "Try {{player}}",
    "ACTION_TRY_PLAYER_HINT": "Temporary for this item; your saved player stays unchanged",
    "REASON_RETRY_TRANSIENT_FAILURE": "Retry the same player after a temporary loading failure",
    "REASON_RETRY_UNKNOWN_FAILURE": "Retry because the failure did not identify another compatible player",
    "REASON_ALTERNATIVE_SOURCE_AVAILABLE": "Try another available source for the same content",
    "REASON_DIFFERENT_ENGINE_FAMILY": "This player uses a different browser playback engine",
    "REASON_EXTERNAL_CODEC_OR_CONTAINER_SUPPORT": "Native players support more codecs and containers",
    "REASON_EXTERNAL_BROWSER_ACCESS": "A native player may avoid browser access restrictions",
    "REASON_COMPATIBLE_DRM_PATH": "This target is compatible with the available encryption data"
}
```

The block above is the canonical English copy. Add meaning-equivalent localized
values to all 18 other locale files; do not leave the new values in English in
non-English files. Reuse existing localized MPV, VLC, Retry, Copy URL, and
Technical details strings rather than adding duplicates.

Run:

```bash
pnpm run i18n:validate
```

Expected: every locale has identical keys and placeholder variables.

- [ ] **Step 6: Verify and commit the unused presentational unit**

The new component is intentionally not mounted until Task 7, so existing UI
behavior remains unchanged in this commit.

```bash
pnpm nx test ui-playback -- --runTestsByPath libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.spec.ts libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.spec.ts --runInBand
pnpm nx lint ui-playback
git add libs/ui/playback/src/lib/playback-diagnostic-panel apps/web/src/assets/i18n
git commit -m "feat(ui): add ranked playback diagnostic panel"
```

## Task 7: Integrate Policy And Temporary Player Switching

**Files:**

- Create: `libs/ui/playback/src/lib/web-player-view/web-player-playback-state.ts`
- Create: `libs/ui/playback/src/lib/web-player-view/web-player-playback-state.spec.ts`
- Create: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.html`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.scss`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.spec-stubs.ts`
- Modify: diagnostic factories/specs under `libs/playback/util` and
  `libs/ui/playback`

- [ ] **Step 1: Extract existing playback construction before adding state**

Drive `web-player-playback-state.spec.ts` from the current component assertions,
then extract these pure functions:

```typescript
export function resolveWebPlayerPlayback(options: {
    readonly playback: ResolvedPortalPlayback | null;
    readonly streamUrl: string;
    readonly title: string;
    readonly startTime: number;
}): ResolvedPortalPlayback;

export function createWebPlayerChannel(
    playback: ResolvedPortalPlayback
): Channel;

export function createVideoJsOptions(options: {
    readonly streamUrl: string;
    readonly isLive: boolean;
    readonly reloadToken: number;
}): {
    readonly isLive: boolean;
    readonly reloadToken: number;
    readonly sources: readonly {
        readonly src: string;
        readonly type: string;
    }[];
};
```

Move the existing MIME selection and case-insensitive header lookup into these
functions without changing output. Replace `setChannel`, `setVjsOptions`, and
the resolved-playback construction in the component with these helpers.

Run:

```bash
pnpm nx test ui-playback -- --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-playback-state.spec.ts libs/ui/playback/src/lib/web-player-view/web-player-view.component.spec.ts --runInBand
```

Expected: PASS before recommendation behavior is added and production
`web-player-view.component.ts` drops below 300 counted lines after the full
Task 7 edit.

- [ ] **Step 2: Write failing WebPlayerView recovery integration tests**

In the new recovery spec, use the existing player stubs and prove:

1. a fatal Video.js HLS media diagnostic ranks HTML5, MPV, then VLC;
2. clicking HTML5 mounts the HTML5 stub while the settings storage still says
   Video.js;
3. a second failure excludes Video.js and HTML5 from subsequent player actions;
4. Retry preserves attempts and reloads the active target;
5. a same-key playback URL change preserves attempts;
6. a new key clears attempts and the temporary override;
7. VOD switching passes the latest finite time as start time while live passes
   zero;
8. a stale `{ generation, target }` issue cannot replace the current diagnostic;
9. playback with `drm` never ranks MPV/VLC;
10. PWA capabilities never render managed external-player actions;
11. a pending switch disables another action.

Run:

```bash
pnpm nx test ui-playback -- --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts --runInBand
```

Expected: FAIL because policy wiring and temporary switching are absent.

- [ ] **Step 3: Add session and recommendation signals to WebPlayerView**

Add the required input and focused computed state:

```typescript
readonly playbackSessionKey = input.required<string>();
private readonly recoverySession = new PlaybackRecoverySession();
readonly recoveryPending = this.recoverySession.switchPending.asReadonly();
readonly activeBinding = this.recoverySession.activeBinding.asReadonly();

readonly selectedPlayer = computed<VideoPlayer>(() => {
    const temporary = this.recoverySession.temporaryPlayerOverride();
    return temporary
        ? toVideoPlayer(temporary)
        : (this.playerOverride() ??
              this.settings()?.player ??
              VideoPlayer.VideoJs);
});

readonly effectiveStartTime = computed(() =>
    this.recoverySession.resumeStartTime(
        this.startTime(),
        this.resolvedIsLive()
    )
);
```

Add an exhaustive `toVideoPlayer` helper mapping `videojs` to
`VideoPlayer.VideoJs`, `html5` to `VideoPlayer.Html5Player`, and `artplayer` to
`VideoPlayer.ArtPlayer`; do not cast between the const-derived diagnostic type
and the settings enum.

Use one playback effect that reads `playbackSessionKey` first, calls
`syncSession`, reads the resolved playback/selected player/reload token, then
calls `beginPlayback(inlineTarget)` immediately before `applyPlayback`. For
Embedded MPV call `clearPlaybackBinding`. Clear the visible diagnostic for
each newly applied source but do not clear attempts when `syncSession` reports
the same content key. Pass the newly returned binding into `applyPlayback` and
require both the header service's `stillCurrent` result and
`recoverySession.accepts(binding)` before its asynchronous callback hands a
source to a web player. This ordering makes key, source, Retry, and target
changes invalidate all older callbacks.

At the start of `handlePlaybackIssue`, call a small `syncRecoverySession()`
helper that synchronizes the latest required input and clears a diagnostic if
the key changed. This closes the narrow interval between an Angular input
update and its effect flush, so an old child output cannot land in the new
content session.

Build `recommendations` from the current diagnostic with:

```typescript
readonly recommendations = computed(() => {
    const issue = this.visiblePlaybackDiagnostic();
    const binding = this.activeBinding();
    if (!issue || !binding) {
        return [];
    }

    const sourceKind = resolvePlaybackSourceKind(issue);
    return recommendPlaybackRecovery({
        diagnostic: issue,
        activeTarget: binding.target,
        attemptedTargets: this.recoverySession.attemptedTargets(),
        targetCapabilities: createPlaybackTargetCapabilities({
            sourceKind,
            managedExternalPlayersAvailable:
                this.runtime.supportsManagedExternalPlayers,
        }),
        source: {
            kind: sourceKind,
            isLive: this.resolvedIsLive(),
            drm: this.resolvedPlayback().drm
                ? 'untransferable'
                : 'none',
            externalTransferable: !this.resolvedPlayback().drm,
        },
        alternativeSourceCount: this.alternativeSources().length,
    });
});
```

The non-DRM transferability fact is allowed only because Task 5 proves every
current WebPlayerView host forwards the full required payload through its
existing external-player path. If any host cannot satisfy that assertion,
add a required host capability input and pass false there instead of weakening
the policy or inferring safety from the URL.

- [ ] **Step 4: Make engine events generation-safe**

Change player outputs to pass the binding captured for that rendered branch:

```html
@let binding = activeBinding(); @if (binding && selectedPlayer() === 'videojs')
{
<app-vjs-player
    [startTime]="effectiveStartTime()"
    (timeUpdate)="handleTimeUpdate($event)"
    (playbackIssue)="handlePlaybackIssue($event, binding)"
/>
}
```

Apply the same pattern to HTML5 and ArtPlayer. In `handlePlaybackIssue`:

```typescript
handlePlaybackIssue(
    issue: PlaybackDiagnostic | null,
    binding: PlaybackBinding
): void {
    if (!this.recoverySession.accepts(binding)) {
        return;
    }
    if (!issue) {
        this.recoverySession.settle(binding);
        this.playbackDiagnostic.set(null);
        return;
    }
    if (!this.recoverySession.recordFailure(binding)) {
        return;
    }
    this.playbackDiagnostic.set(issue);
    this.playbackFailed.emit(issue.code);
}
```

Capture the same generation before the asynchronous Electron header operation;
its `then` callback must call `recoverySession.accepts(binding)` before handing
the source to a player.

`handleTimeUpdate` records the latest position, then forwards the unchanged
event to the host output.

- [ ] **Step 5: Implement recommendation actions**

Use one dispatcher:

```typescript
requestRecommendedPlayer(target: PlaybackRecommendationTarget): void {
    const diagnostic = this.visiblePlaybackDiagnostic();
    if (!diagnostic) {
        return;
    }

    if (target === 'mpv' || target === 'vlc') {
        this.recoverySession.recordExternalAttempt(target);
        this.externalFallbackRequested.emit({
            player: target,
            playback: this.resolvedPlayback(),
            diagnostic,
        });
        return;
    }

    const available = this.recommendations().some(
        (item) => item.action === 'player' && item.target === target
    );
    if (!available) {
        this.recoverySession.recordInlineAttempt(target);
        return;
    }

    if (
        this.recoverySession.beginPlayerSwitch(
            target,
            this.resolvedIsLive()
        )
    ) {
        this.playbackDiagnostic.set(null);
    }
}
```

The unavailable inline branch records the target through the
`recordInlineAttempt(target)` method defined in Task 4, leaving the diagnostic
visible so the computed list reranks immediately. Retry calls `beginRetry`,
and only when it returns true clears the diagnostic and increments
`reloadToken`; the playback effect rebuilds the same source with a new binding
without clearing attempts. Alternative source output does not reset session
state.

- [ ] **Step 6: Mount the panel and remove the old overlay**

Replace the entire inline diagnostic `<section>` in
`web-player-view.component.html` with:

```html
@if (visiblePlaybackDiagnostic(); as issue) {
<app-playback-diagnostic-panel
    [diagnostic]="issue"
    [recommendations]="recommendations()"
    [playback]="resolvedPlayback()"
    [alternativeSources]="alternativeSources()"
    [pending]="recoveryPending()"
    (retryRequested)="retryPlayback()"
    (playerRequested)="requestRecommendedPlayer($event)"
    (alternativeSourceRequested)="alternativeSourceRequested.emit($event)"
    (sourceCheckRequested)="sourceCheckRequested.emit($event)"
/>
}
```

Delete `.web-player-diagnostic*` rules from the WebPlayerView stylesheet now
that the panel owns them. Preserve the host/container and defer-placeholder
rules.

- [ ] **Step 7: Remove diagnostic-owned fallback policy**

Delete `externalFallbackRecommended` from `PlaybackDiagnostic`, the factory
option/default, classifier overrides, and every fixture assertion. Replace the
old boolean expectations with policy assertions in
`playback-recommendation-policy.spec.ts`.

Run:

```bash
rg -n "externalFallbackRecommended|canShowExternalFallbackActions" libs apps --glob '*.ts' --glob '*.html'
```

Expected: no matches.

- [ ] **Step 8: Verify integration, file limits, and commit**

```bash
pnpm nx test playback-util
pnpm nx test ui-playback
pnpm nx lint playback-util
pnpm nx lint ui-playback
node tools/eslint/generate-max-lines-baseline.mjs
git diff -- tools/eslint/max-lines-baseline.mjs
```

Expected: tests/lint pass; no new baseline entry appears; if the generator
removes a now-split UI file, retain that shrink. Every new production
TypeScript file and the edited `web-player-view.component.ts` remain below 300
counted lines.

```bash
git add libs/playback/util libs/ui/playback tools/eslint/max-lines-baseline.mjs
git commit -m "feat(playback): switch temporarily to recommended players"
```

## Task 8: Cover Temporary Built-In Switching In Web E2E

**Files:**

- Create: `apps/web-e2e/src/fixtures/playback/fatal-media.m3u8`
- Create: `apps/web-e2e/src/fixtures/playback/corrupt.ts`
- Create: `apps/web-e2e/src/playback-recommendations.e2e.ts`

- [ ] **Step 1: Add the bounded offline HLS fixture**

Create `fatal-media.m3u8`:

```text
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:1,
corrupt.ts
#EXT-X-ENDLIST
```

Create `corrupt.ts` as the literal text:

```text
This is intentionally not an MPEG transport stream segment.
```

The fixture contains no external URL or account data.

- [ ] **Step 2: Write the Playwright flow**

In the new E2E file:

1. block service workers and run Chromium with autoplay allowed;
2. route `https://playback-fixture.local/**` to the two fixture files with
   `application/vnd.apple.mpegurl` and `video/mp2t` content types;
3. open Settings, select HTML5, and save;
4. import a one-channel raw M3U pointing to
   `https://playback-fixture.local/fatal-media.m3u8`;
5. select the channel and wait for the structured fatal HLS media diagnostic;
6. assert `playback-recommendation-videojs` is primary;
7. click it and assert `app-vjs-player` mounts;
8. return to Settings and assert the persisted selector still reads HTML5.

Use these stable locators:

```typescript
const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
const videoJsRecommendation = page.locator(
    '[data-test-id="playback-recommendation-videojs"]'
);
await expect(banner).toBeVisible({ timeout: 15_000 });
await expect(videoJsRecommendation).toBeVisible();
await videoJsRecommendation.click();
await expect(page.locator('app-vjs-player')).toBeVisible();
```

Do not add a test-only production API. If Chromium reports a different public
terminal hls.js media detail for the bounded corrupt segment, update only the
fixture to another deterministic public fatal media event; retain the
component-level exact policy test.

- [ ] **Step 3: Run the atomized web E2E target and commit**

After Nx discovers the new file, run:

```bash
pnpm nx run web-e2e:e2e-ci--src/playback-recommendations.e2e.ts -- --project=chromium
```

Expected: the recommendation mounts Video.js and the Settings selector remains
HTML5.

```bash
git add apps/web-e2e/src/fixtures/playback apps/web-e2e/src/playback-recommendations.e2e.ts
git commit -m "test(playback): cover temporary player recommendation"
```

## Task 9: Cover DRM Exclusion And External Fallback In Electron E2E

**Files:**

- Create: `apps/web-e2e/src/fixtures/playback/unsupported.mkv`
- Modify: `apps/electron-backend-e2e/src/dash-clearkey.e2e.ts`
- Modify: `apps/web-e2e/src/dash-clearkey.e2e.ts`

- [ ] **Step 1: Extend ClearKey assertions before adding the eligible case**

For the unsupported Widevine channel in both existing E2E files, assert:

```typescript
await expect(
    banner.locator('[data-test-id="playback-fallback-mpv"]')
).toHaveCount(0);
await expect(
    banner.locator('[data-test-id="playback-fallback-vlc"]')
).toHaveCount(0);
```

In web E2E also assert no built-in recommendation test ID is rendered. The web
runtime already lacks managed external launch, while the Electron assertion is
the required proof that DRM transferability—not runtime capability—filters the
targets.

- [ ] **Step 2: Add a deterministic unsupported-container fixture**

Create `unsupported.mkv` with a small non-media payload:

```text
This fixture intentionally declares Matroska without playable media bytes.
```

Extend the Electron fixture server to serve `.mkv` as `video/matroska`, and add
an `Unsupported MKV` channel to the imported M3U. Video.js/native media must
surface `unsupported-container` from the `.mkv` metadata rather than a network
diagnostic.

- [ ] **Step 3: Capture and assert the existing MPV launch request**

Install local IPC capture in the Electron test before selecting the MKV
channel:

```typescript
await app.electronApp.evaluate(({ ipcMain }) => {
    const launches: Array<{ player: string; url: string; title: string }> = [];
    (
        globalThis as typeof globalThis & {
            __playbackRecommendationLaunches?: typeof launches;
        }
    ).__playbackRecommendationLaunches = launches;
    ipcMain.removeHandler('OPEN_MPV_PLAYER');
    ipcMain.handle('OPEN_MPV_PLAYER', async (_event, url, title) => {
        launches.push({ player: 'mpv', url, title });
        const now = new Date().toISOString();
        return {
            canClose: false,
            id: 'e2e-recommended-mpv',
            player: 'mpv',
            startedAt: now,
            status: 'opened',
            streamUrl: url,
            thumbnail: null,
            title,
            updatedAt: now,
        };
    });
});
```

Select `Unsupported MKV`, assert both existing MPV/VLC test IDs are visible,
click MPV, and poll the main-process capture for exactly one launch with the
fixture URL and channel title. This verifies the existing
`PlaybackFallbackRequest` path remains intact.

- [ ] **Step 4: Run both atomized DASH/Electron targets and commit**

```bash
pnpm nx run web-e2e:e2e-ci--src/dash-clearkey.e2e.ts -- --project=chromium
pnpm nx run electron-backend-e2e:e2e-ci--src/dash-clearkey.e2e.ts
```

Expected: ClearKey still plays, unsupported DRM shows no external actions, and
eligible Matroska failure launches the captured MPV request.

```bash
git add apps/web-e2e/src/fixtures/playback/unsupported.mkv apps/web-e2e/src/dash-clearkey.e2e.ts apps/electron-backend-e2e/src/dash-clearkey.e2e.ts
git commit -m "test(playback): verify recommendation capability guards"
```

## Task 10: Update Canonical Documentation And Release Note

**Files:**

- Modify: `docs/architecture/embedded-inline-playback.md`
- Modify: `docs/architecture/nx-workspace-boundaries.md`
- Modify: `docs/architecture/player-controls-contract.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `.changes/playback-recovery-recommendations.md`

- [ ] **Step 1: Update the canonical architecture flow**

In `embedded-inline-playback.md`, document this exact sequence:

```text
engine public error
  -> sanitized PlaybackDiagnostic (@iptvnator/playback/util)
  -> recommendPlaybackRecovery(context)
  -> ranked maximum-three action model
  -> WebPlayerView session-local user action
```

Include the HLS/VHS, shared mpegts.js, Shaka/DASH, and native-media engine-family
matrix; the network/unknown fail-closed rule; ClearKey/KODIPROP external
suppression; temporary override lifecycle; and the no-history/no-auto-switch
boundary.

- [ ] **Step 2: Update workspace and controls ownership docs**

Add `playback-util` and `@iptvnator/playback/util` to
`nx-workspace-boundaries.md` with tags
`scope:shared/domain:playback/type:util`. State in
`player-controls-contract.md` that `PlayerController` remains a sibling and
does not own diagnostics or recovery recommendations.

Update the Shared Player Controls/playback diagnostic sections in both
`AGENTS.md` and `CLAUDE.md` with the new path, policy ownership, content-session
key, and temporary-switch semantics. Keep overlapping process guidance in the
two root files synchronized.

- [ ] **Step 3: Add the user-facing release note**

Create:

```markdown
---
type: fix
area: playback
issues: [1159]
---

When playback fails, IPTVnator now ranks useful next steps from the reported
error, including another compatible built-in player, MPV/VLC, Retry, or another
source. Trying a built-in recommendation affects only the current item and
does not change the saved player setting.
```

The body is under 400 characters and describes the user outcome.

- [ ] **Step 4: Validate docs and commit**

```bash
pnpm exec prettier --check docs/architecture/embedded-inline-playback.md docs/architecture/nx-workspace-boundaries.md docs/architecture/player-controls-contract.md AGENTS.md CLAUDE.md .changes/playback-recovery-recommendations.md
pnpm run release:notes:validate
git diff --check
git add docs/architecture AGENTS.md CLAUDE.md .changes/playback-recovery-recommendations.md
git commit -m "docs(playback): document recovery recommendations"
```

## Task 11: Complete The Test-Impact Pass And Local Codex Review

**Files:**

- Verify: all changed files against `origin/master`
- Modify: only files required to fix review findings

- [ ] **Step 1: Verify Nx discovery, boundaries, and focused projects**

```bash
pnpm nx show project playback-util
pnpm nx show projects
pnpm nx sync:check
pnpm nx test playback-util
pnpm nx lint playback-util
pnpm nx test ui-playback
pnpm nx lint ui-playback
pnpm nx test playlist-m3u-feature-player
pnpm nx test portal-xtream-feature
pnpm nx test portal-stalker-feature
pnpm nx test portal-shared-ui
```

Expected: all commands pass and Nx reports the new project with all three tags.

- [ ] **Step 2: Verify application builds and repository gates**

```bash
pnpm nx build web
pnpm nx run electron-backend:build-e2e
pnpm run i18n:validate
pnpm run release:notes:validate
pnpm run skills:validate
git diff --check origin/master...HEAD
```

`skills:validate` is required because `AGENTS.md`/`CLAUDE.md` document literal
repository paths used by skills and agents. Expected: all commands pass.

- [ ] **Step 3: Re-run the atomized playback E2E coverage**

```bash
pnpm nx run web-e2e:e2e-ci--src/playback-recommendations.e2e.ts -- --project=chromium
pnpm nx run web-e2e:e2e-ci--src/dash-clearkey.e2e.ts -- --project=chromium
pnpm nx run electron-backend-e2e:e2e-ci--src/dash-clearkey.e2e.ts
```

Expected: all three targets pass without real provider traffic.

- [ ] **Step 4: Run the requested local Codex P1/P2 review**

The shell-installed npm wrapper is currently missing its native binary; use the
bundled desktop binary directly:

```bash
/Applications/Codex.app/Contents/Resources/codex review \
  --base origin/master \
  "Review this playback recovery PR. Report only actionable P1/P2 correctness, privacy, race, lifecycle, DRM-transfer, Nx-boundary, and regression issues. Verify temporary switching never mutates persisted settings and stale engine events cannot affect a new content session."
```

Expected: no actionable P1/P2 findings. For every finding, reproduce it with a
focused failing test, implement the smallest correction, rerun the affected
project/E2E target, and commit with a scoped `fix(playback): ...` message. Run
the same review once more after fixes.

- [ ] **Step 5: Inspect the final branch without publishing it**

```bash
git status --short --branch
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
git diff --check origin/master...HEAD
```

Expected: clean worktree, only intentional commits/files, and no whitespace
errors. Do not push or create the PR until the user explicitly authorizes those
GitHub mutations.
