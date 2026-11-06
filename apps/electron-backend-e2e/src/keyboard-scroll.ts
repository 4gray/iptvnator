import { expect, Locator, Page } from '@playwright/test';

type ScrollEndProbe = Element & { e2eScrollEnded?: boolean };

/**
 * Press a key that scrolls `scroller`, then wait for that scroll's `scrollend`.
 *
 * Chromium drops a keyboard scroll pressed in the frame or two between the
 * compositor finishing the previous smooth scroll and Blink handling that
 * finish: the key retargets the finished animation, and the late finish
 * notification then resets it. The final `scrollTop` arrives before that
 * notification, so the next discrete scroll input waits for `scrollend`
 * instead. The key must scroll; a key that does not fails here.
 */
export async function pressScrollKey(
    page: Page,
    scroller: Locator,
    key: string
): Promise<void> {
    await scroller.evaluate((element) => {
        const probe = element as ScrollEndProbe;
        probe.e2eScrollEnded = false;
        element.addEventListener(
            'scrollend',
            () => {
                probe.e2eScrollEnded = true;
            },
            { once: true }
        );
    });
    await page.keyboard.press(key);
    await expect
        .poll(
            () =>
                scroller.evaluate(
                    (element) => (element as ScrollEndProbe).e2eScrollEnded
                ),
            { message: `${key} scroll ended` }
        )
        .toBe(true);
}
