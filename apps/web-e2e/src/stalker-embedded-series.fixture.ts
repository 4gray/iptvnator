import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import {
    BACKEND_PROXY,
    EMBEDDED_SERIES_MAC,
    MOCK_SERVER,
} from './stalker-portal.fixture';

/** A VOD row of the embedded-series scenario carrying a `series[]` array. */
interface EmbeddedSeriesItem {
    name: string;
    series: unknown[];
}

/**
 * Finds a VOD item carrying an embedded series[] array in the mock catalog
 * and reports how many episodes it currently has.
 */
export async function findEmbeddedSeriesItem(
    request: APIRequestContext
): Promise<{ embeddedItem: EmbeddedSeriesItem; episodeCount: number }> {
    const listResponse = await request.get(
        `${MOCK_SERVER}/stalker?action=get_ordered_list&type=vod&category=2001&p=1&macAddress=${EMBEDDED_SERIES_MAC}&JsHttpRequest=1-xml`
    );
    const listBody = await listResponse.json();
    const embeddedItem = listBody.payload.js.data.find(
        (item: { series?: unknown[] }) =>
            Array.isArray(item.series) && item.series.length > 0
    );
    expect(embeddedItem).toBeDefined();
    const episodeCount: number = embeddedItem.series.length;

    return { embeddedItem, episodeCount };
}

/**
 * Opens the embedded-series item from its category (the first row is "All")
 * and waits until the series detail lists its last episode. Returns the
 * item's card in the category grid.
 */
export async function openEmbeddedSeriesItem(
    page: Page,
    itemName: string,
    episodeCount: number
): Promise<Locator> {
    const categories = page.locator('.category-item');
    await expect(categories.first()).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();
    const card = page.getByText(itemName).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    await expect(
        page.getByRole('heading', {
            name: `${episodeCount}. Episode ${episodeCount}`,
            exact: true,
        })
    ).toBeVisible({ timeout: 10_000 });

    return card;
}

/**
 * From now on the portal has "released" one more episode: extend series[] in
 * every search response (the background snapshot refresh re-fetches the item
 * via a title search).
 */
export async function releaseExtraEpisodeInSearchResponses(
    page: Page
): Promise<void> {
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const originalUrl = new URL(route.request().url());
        if (!originalUrl.searchParams.get('search')) {
            await route.fallback();
            return;
        }

        const mockUrl = new URL(BACKEND_PROXY);
        const targetId = originalUrl.searchParams.get('targetId');
        const providerUrl = targetId
            ? Buffer.from(targetId, 'base64url').toString()
            : originalUrl.searchParams.get('url');
        if (providerUrl) {
            mockUrl.searchParams.set('url', providerUrl);
        }
        originalUrl.searchParams.forEach((value, key) => {
            if (key === 'targetId') {
                return;
            }
            mockUrl.searchParams.set(key, value);
        });

        const response = await route.fetch({ url: mockUrl.toString() });
        const body = await response.json();
        const rows: { series?: string[] }[] =
            body?.payload?.js?.data ?? body?.js?.data ?? [];
        for (const row of rows) {
            if (Array.isArray(row.series) && row.series.length > 0) {
                row.series = [...row.series, String(row.series.length + 1)];
            }
        }
        await route.fulfill({ response, body: JSON.stringify(body) });
    });
}
