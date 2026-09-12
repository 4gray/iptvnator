import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { waitForScrollIdle } from './e2e-helpers';

/**
 * The M3U movie-recognition workflow end to end: a playlist entry whose URL
 * looks like a movie file opens the VOD detail experience instead of the
 * player + EPG zone, TMDB metadata patches it asynchronously, and the
 * watch ↔ browse transitions keep the persisted volume.
 *
 * Playback cases decode a local clip; mode regressions seek through the
 * real player controls without depending on a remote media source.
 */

const FIXTURE_HOST = 'https://m3u-movie-fixture.local';
const MOVIE_PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="Movies",Dune (2021) 1080p',
    `${FIXTURE_HOST}/dune.mp4`,
    '#EXTINF:-1 tvg-id="live-one" group-title="News",Live One',
    `${FIXTURE_HOST}/live.m3u8`,
].join('\n');

const TMDB_MOVIE_ID = 438631;

test.use({ serviceWorkers: 'block' });

async function serveTmdb(page: Page): Promise<void> {
    await page.route('https://api.themoviedb.org/**', async (route) => {
        const url = new URL(route.request().url());
        const json = (body: unknown) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });

        if (url.pathname.endsWith('/search/movie')) {
            return json({
                results: [
                    {
                        id: TMDB_MOVIE_ID,
                        title: 'Dune',
                        original_title: 'Dune',
                        release_date: '2021-09-15',
                        vote_count: 9000,
                        vote_average: 7.8,
                    },
                ],
            });
        }

        if (url.pathname.endsWith(`/movie/${TMDB_MOVIE_ID}`)) {
            return json({
                id: TMDB_MOVIE_ID,
                title: 'Dune',
                overview: 'Paul Atreides arrives on Arrakis.',
                release_date: '2021-09-15',
                runtime: 155,
                vote_average: 7.8,
                vote_count: 9000,
                genres: [{ id: 878, name: 'Science Fiction' }],
                credits: {
                    cast: [{ id: 1, name: 'Timothee Chalamet', order: 0 }],
                    crew: [
                        { id: 2, name: 'Denis Villeneuve', job: 'Director' },
                    ],
                },
            });
        }

        // /configuration (the settings "check key" button) and anything else
        return json({});
    });
}

async function saveSettings(page: Page): Promise<void> {
    const saveButton = page.getByRole('button', { name: 'Save changes' });
    await saveButton.click();
    await expect(saveButton).toBeHidden();
}

async function selectPlayer(
    page: Page,
    player = 'HTML5 video player'
): Promise<void> {
    await page.goto('/workspace/settings/playback');
    const select = page.locator('[data-test-id="select-video-player"]');
    await expect(select).toBeVisible();
    const previous = await select.innerText();
    await select.click();
    await page.getByRole('option', { name: player, exact: true }).click();
    await expect(select).toContainText(player);
    if (!previous.includes(player)) {
        await saveSettings(page);
    }
}

async function enableTmdb(page: Page): Promise<void> {
    await page.goto('/workspace/settings/tmdb');
    await page.locator('[data-test-id="tmdb-enabled"] input').check();
    await page.locator('[data-test-id="tmdb-api-key"]').fill('e2e-key');
    // The M3U recognition toggle only appears once TMDB itself is on, and it
    // ships enabled — assert rather than click, so a changed default fails.
    await expect(
        page.locator('[data-test-id="tmdb-m3u-vod-details"] input')
    ).toBeChecked();
    await saveSettings(page);
}

async function importPlaylist(
    page: Page,
    content = MOVIE_PLAYLIST,
    count = 2
): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.getByLabel('Insert m3u(8) playlist as text').fill(content);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Import', exact: true }).click(),
    ]);
    await expect(page.getByText(`${count} channels`)).toBeVisible();
}

const detail = (page: Page) => page.locator('app-m3u-vod-detail');
const inlineVideo = (page: Page) =>
    page.locator('app-m3u-vod-detail app-portal-inline-player video');
