/** Real navigation and activity for the opt-in cinematic screenshot preset. */
import type { Page } from '@playwright/test';
import {
    type CaptureAction,
    openXtreamSection,
    requirePlaylistId,
} from './capture-navigation-helpers';

export async function seedCinematicActivity(page: Page): Promise<void> {
    const playlistId = requirePlaylistId('xtreams');
    const items = [62003, 62004, 62005, 62006, 62007, 62008, 62009];
    await page.evaluate(
        async ({ playlistId, items }) => {
            const bridge = window.electron;
            if (!bridge?.dbAddFavorite || !bridge.dbSavePlaybackPosition)
                throw new Error('Activity bridge unavailable');
            for (const id of items) {
                const content = await bridge.dbGetContentByXtreamId(
                    id,
                    playlistId,
                    'movie'
                );
                if (!content) throw new Error(`Demo content missing: ${id}`);
                await bridge.dbAddFavorite(content.id, playlistId);
            }
            for (const id of [62004, 62005, 62006]) {
                const content = await bridge.dbGetContentByXtreamId(
                    id,
                    playlistId,
                    'movie'
                );
                if (!content)
                    throw new Error(`Demo resume content missing: ${id}`);
                await bridge.dbAddRecentItem(content.id, playlistId);
                await bridge.dbSavePlaybackPosition(playlistId, {
                    contentXtreamId: id,
                    contentType: 'vod',
                    positionSeconds: 780 + (id - 62004) * 420,
                    durationSeconds: 6840,
                });
            }
            // Fixed activity identities; the hero is pinned by title afterwards.
            for (const [index, id] of [62003, 62002, 62001, 62000].entries()) {
                const content = await bridge.dbGetContentByXtreamId(
                    id,
                    playlistId,
                    'movie'
                );
                if (!content)
                    throw new Error(`Demo resume content missing: ${id}`);
                await bridge.dbAddRecentItem(
                    content.id,
                    playlistId,
                    `http://localhost:3211/assets/marketing/backdrop/${['house-of-tides', 'summer-static', 'the-paper-astronaut', 'black-harbor'][index]}.svg`
                );
                await bridge.dbSavePlaybackPosition(playlistId, {
                    contentXtreamId: id,
                    contentType: 'vod',
                    positionSeconds: [1340, 2040, 940, 1860][index],
                    durationSeconds: 6840,
                });
            }
        },
        { playlistId, items }
    );
}

export async function openCinematicDashboard(page: Page): Promise<void> {
    await page
        .locator('app-workspace-shell-rail a[href$="/workspace/dashboard"]')
        .click();
    const hero = page.locator('[data-test-id="dashboard-hero"]');
    await hero.waitFor({ state: 'visible', timeout: 30_000 });
    await hero.hover();
    const pause = hero.locator('[data-test-id="dashboard-hero-pause"]');
    if (
        (await pause.count()) &&
        (await pause.getAttribute('aria-pressed')) !== 'true'
    )
        await pause.click();
    await hero
        .locator(
            '[data-test-id="dashboard-hero-dot"][aria-label="Show Black Harbor"]'
        )
        .click();
    await page.waitForFunction(
        () => {
            const slide = document.querySelector(
                '[data-test-id="dashboard-hero-slide"]'
            );
            return (
                slide?.querySelector('.hero__title')?.textContent?.trim() ===
                    'Black Harbor' &&
                (slide.querySelector('.hero__description')?.textContent
                    ?.length ?? 0) > 100
            );
        },
        undefined,
        { timeout: 20_000 }
    );
    await page
        .locator('[data-test-id="dashboard-continue-watching-rail"]')
        .waitFor();
    await page.mouse.move(0, 0);
}

export async function openCinematicMovie(page: Page): Promise<void> {
    await openCinematicDashboard(page);
    await page
        .locator('[data-test-id="dashboard-favorite-vod-rail"] .rail__card')
        .filter({ hasText: 'Black Harbor' })
        .locator('a.rail__card-link')
        .click();
    await page.waitForURL(/\/workspace\/global-favorites/, { timeout: 30_000 });
    await page
        .locator('app-content-hero')
        .filter({ hasText: 'Black Harbor' })
        .waitFor();
    await expandSynopsis(page);
}

export async function openCinematicSeries(page: Page): Promise<void> {
    await openXtreamSection(page, 'series', 'Urban Drama', 'Skyline Sentinels');
    await page.locator('app-season-container').waitFor();
    await page
        .locator('.episode-list-item, .episode-card')
        .filter({ hasText: 'The Dawn Shift' })
        .waitFor();
    await expandSynopsis(page);
}

async function expandSynopsis(page: Page): Promise<void> {
    const toggle = page.locator(
        'app-content-hero .details__description-toggle[aria-expanded="false"]'
    );
    if (await toggle.count()) await toggle.click();
}

/** Final frame checks wait for text transitions, font metrics and image decode. */
export async function settleCinematicFrame(
    page: Page,
    slug: string
): Promise<void> {
    await page.mouse.move(0, 0);
    await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
    );
    await page.evaluate(async () => {
        await document.fonts.ready;
        const images = [
            ...document.querySelectorAll<HTMLImageElement>('img'),
        ].filter((image) => {
            const rect = image.getBoundingClientRect();
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.top < innerHeight
            );
        });
        await Promise.all(images.map((image) => image.decode()));
    });
    await page.waitForTimeout(600);
    if (slug === 'dashboard') {
        const title = await page
            .locator('[data-test-id="dashboard-hero-slide"] .hero__title')
            .textContent();
        if (title?.trim() !== 'Black Harbor')
            throw new Error('Cinematic hero changed before capture');
    }
}

export const CINEMATIC_ACTIONS: Readonly<Record<string, CaptureAction>> = {
    'open-cinematic-dashboard': openCinematicDashboard,
    'open-cinematic-movie': openCinematicMovie,
    'open-cinematic-series': openCinematicSeries,
};
