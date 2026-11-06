import { expect, test } from './fixtures';
import axe from 'axe-core';
import { expectNavigationFocus } from './navigation-focus.fixture';
import { pressTab } from './e2e-helpers';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';

test.use({ serviceWorkers: 'block' });

function headerGeometry(element: HTMLElement) {
    const button = element.querySelector('.overview-restore');
    const title = element.querySelector('h2');
    if (!button || !title)
        throw new Error('Overview header controls are missing');
    const b = button.getBoundingClientRect();
    const t = title.getBoundingClientRect();
    return {
        overlaps:
            b.left < t.right &&
            t.left < b.right &&
            b.top < t.bottom &&
            t.top < b.bottom,
        overflows: document.documentElement.scrollWidth > innerWidth,
    };
}

test.beforeEach(async ({ page }) => {
    await configureMockProviderBackend(page);
    await interceptStalkerRequests(page);
    await page.goto('/');
    await addStalkerPortal(page, {
        name: 'Live overview',
        mac: '00:1A:79:00:00:07',
    });
});

test('@stalker @epg overview loads programmes before category selection and shares them between grid and list', async ({
    page,
}, testInfo) => {
    let bulkRequests = 0;
    page.on('request', (request) => {
        if (request.url().includes('action=get_epg_info')) bulkRequests++;
    });
    await page.getByRole('link', { name: /live|itv/i }).click();
    const overview = page.locator('app-stalker-itv-all-items');
    const firstTitle = overview.locator('mat-card .grid-epg-title').first();
    await expect(firstTitle).not.toHaveText(/Loading|No program information/);
    await expect(firstTitle).not.toBeEmpty();
    expect(bulkRequests).toBe(1);
    const title = await firstTitle.innerText();
    const channel = await overview
        .locator('mat-card .title')
        .first()
        .innerText();

    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
        const engine = (
            window as typeof window & { axe: typeof import('axe-core') }
        ).axe;
        return (await engine.run('app-stalker-itv-all-items')).violations;
    });
    expect(violations).toEqual([]);

    await overview.locator('[data-view-mode="list"] button').click();
    await expect(overview.locator('.channel-name').first()).toHaveText(channel);
    await expect(overview.locator('.epg-title').first()).toHaveText(title);
    await expect(overview.locator('.channel-list-item').first()).toHaveCSS(
        'height',
        '68px'
    );
    const listViolations = await page.evaluate(async () => {
        const engine = (
            window as typeof window & { axe: typeof import('axe-core') }
        ).axe;
        return (await engine.run('app-stalker-itv-all-items')).violations;
    });
    expect(listViolations).toEqual([]);
    await page.reload();
    await expect(overview.locator('.epg-title').first()).toHaveText(title);
    await expect(overview.locator('mat-card')).toHaveCount(0);
    await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('overview-list.png'),
    });

    await overview.locator('[data-view-mode="grid"] button').click();
    await expect(overview.locator('.grid-epg-title').first()).toHaveText(title);
    await page
        .getByRole('button', { name: 'Hide channels list', exact: true })
        .click();
    await expect(overview.locator('.overview-restore')).toBeVisible();
    await expect(
        page.locator('.content-container > .sidebar-restore')
    ).toHaveCount(0);

    for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 960 });
        await expect
            .poll(() => overview.evaluate(headerGeometry))
            .toEqual({ overlaps: false, overflows: false });
        await expect(
            overview.locator('mat-card .card-thumbnail-container').first()
        ).toHaveCSS('height', '72px');
        await expect(
            overview.locator('mat-card .card-thumbnail-container').first()
        ).toHaveCSS('border-bottom-left-radius', '0px');
        await expect(overview.locator('mat-card .title').first()).toHaveCSS(
            'font-size',
            '14px'
        );
        await expect(overview.locator('mat-card .title').first()).toHaveCSS(
            'height',
            '20px'
        );
        const textGap = await overview
            .locator('mat-card')
            .first()
            .evaluate((e) => {
                const title = e.querySelector('.title');
                const epg = e.querySelector('.grid-epg');
                if (!title || !epg) throw new Error('Channel text is missing');
                return (
                    epg.getBoundingClientRect().top -
                    title.getBoundingClientRect().bottom
                );
            });
        expect(textGap).toBe(8);
        await expect(
            overview.locator('mat-card .grid-epg-title').first()
        ).toHaveCSS('font-size', '12px');
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    for (const dark of [false, true]) {
        await page.evaluate((dark) => {
            document.body.classList.toggle('dark-theme', dark);
            document.body.classList.toggle('light-theme', !dark);
        }, dark);
        const card = overview.locator('mat-card').first();
        await page.mouse.move(0, 0);
        const background = await card.evaluate(
            (e) => getComputedStyle(e).backgroundColor
        );
        await card.hover();
        await expect(card).not.toHaveCSS('background-color', background);
        await expect(card).toHaveCSS('transform', 'none');
        await expect(card).toHaveCSS('box-shadow', 'none');
        await card.focus();
        await page.keyboard.press('Tab');
        const nextCard = overview.locator('mat-card').nth(1);
        await expect(nextCard).toBeFocused();
        await expect(nextCard).toHaveCSS('outline-width', '2px');
        await expect(nextCard).toHaveCSS('outline-style', 'solid');
        await expect(nextCard).toHaveCSS('outline-offset', '3px');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(
                `overview-grid-${dark ? 'dark' : 'light'}.png`
            ),
        });
    }
});

