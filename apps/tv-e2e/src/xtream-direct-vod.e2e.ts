import { expect, test } from '@playwright/test';
import { addSource, backend, nav, start, xtream } from './helpers';

test('Xtream plays an explicit direct movie address without a detail extension', async ({
    page,
}) => {
    await start(page);
    const directUrl = `${xtream}/movie/direct/source/fixture.mp4?token=1778`;
    await page.route(`${backend}/xtream?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_vod_info'
        ) {
            await route.fallback();
            return;
        }
        const response = await route.fetch();
        const body = await response.json();
        body.payload.movie_data.container_extension = null;
        body.payload.movie_data.direct_source = directUrl;
        await route.fulfill({ response, json: body });
    });
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
    await page.locator('.poster-grid .poster-card').first().click();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect(page.locator('video')).toHaveAttribute('src', directUrl);
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeGreaterThan(0.3);
});
