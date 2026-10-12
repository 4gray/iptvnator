import type { Locator, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import {
    closeElectronApp,
    electronMainPath,
    expect,
    type LaunchedElectronApp,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
} from './renderer-reload.support';

const SOURCE_TITLE = 'group-management-source';
const HIDDEN_GROUPS = ['Movies', 'Sports'];
const VISIBLE_HIDDEN_GROUPS_KEY = '__e2eVisibleHiddenGroups';
const RECONCILE_CHANNEL = 'EPG_RECONCILE_SOURCES';

interface ReconcileScript {
    calls: number;
    gate: Promise<void>;
    release: () => void;
}

type ReconcileGlobal = typeof globalThis & {
    __e2eReconcileScript?: ReconcileScript;
};

// Serialized into the test bootstrap; all runtime dependencies are arguments.
function installReconcileScript(
    { ipcMain }: Pick<typeof import('electron'), 'ipcMain'>,
    channel: string
): void {
    const register = ipcMain.handle;
    const scope = globalThis as ReconcileGlobal;
    ipcMain.handle = function (name, listener) {
        if (name !== channel) {
            return register.call(this, name, listener);
        }
        return register.call(this, name, async (...args) => {
            const script = scope.__e2eReconcileScript;
            if (script) {
                script.calls += 1;
                if (script.calls === 1) return { success: false };
                await script.gate;
            }
            return listener(...args);
        });
    };
}

function launchWithReconcileScript(
    dataDir: string
): Promise<LaunchedElectronApp> {
    const entryPoint = join(dataDir, 'reconcile-script.cjs');
    writeFileSync(
        entryPoint,
        [
            `(${installReconcileScript.toString()})(require('electron'), ${JSON.stringify(RECONCILE_CHANNEL)});`,
            `require(${JSON.stringify(electronMainPath)});`,
        ].join('\n')
    );
    return launchElectronApp(dataDir, { entryPoint });
}

/**
 * The next renderer's startup reconciliation fails, and the retry the
 * playlist inventory awaits is parked until `release`: the M3U route then
 * activates (its settings resolver has finished) while the store still has no
 * playlists.
 */
async function delayPlaylistInventory(app: LaunchedElectronApp) {
    await app.electronApp.evaluate(() => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        (globalThis as ReconcileGlobal).__e2eReconcileScript = {
            calls: 0,
            gate,
            release,
        };
    });
    return {
        waitUntilParked: () =>
            expect
                .poll(() =>
                    app.electronApp.evaluate(
                        () =>
                            (globalThis as ReconcileGlobal).__e2eReconcileScript
                                ?.calls ?? 0
                    )
                )
                .toBeGreaterThan(1),
        release: () =>
            app.electronApp.evaluate(() => {
                const scope = globalThis as ReconcileGlobal;
                const script = scope.__e2eReconcileScript;
                delete scope.__e2eReconcileScript;
                script?.release();
            }),
    };
}
const CHANNELS = ['News', 'Sports', 'Movies'].flatMap((group) =>
    [1, 2].map((index) => ({
        groupTitle: group,
        name: `${group} Channel ${index}`,
        url: `https://streams.example.test/${group.toLowerCase()}-${index}.m3u8`,
    }))
);

function groupNavLabels(page: Page): Locator {
    return page.locator('app-groups-view .group-nav-item .nav-item-label');
}

async function openGroupManagement(page: Page): Promise<Locator> {
    await page
        .getByRole('button', { name: 'Manage groups', exact: true })
        .click();
    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog.locator('.group-item')).toHaveCount(3);
    return dialog;
}

function groupCheckbox(dialog: Locator, group: string): Locator {
    return dialog
        .locator('.group-item')
        .filter({ hasText: group })
        .getByRole('checkbox');
}

async function storedHiddenGroupTitles(page: Page): Promise<unknown> {
    return page.evaluate(async () => {
        const playlistId = location.pathname.match(
            /\/workspace\/playlists\/([^/]+)/
        )?.[1];
        if (!playlistId) throw new Error('M3U playlist route is missing');
        const api = (window as unknown as { electron: ElectronBridgeApi })
            .electron;
        const playlist = (await api.dbGetAppPlaylist(playlistId)) as {
            hiddenGroupTitles?: unknown;
        } | null;
        const hidden = playlist?.hiddenGroupTitles;
        return Array.isArray(hidden) ? [...hidden].sort() : hidden;
    });
}

