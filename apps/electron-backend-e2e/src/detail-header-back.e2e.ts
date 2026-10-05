import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// A detail page's Back lives in the workspace header's leading slot, not in
// the page. Nothing floats over the scroll owner, so the content keeps its
// full width: every column has symmetric insets instead of a reserved Back
// lane. Checked at a wide and a narrow desktop window and at phone width,
// where Back takes the context drawer toggle's slot.
//
// The "Episodes" heading must also stay on one line: the detail pane is far
// narrower than the window beside the rail and category panel, and the
// heading used to wrap beside its actions.
//
// Pages without a Back of their own (the list a detail returns to) get the
// header's history fallback while an in-app previous page exists; on a
// phone it yields to the drawer toggle, and with nowhere to go the slot is
// empty rather than a disabled arrow.
// ---------------------------------------------------------------------------

const widths = [1280, 780, 375];
const phoneWidth = 640;
/** The widest translation of the heading; it must fit wherever English does. */
const widestLocale = 'nl';
const widestHeading = (
    JSON.parse(
        readFileSync(
            join(__dirname, `../../web/src/assets/i18n/${widestLocale}.json`),
            'utf8'
        )
    ) as { PORTALS: { DETAIL: { EPISODES: string } } }
).PORTALS.DETAIL.EPISODES;

const detailUrlPattern = /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/;

function headerBack(page: Page): Locator {
    return page.getByTestId('workspace-header-back');
}

/**
 * The generic history Back. A detail's own Back advertises Escape in browse;
 * the fallback runs no page handler, so it advertises none.
 */
async function expectHistoryBack(page: Page): Promise<void> {
    await expect(headerBack(page)).toBeVisible();
    await expect(headerBack(page)).toHaveAccessibleName('Back');
    await expect(headerBack(page)).not.toHaveAttribute('aria-keyshortcuts');
}

/** Line boxes of the heading's text; 1 means it did not wrap. */
function headingLineCount(page: Page): Promise<number> {
    return page
        .locator('[data-test-id="episodes-heading"]')
        .evaluate((heading) => {
            const range = document.createRange();
            range.selectNodeContents(heading);
            const lines = [...range.getClientRects()]
                .filter((rect) => rect.width > 0)
                .map((rect) => Math.round(rect.top));
            return new Set(lines).size;
        });
}

/**
 * Columns whose start inset differs from their end inset. A reserved Back
 * lane shows up here as a wider start inset.
 */
function asymmetricColumns(shell: Locator): Promise<string[]> {
    return shell.evaluate((element) =>
        [
            '.hero__content',
            '.shell__player--active',
            '.shell__episodes',
            '.shell__extras',
            'app-content-about .about',
        ].flatMap((selector) => {
            const column = element.querySelector(selector);
            if (!column || !column.getClientRects().length) return [];
            const style = getComputedStyle(column);
            return style.paddingLeft === style.paddingRight
                ? []
                : [`${selector}: ${style.paddingLeft} / ${style.paddingRight}`];
        })
    );
}

/**
 * Lets the browse↔watch morph, the player's fade-in and the workspace's own
 * transitions settle — crossing into the phone layout slides the category
 * drawer out over the page for 200ms. Bounded, so a paused animation
 * elsewhere cannot stall the test.
 */
async function settle(shell: Locator): Promise<void> {
    await shell.evaluate((element) =>
        Promise.race([
            Promise.all(
                element.ownerDocument
                    .getAnimations()
                    .filter(
                        (animation) =>
                            animation.effect?.getTiming().iterations !==
                            Infinity
                    )
                    .map((animation) =>
                        animation.finished.catch(() => undefined)
                    )
            ),
            new Promise((resolve) => setTimeout(resolve, 2_000)),
        ])
    );
}

async function expectBackInHeader(
    page: Page,
    state: 'browse' | 'watch'
): Promise<void> {
    const shell = page.locator('app-portal-detail-shell');
    for (const width of widths) {
        const label = `${state} at ${width}px`;
        await page.setViewportSize({ width, height: 800 });
        await settle(shell);

        const back = headerBack(page);
        await expect(back, label).toBeVisible();
        await expect(back, label).toHaveAccessibleName('Back');
        // Escape unwinds the page in browse; in watch it closes the player.
        if (state === 'browse') {
            await expect(back, label).toHaveAttribute(
                'aria-keyshortcuts',
                'Escape'
            );
        } else {
            await expect(back, label).not.toHaveAttribute('aria-keyshortcuts');
        }
        await expect(
            page
                .locator('app-workspace-shell-header')
                .getByTestId('workspace-header-back'),
            label
        ).toHaveCount(1);
        // The page itself carries no second arrow.
        await expect(
            shell.getByRole('button', { name: 'Back', exact: true }),
            label
        ).toHaveCount(0);
        expect(await asymmetricColumns(shell), label).toEqual([]);
        // On a phone, Back takes the drawer toggle's slot in the header.
        await expect(
            page.getByTestId('context-drawer-toggle'),
            label
        ).toHaveCount(0);
        if (width <= phoneWidth) {
            const [backBox, switcherBox] = await Promise.all([
                back.boundingBox(),
                page.locator('app-playlist-switcher').boundingBox(),
            ]);
            expect(backBox?.x ?? Infinity, label).toBeLessThan(
                switcherBox?.x ?? -Infinity
            );
        }
        expect(await headingLineCount(page), label).toBe(1);
    }
}

