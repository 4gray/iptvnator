import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const archive = {
    kind: 'iptvnator-playlist-backup',
    version: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    includeSecrets: true,
    settings: { epgUrls: ['https://example.test/guide.xml'] },
    playlists: [
        {
            portalType: 'm3u',
            exportedId: 'audit-m3u',
            title: 'Audit M3U 🎬',
            autoRefresh: false,
            source: {
                kind: 'text',
                rawM3u: '#EXTM3U\n#EXTINF:-1 group-title=" News ",Test Channel\nhttps://example.test/live',
            },
            userState: {
                favorites: ['https://example.test/live'],
                recentlyViewed: [
                    {
                        source: 'm3u',
                        id: 'https://example.test/live',
                        url: 'https://example.test/live',
                        title: 'Test Channel',
                        category_id: 'live',
                        added_at: '2026-01-01T12:00:00Z',
                    },
                ],
                hiddenGroupTitles: [' News '],
            },
        },
        {
            portalType: 'stalker',
            exportedId: 'audit-stalker',
            title: 'Audit Stalker',
            autoRefresh: false,
            connection: {
                portalUrl: 'https://example.test/portal',
                macAddress: '00:1A:79:00:00:01',
                username: 'fixture-user',
                password: 'fixture-password',
            },
            userState: {
                favorites: [{ id: '42', name: 'Saved Stalker title' }],
                recentlyViewed: [{ id: '43', name: 'Recent Stalker title' }],
            },
        },
        {
            portalType: 'xtream',
            exportedId: 'audit-xtream',
            title: 'Audit Xtream',
            autoRefresh: false,
            connection: {
                serverUrl: 'https://example.test',
                username: 'fixture-user',
                password: 'fixture-password',
            },
            userState: {
                hiddenCategories: [],
                favorites: [{ contentType: 'movie', xtreamId: 42 }],
                recentlyViewed: [
                    {
                        contentType: 'movie',
                        xtreamId: 42,
                        viewedAt: '2026-01-01T12:00:00Z',
                    },
                ],
                playbackPositions: [
                    {
                        contentXtreamId: 42,
                        contentType: 'vod',
                        positionSeconds: 90,
                        durationSeconds: 3600,
                    },
                ],
            },
        },
    ],
};

async function importJson(
    page: Page,
    value: unknown,
    waitForCompletion = true
) {
    const chooser = page.waitForEvent('filechooser');
    await page
        .locator('#backup')
        .getByRole('button', { name: 'Import', exact: true })
        .click();
    await (
        await chooser
    ).setFiles({
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
            typeof value === 'string' ? value : JSON.stringify(value)
        ),
    });
    if (waitForCompletion) {
        // The browser file read can complete after setFiles resolves. Let Angular
        // paint its busy state before waiting for the operation to release it.
        await page.evaluate(
            () =>
                new Promise<void>((done) => requestAnimationFrame(() => done()))
        );
        await expect(
            page.locator('#backup .inline-actions__button').first()
        ).toBeEnabled();
    }
}
async function exportJson(page: Page) {
    const download = page.waitForEvent('download');
    await page
        .locator('#backup')
        .getByRole('button', { name: 'Export', exact: true })
        .click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing downloaded backup');
    const result = JSON.parse(await readFile(path, 'utf8'));
    delete result.exportedAt;
    return result;
}
const result = (page: Page) => page.locator('#backup .backup-result');

test.beforeEach(async ({ page }) => {
    await page.goto('/workspace/settings/backup');
    await expect(page.locator('#backup')).toBeVisible({ timeout: 15_000 });
});

