import {
    addStalkerPortal,
    closeElectronApp,
    expect,
    fillWorkspaceSearch,
    launchElectronApp,
    openSources,
    restartElectronApp,
    sourceRowByTitle,
    test,
} from './electron-test-fixtures';

test('@stalker @electron @persistence keeps hidden categories after a cold restart', async ({
    dataDir,
}) => {
    let app = await launchElectronApp(dataDir);
    const name = 'Category visibility fixture';
    try {
        await addStalkerPortal(app.mainWindow, {
            name,
            macAddress: '00:1A:79:18:44:01',
        });
        const manage = () =>
            app.mainWindow.getByRole('button', { name: 'Manage categories' });
        const dialog = () => app.mainWindow.getByRole('dialog');
        const movie = () =>
            app.mainWindow
                .locator('app-grid-list')
                .getByRole('button', { name: 'Fixture Beta', exact: true });
        await expect(movie()).toBeVisible();
        await manage().click();
        await dialog()
            .getByRole('checkbox', { name: 'Fixture shows' })
            .uncheck();
        await dialog()
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect(dialog()).toBeHidden();
        await expect(movie()).toHaveCount(0);
        app = await restartElectronApp(app, dataDir);
        const page = app.mainWindow;
        await page
            .getByRole('link', { name: 'Global search', exact: true })
            .click();
        await expect(page).toHaveURL(/\/workspace\/search$/);
        await fillWorkspaceSearch(page, 'Fixture Beta', { submit: true });
        await expect(page).toHaveURL(
            (url) => url.searchParams.get('q') === 'Fixture Beta'
        );
        const result = page
            .getByRole('main')
            .getByRole('button', { name: 'Fixture Beta', exact: true });
        const visibleOnly = page.getByRole('checkbox', {
            name: 'Visible categories only',
        });
        await expect(result).toBeVisible();
        await visibleOnly.check();
        await expect(result).toHaveCount(0);
        await visibleOnly.uncheck();
        await result.click();
        await expect(
            page.getByRole('heading', { name: 'Episode 1', exact: true })
        ).toBeVisible();
        await openSources(app.mainWindow);
        await sourceRowByTitle(app.mainWindow, name).first().click();
        await manage().click();
        const checkbox = dialog().getByRole('checkbox', {
            name: 'Fixture shows',
        });
        await expect(checkbox).not.toBeChecked();
        await checkbox.check();
        await dialog()
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect(movie()).toBeVisible();
    } finally {
        await closeElectronApp(app);
    }
});
