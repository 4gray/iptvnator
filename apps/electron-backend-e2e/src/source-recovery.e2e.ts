import { createServer, type ServerResponse } from 'node:http';
import type { Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    stalkerMockServer,
    test,
} from './electron-test-fixtures';

async function faultSource() {
    const pending: (() => void)[] = [];
    const state = {
        m3u: 'missing',
        holdDiscovery: false,
        failCategory: false,
        waiting: 0,
    };
    const hold = () =>
        new Promise<void>((resolve) => {
            state.waiting++;
            pending.push(resolve);
        });
    const server = createServer(async (req, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/list.m3u') {
            if (state.m3u === 'missing') {
                res.writeHead(404);
                res.end();
                return;
            }
            if (state.m3u === 'pending') await hold();
            res.end(
                '#EXTM3U\n#EXTINF:-1,Audit channel\nhttp://fixture.invalid/stream.m3u8\n'
            );
            return;
        }
        if (
            state.holdDiscovery &&
            url.searchParams.get('action') === 'get_genres'
        )
            await hold();
        if (
            state.failCategory &&
            url.searchParams.get('action') === 'get_ordered_list'
        ) {
            res.writeHead(503);
            res.end('Synthetic unavailable source');
            return;
        }
        const response = await fetch(stalkerMockServer + req.url, {
            headers: {
                ...Object.fromEntries(
                    Object.entries(req.headers).flatMap(([key, value]) =>
                        typeof value === 'string' ? [[key, value]] : []
                    )
                ),
                host: new URL(stalkerMockServer).host,
            },
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing fixture port');
    return {
        state,
        origin: `http://localhost:${address.port}`,
        release: () => {
            pending.splice(0).forEach((resolve) => resolve());
        },
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

async function openForm(page: Page, method: RegExp) {
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: method }).click();
    return dialog;
}

test('M3U error keeps input, pending submit is single-flight, Cancel retires late IPC', async ({
    dataDir,
}, testInfo) => {
    const source = await faultSource();
    const launched = await launchElectronApp(dataDir);
    const { mainWindow: page } = launched;
    try {
        let dialog = await openForm(page, /M3U URL/);
        await dialog
            .getByRole('textbox', { name: /Playlist URL/ })
            .fill(source.origin + '/list.m3u');
        await dialog
            .getByRole('textbox', { name: 'Playlist title' })
            .fill('Preserved draft');
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog.getByRole('alert')).toContainText('404');
        await expect(
            dialog.getByRole('textbox', { name: 'Playlist title' })
        ).toHaveValue('Preserved draft');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('m3u-error-light.png'),
        });
        source.state.m3u = 'pending';
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog.getByRole('status')).toContainText(
            'Fetching playlist'
        );
        await expect(
            dialog.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeDisabled();
        await expect.poll(() => source.state.waiting).toBe(1);
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('m3u-pending-light.png'),
        });
        await dialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        source.state.m3u = 'ok';
        source.release();
        dialog = await openForm(page, /M3U URL/);
        await expect(
            dialog.getByRole('textbox', { name: 'Playlist title' })
        ).toHaveValue('');
        await dialog
            .getByRole('textbox', { name: /Playlist URL/ })
            .fill(source.origin + '/list.m3u');
        await dialog
            .getByRole('textbox', { name: 'Playlist title' })
            .fill('Committed once');
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        await page.getByRole('link', { name: 'Sources', exact: true }).click();
        await expect(page.locator('app-source-row')).toHaveCount(1);
        await expect(page.locator('app-source-row')).toContainText(
            'Committed once'
        );
    } finally {
        await closeElectronApp(launched);
        source.release();
        await source.close();
    }
});

test('Stalker Cancel retires discovery, category Retry preserves the selection', async ({
    dataDir,
}, testInfo) => {
    const source = await faultSource();
    const launched = await launchElectronApp(dataDir);
    const { mainWindow: page } = launched;
    try {
        source.state.holdDiscovery = true;
        let dialog = await openForm(page, /Stalker portal/);
        const fill = async (title: string) => {
            await dialog.locator('#title').fill(title);
            await dialog
                .locator('#portalUrl')
                .fill(source.origin + '/portal.php');
            await dialog.locator('#macAddress').fill('00:1A:79:5E:40:31');
            await dialog
                .getByRole('button', { name: 'Add playlist', exact: true })
                .click();
        };
        await fill('Cancelled source');
        await expect.poll(() => source.state.waiting).toBe(1);
        await dialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        source.state.holdDiscovery = false;
        source.release();
        dialog = await openForm(page, /Stalker portal/);
        await fill('Recovery portal');
        await expect(dialog).toBeHidden();
        await expect(page.locator('.category-item').nth(2)).toBeVisible();
        source.state.failCategory = true;
        await page.locator('.category-item').nth(2).click();
        const error = page.locator('.catalog-load-error');
        await expect(error).toContainText('Could not load this category');
        const categoryUrl = page.url();
        await expect(page.getByText('No content in this category')).toHaveCount(
            0
        );
        for (const theme of ['light', 'dark']) {
            await page.evaluate((theme) => {
                document.body.classList.toggle('dark-theme', theme === 'dark');
                document.body.classList.toggle(
                    'light-theme',
                    theme === 'light'
                );
            }, theme);
            await error
                .getByRole('button', { name: 'Retry', exact: true })
                .focus();
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`category-error-${theme}.png`),
            });
        }
        source.state.failCategory = false;
        await error
            .getByRole('button', { name: 'Retry', exact: true })
            .press('Enter');
        await expect(error).toBeHidden();
        await expect(
            page.locator('app-grid-list mat-card').first()
        ).toBeVisible();
        await expect(page).toHaveURL(categoryUrl);
        await page.getByRole('link', { name: 'Sources', exact: true }).click();
        await expect(page.locator('app-source-row')).toHaveCount(1);
        await expect(page.locator('app-source-row')).toContainText(
            'Recovery portal'
        );
    } finally {
        await closeElectronApp(launched);
        source.release();
        await source.close();
    }
});
