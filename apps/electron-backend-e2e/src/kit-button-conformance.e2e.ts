import type { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    buildM3uContent,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    createMutableTextServer,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    goToDashboard,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openGlobalFavorites,
    openSettings,
    openSettingsSection,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamLiveFixture,
} from './portal-mock-fixtures';

// ---------------------------------------------------------------------------
// Every visible button is a UI kit button (libs/ui/styles/_app-controls.scss):
// an icon button is a square with an 8px radius, and a text or flat button is
// neither a pill nor outlined. A button without a kit mixin falls back to
// Material's look, a 40px circle or a primary pill, so this measures what the
// renderer draws rather than which classes a template uses.
// ---------------------------------------------------------------------------

/**
 * Buttons that are round or outlined on purpose. A match on the button or any
 * ancestor skips it.
 */
const ALLOWED_EXCEPTIONS = [
    // Player controls draw on the `--pc-*` palette over video.
    '.video-js',
    'app-player-controls',
    'app-player-settings-panel',
    // Colour swatches are circles of the colour they pick.
    '.system-pair__swatch',
    // Awaiting a design decision (UI-75 PR): the dashboard rail's "More"
    // trigger, the rail scroll chevrons over posters and the Settings
    // segmented looks.
    '.rail__action-trigger',
    '.rail__chev',
    '.system-pair__option',
    '.theme-switcher',
    // Not buttons of the kit's button roles.
    '.mat-mdc-menu-item',
    'mat-button-toggle',
    '.mat-mdc-chip',
    '.mat-mdc-slide-toggle',
].join(', ');

const SAMPLE_CHANNELS = [
    { name: 'Kit Channel One', group: 'Kit News' },
    { name: 'Kit Channel Two', group: 'Kit News' },
    { name: 'Kit Channel Three', group: 'Kit Sports' },
];

const SETTINGS_SECTIONS = [
    'general',
    'appearance',
    'playback',
    'epg',
    'dashboard',
    'parental',
    'remote-control',
    'tmdb',
    'backup',
    'server',
    'about',
];

/** Describes each visible button that is round, a pill or outlined. */
async function offKitButtons(page: Page): Promise<string[]> {
    return page.evaluate((allowed) => {
        const px = (value: string, basis: number) =>
            value.endsWith('%')
                ? (parseFloat(value) / 100) * basis
                : parseFloat(value) || 0;
        const found: string[] = [];
        const buttons = document.querySelectorAll<HTMLElement>(
            'button.mat-mdc-button-base, a.mat-mdc-button-base'
        );
        for (const button of buttons) {
            if (button.closest(allowed)) continue;
            const rect = button.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (
                !button.checkVisibility({
                    opacityProperty: false,
                    visibilityProperty: true,
                })
            )
                continue;
            if (
                rect.bottom <= 0 ||
                rect.right <= 0 ||
                rect.top >= window.innerHeight ||
                rect.left >= window.innerWidth
            )
                continue;
            const style = getComputedStyle(button);
            const short = Math.min(rect.width, rect.height);
            const radius = px(style.borderTopLeftRadius, short);
            const border = parseFloat(style.borderTopWidth) || 0;
            const isIcon = button.classList.contains('mat-mdc-icon-button');
            const problems: string[] = [];
            if (radius >= short / 2 - 0.5) {
                problems.push(isIcon ? 'circle' : 'pill');
            }
            if (!isIcon && border > 0 && style.borderTopStyle !== 'none') {
                problems.push(`${border}px border`);
            }
            if (!problems.length) continue;
            const classes = [...button.classList]
                .filter((name) => !/^(mat|mdc|cdk)-/.test(name))
                .join('.');
            const name =
                button.getAttribute('aria-label') ||
                button.textContent?.replace(/\s+/g, ' ').trim() ||
                '';
            found.push(
                `${problems.join(' + ')}: ${button.tagName.toLowerCase()}` +
                    `${classes ? '.' + classes : ''} "${name.slice(0, 40)}" ` +
                    `${Math.round(rect.width)}x${Math.round(rect.height)} ` +
                    `r=${style.borderTopLeftRadius}`
            );
        }
        // A list repeats one row's buttons per row: report each once.
        return [...new Set(found)];
    }, ALLOWED_EXCEPTIONS);
}

/**
 * Records the view's off-kit buttons as a soft failure, so one run lists every
 * view instead of stopping at the first.
 */
