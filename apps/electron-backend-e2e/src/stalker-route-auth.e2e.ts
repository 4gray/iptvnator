import type { Page } from '@playwright/test';

import {
    closeElectronApp,
    expect,
    launchElectronApp,
    restartElectronApp,
    test,
} from './electron-test-fixtures';
import {
    StalkerReplayRun,
    withStalkerReplayRun,
} from './support/stalker-replay';

test.describe('Electron Stalker route authentication', () => {
    test('@stalker @electron migrates a legacy route through credentials, atomic persistence, and credential-free reopen', async ({
        dataDir,
    }) => {
        const replay = await withStalkerReplayRun(
            'e2e/legacy-first-open-reopen',
            async (run) => {
                const playlistId = 'e2e-legacy-route-auth';
                const playlistTitle = 'Legacy authenticated Stalker';
                const endpoint = `${requiredOrigin(run, 'portal')}/portal.php`;
                const app = await launchElectronApp(dataDir);

                try {
                    await seedLegacyPlaylist(app.mainWindow, {
                        endpoint,
                        macAddress: requiredInput(run, 'mac'),
                        playlistId,
                        playlistTitle,
                        sourceUrl: run.entryUrl,
                    });
                    await expect(
                        readPersistedStalkerPlaylist(
                            app.mainWindow,
                            playlistId
                        )
                    ).resolves.toMatchObject({
                        _id: playlistId,
                        title: playlistTitle,
                    });

                    const seededRestart = await restartElectronApp(
                        app,
                        dataDir
                    );
                    app.electronApp = seededRestart.electronApp;
                    app.mainWindow = seededRestart.mainWindow;
                    await navigateToStalkerRoute(
                        app.mainWindow,
                        playlistId
                    );
                    await submitCredentials(app.mainWindow, run);

                    await expect
                        .poll(
                            () =>
                                readPersistedStalkerPlaylist(
                                    app.mainWindow,
                                    playlistId
                                ),
                            { timeout: 15000 }
                        )
                        .toMatchObject({
                            isFullStalkerPortal: true,
                            password: requiredInput(run, 'password'),
                            portalUrl: endpoint,
                            stalkerRecipeClassifierVersion: 1,
                            stalkerRequestRecipe: 'full-session',
                            stalkerSourceUrl: run.entryUrl,
                            username: requiredInput(run, 'username'),
                        });
                    const firstPersisted = await readPersistedStalkerPlaylist(
                        app.mainWindow,
                        playlistId
                    );
                    expect(firstPersisted).not.toHaveProperty('stalkerToken');
                    expect(firstPersisted.stalkerLastVerifiedAt).toEqual(
                        expect.any(String)
                    );
                    await waitForEmptyStalkerCategories(app.mainWindow);

                    const restarted = await restartElectronApp(app, dataDir);
                    app.electronApp = restarted.electronApp;
                    app.mainWindow = restarted.mainWindow;
                    await expect(
                        readPersistedStalkerPlaylist(
                            app.mainWindow,
                            playlistId
                        )
                    ).resolves.toMatchObject({
                        _id: playlistId,
                        stalkerRequestRecipe: 'full-session',
                        title: playlistTitle,
                    });
                    await navigateToStalkerRoute(
                        app.mainWindow,
                        playlistId
                    );

                    await expect
                        .poll(
                            async () =>
                                (
                                    await readPersistedStalkerPlaylist(
                                        app.mainWindow,
                                        playlistId
                                    )
                                ).stalkerLastVerifiedAt,
                            { timeout: 15000 }
                        )
                        .not.toBe(firstPersisted.stalkerLastVerifiedAt);
                    await expect(
                        app.mainWindow.locator(
                            'app-stalker-credentials-dialog'
                        )
                    ).toHaveCount(0);
                    await waitForEmptyStalkerCategories(app.mainWindow);
                } finally {
                    await closeElectronApp(app);
                }
            }
        );

        expect(replay.finalization).toMatchObject({
            ledger: {
                mismatchCounts: {},
                operationCounts: {
                    'anonymous-probe': 2,
                    'catalog-categories': 2,
                    'do-auth': 2,
                    handshake: 2,
                    'profile-first': 2,
                    'profile-second': 2,
                },
                terminalState: 'complete',
            },
            ok: true,
        });
    });
});

async function seedLegacyPlaylist(
    page: Page,
    input: {
        endpoint: string;
        macAddress: string;
        playlistId: string;
        playlistTitle: string;
        sourceUrl: string;
    }
): Promise<void> {
    await page.evaluate(
        async ({
            endpoint,
            macAddress,
            playlistId,
            playlistTitle,
            sourceUrl,
        }) => {
            const upsert = window.electron?.dbUpsertAppPlaylist;
            if (!upsert) {
                throw new Error('playlist-upsert-unavailable');
            }
            const now = new Date().toISOString();
            await upsert({
                _id: playlistId,
                autoRefresh: false,
                count: 0,
                importDate: now,
                isFullStalkerPortal: true,
                lastUsage: now,
                macAddress,
                portalUrl: endpoint,
                stalkerSourceUrl: sourceUrl,
                stalkerToken: 'legacy-renderer-token',
                title: playlistTitle,
            });
        },
        input
    );
}

async function navigateToStalkerRoute(
    page: Page,
    playlistId: string
): Promise<void> {
    const route = `/workspace/stalker/${playlistId}/vod`;
    await page.evaluate((nextRoute) => {
        window.history.pushState({}, '', nextRoute);
        window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForURL(
        new RegExp(`/workspace/stalker/${escapeRegExp(playlistId)}/`)
    );
}

async function submitCredentials(
    page: Page,
    run: StalkerReplayRun
): Promise<void> {
    const dialog = page.locator('app-stalker-credentials-dialog').last();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog
        .locator('input[autocomplete="username"]')
        .fill(requiredInput(run, 'username'));
    await dialog
        .locator('input[autocomplete="current-password"]')
        .fill(requiredInput(run, 'password'));
    await dialog.locator('button[type="submit"]').click();
    await dialog.waitFor({ state: 'detached' });
}

async function readPersistedStalkerPlaylist(
    page: Page,
    playlistId: string
): Promise<Record<string, unknown>> {
    const playlist = await page.evaluate(async (id) => {
        const read = window.electron?.dbGetAppPlaylist;
        if (!read) {
            throw new Error('playlist-read-unavailable');
        }
        return read(id);
    }, playlistId);
    if (playlist === null || typeof playlist !== 'object') {
        throw new Error('persisted-stalker-playlist-missing');
    }
    return playlist as Record<string, unknown>;
}

async function waitForEmptyStalkerCategories(page: Page): Promise<void> {
    await expect(
        page.locator('app-workspace-context-panel .category-empty-state')
    ).toBeVisible({ timeout: 15000 });
    await expect(
        page.locator('app-workspace-context-panel .context-skeleton')
    ).toHaveCount(0);
}

function requiredInput(run: StalkerReplayRun, name: string): string {
    const value = run.inputs[name];
    if (!value) {
        throw new Error(`stalker-replay-input-missing:${name}`);
    }
    return value;
}

function requiredOrigin(run: StalkerReplayRun, name: string): string {
    const value = run.origins[name];
    if (!value) {
        throw new Error(`stalker-replay-origin-missing:${name}`);
    }
    return value;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
