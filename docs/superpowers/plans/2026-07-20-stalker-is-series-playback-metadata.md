# Stalker `is_series` Playback Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct Stalker/Ministra VOD-backed series quick-start translations and persist episode coordinates so the workspace dashboard can show its season/episode badge.

**Architecture:** Keep the provider-neutral dashboard contract unchanged. Preserve the shared quick-start translation parameters in the Stalker button view model, then enrich resolved Stalker series playback at the feature boundary by resolving the selected episode against the existing normalized `mappedSeasons()` data.

**Tech Stack:** Angular standalone components and signals, ngx-translate, TypeScript, Jest, Nx, Markdown repository documentation.

---

### Task 1: Establish the implementation branch and workspace

**Files:**
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`

- [ ] **Step 1: Create the feature branch**

Run:

```bash
git switch -c agent/fix-stalker-is-series-metadata
```

Expected: Git reports a new branch named
`agent/fix-stalker-is-series-metadata`.

- [ ] **Step 2: Install the frozen workspace dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: installation completes without changing `pnpm-lock.yaml`.

- [ ] **Step 3: Verify Nx workspace discovery**

Run:

```bash
pnpm nx show projects
```

Expected: output includes `portal-stalker-feature`,
`workspace-dashboard-data-access`, and `web`.

### Task 2: Add failing Stalker quick-start and playback regressions

**Files:**
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`

- [ ] **Step 1: Make the test translate pipe expose missing parameters**

Change the `MockPipe(TranslatePipe, ...)` transform to render the problematic
translation with its parameter:

```ts
MockPipe(
    TranslatePipe,
    (
        value: string | null | undefined,
        params?: Record<string, number>
    ) => {
        if (value === 'XTREAM.PLAY_EPISODE') {
            return `Play episode ${params?.['episode'] ?? '{{episode}}'}`;
        }
        return value ?? '';
    }
),
```

- [ ] **Step 2: Add a quick-start interpolation regression**

Add a component test that uses a loaded `is_series` episode with a non-resume,
non-watched position:

```ts
it('interpolates the episode number for a recently started VOD is_series episode', async () => {
    selectedContentType.set('vod');
    selectedItem.set({
        id: '50001',
        is_series: true,
        info: {
            name: 'VOD Flagged Series',
            description: 'Lazy seasons',
            movie_image: 'vod-series.jpg',
        },
    });
    serialSeasonsResource.set([]);
    vodSeriesSeasonsResource.set([]);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.vodSeriesSeasons.set([
        {
            id: 'season-1',
            video_id: '50001',
            season_number: '1',
            name: 'Season 1',
            episodes: [
                {
                    id: 'episode-1',
                    series_number: 1,
                    name: 'Pilot',
                },
            ],
            isLoading: false,
            isExpanded: false,
        },
    ]);
    const episode = fixture.componentInstance.mappedSeasons()['1'][0];
    fixture.componentInstance.episodePlaybackPositions.set(
        new Map([
            [
                Number(episode.id),
                {
                    contentXtreamId: Number(episode.id),
                    contentType: 'episode',
                    seriesXtreamId: 50001,
                    positionSeconds: 5,
                    durationSeconds: 100,
                },
            ],
        ])
    );
    fixture.detectChanges();

    const button: HTMLButtonElement | null =
        fixture.nativeElement.querySelector(
            '[data-testid="series-quick-start"]'
        );

    expect(button?.textContent).toContain('Play episode 1');
    expect(button?.textContent).not.toContain('{{episode}}');
});
```

- [ ] **Step 3: Extend the existing external `is_series` quick-start test**

After clicking the quick-start button, assert that the external playback object
contains episode coordinates:

```ts
expect(openResolvedPlayback).toHaveBeenCalledWith(
    expect.objectContaining({
        contentInfo: expect.objectContaining({
            seasonNumber: 1,
            episodeNumber: 1,
        }),
    }),
    true
);
```

- [ ] **Step 4: Extend the existing inline `is_series` playback test**

After `onEpisodeClicked(firstEpisode)`, assert:

```ts
expect(inlinePlayer.playback()).toEqual(
    expect.objectContaining({
        contentInfo: expect.objectContaining({
            seasonNumber: 1,
            episodeNumber: 1,
        }),
    })
);
```

- [ ] **Step 5: Run the Stalker feature tests and verify RED**

Run:

```bash
pnpm nx test portal-stalker-feature
```

Expected: the new interpolation and playback-coordinate assertions fail for
the missing `labelParams`, `seasonNumber`, and `episodeNumber`.

### Task 3: Preserve translation parameters and enrich Stalker playback

**Files:**
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-quick-start.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.html`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Test: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`

