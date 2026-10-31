import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';

test.use({ serviceWorkers: 'block' });

test('@web @pwa @stalker keeps sparse filtered pages reachable in a wide grid without a scrollbar', async ({
    page,
}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 2560, height: 1200 });
    await configureMockProviderBackend(page);
    await interceptStalkerRequests(page);
    const rows = Array.from({ length: 280 }, (_, i) => ({
        id: String(i + 1),
        name: `Sparse movie ${i + 1}`,
        cmd: `ffmpeg http://media.example/${i + 1}.mp4`,
        category_id: '1',
    }));
    await page.route('**/stalker?**', async (route) => {
        const url = new URL(route.request().url());
        if (
            url.searchParams.get('action') !== 'get_ordered_list' ||
            url.searchParams.get('type') !== 'vod'
        )
            return route.fallback();
        const index = Number(url.searchParams.get('p') ?? 1);
        return route.fulfill({
            json: {
                payload: {
                    js: {
                        data: rows.slice((index - 1) * 14, index * 14),
                        total_items: rows.length,
                    },
                },
            },
        });
    });
    await page.goto('/');
    await addStalkerPortal(page, {
        name: 'Sparse watch results',
        mac: '00:1A:79:AF:10:04',
    });
    const grid = page.locator('app-grid-list');
    const cards = grid.locator('mat-card');
    await expect(cards.first()).toBeVisible();
    const id = new URL(page.url()).pathname.match(/stalker\/([^/]+)/)?.[1];
    expect(id).toBeTruthy();
    await page.evaluate((playlistId) => {
        const positions = Array.from({ length: 280 }, (_, i) => i + 1)
            .filter((id) => id % 14 !== 0)
            .map((id) => ({
                playlistId,
                contentType: 'vod',
                contentXtreamId: id,
                positionSeconds: 100,
                durationSeconds: 100,
            }));
        localStorage.setItem(
            'xtream-playback-positions',
            JSON.stringify({ [playlistId]: positions })
        );
    }, id as string);
    await page.reload();
    await expect(cards.first()).toBeVisible();
    await toggleFilter(page);
    const more = grid.getByRole('button', { name: 'Load more', exact: true });
    await expect(more).toBeVisible();
    expect(await cards.count()).toBeLessThan(20);
    expect(
        await grid.evaluate(
            (element) => element.scrollHeight <= element.clientHeight
        )
    ).toBe(true);
    // Manual continuation must remain possible whenever the height guard fires,
    // even though every server page added a visible movie and the hidden-page
    // budget therefore never paused the scan itself.
    for (let batch = 0; batch < 20 && (await cards.count()) < 20; batch++) {
        const before = await cards.count();
        await more.click();
        await expect.poll(() => cards.count()).toBeGreaterThan(before);
        await expect
            .poll(
                async () =>
                    (await cards.count()) === 20 || (await more.isVisible())
            )
            .toBe(true);
    }
    await expect(cards).toHaveCount(20);
    await expect(cards.last()).toContainText('Sparse movie 280');
    await expect(more).toBeHidden();
});

async function toggleFilter(page: Page) {
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    const checkbox = page.getByRole('menuitemcheckbox', {
        name: 'Hide watched',
        exact: true,
    });
    await expect(checkbox).toBeEnabled();
    await checkbox.click();
}

test('@web @pwa @stalker @persistence hides manually watched movies after detail return and restores them without catalog requests', async ({
    page,
}) => {
    test.setTimeout(120_000);
    await configureMockProviderBackend(page);
    await interceptStalkerRequests(page);
    await page.goto('/');
    await addStalkerPortal(page, {
        name: 'Hide watched manual',
        mac: '00:1A:79:AF:10:01',
    });
    const cards = page.locator('app-grid-list mat-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveAttribute('aria-label', /\S/);
    const title = (await cards.first().getAttribute('aria-label')) as string;
    await toggleFilter(page);
    await cards.first().click();
    const watched = page.getByTestId('vod-watched-toggle');
    await expect(watched).toBeEnabled();
    await watched.click();
    await expect(watched).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('app-grid-list')).toHaveCount(0);
    await page.locator('[data-test-id="workspace-header-back"]').click();
    await expect(cards.first()).toBeVisible();
    await expect(
        page
            .locator('app-grid-list')
            .getByRole('button', { name: title, exact: true })
    ).toHaveCount(0);
    let catalogRequests = 0;
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (
            url.pathname.endsWith('/stalker') &&
            url.searchParams.get('action') === 'get_ordered_list'
        )
            catalogRequests++;
    });
    await page
        .getByRole('button', { name: 'Clear hide watched filter', exact: true })
        .click();
    await expect(
        page
            .locator('app-grid-list')
            .getByRole('button', { name: title, exact: true })
    ).toHaveCount(1);
    expect(catalogRequests).toBe(0);
});

