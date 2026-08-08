# External Playback Launch Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep MPV/VLC recovery actions visible while reporting exact launch/session state in the diagnostic panel and global dock.

**Architecture:** Add a component-local, credential-free external recovery state machine beside `PlaybackRecoverySession`. It correlates a launch intent to the next matching global `ExternalPlayerSession`, reranks but never removes attempted external targets, and rejects stale session/timer updates. The existing host output still owns source-specific launch payloads; `PORTAL_EXTERNAL_PLAYBACK` supplies session observation and close-before-switch.

**Tech Stack:** Angular signals and control flow, Angular Material icons/spinner, Jest, Nx, Playwright Electron E2E, ngx-translate.

---

### Task 1: External recovery state machine

**Files:**
- Create: `libs/ui/playback/src/lib/web-player-view/external-playback-recovery.ts`
- Create: `libs/ui/playback/src/lib/web-player-view/external-playback-recovery.spec.ts`

- [ ] **Step 1: Write the failing state-machine tests**

Cover the exact public contract:

```typescript
const state = new ExternalPlaybackRecovery();
state.syncSession('content-a');
const intent = state.begin('mpv', 'old-session');

expect(intent).not.toBeNull();
expect(state.pending()).toBe(true);
expect(state.target('mpv')).toMatchObject({
    status: 'launching',
    attempts: 1,
    sessionId: null,
});
expect(state.begin('vlc', 'old-session')).toBeNull();

expect(state.observe(session({ id: 'old-session', player: 'mpv' }))).toBe(false);
expect(state.observe(session({ id: 'new-session', player: 'vlc' }))).toBe(false);
expect(state.observe(session({ id: 'new-session', player: 'mpv' }))).toBe(true);
expect(state.target('mpv').status).toBe('started');
```

Add separate tests for `playing`, `error`, `closed → idle`, stale exact-ID
updates, timeout-to-error, stale timeout after session reset, retry attempt
count, and `destroy()` timer cleanup.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm nx test ui-playback --runTestsByPath libs/ui/playback/src/lib/web-player-view/external-playback-recovery.spec.ts --skip-nx-cache
```

Expected: FAIL because `external-playback-recovery.ts` does not exist.

- [ ] **Step 3: Implement the minimal signal state machine**

Use these exported shapes:

```typescript
export type ExternalRecoveryStatus =
    | 'idle'
    | 'launching'
    | 'started'
    | 'playing'
    | 'error';

export interface ExternalRecoveryTargetState {
    readonly status: ExternalRecoveryStatus;
    readonly attempts: number;
    readonly sessionId: string | null;
}

export interface ExternalRecoveryIntent {
    readonly token: symbol;
    readonly target: ExternalPlayerName;
}

export class ExternalPlaybackRecovery {
    readonly states: Signal<Readonly<Record<ExternalPlayerName, ExternalRecoveryTargetState>>>;
    readonly pending: Signal<boolean>;
    syncSession(key: string): boolean;
    begin(target: ExternalPlayerName, previousSessionId: string | null): ExternalRecoveryIntent | null;
    owns(intent: ExternalRecoveryIntent): boolean;
    observe(session: ExternalPlayerSession | null): boolean;
    fail(intent: ExternalRecoveryIntent): boolean;
    target(target: ExternalPlayerName): ExternalRecoveryTargetState;
    destroy(): void;
}
```

The internal launch timer is 10 seconds, and all ownership tokens are fieldless
`Symbol()` values. Store only target, attempt count, status, ignored prior ID,
and the correlated session ID.

- [ ] **Step 4: Run GREEN and refactor**

Run the Task 1 command again. Expected: all state-machine tests PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/ui/playback/src/lib/web-player-view/external-playback-recovery.ts libs/ui/playback/src/lib/web-player-view/external-playback-recovery.spec.ts
git commit -m "feat(playback): track external recovery launches"
```

### Task 2: Preserve and rerank external recommendations

**Files:**
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-recovery-policy.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts`
- Test: `libs/ui/playback/src/lib/web-player-view/web-player-recovery-policy.spec.ts`

- [ ] **Step 1: Write failing ranking tests**

Add a focused spec for a helper with this contract:

```typescript
const result = createWebPlayerRecommendations({
    ...baseOptions,
    attemptedTargets: new Set(['videojs', 'mpv']),
    externalStates: {
        mpv: { status: 'error', attempts: 1, sessionId: 'mpv-1' },
        vlc: { status: 'idle', attempts: 0, sessionId: null },
    },
});

