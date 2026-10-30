import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import { expect } from './fixtures';

export async function applyUiTheme(page: Page, dark: boolean) {
    await page.evaluate((dark) => {
        document.body.classList.toggle('dark-theme', dark);
        document.body.classList.toggle('light-theme', !dark);
    }, dark);
}

/** Sample the real gradient behind the text, then composite its foreground
 * opacity. Hiding only the text preserves the row's current/hover background. */
export async function rasterTextContrast(text: Locator): Promise<number> {
    await expect(text).toBeVisible();
    const style = await text.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = getComputedStyle(element).color;
        ctx.fillRect(0, 0, 1, 1);
        const color = Array.from(ctx.getImageData(0, 0, 1, 1).data);
        for (
            let node: Element | null = element;
            node;
            node = node.parentElement
        ) {
            color[3] *= Number(getComputedStyle(node).opacity);
        }
        const inline = element.getAttribute('style');
        (element as HTMLElement).style.visibility = 'hidden';
        return { color, inline };
    });
    let screenshot: Buffer;
    try {
        const clip = await text.boundingBox();
        if (!clip) throw new Error('Text has no layout box');
        screenshot = await text
            .page()
            .screenshot({ clip, animations: 'disabled' });
    } finally {
        await text.evaluate((element, inline) => {
            if (inline === null) element.removeAttribute('style');
            else element.setAttribute('style', inline);
        }, style.inline);
    }
    const { data, info } = await sharp(screenshot)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const luminance = (rgb: number[]) => {
        const linear = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const ratios: number[] = [];
    for (const fraction of [0.2, 0.5, 0.8]) {
        const offset =
            (Math.floor(info.height / 2) * info.width +
                Math.floor(info.width * fraction)) *
            info.channels;
        const background = Array.from(data.subarray(offset, offset + 3));
        const alpha = style.color[3] / 255;
        const foreground = background.map(
            (v, i) => style.color[i] * alpha + v * (1 - alpha)
        );
        const a = luminance(foreground),
            b = luminance(background);
        ratios.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
    }
    return Math.min(...ratios);
}

/** Every visible action and segment label must fit; clipped translated copy
 * is a failure even when its button's outer box happens to fit the header. */
export async function expectCollectionFits(page: Page) {
    const problems = await page
        .locator('.collection-header')
        .evaluate((header) => {
            const bounds = header.getBoundingClientRect();
            const errors: string[] = [];
            if (header.scrollWidth > header.clientWidth + 1)
                errors.push('header overflow');
            for (const element of header.querySelectorAll(
                'button, .mat-button-toggle-label-content'
            )) {
                const box = element.getBoundingClientRect();
                if (!box.width || !box.height) continue;
                if (box.left < bounds.left - 1 || box.right > bounds.right + 1)
                    errors.push(`outside: ${element.textContent?.trim()}`);
                // Material icon buttons have an invisible touch target;
                // only text labels must fit their own content box.
                if (
                    element.matches('.mat-button-toggle-label-content') &&
                    element.scrollWidth > element.clientWidth + 1
                )
                    errors.push(`clipped: ${element.textContent?.trim()}`);
            }
            return errors;
        });
    expect(problems).toEqual([]);
}

export async function selectUiLanguage(
    page: Page,
    language: 'en' | 'de' | 'ru'
) {
    await page.goto('/workspace/settings/general');
    const previous = await page.locator('html').getAttribute('lang');
    await page.locator('[data-test-id="select-language"]').click();
    await page.locator(`[data-test-id="${language}"]`).click();
    const save = page.locator('[data-test-id="save-settings"]');
    if (previous !== language) {
        await expect(save).toBeEnabled();
        await save.click();
        await expect(save).toBeHidden();
    }
    await expect(page.locator('html')).toHaveAttribute('lang', language);
}
