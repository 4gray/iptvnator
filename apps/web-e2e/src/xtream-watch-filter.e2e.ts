import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

test.use({ serviceWorkers: 'block' });

async function chooseWatchStatus(page: Page, status: string): Promise<void> {
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    const trigger = page.getByRole('menuitem', { name: /Watch status/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page
        .getByRole('menuitemradio', { name: status, exact: true })
        .click();
    await expect(
        page.locator('.cdk-overlay-pane .mat-mdc-menu-panel')
    ).toHaveCount(0);
}

test('@web @pwa @xtream @persistence filters movies after manual marks and detail return', async ({
    page,
    request,
}) => {
    test.setTimeout(120_000);
    await request.post(`${MOCK_SERVER}/reset`);
    await configureMockProviderBackend(page);
    await interceptXtreamRequests(page);
    await page.goto('/');
    await addXtreamPortal(page, { username: 'minimal', password: 'minimal' });
    const cards = page.locator('app-grid-list mat-card');
    await expect(cards.first()).toBeVisible();
    const title = await cards.first().locator('.title').innerText();
    const catalogUrl = page.url();
    await cards.first().click();
    const watched = page.getByTestId('vod-watched-toggle');
    await expect(watched).toBeEnabled();
    const movieId = Number(new URL(page.url()).pathname.split('/').pop());
    const playlistId = new URL(catalogUrl).pathname.match(
        /xtreams\/([^/]+)/
    )?.[1];
    expect(playlistId).toBeTruthy();
    await watched.click();
    await expect(watched).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-test-id="workspace-header-back"]').click();
    await expect(page).toHaveURL(catalogUrl);
    await chooseWatchStatus(page, 'Watched');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(title);
    const chip = page.getByRole('button', {
        name: 'Clear watch status filter: Watched',
        exact: true,
    });
    await expect(chip).toBeVisible();

    for (const [width, height] of [
        [1280, 800],
        [780, 600],
        [375, 812],
    ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    )
                )
        );
        const closeDrawer = page.locator(
            '[data-test-id="context-drawer-close"]'
        );
        if (
            await page
                .locator('app-workspace-shell-context-sidebar.drawer-open')
                .count()
        ) {
            await closeDrawer.click();
            await expect(closeDrawer).toBeHidden();
        }
        for (const theme of ['light', 'dark']) {
            await page.evaluate((value) => {
                document.body.classList.toggle('dark-theme', value === 'dark');
                document.body.classList.toggle(
                    'light-theme',
                    value === 'light'
                );
            }, theme);
            await expect(chip).toBeInViewport();
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth
                )
            ).toBe(true);
            await expect(
                page.getByRole('button', { name: 'Refine', exact: true })
            ).toBeVisible();
            await page.screenshot({
                animations: 'disabled',
                path: test
                    .info()
                    .outputPath(`watch-filter-${width}-${theme}.png`),
            });
        }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await expect(cards.first()).toBeVisible();
    await expect(chip).toHaveCount(0);
    await chooseWatchStatus(page, 'Watched');
    await expect(cards).toHaveCount(1);
    await cards.first().click();
    await expect(watched).toHaveAttribute('aria-pressed', 'true');
    await watched.click();
    await expect(watched).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-test-id="workspace-header-back"]').click();
    await expect(page).toHaveURL(catalogUrl);
    await expect(
        page.getByText('No movies match this watch status', { exact: true })
    ).toBeVisible();
    await page
        .getByRole('button', { name: 'Clear watch status', exact: true })
        .click();
    await expect(cards.first()).toBeVisible();
    await chooseWatchStatus(page, 'Unwatched');
    await expect(cards.first()).toContainText(title);
    await chooseWatchStatus(page, 'In progress');
    await expect(
        page.getByText('No movies match this watch status', { exact: true })
    ).toBeVisible();
    await page.evaluate(
        ({ id, contentId }) => {
            const positions = JSON.parse(
                localStorage.getItem('xtream-playback-positions') ?? '{}'
            );
            const row = {
                contentType: 'vod',
                contentXtreamId: contentId,
                positionSeconds: 30,
                durationSeconds: 100,
            };
            positions[id] = [{ ...row, playlistId: id }];
            positions['foreign-source'] = [
                { ...row, playlistId: 'foreign-source', positionSeconds: 100 },
            ];
            localStorage.setItem(
                'xtream-playback-positions',
                JSON.stringify(positions)
            );
        },
        { id: playlistId!, contentId: movieId }
    );
    await page.reload();
    await expect(cards.first()).toBeVisible();
    await chooseWatchStatus(page, 'In progress');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(title);
    await chooseWatchStatus(page, 'Watched');
    await expect(
        page.getByText('No movies match this watch status', { exact: true })
    ).toBeVisible();
});
