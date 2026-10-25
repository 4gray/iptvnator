import { resolve } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, Page } from '@playwright/test';
import { nav } from './helpers';

export async function prepareLiveMedia(page: Page) {
    // Serve native media directly: redirected requests bypass Playwright routing.
    await page.route('**/*', (route) =>
        route.request().resourceType() === 'media'
            ? route.fulfill({
                  path: resolve(
                      workspaceRoot,
                      'apps/web-e2e/src/fixtures/playback/episode.webm'
                  ),
                  contentType: 'video/webm',
              })
            : route.fallback()
    );
    await nav(page, 'TV');
    const video = page.locator('video');
    await video.evaluate((v: HTMLVideoElement) => {
        // Chromium does not decode provider HLS. Keep native decoding and loads,
        // substituting only the test media URL, with channel identity in its query.
        const src = Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'src'
        )!;
        Object.defineProperty(v, 'src', {
            configurable: true,
            get: () => src.get!.call(v),
            set: (value: string) =>
                src.set!.call(
                    v,
                    'http://127.0.0.1:3421/tv-test-media.webm?channel=' +
                        encodeURIComponent(value)
                ),
        });
        // Explicit HLS sources use the same real decoder fixture. Chromium's
        // WebM playback checks switching/lifecycle, not webOS HLS support.
        const append = v.appendChild.bind(v);
        v.appendChild = <T extends Node>(node: T): T => {
            if (node instanceof HTMLSourceElement) {
                node.src =
                    'http://127.0.0.1:3421/tv-test-media.webm?channel=' +
                    encodeURIComponent(node.src);
                node.type = 'video/webm';
            }
            return append(node);
        };
        v.loop = true;
        v.dataset.loads = '0';
        v.addEventListener('loadstart', () => {
            v.dataset.loads = String(Number(v.dataset.loads) + 1);
        });
    });
    return video;
}

export async function playLive(page: Page) {
    const video = await prepareLiveMedia(page);
    await page.locator('.channel').first().click();
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    // Fullscreen paints before its requestAnimationFrame focus restoration.
    // A caller that immediately presses Back must not race that pending work.
    await expect(page.locator('[data-focus="player-toggle"]')).toBeFocused();
    return video;
}
