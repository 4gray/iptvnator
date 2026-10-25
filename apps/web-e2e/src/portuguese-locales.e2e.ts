import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function selectLanguage(page: Page, code: string) {
    await page.locator('[data-test-id="select-language"]').click();
    await page.locator(`mat-option[data-test-id="${code}"]`).click();
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click({ noWaitAfter: true });
    await expect(save).toBeHidden();
}

test('@settings @web Portuguese regions remain distinct after saving and reloading', async ({
    page,
    baseURL,
}) => {
    const requested: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/assets/i18n/'))
            requested.push(request.url());
    });
    const applicationOrigin = new URL(String(baseURL)).origin;
    await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === applicationOrigin
            ? route.continue()
            : route.abort()
    );
    await page.goto('/workspace/settings/general');
    await selectLanguage(page, 'pt-PT');
    await expect
        .poll(() =>
            page.evaluate(() =>
                localStorage.getItem('iptvnator:preferred-language')
            )
        )
        .toBe('pt-PT');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
    await expect(
        page.locator('[data-test-id="select-language"]')
    ).toContainText('Português (Portugal)');
    await expect(
        page.locator('app-workspace-settings-context-panel')
    ).toContainText('Definições');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
    await expect(
        page.locator('[data-test-id="select-language"]')
    ).toContainText('Português (Portugal)');

    await selectLanguage(page, 'pt-BR');
    await expect
        .poll(() =>
            page.evaluate(() =>
                localStorage.getItem('iptvnator:preferred-language')
            )
        )
        .toBe('pt-BR');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(
        page.locator('app-workspace-settings-context-panel')
    ).toContainText('Configurações');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(
        page.locator('[data-test-id="select-language"]')
    ).toContainText('Português (Brasil)');
    expect(requested.some((url) => url.endsWith('/pt-PT.json'))).toBe(true);
    expect(requested.some((url) => url.endsWith('/pt-BR.json'))).toBe(true);
    // Simulate the settings written by the previous release, including its
    // startup hint. The new build must never request the removed pt.json.
    await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('ngStorage');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(
                'localStorage',
                'readwrite'
            );
            const store = transaction.objectStore('localStorage');
            const request = store.get('settings');
            request.onsuccess = () => {
                const saved = request.result;
                if (saved.value) saved.value.language = 'pt';
                else saved.language = 'pt';
                store.put(saved, 'settings');
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        database.close();
        localStorage.setItem('iptvnator:preferred-language', 'pt');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(
        page.locator('[data-test-id="select-language"]')
    ).toContainText('Português (Brasil)');
    await expect
        .poll(() =>
            page.evaluate(() =>
                localStorage.getItem('iptvnator:preferred-language')
            )
        )
        .toBe('pt-BR');
    expect(requested.some((url) => url.endsWith('/pt.json'))).toBe(false);
});
