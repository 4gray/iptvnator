import { expect, Locator, Page } from '@playwright/test';

export async function checkHorizontalRail(page: Page, row: Locator) {
    await expect(row).toHaveAttribute('data-tv-horizontal', 'true');
    expect(
        await row.evaluate(
            (element) =>
                getComputedStyle(element, '::-webkit-scrollbar').display
        )
    ).toBe('none');
    const wrapper = row.locator('..');
    const arrows = wrapper.locator('.rail-arrow');
    const overflow = await row.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1
    );
    await expect(arrows).toHaveCount(overflow ? 2 : 0);
    if (!overflow) return;
    const items = row.locator('button:not(:disabled)');
    const left = wrapper.getByRole('button', { name: /^Scroll left:/ });
    const right = wrapper.getByRole('button', { name: /^Scroll right:/ });
    await row.evaluate((element) => {
        element.scrollLeft = 0;
    });
    await items.first().focus();
    await expect(left).toBeDisabled();
    await expect(right).toBeEnabled();
    await page.keyboard.press('ArrowLeft');
    await expect(items.first()).toBeFocused();
    for (let index = 1; index < (await items.count()); index++) {
        await page.keyboard.press('ArrowRight');
        await expect(items.nth(index)).toBeFocused();
    }
    await page.keyboard.press('ArrowRight');
    await expect(items.last()).toBeFocused();
    await expect(left).toBeEnabled();
    await expect(right).toBeDisabled();
    await expect
        .poll(() => row.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    await left.hover();
    await expect(items.last()).toBeFocused();
    await left.click();
    await expect
        .poll(() =>
            row.evaluate((element) => {
                const focused = element.querySelector(':focus');
                if (!focused) return false;
                const bounds = element.getBoundingClientRect();
                const rect = focused.getBoundingClientRect();
                return (
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1
                );
            })
        )
        .toBe(true);
    await row.evaluate((element) => {
        element.scrollLeft = 0;
    });
    await items.first().focus();
    await expect(right).toBeEnabled();
    await right.click();
    await expect(items.first()).not.toBeFocused();
    await expect(wrapper.locator('.rail-arrow:focus')).toHaveCount(0);
    await expect
        .poll(() => row.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    await items.first().focus();
    await page.keyboard.press('ArrowUp');
    await expect(items.first()).not.toBeFocused();
}
