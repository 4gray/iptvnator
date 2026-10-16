import { expect, Page } from '@playwright/test';

/**
 * Enters the ITV section, selects the second category (the first row is
 * "All") and plays its first channel, returning every `create_link` request
 * observed so callers can assert whether a link was minted.
 */
export async function playFirstItvChannel(page: Page): Promise<string[]> {
    const createLinkRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('action=create_link')) {
            createLinkRequests.push(request.url());
        }
    });

    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    await channels.first().click();
    await expect(channels.first()).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-web-player-view')).toBeVisible({
        timeout: 20_000,
    });

    return createLinkRequests;
}
