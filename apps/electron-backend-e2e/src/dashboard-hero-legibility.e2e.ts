import type { Locator, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import sharp = require('sharp');
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    goToDashboard,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getXtreamTitle,
} from './portal-mock-fixtures';
import { applyTheme, measureBackdropTextContrast } from './theme-contrast';
import {
    addCurrentDetailToFavorites,
    goBackFromDetail,
    toggleFavoriteForChannel,
} from './dashboard-e2e-flows';

// ---------------------------------------------------------------------------
// The dashboard hero's text must stay legible over any artwork, in both
// themes and in the narrow layout where the slide spans the whole width.
// Every mock image is replaced by a black-and-white checkerboard, the worst
// case for either theme's scrim; series images fail, so the favourited
// series falls back to the generated gradient. Each slide kind (16:9
// backdrop, blurred poster, no artwork, live channel) is measured from the
// screen at a wide and a narrow content width.
// ---------------------------------------------------------------------------

type SlideKind = 'backdrop' | 'poster' | 'fallback' | 'live';

const widths = { wide: 1280, narrow: 760 } as const;
const minimumContrast = 4.5;
const xtreamCredentials = {
    username: defaultXtreamUsername,
    password: defaultXtreamPassword,
};
/** A full TMDB slide has a rating and a two-line overview; the mock has no
 * TMDB, so the measurement adds both, styled by the hero's own rules. */
const sampleOverview =
    'A long synopsis that wraps onto a second line, so the body text of a ' +
    'fully enriched slide is measured where it really sits over the artwork.';

async function busyArtwork(): Promise<Buffer> {
    const width = 1280;
    const height = 720;
    const square = 40;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const white =
                (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0;
            pixels.fill(
                white ? 255 : 0,
                (y * width + x) * 3,
                (y * width + x) * 3 + 3
            );
        }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer();
}

/** Serves the checkerboard for every mock image except series artwork,
 * which fails: an image the page has already shown is reused from memory,
 * so the failure has to be in place before the series is first opened. */
async function routeArtwork(page: Page): Promise<void> {
    const image = await busyArtwork();
    await page.route(
        (url) => url.hostname === 'picsum.photos',
        (route) =>
            /\/seed\/series-/.test(route.request().url())
                ? route.fulfill({ status: 404, body: '' })
                : route.fulfill({
                      status: 200,
                      contentType: 'image/png',
                      body: image,
                  })
    );
}

async function slideKinds(page: Page): Promise<SlideKind[]> {
    return page.locator('.hero__backdrop').evaluateAll((backdrops) =>
        backdrops.map((backdrop): SlideKind => {
            if (backdrop.classList.contains('hero__backdrop--live')) {
                return 'live';
            }
            if (!backdrop.querySelector('.hero__backdrop-image')) {
                return 'fallback';
            }
            return backdrop.classList.contains('hero__backdrop--poster')
                ? 'poster'
                : 'backdrop';
        })
    );
}

async function showSlide(page: Page, index: number): Promise<Locator> {
    const dot = page.getByTestId('dashboard-hero-dot').nth(index);
    await dot.click();
    await expect(dot).toHaveAttribute('aria-current', 'true');
    // The backdrop crossfade and the slide's entrance have finished (not the
    // image's slow zoom, which never changes what is under the text).
    await expect
        .poll(() =>
            page.evaluate(() =>
                [
                    document.querySelector('.hero__backdrop--active'),
                    document.querySelector('.hero__content'),
                ].every(
                    (element) =>
                        element &&
                        element
                            .getAnimations()
                            .every(
                                (animation) => animation.playState !== 'running'
                            )
                )
            )
        )
        .toBe(true);
    return page.getByTestId('dashboard-hero-slide');
}

/** Sum of non-input layout shifts while the hero runs through every slide
 * on its own, at a shortened interval. */
async function rotationLayoutShift(page: Page): Promise<number> {
    const hero = page.getByTestId('dashboard-hero');
    const dots = page.getByTestId('dashboard-hero-dot');
    const count = await dots.count();
    await page.mouse.move(1, 1);
    await hero.evaluate((element) => {
        (element as HTMLElement).style.setProperty(
            '--hero-rotation-ms',
            '600ms'
        );
        const shifts: number[] = [];
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
            })[]) {
                if (!entry.hadRecentInput) {
                    shifts.push(entry.value);
                }
            }
        }).observe({ type: 'layout-shift' });
        (window as unknown as { __heroShifts: number[] }).__heroShifts = shifts;
    });
    // Back to the first slide after one full cycle, then a quiet moment.
    const first = await dots.evaluateAll((all) =>
        all.findIndex((dot) => dot.getAttribute('aria-current') === 'true')
    );
    for (let step = 1; step <= count; step++) {
        await expect(dots.nth((first + step) % count)).toHaveAttribute(
            'aria-current',
            'true',
            { timeout: 5_000 }
        );
    }
    await page.waitForTimeout(500);
    return page.evaluate(() =>
        (window as unknown as { __heroShifts: number[] }).__heroShifts.reduce(
            (sum, value) => sum + value,
            0
        )
    );
}

