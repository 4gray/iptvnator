# Preserve EPG Preview in Narrow Channel Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep current-program context and enabled channel actions visible when a shared channel row is narrowed to the supported Live TV sidebar widths.

**Architecture:** Preserve the shared `app-channel-list-item` API and virtual-scroll height. Change only its container-query degradation order and the matching skeleton geometry, with one deterministic Electron regression that forces item hosts to representative widths independently of scrollbar behavior.

**Tech Stack:** Angular standalone components, SCSS container queries, Playwright Electron E2E, Nx, Prettier.

---

### Task 1: Add the failing narrow-row Electron regression

**Files:**

- Modify: `apps/electron-backend-e2e/src/xtream-epg.e2e.ts`

- [ ] **Step 1: Add a dedicated narrow-width EPG test**

Add one test outside the timezone loop so the responsive contract is exercised
once rather than duplicated for each timezone. Reuse the existing fictional
`epg/epg` portal, select `EPG Focus`, and use `Timezone News` for a current
programme plus `Night Sports` for the no-program placeholder.

```ts
test('@epg @xtream @electron keeps EPG context and actions at narrow channel-row widths', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const currentProgram = fixture.shortEpg[0];
    if (!currentProgram) {
        throw new Error(
            'Expected the Xtream EPG fixture to include a current program.'
        );
    }
    const app = await launchElectronApp(dataDir, { env: { TZ: 'UTC' } });

    try {
        await addXtreamPortal(app.mainWindow, {
            name: `${epgPortalName} Narrow`,
            username: epgCredentials.username,
            password: epgCredentials.password,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);

        const currentRow = channelItemByTitle(
            app.mainWindow,
            fixture.stream.name ?? ''
        ).first();
        const placeholderRow = channelItemByTitle(
            app.mainWindow,
            'Night Sports'
        ).first();
        await expect(currentRow).toBeVisible({ timeout: 20000 });
        await expect(placeholderRow).toBeVisible();

        await setPortalChannelItemWidth(app.mainWindow, 232);

        await expect(currentRow.locator('.epg-title')).toHaveText(
            currentProgram.title
        );
        await expect(currentRow.locator('.epg-progress-track')).toBeVisible();
        await expect(currentRow.locator('.favorite-button')).toBeVisible();
        await expect(placeholderRow.locator('.epg-placeholder')).toBeVisible();
        await expect(currentRow.locator('.channel-logo-shell')).toBeHidden();
        await expect(currentRow.locator('.epg-time').first()).toBeVisible();
        await expect(currentRow.locator('.epg-time').last()).toBeHidden();
        await expect(currentRow).toHaveCSS('min-height', '68px');
        await expectNarrowRowContentFits(currentRow);
        await expectNarrowRowContentFits(placeholderRow);

        await setPortalChannelItemWidth(app.mainWindow, 200);

        await expect(currentRow.locator('.epg-title')).toBeVisible();
        await expect(currentRow.locator('.epg-progress-track')).toBeVisible();
        await expect(currentRow.locator('.favorite-button')).toBeVisible();
        await expect(placeholderRow.locator('.epg-placeholder')).toBeVisible();
        await expect(currentRow.locator('.epg-time').first()).toBeHidden();
        await expect(currentRow.locator('.epg-time').last()).toBeHidden();
        await expect(currentRow).toHaveCSS('min-height', '68px');
        await expectNarrowRowContentFits(currentRow);
        await expectNarrowRowContentFits(placeholderRow);
    } finally {
        await closeElectronApp(app);
    }
});
```

- [ ] **Step 2: Add the deterministic host-width helper**

Place the helper with the existing E2E-local utilities:

```ts
async function setPortalChannelItemWidth(
    page: Parameters<typeof channelItemByTitle>[0],
    width: number
): Promise<void> {
    const itemHosts = page.locator(
        'app-portal-channels-list app-channel-list-item'
    );
    await itemHosts.evaluateAll((elements, itemWidth) => {
        for (const element of elements) {
            (element as HTMLElement).style.width = `${itemWidth}px`;
        }
    }, width);
    await expect
        .poll(() =>
            itemHosts
                .first()
                .evaluate((element) =>
                    Math.round(element.getBoundingClientRect().width)
                )
        )
        .toBe(width);
}

async function expectNarrowRowContentFits(
    row: ReturnType<typeof channelItemByTitle>
): Promise<void> {
    const rowBox = await row.boundingBox();
    const detailsBox = await row.locator('.channel-details').boundingBox();
    const actionsBox = await row.locator('.action-buttons').boundingBox();
    if (!rowBox || !detailsBox || !actionsBox) {
        throw new Error('Expected visible narrow-row geometry.');
    }

    expect(detailsBox.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(
        actionsBox.x + 0.5
    );
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(
        rowBox.x + rowBox.width + 0.5
    );

    const progressTrack = row.locator('.epg-progress-track');
    if ((await progressTrack.count()) > 0) {
        const progressBox = await progressTrack.boundingBox();
        expect(progressBox?.width ?? 0).toBeGreaterThanOrEqual(24);
    }
}
```

