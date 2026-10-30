import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

test('Video.js HLS waiting is explained and Retry resumes the same channel', async ({
    dataDir,
}, testInfo) => {
    test.setTimeout(70000);
    let available = false;
    const segment = readFileSync(
        join(__dirname, '../../xtream-mock-server/src/fixtures/live.mpegts')
    );
    const server = createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url?.includes('.m3u8')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.end(
                '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6,\nsegment.ts\n'
            );
        } else if (available) {
            res.setHeader('Content-Type', 'video/mp2t');
            res.end(segment);
        } else {
            res.writeHead(404);
            res.end('Synthetic unavailable segment');
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing local fixture port');
    const origin = `http://localhost:${address.port}`;
    const launched = await launchElectronApp(dataDir);
    const page = launched.mainWindow;
    try {
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.getByRole('dialog');
        expect(
            (await dialog.locator('.apd-method-grid').boundingBox())!.height
        ).toBeLessThan(125);
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('compact-electron-light.png'),
        });
        await dialog.getByRole('radio', { name: /Raw m3u text/ }).click();
        await dialog
            .locator('textarea')
            .fill(`#EXTM3U\n#EXTINF:-1,Recoverable HLS\n${origin}/live.m3u8`);
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await page.locator('[data-test-id="channel-item"]').first().click();
        const notice = page.locator('.vjs-hls-wait');
        await expect(notice).toBeVisible({ timeout: 25000 });
        for (const theme of ['light', 'dark']) {
            await page.evaluate((theme) => {
                document.body.classList.toggle('dark-theme', theme === 'dark');
                document.body.classList.toggle(
                    'light-theme',
                    theme === 'light'
                );
            }, theme);
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`hls-wait-electron-${theme}.png`),
            });
        }
        available = true;
        const retry = notice.getByRole('button', {
            name: 'Retry',
            exact: true,
        });
        await retry.focus();
        await retry.press('Enter');
        await expect
            .poll(
                () =>
                    page
                        .locator('app-vjs-player video')
                        .evaluate((v: HTMLVideoElement) => v.currentTime),
                { timeout: 30000 }
            )
            .toBeGreaterThan(0.5);
        await expect(notice).toBeHidden();
        await expect(
            page.locator('[data-test-id="channel-item"]').first()
        ).toContainText('Recoverable HLS');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('hls-playing-electron.png'),
        });
    } finally {
        await closeElectronApp(launched);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