// The sidebar numbers every entry ("1. Dune (2021) 1080p"), so match the
// row by its own test id and filter on the name rather than on exact text.
const sidebarEntry = (page: Page, name: string) =>
    page.locator('[data-test-id="channel-item"]').filter({ hasText: name });

async function serveSeekableClip(page: Page): Promise<void> {
    const clip = readFileSync(
        join(__dirname, 'fixtures/playback/episode.webm')
    );
    await page.route(`${FIXTURE_HOST}/**`, async (route) => {
        if (new URL(route.request().url()).pathname === '/live.m3u8') {
            // A failed live manifest triggers engine recovery. Keep it loading
            // while checking the host's controls, independently of that policy.
            await page.waitForEvent('close', { timeout: 0 });
            return;
        }
        const range = /^bytes=(\d*)-(\d*)$/.exec(
            route.request().headers()['range'] ?? ''
        );
        const last = clip.length - 1;
        const start = range?.[1]
            ? Number(range[1])
            : range?.[2]
              ? Math.max(0, clip.length - Number(range[2]))
              : 0;
        const end =
            range?.[1] && range[2] ? Math.min(Number(range[2]), last) : last;
        await route.fulfill({
            status: range ? 206 : 200,
            headers: {
                'content-type': 'video/webm',
                'accept-ranges': 'bytes',
                'content-length': String(end - start + 1),
                ...(range
                    ? {
                          'content-range': `bytes ${start}-${end}/${clip.length}`,
                      }
                    : {}),
            },
            body: clip.subarray(start, end + 1),
        });
    });
}

async function seekUsingControls(page: Page): Promise<void> {
    const view = page.locator('app-web-player-view');
    const video = view.locator('video');
    await expect
        .poll(() =>
            video.evaluate(
                (el: HTMLVideoElement) =>
                    Number.isFinite(el.duration) &&
                    el.duration > 5 &&
                    !el.paused
            )
        )
        .toBe(true);
    // ArtPlayer has an interaction layer above <video>; hover the surface.
    await view.hover();
    const controls = view.locator('app-player-controls');
    await controls.getByRole('button', { name: 'Pause', exact: true }).click();
    const position = controls.getByRole('slider', {
        name: 'Playback position',
        exact: true,
    });
    await expect(position).toBeEnabled();
    // Native keyboard interaction commits a real seek; never assign currentTime.
    await position.focus();
    await position.press('Home');
    await position.press('ArrowRight');
    await position.press('ArrowRight');
    await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
        .toBeCloseTo(2, 0);
    await controls.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
        .toBeGreaterThan(2.5);
}

type MetadataMode = 'disabled' | 'details-disabled' | 'enabled';

async function configureMetadata(
    page: Page,
    mode: MetadataMode
): Promise<void> {
    if (mode === 'disabled') return;
    await enableTmdb(page);
    if (mode === 'details-disabled') {
        await page
            .locator('[data-test-id="tmdb-m3u-vod-details"] input')
            .uncheck();
        await saveSettings(page);
    }
}

