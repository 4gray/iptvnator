import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.use({ screenshot: 'only-on-failure', testIdAttribute: 'data-test-id' });

const originalEpg =
    'https://guide.example.test/a/long-provider-path/guide.xml.gz';
const newEpg = 'https://guide.example.test/manual.xml';
const titles = ['Editor M3U', 'Editor Xtream', 'Editor Stalker'];

async function seedEditors(page: Page) {
    await page.route('http://localhost:3000/**', (route) =>
        route.fulfill({ status: 503, body: '{}' })
    );
    await page.goto('/workspace/sources');
    await expect(page.locator('app-workspace-sources')).toBeVisible();
    await page.evaluate(
        async ({ originalEpg, titles }) => {
            const common = {
                playlist: { items: [] },
                importDate: '2026-10-31T12:00:00.000Z',
                lastUsage: '',
                favorites: [],
                recentlyViewed: [],
            };
            const fixtures = [
                {
                    _id: 'editor-m3u',
                    title: titles[0],
                    count: 42,
                    url: 'https://playlist.example.test/channels.m3u',
                    epgUrls: [originalEpg],
                    detectedEpgUrls: [originalEpg],
                },
                {
                    _id: 'editor-xtream',
                    title: titles[1],
                    serverUrl: 'https://xtream.example.test',
                    username: 'fixture-user',
                    password: 'fixture-password',
                },
                {
                    _id: 'editor-stalker',
                    title: titles[2],
                    portalUrl: 'https://stalker.example.test/portal.php',
                    macAddress: '00:1A:79:AA:BB:CC',
                    stalkerSerialNumber: 'FIXTURE',
                    isFullStalkerPortal: true,
                },
            ];
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction(
                        'playlists',
                        'readwrite'
                    );
                    for (const fixture of fixtures) {
                        transaction
                            .objectStore('playlists')
                            .put({ ...common, ...fixture });
                    }
                    transaction.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    transaction.onerror = () => {
                        db.close();
                        reject(transaction.error);
                    };
                };
            });
        },
        { originalEpg, titles }
    );
    await page.reload();
    await expect(page.locator('app-source-row')).toHaveCount(3);
}

