# Consistent Live Panel Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Groups and Channels independent persisted intent and consistent,
accessible disclosure controls across every Live TV surface while preventing
Guide no-ops.

**Architecture:** A root-provided `LiveLayoutPanelStateService` in
`@iptvnator/portal/shared/data-access` owns persisted Groups/Channels intent and
non-persisted master suppression. Route components supply local applicability
and responsive suppression when resolving effective visibility; UI components
own DOM focus transfer and boundary restore controls. The existing Guide state
remains separate, while shared EPG views gain an explicit `collapsible`
capability.

**Tech Stack:** Angular 21 signals and standalone components, Angular CDK
breakpoints, Angular Material icon buttons, Jest, Nx, Playwright Electron E2E,
SCSS, ngx-translate.

---

## File Map

- `libs/portal/shared/data-access/src/lib/live-layout-panel-state.service.ts`
  owns migration, persisted left-panel intent, master suppression, and
  effective-state resolution.
- `libs/portal/shared/data-access/src/lib/live-layout-panel-state.service.spec.ts`
  proves migration and state semantics.
- `libs/portal/shared/util/src/lib/live-layout-sidebar-state.service.ts` is
  removed; `live-sidebar-state.ts` stays as a read-only legacy parser.
- `libs/ui/epg/src/lib/epg-{timeline,list-view}/` owns the Guide disclosure
  capability, ARIA relationship, and 40px target.
- `libs/ui/components/src/lib/channel-list-container/` owns M3U Groups/Channels
  header controls, retained hidden DOM, loading-state controls, restore rails,
  and intra-component focus.
- `libs/workspace/shell/feature/src/lib/workspace-context-panel/` owns the
  expanded Groups header control.
- `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-context-sidebar/`
  owns Groups effective visibility, responsive suppression, restore rail,
  retained DOM, and focus transfer.
- `libs/portal/{xtream,stalker}/feature/src/lib/*live-stream-layout/` owns each
  provider's Channels effective visibility, boundary restore rail, shortcut,
  focus, and Guide capability wiring.
- `libs/playlist/m3u/feature-player/src/lib/video-player/` owns M3U panel
  applicability, mobile suppression, shortcut, focus, and shared state wiring.
- `libs/portal/shared/ui/src/lib/components/unified-collection/` owns the sole
  Favorites/Recent Channels header control and shortcut.
- `apps/web/src/assets/i18n/*.json` owns translated Groups/Channels disclosure
  names and tooltips.
- `apps/electron-backend-e2e/src/live-panel-toggles.e2e.ts` owns cross-provider
  regression coverage.
- `docs/architecture/iptvnator-ui-guidelines.md` becomes the canonical panel
  ownership/responsive contract.
- `.changes/ui-live-panel-toggles.md` records the user-visible change.

### Task 1: Introduce independent panel intent and legacy migration

**Files:**

- Create:
  `libs/portal/shared/data-access/src/lib/live-layout-panel-state.service.ts`
- Create:
  `libs/portal/shared/data-access/src/lib/live-layout-panel-state.service.spec.ts`
- Modify: `libs/portal/shared/data-access/src/index.ts`
- Modify: `libs/portal/shared/util/src/index.ts`
- Delete:
  `libs/portal/shared/util/src/lib/live-layout-sidebar-state.service.ts`

- [x] **Step 1: Write failing migration and service tests**

Cover missing/invalid storage, valid legacy seeding, partial new-key migration,
new-key precedence, idempotence, independent persistence, local action clearing
master suppression, and effective-state resolution:

```ts
expect(service.groupsIntent()).toBe('expanded');
expect(service.channelsIntent()).toBe('collapsed');
expect(localStorage.getItem(LIVE_GROUPS_PANEL_STATE_STORAGE_KEY)).toBe(
    'expanded'
);
expect(service.isPanelExpanded('groups', { applicable: true })).toBe(true);
expect(
    service.isPanelExpanded('groups', {
        applicable: true,
        responsiveSuppressed: true,
    })
).toBe(false);
service.toggleMasterSuppression(['groups', 'channels']);
expect(service.masterSuppressed()).toBe(true);
service.showPanel('channels');
expect(service.masterSuppressed()).toBe(false);
expect(service.channelsIntent()).toBe('expanded');
```

