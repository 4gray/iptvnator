import type { APIRequestContext, Browser } from '@playwright/test';
import { expect } from './fixtures';
import {
    newServerPage,
    STORAGE_BACKEND_URL,
} from './server-storage-pwa.helpers';
import { cachedSource } from './source-pruning-pwa.helpers';
import { openSources, sourceRowByTitle } from './sources-pwa.helpers';

/** An accepted deletion does not authorize deleting later sibling writes. */
export async function verifyConcurrentSourceDeletion(
    browser: Browser,
    request: APIRequestContext,
    kind: 'single' | 'all',
    reuseId: boolean
) {
    const first = await newServerPage(browser);
    const context = first.context();
    await context.addInitScript(() =>
        Object.defineProperty(navigator, 'locks', { value: undefined })
    );
    await context.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(STORAGE_BACKEND_URL)} };`,
        })
    );
    const original = {
        id: 'cleared-source',
        title: 'Source before deletion',
        kind: 'm3u-text',
        rawM3u: '#EXTM3U\n#EXTINF:-1,Old\nhttps://media.test/old',
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let deleted = false;
    let successful = false;
    const deletionUrl = `${STORAGE_BACKEND_URL}/v1/sources${kind === 'single' ? `/${original.id}` : ''}`;
    await first.route(deletionUrl, async (route) => {
        if (route.request().method() !== 'DELETE') return route.continue();
        const response = await route.fetch();
        successful = response.ok();
        deleted = true;
        await gate;
        await route.fulfill({ response });
    });
    try {
        expect(
            (
                await request.put(
                    `${STORAGE_BACKEND_URL}/v1/sources/${original.id}`,
                    {
                        headers: { 'If-None-Match': '*' },
                        data: original,
                    }
                )
            ).ok()
        ).toBe(true);
        const { instanceId } = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await openSources(first);
        await expect(sourceRowByTitle(first, original.title)).toBeVisible();
        expect(await first.evaluate(() => navigator.locks === undefined)).toBe(
            true
        );
        const second = await context.newPage();
        await openSources(second);
        await expect(sourceRowByTitle(second, original.title)).toBeVisible();
        if (kind === 'single') {
            const row = sourceRowByTitle(first, original.title);
            await row.hover();
            await row.locator('.source-row__more').click();
            await first
                .getByRole('menuitem', { name: 'Remove playlist', exact: true })
                .click();
            await first.locator('.source-removal-toast__close').click();
        } else {
            await first.goto('/workspace/settings/backup');
            await first
                .getByRole('button', { name: 'Delete all', exact: true })
                .click();
            await first
                .getByRole('dialog')
                .getByRole('button', { name: 'Delete everything', exact: true })
                .click();
        }
        await expect.poll(() => deleted).toBe(true);
        expect(successful).toBe(true);
        const sibling = {
            ...original,
            id: reuseId ? original.id : 'new-sibling-source',
            title: 'Source added after deletion',
            rawM3u: '#EXTM3U\n#EXTINF:-1,New\nhttps://media.test/new',
        };
        const created = await request.put(
            `${STORAGE_BACKEND_URL}/v1/sources/${sibling.id}`,
            {
                headers: { 'If-None-Match': '*' },
                data: sibling,
            }
        );
        expect(created.ok()).toBe(true);
        await second.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(sourceRowByTitle(second, sibling.title)).toBeVisible();
        await cachedSource(second, instanceId, sibling.id, true);
        const expected = await cachedSource(second, instanceId, sibling.id);
        const completed = first.waitForResponse(
            (response) =>
                response.url() === deletionUrl &&
                response.request().method() === 'DELETE'
        );
        release();
        await completed;
        if (kind === 'single')
            await expect(sourceRowByTitle(first, sibling.title)).toBeVisible();
        else
            await expect(
                first.getByText(
                    'All playlists and playlist data were removed.',
                    {
                        exact: true,
                    }
                )
            ).toBeVisible();
        expect(await cachedSource(first, instanceId, sibling.id)).toEqual(
            expected
        );
        await first.reload();
        await openSources(first);
        await expect(sourceRowByTitle(first, sibling.title)).toBeVisible();
        await second.reload();
        await expect(sourceRowByTitle(second, sibling.title)).toBeVisible();
        expect(
            await cachedSource(second, instanceId, sibling.id)
        ).toMatchObject({
            sourceSyncRevision: created.headers()['etag'],
            favorites: ['sibling-favorite'],
        });
        const stored = await request.get(
            `${STORAGE_BACKEND_URL}/v1/sources/${sibling.id}`
        );
        expect(stored.headers()['etag']).toBe(created.headers()['etag']);
        expect(await stored.json()).toMatchObject(sibling);
    } finally {
        release();
        await context.close();
    }
}
