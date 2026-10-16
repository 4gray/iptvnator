import type { Locator } from '@playwright/test';
import {
    addXtreamPortal,
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// The dialog shell's heading often carries provider text: a channel name, an
// episode's file name. Such a string may have no break opportunity at all,
// and a heading that cannot wrap runs under the close button at the header's
// end. The shell wraps its heading anywhere instead.
// ---------------------------------------------------------------------------

const UNBREAKABLE_NAME =
    'Channel_name_with_no_spaces_at_all_as_some_providers_write_them_1080p';

/**
 * Imports a one-channel playlist and opens that channel's details in a
 * narrow window, where the heading has no room beside the tile and the
 * close button and the hero band's stats stack.
 */
async function openChannelDetailsNarrow(
    app: Awaited<ReturnType<typeof launchElectronApp>>,
    resourceUrl: string
): Promise<Locator> {
    const page = app.mainWindow;
    await page.route('https://example.com/**', (route) => route.abort());
    await importM3uPlaylistFromUrl(page, resourceUrl);
    await page.setViewportSize({ width: 560, height: 760 });
    await openWorkspaceSection(page, 'All channels');
    await channelItemByTitle(page, UNBREAKABLE_NAME).click({
        button: 'right',
    });
    await page.getByRole('menuitem', { name: 'Show channel details' }).click();
    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog).toBeVisible();
    return dialog;
}

async function serveUnbreakableChannel() {
    return createMutableTextServer(
        buildM3uContent([
            {
                name: UNBREAKABLE_NAME,
                url: 'https://example.com/live/unbreakable.m3u8',
            },
        ]),
        {
            contentType: 'application/x-mpegurl; charset=utf-8',
            resourcePath: '/unbreakable.m3u',
        }
    );
}

test.describe('Dialog shell', () => {
    test('wraps an unbreakable heading before it reaches the close button', async ({
        dataDir,
    }) => {
        const m3u = await serveUnbreakableChannel();
        let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            app = await launchElectronApp(dataDir);
            const dialog = await openChannelDetailsNarrow(app, m3u.resourceUrl);
            const geometry = await dialog.evaluate((container) => {
                const title = container.querySelector(
                    '.app-dialog__title'
                ) as HTMLElement;
                const close = container.querySelector(
                    '.app-dialog__close'
                ) as HTMLElement;
                const header = container.querySelector(
                    '.app-dialog__header'
                ) as HTMLElement;
                const titleBox = title.getBoundingClientRect();
                return {
                    lines: Math.round(
                        titleBox.height /
                            parseFloat(getComputedStyle(title).lineHeight)
                    ),
                    titleRight: titleBox.right,
                    closeLeft: close.getBoundingClientRect().left,
                    headerRight: header.getBoundingClientRect().right,
                    overflows: title.scrollWidth > title.clientWidth + 1,
                };
            });

            expect(geometry.lines).toBeGreaterThan(1);
            expect(geometry.overflows).toBe(false);
            expect(geometry.titleRight).toBeLessThanOrEqual(geometry.closeLeft);
            expect(geometry.titleRight).toBeLessThanOrEqual(
                geometry.headerRight
            );
        } finally {
            if (app) await closeElectronApp(app);
            await m3u.close();
        }
    });

    test('keeps a hero band stretched to the dialog in a narrow window', async ({
        dataDir,
        request,
    }) => {
        // The band is a grid; a narrow-window rule that re-aligns its status
        // pills must not touch the grid itself, or its column stops
        // stretching and the stats shrink to their content. The account
        // dialog shows it: its stats stack in one column there, with short
        // values that are far narrower than the band.
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page.setViewportSize({ width: 560, height: 760 });
            const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
            await page.locator('body').focus();
            await page.keyboard.press(`${modifier}+K`);
            const palette = page.locator(
                'mat-dialog-container app-workspace-command-palette'
            );
            await expect(palette).toBeVisible();
            await palette.locator('input[type="search"]').fill('account');
            await palette
                .getByRole('button', { name: /Account info/i })
                .click();

            const dialog = page.locator('mat-dialog-container').last();
            await expect(dialog.locator('.account-stat').first()).toBeVisible({
                timeout: 20_000,
            });
            const geometry = await dialog.evaluate((container) => {
                const hero = container.querySelector(
                    '.account-dialog__hero'
                ) as HTMLElement;
                const stats = container.querySelector(
                    '.account-dialog__hero-stats'
                ) as HTMLElement;
                const body = container.querySelector(
                    'mat-dialog-content'
                ) as HTMLElement;
                const heroStyle = getComputedStyle(hero);
                return {
                    heroWidth: hero.getBoundingClientRect().width,
                    // The body's width without its scrollbar: the CI runners
                    // draw a classic 15px one inside the box, a local Mac
                    // overlays it. The bounding width keeps the fraction the
                    // integer clientWidth would round away.
                    bodyWidth:
                        body.getBoundingClientRect().width -
                        (body.offsetWidth - body.clientWidth),
                    statsWidth: stats.getBoundingClientRect().width,
                    heroInner:
                        hero.getBoundingClientRect().width -
                        parseFloat(heroStyle.paddingLeft) -
                        parseFloat(heroStyle.paddingRight),
                };
            });
            // Edge to edge under the header, and the stats fill the band.
            expect(
                Math.abs(geometry.heroWidth - geometry.bodyWidth)
            ).toBeLessThanOrEqual(1);
            expect(geometry.statsWidth).toBeGreaterThanOrEqual(
                geometry.heroInner - 1
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});
