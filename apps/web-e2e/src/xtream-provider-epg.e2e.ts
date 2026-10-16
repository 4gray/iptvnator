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
