import type { APIRequestContext, Locator } from '@playwright/test';
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
