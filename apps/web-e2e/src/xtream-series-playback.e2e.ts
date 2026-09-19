import { expect, test } from './fixtures';
import {
    interceptXtreamRequests,
    MOCK_SERVER,
    playFirstSeriesEpisode,
    rewriteSeriesEpisodesToMp4,
    routeEpisodeClip,
    selectWebPlayer,
} from './xtream-series-playback.fixture';

/**
 * Xtream inline series playback in fullscreen: episode switches, the
 * fullscreen episode panel and the vendor-chrome shortcuts. Split out of
 * `xtream.e2e.ts` for size; same mock server and default scenario
 * (3 seasons × 8 episodes per series).
 *
 * Tag: @xtream
 */

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
});

// ---------------------------------------------------------------------------
// Fullscreen survives an episode switch
//
// app-web-player-view remounts the engine component for every playback
// application (next episode, channel, or alternative source). DOM fullscreen
// used to be owned by that engine's shell, so the Fullscreen API exited the
// moment the old shell left the document — every "next episode" click and
// every autoplay hand-off dropped the viewer back to the page. The owner is
// now the app-web-player-view host, which spans all applications of one mount.
// ---------------------------------------------------------------------------

test.describe('@xtream inline series fullscreen', () => {
    // No autoplay-policy flag is needed: the episode click is a user
    // activation and the fixture clip carries no audio track.
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'DOM fullscreen assertions target Chromium'
    );

    test('stays in fullscreen across manual and automatic episode switches', async ({
        page,
        request,
    }) => {
        await routeEpisodeClip(page);
        await rewriteSeriesEpisodesToMp4(page);

        // Persist the HTML5 engine first: Video.js rejects the mock's
        // video/matroska source type before any bytes are sniffed.
        await selectWebPlayer(page, 'HTML5 video player');
        const { playerView, video } = await playFirstSeriesEpisode(
            page,
            request
        );
        await expect(playerView.locator('app-html-video-player')).toBeVisible({
            timeout: 15_000,
        });
        const waitForMetadata = () =>
            expect
                .poll(() =>
                    video.evaluate((el) => (el as HTMLVideoElement).readyState)
                )
                .toBeGreaterThanOrEqual(1);
        await waitForMetadata();

        // The bar auto-hides during playback; a hover reveals it. The
        // overlay title renders only while the controls consider themselves
        // fullscreen, so it doubles as the controls-state assertion.
        // Asserted as "some element is fullscreen" rather than by owner tag,
        // so the test guards the behavior, not the wiring.
        const fullscreenOwner = () =>
            page.evaluate(() => document.fullscreenElement?.tagName ?? null);
        const overlayTitle = playerView.locator(
            '[data-test-id="player-controls-media-title"]'
        );
        await playerView.hover();
        await playerView
            .getByRole('button', { name: 'Enter fullscreen' })
            .click();
        await expect.poll(fullscreenOwner).not.toBeNull();
        await expect(overlayTitle).toContainText('S01E01');

        // Chromium leaves the clicked button focused; the shared controls
        // release that focus so Space reaches the playback shortcut instead
        // of activating the button again (which left fullscreen while the
        // video kept playing).
        const paused = () =>
            video.evaluate((el) => (el as HTMLVideoElement).paused);
        await expect.poll(paused).toBe(false);
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(true);
        expect(await fullscreenOwner()).not.toBeNull();
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(false);

        // Manual switch from the shared controls' own next-episode button.
        await playerView.hover();
        await playerView
            .locator('[data-test-id="player-controls-next-episode"]')
            .click();
        await expect(overlayTitle).toContainText('S01E02', {
            timeout: 15_000,
        });
        expect(await fullscreenOwner()).not.toBeNull();

        // Automatic switch: the clip reaching its end autoplays the next
        // episode with no user activation anywhere near it.
        await waitForMetadata();
        await video.evaluate(async (el) => {
            const media = el as HTMLVideoElement;
            media.currentTime = Math.max(0, media.duration - 0.2);
            // Headless autoplay is not guaranteed for a remounted element;
            // the document already carries user activation from the clicks.
            await media.play();
        });
        await expect(overlayTitle).toContainText('S01E03', {
            timeout: 15_000,
        });
        expect(await fullscreenOwner()).not.toBeNull();
    });

    test('switches episodes from the fullscreen episode panel without leaving fullscreen', async ({
        page,
        request,
    }) => {
        await routeEpisodeClip(page);
        await rewriteSeriesEpisodesToMp4(page);
        await selectWebPlayer(page, 'HTML5 video player');
        const { playerView } = await playFirstSeriesEpisode(page, request);
        await expect(playerView.locator('app-html-video-player')).toBeVisible({
            timeout: 15_000,
        });

        const fullscreenOwner = () =>
            page.evaluate(() => document.fullscreenElement?.tagName ?? null);
        const overlayTitle = playerView.locator(
            '[data-test-id="player-controls-media-title"]'
        );
        await playerView.hover();
        await playerView
            .getByRole('button', { name: 'Enter fullscreen' })
            .click();
        await expect.poll(fullscreenOwner).not.toBeNull();
        await expect(overlayTitle).toContainText('S01E01');

        // C slides in the episode panel: season tabs instead of a search
        // field, the season's eight rows, the playing one marked.
        await page.keyboard.press('c');
        const panel = page.locator('[data-test-id="fullscreen-channel-panel"]');
        await expect(panel).toHaveAttribute('aria-hidden', 'false');
        await expect(panel).toHaveAttribute('data-panel-kind', 'episodes');
        await expect(
            panel.locator('[data-test-id="fullscreen-channel-panel-search"]')
        ).toHaveCount(0);
        await expect(panel.locator('.season-tabs__pill')).toHaveCount(3);
        const rows = panel.locator(
            '[data-test-id="fullscreen-episode-panel-episode"]'
        );
        await expect(rows).toHaveCount(8);
        await expect(rows.first()).toHaveAttribute('aria-current', 'true');

        // Picking an episode plays it inline through the same path as the Up
        // Next rail: fullscreen survives the engine remount, the panel closes.
        await rows.nth(2).click();
        await expect(panel).toHaveAttribute('aria-hidden', 'true');
        await playerView.hover();
        await expect(overlayTitle).toContainText('S01E03', {
            timeout: 15_000,
        });
        expect(await fullscreenOwner()).not.toBeNull();

        // Reopened, the panel marks the new episode; another season's tab
        // lists that season, offers the way back, and plays from there too.
        await page.keyboard.press('c');
        await expect(panel).toHaveAttribute('aria-hidden', 'false');
        await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
        await panel.locator('.season-tabs__pill').nth(1).click();
        await expect(rows).toHaveCount(8);
        await expect(panel.locator('[aria-current="true"]')).toHaveCount(0);
        await expect(
            panel.locator('[data-testid="back-to-playing"]')
        ).toBeVisible();
        await rows.first().click();
        await playerView.hover();
        await expect(overlayTitle).toContainText('S02E01', {
            timeout: 15_000,
        });
        expect(await fullscreenOwner()).not.toBeNull();
    });
});

