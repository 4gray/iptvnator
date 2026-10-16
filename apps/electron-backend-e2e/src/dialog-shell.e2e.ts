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

/**
 * Opens the Xtream account dialog through the command palette and waits for
 * its stats band; the dialog has no footer, so its header close is its only
 * in-dialog dismissal.
 */
async function openAccountInfoDialog(
    page: Awaited<ReturnType<typeof launchElectronApp>>['mainWindow']
): Promise<Locator> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('body').focus();
    await page.keyboard.press(`${modifier}+K`);
    const palette = page.locator(
        'mat-dialog-container app-workspace-command-palette'
    );
    await expect(palette).toBeVisible();
    await palette.locator('input[type="search"]').fill('account');
    await palette.getByRole('button', { name: /Account info/i }).click();

    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog.locator('.account-stat').first()).toBeVisible({
        timeout: 20_000,
    });
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
            const dialog = await openAccountInfoDialog(page);
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

    test('keeps the header close in place in a short window when the dialog has no footer', async ({
        dataDir,
        request,
    }) => {
        // Under 600px of height the shell lets Material's surface scroll a
        // dialog whole, so a stacked footer never squeezes the body. A
        // dialog without a footer has only the header close to dismiss it
        // with the mouse, and a scrolling surface would carry it away: such
        // a dialog keeps the body as the scroll owner instead.
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page.setViewportSize({ width: 1024, height: 520 });
            const dialog = await openAccountInfoDialog(page);
            await expect(dialog.locator('.account-panel').first()).toBeVisible({
                timeout: 20_000,
            });
            // Scroll both candidate owners to their end: a box with nothing
            // to scroll stays at 0, so the two scrollTop values name the
            // owner (a wheel event does not reach the surface under
            // Playwright's Electron driver, so this is set directly).
            const state = await dialog.evaluate((container) => {
                const body = container.querySelector(
                    'mat-dialog-content'
                ) as HTMLElement;
                const surface = container.querySelector(
                    '.mat-mdc-dialog-surface'
                ) as HTMLElement;
                for (const owner of [body, surface]) {
                    owner.scrollTop = owner.scrollHeight;
                }
                const close = container
                    .querySelector('.app-dialog__close')
                    ?.getBoundingClientRect();
                const frame = surface.getBoundingClientRect();
                return {
                    bodyScrolled: body.scrollTop,
                    surfaceScrolled: surface.scrollTop,
                    closeInsideFrame:
                        !!close &&
                        close.top >= frame.top - 1 &&
                        close.bottom <= frame.bottom + 1,
                };
            });
            // The content is taller than the 520px window, and the body
            // took the scroll: the header, and its close, stayed in place.
            expect(state.bodyScrolled).toBeGreaterThan(0);
            expect(state.surfaceScrolled).toBe(0);
            expect(state.closeInsideFrame).toBe(true);
        } finally {
            await closeElectronApp(app);
        }
    });
});