for (const theme of ['light', 'dark']) {
    test(`@stalker live sidebar header reaches the divider (${theme})`, async ({
        page,
        browserName,
    }, testInfo) => {
        await page.getByRole('link', { name: /live|itv/i }).click();
        await page.locator('.context-panel .category-item').nth(1).click();
        const sidebar = page.locator('app-stalker-live-stream-layout .sidebar');
        await expect(sidebar.locator('.channel-name').first()).toBeVisible();
        await page.evaluate((dark) => {
            document.body.classList.toggle('dark-theme', dark);
            document.body.classList.toggle('light-theme', !dark);
        }, theme === 'dark');

        const selected = page.locator(
            '.context-panel .category-item[aria-current="true"]'
        );
        await selected.focus();
        await pressTab(page, browserName);
        await pressTab(page, browserName, 'backward');
        await expectNavigationFocus(selected);

        for (const width of [1280, 360]) {
            await page.setViewportSize({ width, height: 800 });
            const gap = await sidebar.evaluate((el) => {
                const header = el.querySelector('.sidebar-header');
                if (!header) throw new Error('Missing sidebar header');
                return (
                    el.getBoundingClientRect().right -
                    parseFloat(getComputedStyle(el).borderRightWidth) -
                    header.getBoundingClientRect().right
                );
            });
            expect(Math.abs(gap)).toBeLessThanOrEqual(1);
            await sidebar.screenshot({
                path: testInfo.outputPath(`live-sidebar-${theme}-${width}.png`),
                animations: 'disabled',
            });
        }
    });
}

test('@stalker loading reserves logo-card geometry and respects reduced motion in both modes', async ({
    page,
}) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/localhost:3000/stalker**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'get_all_channels'
        )
            await held;
        await route.fallback();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('link', { name: /live|itv/i }).click();
    const overview = page.locator('app-stalker-itv-all-items');
    const thumb = overview.locator('.grid-skeleton-thumb').first();
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveCSS('height', '72px');
    await expect(thumb).toHaveCSS('border-top-left-radius', '11px');
    await expect(thumb).toHaveCSS('border-bottom-left-radius', '0px');
    await expect(
        overview.locator('.grid-skeleton-title').first().locator('span:visible')
    ).toHaveCount(1);
    expect(
        await thumb.evaluate(
            (e) => getComputedStyle(e, '::after').animationName
        )
    ).toBe('none');
    const cardBefore = await overview
        .locator('.grid-skeleton-card')
        .first()
        .evaluate((e) => e.getBoundingClientRect().toJSON());
    await overview.locator('[data-view-mode="list"] button').click();
    await expect(overview.locator('app-channel-list-skeleton')).toBeVisible();
    await overview.locator('[data-view-mode="grid"] button').click();
    release();
    const card = overview.locator('mat-card').first();
    await expect(card).toBeVisible();
    const after = await card.evaluate((e) =>
        e.getBoundingClientRect().toJSON()
    );
    expect(Math.abs(cardBefore.height - after.height)).toBeLessThanOrEqual(2);
    await expect(overview.locator('.all-items-content')).toHaveAttribute(
        'aria-busy',
        'false'
    );
});