async function expectKitButtons(page: Page, view: string): Promise<void> {
    // Let entering views and dialogs settle; their buttons measure the same,
    // but a button mid-animation can still be off screen.
    await page.waitForTimeout(250);
    expect
        .soft(await offKitButtons(page), `off-kit buttons in ${view}`)
        .toEqual([]);
}

async function openSettled(page: Page, dialogContent: string) {
    const dialog = page.locator('mat-dialog-container').filter({
        has: page.locator(dialogContent),
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.mat-mdc-dialog-surface')).toHaveCSS(
        'transform',
        'none'
    );
    return dialog;
}

test.describe('Kit button conformance', () => {
    test('@electron first-run views and every settings page', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await goToDashboard(page);
            await expect(page.locator('.welcome-dashboard')).toBeVisible();
            await expectKitButtons(page, 'first-run dashboard');

            await openSources(page);
            await expect(page.locator('.welcome-sources')).toBeVisible();
            await expectKitButtons(page, 'first-run sources');

            await openGlobalFavorites(page);
            await expect(page.locator('.no-data-state')).toBeVisible();
            await expectKitButtons(page, 'empty global favorites');

            await openSettings(page);
            for (const section of SETTINGS_SECTIONS) {
                await openSettingsSection(page, section);
                await expectKitButtons(page, `settings ${section}`);
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @m3u channel lists, sources and their dialogs', async ({
        dataDir,
    }) => {
        const server = await createMutableTextServer(
            buildM3uContent(
                SAMPLE_CHANNELS.map(({ name, group }, index) => ({
                    name,
                    groupTitle: group,
                    url: `https://example.com/live/kit-${index}.m3u8`,
                }))
            ),
            {
                contentType: 'application/x-mpegurl; charset=utf-8',
                resourcePath: '/kit.m3u',
            }
        );
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await page.route('https://example.com/**', (route) =>
                route.abort()
            );
            await importM3uPlaylistFromUrl(page, server.resourceUrl);

            await openWorkspaceSection(page, 'All channels');
            const row = channelItemByTitle(page, SAMPLE_CHANNELS[0].name);
            await expect(row).toBeVisible();
            await row.hover();
            await expectKitButtons(page, 'M3U all channels');

            await row.click({ button: 'right' });
            await page
                .getByRole('menuitem', { name: 'Show channel details' })
                .click();
            await openSettled(page, 'app-channel-details-dialog');
            await expectKitButtons(page, 'channel details dialog');
            await page.keyboard.press('Escape');

            await openWorkspaceSection(page, 'Groups');
            await expect(
                page.locator('app-groups-view .group-nav-item').first()
            ).toBeVisible();
            await page
                .locator('app-groups-view .group-nav-item')
                .first()
                .click();
            await expectKitButtons(page, 'M3U groups');

            await openSources(page);
            await expectKitButtons(page, 'sources');
            await page
                .getByRole('button', {
                    name: 'Clean up inactive sources…',
                    exact: true,
                })
                .click();
            await openSettled(page, 'app-source-cleanup-dialog');
            await expect(
                page.getByRole('button', {
                    name: 'Select all candidates',
                    exact: true,
                })
            ).toBeVisible({ timeout: 20_000 });
            await expectKitButtons(page, 'source cleanup dialog');
        } finally {
            await closeElectronApp(app);
            await server.close();
        }
    });

    test('@electron @xtream @stalker live channel lists and the dashboard', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream', 'stalker']);
        const xtreamLive = await fetchXtreamLiveFixture(request, {
            username: defaultXtreamUsername,
            password: defaultXtreamPassword,
        });
        const stalkerLive = await fetchStalkerCategoryFixture(request, 'itv');
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, xtreamLive.categoryName);
            await expect(
                page.getByRole('button', { name: 'Sort channels', exact: true })
            ).toBeVisible();
            await expectKitButtons(page, 'Xtream live');

            await addStalkerPortal(page);
            await waitForStalkerCatalog(page);
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, stalkerLive.categoryName);
            await expect(
                page.getByRole('button', {
                    name: 'Hide categories and channels',
                    exact: true,
                })
            ).toBeVisible();
            await expectKitButtons(page, 'Stalker live');

            await goToDashboard(page);
            await expectKitButtons(page, 'dashboard');
        } finally {
            await closeElectronApp(app);
        }
    });
});
