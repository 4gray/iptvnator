import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    restartElectronApp,
    saveSettings,
    test,
} from './electron-test-fixtures';

test('@settings @electron @persistence Portuguese regions and legacy preferences survive a cold restart', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    let app = await launchElectronApp(dataDir);
    try {
        for (const [code, label] of [
            ['pt-PT', 'Português (Portugal)'],
            ['pt-BR', 'Português (Brasil)'],
        ]) {
            await openSettings(app.mainWindow);
            await app.mainWindow.getByTestId('select-language').click();
            await app.mainWindow.getByTestId(code).click();
            await saveSettings(app.mainWindow);
            await expect(app.mainWindow.locator('html')).toHaveAttribute(
                'lang',
                code
            );
            app = await restartElectronApp(app, dataDir);
            await expect(app.mainWindow.locator('html')).toHaveAttribute(
                'lang',
                code
            );
            await openSettings(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('select-language')
            ).toContainText(label);
        }
        // Write the real renderer IndexedDB shape used by the old release.
        await app.mainWindow.evaluate(async () => {
            const database = await new Promise<IDBDatabase>(
                (resolve, reject) => {
                    const request = indexedDB.open('ngStorage');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                }
            );
            await new Promise<void>((resolve, reject) => {
                const transaction = database.transaction(
                    'localStorage',
                    'readwrite'
                );
                const store = transaction.objectStore('localStorage');
                const request = store.get('settings');
                request.onsuccess = () => {
                    const saved = request.result;
                    const settings = saved.value ?? saved;
                    settings.language = 'pt';
                    settings.mpvPlayerArguments = '--volume=73';
                    store.put(saved, 'settings');
                };
                transaction.oncomplete = () => resolve();
                transaction.onabort = () => reject(transaction.error);
                transaction.onerror = () => reject(transaction.error);
            });
            database.close();
            localStorage.setItem('iptvnator:preferred-language', 'pt');
        });
        app = await restartElectronApp(app, dataDir);
        await expect(app.mainWindow.locator('html')).toHaveAttribute(
            'lang',
            'pt-BR'
        );
        await openSettings(app.mainWindow);
        await expect(
            app.mainWindow.getByTestId('select-language')
        ).toContainText('Português (Brasil)');
        expect(
            await app.mainWindow.evaluate(() =>
                localStorage.getItem('iptvnator:preferred-language')
            )
        ).toBe('pt-BR');
        // A subsequent save canonicalizes the stored code without losing other settings.
        await app.mainWindow.getByTestId('select-language').click();
        await app.mainWindow.getByTestId('pt-PT').click();
        await saveSettings(app.mainWindow);
        const stored = await app.mainWindow.evaluate(async () => {
            const database = await new Promise<IDBDatabase>(
                (resolve, reject) => {
                    const request = indexedDB.open('ngStorage');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                }
            );
            const settings = await new Promise<Record<string, unknown>>(
                (resolve, reject) => {
                    const request = database
                        .transaction('localStorage')
                        .objectStore('localStorage')
                        .get('settings');
                    request.onsuccess = () =>
                        resolve(request.result.value ?? request.result);
                    request.onerror = () => reject(request.error);
                }
            );
            database.close();
            return settings;
        });
        expect(stored).toMatchObject({
            language: 'pt-PT',
            mpvPlayerArguments: '--volume=73',
        });
    } finally {
        await closeElectronApp(app);
    }
});
