import { expect, test } from './fixtures';

test('@downloads explains desktop availability without exposing file actions in the PWA', async ({
    page,
}) => {
    await page.goto('/workspace/downloads');
    await expect(
        page.getByRole('heading', { name: 'Downloads not available' })
    ).toBeVisible();
    await expect(
        page.getByText('This feature is only available in the desktop app')
    ).toBeVisible();
    await expect(page.locator('.downloads__header-actions')).toHaveCount(0);
    await expect(page.locator('.downloads__filters')).toHaveCount(0);
    for (const dark of [true, false]) {
        await page.evaluate(
            (dark) => document.body.classList.toggle('dark-theme', dark),
            dark
        );
        await page.setViewportSize({ width: 390, height: 844 });
        const message = page.locator('.downloads__message');
        await expect(message).toBeVisible();
        expect(
            await message.evaluate((el) => el.scrollWidth <= el.clientWidth)
        ).toBe(true);
    }
});
