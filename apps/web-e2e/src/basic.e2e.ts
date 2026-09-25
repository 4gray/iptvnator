import { join } from 'path';
import { expect, test } from './fixtures';

const fixturePath = join(__dirname, 'fixtures/test.m3u');

test('@web @m3u basic playlist import flow', async ({ page }) => {
    // The fixture's placeholder media hosts must not delay navigation or make
    // persistence coverage depend on external DNS and asset availability.
    await page.route(
        /^https?:\/\/(?:channel\.icons\.url|example\.channels|xml-url)\//,
        (route) => route.abort()
    );
    await page.goto('/');

    // Basic checks
    expect(await page.title()).toBe('IPTVnator');

    // Upload playlist test
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    // v0.22 redesign: tabs were replaced with a flat 5-card radio picker.
    await dialog.getByRole('radio', { name: /M3U file/i }).click();
    await page.setInputFiles('input[type="file"]', fixturePath);
    const addButton = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(addButton).toBeEnabled();
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        addButton.click(),
    ]);
    await expect(page.getByText('test', { exact: true })).toBeVisible();
    await expect(page.getByText('4 channels')).toBeVisible();
    await expect(page.getByText('1. Channel 1')).toBeVisible();
    await expect(page.getByText('4. HappyKids TV')).toBeVisible();

    const importedPlaylistUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(importedPlaylistUrl);
    await expect(page.getByText('test', { exact: true })).toBeVisible();
    await expect(page.getByText('4 channels')).toBeVisible();
    await expect(page.getByText('1. Channel 1')).toBeVisible();
    await expect(page.getByText('4. HappyKids TV')).toBeVisible();
});

test('@web @auto-detect pasted provider message prefills the Xtream form', async ({
    page,
}) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Auto-detect/i }).click();

    // Shape of a real reseller handout, with fictional credentials.
    await dialog
        .locator('[data-test-id="auto-detect-textarea"]')
        .fill(
            '◉𝙿𝙾𝚁𝚃𝙰𝙻➤ http://tv.example.com:8080\n' +
                '├◉𝚄𝚂𝙴𝚁➤ e2euser\n' +
                '├◉𝙿𝙰𝚂𝚂➤ e2epass'
        );

    const candidate = dialog.locator('[data-test-id="auto-detect-candidate"]').first();
    await expect(candidate).toBeVisible();
    await expect(candidate.getByText('e2euser')).toBeVisible();
    // The card must never print the password in clear.
    await expect(candidate.getByText('e2epass')).toHaveCount(0);

    await candidate.locator('[data-test-id="auto-detect-use"]').click();

    // The dialog switches to the real Xtream form (@switch + viewChild
    // timing) and the prefill lands in its controls.
    await expect(
        dialog.getByRole('radio', { name: /Xtream credentials/i })
    ).toBeChecked();
    await expect(dialog.getByLabel('Server URL')).toHaveValue(
        'http://tv.example.com:8080'
    );
    await expect(dialog.getByLabel('Username')).toHaveValue('e2euser');
    await expect(dialog.getByLabel('Password')).toHaveValue('e2epass');
    await expect(dialog.getByLabel('Playlist title')).toHaveValue(
        'tv.example.com'
    );

    // Detection only proposes: the regular Add action stays in charge.
    await expect(
        dialog.getByRole('button', { name: 'Add', exact: true })
    ).toBeEnabled();
});

test('@web @auto-detect keeps the pasted message when switching methods', async ({
    page,
}) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByRole('radio', { name: /Auto-detect/i }).click();

    const message = 'Portal: http://stb.example.com/c/\nMAC: 00:1A:79:12:34:56';
    await dialog.locator('[data-test-id="auto-detect-textarea"]').fill(message);

    const candidate = dialog.locator('[data-test-id="auto-detect-candidate"]').first();
    await expect(candidate.getByText('00:1A:79:12:34:56')).toBeVisible();
    await candidate.locator('[data-test-id="auto-detect-use"]').click();

    await expect(
        dialog.getByRole('radio', { name: /Stalker portal/i })
    ).toBeChecked();
    // Exact: the derive-device-IDs checkbox is labelled "Generate device IDs
    // from the MAC address", which a substring match would also resolve to.
    await expect(
        dialog.getByLabel('Mac Address', { exact: true })
    ).toHaveValue('00:1A:79:12:34:56');

    // Returning to auto-detect must not cost the user their paste.
    await dialog.getByRole('radio', { name: /Auto-detect/i }).click();
    await expect(dialog.locator('[data-test-id="auto-detect-textarea"]')).toHaveValue(
        message
    );
});

