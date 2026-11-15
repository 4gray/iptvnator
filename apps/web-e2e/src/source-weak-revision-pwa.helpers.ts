import type { APIRequestContext, Browser } from '@playwright/test';
import { expect } from './fixtures';
import {
    newServerPage,
    STORAGE_BACKEND_URL,
} from './server-storage-pwa.helpers';
import { openSources, sourceRowByTitle } from './sources-pwa.helpers';

/**
 * The shipped nginx gzips API responses and so weakens their ETags
 * (`"tag"` → `W/"tag"`). Clearing the library sends the inventory's header
 * ETag back in `If-Match`, so the browser sends the weak form and the
 * server must still accept it. Per-source edits send the revision the PWA
 * stored from a response header — weak too once that response was gzipped
 * (bodies of 1 KiB and more, e.g. a large inline M3U); the router spec
 * covers weak PATCH and DELETE.
 */
export async function verifyWeakSourceRevisions(
    browser: Browser,
    request: APIRequestContext
): Promise<void> {
    const page = await newServerPage(browser);
    const library = `${STORAGE_BACKEND_URL}/v1/sources`;
    await page.route(`${library}**`, async (route) => {
        const response = await route.fetch();
        const headers = response.headers();
        const etag = headers['etag'];
        if (etag && !etag.startsWith('W/')) headers['etag'] = `W/${etag}`;
        await route.fulfill({ response, headers });
    });
    const source = {
        id: 'weak-revision-source',
        title: 'Source behind a gzip proxy',
        kind: 'm3u-text',
        rawM3u: '#EXTM3U\n#EXTINF:-1,Weak\nhttps://media.test/weak',
    };
    const url = `${library}/${source.id}`;
    try {
        expect(
            (
                await request.put(url, {
                    headers: { 'If-None-Match': '*' },
                    data: source,
                })
            ).ok()
        ).toBe(true);
        await openSources(page);
        await expect(sourceRowByTitle(page, source.title)).toBeVisible();
        const cleared = page.waitForResponse(
            (response) =>
                response.url() === library &&
                response.request().method() === 'DELETE'
        );
        await page.goto('/workspace/settings/backup');
        await page
            .getByRole('button', { name: 'Delete all', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Delete everything', exact: true })
            .click();
        const response = await cleared;
        expect(response.request().headers()['if-match']).toMatch(/^W\/"/);
        expect(response.status()).toBe(200);
        expect((await request.get(url)).status()).toBe(404);
    } finally {
        await page.context().close();
    }
}
