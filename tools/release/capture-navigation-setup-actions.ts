/**
 * Setup actions that stage a dialog or a settings page for a shot: the
 * add-playlist forms, the settings sections, the remote-control switch.
 * Actions here call each other directly rather than through `runAction`,
 * which keeps this module free of a dependency on the dispatcher.
 */

import type { Page } from '@playwright/test';

import {
    AUTO_DETECT_FIXTURE_MESSAGE,
    CAPTURE_REMOTE_CONTROL_PORT,
    CAPTURE_REMOTE_CONTROL_URL,
    EPG_FIXTURE_URL,
    M3U_FIXTURE_PLAYLIST_TITLE,
    M3U_FIXTURE_PLAYLIST_URL,
    STALKER_FIXTURE_MAC,
    STALKER_FIXTURE_PORTAL_URL,
    STALKER_FIXTURE_TITLE,
    XTREAM_FIXTURE_CREDENTIALS,
    XTREAM_FIXTURE_TITLE,
    XTREAM_MOCK_ORIGIN,
} from './capture-fixtures';
import {
    type CaptureAction,
    clickDialogOption,
    goHome,
    openAddPlaylistDialog,
    settleUi,
} from './capture-navigation-helpers';

export async function openSettings(page: Page): Promise<void> {
    await page.locator('a[href$="/workspace/settings"]').first().click();
    await page.waitForURL(/\/workspace\/settings/, { timeout: 15_000 });
    await page
        .locator('[data-test-id="settings-container"]')
        .waitFor({ state: 'visible', timeout: 15_000 });
}

async function openDashboard(page: Page): Promise<void> {
    await page
        .locator('app-workspace-shell-rail a[href$="/workspace/dashboard"]')
        .first()
        .click();
    await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
    await page
        .locator('[data-test-id="dashboard-hero"]')
        .waitFor({ state: 'visible', timeout: 30_000 });
    await settleUi(page);
}

/* ------------------------------------------------------------------ */
/* Add-playlist dialog                                                 */
/* ------------------------------------------------------------------ */

async function openAddPlaylistXtream(page: Page): Promise<void> {
    await goHome(page);
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /xtream credentials/i);
    await dialog.locator('#title').fill(XTREAM_FIXTURE_TITLE);
    await dialog.locator('#serverUrl').fill(XTREAM_MOCK_ORIGIN);
    await dialog.locator('#username').fill(XTREAM_FIXTURE_CREDENTIALS.username);
    await dialog.locator('#password').fill(XTREAM_FIXTURE_CREDENTIALS.password);
    // The server URL is plain http://, so the probe never tries HTTPS and
    // only talks to the local mock; the frame can show the successful
    // "portal is active" verdict the guide explains.
    await dialog
        .getByRole('button', { name: 'Test HTTPS and HTTP', exact: true })
        .click();
    // The status line first reads "Testing connection…"; wait for the
    // verdict itself, so a refused account fails the shot instead of
    // publishing a frame that contradicts the guide.
    const status = dialog.getByRole('status');
    await status
        .filter({ hasText: /portal is active/i })
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(async () => {
            const shown = await status
                .textContent({ timeout: 1_000 })
                .catch(() => null);
            throw new Error(
                `Xtream connection test did not report an active portal within 30s (status: ${shown?.trim() || 'none'})`
            );
        });
    // The dialog body scrolls. The verdict sits under the server URL,
    // above the credentials, so scrolling to the last field frames the
    // whole filled form together with the verdict the guide explains.
    await dialog.locator('#password').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
}

async function openAddPlaylistAuto(page: Page): Promise<void> {
    await goHome(page);
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /auto-detect/i);
    await dialog
        .locator('[data-test-id="auto-detect-textarea"]')
        .fill(AUTO_DETECT_FIXTURE_MESSAGE);
    const candidate = dialog
        .locator('[data-test-id="auto-detect-candidate"]')
        .first();
    await candidate.waitFor({ state: 'visible', timeout: 15_000 });
    await candidate.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
}