test('@web @m3u reads an existing v1 IndexedDB playlist after application upgrade', async ({
    page,
}) => {
    const playlistId = 'legacy-indexeddb-playlist';
    // Seed before Angular boots so the application must open the old database.
    await page.route('**/__indexeddb-seed__', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
    );
    await page.route('https://legacy.example.invalid/**', (route) =>
        route.abort()
    );
    await page.goto('/__indexeddb-seed__');
    await page.evaluate(
        (id) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator', 1);
                request.onerror = () => reject(request.error);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore(
                        'playlists',
                        {
                            keyPath: '_id',
                            autoIncrement: false,
                        }
                    );
                    // Freeze the historical schema independently of app config.
                    for (const name of [
                        '_id',
                        'filename',
                        'title',
                        'count',
                        'playlist',
                        'importDate',
                        'lastUsage',
                        'favorites',
                        'recentlyViewed',
                        'autoRefresh',
                        'url',
                        'filePath',
                    ]) {
                        store.createIndex(name, name, { unique: false });
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction(
                        'playlists',
                        'readwrite'
                    );
                    transaction.onabort = () => {
                        db.close();
                        reject(transaction.error);
                    };
                    transaction.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    transaction.objectStore('playlists').add({
                        _id: id,
                        title: 'Legacy playlist',
                        filename: 'legacy.m3u',
                        importDate: '2025-01-01T00:00:00.000Z',
                        lastUsage: '2025-01-01T00:00:00.000Z',
                        count: 1,
                        autoRefresh: false,
                        favorites: [],
                        recentlyViewed: [],
                        playlist: {
                            header: { attrs: {}, raw: '#EXTM3U' },
                            items: [
                                {
                                    id: 'legacy-channel',
                                    name: 'Legacy channel',
                                    url: 'https://legacy.example.invalid/live.m3u8',
                                    group: { title: 'News' },
                                    tvg: {
                                        id: '',
                                        name: '',
                                        url: '',
                                        logo: '',
                                        rec: '',
                                    },
                                    http: {
                                        referrer: '',
                                        'user-agent': '',
                                        origin: '',
                                    },
                                    radio: 'false',
                                },
                            ],
                        },
                    });
                };
            }),
        playlistId
    );

    const playlistPath = `/workspace/playlists/${playlistId}/all`;
    await page.goto(playlistPath, { waitUntil: 'domcontentloaded' });
    await expect(
        page.getByText('Legacy playlist', { exact: true })
    ).toBeVisible();
    await expect(
        page.getByText('1. Legacy channel', { exact: true })
    ).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${playlistPath}$`));
    await expect(
        page.getByText('Legacy playlist', { exact: true })
    ).toBeVisible();
    await expect(
        page.getByText('1. Legacy channel', { exact: true })
    ).toBeVisible();

    const persisted = await page.evaluate(
        (id) =>
            new Promise((resolve, reject) => {
                const request = indexedDB.open('iptvnator');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction('playlists', 'readonly');
                    const store = transaction.objectStore('playlists');
                    const record = store.get(id);
                    transaction.onabort = () => {
                        db.close();
                        reject(transaction.error);
                    };
                    transaction.oncomplete = () => {
                        resolve({
                            version: db.version,
                            keyPath: store.keyPath,
                            autoIncrement: store.autoIncrement,
                            id: record.result?._id,
                            channel: record.result?.playlist.items[0].name,
                        });
                        db.close();
                    };
                };
            }),
        playlistId
    );
    expect(persisted).toEqual({
        version: 1,
        keyPath: '_id',
        autoIncrement: false,
        id: playlistId,
        channel: 'Legacy channel',
    });
});

test('@web keyboard shortcuts help opens from question mark', async ({
    page,
}) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Open keyboard shortcuts' }).focus();
    await page.keyboard.press('?');

    const dialog = page.getByRole('dialog');
    await expect(
        dialog.getByRole('heading', { name: 'Keyboard shortcuts' })
    ).toBeVisible();
    await expect(dialog.getByText('Open command palette')).toBeVisible();
    await expect(dialog.getByText('Toggle sidebar')).toBeVisible();
    await expect(dialog.getByText('Mute audio')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});