expect(result.map((item) => item.action === 'player' ? item.target : item.action))
    .toEqual(['vlc', 'mpv', 'alternative-source']);
expect(result.map((item) => item.priority)).toEqual([
    'primary',
    'secondary',
    'secondary',
]);
```

Also prove that an attempted inline family remains excluded, ties preserve MPV
before VLC, input arrays/sets/states are not mutated, and output stays capped at
three.

- [ ] **Step 2: Run RED**

```bash
pnpm nx test ui-playback --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-recovery-policy.spec.ts --skip-nx-cache
```

Expected: FAIL because external state is not accepted and attempted MPV is
removed.

- [ ] **Step 3: Implement filtered policy attempts and stable reranking**

Pass only inline attempted targets into `recommendPlaybackRecovery()`. Stable
sort adjacent external recommendations by `attempts`, using their original
policy index as tie-breaker, then regenerate primary/secondary priority without
mutating inputs.

- [ ] **Step 4: Update old integration expectations**

Change old assertions that expected MPV/VLC to disappear. They must now assert
that both targets remain mounted and the less-attempted sibling is promoted.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm nx test ui-playback --runTestsByPath libs/ui/playback/src/lib/web-player-view/web-player-recovery-policy.spec.ts libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts --skip-nx-cache
git add libs/ui/playback/src/lib/web-player-view/web-player-recovery-policy.ts libs/ui/playback/src/lib/web-player-view/web-player-recovery-policy.spec.ts libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts
git commit -m "fix(playback): keep external recovery actions available"
```

### Task 3: Wire launch ownership and close-before-switch

**Files:**
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.html`
- Modify: `libs/ui/playback/src/lib/web-player-view/playback-recovery-session.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/playback-recovery-session.spec.ts`
- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts`

- [ ] **Step 1: Add failing integration tests**

Provide a fake `PORTAL_EXTERNAL_PLAYBACK` with `activeSession: signal(null)`,
`visibleSession`, and `closeSession`. Prove:

```typescript
mpvButton.click();
mpvButton.click();
expect(fallbackRequests).toHaveLength(1);
expect(component.externalRecoveryPending()).toBe(true);

activeSession.set(externalSession({ id: 'mpv-1', player: 'mpv', status: 'opened' }));
fixture.detectChanges();
expect(component.externalRecoveryState().mpv.status).toBe('started');
expect(playerActionIds()).toContain('playback-fallback-mpv');
```

Add independent tests for close-before-VLC, refusing an unclosable active
session, stale session after `playbackSessionKey` change, no duplicate output,
and no URL/header fields in serialized coordinator state.

- [ ] **Step 2: Run RED**

Run the recovery integration spec. Expected: new assertions FAIL because the
component does not observe external sessions.

- [ ] **Step 3: Wire the coordinator**

Inject `PORTAL_EXTERNAL_PLAYBACK` optionally, observe its active signal in an
`effect`, reset external state from `syncRecoverySession()`, and destroy it from
the existing component cleanup. For external targets:

1. validate the recommendation and current diagnostic;
2. begin one owned external intent;
3. if a nonterminal active external session exists, require `canClose`, await
   `closeSession`, and confirm it is no longer live;
4. recheck intent and diagnostic ownership;
5. record the external attempt and emit the existing exact
   `PlaybackFallbackRequest` once.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm nx test ui-playback --runTestsByPath libs/ui/playback/src/lib/web-player-view/playback-recovery-session.spec.ts libs/ui/playback/src/lib/web-player-view/web-player-view.component.recovery.spec.ts --skip-nx-cache
git add libs/ui/playback/src/lib/web-player-view
git commit -m "feat(playback): synchronize external launch feedback"
```

### Task 4: Render accessible per-target feedback

**Files:**
- Modify: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.ts`
- Modify: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.html`
- Modify: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.scss`
- Modify: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.ts`
- Modify: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.spec.ts`
- Modify: `libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.spec.ts`

- [ ] **Step 1: Write failing view/component tests**

