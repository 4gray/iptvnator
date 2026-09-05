import type {
    APIRequestContext,
    Locator,
    Page,
    TestInfo,
} from '@playwright/test';
import { expect } from './fixtures';

export async function setInputValue(
    input: Locator,
    value: string
): Promise<void> {
    await input.fill('');
    await input.fill(value);

    if ((await input.inputValue()) === value) {
        return;
    }

    await input.click();
    await input.press('ControlOrMeta+A');
    await input.press('Backspace');
    await input.type(value);
    await expect(input).toHaveValue(value);
}

/**
 * POST to a mock-server control endpoint, retrying transport errors.
 *
 * The mock servers are shared by every spec file and Playwright runs those
 * files in parallel workers, so a burst of concurrent control requests can
 * occasionally be met with ECONNRESET. That is a transport hiccup, not a
 * failure of the test under it.
 */
export async function postWithRetry(
    request: APIRequestContext,
    url: string,
    attempts = 3
): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await request.post(url);
            if (response.ok()) {
                return;
            }
            lastError = new Error(`POST ${url} failed: ${response.status()}`);
        } catch (error) {
            lastError = error;
        }

        await new Promise((resolve) =>
            setTimeout(resolve, 250 * (attempt + 1))
        );
    }

    throw lastError;
}

/** Wait for native scrolling to settle before the next discrete keyboard action. */
export async function waitForScrollIdle(scrollOwner: Locator): Promise<void> {
    await scrollOwner.evaluate(
        (element) =>
            new Promise<void>((resolve) => {
                let last = element.scrollTop;
                let stableFrames = 0;
                const frame = () => {
                    stableFrames =
                        element.scrollTop === last ? stableFrames + 1 : 0;
                    last = element.scrollTop;
                    if (stableFrames === 3) resolve();
                    else requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            })
    );
}

/** Measure flat UI surfaces after alpha compositing, including CSS color-mix. */
export async function surfaceContrast(locator: Locator): Promise<{
    border: number;
    fill: number;
}> {
    return locator.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context)
            throw new Error('Canvas is required to measure surface contrast');
        const paint = (color: string) => {
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
        };
        const luminance = () => {
            const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
                .slice(0, 3)
                .map((value) => {
                    const channel = value / 255;
                    return channel <= 0.04045
                        ? channel / 12.92
                        : ((channel + 0.055) / 1.055) ** 2.4;
                });
            return (
                channels[0] * 0.2126 +
                channels[1] * 0.7152 +
                channels[2] * 0.0722
            );
        };
        const ratio = (first: number, second: number) =>
            (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        const ancestors: Element[] = [];
        for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
        ) {
            ancestors.unshift(parent);
        }
        paint('white');
        ancestors.forEach((parent) =>
            paint(getComputedStyle(parent).backgroundColor)
        );
        const behind = luminance();
        const style = getComputedStyle(element);
        paint(style.backgroundColor);
        const fill = luminance();
        paint(
            parseFloat(style.borderTopWidth) > 0
                ? style.borderTopColor
                : 'transparent'
        );
        return { border: ratio(luminance(), fill), fill: ratio(fill, behind) };
    });
}

/** Check the shared series UI under a provider host before testing watched state. */
export async function expectSeriesSurfacesInBothThemes(
    page: Page,
    testInfo: TestInfo
): Promise<void> {
    // Shared episode surfaces must also resolve the Stalker host's theme.
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(page.locator('.hero__content')).toHaveCSS('opacity', '1');
    for (const theme of ['light', 'dark']) {
        await page.evaluate(
            (dark) => document.body.classList.toggle('dark-theme', dark),
            theme === 'dark'
        );
        const shell = page.locator('app-portal-detail-shell');
        for (const selector of [
            '.favorite-btn',
            '.episode-card',
            'mat-button-toggle-group',
        ]) {
            await expect
                .poll(
                    async () =>
                        (await surfaceContrast(shell.locator(selector).first()))
                            .border
                )
                .toBeGreaterThan(1.15);
        }
        await page
            .getByRole('radio', { name: 'List view', exact: true })
            .click();
        await expect
            .poll(
                async () =>
                    (
                        await surfaceContrast(
                            shell.locator('.episode-list-item').first()
                        )
                    ).border
            )
            .toBeGreaterThan(1.15);
        await shell.screenshot({
            path: testInfo.outputPath(`stalker-series-list-${theme}.png`),
            animations: 'disabled',
        });
        await page
            .getByRole('radio', { name: 'Grid view', exact: true })
            .click();
    }
}
