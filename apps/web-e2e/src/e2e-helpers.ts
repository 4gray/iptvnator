import type {
    APIRequestContext,
    Locator,
    Page,
    TestInfo,
} from '@playwright/test';
import { expect } from './fixtures';
import sharp from 'sharp';

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

/** Compare the actual hero edge with the same pixels with just its border hidden.
 * Both rasters retain artwork, gradients, opacity and backdrop filters. Matching
 * pixels prevent artwork detail from being mistaken for a visible button edge. */
export async function rasterizedBorderContrast(
    locator: Locator
): Promise<number> {
    const screenshot = () =>
        locator.screenshot({ animations: 'disabled', scale: 'css' });
    const visible = await screenshot();
    const originalStyle = await locator.getAttribute('style');
    let hidden: Buffer;
    try {
        await locator.evaluate((element) => {
            const style = (element as HTMLElement).style;
            style.setProperty('transition', 'none', 'important');
            style.setProperty('border-top-color', 'transparent', 'important');
        });
        hidden = await screenshot();
    } finally {
        await locator.evaluate((element, style) => {
            if (style === null) element.removeAttribute('style');
            else element.setAttribute('style', style);
        }, originalStyle);
    }
    const decode = (buffer: Buffer) =>
        sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [before, after] = await Promise.all([
        decode(visible),
        decode(hidden),
    ]);
    expect(after.info).toEqual(before.info);
    const luminance = (data: Buffer, x: number, y: number) => {
        const offset = (y * before.info.width + x) * before.info.channels;
        return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
            const value = data[offset + index] / 255;
            return (
                sum +
                weight *
                    (value <= 0.04045
                        ? value / 12.92
                        : ((value + 0.055) / 1.055) ** 2.4)
            );
        }, 0);
    };
    const ratios: number[] = [];
    // Avoid rounded corners. Inspect three raster rows to tolerate a fractional
    // CSS edge, retaining the strongest edge pixel in each sampled column.
    for (
        let x = Math.ceil(before.info.width / 4);
        x < (before.info.width * 3) / 4;
        x++
    ) {
        let strongest = 1;
        for (let y = 0; y < Math.min(3, before.info.height); y++) {
            const a = luminance(before.data, x, y);
            const b = luminance(after.data, x, y);
            strongest = Math.max(
                strongest,
                (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
            );
        }
        ratios.push(strongest);
    }
    ratios.sort((a, b) => a - b);
    return ratios[Math.floor(ratios.length / 2)];
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
        await expect
            .poll(() =>
                rasterizedBorderContrast(shell.locator('.favorite-btn').first())
            )
            .toBeGreaterThan(1.1);
        for (const selector of ['.episode-card', 'mat-button-toggle-group']) {
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