- [x] **Step 2: Run the target and verify RED**

Run:

```bash
pnpm nx test portal-shared-data-access --runInBand
```

Expected: FAIL because `LiveLayoutPanelStateService` and its storage constants
do not exist.

- [x] **Step 3: Implement the minimal signal service**

Use a const-backed panel kind, readonly public signals, and explicit commands:

```ts
export const LIVE_LAYOUT_PANEL = {
    GROUPS: 'groups',
    CHANNELS: 'channels',
} as const;

export type LiveLayoutPanel =
    (typeof LIVE_LAYOUT_PANEL)[keyof typeof LIVE_LAYOUT_PANEL];

export interface LivePanelEffectiveContext {
    readonly applicable: boolean;
    readonly responsiveSuppressed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class LiveLayoutPanelStateService {
    readonly groupsIntent = this._groupsIntent.asReadonly();
    readonly channelsIntent = this._channelsIntent.asReadonly();
    readonly masterSuppressed = this._masterSuppressed.asReadonly();

    isPanelExpanded(
        panel: LiveLayoutPanel,
        context: LivePanelEffectiveContext
    ): boolean {
        return (
            context.applicable &&
            !context.responsiveSuppressed &&
            !this._masterSuppressed() &&
            this.intentFor(panel)() === 'expanded'
        );
    }

    hidePanel(panel: LiveLayoutPanel): void;
    showPanel(panel: LiveLayoutPanel): void;
    toggleMasterSuppression(applicablePanels: readonly LiveLayoutPanel[]): void;
}
```

Migration reads valid new keys first, falls back per missing key to valid
`live-sidebar-state`, defaults to expanded, writes both new keys, and never
writes the legacy key.

- [x] **Step 4: Replace exports and stage legacy service removal**

Export the new service from `@iptvnator/portal/shared/data-access`. Remove only
the injectable legacy service export/file; retain
`restoreLiveSidebarState()` for migration compatibility.

- [x] **Step 5: Run the target and verify GREEN**

Run:

```bash
pnpm nx test portal-shared-data-access --runInBand
pnpm nx lint portal-shared-data-access
pnpm nx lint portal-shared-util
```

Expected: all commands exit 0.

- [x] **Step 6: Commit**

```bash
git add libs/portal/shared/data-access libs/portal/shared/util
git commit -m "feat(ui): add independent live panel state"
```

### Task 2: Make Guide disclosure capability explicit

**Files:**

- Modify:
  `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.{ts,html,scss,spec.ts}`
- Modify:
  `libs/ui/epg/src/lib/epg-list-view/epg-list-view.component.{ts,html,scss,spec.ts}`

- [x] **Step 1: Write failing component tests**

For both timeline and list, assert that `collapsible=false` renders a static
heading with no disclosure button, while `collapsible=true` exposes a 40px
button with `aria-controls`, `aria-expanded`, and action-oriented translated
label:

```ts
fixture.componentRef.setInput('collapsible', false);
fixture.componentRef.setInput('panelId', 'live-guide-panel');
await fixture.whenStable();
expect(
    fixture.nativeElement.querySelector('[data-testid="live-guide-toggle"]')
).toBeNull();

fixture.componentRef.setInput('collapsible', true);
await fixture.whenStable();
const toggle = fixture.nativeElement.querySelector(
    '[data-testid="live-guide-toggle"]'
);
expect(toggle.getAttribute('aria-controls')).toBe('live-guide-panel');
expect(toggle.getAttribute('aria-expanded')).toBe('true');
```

- [x] **Step 2: Run both targets and verify RED**