- [ ] **Step 1: Preserve label parameters in the Stalker button model**

Add the optional field:

```ts
export interface StalkerQuickStartButton {
    labelKey: string;
    labelParams?: Record<string, number>;
    episodeLabel: string | null;
    icon: string;
    disabled: boolean;
    action: SeriesQuickStartAction | null;
    lazySeason: VodSeriesSeasonVm | null;
}
```

Copy it from a loaded action:

```ts
return {
    labelKey: action.labelKey,
    labelParams: action.labelParams,
    episodeLabel: action.episodeLabel,
    icon: action.icon,
    disabled: action.disabled,
    action,
    lazySeason: null,
};
```

- [ ] **Step 2: Pass parameters to the Stalker translate pipe**

Replace the quick-start label expression with:

```html
{{
    action.labelKey
        | translate: action.labelParams
}}
```

- [ ] **Step 3: Resolve episode coordinates before playback handoff**

In `startPlayback(...)`, derive normalized episode state from the existing
mapped seasons and enrich only episode playback:

```ts
const episodeState =
    episodeId === undefined
        ? null
        : resolveSeriesPlaybackEpisodeState({
              episodesBySeason: this.mappedSeasons(),
              currentEpisodeId: episodeId,
              fallbackEpisodeNumber: episodeNum,
          });
const resolvedPlayback =
    episodeState && playback.contentInfo?.contentType === 'episode'
        ? {
              ...playback,
              contentInfo: {
                  ...playback.contentInfo,
                  seasonNumber: episodeState.seasonNumber,
                  episodeNumber: episodeState.episodeNumber,
              },
          }
        : playback;
```

Use `resolvedPlayback` for both branches:

```ts
if (this.portalPlayer.isEmbeddedPlayer()) {
    this.inlinePlayback.set(resolvedPlayback);
    return;
}

this.closeInlinePlayer();
void this.portalPlayer.openResolvedPlayback(resolvedPlayback, true);
```

- [ ] **Step 4: Run the Stalker feature tests and verify GREEN**

Run:

```bash
pnpm nx test portal-stalker-feature
```

Expected: all Stalker feature tests pass.

- [ ] **Step 5: Commit the focused Stalker fix**

Run:

```bash
git add libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-quick-start.ts libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.html libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts
git commit -m "fix(stalker): preserve series episode metadata"
```

Expected: one commit containing the Stalker tests and minimal production fix.

### Task 4: Lock the dashboard’s existing `is_series` contract

**Files:**
- Modify: `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.spec.ts`

- [ ] **Step 1: Add Stalker dashboard contract coverage**

Add a test that supplies a Stalker playlist-backed recent item and its saved
episode position:

```ts
it('resolves episode metadata for a Stalker VOD is_series recent item', async () => {
    playlistsSignal.set([
        ...createDefaultPlaylists(),
        {
            _id: 'stalker-series',
            title: 'Ministra Portal',
            count: 1,
            importDate: '2026-01-01T00:00:00.000Z',
            autoRefresh: false,
            macAddress: '00:11:22:33:44:55',
            recentlyViewed: [
                {
                    id: '50001',
                    title: 'VOD Flagged Series',
                    category_id: 'vod',
                    is_series: '1',
                    added_at: '2026-07-20T12:00:00.000Z',
                },
            ],
        },
    ]);
    playbackPositionsMock.getAllPlaybackPositions.mockImplementation(
        async (playlistId: string) =>
            playlistId === 'stalker-series'
                ? [
                      {
                          playlistId,
                          contentXtreamId: 5000101,
                          contentType: 'episode',
                          seriesXtreamId: 50001,
                          seasonNumber: 1,
                          episodeNumber: 1,
                          positionSeconds: 120,
                          durationSeconds: 1800,
                      },
                  ]
                : []
    );

    await service.reloadPlaybackPositions();

    const item = service
        .globalRecentItems()
        .find((recent) => recent.playlist_id === 'stalker-series');
    expect(item?.type).toBe('series');
    expect(service.getPlaybackPositionForItem(item!)).toEqual(
        expect.objectContaining({
            seasonNumber: 1,
            episodeNumber: 1,
        })
    );
});
```

- [ ] **Step 2: Run the dashboard data-access tests**

Run:

```bash
pnpm nx test workspace-dashboard-data-access
```

Expected: all tests pass, proving that the dashboard already consumes the
metadata without a provider-specific branch.

- [ ] **Step 3: Commit the dashboard contract test**

Run:

```bash
git add libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.spec.ts
git commit -m "test(dashboard): cover Stalker is_series positions"
```

Expected: one test-only commit.

### Task 5: Document the cross-surface `is_series` contract

