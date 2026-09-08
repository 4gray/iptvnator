/**
 * Named setup actions for capture-release-screenshots.ts — the vocabulary
 * that screenshots.manifest.json steps refer to — plus theme switching and
 * the playlist-id registry the actions navigate with.
 *
 * The actions themselves live in three modules by subject
 * (`capture-navigation-setup-actions.ts`: dialogs, settings, remote
 * control; `capture-navigation-portal-actions.ts`: portal browsing and
 * alternative sources; `capture-navigation-download-actions.ts`: the
 * download manager; `capture-navigation-epg-actions.ts`: the EPG guide
 * import and channel mapping) over the shared page helpers in
 * `capture-navigation-helpers.ts`. This file only dispatches a step name
 * and re-exports the API the seeding driver and the capture script use.
 */

import type { Page } from '@playwright/test';

import {
    type CaptureAction,
    discardUnsavedSettings,
    dismissDialogs,
    settleUi,
} from './capture-navigation-helpers';
import { DOWNLOAD_ACTIONS } from './capture-navigation-download-actions';
import { EPG_ACTIONS } from './capture-navigation-epg-actions';
import { PORTAL_ACTIONS } from './capture-navigation-portal-actions';
import { SETUP_ACTIONS } from './capture-navigation-setup-actions';

export {
    clickDialogOption,
    discardUnsavedSettings,
    openAddPlaylistDialog,
    registerPlaylistId,
    requirePlaylistId,
    settleUi,
} from './capture-navigation-helpers';
export type { PlaylistProvider } from './capture-navigation-helpers';

const ACTIONS: Readonly<Record<string, CaptureAction>> = {
    ...SETUP_ACTIONS,
    ...PORTAL_ACTIONS,
    ...DOWNLOAD_ACTIONS,
    ...EPG_ACTIONS,
};

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export async function applyTheme(
    page: Page,
    theme: 'dark' | 'light'
): Promise<void> {
    await runAction(page, 'open-settings', null);
    const testId = theme === 'dark' ? 'DARK_THEME' : 'LIGHT_THEME';
    const themeButton = page.locator(`[data-test-id="${testId}"]`).first();

    await themeButton.scrollIntoViewIfNeeded();
    await themeButton.click();

    const saveButton = page.locator('[data-test-id="save-settings"]').first();

    if (await saveButton.isEnabled()) {
        await saveButton.click();
        await settleUi(page);
    }

    await page.waitForFunction(
        (expectedTheme) =>
            document.body.classList.contains('dark-theme') ===
            (expectedTheme === 'dark'),
        theme,
        { timeout: 10_000 }
    );
}

/* ------------------------------------------------------------------ */
/* Named setup actions                                                 */
/* ------------------------------------------------------------------ */

export async function runAction(
    page: Page,
    action: string,
    param: string | null
): Promise<void> {
    const run = ACTIONS[action];

    if (!run) {
        throw new Error(`Unknown setup action: ${action}`);
    }

    // Manifest steps are order-independent, and some of them end with a modal
    // dialog open or a dirty settings form. Clear whatever the previous step
    // left behind before this one starts navigating: a dialog backdrop
    // swallows every click, and unsaved settings raise a leave prompt.
    await dismissDialogs(page);
    await discardUnsavedSettings(page);
    await run(page, param);
}