```bash
pnpm nx test ui-epg --runInBand
```

Expected: FAIL because the new inputs and static-heading branch do not exist.

- [x] **Step 3: Implement capability, ARIA, and target sizing**

Add:

```ts
readonly collapsible = input(true);
readonly panelId = input<string | null>(null);
```

Render the button only when collapsible, otherwise render the same heading
content in a non-interactive container. Bind `aria-controls` to `panelId`, bind
the schedule region `id`, add `data-testid="live-guide-toggle"`, and set
`min-height: 40px`.

- [x] **Step 4: Run and verify GREEN**

```bash
pnpm nx test ui-epg --runInBand
pnpm nx lint ui-epg
```

Expected: both commands exit 0.

- [x] **Step 5: Commit**

```bash
git add libs/ui/epg
git commit -m "fix(ui): expose guide collapse capability"
```

### Task 3: Define shared M3U panel-control contracts

**Files:**

- Modify:
  `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.{ts,html,scss,spec.ts}`
- Modify:
  `libs/ui/components/src/lib/channel-list-container/groups-view/groups-view.component.{ts,html,scss,spec.ts}`
- Modify:
  `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.{ts,html,spec.ts}`
- Modify:
  `libs/ui/components/src/lib/channel-list-loading-state/channel-list-loading-state.component.{ts,html,scss,spec.ts}`

- [x] **Step 1: Write failing tests for panel-specific outputs**

Assert that All Channels emits `channelsPanelExpandedChange(false)` from its
header. Assert that Groups has separate Groups and Channels buttons/restore
buttons, stable panel IDs/test IDs, no duplicates, retained `inert` hidden DOM,
and bidirectional focus:

```ts
expect(groupsHide.getAttribute('aria-controls')).toBe('live-groups-panel');
expect(channelsHide.getAttribute('aria-controls')).toBe('live-channels-panel');
groupsHide.click();
expect(groupsPanelExpandedChange).toHaveBeenCalledWith(false);
fixture.componentRef.setInput('groupsPanelExpanded', false);
await fixture.whenStable();
expect(groupsPanel.hasAttribute('inert')).toBe(true);
expect(document.activeElement).toBe(groupsRestore);
```

The loading-state spec must prove both controls remain in the Groups skeleton
and Channels remains in the All Channels skeleton.

- [x] **Step 2: Run Components tests and verify RED**

```bash
pnpm nx test components --runInBand
```

Expected: FAIL because panel-specific inputs/outputs and controls do not exist.

- [x] **Step 3: Implement the All Channels and loading contracts**

Replace ambiguous `sidebarToggleRequested` with:

```ts
readonly channelsPanelExpandedChange = output<boolean>();
readonly channelsPanelExpanded = input(true);
```

Use `live-channels-panel-hide` and `live-channels-panel-restore` test IDs,
`aria-controls="live-channels-panel"`, `aria-expanded`, translated names, and
40px targets. Loading-state controls emit the same explicit requested value.

- [x] **Step 4: Implement independent Groups layout**

Give `GroupsViewComponent`:

```ts
readonly groupsPanelExpanded = input(true);
readonly channelsPanelExpanded = input(true);
readonly groupsPanelExpandedChange = output<boolean>();
readonly channelsPanelExpandedChange = output<boolean>();
```

Keep both panels mounted. Apply `inert` and `aria-hidden` to collapsed panels,
render compact boundary restore rails in Groups-then-Channels order, reclaim
the hidden width, and focus the counterpart control after a zero-delay render
turn. The Groups toggle is the final action after search/sort/manage; the
Channels toggle remains the final action after channel sort.

- [x] **Step 5: Thread the contract through `ChannelListContainerComponent`**

Add matching inputs and outputs and pass them through the All/Groups/loading
branches. Do not render panel actions for legacy M3U `favorites`/`recent`
branches.

- [x] **Step 6: Run and verify GREEN**

