import { expect, test } from '@playwright/test';

test('basic test', async ({ page }) => {
    await page.goto('/');

    // Basic checks
    expect(await page.title()).toBe('IPTVnator');

    // Upload playlist test
    await page.getByTestId('add-playlist').click();
    await page.click('"Add via file upload"');
    await page.setInputFiles('input[type="file"]', './e2e/fixtures/test.m3u');
    await expect(page.getByTestId('channel-item')).toHaveCount(4);
});
