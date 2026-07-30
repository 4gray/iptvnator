# Download Manager Detail Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make completed download cards honor the global cover-size preference, open existing detail pages from navigable card content, and prefer local playback on downloaded movie details.

**Architecture:** Keep `DownloadLibraryComponent` presentational by emitting one generic detail intent and one explicit local-file action. Reuse the existing navigation and download action services in `DownloadsComponent`. In Xtream and shared Stalker VOD details, preserve external-player Stop/Opening precedence, then choose the completed local file before the unchanged provider playback path; provider playback remains a neutral secondary action. No metadata, schema, IPC, or offline-routing layer is added.

**Tech Stack:** Angular 21.2 standalone components, signal inputs/outputs and computed state, Angular Material, ngx-translate, Jest 30, Nx 22.7, SCSS shared content-grid tokens, Electron Playwright E2E.

---

## File map

- `libs/portal/downloads/feature/src/lib/download-library.component.{ts,html,scss,spec.ts}` — card intent, accessibility, and global grid tokens.
- `libs/portal/downloads/feature/src/lib/downloads.component.{html,scss,spec.ts}` — smart-container wiring and skeleton grid tokens.
- `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.{ts,html}` — Xtream offline-primary/provider-secondary behavior.
- `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts` — rendered Xtream download actions.
- `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route-playback.spec.ts` and `vod-details-route.harness.ts` — external-session and provider-playback regression coverage.
- `libs/ui/playback/src/lib/vod-details/vod-details.component.{ts,html,spec.ts}` — shared Stalker VOD action behavior and tests.
- `apps/electron-backend-e2e/src/downloads.e2e.ts` — exact movie detail navigation and Small/Medium/Large geometry.
- `docs/architecture/download-manager.md` — canonical interaction, sizing, and no-cache boundary.
- `.changes/downloads-manager-mvp.md` — user-facing corrected behavior.

## Task 1: Fix completed-card intent and sizing with TDD

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.scss`

- [ ] **Step 1: Write the failing interaction tests**

Add a generic detail output and pin the movie/local split:

```ts
it('opens movie details from artwork and title without playing locally', async () => {
    const card = byTestId('download-library-movie-9');
    const opened: DownloadItem[] = [];
    const actions: unknown[] = [];
    component.openRequested.subscribe((selected) => opened.push(selected));
    component.itemAction.subscribe((action) => actions.push(action));

    await click(button(card, 'Open details: Moonrise artwork'));
    await click(button(card, 'Open details: Moonrise'));

    expect(opened).toEqual([MOVIE, MOVIE]);
    expect(actions).toEqual([]);
});
```

Update the grouped-series test to subscribe to `openRequested`. Extend the
legacy episode test to click `.download-library__artwork-button` and
`.download-library__title-button`, assert two concrete `play` actions, and
assert no detail output. Keep the existing toolbar Play assertion so it proves
that explicit Play remains local.

- [ ] **Step 2: Write the failing style contract**

Read `download-library.component.scss` in the spec and assert the grid block
contains both global inputs and no fixed mobile columns:

```ts
expect(styles).toContain('var(--cover-grid-min-width, 148px)');
expect(styles).toContain('var(--cover-gap, 16px)');
expect(styles).not.toContain(
    'grid-template-columns: repeat(2, minmax(0, 1fr))'
);
```

- [ ] **Step 3: Run the focused spec and verify RED**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=download-library.component.spec.ts
```

Expected: FAIL because `openRequested` and movie detail controls do not exist,
and the SCSS still contains fixed `168px`, `clamp(...)`, and two-column values.

- [ ] **Step 4: Implement the generic detail intent**

Replace the series-only output with:

```ts
readonly openRequested = output<DownloadItem>();

protected canOpen(item: DownloadItem): boolean {
    return this.availablePlaylistIds().has(item.playlistId);
}

protected openDetails(item: DownloadItem): void {
    if (!this.isPending(item) && this.canOpen(item)) {
        this.openRequested.emit(item);
    }
}
```

Grouped-series artwork/title call
`openDetails(entity.representative)`. Movie artwork/title call
`openDetails(entity.item)` and use translated `Open details` accessible names.
The explicit movie toolbar Play continues to call
`emitAction('play', entity.item)`. Ungrouped episode artwork/title continue to
call `emitAction('play', entity.item)`.

- [ ] **Step 5: Consume the existing cover tokens**

Use the shared mixin without feature-owned sizing:

```scss
.download-library__grid {
    @include grid.content-grid(
        $min-width: min(100%, var(--cover-grid-min-width, 148px)),
        $gap: var(--cover-gap, 16px)
    );
}
```

Remove the `repeat(2, ...)` mobile override. Keep the existing card visuals and
overflow-safe `min(100%, ...)`.

