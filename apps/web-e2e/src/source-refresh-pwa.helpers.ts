import type { APIRequestContext, Browser } from '@playwright/test';
import { expect } from './fixtures';
import {
    newServerPage,
    STORAGE_BACKEND_URL,
} from './server-storage-pwa.helpers';
import { openSources, sourceRowByTitle } from './sources-pwa.helpers';

/** Browser transport must carry the download's original URL into its result. */
export async function verifyDelayedBrowserSourceRefresh(
    browser: Browser,
    request: APIRequestContext
) {
    const page = await newServerPage(browser);
    let stage: 'initial' | 'held' | 'new' = 'initial';
    let waiting = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const source = {
        id: 'delayed-browser-refresh',
        title: 'Delayed browser source',
        kind: 'm3u-url',
        url: `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}/playlist.m3u?version=old`,
    };
    await page.route(`${STORAGE_BACKEND_URL}/parse?*`, async (route) => {
        const held = stage === 'held';
        if (held) {
            waiting = true;
            await gate;
        }
        const name =
            !held && stage === 'new'
                ? 'New browser channel'
                : 'Old browser channel';
        await route.fulfill({
            json: {
                _id: 'parsed',
                title: source.title,
                count: 1,
                playlist: {
                    header: { raw: '#EXTM3U' },
                    items: [
                        {
                            id: name,
                            name,
                            url: 'https://streams.example.test/channel.ts',
                        },
                    ],
                },
            },
        });
    });
    try {
        const created = await request.put(
            `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`,
            {
                headers: { 'If-None-Match': '*' },
                data: source,
            }
        );
        expect(created.ok()).toBe(true);
        await openSources(page);
        const row = sourceRowByTitle(page, source.title);
        await expect(row).toBeVisible();
        stage = 'held';
        await row
            .getByRole('button', { name: 'Refresh playlist', exact: true })
            .click();
        await expect.poll(() => waiting).toBe(true);
        const accepted = {
            ...source,
            title: 'Updated browser source',
            url: source.url.replace('version=old', 'version=new'),
        };
        const edited = await request.patch(
            `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`,
            {
                headers: { 'If-Match': created.headers()['etag'] },
                data: accepted,
            }
        );
        expect(edited.ok()).toBe(true);
        stage = 'new';
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        const currentRow = sourceRowByTitle(page, accepted.title);
        await expect(currentRow).toBeVisible();
        release();
        await expect(
            page
                .locator('.mat-mdc-snack-bar-label')
                .filter({
                    hasText: 'Success! The playlist was successfully updated.',
                })
                .last()
        ).toBeVisible();
        await currentRow
            .getByRole('button', { name: accepted.title, exact: true })
            .click();
        await expect(
            page.locator('app-channel-list-item').first()
        ).toContainText('New browser channel');
        await expect(
            page
                .locator('app-channel-list-item')
                .filter({ hasText: 'Old browser channel' })
        ).toHaveCount(0);
        const stored = await request.get(
            `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`
        );
        expect(await stored.json()).toMatchObject(accepted);
        expect(stored.headers()['etag']).toBe(edited.headers()['etag']);
    } finally {
        release();
        await page.context().close();
    }
}
