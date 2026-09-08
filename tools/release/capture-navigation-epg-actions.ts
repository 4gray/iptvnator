/**
 * Setup actions for the EPG-mapping guide shots: importing the mock's XMLTV
 * guide, opening a channel's context menu and staging the mapping dialog.
 * They sit between the settings pages (`capture-navigation-setup-actions.ts`)
 * and the channel lists (`capture-navigation-portal-actions.ts`), so they
 * borrow one entry point from each rather than duplicating the navigation.
 */

import type { Page } from '@playwright/test';

import { DEMO_EPG_URL } from './capture-fixtures';
import { type CaptureAction, settleUi } from './capture-navigation-helpers';
import { openM3uGroups } from './capture-navigation-portal-actions';
import { openEpgSettingsSection } from './capture-navigation-setup-actions';

async function openSettingsEpgOffset(page: Page): Promise<void> {
    await openEpgSettingsSection(page);
    const offset = page.locator('[data-test-id="epg-offset-minutes"]');

    await offset.waitFor({ state: 'visible', timeout: 10_000 });
    // Staged in the form only; discarded before the next action.
    await offset.fill('60');
    await page.waitForTimeout(400);
}

/**
 * Imports the mock's XMLTV guide as an EPG source and saves the settings, so
 * the mapping dialog has channels to search. Idempotent: a saved row with the
 * demo URL means the guide is already in the isolated database.
 */
async function loadDemoEpg(page: Page): Promise<void> {
    await openEpgSettingsSection(page);
    const section = page.locator('#epg');
    const existing = await section
        .locator('.epg-source-row input')
        .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
        );

    if (existing.includes(DEMO_EPG_URL)) {
        return;
    }

    await section
        .getByRole('button', { name: /add epg source/i })
        .click({ timeout: 10_000 });
    const field = section.locator('.epg-source-row input').last();
    await field.waitFor({ state: 'visible', timeout: 10_000 });
    await field.fill(DEMO_EPG_URL, { timeout: 10_000 });
    // The row's first icon button fetches the source right away.
    await section
        .locator('.epg-source-row')
        .last()
        .locator('button')
        .first()
        .click();
    // A loopback source trips the app's private-network confirmation; the
    // mock is the one private address this capture trusts.
    const allow = page.getByRole('button', { name: /allow source/i });

    if (
        await allow
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false)
    ) {
        await allow.click();
    }

    await page
        .locator(
            '.epg-progress-panel .import-item.status-complete, .epg-progress-panel .stat-badge'
        )
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });

    const save = page.locator('[data-test-id="save-settings"]').first();

    if (await save.isEnabled().catch(() => false)) {
        await save.click();
    }

    await settleUi(page);
}

/** Right-clicks the first channel of the M3U groups view and waits for its menu. */
async function openM3uChannelContextMenu(page: Page): Promise<void> {
    await openM3uGroups(page);
    const channel = page.locator('app-channel-list-item').first();

    await channel.waitFor({ state: 'visible', timeout: 30_000 });
    await channel.click({ button: 'right' });
    await page
        .getByRole('menuitem', { name: /map epg channel/i })
        .waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(400);
}

async function openEpgMappingDialog(page: Page): Promise<void> {
    await loadDemoEpg(page);
    await openM3uChannelContextMenu(page);
    await page.getByRole('menuitem', { name: /map epg channel/i }).click();

    const dialog = page.locator('mat-dialog-container').last();

    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    await dialog.locator('input').first().fill('Aurora');

    const result = dialog.locator('.epg-mapping-result').first();

    await result.waitFor({ state: 'visible', timeout: 15_000 });
    await result.click();
    await page.waitForTimeout(500);
}

export const EPG_ACTIONS: Readonly<Record<string, CaptureAction>> = {
    'open-settings-epg-offset': openSettingsEpgOffset,
    'load-demo-epg': loadDemoEpg,
    'open-m3u-channel-menu': openM3uChannelContextMenu,
    'open-epg-mapping-dialog': openEpgMappingDialog,
};