- [ ] **Step 6: Run the focused spec and verify GREEN**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 7: Commit the card change**

```bash
git add libs/portal/downloads/feature/src/lib/download-library.component.*
git commit -m "fix(downloads): open completed movies in details"
```

## Task 2: Wire movie navigation and synchronize the skeleton

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.scss`

- [ ] **Step 1: Write the failing container regression**

Render one completed movie, click its artwork, and prove navigation is distinct
from the toolbar Play:

```ts
downloads.set([download(16, { title: 'Movie details' })]);
await fixture.whenStable();
const card = fixture.nativeElement.querySelector(
    '[data-test-id="download-library-movie-16"]'
) as HTMLElement;

(card.querySelector('.download-library__artwork-button') as HTMLButtonElement)
    .click();
await fixture.whenStable();
expect(navigation.open).toHaveBeenCalledWith(downloads()[0]);
expect(downloadsService.playDownload).not.toHaveBeenCalled();

navigation.open.mockClear();
(card.querySelector('.download-library__actions button') as HTMLButtonElement)
    .click();
await fixture.whenStable();
expect(downloadsService.playDownload).toHaveBeenCalledWith('/downloads/16.mp4');
expect(navigation.open).not.toHaveBeenCalled();
```

Read `downloads.component.scss` and assert `.downloads__skeleton-cards` uses
`--cover-grid-min-width` and `--cover-gap`.

- [ ] **Step 2: Run the container spec and verify RED**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=downloads.component.spec.ts
```

Expected: FAIL because movie detail output is not bound and skeleton sizing is
fixed at `150px`.

- [ ] **Step 3: Wire the output and tokens**

Bind the presentational intent:

```html
<app-download-library
    [entities]="model().library"
    [availablePlaylistIds]="availablePlaylistIds()"
    [pendingIds]="pendingIds()"
    (itemAction)="runAction($event)"
    (openRequested)="openInLibrary($event)"
    (episodesOpened)="openDownloadedSeries($event)"
/>
```

Use the same token contract for the skeleton:

```scss
.downloads__skeleton-cards {
    display: grid;
    grid-template-columns: repeat(
        auto-fill,
        minmax(min(100%, var(--cover-grid-min-width, 148px)), 1fr)
    );
    gap: var(--cover-gap, 16px);
}
```

- [ ] **Step 4: Run both Download Manager specs and verify GREEN**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=download-library.component.spec.ts \
  --testPathPatterns=downloads.component.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the integration**

```bash
git add libs/portal/downloads/feature/src/lib/downloads.component.*
git commit -m "fix(downloads): honor the global cover size"
```

## Task 3: Prefer offline playback in movie details with TDD

**Files:**

- Create: `libs/ui/playback/src/lib/vod-details/vod-details.component.spec.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.html`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route-playback.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.harness.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.html`

- [ ] **Step 1: Write failing shared-detail tests**

For a downloaded Stalker VOD, assert:

```ts
expect(host.textContent).toContain('Offline');
await click(primaryButton);
expect(playDownload).toHaveBeenCalledWith('/downloads/movie.mp4');
expect(playClicked).not.toHaveBeenCalled();

await click(sourceButton);
expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
```

Set a matching external MPV session and assert the primary button says
`Stop MPV`, calls `closeSession`, and does not call `playDownload`.

- [ ] **Step 2: Write failing Xtream detail tests**

Drive the existing sparse VOD fixture with a completed path. Assert the rendered
detail includes `DOWNLOADS.OFFLINE`, primary click calls
`playDownload('/downloads/catalog-movie.mp4')` without constructing provider
playback, and the `PORTALS.MULTI_SOURCE.PLAY_FROM_SOURCE` button starts the
existing provider path. Add a playback-spec case proving a matching MPV/VLC
Stop action still outranks local playback.

- [ ] **Step 3: Run both affected project tests and verify RED**

Run:

```bash
node tools/testing/run-web-esm-lib-tests.mjs \
  libs/ui/playback/src/lib/vod-details --runInBand
pnpm nx test portal-xtream-feature --runInBand \
  --testPathPatterns=vod-details-route.actions.spec.ts \
  --testPathPatterns=vod-details-route-playback.spec.ts
```

Expected: FAIL because the primary action still starts provider playback and
the completed button is still the local secondary action.

- [ ] **Step 4: Implement shared Stalker precedence**

Keep Stop first, then local, then provider:

```ts
async onPrimaryAction(): Promise<void> {
    if (this.isExternalStopAction()) {
        await this.stopExternalPlayback();
        return;
    }
    if (this.isDownloaded()) {
        await this.playFromLocal();
        return;
    }
    this.onProviderAction();
}