async function openAddPlaylistStalker(page: Page): Promise<void> {
    await goHome(page);
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /stalker portal/i);
    await dialog.locator('#title').fill(STALKER_FIXTURE_TITLE);
    await dialog.locator('#portalUrl').fill(STALKER_FIXTURE_PORTAL_URL);
    await dialog.locator('#macAddress').fill(STALKER_FIXTURE_MAC);
    // Blur runs the MAC normalization the guide describes.
    await dialog.locator('#serialNumber').focus();
    // The form is long; frame the identity fields and the derive
    // toggle rather than the signature fields at the bottom.
    await dialog.locator('.derive-device-ids').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
}

async function openAddPlaylistM3uUrl(page: Page): Promise<void> {
    await goHome(page);
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /m3u url/i);
    // Typed only: the dialog fetches nothing until Add is clicked,
    // and the address points at the local mock anyway.
    await dialog
        .locator('input[formcontrolname="playlistUrl"]')
        .fill(M3U_FIXTURE_PLAYLIST_URL);
    await dialog
        .locator('input[formcontrolname="playlistName"]')
        .fill(M3U_FIXTURE_PLAYLIST_TITLE);
    await page.waitForTimeout(500);
}

/* ------------------------------------------------------------------ */
/* Settings sections                                                   */
/* ------------------------------------------------------------------ */

/** Navigates to Settings › EPG and waits for the section, without staging anything. */
export async function openEpgSettingsSection(page: Page): Promise<void> {
    await openSettings(page);
    const sectionLink = page
        .locator('[data-test-id="settings-section-epg"]')
        .first();

    await sectionLink.waitFor({ state: 'visible', timeout: 15_000 });
    await sectionLink.click({ timeout: 10_000 });
    await page.waitForURL(/\/workspace\/settings\/epg/, { timeout: 15_000 });
    await page.locator('#epg').waitFor({ state: 'visible', timeout: 15_000 });
}

async function openSettingsEpg(page: Page): Promise<void> {
    await openEpgSettingsSection(page);
    const section = page.locator('#epg');

    // Show a filled source row instead of the empty state. The value
    // is staged in the form only; nothing is saved or fetched. The
    // dirty form is discarded by `discardUnsavedSettings` before the
    // next action or the app teardown — the settings close guard
    // would otherwise hold `app.close()` open forever. A row a previous
    // step already saved (`load-demo-epg`) fills the frame on its own.
    if ((await section.locator('.epg-source-row').count()) === 0) {
        await section
            .getByRole('button', { name: /add epg source/i })
            .click({ timeout: 10_000 });
        const field = section.locator('input[type="url"]').last();
        await field.waitFor({ state: 'visible', timeout: 10_000 });
        await field.fill(EPG_FIXTURE_URL, { timeout: 10_000 });
    }

    await page.waitForTimeout(500);
}

/**
 * Settings with a term typed into the header search, so the page shows the
 * ranked results list and the per-section match counts instead of a section.
 * The term lives only in the `q` query param: the next action's navigation
 * clears it, and nothing is staged in the settings form.
 */