- [ ] **Step 3: Run the focused E2E and prove the old behavior fails**

Run:

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-epg.e2e.ts --skip-nx-cache
```

Expected: the new test fails at `232px` because the current `max-width: 270px`
rule hides the programme title, timeline, and placeholder, switches the EPG row
to the compact height, and leaves the logo visible. At `200px`, the current
rule also hides the complete action group. Existing EPG tests should remain
green before the new assertions are reached.

### Task 2: Implement the shared responsive contract

**Files:**

- Modify: `libs/ui/components/src/lib/channel-list-container/channel-list-item/channel-list-item.component.scss:241`
- Modify: `libs/ui/components/src/lib/channel-list-container/channel-list-item-skeleton/channel-list-item-skeleton.component.scss:89`
- Verify: `apps/electron-backend-e2e/src/xtream-epg.e2e.ts`

- [ ] **Step 1: Keep timing horizontal below 310px**

Replace the one-column timeline at `max-width: 310px` with a start-time and
flexible-progress row while continuing to hide the end time:

```scss
@container (max-width: 310px) {
    .epg-timeline {
        grid-template-columns: auto minmax(24px, 1fr);
        gap: 5px;
    }

    .epg-time:last-child {
        display: none;
    }
}
```

- [ ] **Step 2: Preserve EPG and actions below 270px**

Replace the current `max-width: 270px` degradation with:

```scss
@container (max-width: 270px) {
    .channel-list-item {
        gap: 8px;
        padding-inline: 8px 6px;
    }

    .channel-list-item:not(.compact) .channel-logo-shell {
        display: none;
    }

    .channel-list-item:not(.compact) .channel-content {
        gap: 0;
    }

    .channel-list-item.compact .channel-logo-shell {
        width: 34px;
        height: 34px;
    }
}
```

Do not set the row to `52px`; EPG rows inherit the base `68px` minimum. Do not
hide `.epg-title`, `.epg-timeline`, `.epg-placeholder`,
`.program-info-button`, or `.action-buttons`.

- [ ] **Step 3: Remove only the start time below 220px**

Replace the current `max-width: 220px` action-hiding rule with:

```scss
@container (max-width: 220px) {
    .channel-list-item:not(.compact) .epg-timeline {
        grid-template-columns: minmax(24px, 1fr);
    }

    .channel-list-item:not(.compact) .epg-time:first-child {
        display: none;
    }

    .channel-list-item.compact {
        .channel-logo-shell,
        .action-buttons {
            display: none;
        }

        .channel-content {
            gap: 0;
        }
    }
}
```

The end time is already hidden by the wider breakpoint. Channel name, current
programme or placeholder, progress, drag affordance, and every enabled action
remain available in EPG rows. The `.compact` branch deliberately preserves the
existing non-EPG degradation; radio-only consumers without EPG opt into that
branch through `showEpg=false`, rather than changing mixed-list height through
`isRadio`.

- [ ] **Step 4: Match skeleton degradation to the live row**

Keep the existing `360px` tightening. Replace the narrower skeleton rules so
they hide only the logo and its gap:

```scss
@container (max-width: 270px) {
    .channel-list-item-skeleton {
        gap: 8px;
        padding-inline: 8px 6px;
    }

    .channel-list-item-skeleton:not(.compact) .channel-logo-skeleton {
        display: none;
    }

    .channel-list-item-skeleton:not(.compact) .channel-content-skeleton {
        gap: 0;
    }

    .channel-list-item-skeleton.compact .channel-logo-skeleton {
        width: 34px;
        height: 34px;
    }
}
```

Scope the skeleton's existing `max-width: 220px` behavior to compact rows:

```scss
@container (max-width: 220px) {
    .channel-list-item-skeleton.compact {
        .channel-logo-skeleton,
        .action-buttons-skeleton {
            display: none;
        }

        .channel-content-skeleton {
            gap: 0;
        }
    }
}
```

The EPG title, progress, action slots, and `68px` minimum height must remain
stable at every supported narrow width, while compact skeletons preserve their
current behavior.

- [ ] **Step 5: Run focused and component validation**

Run:

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-epg.e2e.ts --skip-nx-cache
pnpm nx test components --skip-nx-cache
pnpm nx lint components --skip-nx-cache
pnpm nx lint electron-backend-e2e --skip-nx-cache
```

Expected: all commands pass. The Electron test proves the old narrow-width
failure is fixed; component tests protect unchanged rendering and interactions.

- [ ] **Step 6: Commit the regression and implementation**

```bash
git add \
  apps/electron-backend-e2e/src/xtream-epg.e2e.ts \
  libs/ui/components/src/lib/channel-list-container/channel-list-item/channel-list-item.component.scss \
  libs/ui/components/src/lib/channel-list-container/channel-list-item-skeleton/channel-list-item-skeleton.component.scss
git commit -m "fix(ui): preserve EPG in narrow channel rows"
```

### Task 3: Document the contract and add the release note

**Files:**

- Modify: `docs/architecture/iptvnator-ui-guidelines.md:111`
- Create: `.changes/ui-narrow-channel-epg.md`

