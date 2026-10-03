import { Page } from '@playwright/test';
import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openWorkspaceSection,
    test,
} from './electron-test-fixtures';

function formatXmltvDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join('');
}

function xmltvWithCurrentProgramme(
    channelId: string,
    channelName: string,
    title: string
): string {
    const start = new Date(Date.now() - 15 * 60 * 1000);
    const stop = new Date(Date.now() + 45 * 60 * 1000);
    return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="${channelId}"><display-name>${channelName}</display-name></channel>
  <programme start="${formatXmltvDate(start)} +0000" stop="${formatXmltvDate(stop)} +0000" channel="${channelId}">
    <title>${title}</title>
    <desc>Guide E2E programme.</desc>
  </programme>
</tv>
`;
}

/** True when the now-line is painted inside the visible programme lane. */
function nowLineInLane(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const lane = document
            .querySelector('.epg-guide__now-clip')
            ?.getBoundingClientRect();
        const line = document
            .querySelector('.epg-guide__now-line')
            ?.getBoundingClientRect();
        return (
            !!lane &&
            !!line &&
            line.left >= lane.left &&
            line.right <= lane.right
        );
    });
}

/** Scroll the lane to whichever end of the day is farther from now. */
async function scrollAwayFromNow(page: Page): Promise<void> {
    await page.evaluate(() => {
        const viewport = document.querySelector(
            '.epg-guide__viewport'
        ) as HTMLElement;
        const badge = document.querySelector(
            '.epg-guide__now-badge'
        ) as HTMLElement;
        const nowLeft = parseFloat(badge.style.left);
        const end = viewport.scrollWidth - viewport.clientWidth;
        viewport.scrollTo({ left: nowLeft > end / 2 ? 0 : end });
    });
}

test('@epg @electron opens the programme guide with the playlist channels, switches channels and keeps the player mounted', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const epgServer = await createMutableTextServer(
        xmltvWithCurrentProgramme(
            'guide-news',
            'Guide News',
            'Guide Bulletin Now'
        ),
        {
            contentType: 'application/xml; charset=utf-8',
            resourcePath: '/guide.xml',
        }
    );
    const playlistServer = await createMutableTextServer(
        buildM3uContent([
            {
                name: 'Guide News',
                tvgId: 'guide-news',
                url: 'https://example.com/live/guide-news.m3u8',
            },
            {
                name: 'Guide Silent',
                tvgId: 'guide-silent',
                url: 'https://example.com/live/guide-silent.m3u8',
            },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${epgServer.resourceUrl}"`),
        {
            contentType: 'application/x-mpegurl; charset=utf-8',
            resourcePath: '/guide-playlist.m3u',
        }
    );
    const app = await launchElectronApp(dataDir);

    try {
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
        });
        // The demo stream URLs are unreachable; the player still mounts.
        await app.mainWindow.route('https://example.com/**', (route) =>
            route.abort()
        );

        await importM3uPlaylistFromUrl(
            app.mainWindow,
            playlistServer.resourceUrl
        );
        await expect(
            app.mainWindow.locator(
                '.epg-progress-panel .import-item.status-complete'
            )
        ).toHaveCount(1, { timeout: 30000 });

        await openWorkspaceSection(app.mainWindow, 'All channels');
        const newsRow = channelItemByTitle(app.mainWindow, 'Guide News');
        await expect(newsRow).toBeVisible();
        await newsRow.click();

        const timeline = app.mainWindow.locator('app-epg-timeline');
        await expect(timeline).toBeVisible({ timeout: 20000 });
        await app.mainWindow.evaluate(() =>
            document
                .querySelector('app-web-player-view')
                ?.setAttribute('data-e2e-guide-marker', 'kept')
        );

        // Entry point: the Guide button in the timeline toolbar.
        await timeline.locator('.epg-timeline__guide').click();
        const guide = app.mainWindow.locator('app-epg-guide');
        await expect(guide).toBeVisible();
        // The sidebar stays mounted (its channel list resets the active
        // channel on destroy) and is hidden while the guide owns the layout.
        await expect(app.mainWindow.locator('.sidebar')).toBeHidden();
        await expect(timeline).toHaveCount(0);

        // Rows are the playlist's channels, in order, with the playing row marked.
        const rows = guide.locator('app-epg-guide-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).locator('.epg-guide-row__name b')).toHaveText(
            'Guide News'
        );
        await expect(rows.nth(1).locator('.epg-guide-row__name b')).toHaveText(
            'Guide Silent'
        );
        await expect(rows.nth(0)).toHaveClass(/is-active/);
        await expect(
            rows.nth(0).locator('.epg-guide-row__block.is-now')
        ).toContainText('Guide Bulletin Now', { timeout: 20000 });
        await expect(rows.nth(1).locator('.epg-guide-row__empty')).toBeVisible({
            timeout: 20000,
        });

        // The guide opens on "now", and the Now button and N jump back to it
        // on both axes at once (#1733: the lane stayed at midnight).
        await expect.poll(() => nowLineInLane(app.mainWindow)).toBe(true);
        await scrollAwayFromNow(app.mainWindow);
        await expect.poll(() => nowLineInLane(app.mainWindow)).toBe(false);
        await guide.locator('.guide-toolbar__now').click();
        await expect.poll(() => nowLineInLane(app.mainWindow)).toBe(true);

        await scrollAwayFromNow(app.mainWindow);
        await expect.poll(() => nowLineInLane(app.mainWindow)).toBe(false);
        // Keys are left alone while a toolbar button holds the focus.
        await app.mainWindow.evaluate(() =>
            (document.activeElement as HTMLElement | null)?.blur()
        );
        await app.mainWindow.keyboard.press('n');
        await expect.poll(() => nowLineInLane(app.mainWindow)).toBe(true);
        // The keyboard focus follows the jump to the playing row.
        await expect(
            rows.nth(0).locator('[data-epg-guide-grid][tabindex="0"]')
        ).toBeFocused();

        // "Only with EPG" hides the silent channel once coverage is known.
        const toggle = guide.locator('.guide-toolbar__toggle input');
        await expect(toggle).toBeEnabled({ timeout: 20000 });
        await guide.locator('.guide-toolbar__toggle').click();
        await expect(rows).toHaveCount(1);
        await guide.locator('.guide-toolbar__toggle').click();
        await expect(rows).toHaveCount(2);

        // Clicking a channel switches playback without closing the guide.
        await rows.nth(1).locator('.epg-guide-row__channel').click();
        await expect(rows.nth(1)).toHaveClass(/is-active/);
        await expect(rows.nth(0)).not.toHaveClass(/is-active/);
        await expect(guide).toBeVisible();
        await expect(
            app.mainWindow.locator('app-epg-guide-now-playing')
        ).toContainText('Guide Silent');

        // The player element survived both the mode switch and the channel switch.
        await expect(
            app.mainWindow.locator(
                'app-web-player-view[data-e2e-guide-marker="kept"]'
            )
        ).toHaveCount(1);

        // Escape closes the guide and restores the sidebar and timeline.
        await app.mainWindow.keyboard.press('Escape');
        await expect(guide).toHaveCount(0);
        await expect(app.mainWindow.locator('.sidebar')).toBeVisible();
        await expect(app.mainWindow.locator('app-epg-timeline')).toBeVisible();
        await expect(
            app.mainWindow.locator(
                'app-web-player-view[data-e2e-guide-marker="kept"]'
            )
        ).toHaveCount(1);

        // G reopens it; the header shortcut is highlighted while open.
        await app.mainWindow.keyboard.press('g');
        await expect(guide).toBeVisible();
        await expect(
            app.mainWindow.locator('.header-shortcut.is-active')
        ).toHaveCount(1);
    } finally {
        await closeElectronApp(app);
        await playlistServer.close();
        await epgServer.close();
    }
});
