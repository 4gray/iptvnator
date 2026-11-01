import type { PlaylistBackupManifestV1 } from '@iptvnator/shared/interfaces';
import {
    fetchXtreamVodFixture,
    getXtreamTitle,
    fetchXtreamSeriesFixture,
    fetchStalkerCategoryFixture,
} from './portal-mock-fixtures';
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    launchElectronApp,
    closeElectronApp,
    openSources,
    addXtreamPortal,
    openSettings,
    openSettingsSection,
    waitForXtreamWorkspaceReady,
    resetMockServers,
    sourceRowByTitle,
    clickCategoryByNameExact,
    defaultXtreamUsername,
    defaultXtreamPassword,
    addStalkerPortal,
    waitForStalkerCatalog,
} from './electron-test-fixtures';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';

const frontendUrl = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4307'}`;
test.use({ actionTimeout: 20000, navigationTimeout: 30000 });
test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Requires the source-sync configuration'
);

async function enable(page: Page) {
    await openSettings(page);
    await openSettingsSection(page, 'server');
    await page
        .getByTestId('activity-sync-enabled')
        .getByRole('checkbox')
        .check();
    await expect(page.getByTestId('activity-sync-state')).toContainText(
        'Activity is synchronized',
        { timeout: 30000 }
    );
}
const selectedTitles = new Map<string, string>();
const selectedCategories = new Map<string, string>();
async function movie(
    page: Page,
    name: string,
    previousPath?: string,
    provider = 'xtream',
    selectItem = true
) {
    await openSources(page);
    await sourceRowByTitle(page, name).getByText(name, { exact: true }).click();
    if (
        provider === 'xtream' &&
        (await page.evaluate(() => !!window.electron?.dbGetAppState))
    )
        await waitForXtreamWorkspaceReady(page);
    else if (provider === 'stalker') await waitForStalkerCatalog(page);
    else {
        await page.waitForURL(/\/workspace\/xtreams\/.+/);
        await expect(page.locator('.category-item').first()).toBeVisible();
    }
    await page.getByRole('link', { name: 'Movies', exact: true }).click();
    const key = `${provider}:${name}`;
    const category = selectedCategories.get(key);
    if (category) await clickCategoryByNameExact(page, category);
    else await page.locator('.category-item').first().click();
    const cards = page.locator(
        '.content-card__activation, app-grid-list mat-card'
    );
    await expect(cards.first()).toBeVisible();
    if (!previousPath && !selectedTitles.has(key))
        selectedTitles.set(
            key,
            (await cards.first().getAttribute('aria-label'))!
        );
    const title = selectedTitles.get(key)!;
    const card = cards
        .and(page.getByRole('button', { name: title, exact: true }))
        .first();
    if (!selectItem) return card;
    await card.click();
    await expect(
        page.locator('[data-testid="vod-primary-action"]')
    ).toBeVisible();
    return card;
}

async function series(
    page: Page,
    provider: string,
    fixture: { categoryName: string; title: string }
) {
    await openSources(page);
    await sourceRowByTitle(page, 'Shared activity')
        .getByText('Shared activity', { exact: true })
        .click();
    await page.getByRole('link', { name: 'Series', exact: true }).click();
    if (provider === 'xtream')
        await clickCategoryByNameExact(page, fixture.categoryName);
    else
        await page
            .locator('.category-item')
            .filter({
                has: page.getByText(fixture.categoryName, { exact: true }),
            })
            .first()
            .click();
    await page
        .getByRole('button', { name: fixture.title, exact: true })
        .click();
    await expect(
        page.locator('[data-testid="episode-watched-toggle"]').first()
    ).toBeVisible({ timeout: 25000 });
}