/** Adds what a TMDB-enriched slide shows: a rating chip and an overview. */
async function enrichSlide(slide: Locator): Promise<void> {
    await slide.evaluate((content, overview) => {
        const chip = content.querySelector('.hero__pill');
        if (chip) {
            const rating = chip.cloneNode() as HTMLElement;
            rating.classList.add('meta-chip--rating');
            rating.textContent = '★ 7.4';
            chip.before(rating);
        }
        // The overview takes the title's view encapsulation attribute, so the
        // hero's `.hero__description` rule styles it.
        const title = content.querySelector('.hero__title');
        const scope = Array.from(title?.attributes ?? []).find((attribute) =>
            attribute.name.startsWith('_ngcontent')
        );
        const actions = content.querySelector('.hero__actions');
        if (scope && actions && !content.querySelector('.hero__description')) {
            const description = document.createElement('p');
            description.setAttribute(scope.name, '');
            description.className = 'hero__description';
            description.textContent = overview;
            actions.before(description);
        }
    }, sampleOverview);
    await expect(slide.locator('.hero__description')).toHaveCount(1);
}

/** Every piece of slide text a viewer reads, one element per colour. */
function slideTexts(slide: Locator): Record<string, Locator> {
    return {
        eyebrow: slide.locator('.hero__eyebrow > span:not(.hero__eyebrow-sep)'),
        title: slide.locator('.hero__title'),
        pill: slide.locator('.hero__pill'),
        programme: slide.locator('.hero__programme'),
        description: slide.locator('.hero__description'),
        button: slide.locator('.hero__button > span'),
    };
}

test.describe('Dashboard hero legibility', () => {
    test('keeps slide text at 4.5:1 over any artwork in both themes and widths', async ({
        dataDir,
        request,
    }, testInfo) => {
        test.setTimeout(240_000);
        await resetMockServers(request, ['xtream']);
        const live = await fetchXtreamLiveFixture(request, xtreamCredentials);
        const vod = await fetchXtreamVodFixture(request, xtreamCredentials);
        const series = await fetchXtreamSeriesFixture(
            request,
            xtreamCredentials
        );
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        const results: string[] = [];

        try {
            await routeArtwork(page);
            await page.setViewportSize({ width: widths.wide, height: 800 });
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);

            // Live slide: a favourite channel with a programme on air.
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, live.categoryName);
            await toggleFavoriteForChannel(page, getXtreamTitle(live.items[0]));
            // Backdrop slide: favouriting from the detail page stores the
            // movie's 16:9 backdrop.
            await page
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(page, vod.categoryName);
            await clickFirstGridListCard(page);
            await addCurrentDetailToFavorites(page);
            await goBackFromDetail(page);
            // No-artwork slide: series images fail, poster and backdrop.
            await page
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryByNameExact(page, series.categoryName);
            await clickFirstGridListCard(page);
            await addCurrentDetailToFavorites(page);

            await goToDashboard(page);
            await expect(page.getByTestId('dashboard-hero')).toBeVisible({
                timeout: 20_000,
            });
            // Poster-only slides come from the Xtream "recently added" list.
            await expect
                .poll(async () => [...new Set(await slideKinds(page))].sort(), {
                    timeout: 20_000,
                })
                .toEqual(['backdrop', 'fallback', 'live', 'poster']);

            // One stable page heading; the rotating slide title is an h2.
            await expect(page.locator('h1')).toHaveCount(1);
            await expect(page.getByTestId('dashboard-page-heading')).toHaveText(
                'Dashboard'
            );
            await expect(
                page
                    .getByTestId('dashboard-hero-slide')
                    .locator('h2.hero__title')
            ).toHaveCount(1);

            // An unattended rotation, counted like the launch journey's
            // settled layout-shift counter (non-input shifts only). Slides of
            // different heights still resize the hero by a few pixels and
            // move the rails below (0.005 here, 0.013 before this change);
            // a scrim or heading that reflowed the slide would add lines.
            const shift = await rotationLayoutShift(page);
            results.push(`rotation layout shift ${shift.toFixed(3)}`);
            expect(shift).toBeLessThan(0.02);

            await page.getByTestId('dashboard-hero-pause').click();
            const kinds = await slideKinds(page);
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                for (const [layout, width] of Object.entries(widths)) {
                    await page.setViewportSize({ width, height: 800 });
                    // The narrow layout is the dashboard container's
                    // ≤720px query, not the window width.
                    const narrow = await page
                        .locator('.hero__content')
                        .evaluate(
                            (content) =>
                                getComputedStyle(content).maxWidth === 'none'
                        );
                    expect(narrow).toBe(layout === 'narrow');
                    for (const [index, kind] of kinds.entries()) {
                        const slide = await showSlide(page, index);
                        await enrichSlide(slide);
                        await page.mouse.move(1, 1);
                        const name = `${theme}-${layout}-${kind}`;
                        const shot = testInfo.outputPath(`hero-${name}.png`);
                        await page
                            .getByTestId('dashboard-hero')
                            .screenshot({ path: shot });
                        await testInfo.attach(name, {
                            path: shot,
                            contentType: 'image/png',
                        });
                        for (const [part, texts] of Object.entries(
                            slideTexts(slide)
                        )) {
                            for (const text of await texts.all()) {
                                const ratio = await measureBackdropTextContrast(
                                    page,
                                    text
                                );
                                results.push(
                                    `${name} ${part} ${ratio.toFixed(2)}`
                                );
                                expect
                                    .soft(ratio, `${name} ${part}`)
                                    .toBeGreaterThanOrEqual(minimumContrast);
                            }
                        }
                    }
                }
            }
        } finally {
            const report = testInfo.outputPath('contrast.txt');
            writeFileSync(report, results.join('\n'));
            await testInfo.attach('contrast', {
                path: report,
                contentType: 'text/plain',
            });
            await closeElectronApp(app);
        }
    });
});
