import { expect, type Page } from '@playwright/test';

/** Category scope, independent fullscreen search and playback continuity (#1543). */
export async function verifyStalkerCategorySearch(page: Page): Promise<void> {
    const sidebarSearch = page.locator('input[type="search"]').first();
    const categories = page.locator('.category-item');
    const sidebarRows = page.locator(
        '#live-channels [data-test-id="channel-item"]'
    );
    await sidebarSearch.fill('TV');
    await sidebarSearch.press('Enter');
    await expect(page).toHaveURL(/q=TV/);
    await expect(sidebarRows).toHaveCount(40);
    const firstNames = await sidebarRows
        .locator('.channel-name')
        .allTextContents();
    // All Items already started playback earlier in this workflow. Retain that
    // settled selection; clicking again would introduce a pending replacement.
    const player = page.locator('app-web-player-view');
    await expect(player).toBeVisible();
    const video = player.locator('video').first();
    const videoNode = await video.elementHandle();
    const playerNode = await player.elementHandle();

    await player.hover();
    await player.getByRole('button', { name: 'Enter fullscreen' }).click();
    await page
        .locator('[data-test-id="fullscreen-channel-panel-hot-zone"]')
        .hover();
    const panel = page.locator('[data-test-id="fullscreen-channel-panel"]');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    const panelSearch = panel.getByRole('searchbox');
    const panelRows = panel.locator('[data-test-id="channel-item"]');
    await panelSearch.fill('TV');
    await expect(panelRows).toHaveCount(40);
    await expect(panelRows.locator('.channel-name')).toHaveText(firstNames);
    await panelSearch.fill(firstNames[30].trim());
    await expect(panelRows).toHaveCount(1);
    await expect(sidebarSearch).toHaveValue('TV');
    await expect(sidebarRows).toHaveCount(40);
    await page.evaluate(() => document.exitFullscreen());

    // Navigation retains the applied term and playing engine, including a channel
    // outside the new category. Its separate selection UX is tracked in #1520.
    await categories.nth(2).click();
    await expect(sidebarSearch).toHaveValue('TV');
    await expect(sidebarRows).toHaveCount(40);
    await expect
        .poll(async () => {
            const names = await sidebarRows
                .locator('.channel-name')
                .allTextContents();
            return names.every((name) => !firstNames.includes(name));
        })
        .toBe(true);
    expect(await playerNode?.evaluate((element) => element.isConnected)).toBe(
        true
    );
    expect(await videoNode?.evaluate((element) => element.isConnected)).toBe(
        true
    );

    await sidebarSearch.fill('');
    await sidebarSearch.press('Enter');
    await expect(page).not.toHaveURL(/q=/);
    await expect(sidebarRows).toHaveCount(40);
    // The category-to-channel keyboard hand-off still targets the sidebar.
    await categories.nth(2).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#live-channels')).toBeFocused();

    await categories.first().click();
    await sidebarSearch.fill('TV');
    await sidebarSearch.press('Enter');
    await expect(page).toHaveURL(/q=TV/);
    // Explicit All Items is a window over all 320 public channels.
    await expect(page.locator('.category-subtitle').first()).toContainText(
        '320'
    );
}

/** A category absent from get_all_channels must page for a late local match. */
export async function verifyUncachedStalkerSearch(
    page: Page,
    mockServer: string
): Promise<void> {
    const response = await page.request.get(`${mockServer}/stalker`, {
        params: {
            url: `${mockServer}/portal.php`,
            action: 'get_ordered_list',
            type: 'itv',
            genre: '1099',
            category: '1099',
            p: '3',
            macAddress: '00:1A:79:00:00:01',
        },
    });
    const body = await response.json();
    const lateName = String(body.payload.js.data[0].name);
    const search = page.locator('input[type="search"]').first();
    const requests: URL[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.searchParams.get('genre') === '1099') requests.push(url);
    });
    await search.fill(lateName);
    await search.press('Enter');
    await expect(page.locator('#live-channels .channel-name')).toHaveText(
        [lateName],
        { timeout: 20_000 }
    );
    expect(requests.some((url) => Number(url.searchParams.get('p')) >= 3)).toBe(
        true
    );
    expect(requests.every((url) => !url.searchParams.has('search'))).toBe(true);
    await search.fill('TV');
    await search.press('Enter');
    await expect(page).toHaveURL(/q=TV/);
    await expect(
        page.locator('#live-channels [data-test-id="channel-item"]')
    ).toHaveCount(40);
    await verifyStalkerPanelCategory(page, search);
}

async function verifyStalkerPanelCategory(
    page: Page,
    search: ReturnType<Page['locator']>
): Promise<void> {
    const rows = page.locator('#live-channels [data-test-id="channel-item"]');
    const names = await rows.locator('.channel-name').allTextContents();
    await rows.first().click();
    await search.fill(names[0].trim());
    await search.press('Enter');
    await expect(rows).toHaveCount(1);
    const player = page.locator('app-web-player-view');
    await player.hover();
    await player.getByRole('button', { name: 'Enter fullscreen' }).click();
    await page
        .locator('[data-test-id="fullscreen-channel-panel-hot-zone"]')
        .hover();
    const panel = page.locator('[data-test-id="fullscreen-channel-panel"]');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panel.locator('.channel-name')).toHaveText(names);
    await panel.getByRole('searchbox').fill(names[30].trim());
    await expect(panel.locator('.channel-name')).toHaveText([names[30]]);
    await expect(search).toHaveValue(names[0].trim());
    await page.evaluate(() => document.exitFullscreen());
}

/** A category change and return retain the exact live media element (#1520). */
export async function verifyStalkerPlaybackCategoryReturn(
    page: Page
): Promise<void> {
    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    const sidebar = page.locator('app-stalker-live-stream-layout .sidebar');
    const sidebarTitle = sidebar.locator('.category-title');
    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    const scrollPane = sidebar.locator('#live-channels');
    await categories.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(scrollPane).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(categories.nth(1)).toBeFocused();
    const firstCategoryTitle = (await sidebarTitle.textContent())?.trim() ?? '';
    expect(firstCategoryTitle).not.toBe('');

    await channels.first().click();
    await expect(scrollPane).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect
        .poll(() => scrollPane.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);

    await expect(channels.first()).toHaveClass(/active/, { timeout: 20_000 });
    const player = page.locator('app-web-player-view');
    await expect(player).toBeVisible({ timeout: 20_000 });

    const media = await player.locator('video').first().elementHandle();
    expect(media).not.toBeNull();
    const activeName = await channels
        .first()
        .locator('.channel-name')
        .textContent();
    await categories.nth(2).click();

    // The sidebar re-filters to the new category (proves the click landed and
    // change detection ran)…
    await expect(sidebarTitle).not.toHaveText(firstCategoryTitle, {
        timeout: 20_000,
    });
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    // …while the channel picked from the previous category keeps playing.
    await expect(player).toBeVisible();
    const reveal = page.getByRole('button', {
        name: 'Show playing channel',
        exact: true,
    });
    await reveal.click();
    await expect(sidebarTitle).toHaveText(firstCategoryTitle);
    await expect(scrollPane).toBeFocused();
    await expect(sidebar.locator('.active')).toContainText(activeName ?? '');
    expect(
        await media?.evaluate(
            (video) =>
                video === document.querySelector('app-web-player-view video')
        )
    ).toBe(true);
    await expect(reveal).toHaveCount(0);
}
