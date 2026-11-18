import type { ElectronApplication, Page } from '@playwright/test';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    m3uFixturePath,
    openSettings,
    openSettingsSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// Workspace header in the desktop app's smallest window (900x700), audit
// follow-up points 1, 4 and 5:
//
//   1. The header row never spills past its edge. Actions that do not fit
//      move into "More actions", which never holds a single action.
//   4. The dashboard field launches global search instead of sitting there
//      disabled ("Search in this playlist" with nothing to search).
//   5. The keyboard shortcuts button left the header; the palette opens the
//      same dialog.
// ---------------------------------------------------------------------------

const SCREENSHOTS = join(
    process.cwd(),
    'dist/.playwright/apps/electron-backend-e2e/screenshots/header-overflow'
);
const PIN = '2468';

async function useMinimumWindow(electronApp: ElectronApplication) {
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(900, 700);
    });
}

async function expectHeaderFits(page: Page): Promise<void> {
    const header = page.locator('app-workspace-shell-header .workspace-header');
    await expect
        .poll(() =>
            header.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const spill = Array.from(element.querySelectorAll('button'))
                    .filter((button) => button.getClientRects().length > 0)
                    .map((button) => button.getBoundingClientRect())
                    .filter(
                        (rect) =>
                            rect.left < bounds.left - 1 ||
                            rect.right > bounds.right + 1
                    ).length;
                return {
                    spill,
                    overflow: element.scrollWidth - element.clientWidth,
                };
            })
        )
        .toEqual({ spill: 0, overflow: 0 });
}

/** A menu, when there is one, holds at least two actions. */
async function expectMenuOfTwoOrNone(page: Page): Promise<void> {
    const trigger = page.getByTestId('header-overflow-menu');
    if ((await trigger.count()) === 0) {
        return;
    }
    await trigger.click();
    const items = page.locator('.mat-mdc-menu-panel [mat-menu-item]');
    await expect.poll(() => items.count()).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
}

async function enableParentalLock(page: Page): Promise<void> {
    await openSettings(page);
    await openSettingsSection(page, 'parental');
    const toggle = page.locator(
        '[data-test-id="parental-lock-enabled"] button[role="switch"]'
    );
    await toggle.click();
    await page.getByTestId('parental-lock-pin').fill(PIN);
    await page.getByTestId('parental-lock-pin-confirm').fill(PIN);
    await page.getByTestId('parental-lock-pin-submit').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

test.describe('Workspace header at the minimum window', () => {
    test('fits every action on a live route, overflowing only in pairs', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await enableParentalLock(page);
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page
                .locator('app-workspace-shell-rail')
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await page.waitForURL(/\/live/);
            await page
                .locator('.context-panel .category-item')
                .first()
                .click();
            await expect(page.getByTestId('header-parental-lock')).toBeVisible();

            await useMinimumWindow(app.electronApp);
            await expectHeaderFits(page);
            await expectMenuOfTwoOrNone(page);
            // Downloads never moves.
            await expect(
                page.getByRole('button', { name: /^Open downloads/ })
            ).toBeVisible();
            // Keyboard shortcuts are not in the header any more.
            await expect(
                page.locator('app-workspace-shell-header mat-icon', {
                    hasText: /^keyboard$/,
                })
            ).toHaveCount(0);
            await page.screenshot({ path: join(SCREENSHOTS, 'live-900.png') });

            // The palette opens the shortcuts the header no longer shows.
            await page.keyboard.press('Control+k');
            const palette = page.locator('.workspace-command-palette-overlay');
            await palette.locator('input[type="search"]').fill('keyboard');
            await palette
                .locator('.palette-command', { hasText: 'Keyboard shortcuts' })
                .first()
                .click();
            await expect(
                page
                    .getByRole('dialog')
                    .getByRole('heading', { name: 'Keyboard shortcuts' })
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('dashboard search launches global search', async ({ dataDir }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await goToDashboard(page);
            await useMinimumWindow(app.electronApp);

            const search = page.locator(
                'app-workspace-shell-header input[type="search"]'
            );
            await expect(search).toBeEnabled();
            await expect(search).toHaveAttribute(
                'placeholder',
                'Search all playlists...'
            );
            await expectHeaderFits(page);
            await page.screenshot({
                path: join(SCREENSHOTS, 'dashboard-900.png'),
            });

            await search.fill('news');
            await search.press('Enter');
            await expect(page).toHaveURL(/\/workspace\/search\?q=news$/);
            await expect(search).toHaveValue('news');
        } finally {
            await closeElectronApp(app);
        }
    });
});