test('@critical @persistence @settings @pwa backup round-trip preserves supported data through repeat import and reload', async ({
    page,
}) => {
    await importJson(page, archive);
    await expect(result(page)).toContainText('3 imported');
    const first = await exportJson(page);
    expect(first.settings).toEqual(archive.settings);
    for (const input of archive.playlists) {
        const exported = first.playlists.find(
            (entry: { portalType: string }) =>
                entry.portalType === input.portalType
        );
        expect(exported.title).toEqual(input.title);
        expect(exported.userState.favorites).toEqual(input.userState.favorites);
        expect(exported.userState.recentlyViewed).toEqual(
            input.userState.recentlyViewed
        );
        if ('connection' in input)
            expect(exported.connection).toEqual(input.connection);
        if (input.portalType === 'm3u') {
            expect(exported.autoImportEpg).toBe(true);
            expect(exported.source.rawM3u.replace(/\r\n?/g, '\n')).toEqual(
                input.source?.rawM3u
            );
            expect(exported.userState.hiddenGroupTitles).toEqual([' News ']);
        }
        if (input.portalType === 'xtream')
            expect(exported.userState.playbackPositions).toEqual([
                expect.objectContaining({
                    ...input.userState.playbackPositions?.[0],
                    playlistId: 'audit-xtream',
                }),
            ]);
    }
    const optedOut = structuredClone(first);
    optedOut.playlists.find(
        (entry: { portalType: string }) => entry.portalType === 'm3u'
    ).autoImportEpg = false;
    await importJson(page, optedOut);
    await expect(result(page)).toContainText('3 merged');
    expect(
        (await exportJson(page)).playlists.find(
            (entry: { portalType: string }) => entry.portalType === 'm3u'
        ).autoImportEpg
    ).toBe(false);
    await importJson(page, first);
    await expect(result(page)).toContainText('3 merged');
    expect(
        (await exportJson(page)).playlists.find(
            (entry: { portalType: string }) => entry.portalType === 'm3u'
        ).autoImportEpg
    ).toBe(true);
    const empty = structuredClone(first);
    for (const entry of empty.playlists) {
        entry.userState.favorites = [];
        entry.userState.recentlyViewed = [];
        if (entry.portalType === 'm3u') entry.userState.hiddenGroupTitles = [];
        if (entry.portalType === 'xtream')
            entry.userState.playbackPositions = [];
    }
    await importJson(page, empty);
    await expect(result(page)).toContainText('3 merged');
    const cleared = await exportJson(page);
    for (const entry of cleared.playlists) {
        expect(entry.userState.favorites).toEqual([]);
        expect(entry.userState.recentlyViewed).toEqual([]);
        if (entry.portalType === 'm3u')
            expect(entry.userState.hiddenGroupTitles).toEqual([]);
        if (entry.portalType === 'xtream')
            expect(entry.userState.playbackPositions).toEqual([]);
    }
    await importJson(page, first);
    await expect(result(page)).toContainText('3 merged');
    await page.reload();
    await expect(page.locator('#backup')).toBeVisible();
    expect(await exportJson(page)).toEqual(first);
});

test('@critical @persistence @settings @pwa damaged and unsupported files preserve the current library', async ({
    page,
}) => {
    await importJson(page, archive);
    await expect(result(page)).toContainText('3 imported');
    const before = await exportJson(page);
    const malformed = structuredClone(archive);
    malformed.playlists[0].title = 'Must not replace current title';
    delete (
        malformed.playlists[1].userState as Partial<
            (typeof malformed.playlists)[1]['userState']
        >
    ).recentlyViewed;
    for (const invalid of [
        '{broken',
        [],
        { ...archive, version: 999 },
        malformed,
    ]) {
        await importJson(page, invalid);
        await expect(result(page)).toContainText('Could not restore');
        expect(await exportJson(page)).toEqual(before);
    }
});

test('@settings @pwa cancelled chooser and a slow file read release busy and prevent conflicting actions', async ({
    page,
}) => {
    await importJson(page, archive);
    await expect(result(page)).toContainText('3 imported');
    await expect(page.locator('#backup .danger-zone__button')).toBeEnabled();
    const chooser = page.waitForEvent('filechooser');
    const importButton = page
        .locator('#backup')
        .getByRole('button', { name: 'Import', exact: true });
    await importButton.click();
    await (await chooser).setFiles([]);
    await expect(importButton).toBeEnabled();
    await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function () {
            return new Promise<string>((resolve) => {
                (
                    window as unknown as { finishBackupRead: () => void }
                ).finishBackupRead = () => {
                    void original.call(this).then(resolve);
                };
            });
        };
    });
    await importJson(page, archive, false);
    const importing = page
        .locator('#backup')
        .getByRole('button', { name: 'Importing…', exact: true });
    await expect(importing).toHaveAttribute('aria-busy', 'true');
    await expect(importing).toBeDisabled();
    await expect(
        page
            .locator('#backup')
            .getByRole('button', { name: 'Export', exact: true })
    ).toBeDisabled();
    await expect(page.locator('#backup .danger-zone__button')).toBeDisabled();
    await page.evaluate(() =>
        (
            window as unknown as { finishBackupRead: () => void }
        ).finishBackupRead()
    );
    await expect(result(page)).toContainText('3 merged');
    await expect(importButton).toBeEnabled();
    await expect(importButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
        page
            .locator('#backup')
            .getByRole('button', { name: 'Export', exact: true })
    ).toBeFocused();
});