**Files:**
- Modify: `docs/architecture/stalker-portal.md`
- Modify: `docs/architecture/workspace-dashboard.md`
- Modify: `.codex/skills/stalker-portal/SKILL.md`

- [ ] **Step 1: Update Stalker architecture documentation**

Add these rules to the `VOD/Series Modes` and regression sections:

```markdown
- All three series modes must preserve shared quick-start translation
  parameters.
- Episode playback must carry `seriesXtreamId`, `seasonNumber`, and
  `episodeNumber` through both inline and external player handoffs.
- Playlist-backed activity keeps `is_series` so dashboard normalization
  classifies the VOD-origin record as `series`.
- Existing playback rows without episode coordinates remain badge-less until
  the next episode playback; the dashboard must not query the portal to infer
  them.
```

- [ ] **Step 2: Update workspace dashboard documentation**

Generalize the playback-position contract from Xtream-only wording and record:

```markdown
Stalker VOD-backed `is_series` activity is normalized as series activity.
New Stalker episode positions include season/episode coordinates, so the hero
and Continue Watching cards use the same badge path as Xtream. Legacy rows
without those fields remain valid but do not show a badge.
```

- [ ] **Step 3: Add an agent-facing `is_series` checklist**

In `.codex/skills/stalker-portal/SKILL.md`, require every Stalker series change
to verify:

```markdown
1. Detail mode selection for regular, embedded `series[]`, and `is_series`.
2. Parameterized quick-start labels.
3. Recent/favorite normalization retaining VOD origin and series identity.
4. Playback `seriesXtreamId` plus season/episode coordinates.
5. Dashboard hero and Continue Watching consumption.
```

- [ ] **Step 4: Verify Markdown changes**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Commit the documentation**

Run:

```bash
git add docs/architecture/stalker-portal.md docs/architecture/workspace-dashboard.md .codex/skills/stalker-portal/SKILL.md
git commit -m "docs(stalker): record is_series cross-surface contract"
```

Expected: one documentation commit.

### Task 6: Validate the complete change

**Files:**
- Verify: `libs/portal/stalker/feature/project.json`
- Verify: `libs/workspace/dashboard/data-access/project.json`
- Verify: `apps/web/project.json`

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
pnpm nx test portal-stalker-feature
pnpm nx test workspace-dashboard-data-access
```

Expected: both targets pass.

- [ ] **Step 2: Run affected lint targets**

Run:

```bash
pnpm nx lint portal-stalker-feature
pnpm nx lint workspace-dashboard-data-access
```

Expected: both targets pass.

- [ ] **Step 3: Compile the Angular application**

Run:

```bash
pnpm nx build web
```

Expected: the web build completes successfully, proving the updated template
and TypeScript compile together.

- [ ] **Step 4: Perform the test-impact audit**

Confirm that no Stalker/Ministra fixture-backed E2E target covers lazy
`is_series` playback. Record that targeted unit coverage plus the Angular build
is the strongest automated validation if no such target exists.

- [ ] **Step 5: Inspect the final diff and history**

Run:

```bash
git diff master...HEAD --check
git status --short
git log --oneline master..HEAD
```

Expected: no diff errors, a clean worktree, and intentional commits only.

### Task 7: Independent review, PR creation, and review loop

**Files:**
- Review: all files in `git diff master...HEAD`

- [ ] **Step 1: Dispatch an independent subagent review**

Ask a separate subagent to inspect the complete diff for correctness,
regressions, type safety, test sufficiency, and adherence to the approved
design. Require file/line evidence for every actionable finding.

- [ ] **Step 2: Address validated subagent findings**

For each finding, reproduce or confirm it, add or adjust tests first when
behavior changes, implement the smallest correction, and rerun the affected
validation targets. Commit any corrections separately.

- [ ] **Step 3: Create the pull request**

Push `agent/fix-stalker-is-series-metadata` and create a ready PR with:

```text
Summary:
- interpolate Stalker series quick-start episode labels
- persist season/episode coordinates for all Stalker series modes
- document and test the Ministra is_series dashboard contract

Validation:
- pnpm nx test portal-stalker-feature
- pnpm nx test workspace-dashboard-data-access
- pnpm nx lint portal-stalker-feature
- pnpm nx lint workspace-dashboard-data-access
- pnpm nx build web
```

- [ ] **Step 4: Inspect GitHub reviews, comments, and checks**

Wait for initial PR checks and review-bot feedback. Read every unresolved review
thread and failed check, classify each item as actionable or non-actionable
with evidence, and address all actionable findings.

- [ ] **Step 5: Repeat until clean**

After each correction, rerun affected validation, push the new commit, and
re-check PR reviews/comments/checks. Stop only when checks are green and no
actionable unresolved feedback remains.
