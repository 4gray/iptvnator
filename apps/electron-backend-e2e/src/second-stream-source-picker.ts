import type { Locator } from '@playwright/test';

/**
 * Chooses a source in the split-view picker: its toolbar picker, named
 * "Source: <current>", opens a radio menu in the overlay container, outside
 * the picker dialog.
 */
export async function chooseSecondStreamSource(
    picker: Locator,
    name: string
): Promise<void> {
    await picker.getByRole('button', { name: /^Source: / }).click();
    const row = picker.page().getByRole('menuitemradio', { name, exact: true });
    await row.click();
    await row.waitFor({ state: 'hidden' });
}