```bash
pnpm nx test components --runInBand
pnpm nx lint components
```

Expected: both commands exit 0.

- [x] **Step 7: Commit**

```bash
git add libs/ui/components
git commit -m "feat(ui): add independent M3U panel controls"
```

### Task 4: Give the workspace Groups panel explicit ownership

**Files:**

- Modify:
  `libs/workspace/shell/feature/src/lib/workspace-context-panel/workspace-context-panel.component.{ts,html,scss,spec.ts}`
- Modify:
  `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-context-sidebar/workspace-shell-context-sidebar.component.{ts,html,scss,spec.ts}`

- [x] **Step 1: Write failing header and layout tests**

Assert the Groups header control is last, stays present in loading/empty/zero
search results, and emits an explicit collapse request only on Live/ITV/Radio.
Assert the context sidebar suppresses Groups at `max-width: 1023px` without
changing intent, retains collapsed DOM as inert, renders one boundary restore
button at wide widths, and transfers focus.

- [x] **Step 2: Run and verify RED**

```bash
pnpm nx test workspace-shell-feature --runInBand
```

Expected: FAIL because the Groups disclosure contract does not exist.

- [x] **Step 3: Add the Groups header output**

Add:

```ts
readonly groupsPanelExpandedChange = output<boolean>();
readonly showLiveGroupsToggle = computed(
    () => this.isXtreamCategories() && this.section() === 'live'
        || this.isStalkerCategories()
            && (this.section() === 'itv' || this.section() === 'radio')
);
```

Render the translated 40px button last in `.context-header__actions`, with
panel-based test ID and ARIA attributes.

- [x] **Step 4: Add state, responsive suppression, restore rail, and focus**

Inject `LiveLayoutPanelStateService` from data-access and `BreakpointObserver`.
Resolve effective Groups visibility from intent, master suppression,
applicability, and `(max-width: 1023px)`. Keep the `aside` mounted with
`inert`/`aria-hidden`, reserve a 40px restore column only when restoration is
currently fulfillable, and focus `live-groups-panel-hide` after restoration.

- [x] **Step 5: Run and verify GREEN**

```bash
pnpm nx test workspace-shell-feature --runInBand
pnpm nx lint workspace-shell-feature
```

Expected: both commands exit 0.

- [x] **Step 6: Commit**

```bash
git add libs/workspace/shell/feature
git commit -m "feat(ui): add workspace groups disclosure"
```

### Task 5: Integrate independent Channels state in Xtream and Stalker

**Files:**

- Modify:
  `libs/portal/xtream/feature/src/lib/live-stream-layout/live-stream-layout.component.{ts,html,scss,spec.ts}`
- Modify:
  `libs/portal/stalker/feature/src/lib/stalker-live-stream-layout/stalker-live-stream-layout.component.{ts,html,scss,spec.ts}`
- Modify: `libs/ui/styles/_portal-layout.scss`

- [ ] **Step 1: Write failing provider component tests**

For each provider prove:

- Channels collapse does not change Groups intent.
- Groups collapse does not hide Channels.
- the expanded and restore controls have correct names, test IDs, ARIA, and
  40px target;
- the collapsed Channels DOM is inert/aria-hidden and focus moves both ways;
- `Cmd/Ctrl+B` suppresses applicable Groups+Channels without persisting intent;
- root All Items applies the shortcut only to Groups;
- external MPV/VLC passes `collapsible=false` to Guide.

- [ ] **Step 2: Run both targets and verify RED**

```bash
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
```

Expected: FAIL because the components still consume the shared sidebar state.

- [ ] **Step 3: Replace Xtream state and markup**

Inject `LiveLayoutPanelStateService`, compute Channels effective visibility for
`showLiveChannelSidebar()`, use `hidePanel('channels')` /
`showPanel('channels')`, and call:

```ts
this.livePanelState.toggleMasterSuppression(
    this.showLiveChannelSidebar() ? ['groups', 'channels'] : ['groups']
);
```

