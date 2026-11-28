import { expect, test } from './fixtures';
import sharp from 'sharp';
import { importPlaylist, selectPlayer, serveClip, startClip } from './player-settings-panel.fixture';

test.use({ serviceWorkers: 'block' });

for (const player of ['HTML5 video player', 'Video.js player', 'ArtPlayer']) {
    test(`${player}: fit modes follow viewport and survive fullscreen`, async ({ page }) => {
        await serveClip(page);
        await selectPlayer(page, player);
        await importPlaylist(page);
        const { view, video } = await startClip(page);
        const fit = view.locator('[data-test-id="player-controls-video-fit"]');
        // HTML5 video has a transparent baseline; use black behind synthetic pillarboxes.
        await video.evaluate((el: HTMLVideoElement) => { el.style.backgroundColor = 'black'; });
        const initial = await video.evaluate((el: HTMLVideoElement) => el.style.cssText);
        // Replace only this test's media with a 16:9 synthetic chart.
        await video.evaluate(async (el: HTMLVideoElement) => {
            const canvas = document.createElement('canvas');
            canvas.width = 1600; canvas.height = 900;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 1600, 900);
            ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1600, 80); ctx.fillRect(0, 820, 1600, 80);
            ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 80, 80, 740); ctx.fillRect(1520, 80, 80, 740);
            el.srcObject = canvas.captureStream(1);
            el.muted = true;
            const presented = new Promise<void>((resolve) => el.requestVideoFrameCallback(() => resolve()));
            await el.play();
            ctx.fillRect(1520, 80, 80, 740);
            await presented;
            el.pause();
        });
        for (const width of [2560, 3840, 1280]) {
            await page.setViewportSize({ width, height: 1080 });
            await view.evaluate((el, w) => {
                Object.assign((el as HTMLElement).style, { position: 'fixed', inset: '0', width: `${w}px`, height: '1080px', zIndex: '999' });
            }, width);
            for (const [name, value] of [['Crop', 'cover'], ['Stretch', 'fill']] as const) {
                await fit.click();
                await page.getByRole('menuitemradio', { name, exact: true }).click();
                await expect(video).toHaveCSS('object-fit', value);
                await expect(fit).toHaveAttribute('aria-pressed', 'true');
                const geometry = await video.evaluate((el: HTMLVideoElement) => ({
                    width: el.clientWidth, height: el.clientHeight,
                    sourceWidth: el.videoWidth, sourceHeight: el.videoHeight,
                }));
                expect(geometry.width).toBeGreaterThan(0);
                expect(geometry.height).toBeGreaterThan(0);
                expect(geometry.sourceWidth).toBe(1600);
                expect(geometry.width / geometry.height).toBeCloseTo(width / 1080, 1);
                // Hide chrome only while sampling actual rasterized video pixels.
                await page.addStyleTag({ content: 'app-player-controls { visibility: hidden !important; }' }).then(async (style) => {
                    const { data, info } = await sharp(await video.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
                    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
                    const top = at(Math.floor(info.width / 2), Math.floor(info.height * .02));
                    if (name === 'Crop' && width > 2000) {
                        expect(top[1]).toBeGreaterThan(200); // top red border cropped away
                        expect(top[0]).toBeLessThan(30);
                    } else if (name === 'Stretch') {
                        expect(top[0]).toBeGreaterThan(200); // source edge retained, distorted to viewport
                        expect(top[1]).toBeLessThan(30);
                    }
                    await style.evaluate((el) => el.remove());
                });
                await view.hover();
                await view.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
                await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
                await expect(video).toHaveCSS('object-fit', value);
                await view.hover();
                await view.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
                await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
                await expect(video).toHaveCSS('object-fit', value);
            }
        }
        await fit.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitemradio', { name: 'Original', exact: true }).click();
        await expect(fit).toHaveAttribute('aria-pressed', 'false');
        expect(await video.evaluate((el: HTMLVideoElement) => el.style.cssText)).toBe(initial);
        // Original keeps every source edge, with black pillarboxing on this viewport.
        await page.setViewportSize({ width: 2560, height: 1080 });
        await view.evaluate((el) => Object.assign((el as HTMLElement).style, { width: '2560px', height: '1080px' }));
        const style = await page.addStyleTag({ content: 'app-player-controls { visibility: hidden !important; }' });
        const { data, info } = await sharp(await video.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
        expect(Math.max(...pixel(5, Math.floor(info.height / 2)))).toBeLessThan(30);
        expect(pixel(Math.floor(info.width / 2), 5)[0]).toBeGreaterThan(200);
        await style.evaluate((el) => el.remove());
    });
}
