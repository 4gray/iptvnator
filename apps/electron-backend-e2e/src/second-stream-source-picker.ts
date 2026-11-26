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

/**
 * A content-type toggle of the split-view picker. A playlist can have a
 * channel group with the same name, so the lookup stays inside the toggles.
 */
export function contentType(
    picker: Locator,
    name: 'Live TV' | 'Movies' | 'Series'
): Locator {
    return picker
        .getByRole('group', { name: 'Content type' })
        .getByRole('button', { name, exact: true });
}
