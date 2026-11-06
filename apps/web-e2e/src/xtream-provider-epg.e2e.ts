import { expect, test } from './fixtures';
import { applyUiTheme } from './ui-consistency.fixture';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

/**
 * Provider EPG in the browser PWA (#1683). Xtream `get_short_epg` (row
 * previews) and `get_simple_data_table` (player panel) reach the portal
 * through the backend `/xtream` proxy. The mock's `epg:epg` scenario pins
 * the guide: "Timezone News" in "EPG Focus" airs "Global Headlines" now.
 */
const EPG_PORTAL = { name: 'EPG Portal', username: 'epg', password: 'epg' };

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset?username=epg&password=epg`);
    await page.goto('/');
    await interceptXtreamRequests(page);
});

test('@xtream @epg PWA keeps CJK narrow titles upright without rotating other scripts differently', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    // CI's WenQuanYi Zen Hei has zero vertical advances for Han glyphs.
    // Noto CJK is installed by the web E2E workflow; other hosts use fallback.
    await page.addStyleTag({
        content: `[data-upright] { font-family: 'Noto Sans CJK SC', sans-serif; }`,
    });
    const titles = [
        { title: '测试甲乙', upright: true },
        { title: '測試甲乙', upright: true },
        { title: 'てすと', upright: true },
        { title: 'テスト', upright: true },
        { title: '테스트', upright: true },
        { title: 'Test 12（测试）', upright: true },
        { title: '测试甲乙'.repeat(12), upright: true },
        { title: 'Test programme', upright: false },
        { title: 'Тестовая передача', upright: false },
        { title: 'Δοκιμαστική εκπομπή', upright: false },
        { title: 'برنامج تجريبي', upright: false },
    ];
    const start = Math.floor(Date.now() / 1000) - 15 * 60;
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action !== 'get_simple_data_table') {
            await route.fallback();
            return;
        }
        await route.fulfill({
            json: {
                action,
                payload: {
                    epg_listings: titles.map(({ title }, index) => ({
                        id: String(index + 1),
                        title: Buffer.from(title).toString('base64'),
                        description: '',
                        start_timestamp: String(start + index * 30 * 60),
                        stop_timestamp: String(start + (index + 1) * 30 * 60),
                    })),
                },
            },
        });
    });
    // Keep playback local; this test only needs the guide.
    await page.route('**/live/**', (route) => route.abort());
    await addXtreamPortal(page, EPG_PORTAL);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('.context-panel .category-item')
        .filter({ hasText: 'EPG Focus' })
        .click();
    await page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .filter({ hasText: 'Timezone News' })
        .click();

    const timeline = page.locator('app-live-stream-layout app-epg-timeline');
    const ribbon = timeline.locator('.epg-timeline__ribbon');
    const firstLeft = await timeline
        .getByRole('button', { name: titles[0].title, exact: true })
        .evaluate((element) => (element as HTMLElement).offsetLeft);
    for (const dark of [false, true]) {
        await applyUiTheme(page, dark);
        for (const [index, { title, upright }] of titles.entries()) {
            // Scroll before looking up the node: the track windows its blocks.
            await ribbon.evaluate(
                (element, left) => {
                    element.scrollLeft = left;
                },
                firstLeft + index * 30 * 1.75 - 40
            );
            const block = timeline.getByRole('button', {
                name: title,
                exact: true,
            });
            await expect(block).toHaveAttribute('data-tier', 'narrow');
            const label = block.locator('.epg-timeline__block-title');
            await expect(label).toHaveCSS('writing-mode', 'vertical-rl');
            await expect(label).toHaveCSS('text-orientation', 'mixed');
            await expect(label).toHaveCSS(
                'transform',
                upright ? 'none' : 'matrix(-1, 0, 0, -1, 0, 0)'
            );
        }
        await ribbon.evaluate((element, left) => {
            element.scrollLeft = left;
        }, firstLeft - 40);
        for (const { title } of titles.filter((entry) => entry.upright)) {
            const label = timeline
                .getByRole('button', { name: title, exact: true })
                .locator('.epg-timeline__block-title');
            const direction = await label.evaluate((element) => {
                const text = element.firstChild;
                if (!text)
                    throw new Error('Expected a programme title text node');
                const characters = Array.from(
                    (text.textContent ?? '').matchAll(
                        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
                    )
                );
                const [first, second] = characters;
                if (!first || !second)
                    throw new Error('Expected two native vertical characters');
                const range = document.createRange();
                range.setStart(text, first.index);
                range.setEnd(text, first.index + first[0].length);
                const firstTop = range.getBoundingClientRect().top;
                range.setStart(text, second.index);
                range.setEnd(text, second.index + second[0].length);
                return range.getBoundingClientRect().top - firstTop;
            });
            expect(
                direction,
                `Vertical character order in ${title}`
            ).toBeGreaterThan(0);
        }
        const longLabel = timeline
            .getByRole('button', { name: titles[6].title, exact: true })
            .locator('.epg-timeline__block-title');
        expect(
            await longLabel.evaluate(
                (element) => element.scrollHeight > element.clientHeight
            )
        ).toBe(true);
        await expect(longLabel).toHaveCSS('text-overflow', 'ellipsis');
        await expect(longLabel).toHaveCSS('overflow', 'hidden');
        await page.screenshot({
            path: test
                .info()
                .outputPath(`epg-title-scripts-${dark ? 'dark' : 'light'}.png`),
        });
    }

    await timeline.locator('.epg-timeline__zoom').click();
    await timeline.locator('.epg-timeline__jump').click();
    const medium = timeline.getByRole('button', {
        name: titles[0].title,
        exact: true,
    });
    await expect(medium).toHaveAttribute('data-tier', 'med');
    await expect(medium.locator('.epg-timeline__block-title')).toHaveCSS(
        'writing-mode',
        'horizontal-tb'
    );
    await expect(medium.locator('.epg-timeline__block-title')).toHaveCSS(
        'transform',
        'none'
    );
});

test('@xtream @epg PWA shows the provider guide in the channel list and beside the player', async ({
    page,
}) => {
    const proxiedActions: string[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        const action = url.searchParams.get('action');
        if (url.pathname.endsWith('/xtream') && action) {
            proxiedActions.push(action);
        }
    });

    await addXtreamPortal(page, EPG_PORTAL);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('.context-panel .category-item')
        .filter({ hasText: 'EPG Focus' })
        .click();

    const channel = page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .filter({ hasText: 'Timezone News' });
    await expect(channel.locator('.epg-title')).toHaveText('Global Headlines', {
        timeout: 20_000,
    });
    expect(proxiedActions).toContain('get_short_epg');

    await channel.click();
    await expect(page.locator('app-web-player-view')).toBeVisible({
        timeout: 20_000,
    });
    await expect(
        page
            .locator(
                'app-live-stream-layout app-epg-timeline .epg-timeline__block'
            )
            .filter({ hasText: 'Global Headlines' })
            .first()
    ).toBeVisible({ timeout: 20_000 });
    expect(proxiedActions).toContain('get_simple_data_table');
});

test('@xtream @epg @collections PWA starts favorite playback while the provider guide is pending', async ({
    page,
}) => {
    await addXtreamPortal(page, EPG_PORTAL);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('.context-panel .category-item')
        .filter({ hasText: 'EPG Focus' })
        .click();
    const channel = page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .filter({ hasText: 'Timezone News' });
    await expect(channel).toBeVisible();
    await channel.locator('.favorite-button').click();
    await expect(channel.locator('.favorite-button mat-icon')).toHaveText(
        'star'
    );
    await page.goto('/workspace/global-favorites');
    const row = page
        .locator('app-global-favorites-list [data-test-id="channel-item"]')
        .filter({ hasText: 'Timezone News' });
    await expect(row).toBeVisible();

    let releaseGuide!: () => void;
    const pendingGuide = new Promise<void>((resolve) => {
        releaseGuide = resolve;
    });
    let guideStarted!: () => void;
    const guideRequest = new Promise<void>((resolve) => {
        guideStarted = resolve;
    });
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (
            action === 'get_simple_data_table' ||
            action === 'get_simple_date_table'
        ) {
            guideStarted();
            await pendingGuide;
        }
        await route.fallback();
    });
    try {
        await row.click();
        await guideRequest;
        // The previous implementation waited up to 10 seconds for this request.
        await expect(
            page.locator('app-unified-live-tab app-web-player-view')
        ).toBeVisible({ timeout: 3000 });
        releaseGuide();
        await expect(
            page
                .locator(
                    'app-unified-live-tab app-epg-timeline .epg-timeline__block'
                )
                .filter({ hasText: 'Global Headlines' })
                .first()
        ).toBeVisible();
    } finally {
        releaseGuide();
    }
});
