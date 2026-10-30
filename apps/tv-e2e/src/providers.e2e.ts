import { expect, test } from '@playwright/test';
import { addSource, nav, start, stalker, xtream } from './helpers';
test('Stalker lazy episodes resolve their own media file when another show owns the episode-number file', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { mac: '00:1a:79:18:44:01' });
    await nav(page, 'Movies');
    await page.getByRole('button', { name: /Fixture Alpha/ }).click();
    await page.locator('.episode').first().click();
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        /\/stream\/issue1844\/10\/1\.mp4$/
    );
});
test('Xtream: source, live preview/fullscreen, movie, episode, favorites and relaunch', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await expect(page.locator('.hero h1')).not.toHaveText(
        'Make yourself at home.'
    );
    await nav(page, 'TV');
    const first = page.locator('.channel').first();
    const id = await first.getAttribute('data-focus');
    await first.focus();
    await expect(page.locator('video[src], video source')).toHaveCount(0);
    await first.click();
    await expect(page.locator('.native-player.preview')).toBeVisible();
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        /\/live\/.+\.m3u8$/
    );
    await first.click();
    await expect(page.locator('.fullscreen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(first).toBeFocused();
    await expect(
        page.locator('.channel[data-focus=' + JSON.stringify(id) + ']')
    ).toBeVisible();
    await nav(page, 'Movies');
    await expect(page.locator('.poster-grid .poster-card')).toHaveCount(60);
    const movie = page.locator('.poster-grid .poster-card').first();
    const movieId = await movie.getAttribute('data-focus');
    await movie.click();
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(
        page.getByRole('button', { name: 'Saved', exact: false }).first()
    ).toBeVisible();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect(page.locator('.fullscreen')).toBeVisible();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v) => (v as HTMLVideoElement).currentTime)
        )
        .toBeGreaterThan(0.3);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="detail-play"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
        page.locator('[data-focus=' + JSON.stringify(movieId) + ']')
    ).toBeFocused();
    await nav(page, 'Series');
    await page.locator('.poster-grid .poster-card').first().click();
    await expect(page.locator('.episode')).not.toHaveCount(0);
    await page.locator('.episode').first().click();
    await expect(page.locator('.fullscreen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.episode').first()).toBeFocused();
    await page.reload();
    await expect(page.locator('.loading')).toBeHidden();
    await nav(page, 'Favorites');
    await expect(page.locator('.poster-grid .poster-card')).toHaveCount(1);
    await nav(page, 'Search');
    await page.getByLabel('Search this source').fill('zzzz-unavailable');
    await expect(page.locator('.poster-grid .poster-card')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(1);
});
test('Stalker full: token repair, live guide, regular series and simple portal', async ({
    page,
    request,
}) => {
    await start(page);
    await addSource(page, 'stalker');
    await nav(page, 'TV');
    await page.locator('.channel').first().focus();
    await expect(page.locator('.programme')).not.toHaveCount(0);
    await request.post(
        `${stalker}/invalidate-session?macAddress=00:1a:79:00:00:03`
    );
    await nav(page, 'Movies');
    await expect(page.locator('.poster-grid .poster-card')).not.toHaveCount(0);
    await nav(page, 'Series');
    await page.locator('.poster-grid .poster-card').first().click();
    await expect(page.locator('.episode')).not.toHaveCount(0);
    await page.locator('.episode').first().click();
    await expect(page.locator('.fullscreen')).toBeVisible();
    await page.keyboard.press('Escape');
    await addSource(page, 'stalker', {
        url: `${stalker}/portal.php`,
        mac: '00:1a:79:00:00:05',
    });
    await nav(page, 'Movies');
    await expect(page.locator('.poster-grid .poster-card')).not.toHaveCount(0);
});
test('M3U URL: groups, live playback and no fabricated series hierarchy', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'm3u');
    await nav(page, 'TV');
    await expect(page.locator('.channel')).toHaveCount(4);
    await page.locator('.channel').first().click();
    await expect(page.locator('.preview')).toBeVisible();
    await nav(page, 'Series');
    await expect(page.locator('.poster-grid .poster-card')).toHaveCount(0);
    await expect(page.locator('.empty')).toContainText('No titles');
});

test('M3U recognized VOD and standalone episodes play without inventing series', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'm3u', { url: `${xtream}/tv-playlist.m3u` });
    await nav(page, 'Movies');
    await expect(page.locator('.poster-card')).toHaveCount(2);
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v) => (v as HTMLVideoElement).currentTime)
        )
        .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await nav(page, 'Series');
    await expect(page.locator('.poster-card')).toHaveCount(0);
});
test('Stalker embedded VOD series preserves its episode command and returns to episode focus', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', {
        url: `${stalker}/portal.php`,
        mac: '00:1a:79:00:00:05',
    });
    await nav(page, 'Movies');
    await page
        .locator('.poster-card')
        .filter({
            has: page.locator('.poster-art small', { hasText: 'SERIES' }),
        })
        .first()
        .click();
    await expect(page.locator('.episode')).not.toHaveCount(0);
    await page.locator('.episode').first().click();
    await expect(page.locator('.fullscreen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.episode').first()).toBeFocused();
});
test('Stalker lazy Ministra paginates seasons/files and plays a scoped episode', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { mac: '00:1a:79:00:00:0b' });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(
        page.getByLabel('Season', { exact: true }).locator('option')
    ).toHaveCount(3);
    await page.getByLabel('Season', { exact: true }).selectOption('2');
    await expect(page.locator('.episode')).toHaveCount(3);
    await page.locator('.episode').nth(1).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v) => (v as HTMLVideoElement).currentTime)
        )
        .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.episode').nth(1)).toBeFocused();
});
