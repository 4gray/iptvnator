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
    await sidebarRows.first().click();
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
    expect(await videoNode?.evaluate((element) => element.isConnected)).toBe(true);

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
