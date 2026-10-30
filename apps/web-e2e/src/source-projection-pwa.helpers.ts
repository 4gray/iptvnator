import type { APIRequestContext, Browser } from '@playwright/test';
import { expect } from './fixtures';
import {
    newServerPage,
    STORAGE_BACKEND_URL,
} from './server-storage-pwa.helpers';
import { cachedSource } from './source-pruning-pwa.helpers';
import { openSources, sourceRowByTitle } from './sources-pwa.helpers';

/** Exercise both commits against the same IndexedDB while one fetch is held. */
export async function verifyConcurrentSourceProjection(
    browser: Browser,
    request: APIRequestContext,
    change: 'edit' | 'delete'
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
    const provider = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;
    const source = {
        id: 'projection-race',
        title: 'Original source',
        kind: 'm3u-url',
        url: `${provider}/playlist.m3u?version=initial`,
    };
    const parsed = (name: string) => ({
        header: { raw: '#EXTM3U', attrs: {} },
        items: [{ name, url: 'https://streams.example.test/live.ts' }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let held = false;
    let holdNext = false;
    await first.route(`${STORAGE_BACKEND_URL}/parse?*`, async (route) => {
        const pending = holdNext;
        holdNext = false;
        if (pending) {
            held = true;
            await gate;
        }
        await route.fulfill({
            json: parsed(pending ? 'Obsolete channel' : 'Initial channel'),
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
        const { instanceId } = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await openSources(first);
        await expect(sourceRowByTitle(first, source.title)).toBeVisible();
        expect(await cachedSource(first, instanceId, source.id)).toMatchObject({
            playlist: { items: [{ name: 'Initial channel' }] },
        });
        expect(await first.evaluate(() => navigator.locks === undefined)).toBe(
            true
        );
        const second = await context.newPage();
        await second.route(`${STORAGE_BACKEND_URL}/parse?*`, (route) =>
            route.fulfill({ json: parsed('Current channel') })
        );
        await openSources(second);
        await expect(sourceRowByTitle(second, source.title)).toBeVisible();
        const pending = await request.patch(
            `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`,
            {
                headers: { 'If-Match': created.headers()['etag'] },
                data: {
                    ...source,
                    url: `${provider}/playlist.m3u?version=pending`,
                },
            }
        );
        expect(pending.ok()).toBe(true);
        holdNext = true;
        await first.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect.poll(() => held).toBe(true);
        const latest = {
            ...source,
            title: 'Current source',
            url: `${provider}/playlist.m3u?version=current`,
        };
        const updated =
            change === 'edit'
                ? await request.patch(
                      `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`,
                      {
                          headers: {
                              'If-Match': pending.headers()['etag'],
                          },
                          data: latest,
                      }
                  )
                : await request.delete(
                      `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`,
                      {
                          headers: {
                              'If-Match': pending.headers()['etag'],
                          },
                      }
                  );
        expect(updated.ok()).toBe(true);
        await second.evaluate(() => window.dispatchEvent(new Event('focus')));
        if (change === 'edit') {
            await expect(sourceRowByTitle(second, latest.title)).toBeVisible();
            await cachedSource(second, instanceId, source.id, true);
        } else {
            await expect
                .poll(() => cachedSource(second, instanceId, source.id))
                .toBeUndefined();
        }
        const expected = await cachedSource(second, instanceId, source.id);
        const inventory = await request.get(
            `${STORAGE_BACKEND_URL}/v1/sources`
        );
        release();
        const status = first.locator('[data-test-id="source-sync-status"]');
        await expect(status).toContainText('Server unavailable');
        expect(await cachedSource(first, instanceId, source.id)).toEqual(
            expected
        );
        if (change === 'edit') {
            expect(expected).toMatchObject({
                url: latest.url,
                sourceSyncRevision: updated.headers()['etag'],
                favorites: ['sibling-favorite'],
                playlist: { items: [{ name: 'Current channel' }] },
            });
        }
        await status
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        await expect(status).toHaveCount(0);
        await second.reload();
        if (change === 'edit')
            await expect(sourceRowByTitle(second, latest.title)).toBeVisible();
        else
            await expect(sourceRowByTitle(second, source.title)).toHaveCount(0);
        expect(await cachedSource(second, instanceId, source.id)).toEqual(
            expected
        );
        expect(
            (
                await request.get(`${STORAGE_BACKEND_URL}/v1/sources`, {
                    headers: {
                        'If-None-Match': inventory.headers()['etag'],
                    },
                })
            ).status()
        ).toBe(304);
    } finally {
        release();
        await context.close();
    }
}

/** Cached sources and settings remain usable while a provider is slow. */
export async function verifyCachedSourcesDuringMaterialization(
    browser: Browser,
    request: APIRequestContext
) {
    const page = await newServerPage(browser);
    const id = 'slow-projection';
    const title = 'Slow shared URL';
    const provider = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;
    const put = (url: string) =>
        request.put(`${STORAGE_BACKEND_URL}/v1/playlists/${id}`, {
            data: { _id: id, title, url },
        });
    expect((await put(`${provider}/playlist.m3u`)).ok()).toBe(true);
    let release!: () => void;
    let started!: () => void;
    let gate: Promise<void>;
    let providerStarted: Promise<void>;
    const hold = () => {
        gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        providerStarted = new Promise<void>((resolve) => {
            started = resolve;
        });
    };
    hold();
    await page.route(`${STORAGE_BACKEND_URL}/parse?*`, async (route) => {
        started();
        await gate;
        await route.fulfill({
            json: {
                header: { raw: '#EXTM3U', attrs: {} },
                items: [
                    {
                        name: 'Cached channel',
                        url: 'https://streams.test/live.ts',
                    },
                ],
            },
        });
    });
    try {
        await page.goto('/workspace/sources');
        await providerStarted!;
        await page
            .locator('[data-test-id="source-sync-status"]')
            .getByRole('link', { name: 'Server', exact: true })
            .click();
        await expect(page).toHaveURL(/\/workspace\/settings\/server/);
        await expect(page.locator('app-settings-server-section')).toBeVisible();
        release();
        await page.locator('a[href="/workspace/sources"]').first().click();
        await expect(sourceRowByTitle(page, title)).toBeVisible();
        expect((await put(`${provider}/changed.m3u`)).ok()).toBe(true);
        hold();
        await page.reload();
        await providerStarted!;
        await expect(sourceRowByTitle(page, title)).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Open settings', exact: true })
        ).toBeVisible();
        release();
    } finally {
        release();
        await page.context().close();
    }
}