async function openSettingsSearch(
    page: Page,
    term: string | null
): Promise<void> {
    if (!term) {
        throw new Error('open-settings-search needs a term: open-settings-search=<term>');
    }

    await openSettings(page);
    await page
        .locator('app-workspace-shell-header input[type="search"]')
        .fill(term, { timeout: 10_000 });
    await page.waitForURL(/\/workspace\/settings\/general\?q=/, {
        timeout: 15_000,
    });
    const results = page.locator('[data-test-id="settings-search-results"]');
    await results.waitFor({ state: 'visible', timeout: 15_000 });
    await results
        .locator('[data-test-id^="settings-search-result-"]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
    await settleUi(page);
}

/* ------------------------------------------------------------------ */
/* Remote control (guide shots)                                        */
/* ------------------------------------------------------------------ */

/**
 * Opens Settings › Remote control with the feature switched on and the
 * capture port in the field. The form is left dirty unless a later
 * `enable-remote-control` step saves it; `discardUnsavedSettings` clears it
 * before the next action.
 */
async function openRemoteControlSettings(page: Page): Promise<void> {
    await openSettings(page);
    const sectionLink = page
        .locator('[data-test-id="settings-section-remote-control"]')
        .first();

    await sectionLink.waitFor({ state: 'visible', timeout: 15_000 });
    await sectionLink.click({ timeout: 10_000 });
    await page.waitForURL(/\/workspace\/settings\/remote-control/, {
        timeout: 15_000,
    });

    const section = page.locator('#remote-control');
    await section.waitFor({ state: 'visible', timeout: 15_000 });

    const toggle = section.locator(
        '[data-test-id="remote-control-enabled"] input[type="checkbox"]'
    );

    if (!(await toggle.isChecked())) {
        await section.locator('[data-test-id="remote-control-enabled"]').click();
    }

    const port = section.locator('[data-test-id="remote-control-port"]');
    await port.waitFor({ state: 'visible', timeout: 10_000 });

    if ((await port.inputValue()) !== String(CAPTURE_REMOTE_CONTROL_PORT)) {
        await port.fill(String(CAPTURE_REMOTE_CONTROL_PORT));
    }

    await section
        .locator('.remote-control-url')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
}

async function openSettingsRemoteControl(page: Page): Promise<void> {
    await openRemoteControlSettings(page);
    const section = page.locator('#remote-control');
    const qrButton = section.locator('.url-row button').first();

    await qrButton.waitFor({ state: 'visible', timeout: 15_000 });
    await qrButton.click();
    await section
        .locator('qrcode canvas, qrcode img')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
}

async function enableRemoteControl(page: Page): Promise<void> {
    await openRemoteControlSettings(page);
    const save = page.locator('[data-test-id="save-settings"]').first();

    if (await save.isEnabled().catch(() => false)) {
        await save.click();
        await settleUi(page);
    }

    await waitForRemoteControlServer();
}

/** Polls the status endpoint the phone view reads until the app's server answers. */
async function waitForRemoteControlServer(): Promise<void> {
    const statusUrl = `${CAPTURE_REMOTE_CONTROL_URL}api/remote-control/status`;
    const deadline = Date.now() + 15_000;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(statusUrl);

            if (response.ok) {
                return;
            }
        } catch {
            // not up yet
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    throw new Error(
        `Remote control server did not answer at ${statusUrl} — is port ${CAPTURE_REMOTE_CONTROL_PORT} held by another IPTVnator instance?`
    );
}

/**
 * Settings › Metadata (TMDB) with the switch staged ON, which is what reveals
 * the API-key field, the cache panel and the required TMDB attribution. The
 * value is never saved: enrichment must stay off for the whole capture (G5),
 * and `discardUnsavedSettings` drops the form before the next action.
 */
async function openSettingsTmdb(page: Page): Promise<void> {
    await openSettings(page);
    const sectionLink = page
        .locator('[data-test-id="settings-section-tmdb"]')
        .first();

    await sectionLink.waitFor({ state: 'visible', timeout: 15_000 });
    await sectionLink.click({ timeout: 10_000 });
    await page.waitForURL(/\/workspace\/settings\/tmdb/, { timeout: 15_000 });

    const section = page.locator('#tmdb');
    await section.waitFor({ state: 'visible', timeout: 15_000 });

    const toggle = section.locator(
        '[data-test-id="tmdb-enabled"] input[type="checkbox"]'
    );

    if (!(await toggle.isChecked())) {
        await section.locator('[data-test-id="tmdb-enabled"]').click();
    }

    await section
        .locator('[data-test-id="tmdb-api-key"]')
        .waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(500);
}

export const SETUP_ACTIONS: Readonly<Record<string, CaptureAction>> = {
    'open-settings': openSettings,
    'open-dashboard': openDashboard,
    'open-add-playlist-xtream': openAddPlaylistXtream,
    'open-add-playlist-auto': openAddPlaylistAuto,
    'open-add-playlist-stalker': openAddPlaylistStalker,
    'open-add-playlist-m3u-url': openAddPlaylistM3uUrl,
    'open-settings-epg': openSettingsEpg,
    'open-settings-search': openSettingsSearch,
    'open-settings-tmdb': openSettingsTmdb,
    'open-settings-remote-control': openSettingsRemoteControl,
    'enable-remote-control': enableRemoteControl,
};
