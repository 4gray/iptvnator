import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptPwaProviderRequests,
    resetPwaMockServers,
} from './sources-pwa.helpers';

/**
 * Mobile Layout Smoke Tests
 *
 * PR #1326 made the workspace usable on phone-sized screens (issue #1100);
 * the follow-up drawer PR turned the phone context panel into an off-canvas
 * drawer. These tests pin the invariants that regressed before:
 *
 *   1. No horizontal overflow — document.documentElement.scrollWidth stays
 *      within the viewport on dashboard, Xtream VOD/live, and settings.
 *   2. The workspace rail links render inside the 52px top bar instead of
 *      stacking downwards over the header.
 *   3. On a portal route the context panel is an off-canvas drawer: hidden
 *      by default so the content keeps the full viewport width, opened from
 *      the header toggle (winning over the persisted desktop inline width),
 *      and closed again by picking a category or tapping the backdrop.
 *   4. The settings section list scrolls instead of painting over the
 *      Back footer — now inside the open drawer.
 *   5. On a 640x360 landscape phone the live route keeps the channel
 *      sidebar at least 72px tall and the player container inside the
 *      viewport.
 *
 * Conventions: docs/architecture/iptvnator-ui-guidelines.md, "Phone Layout"
 * (640px breakpoint, resizable rails stack full-width via `!important`).
 *
 * Tag: @mobile — run only this spec with:
 *   pnpm nx run web-e2e:e2e-ci--src/mobile-layout.e2e.ts
 */

const PHONE = { width: 375, height: 812 };
const LANDSCAPE_PHONE = { width: 640, height: 360 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function expectNoHorizontalOverflow(
    page: Page,
    viewportWidth: number
): Promise<void> {
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewportWidth);
}

async function boxOf(
    locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    expect(box, 'expected element to have a bounding box').not.toBeNull();
    return box as NonNullable<typeof box>;
}

/**
 * Before #1326 the nested `.rail-links` list kept `flex-direction: column`
 * inside the horizontal phone bar, so links 2..n were laid out below the
 * 52px row and overlapped the header. Horizontal overflow inside the bar
 * is fine — the bar scrolls sideways by design — so only y is asserted.
 */
async function expectRailLinksInsideTopBar(page: Page): Promise<void> {
    const rail = page.locator('.app-rail');
    await expect(rail).toBeVisible();

    const railBox = await boxOf(rail);
    // The shell grid gives the rail row 52px on phones.
    expect(railBox.height).toBeLessThanOrEqual(60);

    await expect(page.locator('.rail-links').first()).toHaveCSS(
        'flex-direction',
        'row'
    );

    const links = page.locator('.app-rail a:visible');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
        const linkBox = await boxOf(links.nth(i));
        expect(linkBox.y).toBeGreaterThanOrEqual(railBox.y - 1);
        expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(
            railBox.y + railBox.height + 1
        );
    }
}

// ---------------------------------------------------------------------------
// Portrait phone — no imported sources needed, app boots at phone size
// ---------------------------------------------------------------------------

test.describe('portrait phone 375x812', () => {
    test.use({ viewport: PHONE });

    test('@mobile dashboard fits the viewport and keeps rail links in the top bar', async ({
        page,
    }) => {
        await page.goto('/workspace/dashboard');
        await expect(page.locator('.app-rail')).toBeVisible();

        await expectNoHorizontalOverflow(page, PHONE.width);
        await expectRailLinksInsideTopBar(page);
    });

    test('@mobile settings drawer opens from the header toggle and keeps the section list clear of the Back footer', async ({
        page,
    }) => {
        await page.goto('/workspace/settings');

        // The phone context panel is an off-canvas drawer: hidden until the
        // header toggle opens it, so the settings content owns the pane.
        const panel = page.locator('.context-panel--settings');
        await expect(panel).toBeHidden();

        await page.locator('[data-test-id="context-drawer-toggle"]').click();
        await expect(panel).toBeVisible();

        // Narrower than the viewport so the backdrop stays tappable, and
        // wider than the persisted desktop inline width would leave it.
        const panelBox = await boxOf(panel);
        expect(panelBox.width).toBeGreaterThanOrEqual(300);
        expect(panelBox.width).toBeLessThanOrEqual(PHONE.width - 20);

        const footer = panel.locator('.settings-panel-footer');
        await expect(footer.locator('.settings-back-button')).toBeVisible();

        // Before #1326 the section list kept its full content height and
        // painted over the footer whenever the panel was shorter than its
        // sections; now the list scrolls and ends above the footer.
        const listBox = await boxOf(panel.locator('.settings-sections-list'));
        const footerBox = await boxOf(footer);
        expect(listBox.y + listBox.height).toBeLessThanOrEqual(footerBox.y + 1);

        // Tapping the backdrop (right of the drawer) closes it.
        await page
            .locator('[data-test-id="context-drawer-backdrop"]')
            .click({ position: { x: PHONE.width - 10, y: 400 } });
        await expect(panel).toBeHidden();

        await expectNoHorizontalOverflow(page, PHONE.width);
    });
});