for (const theme of ['light', 'dark']) {
    for (const variant of [
        { width: 360, locale: 'de' },
        { width: 768, locale: 'ar' },
        { width: 1440, locale: 'ru' },
    ]) {
        test(`@settings @pwa backup result fits ${theme} ${variant.locale} at ${variant.width}px`, async ({
            page,
        }, testInfo) => {
            // Set real preferences through the settings controls, then use the shipped translations.
            await page.goto('/workspace/settings/general');
            await page
                .locator(
                    `[data-test-id="select-theme"] [data-test-id="${theme.toUpperCase()}_THEME"]`
                )
                .click();
            await page.locator('[data-test-id="select-language"]').click();
            await page
                .locator(`mat-option[data-test-id="${variant.locale}"]`)
                .click();
            await page.locator('[data-test-id="save-settings"]').click();
            await expect(
                page.locator('[data-test-id="save-settings"]')
            ).toBeHidden();
            await page
                .locator('[data-test-id="settings-section-backup"]')
                .click();
            await expect(page.locator('html')).toHaveAttribute(
                'lang',
                variant.locale
            );
            if (theme === 'dark')
                await expect(page.locator('body')).toHaveClass(/dark-theme/);
            else
                await expect(page.locator('body')).not.toHaveClass(
                    /dark-theme/
                );
            await page.setViewportSize({ width: variant.width, height: 900 });
            const chooser = page.waitForEvent('filechooser');
            const importButton = page
                .locator('#backup .inline-actions__button')
                .first();
            await importButton.click();
            await (
                await chooser
            ).setFiles({
                name: 'damaged.json',
                mimeType: 'application/json',
                buffer: Buffer.from('{broken'),
            });
            await expect(result(page)).not.toBeEmpty();
            await expect(result(page).locator('p')).toBeVisible();
            await expect(importButton).toBeEnabled();
            const geometry = await page
                .locator('#backup')
                .evaluate((section) => {
                    const pane =
                        section.closest('.settings-main') ??
                        section.parentElement!;
                    return {
                        width: pane.clientWidth,
                        scrollWidth: pane.scrollWidth,
                        buttons: [...section.querySelectorAll('button')].map(
                            (button) => {
                                const rect = button.getBoundingClientRect();
                                return {
                                    x: rect.x,
                                    right: rect.right,
                                    width: button.clientWidth,
                                    scrollWidth: button.scrollWidth,
                                };
                            }
                        ),
                    };
                });
            expect(geometry.scrollWidth).toBeLessThanOrEqual(
                geometry.width + 1
            );
            for (const button of geometry.buttons) {
                expect(button.x).toBeGreaterThanOrEqual(0);
                expect(button.right).toBeLessThanOrEqual(variant.width);
                expect(button.scrollWidth).toBeLessThanOrEqual(
                    button.width + 1
                );
            }
            await importButton.focus();
            await page.keyboard.press('Tab');
            await expect(
                page.locator('#backup .inline-actions__button').nth(1)
            ).toBeFocused();
            await expect(page.locator('mat-snack-bar-container')).toHaveCount(
                0
            );
            await page.screenshot({
                path: testInfo.outputPath(
                    `backup-${theme}-${variant.locale}-${variant.width}.png`
                ),
                fullPage: true,
            });
        });
    }
}

test('@critical @persistence @settings @pwa a quota failure reports partial restore and remains retryable', async ({
    page,
}) => {
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'xtream-favorites')
                throw new DOMException(
                    'fixture quota failure',
                    'QuotaExceededError'
                );
            return original.call(this, key, value);
        };
        (
            window as unknown as { recoverBackupStorage: () => void }
        ).recoverBackupStorage = () => {
            Storage.prototype.setItem = original;
        };
    });
    await importJson(page, archive);
    await expect(result(page)).toContainText(
        '2 imported, 0 merged, 0 skipped, 1 failed'
    );
    await expect(result(page)).toContainText(
        'Changes already applied are kept'
    );
    expect(
        await page.evaluate(() =>
            localStorage.getItem('xtream-restore-audit-xtream')
        )
    ).not.toBeNull();
    const pendingExport = await exportJson(page);
    expect(pendingExport.playlists).toHaveLength(3);
    expect(
        pendingExport.playlists.find(
            (entry: { portalType: string }) => entry.portalType === 'xtream'
        ).userState.favorites
    ).toEqual(archive.playlists[2].userState.favorites);
    await page.evaluate(() =>
        (
            window as unknown as { recoverBackupStorage: () => void }
        ).recoverBackupStorage()
    );
    await importJson(page, archive);
    await expect(result(page)).toContainText('3 merged, 0 skipped, 0 failed');
    expect(
        await page.evaluate(() =>
            localStorage.getItem('xtream-restore-audit-xtream')
        )
    ).toBeNull();
});
