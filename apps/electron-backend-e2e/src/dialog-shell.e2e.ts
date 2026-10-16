import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openWorkspaceSection,
    test,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// The dialog shell's heading often carries provider text: a channel name, an
// episode's file name. Such a string may have no break opportunity at all,
// and a heading that cannot wrap runs under the close button at the header's
// end. The shell wraps its heading anywhere instead.
// ---------------------------------------------------------------------------

const UNBREAKABLE_NAME =
    'Channel_name_with_no_spaces_at_all_as_some_providers_write_them_1080p';

test.describe('Dialog shell', () => {
    test('wraps an unbreakable heading before it reaches the close button', async ({
        dataDir,
    }) => {
        const m3u = await createMutableTextServer(
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
        let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            app = await launchElectronApp(dataDir);
            const page = app.mainWindow;
            await page.route('https://example.com/**', (route) =>
                route.abort()
            );
            await importM3uPlaylistFromUrl(page, m3u.resourceUrl);
            // A narrow window leaves the heading no room beside the tile
            // and the close button.
            await page.setViewportSize({ width: 560, height: 760 });
            await openWorkspaceSection(page, 'All channels');
            await channelItemByTitle(page, UNBREAKABLE_NAME).click({
                button: 'right',
            });
            await page
                .getByRole('menuitem', { name: 'Show channel details' })
                .click();

            const dialog = page.locator('mat-dialog-container').last();
            await expect(dialog).toBeVisible();
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
});