Prove state-aware keys and labels:

```typescript
expect(getRecommendationLabelKey(mpvRecommendation, launchingState))
    .toBe('PLAYBACK_DIAGNOSTICS.ACTION_OPENING_MPV');
expect(getRecommendationLabelKey(mpvRecommendation, errorState))
    .toBe('PLAYBACK_DIAGNOSTICS.ACTION_RETRY_MPV');
```

The component test must assert that the same MPV `HTMLButtonElement` remains in
the DOM through state changes, keeps focus, contains a 16px spinner during
launch, exposes `aria-busy="true"` and `aria-disabled="true"`, and does not emit
when aria-disabled. Assert a visible polite status for started/playing/error.

- [ ] **Step 2: Run RED**

Run both panel specs. Expected: FAIL because the panel has no external-state
input or spinner.

- [ ] **Step 3: Implement the view**

Import the existing Angular Material progress spinner. Keep external buttons
mounted and use `aria-disabled` plus handler guards instead of native
`disabled` for external handshake feedback, preserving keyboard focus. Keep
the existing native `disabled` behaviour for inline switch/retry pending.

Add only transform/opacity/color transitions under 180ms and a
`prefers-reduced-motion` rule that stops spinner animation when appropriate.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm nx test ui-playback --runTestsByPath libs/ui/playback/src/lib/playback-diagnostic-panel/playback-recommendation-view.util.spec.ts libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.spec.ts --skip-nx-cache
git add libs/ui/playback/src/lib/playback-diagnostic-panel
git commit -m "feat(playback): show external launch action states"
```

### Task 5: Keep dock errors visible and use exact statuses

**Files:**
- Modify: `apps/web/src/app/services/external-playback.service.ts`
- Modify: `apps/web/src/app/services/external-playback.service.spec.ts`
- Modify: `libs/ui/components/src/lib/external-playback-dock/external-playback-dock.component.ts`
- Modify: `libs/ui/components/src/lib/external-playback-dock/external-playback-dock.component.html`
- Modify: `libs/ui/components/src/lib/external-playback-dock/external-playback-dock.component.scss`
- Modify: `libs/ui/components/src/lib/external-playback-dock/external-playback-dock.component.spec.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.spec.ts`

- [ ] **Step 1: Write failing service and dock tests**

Change the error-session expectation from hidden to visible, then prove
`dismissActiveSession()` hides it. Add dock cases for:

```typescript
expect(statusText('launching')).toContain('Opening player');
expect(statusText('opened')).toContain('Player started');
expect(statusText('playing')).toContain('Playing');
expect(errorDock.getAttribute('aria-live')).toBe('polite');
expect(dismissButton.textContent).toContain('Dismiss');
```

- [ ] **Step 2: Run RED**

```bash
pnpm nx test web --runTestsByPath apps/web/src/app/services/external-playback.service.spec.ts --skip-nx-cache
pnpm nx test components --runTestsByPath libs/ui/components/src/lib/external-playback-dock/external-playback-dock.component.spec.ts --skip-nx-cache
```

Expected: service error visibility and dock status assertions FAIL.

- [ ] **Step 3: Implement exact dock semantics**

Hide only `closed` in `visibleSession`. Translate launching/opened/playing and
generic error states. Keep detailed existing `session.error` for the visible
error copy. Show “Close player” only for a closable live session and “Dismiss”
for error. Keep the existing output so workspace shell routing does not change.

- [ ] **Step 4: Run GREEN and commit**

Run both commands plus the workspace-shell focused spec, then commit:

```bash
git add apps/web/src/app/services/external-playback.service.ts apps/web/src/app/services/external-playback.service.spec.ts libs/ui/components/src/lib/external-playback-dock libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.spec.ts
git commit -m "fix(playback): keep external launch errors visible"
```

### Task 6: Translation, documentation, and release note

**Files:**
- Modify: `apps/web/src/assets/i18n/*.json`
- Modify: `docs/architecture/embedded-inline-playback.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `.changes/playback-external-launch-feedback.md`

- [ ] **Step 1: Add user-facing translation keys**

Add the same complete key set to every locale, translated where practical and
English fallback otherwise:

```json
"ACTION_OPENING_MPV": "Opening MPV…",
"ACTION_OPENING_VLC": "Opening VLC…",
"ACTION_REOPEN_MPV": "Open MPV again",
"ACTION_REOPEN_VLC": "Open VLC again",
"ACTION_RETRY_MPV": "Try MPV again",
"ACTION_RETRY_VLC": "Try VLC again",
"EXTERNAL_OPENING": "Opening player…",
"EXTERNAL_STARTED": "Player started",
"EXTERNAL_PLAYING": "Playing",
"EXTERNAL_FAILED": "Could not start player"
```

Add workspace dock keys for opening, started, playing, failed, and dismiss.

- [ ] **Step 2: Update canonical docs**

Replace the v1 “external target disappears after attempt” contract with the
new per-target state/reranking and exact external session correlation. Mirror
the shared-player summary byte-for-meaning between `AGENTS.md` and `CLAUDE.md`.

- [ ] **Step 3: Add release note**

```markdown
---
type: fix
area: playback
---

MPV and VLC recovery buttons now stay available after an attempt and show launch progress, player-started, playback, and failure feedback. External-player errors remain in the bottom status bar until dismissed.
```

- [ ] **Step 4: Validate and commit**

```bash
pnpm run i18n:validate
pnpm run release:notes:validate
git diff --check
git add apps/web/src/assets/i18n docs/architecture/embedded-inline-playback.md AGENTS.md CLAUDE.md .changes/playback-external-launch-feedback.md
git commit -m "docs(playback): document external launch feedback"
```

### Task 7: Electron regression flow

**Files:**
- Modify: `apps/electron-backend-e2e/src/dash-clearkey.e2e.ts`

- [ ] **Step 1: Change the existing E2E expectation before production code is considered complete**

The fixture IPC handler must send repository-owned `launching`, `opened`, and
failure session updates through `EXTERNAL_PLAYER_SESSION_UPDATE`, and implement
the close handler without starting real players.

Assert:

- MPV remains visible during and after the held handshake;
- its spinner/status is visible while launching;
- VLC cannot launch during the handshake;
- after MPV starts, MPV remains available and VLC is primary;
- the dock reads “Player started”;
- a failed VLC session remains in the dock with a Dismiss action;
- dismiss hides the dock while both diagnostic action buttons remain.

- [ ] **Step 2: Run the exact Electron target**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/dash-clearkey.e2e.ts --skip-nx-cache
```

Expected: PASS with the repository-owned fixture and stubbed IPC only.

- [ ] **Step 3: Commit**

```bash
git add apps/electron-backend-e2e/src/dash-clearkey.e2e.ts
git commit -m "test(playback): cover external launch feedback"
```

### Task 8: Full validation, review, and PR

**Files:**
- Review all changed files from `origin/master...HEAD`.

- [ ] **Step 1: Run affected unit, lint, build, and policy validation**

```bash
pnpm nx test ui-playback --skip-nx-cache
pnpm nx test components --skip-nx-cache
pnpm nx test web --skip-nx-cache
pnpm nx affected -t lint --base=origin/master --head=HEAD --skip-nx-cache
pnpm nx build web --configuration=production --skip-nx-cache
pnpm nx build electron-backend --configuration=production --skip-nx-cache
pnpm run i18n:validate
pnpm run release:notes:validate
pnpm run coverage:policy:check
git diff --check origin/master...HEAD
```

- [ ] **Step 2: Run the targeted Electron E2E again from the final tree**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/dash-clearkey.e2e.ts --skip-nx-cache
```

- [ ] **Step 3: Perform local Codex P1/P2 review**

Run the local Codex CLI against `origin/master`, inspect every finding, add a
failing regression test before each valid fix, and rerun the affected and full
validation commands. Do not create the PR while an actionable P1/P2 remains.

- [ ] **Step 4: Push and create a ready PR**

Use title:

```text
fix(playback): clarify external player launch feedback
```

The PR body must summarize persistent recovery actions, exact session status,
accessibility/privacy ownership, dock dismissal, docs/release note, and every
validation command. Do not merge.

- [ ] **Step 5: Run the review loop**

Wait for all latest-head CI, Greptile 5/5, and Codex review. Fix actionable
feedback with regression coverage, push, retrigger both reviewers, and repeat
until the ready PR is merge-ready.
