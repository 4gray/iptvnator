import { expect, Locator, Page } from '@playwright/test';
import sharp = require('sharp');

/** Exercise the same live CSS boundary as SettingsService without navigating
 * away from (and therefore destroying) the player being measured. */
export async function applyTheme(page: Page, theme: 'light' | 'dark') {
    await page.evaluate((dark) => {
        document.body.classList.toggle('dark-theme', dark);
    }, theme === 'dark');
}

/** Contrast for app panels with solid/alpha CSS background colors. Gradients,
 * video and Material state layers use the raster check below instead. */
export async function expectTextContrast(
    locator: Locator,
    minimum = 4.5,
    siblingFillSelector?: string
) {
    await expect(locator).toBeVisible();
    const measure = () =>
        locator.evaluate((element, fillSelector) => {
            type Color = [number, number, number, number];
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d')!;
            const parse = (css: string): Color => {
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = css;
                ctx.fillRect(0, 0, 1, 1);
                const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
                return [r, g, b, a / 255];
            };
            const over = (front: Color, back: Color): Color => {
                const alpha = front[3] + back[3] * (1 - front[3]);
                return [0, 1, 2]
                    .map((i) =>
                        alpha
                            ? (front[i] * front[3] +
                                  back[i] * back[3] * (1 - front[3])) /
                              alpha
                            : 0
                    )
                    .concat(alpha) as Color;
            };
            let foreground = parse(getComputedStyle(element).color);
            let background: Color = [0, 0, 0, 0];
            for (
                let node: Element | null = element;
                node;
                node = node.parentElement
            ) {
                const style = getComputedStyle(node);
                // A timeline progress fill is a sibling behind the text, not
                // an ancestor. Include it before its owning card background.
                const siblingFill = fillSelector
                    ? node.querySelector(`:scope > ${fillSelector}`)
                    : null;
                if (siblingFill) {
                    const layer = parse(
                        getComputedStyle(siblingFill).backgroundColor
                    );
                    foreground = over(foreground, layer);
                    background = over(background, layer);
                }
                const fill = parse(style.backgroundColor);
                foreground = over(foreground, fill);
                background = over(background, fill);
                foreground[3] *= Number(style.opacity);
                background[3] *= Number(style.opacity);
            }
            const white: Color = [255, 255, 255, 1];
            const luminance = (color: Color) => {
                const rgb = color.slice(0, 3).map((value) => {
                    const s = value / 255;
                    return s <= 0.04045
                        ? s / 12.92
                        : ((s + 0.055) / 1.055) ** 2.4;
                });
                return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
            };
            const a = luminance(over(foreground, white));
            const b = luminance(over(background, white));
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        }, siblingFillSelector);
    await expect
        .poll(measure, { message: `Rendered contrast of ${locator}` })
        .toBeGreaterThanOrEqual(minimum);
}

export async function expectThemeSurface(
    locator: Locator,
    theme: 'light' | 'dark'
) {
    const brightness = await locator.evaluate((element) => {
        const color = getComputedStyle(element).backgroundColor;
        const channels =
            color
                .match(/[\d.]+/g)
                ?.slice(0, 3)
                .map(Number) ?? [];
        return channels.reduce((sum, value) => sum + value, 0) / 3;
    });
    if (theme === 'light') expect(brightness).toBeGreaterThan(220);
    else expect(brightness).toBeLessThan(70);
}

/** Put a worst-case white video frame below the real shared controls. Rasterize
 * the actual icon with its gradient scrim and Material hover/focus layers, so
 * losing the scrim cannot pass because a black video ancestor masks the bug. */
export async function expectOverlayContrastOnWhite(
    controls: Locator,
    button: Locator
) {
    await controls.evaluate((element) => {
        const backing = document.createElement('div');
        backing.dataset['themeContrastBacking'] = '';
        Object.assign(backing.style, {
            position: 'absolute',
            inset: '0',
            background: '#fff',
            zIndex: '-1',
            pointerEvents: 'none',
        });
        element.append(backing);
    });
    try {
        const icon = button.locator('mat-icon');
        const buffer = await icon.screenshot({ animations: 'disabled' });
        const { data, info } = await sharp(buffer)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const luminances: number[] = [];
        for (let i = 0; i < data.length; i += info.channels) {
            const linear = [data[i], data[i + 1], data[i + 2]].map((value) => {
                const s = value / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            luminances.push(
                linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
            );
        }
        luminances.sort((a, b) => a - b);
        // Interior background and filled glyph, excluding antialiased edges.
        const background = luminances[Math.floor(luminances.length * 0.1)];
        const foreground = luminances[Math.floor(luminances.length * 0.9)];
        expect(
            (foreground + 0.05) / (background + 0.05)
        ).toBeGreaterThanOrEqual(3);
    } finally {
        await controls.evaluate((element) =>
            element.querySelector('[data-theme-contrast-backing]')?.remove()
        );
    }
}