async function openEditor(page: Page, title: string): Promise<Locator> {
    // Open at desktop width, then resize the mounted form. The separate
    // source-row mobile menu has its own coverage in sources-pwa.e2e.ts.
    await page.setViewportSize({ width: 1440, height: 900 });
    const row = page.locator('app-source-row').filter({ hasText: title });
    await row.hover();
    await row.locator('.source-row__edit').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

async function storedPlaylists(page: Page) {
    return page.evaluate(
        () =>
            new Promise<
                { title: string; epgUrls?: string[]; serverUrl?: string }[]
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

test.beforeEach(async ({ page }) => seedEditors(page));

test('main Save and Enter persist pending EPG with metadata after reload', async ({
    page,
}) => {
    let dialog = await openEditor(page, titles[0]);
    await dialog.locator('[formControlName="title"]').fill('Renamed M3U');
    const draft = dialog.locator('.playlist-epg-source-form input');
    await draft.fill(newEpg);
    await draft.press('Enter');
    await expect(dialog).toBeHidden();
    await expect
        .poll(
            async () =>
                (await storedPlaylists(page)).find(
                    (p) => p.title === 'Renamed M3U'
                )?.epgUrls
        )
        .toContain(newEpg);
    await page.reload();
    dialog = await openEditor(page, 'Renamed M3U');
    await expect(dialog.locator('input[readonly]')).toHaveCount(2);
    await expect(dialog.locator('input[readonly]').last()).toHaveValue(newEpg);
    await expect(dialog.locator('.playlist-epg-source-form input')).toHaveValue(
        ''
    );
});

test('independent EPG save clears its rendered draft without saving the title', async ({
    page,
}) => {
    let dialog = await openEditor(page, titles[0]);
    await dialog.locator('[formControlName="title"]').fill('Unsaved title');
    await dialog.locator('.playlist-epg-source-form input').fill(newEpg);
    await dialog
        .getByRole('button', { name: 'Save EPG sources', exact: true })
        .click();
    await expect(dialog.locator('.playlist-epg-source-form input')).toHaveValue(
        ''
    );
    await expect
        .poll(
            async () =>
                (await storedPlaylists(page)).find((p) => p.title === titles[0])
                    ?.epgUrls
        )
        .toContain(newEpg);
    await page.keyboard.press('Escape');
    await page.reload();
    dialog = await openEditor(page, titles[0]);
    await expect(dialog.locator('input[readonly]').last()).toHaveValue(newEpg);
    await expect(dialog.locator('[formControlName="title"]')).toHaveValue(
        titles[0]
    );
});

for (const theme of ['light', 'dark']) {
    for (const [index, title] of titles.entries()) {
        test(`${title} (${theme}) keeps actions reachable in narrow and short windows`, async ({
            page,
        }, testInfo) => {
            const dialog = await openEditor(page, title);
            await page.evaluate((theme) => {
                document.body.classList.toggle('dark-theme', theme === 'dark');
                document.body.classList.toggle(
                    'light-theme',
                    theme === 'light'
                );
            }, theme);

            for (const viewport of [
                { width: 390, height: 844 },
                { width: 1200, height: 500 },
                { width: 390, height: 500 },
                { width: 320, height: 480 },
            ]) {
                await page.setViewportSize(viewport);
                await expect
                    .poll(() =>
                        dialog.evaluate((container) => {
                            const surface = container.querySelector(
                                '.mat-mdc-dialog-surface'
                            )!;
                            const box = surface.getBoundingClientRect();
                            return {
                                inside:
                                    box.top >= 0 &&
                                    box.bottom <= innerHeight + 1,
                                overflows: Array.from(
                                    container.querySelectorAll(
                                        'mat-dialog-content, .mat-mdc-dialog-surface, .playlist-epg-source-row'
                                    )
                                )
                                    .filter(
                                        (e) => e.scrollWidth > e.clientWidth + 1
                                    )
                                    .map((e) => ({
                                        tag: e.tagName,
                                        cls: e.className,
                                        scroll: e.scrollWidth,
                                        client: e.clientWidth,
                                    })),
                            };
                        })
                    )
                    .toEqual({ inside: true, overflows: [] });
                const save = dialog.locator('button[type="submit"]');
                await save.scrollIntoViewIfNeeded();
                await expect
                    .poll(() =>
                        save.evaluate((button) => {
                            const box = button.getBoundingClientRect();
                            const frame = button
                                .closest('.mat-mdc-dialog-surface')!
                                .getBoundingClientRect();
                            // Fractional CSS pixels at the surface border can yield
                            // 0.99375 in IntersectionObserver for a fully reachable button.
                            return (
                                box.top >= Math.max(0, frame.top) - 1 &&
                                box.bottom <=
                                    Math.min(innerHeight, frame.bottom) + 1
                            );
                        })
                    )
                    .toBe(true);
                if (index === 0 && viewport.width < 640) {
                    const actions = dialog
                        .locator('.playlist-epg-source-row')
                        .first()
                        .locator('button');
                    const tops = await actions.evaluateAll((buttons) =>
                        buttons.map((b) => b.getBoundingClientRect().top)
                    );
                    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(
                        1
                    );
                }
                await page.screenshot({
                    path: testInfo.outputPath(
                        `${theme}-${index}-${viewport.width}x${viewport.height}.png`
                    ),
                });
            }
            // Exercise the decision, not only its geometry, at the hardest size.
            await dialog
                .locator('[formControlName="title"]')
                .fill(`${title} ${theme}`);
            await saveAndClose(dialog);
            await page.reload();
            await expect(
                page
                    .locator('app-source-row')
                    .filter({ hasText: `${title} ${theme}` })
            ).toBeVisible();
            const renamed = await openEditor(page, `${title} ${theme}`);
            await expect(
                renamed.locator('[formControlName="title"]')
            ).toHaveValue(`${title} ${theme}`);
        });
    }
}

async function saveAndClose(dialog: Locator) {
    const save = dialog.locator('button[type="submit"]');
    await expect(save).toBeEnabled();
    const title = await dialog
        .locator('[formControlName="title"]')
        .inputValue();
    await save.click();
    await expect(dialog).toBeHidden();
    await expect
        .poll(async () =>
            (await storedPlaylists(dialog.page())).map((p) => p.title)
        )
        .toContain(title);
}

test('French EPG labels and multiple new rows fit the phone form', async ({
    page,
}, testInfo) => {
    await page.goto('/workspace/settings/general');
    await page.locator('[data-test-id="select-language"]').click();
    await page.locator('mat-option[data-test-id="fr"]').click();
    const saveSettings = page.locator('[data-test-id="save-settings"]');
    await saveSettings.click();
    await expect(saveSettings).toBeHidden();
    await page.goto('/workspace/sources');
    const dialog = await openEditor(page, titles[0]);
    await dialog.locator('.playlist-epg-source-actions button').first().click();
    await dialog.locator('.playlist-epg-source-actions button').first().click();
    await expect(dialog.locator('.playlist-epg-source-form input')).toHaveCount(
        3
    );
    await page.setViewportSize({ width: 390, height: 500 });
    await expect
        .poll(() =>
            dialog
                .locator('mat-dialog-content')
                .evaluate((e) => e.scrollWidth <= e.clientWidth + 1)
        )
        .toBe(true);
    await dialog
        .locator('.playlist-epg-source-form input')
        .last()
        .fill('not-an-epg');
    await dialog.locator('.playlist-epg-source-actions button').last().click();
    await expect(dialog.locator('mat-error')).toBeVisible();
    await dialog.locator('.playlist-epg-source-form input').last().fill(newEpg);
    await expect(dialog.locator('mat-error')).toHaveCount(0);
    await dialog.locator('.playlist-epg-source-form input').last().press('Tab');
    await saveAndClose(dialog);
    await page.screenshot({ path: testInfo.outputPath('french-saved.png') });
});

/** Resolve CSS alpha/color-mix against the actual flat field ancestors. */
async function labelContrast(label: Locator) {
    return label.evaluate((element) => {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('Canvas is required for contrast');
        context.fillStyle = 'white';
        context.fillRect(0, 0, 1, 1);
        const layers: Element[] = [];
        for (
            let node: Element | null = element;
            node;
            node = node.parentElement
        )
            layers.unshift(node);
        for (const layer of layers) {
            context.fillStyle = getComputedStyle(layer).backgroundColor;
            context.fillRect(0, 0, 1, 1);
        }
        const luminance = () => {
            const rgb = [...context.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .map((value) => {
                    const s = value / 255;
                    return s <= 0.04045
                        ? s / 12.92
                        : ((s + 0.055) / 1.055) ** 2.4;
                });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const background = luminance();
        context.fillStyle = getComputedStyle(element).color;
        context.fillRect(0, 0, 1, 1);
        const foreground = luminance();
        return (
            (Math.max(background, foreground) + 0.05) /
            (Math.min(background, foreground) + 0.05)
        );
    });
}

for (const theme of ['light', 'dark']) {
    for (const title of titles) {
        test(`${title} (${theme}) enabled label contrast`, async ({
            page,
        }, testInfo) => {
            const dialog = await openEditor(page, title);
            await page.evaluate(
                (dark) => document.body.classList.toggle('dark-theme', dark),
                theme === 'dark'
            );
            const input = dialog.locator('[formControlName="title"]');
            const label = dialog.locator(
                'mat-form-field:has(input[formControlName="title"]) mat-label'
            );
            const agent = dialog.locator('[formControlName="userAgent"]');
            if (title === titles[0]) {
                const resting = dialog.locator(
                    'mat-form-field:has(input[formControlName="userAgent"]) mat-label'
                );
                await expect
                    .poll(() => labelContrast(resting))
                    .toBeGreaterThanOrEqual(4.5);
                await agent.hover();
                await expect
                    .poll(() => labelContrast(resting))
                    .toBeGreaterThanOrEqual(4.5);
            }
            await input.focus();
            await expect
                .poll(() => labelContrast(label))
                .toBeGreaterThanOrEqual(4.5);
            await page.screenshot({
                path: testInfo.outputPath(`label-${theme}.png`),
            });
        });
    }
}

test('Xtream edit blocks malformed connection fields and saves supported inputs without a network test', async ({
    page,
}) => {
    let dialog = await openEditor(page, titles[1]);
    const server = dialog.locator('[formControlName="serverUrl"]');
    const username = dialog.locator('[formControlName="username"]');
    const password = dialog.locator('[formControlName="password"]');
    const save = dialog.locator('button[type="submit"]');
    const testConnection = dialog.locator(
        'button[aria-describedby="xtream-edit-http-test-notice"]'
    );
    await server.fill('not-a-url');
    await username.fill('  ');
    await password.fill('\t ');
    await dialog.locator('[formControlName="title"]').focus();
    await expect(dialog.locator('mat-error')).toHaveCount(3);
    await expect(save).toBeDisabled();
    await expect(testConnection).toBeDisabled();
    await password.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    dialog = await openEditor(page, titles[1]);
    await expect(dialog.locator('[formControlName="serverUrl"]')).toHaveValue(
        'https://xtream.example.test'
    );
    await dialog
        .locator('[formControlName="serverUrl"]')
        .fill(
            ' https://xtream.example.test/provider/player_api.php?username=ignored&password=ignored '
        );
    await dialog.locator('[formControlName="username"]').fill(' fixture-user ');
    await dialog
        .locator('[formControlName="password"]')
        .fill(' fixture-password ');
    await saveAndClose(dialog);
    await expect
        .poll(
            async () =>
                (await storedPlaylists(page)).find((p) => p.title === titles[1])
                    ?.serverUrl
        )
        .toBe('https://xtream.example.test/provider');
    await page.reload();
    dialog = await openEditor(page, titles[1]);
    await expect(dialog.locator('[formControlName="serverUrl"]')).toHaveValue(
        'https://xtream.example.test/provider'
    );
    await expect(dialog.locator('[formControlName="username"]')).toHaveValue(
        'fixture-user'
    );
    await expect(dialog.locator('[formControlName="password"]')).toHaveValue(
        'fixture-password'
    );
});

const availableEpg = 'https://guide.example.test/other-region.xml.gz';

async function seedEpgProvenance(page: Page) {
    await page.evaluate(
        async ({ originalEpg, newEpg, availableEpg }) => {
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator');
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction('playlists', 'readwrite');
                    const store = tx.objectStore('playlists');
                    const read = store.get('editor-m3u');
                    read.onsuccess = () =>
                        store.put({
                            ...read.result,
                            epgUrls: [originalEpg, newEpg],
                            detectedEpgUrls: [originalEpg, availableEpg],
                            manualEpgUrls: [newEpg],
                            disabledEpgUrls: [availableEpg],
                        });
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(tx.error);
                    };
                };
                request.onerror = () => reject(request.error);
            });
        },
        { originalEpg, newEpg, availableEpg }
    );
    await page.reload();
    await expect(page.locator('app-source-row')).toHaveCount(3);
}

function enabledEpgRow(dialog: Locator, url: string) {
    return dialog.locator(
        `[data-epg-source-state="enabled"][data-epg-source-url="${url}"]`
    );
}

test('EPG provenance and global settings scope remain clear after reload', async ({
    page,
}, testInfo) => {
    await seedEpgProvenance(page);
    let dialog = await openEditor(page, titles[0]);
    await expect(dialog.getByTestId('playlist-epg-detected-count')).toHaveText(
        'From playlist: 1 of 2 enabled.'
    );
    const detected = enabledEpgRow(dialog, originalEpg);
    await expect(detected.locator('mat-hint')).toContainText('From playlist');
    await expect(
        enabledEpgRow(dialog, newEpg).locator('mat-hint')
    ).toContainText('Added manually');
    const global = detected.getByRole('button', {
        name: 'Add to global EPG settings',
        exact: true,
    });
    await global.click();
    await expect(global).toBeDisabled();
    await expect(detected.getByRole('status')).toHaveText(
        'In global EPG settings'
    );
    await expect(
        detected.getByRole('button', {
            name: 'Remove from this playlist',
            exact: true,
        })
    ).toBeFocused();
    await expect(
        dialog.getByRole('button', { name: 'Add another source', exact: true })
    ).toBeEnabled();
    await expect(dialog.getByTestId('playlist-epg-detected-count')).toHaveText(
        'From playlist: 1 of 2 enabled.'
    );
    await page.screenshot({
        path: testInfo.outputPath('epg-provenance-global.png'),
    });
    await page.keyboard.press('Escape');
    await page.reload();
    dialog = await openEditor(page, titles[0]);
    await expect(
        enabledEpgRow(dialog, originalEpg).getByRole('status')
    ).toHaveText('In global EPG settings');
    await expect(
        dialog.locator('[data-epg-source-state="enabled"]')
    ).toHaveCount(2);
});

test('EPG detected candidates can be enabled and removed with accurate counts and stable focus', async ({
    page,
}) => {
    await seedEpgProvenance(page);
    let dialog = await openEditor(page, titles[0]);
    await dialog
        .getByTestId('playlist-epg-available')
        .locator('summary')
        .click();
    await page.setViewportSize({ width: 390, height: 500 });
    const available = dialog.locator('[data-epg-source-state="available"]');
    await expect(available.locator('input')).toHaveValue(availableEpg);
    await available
        .getByRole('button', { name: 'Enable for this playlist', exact: true })
        .click();
    await expect(dialog.getByTestId('playlist-epg-detected-count')).toHaveText(
        'From playlist: 2 of 2 enabled.'
    );
    await expect(dialog.getByTestId('playlist-epg-available')).toHaveCount(0);
    await expect(
        enabledEpgRow(dialog, availableEpg).getByRole('button', {
            name: 'Add to global EPG settings',
            exact: true,
        })
    ).toBeFocused();
    await expect(
        enabledEpgRow(dialog, availableEpg).locator('mat-hint')
    ).toContainText('From playlist');
    await enabledEpgRow(dialog, originalEpg)
        .getByRole('button', { name: 'Remove from this playlist', exact: true })
        .click();
    await expect(dialog.getByTestId('playlist-epg-detected-count')).toHaveText(
        'From playlist: 1 of 2 enabled.'
    );
    await expect(
        enabledEpgRow(dialog, newEpg).getByRole('button', {
            name: 'Add to global EPG settings',
            exact: true,
        })
    ).toBeFocused();
    await expect
        .poll(
            async () =>
                (await storedPlaylists(page)).find((p) => p.title === titles[0])
                    ?.epgUrls
        )
        .toEqual([newEpg, availableEpg]);
    await page.keyboard.press('Escape');
    await page.reload();
    dialog = await openEditor(page, titles[0]);
    await expect(dialog.getByTestId('playlist-epg-detected-count')).toHaveText(
        'From playlist: 1 of 2 enabled.'
    );
    await expect(
        dialog.locator('[data-epg-source-state="enabled"]')
    ).toHaveCount(2);
});

for (const theme of ['light', 'dark']) {
    test(`EPG provenance and long German actions reflow (${theme})`, async ({
        page,
    }, testInfo) => {
        await seedEpgProvenance(page);
        await page.goto('/workspace/settings/general');
        await page.locator('[data-test-id="select-language"]').click();
        await page.locator('mat-option[data-test-id="de"]').click();
        const settingsSave = page.locator('[data-test-id="save-settings"]');
        await settingsSave.click();
        await expect(settingsSave).toBeHidden();
        await page.goto('/workspace/sources');
        const dialog = await openEditor(page, titles[0]);
        await page.evaluate(
            (dark) => document.body.classList.toggle('dark-theme', dark),
            theme === 'dark'
        );
        await dialog
            .getByTestId('playlist-epg-available')
            .locator('summary')
            .click();
        for (const viewport of [
            { width: 320, height: 480 },
            { width: 390, height: 844 },
            { width: 1200, height: 500 },
        ]) {
            await page.setViewportSize(viewport);
            await expect
                .poll(() =>
                    dialog.evaluate((container) =>
                        Array.from(
                            container.querySelectorAll(
                                '.mat-mdc-dialog-surface,mat-dialog-content,.playlist-epg-source-row'
                            )
                        ).every((e) => e.scrollWidth <= e.clientWidth + 1)
                    )
                )
                .toBe(true);
            const enable = dialog.getByRole('button', {
                name: 'Für diese Wiedergabeliste aktivieren',
                exact: true,
            });
            await enable.scrollIntoViewIfNeeded();
            await expect(enable).toBeInViewport();
            await page.screenshot({
                path: testInfo.outputPath(
                    `epg-german-${theme}-${viewport.width}x${viewport.height}.png`
                ),
            });
        }
    });
}