Keep the resizable Channels DOM mounted and inert when collapsed. Move restore
UI into a non-overlay boundary rail before `.content-container`. Pass
`[collapsible]="isEmbeddedPlayer"` and `panelId="live-guide-panel"`.

- [ ] **Step 4: Apply the same contract to Stalker**

Use the same panel IDs, test IDs, focus behavior, and master shortcut. Radio
must render no Guide disclosure because it renders no Guide region.

- [ ] **Step 5: Normalize shared boundary rail SCSS**

Replace the floating restore overlay in `_portal-layout.scss` with a 40px
flex-shrink-zero boundary rail. Keep width transitions at 180ms, never modify
the external-player content sizing, and do not touch channel-row styles.

- [ ] **Step 6: Run and verify GREEN**

```bash
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
pnpm nx lint portal-xtream-feature
pnpm nx lint portal-stalker-feature
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add libs/portal/xtream/feature libs/portal/stalker/feature libs/ui/styles
git commit -m "feat(ui): separate portal live panel toggles"
```

### Task 6: Integrate shared state and mobile restoration in M3U

**Files:**

- Modify:
  `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.{ts,html,scss,spec.ts}`

- [ ] **Step 1: Write failing M3U feature tests**

Prove All Channels uses the shared Channels intent, Groups passes two
independent effective inputs, mobile responsive suppression does not persist
Groups intent, both collapsed controls order Groups before Channels, loading
retains structural controls, `Cmd/Ctrl+B` preserves intents, and mobile keeps a
Channels restore button.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm nx test playlist-m3u-feature-player --runInBand
```

Expected: FAIL because M3U still owns a local legacy-key signal.

- [ ] **Step 3: Replace local state with the shared service**

Remove `restoreLiveSidebarState`/`persistLiveSidebarState` usage. Inject
`LiveLayoutPanelStateService`, observe `(max-width: 599px)`, and compute
applicability:

```ts
readonly groupsApplicable = computed(() => this.activeView() === 'groups');
readonly channelsApplicable = computed(
    () => this.activeView() === 'groups' || this.activeView() === 'all'
);
```

Use responsive suppression only for Groups. Pass explicit panel inputs/outputs
through `app-sidebar` and the loading state.

- [ ] **Step 4: Preserve focus and mobile restore geometry**

For All Channels, hide the resizable panel with inert/aria-hidden and place the
restore rail between sidebar and content. For Groups, let the shared
GroupsView own its two internal rails. On mobile, keep the Channels restore
rail visible and let content reclaim height when Channels is collapsed.

- [ ] **Step 5: Wire Guide capability**

Pass `collapsible=shouldShowInlinePlayer(activeChannel)` and
`panelId="live-guide-panel"` to both EPG modes. Radio continues to omit the
Guide region.

- [ ] **Step 6: Run and verify GREEN**

```bash
pnpm nx test playlist-m3u-feature-player --runInBand
pnpm nx lint playlist-m3u-feature-player
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add libs/playlist/m3u/feature-player
git commit -m "feat(ui): separate M3U live panel toggles"
```

### Task 7: Preserve the single collection-header Channels control

**Files:**

- Modify:
  `libs/portal/shared/ui/src/lib/components/unified-collection/unified-collection-page.component.{ts,html,scss,spec.ts}`
- Modify:
  `libs/portal/shared/ui/src/lib/components/unified-collection/unified-live-tab.component.{ts,html,scss,spec.ts}`

- [ ] **Step 1: Write failing Favorites/Recent tests**

Assert exactly one panel-based Channels control in the collection header for
both modes, including zero search results; no control inside the list; loading
Live state retains the header control; collapsed list DOM is inert/aria-hidden;
`Cmd/Ctrl+B` only suppresses Channels; external/radio Guide disclosure is
absent.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm nx test portal-shared-ui --runInBand
```

Expected: FAIL because collection UI still uses the legacy service and
`aria-pressed`.