test('@web @pwa @stalker paginates completed-only pages with a bounded pause, retries the same failed page and reaches later movies', async ({
    page,
}) => {
    test.setTimeout(120_000);
    await configureMockProviderBackend(page);
    await interceptStalkerRequests(page);
    const pages: number[] = [];
    let failPage: number | null = null;
    const rows = Array.from({ length: 127 }, (_, i) => ({
        id: String(i + 1),
        name: `Filter movie ${String(i + 1).padStart(3, '0')}`,
        cmd: `ffmpeg http://media.example/${i + 1}.mp4`,
        category_id: '1',
    }));
    await page.route('**/stalker?**', async (route) => {
        const url = new URL(route.request().url());
        if (
            url.searchParams.get('action') !== 'get_ordered_list' ||
            url.searchParams.get('type') !== 'vod'
        )
            return route.fallback();
        const index = Number(url.searchParams.get('p') ?? 1);
        pages.push(index);
        if (failPage === index) {
            failPage = null;
            return route.fulfill({ status: 503, body: 'Unavailable' });
        }
        return route.fulfill({
            json: {
                payload: {
                    js: {
                        data: rows.slice((index - 1) * 14, index * 14),
                        total_items: rows.length,
                    },
                },
            },
        });
    });
    await page.goto('/');
    await addStalkerPortal(page, {
        name: 'Hide watched paging',
        mac: '00:1A:79:AF:10:02',
    });
    const cards = page.locator('app-grid-list mat-card');
    await expect(cards.first()).toBeVisible();
    const playlistId = new URL(page.url()).pathname.match(
        /stalker\/([^/]+)/
    )?.[1];
    expect(playlistId).toBeTruthy();
    await page.evaluate((id) => {
        const positions = Array.from({ length: 126 }, (_, i) => ({
            playlistId: id,
            contentType: 'vod',
            contentXtreamId: i + 1,
            positionSeconds: 100,
            durationSeconds: 100,
        }));
        localStorage.setItem(
            'xtream-playback-positions',
            JSON.stringify({ [id]: positions })
        );
    }, playlistId as string);
    await page.reload();
    await expect(cards.first()).toBeVisible();
    const before = pages.length;
    await toggleFilter(page);
    const more = page.getByRole('button', { name: 'Load more', exact: true });
    await expect(more).toBeVisible();
    await expect(cards).toHaveCount(0);
    expect(pages.length - before).toBeLessThanOrEqual(3);
    await expect(
        page.getByText('No matching movies in loaded items.', { exact: true })
    ).toBeVisible();
    failPage = pages[pages.length - 1] + 1;
    const failedIndex = failPage;
    await more.click();
    const retry = page.locator('.grid-list__tail--error button');
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toBeHidden();
    await expect
        .poll(() => pages.filter((index) => index === failedIndex))
        .toHaveLength(2);
    // Several manual batches may be needed; each is bounded independently.
    for (let batch = 0; batch < 4; batch++) {
        await expect
            .poll(
                async () =>
                    (await more.isVisible()) || (await cards.count()) > 0
            )
            .toBe(true);
        if (await cards.count()) break;
        const previousRequests = pages.length;
        await more.click();
        await expect.poll(() => pages.length).toBeGreaterThan(previousRequests);
        await expect
            .poll(
                async () =>
                    (await page
                        .locator('.grid-list__tail mat-spinner')
                        .count()) === 0 &&
                    ((await more.isVisible()) || (await cards.count()) > 0)
            )
            .toBe(true);
    }
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Filter movie 127');
    await expect(page.locator('.category-subtitle')).toContainText('Shown 1');
    await expect(more).toBeHidden();
    for (const [width, theme] of [
        [1280, 'light'],
        [780, 'dark'],
        [375, 'light'],
    ] as const) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(
            (value) =>
                document.body.classList.toggle('dark-theme', value === 'dark'),
            theme
        );
        await expect(
            page.getByRole('button', { name: 'Refine', exact: true })
        ).toBeInViewport();
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        ).toBe(true);
        await page.screenshot({
            animations: 'disabled',
            path: test
                .info()
                .outputPath(`stalker-hide-watched-${width}-${theme}.png`),
        });
    }
});
