/**
 * Named setup actions for capture-release-screenshots.ts — the vocabulary
 * that screenshots.manifest.json steps refer to — plus theme switching and
 * the playlist-id registry the actions navigate with.
 */

import type { Page } from '@playwright/test';

let m3uPlaylistId: string | undefined;
let xtreamPlaylistId: string | undefined;

export function registerPlaylistId(
    provider: 'playlists' | 'xtreams',
    id: string
): void {
    if (provider === 'playlists') {
        m3uPlaylistId = id;
    } else {
        xtreamPlaylistId = id;
    }
}

export function requirePlaylistId(
    provider: 'playlists' | 'xtreams'
): string {
    return requireId(provider);
}

function requireId(provider: 'playlists' | 'xtreams'): string {
    const id = provider === 'playlists' ? m3uPlaylistId : xtreamPlaylistId;

    if (!id) {
        throw new Error(`No captured ${provider} playlist id — seeding failed?`);
    }

    return id;
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export async function applyTheme(
    page: Page,
    theme: 'dark' | 'light'
): Promise<void> {
    await runAction(page, 'open-settings', null);
    const testId = theme === 'dark' ? 'DARK_THEME' : 'LIGHT_THEME';
    const themeButton = page.locator(`[data-test-id="${testId}"]`).first();

    await themeButton.scrollIntoViewIfNeeded();
    await themeButton.click();

    const saveButton = page.locator('[data-test-id="save-settings"]').first();

    if (await saveButton.isEnabled()) {
        await saveButton.click();
        await settleUi(page);
    }

    await page.waitForFunction(
        (expectedTheme) =>
            document.body.classList.contains('dark-theme') ===
            (expectedTheme === 'dark'),
        theme,
        { timeout: 10_000 }
    );
}

/* ------------------------------------------------------------------ */
/* Named setup actions                                                 */
/* ------------------------------------------------------------------ */

export async function runAction(
    page: Page,
    action: string,
    param: string | null
): Promise<void> {
    switch (action) {
        case 'open-settings': {
            await page.locator('a[href$="/workspace/settings"]').first().click();
            await page.waitForURL(/\/workspace\/settings/, { timeout: 15_000 });
            await page
                .locator('[data-test-id="settings-container"]')
                .waitFor({ state: 'visible', timeout: 15_000 });
            return;
        }
        case 'open-dashboard': {
            await page
                .locator('a.brand[href$="/workspace/dashboard"]')
                .first()
                .click();
            await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
            await page
                .locator('[data-test-id="dashboard-hero"]')
                .waitFor({ state: 'visible', timeout: 30_000 });
            await settleUi(page);
            return;
        }
        case 'open-xtream-vod': {
            await openXtreamSection(page, 'vod', param ?? 'Action & Mystery');
            await page.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+/,
                { timeout: 30_000 }
            );
            await page
                .locator('app-content-hero')
                .waitFor({ state: 'visible', timeout: 30_000 });
            await page.waitForTimeout(700);
            return;
        }
        case 'open-xtream-series': {
            await openXtreamSection(page, 'series', param ?? 'Urban Drama');
            await page.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+/,
                { timeout: 30_000 }
            );
            await page
                .locator('app-season-container')
                .waitFor({ state: 'visible', timeout: 30_000 });

            // Season tabs auto-select a season; click the first pill only
            // when no episodes rendered on their own.
            const episode = page
                .locator('.episode-card, .episode-list-item')
                .first();

            if (!(await episode.isVisible().catch(() => false))) {
                await page
                    .locator('.season-tabs__pill, [data-testid="season-dropdown"]')
                    .first()
                    .click();
            }

            await episode.waitFor({ state: 'visible', timeout: 20_000 });
            await page.waitForTimeout(700);
            return;
        }
        case 'open-m3u-groups': {
            const playlistId = requireId('playlists');

            await goHome(page);
            await page
                .locator(`a[href*="/workspace/playlists/${playlistId}"]`)
                .first()
                .click();
            await page.waitForURL(
                (url) => url.href.includes(`/workspace/playlists/${playlistId}/`),
                { timeout: 20_000 }
            );
            await clickHrefSuffix(
                page,
                `/workspace/playlists/${playlistId}/groups`
            );
            await page
                .locator('.group-nav-item')
                .first()
                .waitFor({ state: 'visible', timeout: 20_000 });
            await page.locator('.group-nav-item').first().click();
            // Deliberately no channel click: starting playback would pull a
            // real HLS stream (the mock redirects to a public demo stream),
            // and third-party video frames must never enter a release shot.
            await page
                .locator('[data-test-id="channel-item"]')
                .first()
                .waitFor({ state: 'visible', timeout: 20_000 });
            await page.waitForTimeout(500);
            return;
        }
        default:
            throw new Error(`Unknown setup action: ${action}`);
    }
}

/** Returns to the dashboard via the always-visible brand link. */
async function goHome(page: Page): Promise<void> {
    if (/\/workspace\/dashboard/.test(page.url())) {
        return;
    }

    await page.locator('a.brand[href$="/workspace/dashboard"]').first().click();
    await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
    await settleUi(page);
}

async function openXtreamSection(
    page: Page,
    section: 'vod' | 'series',
    category: string
): Promise<void> {
    // Manifest steps must be order-independent, so every portal action
    // starts from the dashboard, whose sources rail links into the portal.
    await goHome(page);
    await clickHrefSuffix(
        page,
        `/workspace/xtreams/${requireId('xtreams')}/vod`
    );

    if (section !== 'vod') {
        await clickHrefSuffix(
            page,
            `/workspace/xtreams/${requireId('xtreams')}/${section}`
        );
    }

    const item = page
        .locator('app-workspace-context-panel .category-item')
        .filter({ hasText: category })
        .first();

    await item.waitFor({ state: 'visible', timeout: 30_000 });
    await item.click();
    await page.waitForTimeout(600);

    const card = page.locator('.category-content-layout mat-card').first();
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.click();
}

async function clickHrefSuffix(page: Page, suffix: string): Promise<void> {
    await page.locator(`a[href$="${suffix}"]`).first().click();
    // Predicate rather than a RegExp built from the suffix: the value carries
    // playlist ids and path separators, and hand-escaping only some
    // metacharacters is how incomplete-sanitization bugs are born.
    await page.waitForURL((url) => url.href.includes(suffix), {
        timeout: 20_000,
    });
}

export async function settleUi(page: Page): Promise<void> {
    await page
        .locator('.mat-mdc-snack-bar-container')
        .first()
        .waitFor({ state: 'detached', timeout: 10_000 })
        .catch(() => undefined);
    // Park the cursor so no nav item keeps its hover tooltip in frame.
    await page.mouse.move(640, 700);
    await page.evaluate(() => {
        document
            .querySelectorAll(
                '.mat-mdc-snack-bar-container, simple-snack-bar, .mat-mdc-tooltip, .cdk-describedby-message-container'
            )
            .forEach((element) => {
                (element.closest('.cdk-overlay-pane') ?? element).remove();
            });
    });
    await page.waitForTimeout(250);
}


