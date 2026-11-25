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

const CHANNEL_ID = 'refill-news';
const CHANNEL_NAME = 'Refill News';
const SLOT_MS = 30 * 60_000;

function xmltvDate(ms: number): string {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}` +
        `${pad(date.getUTCDate())}${pad(date.getUTCHours())}` +
        `${pad(date.getUTCMinutes())}00 +0000`
    );
}

/**
 * The channel, and `pastSlots` half-hour programmes that ended before the
 * one airing now ("Fresh Bulletin"), then two upcoming ones.
 */
function guide(pastSlots: number | null): string {
    const airingStart = Math.floor(Date.now() / SLOT_MS) * SLOT_MS;
    const programmes: string[] = [];
    if (pastSlots !== null) {
        for (let slot = -pastSlots; slot <= 2; slot++) {
            const start = airingStart + slot * SLOT_MS;
            const title = slot === 0 ? 'Fresh Bulletin' : `Archive ${slot}`;
            programmes.push(
                `<programme start="${xmltvDate(start)}" stop="${xmltvDate(start + SLOT_MS)}" channel="${CHANNEL_ID}"><title>${title}</title></programme>`
            );
        }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
<channel id="${CHANNEL_ID}"><display-name>${CHANNEL_NAME}</display-name></channel>
${programmes.join('\n')}
</tv>`;
}

/**
 * The playing channel's programme panel is read once per zap. A guide that
 * arrives while the channel plays — here a refresh whose schedule carries
 * two weeks of history — must show today's programme without a re-zap.
 */
test('@epg @electron the playing M3U channel shows today after a guide refresh with a long history', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    const epgServer = await createMutableTextServer(guide(null), {
        contentType: 'application/xml; charset=utf-8',
        resourcePath: '/guides/refill.xml',
    });
    const playlistServer = await createMutableTextServer(
        buildM3uContent([
            {
                name: CHANNEL_NAME,
                tvgId: CHANNEL_ID,
                url: 'https://streams.example.test/live/refill-news.m3u8',
            },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${epgServer.resourceUrl}"`),
        {
            contentType: 'application/x-mpegurl; charset=utf-8',
            resourcePath: '/refill.m3u',
        }
    );
    const app = await launchElectronApp(dataDir);

    try {
        const page = app.mainWindow;
        await page.route('https://streams.example.test/**', () => {
            // Guide data is local; keep the synthetic stream pending.
        });
        await importM3uPlaylistFromUrl(page, playlistServer.resourceUrl);
        await expect(
            page.locator('.epg-progress-panel .import-item.status-complete')
        ).toHaveCount(1, { timeout: 30_000 });

        await openWorkspaceSection(page, 'All channels');
        await channelItemByTitle(page, CHANNEL_NAME).click();
        const timeline = page.locator('app-epg-timeline');
        await expect(timeline).toBeVisible({ timeout: 20_000 });
        await expect(timeline).not.toContainText('Fresh Bulletin');

        // 700 ended half-hour slots: more than the schedule's row cap.
        epgServer.setBody(guide(700));
        const result = await page.evaluate(
            (url) => window.electron.forceFetchEpg(url),
            epgServer.resourceUrl
        );
        expect(result.success).toBe(true);

        await expect(
            timeline.locator('.epg-timeline__block.is-now')
        ).toContainText('Fresh Bulletin', { timeout: 30_000 });
    } finally {
        await closeElectronApp(app);
        await playlistServer.close();
        await epgServer.close();
    }
});