for (const [player, selector] of [
    ['HTML5 video player', 'app-html-video-player'],
    ['Video.js player', 'app-vjs-player'],
    ['ArtPlayer', 'app-art-player'],
]) {
    for (const metadata of [
        'disabled',
        'details-disabled',
        'enabled',
    ] as const) {
        test(`@web @m3u VOD seek without metadata coupling (${player}, ${metadata})`, async ({
            page,
        }) => {
            test.setTimeout(90_000);
            await serveSeekableClip(page);
            await serveTmdb(page);
            await configureMetadata(page, metadata);
            await selectPlayer(page, player);
            await importPlaylist(
                page,
                [
                    MOVIE_PLAYLIST,
                    '#EXTINF:-1 group-title="Series",Example Show S01E02',
                    `${FIXTURE_HOST}/series/episode.mp4`,
                ].join('\n'),
                3
            );

            const view = page.locator('app-web-player-view');
            await sidebarEntry(page, 'Live One').click();
            await expect(view.locator(selector)).toHaveCount(1);
            await expect(
                view.getByRole('slider', {
                    name: 'Playback position',
                    exact: true,
                })
            ).toHaveCount(0);
            await expect(
                view.getByLabel('Live stream', { exact: true })
            ).toBeVisible();

            await sidebarEntry(page, 'Dune (2021) 1080p').click();
            await expect(detail(page)).toHaveCount(
                metadata === 'enabled' ? 1 : 0
            );
            await expect(view.locator(selector)).toHaveCount(1);
            await seekUsingControls(page);

            await sidebarEntry(page, 'Example Show S01E02').click();
            await expect(detail(page)).toHaveCount(0);
            await expect(view.locator(selector)).toHaveCount(1);
            await seekUsingControls(page);

            await sidebarEntry(page, 'Live One').click();
            await expect(view.locator(selector)).toHaveCount(1);
            await expect(
                view.getByRole('slider', {
                    name: 'Playback position',
                    exact: true,
                })
            ).toHaveCount(0);
            await expect(
                view.getByLabel('Live stream', { exact: true })
            ).toBeVisible();
        });
    }
}

test('@web @m3u @tmdb recognized movies open the VOD detail view', async ({
    page,
}) => {
    await serveTmdb(page);
    await serveSeekableClip(page);
    await selectPlayer(page);
    await enableTmdb(page);
    await importPlaylist(page);

    // Record every engine that is ever attached. A polling assertion cannot
    // see the defect this guards: mounting Video.js first and correcting to
    // the saved engine a tick later leaves the same final DOM.
    await page.evaluate(() => {
        const seen = new Set<string>();
        (window as unknown as { __enginesSeen: Set<string> }).__enginesSeen =
            seen;
        const record = () => {
            for (const selector of [
                'app-vjs-player',
                'app-html-video-player',
            ]) {
                if (document.querySelector(selector)) {
                    seen.add(selector);
                }
            }
        };
        record();
        new MutationObserver(record).observe(document.body, {
            childList: true,
            subtree: true,
        });
    });

    // Watch-first: activating the entry plays immediately inside the detail
    // shell, with no EPG zone in sight.
    await sidebarEntry(page, 'Dune (2021) 1080p').click();
    await expect(detail(page)).toBeVisible();
    await expect(inlineVideo(page)).toBeVisible();
    await expect(page.locator('app-epg-timeline')).toHaveCount(0);
    // The engine is part of the application token, so the saved player must
    // mount FIRST TIME — a late correction swaps the player mid-playback.
    await expect(detail(page).locator('app-html-video-player')).toHaveCount(1);
    expect(
        await page.evaluate(() => [
            ...(window as unknown as { __enginesSeen: Set<string> })
                .__enginesSeen,
        ])
    ).toEqual(['app-html-video-player']);

    // Metadata patches the mounted view asynchronously. The shell stamps the
    // host templates into BOTH the hero and the watch-state About block, so
    // every metadata string legitimately resolves twice.
    await expect(
        detail(page).getByText('Paul Atreides arrives on Arrakis.').first()
    ).toBeVisible();
    await expect(
        detail(page).getByText('Denis Villeneuve').first()
    ).toBeVisible();
    await expect(
        detail(page).getByText('Science Fiction').first()
    ).toBeVisible();

    // A live channel keeps the classic layout.
    await sidebarEntry(page, 'Live One').click();
    await expect(detail(page)).toHaveCount(0);
});

