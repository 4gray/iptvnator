import { expect, test } from './fixtures';
import {
    interceptXtreamRequests,
    MOCK_SERVER,
    playFirstSeriesEpisode,
    routeEpisodeClip,
    selectWebPlayer,
} from './xtream-series-playback.fixture';

const longTitle =
    'Почти настоящий детектив: необычное расследование в маленьком городе, первая серия';

for (const language of ['en', 'ru']) {
    test(`@xtream inline player keeps long titles, actions and episodes separated (${language})`, async ({
        page,
        context,
        request,
        browserName,
    }, testInfo) => {
        test.setTimeout(60_000);
        test.skip(
            browserName !== 'chromium',
            'Clipboard permission targets Chromium'
        );
        await request.post(`${MOCK_SERVER}/reset`);
        await page.goto('/');
        await interceptXtreamRequests(page);
        await routeEpisodeClip(page);
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const original = new URL(route.request().url());
            if (original.searchParams.get('action') !== 'get_series_info') {
                await route.fallback();
                return;
            }
            const mockUrl = new URL(`${MOCK_SERVER}/xtream`);
            mockUrl.search = original.search;
            const response = await route.fetch({ url: mockUrl.toString() });
            const body = await response.json();
            for (const episodes of Object.values(
                body.payload.episodes
            ) as Array<Array<{ title: string; container_extension: string }>>) {
                for (const episode of episodes) {
                    episode.title = longTitle;
                    episode.container_extension = 'mp4';
                }
            }
            await route.fulfill({ response, json: body });
        });
        await selectWebPlayer(page, 'HTML5 video player');
        const { video } = await playFirstSeriesEpisode(page, request);
        if (language === 'ru') {
            const detailUrl = page.url();
            await page.goto('/workspace/settings/general');
            await page.locator('[data-test-id="select-language"]').click();
            await page.locator('mat-option[data-test-id="ru"]').click();
            await page.locator('[data-test-id="save-settings"]').click();
            await expect(
                page.locator('[data-test-id="save-settings"]')
            ).toBeHidden();
            await page.goto(detailUrl);
            await page.locator('.episode-item').first().click();
        }
        await expect(video).toBeVisible();
        await video.evaluate((element: HTMLVideoElement) => element.pause());

        const shell = page.locator('app-portal-inline-player .player-shell');
        const heading = shell.locator('.player-shell__title');
        const episodes = page.locator('app-season-container .episodes-header');
        const copy = shell.getByRole('button', {
            name:
                language === 'ru'
                    ? 'Копировать URL-адрес потока'
                    : 'Copy Stream URL',
            exact: true,
        });
        const close = shell.getByRole('button', {
            name: language === 'ru' ? 'Закрыть плеер' : 'Close player',
            exact: true,
        });

        for (const dark of [false, true]) {
            await page.evaluate(
                (value) => document.body.classList.toggle('dark-theme', value),
                dark
            );
            for (const width of [1440, 980, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await expect(async () => {
                    const panel = await shell.boundingBox();
                    const section = await episodes.boundingBox();
                    expect(panel).not.toBeNull();
                    expect(section).not.toBeNull();
                    expect(
                        section!.y - (panel!.y + panel!.height)
                    ).toBeGreaterThanOrEqual(16);
                    expect(Math.abs(section!.x - panel!.x)).toBeLessThanOrEqual(
                        1
                    );
                }).toPass({ timeout: 5_000 });
                await expect(heading).toContainText(longTitle);
                await expect(copy).toBeVisible();
                await expect(close).toBeVisible();
                for (const control of [heading, copy, close]) {
                    const box = (await control.boundingBox())!;
                    const panel = (await shell.boundingBox())!;
                    expect(box.x).toBeGreaterThanOrEqual(panel.x);
                    expect(box.x + box.width).toBeLessThanOrEqual(
                        panel.x + panel.width
                    );
                }
                await expect(copy).toHaveCSS('width', '40px');
                await expect(shell).toHaveCSS('background-image', 'none');
                // Match the shared widget and heading palette in m3-theme.scss.
                // Fixed expectations catch a panel stuck in the opposite theme.
                await expect(shell).toHaveCSS(
                    'background-color',
                    dark ? 'rgb(30, 35, 48)' : 'rgb(255, 255, 255)'
                );
                await expect(heading).toHaveCSS(
                    'color',
                    dark ? 'rgb(216, 220, 232)' : 'rgb(26, 29, 35)'
                );
                await shell.screenshot({
                    path: testInfo.outputPath(
                        `player-${language}-${dark ? 'dark' : 'light'}-${width}.png`
                    ),
                });
            }
        }

        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await copy.focus();
        await page.keyboard.press('Enter');
        await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toContain('/series/');
        await close.click();
        await expect(shell).toHaveCount(0);
        await expect(episodes).toBeVisible();
    });
}
