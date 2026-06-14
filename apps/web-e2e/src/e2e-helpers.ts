import type { Locator } from '@playwright/test';
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
