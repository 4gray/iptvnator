import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect } from './fixtures';
import {
    newServerPage,
    STORAGE_BACKEND_URL,
} from './server-storage-pwa.helpers';
import {
    openSources,
    openSourceEditor,
    sourceRowByTitle,
} from './sources-pwa.helpers';

async function storedPreference(page: Page, instanceId: string) {
    return page.evaluate(
        (instanceId) =>
            new Promise<
                {
                    _id: string;
                    autoImportEpg?: boolean;
                    epgUrls?: string[];
                    detectedEpgUrls?: string[];
                }[]
            >((resolve, reject) => {
                const open = indexedDB.open(`iptvnator-server:${instanceId}`);
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const db = open.result;
                    const read = db
                        .transaction('playlists')
                        .objectStore('playlists')
                        .getAll();
                    read.onsuccess = () => {
                        db.close();
                        resolve(read.result);
                    };
                    read.onerror = () => {
                        db.close();
                        reject(read.error);
                    };
                };
            }),
        instanceId
    );
}

/** A sibling creates the same source after inventory, just before this import. */
export async function verifyCanonicalM3uEpgOptOut(
    browser: Browser,
    request: APIRequestContext
): Promise<void> {
    const page = await newServerPage(browser);
    const id = 'synthetic-canonical-epg';
    const title = 'Synthetic canonical EPG source';
    const guide = 'https://guide.example.test/canonical.xml';
    const instance = await (
        await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
    ).json();
    let seeded = false;
    try {
        await openSources(page);
        await page.route(
            `${STORAGE_BACKEND_URL}/v1/sources/*`,
            async (route) => {
                if (route.request().method() === 'PUT' && !seeded) {
                    const incoming = route.request().postDataJSON();
                    expect(incoming.id).not.toBe(id);
                    expect(incoming).not.toHaveProperty('autoImportEpg');
                    const created = await request.put(
                        `${STORAGE_BACKEND_URL}/v1/sources/${id}`,
                        {
                            headers: { 'If-None-Match': '*' },
                            data: { ...incoming, id, title },
                        }
                    );
                    expect(created.ok()).toBe(true);
                    seeded = true;
                }
                await route.continue();
            }
        );
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.getByRole('dialog');
        await dialog
            .getByRole('radio', { name: 'Raw m3u text', exact: true })
            .click();
        await dialog
            .locator('[data-test-id="m3u-import-epg"]')
            .getByRole('checkbox')
            .uncheck();
        await dialog
            .locator('textarea')
            .fill(
                `#EXTM3U x-tvg-url="${guide}"\n#EXTINF:-1,Synthetic channel\nhttps://media.example.test/live`
            );
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        // Closing the import dialog only dispatches parsing. Navigation waits
        // for the server write and adoption of the sibling's canonical ID.
        await expect(page).toHaveURL(new RegExp(`/playlists/${id}/`));
        expect(seeded).toBe(true);
        await openSources(page);
        await expect(sourceRowByTitle(page, title)).toBeVisible();
        for (let attempt = 0; attempt < 2; attempt++) {
            const rows = await storedPreference(page, instance.instanceId);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                _id: id,
                autoImportEpg: false,
                detectedEpgUrls: [guide],
                epgUrls: [],
            });
            const editor = await openSourceEditor(page, title);
            await expect(
                editor.locator('[data-test-id="playlist-epg-detected-count"]')
            ).toHaveText('From playlist: 0 of 1 enabled.');
            await expect(
                editor.locator('[data-epg-source-state="enabled"]')
            ).toHaveCount(0);
            await editor
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            if (attempt === 0) {
                await page.reload();
                await openSources(page);
            }
        }
    } finally {
        await page.context().close();
    }
}