onProviderAction(): void {
    if (this.hasPlaybackPosition()) {
        this.onResume();
        return;
    }
    this.onPlay();
}
```

In the template, external Opening/Stop label and icon remain first. Otherwise a
downloaded item uses `DOWNLOADS.PLAY_LOCAL` with `play_circle`. Add an
`DOWNLOADS.OFFLINE` detail tag. Replace the duplicate completed local button
with a neutral `PORTALS.MULTI_SOURCE.PLAY_FROM_SOURCE` button calling
`onProviderAction()`, visible only while the external button state is idle.

- [ ] **Step 5: Implement Xtream precedence**

Extract today's provider/pinned/resume body into
`playFromProviderSource(vodItem)`. Keep `onPrimaryAction` as:

```ts
async onPrimaryAction(vodItem: XtreamVodDetails | null): Promise<void> {
    if (this.playback.isExternalStopAction()) {
        this.playback.onPrimaryAction(vodItem);
        return;
    }
    if (this.isDownloaded()) {
        await this.playFromLocal();
        return;
    }
    await this.playFromProviderSource(vodItem);
}
```

The secondary source button calls `playFromProviderSource(playableItem)`.
External labels/icons remain first, downloaded idle state renders
`DOWNLOADS.PLAY_LOCAL`, and both rich/fallback detail tags render
`DOWNLOADS.OFFLINE`. Hide the source button while an owned external session is
launching or running.

- [ ] **Step 6: Run the tests and verify GREEN**

Run both commands from Step 3. Expected: PASS.

- [ ] **Step 7: Run the complete affected unit suites**

```bash
pnpm nx test portal-downloads-feature --runInBand
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test ui-playback --runInBand
pnpm nx test portal-stalker-feature --runInBand
```

Expected: PASS with no stale detail-action assertions.

- [ ] **Step 8: Commit the detail behavior**

```bash
git add libs/portal/xtream/feature/src/lib/vod-details \
  libs/ui/playback/src/lib/vod-details
git commit -m "fix(downloads): prefer offline movie playback"
```

## Task 4: Acceptance coverage, docs, and release note

**Files:**

- Modify: `apps/electron-backend-e2e/src/downloads.e2e.ts`
- Modify: `docs/architecture/download-manager.md`
- Modify: `.changes/downloads-manager-mvp.md`

- [ ] **Step 1: Add the failing Electron acceptance assertions**

Seed one completed movie using a real imported VOD `xtream_id` and
`category_id`. Assert its artwork/title opens:

```ts
`/workspace/xtreams/${playlistId}/vod/${categoryId}/${xtreamId}`
```

On the Downloads page, set `document.documentElement.dataset.coverSize` to
`small`, `medium`, and `large`; record a completed card width, computed
`columnGap`, and grid column count. Assert the three settings yield the global
12/16/20px gaps and materially different card geometry.

- [ ] **Step 2: Run targeted E2E and verify RED**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts
```

Expected: FAIL because movie artwork plays locally and all three cover settings
produce the same grid.

- [ ] **Step 3: Run targeted E2E and verify GREEN after Tasks 1–3**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 4: Update canonical documentation**

Document:

- movie/grouped-series artwork/title to provider details;
- explicit card Play and legacy episode fallback to the local file;
- primary local and secondary provider playback on downloaded VOD details;
- external-player Stop precedence;
- global `--cover-grid-min-width` / `--cover-gap` ownership;
- provider-backed details and metadata caching as a future boundary.

- [ ] **Step 5: Update and validate the release note**

Keep the existing single `.changes/downloads-manager-mvp.md` note and describe
the corrected navigation, offline playback, and cover sizing in at most 400
characters.

```bash
pnpm run release:notes:validate
```

Expected: PASS.

- [ ] **Step 6: Run repository validation**

```bash
pnpm nx lint portal-downloads-feature
pnpm nx lint portal-xtream-feature
pnpm nx lint ui-playback
pnpm nx lint portal-stalker-feature
pnpm nx run web:typecheck
pnpm nx build web
pnpm run i18n:check
pnpm run release:notes:validate
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 7: Rebuild and inspect Electron**

Rebuild the Electron/web artifacts, restart only the worktree test instance,
and inspect:

- Small/Medium/Large at wide and narrow widths;
- movie card artwork/title versus explicit Play;
- downloaded Xtream and Stalker VOD action hierarchy;
- light and dark themes;
- absence of renderer console errors.

- [ ] **Step 8: Commit and push**

```bash
git add apps/electron-backend-e2e/src/downloads.e2e.ts \
  docs/architecture/download-manager.md \
  .changes/downloads-manager-mvp.md
git commit -m "test(downloads): cover detail-first offline flow"
git push origin agent/download-manager-mvp
```