test('@web @m3u @tmdb browse and watch keep the adjusted volume', async ({
    page,
}) => {
    await serveTmdb(page);
    await serveSeekableClip(page);
    await selectPlayer(page);
    await enableTmdb(page);
    await importPlaylist(page);

    // A volume persisted before the movie was ever opened must reach the
    // player — the regression that shipped the detail view without it.
    await page.evaluate(() => localStorage.setItem('volume', '0.5'));

    await sidebarEntry(page, 'Dune (2021) 1080p').click();
    await expect(inlineVideo(page)).toBeVisible();
    await expect
        .poll(() =>
            inlineVideo(page).evaluate(
                (video: HTMLVideoElement) => video.volume
            )
        )
        .toBe(0.5);

    // Stand in for the user moving the engine's own volume slider: the
    // engines persist straight to this bus and never call back, which is
    // exactly why the remount below has to re-read it. (That the engines
    // write on `volumechange` is covered by their own unit tests.)
    await page.evaluate(() => localStorage.setItem('volume', '0.25'));

    await page.keyboard.press('Escape');
    await expect(inlineVideo(page)).toHaveCount(0);
    const playButton = page.locator('[data-test-id="m3u-vod-play"]');
    await expect(playButton).toBeVisible();

    // Browse → Play remounts the engine without a channel change.
    await playButton.click();
    await expect(inlineVideo(page)).toBeVisible();
    await expect
        .poll(() =>
            inlineVideo(page).evaluate(
                (video: HTMLVideoElement) => video.volume
            )
        )
        .toBe(0.25);
    // M3U has no browse Back target, but the sticky watch control can close it.
    const shell = detail(page).locator('app-portal-detail-shell');
    await shell
        .getByRole('button', { name: 'Close player', exact: true })
        .first()
        .click();
    await expect(inlineVideo(page)).toHaveCount(0);
    await expect(shell.locator('.shell__back-button')).toHaveCount(0);
    await shell.focus();
    await page.keyboard.press('Escape');
    await expect(playButton).toBeVisible();
});

for (const theme of ['light', 'dark']) {
    test(`@web @m3u channel scrolling keeps focus after selection (${theme})`, async ({
        page,
    }) => {
        await serveSeekableClip(page);
        await selectPlayer(page);
        const channels = Array.from(
            { length: 60 },
            (_, index) =>
                `#EXTINF:-1 group-title="News",Station ${index + 1}\n${FIXTURE_HOST}/live-${index}.m3u8`
        );
        await importPlaylist(page, ['#EXTM3U', ...channels].join('\n'), 60);
        await page.evaluate(
            (dark) => document.body.classList.toggle('dark-theme', dark),
            theme === 'dark'
        );
        const viewport = page.locator(
            'app-all-channels-view cdk-virtual-scroll-viewport'
        );
        await viewport.locator('.channel-name').first().click();
        await expect(viewport).toBeFocused();
        await page.keyboard.press('PageDown');
        await expect
            .poll(() => viewport.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(100);
        await expect(viewport).toBeFocused();
        await waitForScrollIdle(viewport);
        await page.keyboard.press('Home');
        await expect
            .poll(() => viewport.evaluate((el) => el.scrollTop))
            .toBe(0);
        await page.keyboard.press('Tab');
        await expect(
            viewport.locator('button.channel-content').first()
        ).toBeFocused();
        await viewport.locator('button.channel-content').nth(1).focus();
        await page.keyboard.press('Enter');
        await expect(viewport.locator('.channel-list-item').nth(1)).toHaveClass(
            /active/
        );
        await page.keyboard.press('Tab');
        const favorite = viewport.locator('.favorite-button').nth(1);
        await expect(favorite).toBeFocused();
        await page.keyboard.press('Space');
        await expect(favorite).toBeFocused();
        await page
            .getByRole('link', { name: 'Global favorites', exact: true })
            .click();
        const favorites = page.locator(
            'app-global-favorites-list [appChannelScrollFocus]'
        );
        await favorites.locator('.channel-name').first().click();
        await expect(favorites).toBeFocused();
        await page
            .getByRole('link', { name: 'Recently viewed', exact: true })
            .first()
            .click();
        const recent = page.locator(
            'app-global-favorites-list [appChannelScrollFocus]'
        );
        await recent.locator('.channel-name').first().click();
        await expect(recent).toBeFocused();
    });
}
