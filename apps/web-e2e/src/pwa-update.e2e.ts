import { test, expect, type Page } from '@playwright/test';
import { servePwaUpdateFixture } from './pwa-update.fixture';

// eslint-disable-next-line playwright/no-skipped-test -- Requires the actual production worker and build.
test.skip(
    process.env['IPTVNATOR_E2E_PWA_UPDATES'] !== '1',
    'Run web-e2e:pwa-updates'
);

async function checkWorker(page: Page) {
    return page.evaluate(
        () =>
            new Promise<boolean>((resolve) => {
                const nonce = Date.now();
                const listener = (event: MessageEvent) => {
                    if (
                        event.data.type !== 'OPERATION_COMPLETED' ||
                        event.data.nonce !== nonce
                    )
                        return;
                    navigator.serviceWorker.removeEventListener(
                        'message',
                        listener
                    );
                    resolve(event.data.result);
                };
                navigator.serviceWorker.addEventListener('message', listener);
                navigator.serviceWorker.controller!.postMessage({
                    action: 'CHECK_FOR_UPDATES',
                    nonce,
                });
            })
    );
}

test('retains the offline library after failed updates and protects unsaved settings @pwa @critical', async ({
    page,
    context,
}, info) => {
    const fixture = await servePwaUpdateFixture();
    try {
        await page.goto(fixture.origin + '/workspace/sources');
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.getByRole('dialog');
        await dialog
            .getByRole('radio', { name: /M3U file|file upload/i })
            .click();
        await dialog.locator('input[type="file"]').setInputFiles({
            name: 'Audit source.m3u',
            mimeType: 'audio/x-mpegurl',
            buffer: Buffer.from(
                '#EXTM3U\n#EXTINF:-1,Audit channel\nhttps://stream.example.test/audit.ts'
            ),
        });
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        await page.locator('a[href$="/workspace/settings"]').click();
        await page
            .locator('[data-test-id="settings-section-appearance"]')
            .click();
        await page.getByRole('radio', { name: 'Dark', exact: true }).click();
        await page.locator('[data-test-id="save-settings"]').click();
        await expect(
            page.locator('[data-test-id="save-settings"]')
        ).toBeHidden();
        await page.getByRole('link', { name: 'Sources', exact: true }).click();
        const rows = page.locator('app-source-row');
        await expect(rows).toHaveCount(1);
        await expect
            .poll(
                () => page.evaluate(() => !!navigator.serviceWorker.controller),
                { timeout: 45_000 }
            )
            .toBe(true);

        fixture.state.updated = true;
        fixture.state.failIndex = true;
        expect(await checkWorker(page)).toBe(false);
        const notice = page.locator('[data-test-id="pwa-update-notification"]');
        await expect(notice).toContainText('could not be downloaded');
        await page.screenshot({
            path: info.outputPath('update-failed-dark.png'),
        });
        await context.setOffline(true);
        const offline = await page.reload();
        expect(offline?.status()).toBe(200);
        expect(offline?.fromServiceWorker()).toBe(true);
        await expect(rows).toHaveCount(1);
        await expect(page.locator('body')).toHaveClass(/dark-theme/);
        await page.screenshot({
            path: info.outputPath('offline-library-retained.png'),
        });

        await context.setOffline(false);
        // Transport emulation is scoped to this context; resume is an explicit DOM signal.
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(notice).toContainText('could not be downloaded');
        fixture.state.failManifest = true;
        await notice
            .getByRole('button', { name: 'Retry', exact: true })
            .click();
        await expect(
            notice.getByRole('button', { name: 'Retry', exact: true })
        ).toBeEnabled();
        await expect(notice).toContainText('could not be downloaded');
        await expect(
            notice.getByRole('button', { name: 'Retry', exact: true })
        ).toBeVisible();
        fixture.state.failManifest = false;
        fixture.state.failIndex = false;
        await notice
            .getByRole('button', { name: 'Retry', exact: true })
            .click();
        await expect(notice).toContainText('An update is ready');
        fixture.state.failManifest = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(notice).toContainText('An update is ready');
        fixture.state.failManifest = false;
        expect(await checkWorker(page)).toBe(false);
        await expect(notice).toContainText('An update is ready');
        await page.evaluate(() => Reflect.set(window, 'auditDocument', true));
        await page.locator('a[href$="/workspace/settings"]').click();
        await page
            .locator('[data-test-id="settings-section-appearance"]')
            .click();
        await page.getByRole('radio', { name: 'Light', exact: true }).click();
        const beforeUnload = page.waitForEvent('dialog');
        const refreshClick = notice
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        const prompt = await beforeUnload;
        expect(prompt.type()).toBe('beforeunload');
        await prompt.dismiss();
        await refreshClick;
        await expect(
            notice.getByRole('button', { name: 'Refresh', exact: true })
        ).toBeVisible();
        expect(
            await page.evaluate(() => Reflect.get(window, 'auditDocument'))
        ).toBe(true);
        await expect(
            page.locator('[data-test-id="save-settings"]')
        ).toBeVisible();
        await page.setViewportSize({ width: 480, height: 900 });
        await page.locator('[data-test-id="save-settings"]').click();
        await expect(
            page.locator('[data-test-id="save-settings"]')
        ).toBeHidden();
        await notice
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        await expect(page.locator('meta[name="audit-update"]')).toHaveAttribute(
            'content',
            'b'
        );
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.getByRole('link', { name: 'Sources', exact: true }).click();
        await expect(rows).toHaveCount(1);
        await expect(page.locator('body')).not.toHaveClass(/dark-theme/);

        fixture.state.corrupt = true;
        expect(await checkWorker(page)).toBe(false);
        await expect(notice).toContainText('could not be downloaded');
        await context.setOffline(true);
        expect((await page.reload())?.status()).toBe(200);
        await expect(rows).toHaveCount(1);
        await page.screenshot({
            path: info.outputPath('hash-mismatch-retains-library-light.png'),
        });
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(notice).toContainText('could not be downloaded');
        fixture.state.corrupt = false;
        await notice
            .getByRole('button', { name: 'Retry', exact: true })
            .click();
        await expect(notice).toBeHidden();
    } finally {
        if (!page.isClosed()) await context.setOffline(false);
        await fixture.close();
    }
});