/** Imports the playlist and hides {@link HIDDEN_GROUPS} in Manage groups. */
async function importAndHideGroups(
    app: LaunchedElectronApp,
    dataDir: string
): Promise<void> {
    const filePath = writeTemporaryM3uFile(
        dataDir,
        `${SOURCE_TITLE}.m3u`,
        CHANNELS
    );
    await importM3uPlaylistFromNativeDialog(app, filePath);
    await waitForM3uCatalog(app.mainWindow);
    await openWorkspaceSection(app.mainWindow, 'Groups');
    await expect(groupNavLabels(app.mainWindow)).toHaveText([
        'Movies',
        'News',
        'Sports',
    ]);

    const dialog = await openGroupManagement(app.mainWindow);
    for (const group of HIDDEN_GROUPS) {
        await groupCheckbox(dialog, group).uncheck();
    }
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(groupNavLabels(app.mainWindow)).toHaveText(['News']);
    await expect
        .poll(() => storedHiddenGroupTitles(app.mainWindow))
        .toEqual(HIDDEN_GROUPS);
}

/**
 * Records, from the start of every new document, each hidden group the
 * groups rail ever renders visibly — including before the startup inventory
 * publishes the playlist.
 */
async function recordVisibleHiddenGroups(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.context().addInitScript(
        ({ hiddenGroups, key }) => {
            const seen: string[] = [];
            Reflect.set(window, key, seen);
            const check = () => {
                for (const item of document.querySelectorAll(
                    'app-groups-view .group-nav-item'
                )) {
                    const group = item.getAttribute('data-group-key') ?? '';
                    if (
                        hiddenGroups.includes(group) &&
                        !seen.includes(group) &&
                        item.checkVisibility()
                    ) {
                        seen.push(group);
                    }
                }
            };
            new MutationObserver(check).observe(document, {
                attributes: true,
                attributeFilter: ['class', 'style'],
                childList: true,
                subtree: true,
            });
        },
        { hiddenGroups: HIDDEN_GROUPS, key: VISIBLE_HIDDEN_GROUPS_KEY }
    );
}

test.describe('Electron M3U group management', () => {
    test('keeps groups hidden in Manage groups after a restart (#1894)', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await importAndHideGroups(app, dataDir);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, SOURCE_TITLE)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Groups');
            await expect(groupNavLabels(app.mainWindow)).toHaveText(['News']);

            // The dialog opens from the restored state, so saving it again
            // cannot silently unhide the groups.
            const reopened = await openGroupManagement(app.mainWindow);
            await expect(groupCheckbox(reopened, 'News')).toBeChecked();
            await expect(groupCheckbox(reopened, 'Movies')).not.toBeChecked();
            await expect(groupCheckbox(reopened, 'Sports')).not.toBeChecked();
            await reopened
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await expect(reopened).toBeHidden();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('never shows hidden groups when the Groups route opens before the playlist inventory', async ({
        dataDir,
    }) => {
        const app = await launchWithReconcileScript(dataDir);

        try {
            await importAndHideGroups(app, dataDir);
            await recordVisibleHiddenGroups(app);
            const inventory = await delayPlaylistInventory(app);

            // A reload boots a fresh store straight on this route.
            await reloadFromMainProcess(app);
            await inventory.waitUntilParked();
            // The route session has read the playlist and published its
            // channels, still behind the startup screen, before the store
            // has the playlist the hidden groups belong to.
            const rail = app.mainWindow.locator(
                'app-groups-view .group-nav-item'
            );
            await expect(rail).toHaveCount(3);
            await expect(rail.first()).toBeHidden();

            await inventory.release();
            await expectRendererReloadedOnRoute(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/groups$/
            );
            await expect(groupNavLabels(app.mainWindow)).toHaveText(['News']);
            expect(
                await app.mainWindow.evaluate(
                    (key) => Reflect.get(window, key),
                    VISIBLE_HIDDEN_GROUPS_KEY
                )
            ).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