- [ ] **Step 1: Add the canonical responsive priority**

Under `## Channel List Item`, add a `### Responsive Information Priority`
section after `### Content Layout`:

```md
### Responsive Information Priority

- Keep EPG rows at `68px`; only rows without EPG use the `52px` compact height.
- At `310px` and below, hide the programme end time and retain the start time
  plus progress on one row.
- At `270px` and below, hide the decorative logo before hiding programme
  context or actions.
- At `220px` and below, hide the programme start time and retain progress.
- Never remove the channel name, current-programme title or no-program
  placeholder, progress, drag affordance, or an enabled row action merely
  because the shared item is narrow.
- Keep the skeleton geometry aligned with the loaded row.
```

- [ ] **Step 2: Add a user-facing fix note**

Create `.changes/ui-narrow-channel-epg.md`:

```md
---
type: fix
area: ui
---

Narrow channel lists now keep the current programme, progress, and channel
actions visible instead of dropping useful EPG context.
```

Do not list issue `#1118` as closed because this PR intentionally implements
only its first increment.

- [ ] **Step 3: Validate formatting and release-note metadata**

Run:

```bash
pnpm exec prettier --check \
  docs/architecture/iptvnator-ui-guidelines.md \
  .changes/ui-narrow-channel-epg.md
pnpm run release:notes:validate
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit documentation and release metadata**

```bash
git add \
  docs/architecture/iptvnator-ui-guidelines.md \
  .changes/ui-narrow-channel-epg.md
git commit -m "docs(ui): document narrow channel row priority"
```

### Task 4: Run final automated and Electron UI verification

**Files:**

- Verify all files changed in Tasks 1–3.
- Do not add generated screenshots or a real playlist to the repository.

- [ ] **Step 1: Run the complete affected validation ladder**

Run:

```bash
pnpm nx test components --skip-nx-cache
pnpm nx lint components --skip-nx-cache
pnpm nx lint electron-backend-e2e --skip-nx-cache
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-epg.e2e.ts --skip-nx-cache
pnpm nx build web --skip-nx-cache
pnpm run release:notes:validate
pnpm exec prettier --check \
  apps/electron-backend-e2e/src/xtream-epg.e2e.ts \
  libs/ui/components/src/lib/channel-list-container/channel-list-item/channel-list-item.component.scss \
  libs/ui/components/src/lib/channel-list-container/channel-list-item-skeleton/channel-list-item-skeleton.component.scss \
  docs/architecture/iptvnator-ui-guidelines.md \
  .changes/ui-narrow-channel-epg.md
git diff --check
```

Expected: every command exits successfully.

- [ ] **Step 2: Build and launch an isolated Electron runtime**

Build once:

```bash
pnpm nx run electron-backend:build-e2e
```

Start the mock servers in a dedicated terminal:

```bash
pnpm nx run-many \
  --target=serve \
  --projects=xtream-mock-server,stalker-mock-server \
  --parallel=2 \
  --output-style=stream
```

Create a disposable profile and launch the built app with CDP:

```bash
IPTVNATOR_VISUAL_DATA_DIR="$(mktemp -d /tmp/iptvnator-sidebar.XXXXXX)"
IPTVNATOR_E2E_DATA_DIR="$IPTVNATOR_VISUAL_DATA_DIR" \
IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS=1 \
ELECTRON_IS_DEV=0 \
NODE_ENV=test \
TZ=UTC \
./node_modules/.bin/electron \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  dist/apps/electron-backend/main.js
```

- [ ] **Step 3: Verify real layout behavior with `agent-browser`**

Connect to the IPTVnator renderer, not a DevTools target:

```bash
agent-browser --cdp 9222 tab list
agent-browser --cdp 9222 snapshot -i -c -d 4
```

Using only mock credentials, inspect Xtream `EPG Focus → Timezone News` at the
persisted `live-channels-sidebar-width=250`. Confirm in computed layout and a
temporary screenshot that:

- the programme title and progress are visible;
- the end time and logo are hidden at the resulting `~228–234px` item width;
- the favorite action is visible and not clipped;
- the row remains `68px` high;
- `Night Sports` shows the no-program placeholder without overlap.

Then add the local Stalker mock portal at
`http://localhost:3210/portal.php` with MAC `00:1A:79:00:00:01` and inspect its
Live surface at the `250px` sidebar minimum. This proves a second provider
using the shared row has the same geometry. Save screenshots only under
`/tmp`, for example:

```bash
agent-browser --cdp 9222 screenshot /tmp/iptvnator-narrow-epg-xtream.png
agent-browser --cdp 9222 screenshot /tmp/iptvnator-narrow-epg-stalker.png
```

- [ ] **Step 4: Check repository scope and hand off**

Run:

```bash
git status --short
git diff origin/master...HEAD --stat
git log --oneline origin/master..HEAD
```

Expected: the branch contains only the approved design, regression, shared-row
SCSS, canonical guideline, release note, and this implementation plan. No
`.superpowers/` visual artifacts, screenshots, real playlist data, credentials,
or unrelated changes are staged or committed.
