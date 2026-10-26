import { expect, test } from './fixtures';
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
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
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
