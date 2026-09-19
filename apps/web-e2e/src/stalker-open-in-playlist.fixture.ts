import { expect, Page } from '@playwright/test';

/**
 * Favorites → "Open in <portal>" → the same channel selected and playing in
 * the portal's ITV section (the live counterpart of "View in portal").
 *
 * Runs against the PWA, where the collection tab renders no EPG panel and
 * therefore no toolbar chip, so the row context menu is the entry point. The
 * mock portal answers `get_all_channels`, so the layout locates the channel
 * through the full ITV list and lands in its genre.
 *
 * Expects the portal to be imported already (`addStalkerPortal`).
 */
export async function verifyStalkerOpenInPlaylist(
    page: Page,
    portalName: string
): Promise<void> {
    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);
    const portalUrl = new URL(page.url());
    const itvPath = portalUrl.pathname;

    // Favorite the first channel of the second category (the first row is
    // "All"), remembering its name for the round-trip assertion.
    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();
    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    const channelName = (
        await channels.first().locator('.channel-name').innerText()
    ).trim();
    expect(channelName).not.toBe('');
    await channels.first().locator('.favorite-button').click();
    await expect(
        channels.first().locator('.favorite-button mat-icon')
    ).toHaveText('star', { timeout: 10_000 });

    // Global favorites, all playlists: the row offers the jump.
    await page.goto('/workspace/global-favorites');
    const allPlaylists = page
        .locator('.scope-toggle')
        .getByRole('radio', { name: 'All playlists' });
    if (await allPlaylists.count()) {
        await allPlaylists.click();
    }
    const favoriteRow = page
        .locator('app-global-favorites-list [data-test-id="channel-item"]')
        .filter({ hasText: channelName })
        .first();
    await expect(favoriteRow).toBeVisible({ timeout: 20_000 });
    await favoriteRow.click({ button: 'right' });
    const openInPlaylist = page.locator(
        '[data-testid="channel-open-in-playlist"]'
    );
    await expect(openInPlaylist).toBeVisible({ timeout: 10_000 });
    await expect(openInPlaylist).toContainText(portalName);
    await openInPlaylist.click();

    // Lands inside the portal's ITV section with that channel selected and
    // playing, in its own genre.
    await page.waitForURL((url) => url.pathname === itvPath, {
        timeout: 20_000,
    });
    const activeRow = page.locator('[data-test-id="channel-item"].active');
    await expect(activeRow).toContainText(channelName, { timeout: 30_000 });
    await expect(page.locator('app-web-player-view')).toBeVisible({
        timeout: 20_000,
    });
}
