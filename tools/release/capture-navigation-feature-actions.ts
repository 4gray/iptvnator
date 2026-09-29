/** Real UI captures for the 0.23/0.24 feature guides, using local demo media. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { type CaptureAction, openXtreamSection } from './capture-navigation-helpers';
import { openM3uGroups } from './capture-navigation-portal-actions';
import { openSettings } from './capture-navigation-setup-actions';

async function openSettingsSection(page: Page, section: string): Promise<void> {
    await openSettings(page);
    await page.locator(`[data-test-id="settings-section-${section}"]`).click();
    await page.locator(`#${section}`).waitFor({ state: 'visible' });
}

async function openUpdateChannel(page: Page): Promise<void> {
    await openSettingsSection(page, 'about');
    await page.locator('[data-test-id="select-update-channel"]').click();
    await page.locator('[data-test-id="update-channel-nightly"]').waitFor();
}

async function openBackup(page: Page): Promise<void> {
    await openSettingsSection(page, 'backup');
}

async function openLibraryWatched(page: Page): Promise<void> {
    await openXtreamSection(page, 'vod', 'Action & Mystery');
    const watched = page.locator('[data-testid="vod-watched-toggle"]');
    await watched.waitFor();
    if ((await watched.getAttribute('aria-label')) === 'Mark as Watched') {
        await watched.click();
    }
    await page.getByRole('button', { name: 'Mark as Unwatched', exact: true }).waitFor();
}

async function openDemoPlayback(page: Page): Promise<void> {
    await openSettingsSection(page, 'playback');
    const player = page.locator('[data-test-id="select-video-player"]');
    if (!(await player.innerText()).includes('HTML5')) {
        await player.click();
        await page.locator('[data-test-id="html5"]').click();
        await page.locator('[data-test-id="save-settings"]').click();
        await page.locator('[data-test-id="save-settings"]').waitFor({ state: 'hidden' });
    }
    // A local generated H.264 slate, never a provider stream. Use MPEG-TS
    // segments so the normal M3U/HLS player path decodes it without overrides.
    const fixture = path.resolve('tools/release/fixtures/guide-demo.mpegts');
    await page.route('**/live/marketing/marketing/*.m3u8', (route) =>
        route.fulfill({
            contentType: 'application/vnd.apple.mpegurl',
            body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:20.0,\nhttp://localhost:3211/demo/guide-demo.ts\n#EXT-X-ENDLIST\n',
        })
    );
    await page.route('**/demo/guide-demo.ts', (route) =>
        route.fulfill({ contentType: 'video/mp2t', body: readFileSync(fixture) })
    );
    await openM3uGroups(page);
    await page.locator('[data-test-id="channel-item"]').first().click();
    await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && video.readyState >= 2 && video.videoWidth === 1280;
    }, undefined, { timeout: 25_000 });
    // Freeze decoded media, not the interface, for a repeatable illustration.
    await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
    await page.locator('video').hover();
}

async function openFullscreenChannels(page: Page): Promise<void> {
    await openDemoPlayback(page);
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await page.keyboard.press('c');
    await page.locator('[data-test-id="fullscreen-channel-panel"][aria-hidden="false"]').waitFor();
    await page.locator('[data-test-id="m3u-fullscreen-view-all"]').click();
}

async function openSubtitles(page: Page): Promise<void> {
    await openDemoPlayback(page);
    await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
    await page.locator('[data-test-id="player-controls-load-subtitle"]').waitFor();
}

async function openStreamInfo(page: Page): Promise<void> {
    await openDemoPlayback(page);
    await page.locator('[data-test-id="player-controls-stream-info-button"]').click();
    await page.locator('[data-test-id="player-controls-stream-info-panel"]').waitFor();
}

export const FEATURE_ACTIONS: Readonly<Record<string, CaptureAction>> = {
    'open-update-channel': openUpdateChannel,
    'open-backup': openBackup,
    'open-library-watched': openLibraryWatched,
    'open-fullscreen-channels': openFullscreenChannels,
    'open-player-subtitles': openSubtitles,
    'open-stream-info': openStreamInfo,
};
