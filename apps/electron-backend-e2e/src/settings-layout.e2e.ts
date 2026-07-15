import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    test,
} from './electron-test-fixtures';

test.describe('Electron Settings Layout', () => {
    test('@settings @electron keeps the save action in a compact floating chip', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);

            const layout = app.mainWindow.locator('.settings-layout');
            const actionBar = app.mainWindow.getByTestId('settings-action-bar');
            await expect(layout).toBeVisible();
            await expect(actionBar).toBeVisible();

            const [layoutBox, actionBarBox] = await Promise.all([
                layout.evaluate((element) => {
                    const { width, x } = element.getBoundingClientRect();
                    return { width, x };
                }),
                actionBar.evaluate((element) => {
                    const { width, x } = element.getBoundingClientRect();
                    return { width, x };
                }),
            ]);

            expect(actionBarBox.width).toBeLessThan(layoutBox.width / 2);
            expect(
                Math.abs(
                    layoutBox.x +
                        layoutBox.width -
                        (actionBarBox.x + actionBarBox.width)
                )
            ).toBeLessThanOrEqual(2);

            const actionBarStyles = await actionBar.evaluate((element) => {
                const styles = getComputedStyle(element);
                return {
                    bottom: Number.parseFloat(styles.bottom),
                    position: styles.position,
                };
            });
            expect(actionBarStyles.position).toBe('sticky');
            expect(actionBarStyles.bottom).toBeGreaterThanOrEqual(24);
            expect(
                await layout.evaluate((element) =>
                    Number.parseFloat(getComputedStyle(element).paddingBottom)
                )
            ).toBeGreaterThanOrEqual(112);

            const scrollViewport = app.mainWindow.locator('.workspace-content');
            const finalSection = app.mainWindow.locator(
                'app-settings-about-section .settings-group'
            );
            await scrollViewport.evaluate((element) => {
                element.scrollTop = element.scrollHeight / 2;
            });
            await expect
                .poll(() =>
                    scrollViewport.evaluate((element) => element.scrollTop)
                )
                .toBeGreaterThan(0);

            const [viewportBox, stickyActionBarBox] = await Promise.all([
                scrollViewport.boundingBox(),
                actionBar.boundingBox(),
            ]);
            expect(viewportBox).not.toBeNull();
            expect(stickyActionBarBox).not.toBeNull();
            const viewport = viewportBox as NonNullable<typeof viewportBox>;
            const stickyActionBar = stickyActionBarBox as NonNullable<
                typeof stickyActionBarBox
            >;
            expect(stickyActionBar.y).toBeGreaterThanOrEqual(viewport.y);
            expect(
                stickyActionBar.y + stickyActionBar.height
            ).toBeLessThanOrEqual(viewport.y + viewport.height);

            await scrollViewport.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
            const [finalSectionBox, finalActionBarBox] = await Promise.all([
                finalSection.boundingBox(),
                actionBar.boundingBox(),
            ]);
            expect(finalSectionBox).not.toBeNull();
            expect(finalActionBarBox).not.toBeNull();
            const finalSectionBounds = finalSectionBox as NonNullable<
                typeof finalSectionBox
            >;
            const finalActionBarBounds = finalActionBarBox as NonNullable<
                typeof finalActionBarBox
            >;
            expect(
                finalSectionBounds.y + finalSectionBounds.height
            ).toBeLessThanOrEqual(finalActionBarBounds.y);
        } finally {
            await closeElectronApp(app);
        }
    });
});
