import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { selectWebPlayer } from './xtream-series-playback.fixture';

const origin = 'https://hls-wait.fixture.invalid';
const segment = readFileSync(
    join(__dirname, '../../xtream-mock-server/src/fixtures/live.mpegts')
);
test.use({
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    serviceWorkers: 'block',
});

for (const recovery of ['automatic', 'retry', 'legacy-fullscreen']) {
    test(`HLS prolonged wait stays recoverable: ${recovery}`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(70000);
        let available = false;
        let requests = 0;
        await page.route(`${origin}/**`, async (route) => {
            if (new URL(route.request().url()).pathname.endsWith('.m3u8')) {
                return route.fulfill({
                    contentType: 'application/vnd.apple.mpegurl',
                    body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6,\nsegment.ts\n',
                });
            }
            requests++;
            return route.fulfill(
                available
                    ? { contentType: 'video/mp2t', body: segment }
                    : { status: 404, body: 'Synthetic unavailable segment' }
            );
        });
        if (recovery === 'legacy-fullscreen')
            await selectWebPlayer(page, 'Video.js player', false);
        await page.goto('/');
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('radio', { name: /Raw m3u text/ }).click();
        await dialog
            .locator('textarea')
            .fill(`#EXTM3U\n#EXTINF:-1,Recoverable HLS\n${origin}/live.m3u8`);
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await page.locator('[data-test-id="channel-item"]').first().click();
        if (recovery === 'legacy-fullscreen') {
            await page.locator('app-vjs-player .video-js').hover();
            await page.locator('.vjs-fullscreen-control').click();
        }
        const notice = page.locator('.vjs-hls-wait');
        await expect(notice).toBeVisible({ timeout: 25000 });
        if (recovery === 'legacy-fullscreen') {
            expect(
                await notice.evaluate((el) =>
                    document.fullscreenElement?.contains(el)
                )
            ).toBe(true);
        }
        await expect(notice).toContainText('Still waiting for stream data');
        expect(requests).toBeGreaterThan(0);
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`hls-wait-${recovery}.png`),
        });
        available = true;
        if (recovery !== 'automatic') {
            await notice
                .getByRole('button', { name: 'Retry', exact: true })
                .focus();
            await notice
                .getByRole('button', { name: 'Retry', exact: true })
                .press('Enter');
        }
        const video = page.locator('app-vjs-player video');
        await expect
            .poll(
                () => video.evaluate((v: HTMLVideoElement) => v.currentTime),
                { timeout: 30000 }
            )
            .toBeGreaterThan(0.5);
        await expect(notice).toBeHidden();
        await expect(
            page.locator('[data-test-id="channel-item"]').first()
        ).toContainText('Recoverable HLS');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`hls-playing-${recovery}.png`),
        });
    });
}