- [ ] **Step 3: Implement the collection exception**

Inject `LiveLayoutPanelStateService`, keep the one header button, bind
`aria-controls="live-channels-panel"` and effective `aria-expanded`, remove
`aria-pressed`, and use explicit show/hide commands. Render the same real
control in the loading header when the selected type is Live. Add the
non-typing `Cmd/Ctrl+B` host listener.

- [ ] **Step 4: Retain and gate the Live list DOM**

Bind `id="live-channels-panel"`, `inert`, and `aria-hidden` on the live-tab
sidebar. Pass Guide `collapsible=shouldUseInlinePlayer()` and omit it for radio
as today.

- [ ] **Step 5: Run and verify GREEN**

```bash
pnpm nx test portal-shared-ui --runInBand
pnpm nx lint portal-shared-ui
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add libs/portal/shared/ui
git commit -m "feat(ui): align collection live panel control"
```

### Task 8: Translate panel actions

**Files:**

- Modify: `apps/web/src/assets/i18n/*.json`

- [ ] **Step 1: Add the English source keys**

Replace the ambiguous tooltip contract with:

```json
"LAYOUT": {
    "HIDE_GROUPS": "Hide groups",
    "SHOW_GROUPS": "Show groups",
    "HIDE_CHANNELS": "Hide channels",
    "SHOW_CHANNELS": "Show channels",
    "GROUPS_TOGGLE_TOOLTIP": "Hide or show groups",
    "CHANNELS_TOGGLE_TOOLTIP": "Hide or show channels (⌘/Ctrl+B)"
}
```

- [ ] **Step 2: Add equivalent short translations to every locale**

Preserve all existing locale terminology and key order. Remove old layout keys
only after no source file references them.

- [ ] **Step 3: Verify key parity and usage**

```bash
pnpm run i18n:check
rg -n "HIDE_CHANNELS_LIST|SHOW_CHANNELS_LIST|TOGGLE_SIDEBAR_TOOLTIP" apps libs
```

Expected: i18n check exits 0 and `rg` finds no runtime references.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/assets/i18n
git commit -m "feat(i18n): translate live panel controls"
```

### Task 9: Add atomized Electron regression coverage

**Files:**

- Create: `apps/electron-backend-e2e/src/live-panel-toggles.e2e.ts`
- Reuse: `apps/electron-backend-e2e/src/electron-test-fixtures.ts`
- Reuse: `apps/electron-backend-e2e/src/portal-mock-fixtures.ts`

- [ ] **Step 1: Write the M3U Electron flow**

Import the mock M3U fixture, enter Groups, independently hide/restore Groups and
Channels, verify focus/ARIA/inert/width reclamation, exercise `Control+B`, seed
legacy storage before reload, and check the mobile Channels restore path at a
narrow viewport.

- [ ] **Step 2: Run the M3U test and verify RED if a gap remains**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/live-panel-toggles.e2e.ts \
    --grep "@live-panels @m3u"
```

Expected after implementation: PASS. Any failure must identify a functional or
layout gap before adding provider flows.

- [ ] **Step 3: Add Xtream and Stalker flows**

Use the existing mock-server add helpers. Verify root Groups-only placement,
category Groups+Channels independence, persistence across navigation,
Groups-then-Channels restore ordering, zero-search-result controls, and no
Guide toggle for external player/radio.

