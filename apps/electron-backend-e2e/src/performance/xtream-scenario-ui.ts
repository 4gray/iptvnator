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
        '.busy-state__message',
        '.action-spinner',
        '.cancel-btn',
    ]) {
        await row.locator(selector).waitFor({ state: 'detached' });
    }
    const actionSelector =
        action === 'refresh' ? '.refresh-btn' : '.delete-btn';
    const actionButton = row.locator(actionSelector);
    await assertTriggerReady(actionButton, `xtream-source-${action}`);
    await actionButton.click();

    const dialog = page.locator('mat-dialog-container').last();
    await dialog.waitFor({ state: 'visible' });
    const confirmation = dialog
        .getByRole('button', { name: 'Yes', exact: true })
        .last();
    await assertTriggerReady(confirmation, `xtream-source-${action}-confirm`);
    return confirmation;
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

export async function waitForXtreamDeleteTerminal(
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
        .locator('app-playlist-item')
        .filter({
            has: page.locator('.playlist-title', {
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
