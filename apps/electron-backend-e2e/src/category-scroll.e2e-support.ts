import { expect, Locator } from '@playwright/test';

/** Interrupt a real reveal at the edge most likely to be carried out of view. */
export async function expectVisibleCategoryStopsSmoothScroll(
    panel: Locator,
    direction: 'down' | 'up'
): Promise<void> {
    const rail = panel.locator('app-workspace-context-category-view');
    const clicked = await rail.evaluate(
        async (container: HTMLElement, direction) => {
            const rows = [
                ...container.querySelectorAll<HTMLElement>('.category-item'),
            ];
            const down = direction === 'down';
            const start = down
                ? 0
                : container.scrollHeight - container.clientHeight;
            container.scrollTo({ top: start, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
            // Native click avoids Playwright scrolling the off-screen target first.
            rows[down ? rows.length - 1 : 0].click();
            const deadline = performance.now() + 3000;
            do {
                await new Promise(requestAnimationFrame);
                if (performance.now() > deadline) {
                    throw new Error(
                        'The category reveal did not start scrolling'
                    );
                }
            } while (Math.abs(container.scrollTop - start) < 80);

            const bounds = container.getBoundingClientRect();
            const visible = rows.filter((row) => {
                const rect = row.getBoundingClientRect();
                return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
            });
            const row = visible[down ? 0 : visible.length - 1];
            if (!row) throw new Error('No fully visible category to select');
            const top = container.scrollTop;
            row.click();
            return {
                name: row.querySelector('.nav-item-label')!.textContent!.trim(),
                top,
            };
        },
        direction
    );

    const row = rail
        .locator('.category-item')
        .filter({ hasText: clicked.name });
    await expect(row).toHaveAttribute('aria-current', 'true');
    let stableSamples = 0;
    await expect
        .poll(
            async () => {
                const position = await row.evaluate((element) => {
                    const container = element.closest(
                        'app-workspace-context-category-view'
                    )!;
                    const bounds = container.getBoundingClientRect();
                    const rowBounds = element.getBoundingClientRect();
                    return {
                        top: container.scrollTop,
                        visible:
                            rowBounds.top >= bounds.top - 2 &&
                            rowBounds.bottom <= bounds.bottom + 2,
                    };
                });
                stableSamples =
                    position.visible && Math.abs(position.top - clicked.top) < 2
                        ? stableSamples + 1
                        : 0;
                return stableSamples >= 3;
            },
            { intervals: [100] }
        )
        .toBe(true);
}