test.describe('@xtream vendor-chrome Video.js shortcuts', () => {
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'DOM fullscreen assertions target Chromium'
    );

    test('keep working after a mouse click on a control-bar button', async ({
        page,
        request,
    }) => {
        await routeEpisodeClip(page);
        await rewriteSeriesEpisodesToMp4(page);
        // Video.js with the shared controls opted out: the vendor control bar.
        await selectWebPlayer(page, 'Video.js player', false);
        const { playerView, video } = await playFirstSeriesEpisode(
            page,
            request
        );
        await expect(playerView.locator('app-vjs-player')).toBeVisible({
            timeout: 15_000,
        });
        await expect(playerView.locator('app-player-controls')).toHaveCount(0);
        const paused = () =>
            video.evaluate((el) => (el as HTMLVideoElement).paused);
        const fullscreenOwner = () =>
            page.evaluate(() => document.fullscreenElement?.tagName ?? null);
        await expect.poll(paused).toBe(false);

        // Chromium leaves the clicked Video.js button focused, and a focused
        // Video.js component swallows every key; the legacy chrome releases
        // that focus so Space and M reach the playback shortcuts instead of
        // Space activating the button again (which left fullscreen while the
        // video kept playing).
        await playerView.hover();
        await playerView.locator('.vjs-fullscreen-control').click();
        await expect.poll(fullscreenOwner).not.toBeNull();
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(true);
        expect(await fullscreenOwner()).not.toBeNull();
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(false);
        await page.keyboard.press('m');
        await expect
            .poll(() => video.evaluate((el) => (el as HTMLVideoElement).muted))
            .toBe(true);
    });
});
