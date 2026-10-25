import type { Locator, Page } from '@playwright/test';

export interface XtreamSyntheticPortalFields {
    readonly password: 'performance';
    readonly serverUrl: string;
    readonly sourceTitle: string;
    readonly username: 'performance';
}

export type XtreamSourceAction = 'delete' | 'refresh';

const XTREAM_METHOD_NAME = /xtream(?:\s+credentials)?/i;
const XTREAM_ROUTE = /\/workspace\/xtreams\/[^/]+/;

export async function prepareXtreamAddTrigger(
    page: Page,
    fields: XtreamSyntheticPortalFields
): Promise<Locator> {
    await waitForEmptyDashboardReady(page);
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page.waitForURL(/\/workspace\/sources$/);
    await page.locator('app-workspace-sources').waitFor({ state: 'visible' });
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .first()
        .click();
    const dialog = page.locator('mat-dialog-container').last();
    await dialog.waitFor({ state: 'visible' });
    await selectXtreamMethod(dialog);
    await dialog.locator('#title').fill(fields.sourceTitle);
    await dialog.locator('#serverUrl').fill(fields.serverUrl);
    await dialog.locator('#username').fill(fields.username);
    await dialog.locator('#password').fill(fields.password);

    const exactAdd = dialog
        .getByRole('button', { name: 'Add', exact: true })
        .last();
    const add =
        (await exactAdd.count()) > 0
            ? exactAdd
            : dialog
                  .getByRole('button', {
                      name: /^(add|add playlist)$/i,
                  })
                  .last();
    await assertTriggerReady(add, 'xtream-final-add');
    return add;
}

async function waitForEmptyDashboardReady(page: Page): Promise<void> {
    await page.waitForURL(/\/workspace\/dashboard$/);
    await page.waitForFunction(
        () =>
            document.querySelector(
                'lib-workspace-dashboard-rails.rails-page-host--empty'
            ) !== null,
        { waitFor: 'empty-dashboard-ready' }
    );
}

export async function prepareXtreamSourceActionTrigger(
    page: Page,
    sourceTitle: string,
    action: XtreamSourceAction
): Promise<Locator> {
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page.waitForURL(/\/workspace\/sources$/);
    const row = xtreamSourceRow(page, sourceTitle);
    await row.waitFor({ state: 'visible' });
    for (const selector of [
        '.source-row__busy',
        'mat-spinner',
        '.source-row__cancel',
    ]) {
        await row.locator(selector).waitFor({ state: 'detached' });
    }
    if (action === 'refresh') {
        const refresh = row.locator('.source-row__refresh');
        await assertTriggerReady(refresh, 'xtream-source-refresh');
        await refresh.click();
        const dialog = page.locator('mat-dialog-container').last();
        await dialog.waitFor({ state: 'visible' });
        const confirmation = dialog
            .getByRole('button', { name: 'Refresh playlist', exact: true })
            .last();
        await assertTriggerReady(confirmation, 'xtream-source-refresh-confirm');
        return confirmation;
    }

    // Remove starts the Undo window, which commits on its own after four
    // seconds: preparation stops at the open menu, and the trigger removes
    // and commits at once (removeXtreamSource).
    const more = row.locator('.source-row__more');
    await assertTriggerReady(more, 'xtream-source-delete-menu');
    await more.click();
    const remove = page
        .locator('.cdk-overlay-pane [mat-menu-item]')
        .filter({ hasText: 'Remove playlist' })
        .first();
    await assertTriggerReady(remove, 'xtream-source-delete');
    return remove;
}

/**
 * Clicks Remove and returns the Undo toast's close button, which commits the
 * delete without waiting out the Undo window: the measured delete starts
 * with that click.
 */
export async function removeXtreamSource(
    page: Page,
    remove: Locator
): Promise<Locator> {
    await remove.click();
    const commit = page.locator(
        'mat-snack-bar-container.app-toast .source-removal-toast__close'
    );
    await assertTriggerReady(commit, 'xtream-source-delete-confirm');
    return commit;
}

export async function waitForXtreamCatalogTerminal(page: Page): Promise<void> {
    await page.waitForURL(XTREAM_ROUTE);
    await page
        .locator('.workspace-loading-overlay')
        .waitFor({ state: 'detached' });
    await page
        .locator('app-workspace-context-panel .category-item')
        .first()
        .waitFor({ state: 'visible' });
    await page
        .locator('.content-card, [data-test-id="channel-item"], mat-card')
        .first()
        .waitFor({ state: 'visible' });
}

export async function waitForXtreamCancellationTerminal(
    page: Page
): Promise<void> {
    await page
        .locator('.workspace-loading-overlay')
        .waitFor({ state: 'detached' });
    await page.waitForFunction(
        ({ selector, text }) =>
            document.querySelector(selector)?.textContent?.trim() === text,
        {
            selector: '.xtream-content-gate .error-view__title',
            text: 'Import cancelled',
            waitFor: 'cancellation-terminal',
        },
        { timeout: 120_000 }
    );
}

/**
 * After the database reports the delete complete: the row, back as
 * "Removing…" while it ran or never shown again for a fast delete, leaves.
 */
export async function waitForXtreamSourceRowGone(
    page: Page,
    sourceTitle: string
): Promise<void> {
    await xtreamSourceRow(page, sourceTitle).waitFor({ state: 'detached' });
}

async function selectXtreamMethod(dialog: Locator): Promise<void> {
    const radio = dialog
        .getByRole('radio', { name: XTREAM_METHOD_NAME })
        .first();
    if ((await radio.count()) > 0) {
        await radio.click();
        return;
    }
    const button = dialog
        .getByRole('button', { name: XTREAM_METHOD_NAME })
        .first();
    if ((await button.count()) > 0) {
        await button.click();
        return;
    }
    const fallback = dialog.locator('mat-button-toggle[value="xtream"]');
    if ((await fallback.count()) === 0) {
        throw new Error('xtream-method-selector-missing');
    }
    await fallback.click();
}

function xtreamSourceRow(page: Page, sourceTitle: string): Locator {
    const exactTitle = new RegExp(`^\\s*${escapeRegex(sourceTitle)}\\s*$`, 'u');
    return page
        .locator('app-workspace-sources app-source-row')
        .filter({
            has: page.locator('.source-row__name', {
                hasText: exactTitle,
            }),
        })
        .first();
}

async function assertTriggerReady(
    trigger: Locator,
    label: string
): Promise<void> {
    await trigger.waitFor({ state: 'visible' });
    if (await trigger.isDisabled()) {
        throw new Error(`${label}-disabled`);
    }
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
