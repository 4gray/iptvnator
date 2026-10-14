import type { Page } from '@playwright/test';
import { pressTab } from './e2e-helpers';
import { expect } from './fixtures';

/** The computed colour a custom property resolves to on this page. */
async function computedColor(page: Page, property: string): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }, property);
}

/**
 * The radio player's play/pause control is a `mat-icon-button` drawn as the
 * 56px primary circle the fab used to draw (the fab tokens alone were about
 * 6 KB of the initial stylesheet), with the icon centred, and keyboard focus
 * draws the app ring that the fab reset with `outline: none`.
 */
export async function verifyRadioPlayControl(
    page: Page,
    browserName: string
): Promise<void> {
    const player = page.locator('app-audio-player');
    const play = player.locator('.play-btn');
    await expect(play).toBeVisible();
    await expect(play).toHaveClass(/mat-mdc-icon-button/);
    await expect(play).not.toHaveClass(/mat-mdc-fab/);

    const style = await play.evaluate((button) => {
        const icon = button.querySelector('mat-icon') as HTMLElement;
        const box = button.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        const { width, height, borderRadius, backgroundColor } =
            getComputedStyle(button);
        const centre = (rect: DOMRect) => [
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
        ];
        const [x, y] = centre(box);
        const [iconX, iconY] = centre(iconBox);
        return {
            width,
            height,
            borderRadius,
            backgroundColor,
            iconColor: getComputedStyle(icon).color,
            iconFontSize: getComputedStyle(icon).fontSize,
            iconOffset: [Math.round(iconX - x), Math.round(iconY - y)],
        };
    });
    expect(style).toEqual({
        width: '56px',
        height: '56px',
        borderRadius: '50%',
        backgroundColor: await computedColor(page, '--app-selection-color'),
        iconColor: 'rgb(255, 255, 255)',
        iconFontSize: '32px',
        iconOffset: [0, 0],
    });

    await player.locator('.skip-btn').first().focus();
    await pressTab(page, browserName);
    await expect(play).toBeFocused();
    const ring = await play.evaluate((button) => {
        const { outlineStyle, outlineWidth, outlineColor } =
            getComputedStyle(button);
        return { outlineStyle, outlineWidth, outlineColor };
    });
    expect(ring).toEqual({
        outlineStyle: 'solid',
        outlineWidth: '2px',
        outlineColor: await computedColor(page, '--app-focus-ring'),
    });
}
