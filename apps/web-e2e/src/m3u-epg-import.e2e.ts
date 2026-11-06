import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    interceptPwaProviderRequests,
    openSources,
    sourceRowByTitle,
} from './sources-pwa.helpers';

test.use({ testIdAttribute: 'data-test-id' });
const firstGuide = 'https://epg.example.test/first.xml';
const nextGuide = 'https://epg.example.test/next.xml';
const playlistUrl = 'https://provider.example.test/channels.m3u';
const raw = `#EXTM3U x-tvg-url="${firstGuide}"\n#EXTINF:-1,Channel\nhttps://media.example.test/live`;

async function stored(page: Page) {
    return page.evaluate(
        () =>
            new Promise<
                {
                    autoImportEpg?: boolean;
                    detectedEpgUrls?: string[];
                    epgUrls?: string[];
                }[]
            >((resolve, reject) => {
                const request = indexedDB.open('iptvnator');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
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
            })
    );
}

async function openImport(page: Page) {
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    return page.getByRole('dialog');
}

for (const enabled of [true, false]) {
    test(`URL import EPG=${enabled} persists through reload and a new detected source`, async ({
        page,
    }) => {
        await interceptPwaProviderRequests(page);
        let guide = firstGuide;
        let parseRequests = 0;
        let providerRequests = 0;
        page.on('request', (request) => {
            if (request.url().includes('/provider-targets')) providerRequests++;
        });
        await page.route('http://localhost:3000/parse**', (route) => {
            parseRequests++;
            return route.fulfill({
                json: {
                    _id: 'epg-import-url',
                    title: 'EPG URL',
                    filename: 'EPG URL',
                    count: 1,
                    url: playlistUrl,
                    autoRefresh: false,
                    importDate: new Date().toISOString(),
                    lastUsage: '',
                    favorites: [],
                    playlist: {
                        header: { raw: `#EXTM3U x-tvg-url="${guide}"` },
                        items: [
                            {
                                name: 'Channel',
                                url: 'https://media.example.test/live',
                            },
                        ],
                    },
                    detectedEpgUrls: [guide],
                    epgUrls: [guide],
                },
            });
        });
        await page.goto('/workspace/sources');
        const dialog = await openImport(page);
        const checkbox = dialog
            .getByTestId('m3u-import-epg')
            .getByRole('checkbox');
        await expect(checkbox).toBeChecked();
        await checkbox.setChecked(enabled);
        await dialog
            .getByRole('textbox', { name: /Playlist URL/ })
            .fill(playlistUrl);
        await dialog
            .getByRole('textbox', { name: 'Playlist title' })
            .fill('EPG URL');
        // Method switches retain the choice and do not inspect the remote playlist.
        await dialog
            .getByRole('radio', { name: 'Xtream credentials', exact: true })
            .click();
        await expect(checkbox).toHaveCount(0);
        await dialog
            .getByRole('radio', { name: 'M3U URL', exact: true })
            .click();
        await expect(checkbox).toBeChecked({ checked: enabled });
        expect(parseRequests).toBe(0);
        expect(providerRequests).toBe(0);
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        await expect
            .poll(async () => (await stored(page))[0]?.detectedEpgUrls)
            .toEqual([firstGuide]);
        expect((await stored(page))[0]?.epgUrls).toEqual(
            enabled ? [firstGuide] : []
        );
        expect(parseRequests).toBe(1);

        await openSources(page);
        await page.reload();
        guide = nextGuide;
        const row = sourceRowByTitle(page, 'EPG URL');
        await row.hover();
        await row.locator('.source-row__refresh').click();
        await expect
            .poll(async () => (await stored(page))[0]?.detectedEpgUrls)
            .toEqual([nextGuide]);
        expect((await stored(page))[0]?.epgUrls).toEqual(
            enabled ? [nextGuide] : []
        );
        if (!enabled)
            expect((await stored(page))[0]?.autoImportEpg).toBe(false);
        expect(parseRequests).toBe(2);

        const reopened = await openImport(page);
        await expect(
            reopened.getByTestId('m3u-import-epg').getByRole('checkbox')
        ).toBeChecked();
    });
}

for (const method of ['M3U file', 'Raw m3u text']) {
    test(`${method} retains detected EPG without enabling it when unchecked`, async ({
        page,
    }) => {
        await interceptPwaProviderRequests(page);
        await page.goto('/workspace/sources');
        const dialog = await openImport(page);
        await dialog.getByRole('radio', { name: method, exact: true }).click();
        await dialog
            .getByTestId('m3u-import-epg')
            .getByRole('checkbox')
            .uncheck();
        if (method === 'M3U file') {
            await dialog.locator('input[type=file]').setInputFiles({
                name: 'epg-option.m3u',
                mimeType: 'audio/x-mpegurl',
                buffer: Buffer.from(raw),
            });
        } else {
            await dialog.locator('textarea').fill(raw);
        }
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog).toBeHidden();
        await expect
            .poll(async () => (await stored(page))[0]?.autoImportEpg)
            .toBe(false);
        expect((await stored(page))[0]?.detectedEpgUrls).toEqual([firstGuide]);
        expect((await stored(page))[0]?.epgUrls).toEqual([]);
    });
}
