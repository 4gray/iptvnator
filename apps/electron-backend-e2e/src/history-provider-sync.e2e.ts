import { test, expect, type Page } from '@playwright/test';
import type { PlaylistBackupManifestV1 } from '@iptvnator/shared/interfaces';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    launchElectronApp,
    closeElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    openSourceEditor,
    saveSourceDialog,
    sourceRowByTitle,
    openGlobalRecent,
    goToDashboard,
    clearCurrentUnifiedCollection,
    addXtreamPortal,
    addStalkerPortal,
    waitForXtreamWorkspaceReady,
    waitForStalkerCatalog,
    contentCardByTitle,
} from './electron-test-fixtures';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';
const frontend = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4327'}`;
test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Requires isolated source-sync configuration'
);
test.use({ actionTimeout: 20000, navigationTimeout: 30000 });
async function enable(page: Page) {
    await openSettings(page);
    await openSettingsSection(page, 'server');
    await page.getByTestId('history-sync-enable').getByRole('checkbox').check();
    await expect(
        page.getByTestId('history-sync-settings').getByRole('status')
    ).toHaveText('History synchronized', { timeout: 30000 });
}
for (const provider of ['xtream', 'stalker'] as const)
    test(`syncs confirmed synthetic ${provider} viewing and rewatch order across PWA and Electron @history @web @electron @persistence`, async ({
        browser,
    }) => {
        const server = await startSourceSyncServer();
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const directory = mkdtempSync(
            join(tmpdir(), 'iptvnator-history-provider-')
        );
        let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            const page = await context.newPage();
            await page.route('**/assets/app-config.js', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `window.__IPTVNATOR_CONFIG__=${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
                })
            );
            await page.goto(`${frontend}/workspace/sources`);
            if (provider === 'xtream')
                await addXtreamPortal(page, {
                    name: 'Synthetic shared history',
                    username: 'marketing',
                    password: 'marketing',
                });
            else
                await addStalkerPortal(page, {
                    name: 'Synthetic shared history',
                    macAddress: '00:1a:79:00:00:07',
                });
            const { instanceId } = await (
                await fetch(`${server.apiUrl}/v1/instance`)
            ).json();
            const inventory = await (
                await fetch(`${server.apiUrl}/v1/sources`)
            ).json();
            const id = inventory.entries[0].source.id;
            const read = async () =>
                await (
                    await fetch(`${server.apiUrl}/v1/history/sources/${id}`, {
                        headers: { 'X-IPTVnator-Instance-Id': instanceId },
                    })
                ).json();
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({ apiUrl: server.apiUrl, instanceId })
            );
            desktop = await launchElectronApp(directory);
            const native = desktop.mainWindow;
            await routePlayableStreams(page);
            await routePlayableStreams(native);
            if (provider === 'xtream') {
                await openSources(native);
                await sourceRowByTitle(native, 'Synthetic shared history')
                    .getByText('Synthetic shared history', { exact: true })
                    .click();
                await waitForXtreamWorkspaceReady(native);
            }
            await enable(page);
            await enable(native);
            await openSources(page);
            await sourceRowByTitle(page, 'Synthetic shared history')
                .getByText('Synthetic shared history', { exact: true })
                .click();
            if (
                provider === 'xtream' &&
                (await page.evaluate(() => !!window.electron))
            )
                await waitForXtreamWorkspaceReady(page);
            if (provider === 'stalker') await waitForStalkerCatalog(page);
            await page
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await page.locator('.category-item').first().click();
            const card = page
                .locator('.content-card__activation,app-grid-list mat-card')
                .first();
            await expect(card).toBeVisible();
            await card.click();
            expect((await read()).state.items).toHaveLength(0);
            await startAndConfirmPlayback(
                page,
                () =>
                    page.locator('[data-testid="vod-primary-action"]').click(),
                4
            );
            await expect
                .poll(async () => (await read()).state.items.length)
                .toBe(1);
            const first = (await read()).state;
            expect(first.items[0].reference.provider).toBe(provider);
            const title = first.items[0].snapshot.title;
            if (provider === 'xtream') {
                await openSources(page);
                await page.reload();
                await page
                    .getByRole('link', { name: 'Recently viewed', exact: true })
                    .click();
                await page.waitForURL(/\/workspace\/global-recent$/);
                await contentCardByTitle(page, title).click();
                // The title was just played, so the detail page offers "Continue"
                // from the saved position; "Play" only shows without one.
                await expect(
                    page.getByRole('button', { name: /^(Play|Continue)\b/ })
                ).toBeEnabled();
                expect((await read()).state.revision).toBe(first.revision);
            }
            if (provider === 'xtream') {
                await openSources(native);
                const dialog = await openSourceEditor(
                    native,
                    'Synthetic shared history'
                );
                await dialog
                    .getByTestId('xtream-load-movie')
                    .getByRole('checkbox')
                    .uncheck();
                await saveSourceDialog(native, dialog);
            }
            await openGlobalRecent(native);
            await expect(contentCardByTitle(native, title)).toBeVisible({
                timeout: 30000,
            });
            if (provider === 'xtream')
                await expect(
                    contentCardByTitle(native, title).getByText(
                        'Movies — Disabled',
                        { exact: true }
                    )
                ).toBeVisible();
            await contentCardByTitle(native, title).click();
            await startAndConfirmPlayback(
                native,
                () =>
                    native
                        .locator('[data-testid="vod-primary-action"]')
                        .click(),
                4
            );
            await expect
                .poll(async () => (await read()).state.revision)
                .toBeGreaterThan(first.revision);
            const current = (await read()).state;
            expect(current.items).toHaveLength(1);
            expect(current.items[0].viewedAt).toBeGreaterThan(
                first.items[0].viewedAt
            );
            if (provider === 'stalker') {
                const received = await read();
                const response = await fetch(
                    `${server.apiUrl}/v1/history/operations`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-IPTVnator-Instance-Id': instanceId,
                        },
                        body: JSON.stringify({
                            scope: received.scope,
                            operation: {
                                kind: 'touch',
                                operationId: 'synthetic-collision',
                                deviceId: 'synthetic-fixture',
                                baseRevision: received.state.revision,
                                viewedAt: Date.now(),
                                reference: {
                                    provider: 'stalker',
                                    kind: 'live',
                                    id: current.items[0].reference.id,
                                },
                                snapshot: { title: 'Synthetic collision' },
                            },
                        }),
                    }
                );
                expect(response.ok).toBe(true);
            }
            await openSources(native);
            await openGlobalRecent(native);
            if (provider === 'stalker')
                await native
                    .locator('.content-toggle mat-button-toggle')
                    .filter({ hasText: 'Movies' })
                    .click();
            await clearCurrentUnifiedCollection(native);
            await expect
                .poll(async () => {
                    const { state } = await read();
                    return state.items.filter(
                        (item: { removed: boolean; revision: number }) =>
                            !item.removed && item.revision > state.cleared
                    ).length;
                })
                .toBe(provider === 'stalker' ? 1 : 0);
            if (provider === 'stalker') {
                const { state } = await read();
                expect(
                    state.items.filter(
                        (item: { removed: boolean; revision: number }) =>
                            !item.removed && item.revision > state.cleared
                    )[0].reference.kind
                ).toBe('live');
            }
            await openSources(page);
            await openGlobalRecent(page);
            await expect(contentCardByTitle(page, title)).toHaveCount(0, {
                timeout: 30000,
            });
            if (provider === 'xtream') {
                const received = await read();
                const retainedTitle = 'Synthetic retained backup item';
                const added = await fetch(
                    `${server.apiUrl}/v1/history/operations`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-IPTVnator-Instance-Id': instanceId,
                        },
                        body: JSON.stringify({
                            scope: received.scope,
                            operation: {
                                kind: 'touch',
                                operationId: 'synthetic-backup-history',
                                deviceId: 'synthetic-backup-device',
                                baseRevision: received.state.revision,
                                viewedAt: Date.now(),
                                reference: {
                                    provider: 'xtream',
                                    kind: 'movie',
                                    id: '987654321',
                                },
                                snapshot: { title: retainedTitle },
                            },
                        }),
                    }
                );
                expect(added.ok).toBe(true);
                await openSources(native);
                await openGlobalRecent(native);
                await expect(
                    contentCardByTitle(native, retainedTitle)
                ).toBeVisible({ timeout: 30000 });
                const beforeRestore = JSON.stringify((await read()).state);
                const source = inventory.entries[0].source;
                const backup: PlaylistBackupManifestV1 = {
                    kind: 'iptvnator-playlist-backup',
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    includeSecrets: true,
                    playlists: [
                        {
                            portalType: 'm3u',
                            exportedId: 'synthetic-new-backup-source',
                            title: 'Synthetic backup source',
                            autoRefresh: false,
                            source: {
                                kind: 'text',
                                rawM3u: '#EXTM3U\n#EXTINF:-1,Synthetic backup channel\nhttps://history.example/backup-stream',
                            },
                            userState: {
                                favorites: [],
                                recentlyViewed: [],
                                hiddenGroupTitles: [],
                            },
                        },
                        {
                            portalType: 'xtream',
                            exportedId: id,
                            title: 'Synthetic shared history',
                            autoRefresh: false,
                            connection: {
                                serverUrl: source.serverUrl,
                                username: source.username,
                                password: source.password,
                            },
                            userState: {
                                favorites: [],
                                recentlyViewed: [],
                                hiddenCategories: [],
                                playbackPositions: [],
                            },
                        },
                    ],
                };
                const path = join(
                    directory,
                    'synthetic-mixed-history-backup.json'
                );
                writeFileSync(path, JSON.stringify(backup));
                await openSettings(native);
                await openSettingsSection(native, 'backup');
                const chooser = native.waitForEvent('filechooser');
                await native
                    .locator('#backup')
                    .getByRole('button', { name: 'Import', exact: true })
                    .click();
                await (await chooser).setFiles(path);
                await expect(
                    native.getByText(
                        /Backup import finished: 1 imported, 1 merged/
                    )
                ).toBeVisible({ timeout: 30000 });
                await openGlobalRecent(native);
                await expect(
                    contentCardByTitle(native, retainedTitle)
                ).toHaveCount(0);
                expect(JSON.stringify((await read()).state)).toBe(
                    beforeRestore
                );
                await openSources(page);
                await openGlobalRecent(page);
                await expect(
                    contentCardByTitle(page, retainedTitle)
                ).toBeVisible({ timeout: 30000 });
            }
            const json = JSON.stringify((await read()).state);
            expect(json).not.toContain('cmd');
            expect(json).not.toContain('marketing');
        } finally {
            if (desktop) await closeElectronApp(desktop);
            await context.close();
            await server.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

test('shows the catalog title and poster for existing synced Xtream history @history @electron @persistence', async ({
    browser,
}) => {
    const server = await startSourceSyncServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-history-artwork-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const page = await context.newPage();
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `window.__IPTVNATOR_CONFIG__=${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
            })
        );
        await page.goto(`${frontend}/workspace/sources`);
        const sourceTitle = 'Synthetic shared catalog';
        await addXtreamPortal(page, {
            name: sourceTitle,
            username: 'marketing',
            password: 'marketing',
        });
        const { instanceId } = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        const inventory = await (
            await fetch(`${server.apiUrl}/v1/sources`)
        ).json();
        const id = inventory.entries[0].source.id;
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );

        desktop = await launchElectronApp(directory);
        const native = desktop.mainWindow;
        await openSources(native);
        await sourceRowByTitle(native, sourceTitle)
            .getByText(sourceTitle, { exact: true })
            .click();
        await waitForXtreamWorkspaceReady(native);
        const identity = { tmdbId: 123456, releaseYear: 2024 };
        const movie = await native.evaluate(
            async ({ id, identity }) => {
                const [item] = await window.electron.dbGetContent(id, 'movie');
                if (!item?.poster_url)
                    throw new Error('Missing catalog poster');
                await window.electron.dbSetContentMetadataIfMissing(
                    item.id,
                    identity
                );
                await window.electron.dbSavePlaybackPosition(id, {
                    contentXtreamId: item.xtream_id,
                    contentType: 'vod',
                    positionSeconds: 120,
                    durationSeconds: 7200,
                });
                return item;
            },
            { id, identity }
        );

        const headers = { 'X-IPTVnator-Instance-Id': instanceId };
        const read = async () =>
            await (
                await fetch(`${server.apiUrl}/v1/history/sources/${id}`, {
                    headers,
                })
            ).json();
        const { scope, state } = await read();
        const snapshotTitle = 'Synthetic remote playback title';
        const response = await fetch(`${server.apiUrl}/v1/history/operations`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scope,
                operation: {
                    kind: 'touch',
                    operationId: 'synthetic-existing-watch',
                    deviceId: 'synthetic-remote',
                    baseRevision: state.revision,
                    viewedAt: Date.now(),
                    reference: {
                        provider: 'xtream',
                        kind: 'movie',
                        id: String(movie.xtream_id),
                    },
                    snapshot: {
                        title: snapshotTitle,
                        tmdbId: String(identity.tmdbId),
                        releaseYear: String(identity.releaseYear),
                    },
                },
            }),
        });
        expect(response.ok).toBe(true);
        const before = (await read()).state;
        expect(before.items).toHaveLength(1);

        await enable(native);
        await goToDashboard(native);
        const rail = native.getByTestId('dashboard-continue-watching-rail');
        const card = rail
            .getByTestId('dashboard-continue-watching-rail-card')
            .filter({ hasText: movie.title });
        await expect(card).toBeVisible();
        const poster = card.getByRole('img', {
            name: movie.title,
            exact: true,
        });
        await expect(poster).toHaveAttribute('src', movie.poster_url);
        await expect
            .poll(() =>
                poster.evaluate((image: HTMLImageElement) => image.naturalWidth)
            )
            .toBeGreaterThan(0);
        await expect(
            rail.getByText(snapshotTitle, { exact: true })
        ).toHaveCount(0);
        expect(
            await native.evaluate(
                (id) => window.electron.dbGetRecentItems(id),
                id
            )
        ).toEqual([]);
        expect((await read()).state).toEqual(before);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await context.close();
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
