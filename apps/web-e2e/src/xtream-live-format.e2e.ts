import { expect, test } from './fixtures';
import { interceptProviderTargetRegistration } from './provider-target-route';
import {
    addLiveFormatPortal,
    configureLiveFormat,
    expectLiveFormatPlaying,
    liveChannels,
    liveFormatMock,
    observeLiveFormatMedia,
} from './xtream-live-format.fixture';

test.use({
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    serviceWorkers: 'block',
});
test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Chromium media engines'
);
test.beforeEach(async ({ page }) => {
    test.setTimeout(100_000);
    await interceptProviderTargetRegistration(page);
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const url = new URL(route.request().url());
        url.host = new URL(liveFormatMock).host;
        await route.continue({ url: url.toString() });
    });
    await page.goto('/');
});

for (const player of ['html5', 'artplayer'] as const) {
    for (const channel of [0, 1]) {
        test(`@web @xtream Auto live format ${player}: ${channel ? 'manifest' : 'segment'} 403 then playable TS`, async ({
            page,
        }) => {
            const media = observeLiveFormatMedia(page);
            await configureLiveFormat(page, player);
            await addLiveFormatPortal(page);
            await liveChannels(page).nth(channel).click();
            await expectLiveFormatPlaying(page, player);
            if (!channel)
                expect(media).toContainEqual({
                    file: '10000.m3u8',
                    status: 200,
                });
            expect(media).toContainEqual({
                file: channel ? '10001.m3u8' : 'denied-segment.ts',
                status: 403,
            });
            expect(
                media.filter((r) => r.file === `${10000 + channel}.ts`)
            ).toEqual([{ file: `${10000 + channel}.ts`, status: 200 }]);
            await expect(
                page.locator('[data-test-id="playback-diagnostic-banner"]')
            ).toBeHidden();
        });
    }
}

test('@web @xtream Auto live format: TS failure is terminal without a cycle', async ({
    page,
}) => {
    const media = observeLiveFormatMedia(page);
    await configureLiveFormat(page, 'html5');
    await addLiveFormatPortal(page);
    await liveChannels(page).nth(2).click();
    const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
    await expect(banner).toBeVisible({ timeout: 50_000 });
    expect(media.filter((r) => r.file === '10002.ts')).toEqual([
        { file: '10002.ts', status: 403 },
    ]);
    await expect(banner).toContainText(/MPEG-TS|mpegts/i);
});

for (const format of ['ts', 'm3u8']) {
    test(`@web @xtream Auto live format: manual ${format} wins`, async ({
        page,
    }) => {
        const media = observeLiveFormatMedia(page);
        await configureLiveFormat(page, 'html5', format);
        await addLiveFormatPortal(page);
        await liveChannels(page).first().click();
        if (format === 'ts') {
            await expectLiveFormatPlaying(page, 'html5');
            expect(media.some((r) => r.file.endsWith('.m3u8'))).toBe(false);
        } else {
            await expect(
                page.locator('[data-test-id="playback-diagnostic-banner"]')
            ).toBeVisible({ timeout: 50_000 });
            expect(media.some((r) => r.file === '10000.ts')).toBe(false);
        }
    });
}

test('@web @xtream Auto live format: channel switch cancels delayed HLS failure', async ({
    page,
}) => {
    const media = observeLiveFormatMedia(page);
    await configureLiveFormat(page, 'html5');
    await addLiveFormatPortal(page);
    const pending = page.waitForRequest('**/delayed-segment.ts');
    await liveChannels(page).nth(3).click();
    await pending;
    await liveChannels(page).nth(1).click();
    await expectLiveFormatPlaying(page, 'html5');
    expect(media.some((r) => r.file === '10003.ts')).toBe(false);
    expect(media.filter((r) => r.file === '10001.ts')).toHaveLength(1);
});

test('@web @xtream Auto live format: no TS advertisement means no downgrade', async ({
    page,
}) => {
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const url = new URL(route.request().url());
        url.host = new URL(liveFormatMock).host;
        const response = await route.fetch({ url: url.toString() });
        const json = await response.json();
        if (json.payload?.user_info)
            json.payload.user_info.allowed_output_formats = ['m3u8'];
        await route.fulfill({ response, json });
    });
    const media = observeLiveFormatMedia(page);
    await configureLiveFormat(page, 'html5');
    await addLiveFormatPortal(page);
    await liveChannels(page).first().click();
    await expect(
        page.locator('[data-test-id="playback-diagnostic-banner"]')
    ).toBeVisible({ timeout: 50_000 });
    expect(media.some((r) => r.file === '10000.ts')).toBe(false);
});

test('@web @xtream Auto live format: leaving the host aborts pending media without TS', async ({
    page,
}) => {
    const media = observeLiveFormatMedia(page);
    await configureLiveFormat(page, 'html5');
    await addLiveFormatPortal(page);
    const pending = page.waitForRequest('**/delayed-segment.ts');
    await liveChannels(page).nth(3).click();
    const request = await pending;
    const aborted = page.waitForEvent('requestfailed', (r) => r === request);
    await page.getByRole('link', { name: 'Open settings' }).click();
    await aborted;
    expect(media.some((r) => r.file === '10003.ts')).toBe(false);
    await expect(page.locator('app-web-player-view')).toHaveCount(0);
});
