# Hide Homogeneous Catalog Type Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant `LIVE`, `VOD`, and `SERIES` badges from homogeneous Stalker and Xtream catalog grids while preserving type badges in mixed-content cards.

**Architecture:** Remove the type-badge presentation from the shared `GridListComponent`, whose current consumers are homogeneous catalog grids. Keep its `type` input because artwork placeholders and live-title normalization still depend on it; do not modify `ContentCardComponent`, which owns badges for mixed-content surfaces.

**Tech Stack:** Angular standalone components, Angular signal inputs, SCSS, Jest through Nx, Playwright E2E through Nx.

---

### Task 0: Bootstrap the Nx workspace

**Files:**
- Verify only: `package.json`
- Verify only: `pnpm-lock.yaml`

- [ ] **Step 1: Install the locked workspace dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 without changing `pnpm-lock.yaml`.

- [ ] **Step 2: Verify Nx project discovery**

Run:

```bash
pnpm nx show projects
```

Expected: exit 0 and output containing `portal-shared-ui`,
`portal-catalog-feature`, and `web-e2e`.

### Task 1: Remove the redundant grid-list badge

**Files:**
- Modify: `libs/portal/shared/ui/src/lib/components/grid-list/grid-list.component.spec.ts`
- Modify: `libs/portal/shared/ui/src/lib/components/grid-list/grid-list.component.ts`
- Modify: `libs/portal/shared/ui/src/lib/components/grid-list/grid-list.component.scss`

- [ ] **Step 1: Write the failing regression test**

In `grid-list.component.spec.ts`, change the existing live-logo test so it only
asserts logo-card rendering, then add this parameterized test inside
`describe('GridListComponent', ...)`:

```typescript
it.each(['live', 'vod', 'series'] as const)(
    'does not render a redundant %s type badge in homogeneous grids',
    (type) => {
        fixture.componentRef.setInput('items', [
            {
                name: 'Catalog item',
                stream_icon: 'catalog-item.png',
            },
        ]);
        fixture.componentRef.setInput('type', type);

        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.type-badge'))
        ).toBeNull();
    }
);
```

The updated live-logo test must retain these assertions:

```typescript
expect(card.nativeElement.classList).toContain('grid-card--logo');
expect(image.nativeElement.getAttribute('src')).toBe('channel-logo.png');
```

It must no longer query or assert `.type-badge`.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm nx test portal-shared-ui --testPathPattern=grid-list.component.spec.ts --runInBand
```

Expected: FAIL for `live`, `vod`, and `series` because
`GridListComponent` still renders `.type-badge`.

- [ ] **Step 3: Remove the badge markup**

In the inline template in `grid-list.component.ts`, remove only this block:

```html
@if (type()) {
    <div
        class="type-badge"
        [class.live]="type() === 'live'"
        [class.movie]="type() === 'vod'"
        [class.series]="type() === 'series'"
    >
        {{ type() }}
    </div>
}
```

Keep the `type` input and every remaining use of `type()` unchanged.

- [ ] **Step 4: Remove the now-unused grid badge styles**

In `grid-list.component.scss`, delete the entire `.type-badge` rule, including
its `.live`, `.movie`, and `.series` variants:

```scss
.type-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 1;
    padding: 3px 6px;
    border-radius: 5px;
    font-size: 0.58rem;
    font-weight: 700;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;

    &.live {
        color: #ef5350;
    }

    &.movie {
        color: #42a5f5;
    }

    &.series {
        color: #66bb6a;
    }
}
```

Do not change the separate content-card badge mixin or
`content-card.component.*`.

- [ ] **Step 5: Run the focused test to verify GREEN**

Run:

```bash
pnpm nx test portal-shared-ui --testPathPattern=grid-list.component.spec.ts --runInBand
```

Expected: PASS, including the three type-badge regression cases and the
existing placeholder/title behavior.

- [ ] **Step 6: Run affected unit and lint targets**

Run:

```bash
pnpm nx test portal-shared-ui
pnpm nx test portal-catalog-feature
pnpm nx lint portal-shared-ui
```

Expected: all commands exit 0 with no failed tests or lint errors.

- [ ] **Step 7: Verify mixed-content badge ownership is untouched**

Run:

```bash
git diff -- libs/portal/shared/ui/src/lib/components/content-card libs/portal/xtream/feature/src/lib/search-results libs/portal/stalker/feature/src/lib/stalker-search
```

Expected: no output. `ContentCardComponent` and both mixed search surfaces
remain unchanged.

- [ ] **Step 8: Commit the implementation**

```bash
git add \
  libs/portal/shared/ui/src/lib/components/grid-list/grid-list.component.spec.ts \
  libs/portal/shared/ui/src/lib/components/grid-list/grid-list.component.ts \
  libs/portal/shared/ui/src/lib/components/grid-list/grid-list.component.scss
git commit -m "fix(portal): remove redundant catalog type badges"
```

Expected: one commit containing only the grid-list behavior and regression
coverage.

### Task 2: Validate the portal workflows

**Files:**
- Verify only: `apps/web-e2e/src/xtream.e2e.ts`
- Verify only: `apps/web-e2e/src/stalker.e2e.ts`
- Verify only: `docs/architecture/iptvnator-ui-guidelines.md`

- [ ] **Step 1: Run the Xtream portal E2E target**

Run:

```bash
pnpm nx run web-e2e:e2e-ci--src/xtream.e2e.ts
```

Expected: PASS for the Xtream category and content-list workflows.

- [ ] **Step 2: Run the Stalker portal E2E target**

Run:

```bash
pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts
```

Expected: PASS for the Stalker category and content-list workflows.

- [ ] **Step 3: Perform the final diff and documentation-impact check**

Run:

```bash
git diff HEAD^ --check
git show --stat --oneline HEAD
git status --short
```

Expected:

- `git diff --check` exits 0;
- the implementation commit contains only the three grid-list files;
- the worktree contains only this implementation plan if it has not been
  committed separately;
- no canonical documentation update is needed because
  `docs/architecture/iptvnator-ui-guidelines.md` already directs contributors
  not to add redundant badges or secondary selection systems.