- [ ] **Step 4: Run the full atomized target**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/live-panel-toggles.e2e.ts
```

Expected: all `@live-panels` tests pass.

- [ ] **Step 5: Lint and commit**

```bash
pnpm nx lint electron-backend-e2e
git add apps/electron-backend-e2e/src/live-panel-toggles.e2e.ts
git commit -m "test(e2e): cover live panel toggles"
```

### Task 10: Update canonical docs and release note

**Files:**

- Modify: `docs/architecture/iptvnator-ui-guidelines.md`
- Modify: `CLAUDE.md`
- Create: `.changes/ui-live-panel-toggles.md`

- [ ] **Step 1: Replace the obsolete shared-sidebar documentation**

Document independent Groups/Channels storage keys, data-access ownership,
intent versus effective state, boundary controls, master suppression,
responsive Groups-first suppression, collection-header exception, and Guide
capability. Preserve the channel-row responsive contract from #1312 verbatim.

- [ ] **Step 2: Update `CLAUDE.md` where it describes live sidebar state**

Mirror the canonical names, service location, and shortcut semantics without
adding the future content-aware right-region behavior.

- [ ] **Step 3: Add the user-facing release note**

```md
---
type: fix
area: ui
issues: [1118]
---

Live TV now remembers Groups and Channels visibility independently, keeps
reliable restore controls across providers and screen sizes, and hides Guide
toggles when they cannot work.
```

- [ ] **Step 4: Validate documentation and release note**

```bash
git diff --check
pnpm run release:notes:validate
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/iptvnator-ui-guidelines.md CLAUDE.md \
    .changes/ui-live-panel-toggles.md
git commit -m "docs(ui): document live panel ownership"
```

### Task 11: Full verification and strict review

**Files:**

- Review every file changed relative to `origin/master`.

- [ ] **Step 1: Run affected unit targets**

```bash
pnpm nx run-many \
    -t test \
    -p portal-shared-data-access,ui-epg,components,workspace-shell-feature,portal-xtream-feature,portal-stalker-feature,playlist-m3u-feature-player,portal-shared-ui \
    --parallel=3
```

Expected: all affected unit targets pass.

- [ ] **Step 2: Run affected lint**

```bash
pnpm nx run-many \
    -t lint \
    -p portal-shared-data-access,portal-shared-util,ui-epg,components,workspace-shell-feature,portal-xtream-feature,portal-stalker-feature,playlist-m3u-feature-player,portal-shared-ui,electron-backend-e2e \
    --parallel=3
```

Expected: all affected lint targets pass.

- [ ] **Step 3: Run build and atomized E2E**

```bash
pnpm nx build web
pnpm nx run electron-backend-e2e:e2e-ci--src/live-panel-toggles.e2e.ts
```

Expected: build and all panel E2E tests pass.

- [ ] **Step 4: Run repository policy checks**

```bash
pnpm run i18n:check
pnpm run release:notes:validate
pnpm run skills:validate
git diff --check origin/master...HEAD
```

Expected: all checks exit 0.

- [ ] **Step 5: Perform running Electron visual/accessibility verification**

Start `pnpm run serve:backend`, connect through the required Computer Use or
Electron CDP workflow, and inspect M3U, Xtream, Stalker, Favorites, Recent,
desktop, narrow, dark, and light states. Record exact target sizes, focus
movement, absence of duplicate/no-op controls, reclaimed widths, and restore
ordering.

- [ ] **Step 6: Review the complete diff against the design**

```bash
git status --short
git diff --stat origin/master...HEAD
git diff --check origin/master...HEAD
git log --oneline origin/master..HEAD
```

Re-read every requirement in the design and verify a code path plus test
covers it. Confirm no channel-row responsive selector and no external-player
right-region sizing rule changed.

- [ ] **Step 7: Fix review findings with test-first cycles**

For every finding, add or tighten the closest failing test, run it RED, make the
smallest correction, rerun GREEN, and commit with an appropriate conventional
message.

- [ ] **Step 8: Push and create the PR without merging**

```bash
git push -u origin agent/live-panel-toggle-consistency-2
gh pr create \
    --title "fix(ui): make live panel toggles consistent" \
    --body-file /tmp/live-panel-toggle-pr.md
```

The PR body must summarize state ownership, UX/accessibility behavior, testing,
visual verification, and explicitly state that content-aware external-player
layout and #1312 channel-row behavior are unchanged. Use `Refs #1118`, not
`Closes #1118`, because a third PR remains.