// ---------------------------------------------------------------------------
// Xtream portal routes — the portal is imported at the default desktop
// viewport (which persists desktop rail widths, the exact regression
// scenario from #1100), then the window shrinks to phone size.
// ---------------------------------------------------------------------------

test.describe('xtream portal routes on a phone', () => {
    test.beforeEach(async ({ page, request }) => {
        await resetPwaMockServers(request);
        await interceptPwaProviderRequests(page);
        await page.goto('/');
        await addXtreamPortal(page, 'Mobile Layout Portal');
    });

    test('@mobile @xtream vod route keeps the context panel in a drawer behind the header toggle', async ({
        page,
    }) => {
        await page.setViewportSize(PHONE);

        // Hidden by default — the content owns the full pane. This is the
        // successor to the #1326 stacked layout, which left the content
        // only the leftover under a 30vh panel.
        const panel = page.locator('.context-panel');
        await expect(panel).toBeHidden();

        const content = page.locator('main.workspace-content');
        const contentWidth = await content.evaluate((el) => el.clientWidth);
        expect(contentWidth).toBeGreaterThanOrEqual(PHONE.width - 20);

        // The header toggle slides the drawer in. The persisted desktop
        // width is written as an inline style; the drawer rule must win
        // with `width: 100% !important` of its ~320px surface, otherwise
        // the panel keeps its desktop width fraction.
        await page.locator('[data-test-id="context-drawer-toggle"]').click();
        await expect(panel).toBeVisible();
        await expect
            .poll(async () => (await panel.boundingBox())?.width ?? 0)
            .toBeGreaterThanOrEqual(300);

        // Picking a category both filters the route and closes the drawer.
        const firstCategory = page
            .locator('.context-panel .category-item')
            .first();
        await expect(firstCategory).toBeVisible();
        await firstCategory.click();
        await expect(panel).toBeHidden();

        await expectNoHorizontalOverflow(page, PHONE.width);
        await expectRailLinksInsideTopBar(page);
    });

    test('@mobile @xtream landscape live route keeps the channel list and the player inside the viewport', async ({
        page,
    }) => {
        // Select a category at desktop width so the channel sidebar renders
        // (`showLiveChannelSidebar` requires a selected category). On the
        // live root the click updates store state without navigating, so the
        // sidebar appearing is the completion signal — not a URL change.
        await page.goto(page.url().replace(/\/vod.*$/, '/live'));
        const firstCategory = page
            .locator('.context-panel .category-item')
            .first();
        await expect(firstCategory).toBeVisible();
        await firstCategory.click();

        const sidebar = page.locator('app-live-stream-layout .sidebar');
        await expect(sidebar).toBeVisible();

        // The workspace header carries the live rail toggle at desktop
        // width only; on the phone the rail is a bottom drawer with its own
        // toggle and the header has no room for another permanent icon.
        const headerRailToggle = page.locator(
            'app-workspace-shell-header .header-sidebar-toggle'
        );
        await expect(headerRailToggle).toBeVisible();

        await page.setViewportSize(LANDSCAPE_PHONE);
        await expect(headerRailToggle).toBeHidden();

        // The sidebar stacks at full width above the player.
        await expect
            .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
            .toBeGreaterThanOrEqual(LANDSCAPE_PHONE.width - 2);

        // Before the follow-up fix in #1326 the player's 240px floor drove
        // the still-expanded sidebar to zero height on a 640x360 screen,
        // leaving no way to pick another channel.
        const sidebarBox = await boxOf(sidebar);
        expect(sidebarBox.height).toBeGreaterThanOrEqual(71);

        // ...and pushed the layout past the viewport. The player container
        // has to end inside it.
        const contentBox = await boxOf(
            page.locator('app-live-stream-layout .content-container')
        );
        expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(
            LANDSCAPE_PHONE.height + 1
        );
        expect(contentBox.width).toBeLessThanOrEqual(LANDSCAPE_PHONE.width);

        await expectNoHorizontalOverflow(page, LANDSCAPE_PHONE.width);
    });
});
