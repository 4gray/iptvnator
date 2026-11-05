import type { Locator } from '@playwright/test';
import sharp from 'sharp';
import { expect } from './fixtures';

/** Check the painted keyboard ring, including clipping by scroll containers. */
export async function expectNavigationFocus(row: Locator): Promise<number> {
    await expect(row).toBeFocused();
    const focus = await row.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const width = parseFloat(style.outlineWidth);
        const reach = Math.max(0, width + parseFloat(style.outlineOffset));
        const clippedBy: string[] = [];
        for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
        ) {
            const parentStyle = getComputedStyle(parent);
            const edge = parent.getBoundingClientRect();
            const clips = (overflow: string) =>
                ['hidden', 'clip', 'auto', 'scroll'].includes(overflow);
            if (
                (clips(parentStyle.overflowY) &&
                    (box.top - reach < edge.top + parent.clientTop - 0.5 ||
                        box.bottom + reach >
                            edge.top +
                                parent.clientTop +
                                parent.clientHeight +
                                0.5)) ||
                (clips(parentStyle.overflowX) &&
                    (box.left - reach < edge.left + parent.clientLeft - 0.5 ||
                        box.right + reach >
                            edge.left +
                                parent.clientLeft +
                                parent.clientWidth +
                                0.5))
            ) {
                clippedBy.push(parent.tagName.toLowerCase());
            }
        }
        const probe = document.createElement('span');
        probe.style.setProperty('color', 'var(--app-focus-ring)', 'important');
        element.append(probe);
        const token = getComputedStyle(probe).color;
        probe.remove();
        return {
            visible: element.matches(':focus-visible'),
            width,
            reach,
            color: style.outlineColor,
            token,
            clippedBy,
        };
    });
    expect(focus.visible).toBe(true);
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.color).toBe(focus.token);
    expect(focus.clippedBy, 'The focus ring must be fully visible').toEqual([]);
    expect(focus.reach, 'Focus shares the row edge with selection').toBe(0);

    const { data, info } = await sharp(
        await row.screenshot({ animations: 'disabled', scale: 'css' })
    )
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const luminance = (y: number) => {
        const offset =
            (y * info.width + Math.floor(info.width / 2)) * info.channels;
        return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
            const c = data[offset + index] / 255;
            return (
                sum +
                weight *
                    (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
            );
        }, 0);
    };
    // Centre samples avoid the rounded corners and sit above the label.
    const ring = luminance(1);
    const fill = luminance(4);
    const contrast =
        (Math.max(ring, fill) + 0.05) / (Math.min(ring, fill) + 0.05);
    expect(
        contrast,
        'Painted focus contrast on the row'
    ).toBeGreaterThanOrEqual(3);
    return contrast;
}