for (const provider of ['xtream', 'stalker'] as const)
    test(`syncs ${provider} real playback and watched/reset from PWA to Electron and back @web @electron @persistence @${provider}`, async ({
        browser,
        request,
    }) => {
        await resetMockServers(request, [provider]);
        if (provider === 'xtream') {
            const fixture = await fetchXtreamVodFixture(request, {
                username: defaultXtreamUsername,
                password: defaultXtreamPassword,
            });
            selectedTitles.set(
                'xtream:Shared activity',
                getXtreamTitle(fixture.items[0])
            );
            selectedCategories.set(
                'xtream:Shared activity',
                fixture.categoryName
            );
        }
        const seriesData =
            provider === 'xtream'
                ? await fetchXtreamSeriesFixture(request, {
                      username: defaultXtreamUsername,
                      password: defaultXtreamPassword,
                  })
                : await fetchStalkerCategoryFixture(request, 'series');
        const seriesFixture = {
            categoryName: seriesData.categoryName,
            title: String(seriesData.items[0].name),
        };
        const server = await startSourceSyncServer();
        // A production PWA worker would bypass page.route's local media fixtures.
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const directory = mkdtempSync(join(tmpdir(), 'iptvnator-activity-'));
        let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            const page = await context.newPage();
            await page.route('**/assets/app-config.js', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
                })
            );
            await page.goto(`${frontendUrl}/workspace/sources`);
            if (provider === 'xtream')
                await addXtreamPortal(page, { name: 'Shared activity' });
            else await addStalkerPortal(page, { name: 'Shared activity' });
            const { instanceId } = await (
                await fetch(`${server.apiUrl}/v1/instance`)
            ).json();
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({ apiUrl: server.apiUrl, instanceId })
            );
            desktop = await launchElectronApp(directory);
            const native = desktop.mainWindow;
            const targetSeconds = provider === 'stalker' ? 2 : 12;
            page.on('pageerror', (error) =>
                console.log('PWA error:', error.message)
            );
            native.on('pageerror', (error) =>
                console.log('Electron error:', error.message)
            );
            const legacySourceId = new URL(page.url()).pathname.split('/')[3];
            const legacySaved = await native.evaluate(
                (id) =>
                    window.electron!.dbSavePlaybackPosition!(id, {
                        contentType: 'vod',
                        contentXtreamId: 987654,
                        positionSeconds: 71,
                        durationSeconds: 100,
                    }),
                legacySourceId
            );
            expect(legacySaved).toMatchObject({ success: true });

            await enable(page);
            await enable(native);
            await movie(page, 'Shared activity', undefined, provider);
            const path = new URL(page.url()).pathname;
            const sourceId = path.split('/')[3];
            const headers = { 'X-IPTVnator-Instance-Id': instanceId };
            const rows = async () =>
                (
                    await (
                        await fetch(
                            `${server.apiUrl}/v1/activity/sources/${sourceId}/items`,
                            { headers }
                        )
                    ).json()
                ).entries;
            expect(await rows()).toEqual([]);
            await routePlayableStreams(page);
            await startAndConfirmPlayback(
                page,
                () =>
                    page.locator('[data-testid="vod-primary-action"]').click(),
                3
            );
            await page
                .locator('video')
                .first()
                .evaluate((video: HTMLVideoElement, target) => {
                    video.currentTime = target;
                    video.pause();
                }, targetSeconds);
            await expect
                .poll(
                    async () =>
                        (await rows())[0]?.state.resume?.positionSeconds,
                    { timeout: 20000 }
                )
                .toBeGreaterThanOrEqual(targetSeconds);
            await openSettings(page);
            await movie(native, 'Shared activity', path, provider);
            await expect(
                native.locator('[data-testid="vod-primary-action"]')
            ).toContainText('Continue', { timeout: 15000 });
            await routePlayableStreams(native);
            await startAndConfirmPlayback(
                native,
                () =>
                    native
                        .locator('[data-testid="vod-primary-action"]')
                        .click(),
                0.75
            );
            await expect
                .poll(() =>
                    native
                        .locator('video')
                        .first()
                        .evaluate(
                            (video: HTMLVideoElement) => video.currentTime
                        )
                )
                .toBeGreaterThan(targetSeconds);
            await openSettings(native);
            await movie(native, 'Shared activity', path, provider);
            const catalogCard =
                provider === 'stalker'
                    ? await movie(
                          page,
                          'Shared activity',
                          path,
                          provider,
                          false
                      )
                    : undefined;
            const continuing = page.getByTestId(
                'dashboard-continue-watching-rail-card'
            );
            if (provider === 'xtream') {
                await page
                    .getByRole('link', { name: 'Dashboard', exact: true })
                    .and(page.locator('[href="/workspace/dashboard"]'))
                    .click();
                await expect(continuing).toHaveCount(1);
            } else {
                await expect(
                    catalogCard!.locator('app-watched-badge .watched-badge')
                ).toHaveCount(0);
            }
            await native.locator('[data-testid="vod-watched-toggle"]').click();
            await expect
                .poll(async () => (await rows())[0]?.state.watched)
                .toBe(true);
            if (provider === 'xtream') {
                await expect(continuing).toHaveCount(0, { timeout: 15000 });
            } else {
                await expect(
                    catalogCard!.locator('app-watched-badge .watched-badge')
                ).toBeVisible({ timeout: 15000 });
            }
            await movie(page, 'Shared activity', path, provider);
            await expect(
                page.locator('[data-testid="vod-watched-toggle"]')
            ).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
            if (provider === 'xtream') {
                await openSettings(page);
                await openSettingsSection(page, 'backup');
                const downloaded = page.waitForEvent('download');
                await page
                    .getByRole('button', { name: 'Export', exact: true })
                    .click();
                const filePath = await (await downloaded).path();
                const backup = JSON.parse(
                    readFileSync(filePath!, 'utf8')
                ) as PlaylistBackupManifestV1;
                const entry = backup.playlists.find(
                    (entry) => entry.exportedId === sourceId
                );
                if (entry?.portalType !== 'xtream')
                    throw new Error('Xtream backup entry missing');
                const positions = entry.userState.playbackPositions;
                expect(positions).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ watched: true }),
                    ])
                );
                const watched = positions.find((position) => position.watched)!;
                expect(watched.positionSeconds).toBe(watched.durationSeconds);
                expect(watched.activitySessionId).toBeUndefined();
                expect(watched.activityAction).toBeUndefined();
                await movie(page, 'Shared activity', path, provider);
            }
            await page.locator('[data-testid="vod-watched-toggle"]').click();
            await expect
                .poll(async () => (await rows())[0]?.state)
                .toMatchObject({ watched: false, resume: null });
            await openSettings(native);
            await movie(native, 'Shared activity', path, provider);
            await expect(
                native.locator('[data-testid="vod-watched-toggle"]')
            ).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
            // A full renderer/main/worker restart must recover the IPC-backed projection.
            await closeElectronApp(desktop);
            desktop = undefined;
            desktop = await launchElectronApp(directory);
            await movie(desktop.mainWindow, 'Shared activity', path, provider);
            await expect(
                desktop.mainWindow.locator('[data-testid="vod-watched-toggle"]')
            ).toHaveAttribute('aria-pressed', 'false');
            // Completion propagates to an already-open detail, without navigating it.
            await startAndConfirmPlayback(
                page,
                () =>
                    page.locator('[data-testid="vod-primary-action"]').click(),
                0.75
            );
            await page
                .locator('video')
                .first()
                .evaluate((video: HTMLVideoElement) => {
                    video.currentTime = video.duration - 0.1;
                    void video.play();
                });
            await expect
                .poll(async () => (await rows())[0]?.state.watched)
                .toBe(true);
            await expect(
                desktop.mainWindow.locator('[data-testid="vod-watched-toggle"]')
            ).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
            await openSettings(page);
            await openSettingsSection(page, 'server');
            await page
                .getByTestId('activity-sync-enabled')
                .getByRole('checkbox')
                .uncheck();
            await expect(page.getByTestId('activity-sync-state')).toContainText(
                'Activity stays on this device'
            );
            const revision = (await rows())[0].state.revision;
            await movie(page, 'Shared activity', path, provider);
            await expect(
                page.locator('[data-testid="vod-watched-toggle"]')
            ).toHaveAttribute('aria-pressed', 'true');
            await page.locator('[data-testid="vod-watched-toggle"]').click();
            await expect(
                page.locator('[data-testid="vod-watched-toggle"]')
            ).toHaveAttribute('aria-pressed', 'false');
            expect((await rows())[0].state).toMatchObject({
                revision,
                watched: true,
            });
            expect(await rows()).toHaveLength(1); // The old local row was never uploaded.
            // Episode adapters use the provider parent and coordinates, across both runtimes.
            await enable(page);
            await series(page, provider, seriesFixture);
            await page
                .locator('[data-testid="episode-watched-toggle"]')
                .first()
                .click();
            await expect
                .poll(
                    async () =>
                        (await rows()).filter(
                            (entry: {
                                address: { content: { kind: string } };
                                state: { watched: boolean };
                            }) =>
                                entry.address.content.kind === 'episode' &&
                                entry.state.watched
                        ).length
                )
                .toBe(1);
            await series(desktop.mainWindow, provider, seriesFixture);
            try {
                await expect(
                    desktop.mainWindow
                        .locator('[data-testid="episode-watched-toggle"]')
                        .first()
                ).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
            } catch (error) {
                console.log('Episode NAS state', JSON.stringify(await rows()));
                console.log(
                    'Episode local projection',
                    JSON.stringify(
                        await desktop.mainWindow.evaluate(
                            ({ instanceId, sourceId }) =>
                                window.electron!.activityLocalRequest!({
                                    operation: 'list',
                                    instanceId,
                                    sourceId,
                                }),
                            { instanceId, sourceId }
                        )
                    )
                );
                throw error;
            }
            await desktop.mainWindow
                .locator('[data-testid="episode-watched-toggle"]')
                .first()
                .click();
            await expect
                .poll(
                    async () =>
                        (await rows()).filter(
                            (entry: {
                                address: { content: { kind: string } };
                                state: { watched: boolean };
                            }) =>
                                entry.address.content.kind === 'episode' &&
                                entry.state.watched
                        ).length
                )
                .toBe(0);
            await expect(
                page.locator('[data-testid="episode-watched-toggle"]').first()
            ).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
            if (provider === 'stalker') {
                // Disabling mirrors the zero barrier through real SQLite IPC.
                await openSettings(desktop.mainWindow);
                await openSettingsSection(desktop.mainWindow, 'server');
                await desktop.mainWindow
                    .getByTestId('activity-sync-enabled')
                    .getByRole('checkbox')
                    .uncheck();
                await expect(
                    desktop.mainWindow.getByTestId('activity-sync-state')
                ).toContainText('Activity stays on this device');
                const positions = await desktop.mainWindow.evaluate(
                    (id) => window.electron!.dbGetAllPlaybackPositions(id),
                    sourceId
                );
                expect(
                    positions.filter((item) => item.contentType === 'episode')
                ).toEqual([expect.objectContaining({ positionSeconds: 0 })]);
                await closeElectronApp(desktop);
                desktop = undefined;
                desktop = await launchElectronApp(directory);
                await series(desktop.mainWindow, provider, seriesFixture);
                await expect(
                    desktop.mainWindow
                        .locator('[data-testid="episode-watched-toggle"]')
                        .first()
                ).toHaveAttribute('aria-pressed', 'false');
            }
        } finally {
            if (desktop) await closeElectronApp(desktop);
            await context.close();
            await server.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