/**
 * Re-checks the heading in the widest translation. Below these widths (a
 * ~220px header beside the category panel) a translation wider than the pane
 * itself wraps by design rather than losing words to an ellipsis.
 */
async function expectWidestHeadingOnOneLine(
    page: Page,
    detailUrl: string
): Promise<void> {
    await page.setViewportSize({ width: widths[0], height: 800 });
    await openSettings(page);
    await page.getByTestId('select-language').click();
    await page.getByTestId(widestLocale).click();
    await saveSettings(page);
    await page.goBack();
    await page.waitForURL(detailUrl);
    await expect(page.locator('[data-test-id="episodes-heading"]')).toHaveText(
        widestHeading,
        {
            timeout: 20_000,
        }
    );
    for (const width of [...widths, 700]) {
        await page.setViewportSize({ width, height: 800 });
        expect(
            await headingLineCount(page),
            `${widestLocale} at ${width}px`
        ).toBe(1);
    }
}

/**
 * The actions move onto their own row before the heading wraps, at every
 * pane width that can hold the heading at all.
 */
async function expectHeadingOnOneLine(page: Page): Promise<void> {
    const wrapped: number[] = [];
    for (let width = 680; width <= 1600; width += 20) {
        await page.setViewportSize({ width, height: 800 });
        if ((await headingLineCount(page)) !== 1) wrapped.push(width);
    }
    expect(wrapped).toEqual([]);
}

async function openFirstSeries(page: Page): Promise<string> {
    await page.getByRole('link', { name: 'Series', exact: true }).click();
    await clickFirstGridListCard(page);
    await page.waitForURL(detailUrlPattern);
    await expect(page.locator('[data-test-id="episodes-heading"]')).toBeVisible(
        {
            timeout: 20_000,
        }
    );
    await expect(page.locator('.episode-card').first()).toBeVisible({
        timeout: 20_000,
    });
    return page.url();
}

async function startFirstEpisode(page: Page): Promise<void> {
    const shell = page.locator('app-portal-detail-shell');
    await page.locator('.episode-card').first().click();
    await expect(shell).toHaveClass(/shell-host--watch/);
    await expect(
        shell.locator('app-portal-inline-player app-web-player-view')
    ).toBeVisible({ timeout: 20_000 });
}

/**
 * The header Back leaves the detail; the list it opens keeps only the
 * history fallback (it was itself reached by navigation).
 */
async function expectHeaderBackReturnsToList(page: Page): Promise<void> {
    await headerBack(page).click();
    await expect(page).not.toHaveURL(detailUrlPattern);
    await expect(page.locator('app-portal-detail-shell')).toHaveCount(0);
    await expectHistoryBack(page);
}

test.describe('Portal detail header Back', () => {
    test('@xtream @electron keeps Back in the header and the detail columns at full width', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await expectHistoryBack(page);

            const detailUrl = await openFirstSeries(page);
            await expectBackInHeader(page, 'browse');
            await expectHeadingOnOneLine(page);

            await page.setViewportSize({ width: widths[0], height: 800 });
            await startFirstEpisode(page);
            await expectBackInHeader(page, 'watch');
            await expectWidestHeadingOnOneLine(page, detailUrl);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron returns to the list from the header in browse and watch', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);

            await openFirstSeries(page);
            await expectHeaderBackReturnsToList(page);

            await clickFirstGridListCard(page);
            await page.waitForURL(detailUrlPattern);
            await startFirstEpisode(page);
            // Route-level in watch too: it leaves the page, not just the player.
            await expectHeaderBackReturnsToList(page);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron falls back to history where no page offers Back', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            await page.waitForURL(/\/workspace\//);
            const startUrl = page.url();
            // The first page of the session has nowhere to go back to: the
            // slot is empty, not a disabled arrow.
            await expect(headerBack(page)).toHaveCount(0);

            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            const listUrl = page.url();
            await expectHistoryBack(page);

            // On a phone the list's drawer toggle keeps the slot: it is the
            // only way into the categories.
            await page.setViewportSize({ width: 375, height: 800 });
            await expect(page.getByTestId('context-drawer-toggle')).toBeVisible();
            await expect(headerBack(page)).toBeHidden();

            await page.setViewportSize({ width: widths[0], height: 800 });
            await headerBack(page).click();
            await expect(page).toHaveURL(startUrl);
            await expect(headerBack(page)).toHaveCount(0);

            // Forward history is not offered; browser Forward still works and
            // brings the fallback back.
            await page.goForward();
            await expect(page).toHaveURL(listUrl);
            await expectHistoryBack(page);
        } finally {
            await closeElectronApp(app);
        }
    });
});
