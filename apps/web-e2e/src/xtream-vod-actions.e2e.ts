import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
    routeMovieClip,
    selectWebPlayer,
} from './xtream-series-playback.fixture';

// Network fixtures must also intercept cold reloads of the production bundle.
test.use({ serviceWorkers: 'block' });

for (const mode of ['catalog', 'missing', 'direct'] as const) {
    test(`@xtream VOD null extension keeps actions and resolves ${mode}`, async ({
        page,
        request,
    }) => {
        test.setTimeout(90_000);
        await request.post(
            `${MOCK_SERVER}/reset?username=minimal&password=minimal`
        );
        const catalogResponse = await request.get(
            `${MOCK_SERVER}/player_api.php?username=minimal&password=minimal&action=get_vod_streams`
        );
        const [movie] = await catalogResponse.json();
        const detailResponse = await request.get(
            `${MOCK_SERVER}/player_api.php?username=minimal&password=minimal&action=get_vod_info&vod_id=${movie.stream_id}`
        );
        const details = await detailResponse.json();
        const title = movie.name;
        const directUrl = `${MOCK_SERVER}/movie/direct/${movie.stream_id}.mp4?fixture=1778`;
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: 'window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: "http://localhost:3000" };',
            })
        );
        // This fixture provides a standalone proxy, not a shared source server.
        await page.route('http://localhost:3000/v1/instance', (route) =>
            route.fulfill({
                json: {
                    service: 'iptvnator',
                    apiVersion: 1,
                    storage: 'none',
                    capabilities: [],
                },
            })
        );
        await page.goto('/');
        await interceptXtreamRequests(page);
        await routeMovieClip(page);
        await page.route('https://**', (route) => route.abort());
        await page.route('**/localhost:3000/xtream**', async (route) => {
            const action = new URL(route.request().url()).searchParams.get(
                'action'
            );
            if (action === 'get_vod_info') {
                await route.fulfill({
                    json: {
                        action,
                        payload: {
                            ...details,
                            info: {
                                ...details.info,
                                name: title,
                                youtube_trailer: 'FakeClip_01',
                            },
                            movie_data: {
                                ...details.movie_data,
                                container_extension: null,
                                direct_source:
                                    mode === 'direct' ? directUrl : '',
                            },
                        },
                    },
                });
            } else if (action === 'get_vod_streams') {
                await route.fulfill({
                    json: {
                        action,
                        payload: [
                            {
                                ...movie,
                                container_extension:
                                    mode === 'catalog' ? 'mp4' : null,
                                direct_source: '',
                            },
                        ],
                    },
                });
            } else {
                await route.fallback();
            }
        });
        await selectWebPlayer(page, 'HTML5 video player');
        await page.goto('/');
        await addXtreamPortal(page, {
            username: 'minimal',
            password: 'minimal',
        });
        const playlistPath = new URL(page.url()).pathname.replace(
            /\/vod.*$/,
            ''
        );
        if (mode === 'direct') {
            await page
                .locator('.search-field input[type="search"]')
                .fill(title);
        } else {
            await page
                .locator(
                    `.category-item[data-category-id="${movie.category_id}"]`
                )
                .click();
        }
        await page
            .locator('app-grid-list mat-card')
            .filter({ hasText: title })
            .first()
            .click();
        await page.waitForURL(/\/vod\/[^/]+\/[^/]+$/);
        await page.reload();
        const primary = page.locator('[data-testid="vod-primary-action"]');
        const trailer = page.locator('[data-testid="vod-trailer"]');
        const favorite = page.locator('[data-testid="vod-favorite-toggle"]');
        const watched = page.locator('[data-testid="vod-watched-toggle"]');
        const more = page.locator('[data-testid="vod-more-menu"]');
        await expect(favorite).toBeEnabled();
        await expect(watched).toBeEnabled();
        await expect(trailer).toHaveText(/Trailer/);
        if (mode === 'catalog') {
            const desktop = page.viewportSize();
            const phone = { width: 375, height: 812 };
            // Exercise the wider Russian playback label from the phone UI.
            await page.route('**/assets/i18n/en.json', async (route) => {
                const response = await route.fetch();
                const messages = await response.json();
                messages.XTREAM.PLAY = 'Воспроизвести';
                await route.fulfill({ response, json: messages });
            });
            await page.reload();
            await expect(primary).toHaveAccessibleName(/^Воспроизвести(?: |$)/);
            await page.evaluate(() => document.fonts.ready.then(() => null));
            for (const width of [375, 390, 430]) {
                await page.setViewportSize({ ...phone, width });
                await expect(trailer).toHaveAccessibleName('Trailer');
                await expect(trailer.locator('.play-btn__label')).toBeHidden();
                const bounds = await page
                    .locator('app-content-hero .action-buttons button')
                    .evaluateAll((buttons) =>
                        buttons.map((button) =>
                            button.getBoundingClientRect().toJSON()
                        )
                    );
                expect(bounds, `hero controls at ${width}px`).toHaveLength(5);
                const top = bounds[0].y;
                expect(
                    bounds.map(({ x, y, width }) => ({ x, y, width })),
                    `hero controls at ${width}px`
                ).toEqual(bounds.map(({ x, width }) => ({ x, y: top, width })));
                for (const box of bounds) {
                    expect(box.width).toBeGreaterThanOrEqual(44);
                    expect(box.height).toBeGreaterThanOrEqual(44);
                    expect(box.x + box.width).toBeLessThanOrEqual(width);
                }
                const label = primary.locator('.play-btn__label');
                const labelFits = await label.evaluate((element) => {
                    const button = element.closest('button');
                    if (!button) return false;
                    const { left, right } = element.getBoundingClientRect();
                    const bounds = button.getBoundingClientRect();
                    return (
                        left >= bounds.left &&
                        right <= bounds.right &&
                        element.scrollWidth <= element.clientWidth
                    );
                });
                expect(labelFits, `playback label at ${width}px`).toBe(true);
            }
            const actionRow = page.locator('app-content-hero .action-buttons');
            await page.setViewportSize(phone);
            await actionRow.screenshot({
                animations: 'disabled',
                path: test.info().outputPath('phone-actions.png'),
            });
            await more.click();
            await expect(
                page.getByRole('menu', { name: 'More actions' })
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(more).toBeFocused();
            await page.setViewportSize(desktop ?? { width: 1280, height: 720 });
            await expect(trailer.locator('.play-btn__label')).toBeVisible();
        }
        await watched.click();
        await expect(watched).toHaveAttribute('aria-pressed', 'true');
        await favorite.click();
        await expect(favorite).toHaveAttribute('aria-pressed', 'true');
        if (mode === 'missing') {
            await expect(primary).toBeDisabled();
            await expect(
                page.locator('app-portal-detail-shell [role="status"]')
            ).toContainText('the provider did not supply');
            for (const theme of ['light', 'dark']) {
                await page.evaluate((dark) => {
                    document.body.classList.toggle('dark-theme', dark);
                    document.body.classList.toggle('light-theme', !dark);
                }, theme === 'dark');
                await page.locator('app-portal-detail-shell').screenshot({
                    path: test.info().outputPath(`unavailable-${theme}.png`),
                });
            }
        } else {
            await watched.click();
            await expect(watched).toHaveAttribute('aria-pressed', 'false');
            await expect(primary).toBeEnabled();
            const media = page.waitForRequest(
                (req) =>
                    req.url() ===
                    (mode === 'direct'
                        ? directUrl
                        : `${MOCK_SERVER}/movie/minimal/minimal/${movie.stream_id}.mp4`)
            );
            await primary.click();
            await media;
            const video = page
                .locator('app-portal-inline-player video')
                .first();
            await expect
                .poll(() =>
                    video.evaluate((el: HTMLVideoElement) => el.currentTime)
                )
                .toBeGreaterThanOrEqual(2.5);
        }
        for (const collection of mode === 'missing'
            ? ['favorites']
            : ['favorites', 'recent']) {
            await page.goto(`${playlistPath}/${collection}`);
            await page
                .locator('app-content-card')
                .filter({ hasText: title })
                .first()
                .click();
            await expect(favorite).toHaveAttribute('aria-pressed', 'true');
            if (mode === 'missing') await expect(primary).toBeDisabled();
            else await expect(primary).toBeEnabled();
        }
    });
}
