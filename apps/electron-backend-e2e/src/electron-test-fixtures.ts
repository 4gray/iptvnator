import {
    _electron as electron,
    APIRequestContext,
    ElectronApplication,
    expect,
    Locator,
    Page,
    test as base,
} from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export const workspaceRoot = resolve(__dirname, '../../..');
export const electronMainPath = join(
    workspaceRoot,
    'dist/apps/electron-backend/main.js'
);
export const m3uFixturePath = join(
    workspaceRoot,
    'apps/web-e2e/src/fixtures/test.m3u'
);
export const stalkerMockPort = process.env['MOCK_PORT'] ?? '3210';
export const xtreamMockPort = process.env['XTREAM_MOCK_PORT'] ?? '3211';
export const stalkerMockServer = `http://localhost:${stalkerMockPort}`;
export const xtreamMockServer = `http://localhost:${xtreamMockPort}`;
export const defaultXtreamPortalName = 'Mock Xtream Portal';
export const defaultStalkerPortalName = 'Mock Stalker Portal';
export const defaultXtreamUsername = 'user1';
export const defaultXtreamPassword = 'pass1';
export const defaultStalkerMacAddress = '00:1A:79:00:00:01';

export type PortalProvider = 'stalker' | 'xtream';

type ElectronFixtures = {
    dataDir: string;
};

type LaunchElectronAppOptions = {
    env?: Record<string, string | undefined>;
};

export type PortalDebugEvent = {
    durationMs: number;
    operation: string;
    provider: PortalProvider;
    request: unknown;
    requestId: string;
    response?: unknown;
    startedAt: string;
    status: 'success' | 'error';
    transport: 'electron-main' | 'electron-renderer' | 'pwa-http';
};

export type DbOperationEvent = {
    operationId?: string;
    operation: string;
    playlistId?: string;
    status: 'started' | 'progress' | 'completed' | 'cancelled' | 'error';
    phase?: string;
    current?: number;
    total?: number;
    increment?: number;
    error?: string;
};

declare global {
    interface Window {
        __dbOperationEvents?: DbOperationEvent[];
        __dbOperationUnsubscribe?: (() => void) | undefined;
        __portalDebugEvents?: PortalDebugEvent[];
        __portalDebugUnsubscribe?: (() => void) | undefined;
        __rendererFrameCount?: number;
        __rendererFrameRequestId?: number;
    }
}

export type LaunchedElectronApp = {
    electronApp: ElectronApplication;
    mainWindow: Page;
};

export const test = base.extend<ElectronFixtures>({
    dataDir: async ({}, use) => {
        const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-electron-e2e-'));

        await use(dataDir);

        rmSync(dataDir, { force: true, recursive: true });
    },
});

export { expect };

export async function launchElectronApp(
    dataDir: string,
    options: LaunchElectronAppOptions = {}
): Promise<LaunchedElectronApp> {
    if (!existsSync(electronMainPath)) {
        throw new Error(
            `Electron build not found at ${electronMainPath}. Run the build before executing the E2E suite.`
        );
    }

    const args = [electronMainPath];

    if (process.platform === 'linux' && process.env['CI']) {
        args.unshift('--no-sandbox', '--disable-gpu');
    }

    const electronApp = await electron.launch({
        args,
        env: {
            ...process.env,
            ...options.env,
            ELECTRON_IS_DEV: '0',
            IPTVNATOR_E2E_DATA_DIR: dataDir,
            NODE_ENV: 'test',
        },
    });

    const mainWindow = await findMainWindow(electronApp);
    await waitForAppReady(mainWindow);
    await startPortalDebugCapture(mainWindow);
    await startDbOperationCapture(mainWindow);
    await startRendererFrameCapture(mainWindow);

    return {
        electronApp,
        mainWindow,
    };
}

export async function closeElectronApp(
    app: LaunchedElectronApp
): Promise<void> {
    try {
        await app.electronApp.close();
    } catch (error) {
        console.warn('Failed to close Electron app cleanly:', error);
    }
}

async function findMainWindow(app: ElectronApplication): Promise<Page> {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));

    const windows = app.windows();

    for (const window of windows) {
        const title = await window.title();

        if (!title.includes('DevTools')) {
            return window;
        }
    }

    return app.firstWindow();
}

async function waitForAppReady(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('app-root', { timeout: 30000 });
    await page.waitForFunction(
        () => {
            const appRoot = document.querySelector('app-root');

            return Boolean(appRoot && appRoot.innerHTML.trim().length > 0);
        },
        { timeout: 30000 }
    );
}

export async function openAddPlaylistMenu(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
}

export async function stubNativePlaylistFileDialog(
    electronApp: ElectronApplication,
    filePath: string
): Promise<void> {
    await electronApp.evaluate(async ({ dialog }, selectedFilePath) => {
        dialog.showOpenDialog = async () =>
            ({
                canceled: false,
                filePaths: [selectedFilePath],
            }) as any;
    }, filePath);
}

export async function importM3uPlaylistFromNativeDialog(
    app: LaunchedElectronApp,
    filePath: string
): Promise<void> {
    await stubNativePlaylistFileDialog(app.electronApp, filePath);
    await openAddPlaylistMenu(app.mainWindow);
    await app.mainWindow
        .getByRole('menuitem', { name: 'Add via file upload' })
        .click();
    await app.mainWindow.locator('mat-dialog-container .file-upload').click();
    await app.mainWindow.waitForSelector('mat-dialog-container', {
        state: 'detached',
    });
}

export async function addXtreamPortal(
    page: Page,
    options: {
        name?: string;
        password?: string;
        serverUrl?: string;
        username?: string;
    } = {}
): Promise<void> {
    const {
        name = defaultXtreamPortalName,
        password = defaultXtreamPassword,
        serverUrl = xtreamMockServer,
        username = defaultXtreamUsername,
    } = options;

    await openAddPlaylistMenu(page);
    await page.getByRole('menuitem', { name: 'Add Xtreme Code' }).click();
    const dialog = page.locator('mat-dialog-container');

    await setInputValue(dialog.locator('#title'), name);
    await setInputValue(dialog.locator('#serverUrl'), serverUrl);
    await setInputValue(dialog.locator('#username'), username);
    await setInputValue(dialog.locator('#password'), password);
    const addButton = dialog.getByRole('button', { name: 'Add', exact: true });

    await expect(addButton).toBeEnabled({ timeout: 10000 });
    await addButton.click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

async function setInputValue(input: Locator, value: string): Promise<void> {
    await input.fill('');
    await input.fill(value);

    if ((await input.inputValue()) === value) {
        return;
    }

    await input.click();
    await input.press('Control+A');
    await input.press('Backspace');
    await input.type(value);

    if ((await input.inputValue()) === value) {
        return;
    }

    await input.evaluate((element, nextValue) => {
        const inputElement = element as HTMLInputElement;
        inputElement.value = nextValue;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
    }, value);

    await expect(input).toHaveValue(value);
}

export async function addStalkerPortal(
    page: Page,
    options: {
        macAddress?: string;
        name?: string;
        portalUrl?: string;
    } = {}
): Promise<void> {
    const {
        macAddress = defaultStalkerMacAddress,
        name = defaultStalkerPortalName,
        portalUrl = `${stalkerMockServer}/portal.php`,
    } = options;

    await openAddPlaylistMenu(page);
    await page.getByRole('menuitem', { name: 'Add Stalker Portal' }).click();
    const dialog = page.locator('mat-dialog-container');

    await dialog.locator('#title').fill(name);
    await dialog.locator('#portalUrl').fill(portalUrl);
    await dialog.locator('#macAddress').fill(macAddress);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

export async function openSettings(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Open settings' }).click();
    await expect(page.getByTestId('settings-container')).toBeVisible();
}

export async function enableRemoteControl(
    page: Page,
    port: number
): Promise<void> {
    const remoteControlCheckbox = page.locator(
        'mat-checkbox[formcontrolname="remoteControl"] input[type="checkbox"]'
    );

    await remoteControlCheckbox.scrollIntoViewIfNeeded();
    await remoteControlCheckbox.check();
    await page.locator('#remoteControlPort').fill(String(port));
}

export async function saveSettings(page: Page): Promise<void> {
    await page.getByTestId('save-settings').click();
    await expect(
        page.getByText('Success! Configuration was saved.')
    ).toBeVisible();
}

export async function goToDashboard(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.waitForURL(/\/workspace\/dashboard$/);
}

export async function waitForM3uCatalog(page: Page): Promise<void> {
    await page.waitForURL(/\/workspace\/playlists\/.+\/all$/);
    await expect(page.getByTestId('channel-item').first()).toBeVisible({
        timeout: 20000,
    });
}

export async function waitForXtreamCatalog(page: Page): Promise<void> {
    await page.waitForURL(/\/workspace\/xtreams\/.+/);
    await waitForXtreamImportToFinish(page);

    const categories = page.locator(
        'app-workspace-context-panel .category-item'
    );
    await expect(categories.first()).toBeVisible({ timeout: 20000 });

    const contentItems = page.locator(
        '.content-card, [data-test-id="channel-item"], mat-card'
    );

    try {
        await expect(contentItems.first()).toBeVisible({ timeout: 5000 });
        return;
    } catch {
        await categories.first().click();
        await expect(contentItems.first()).toBeVisible({ timeout: 20000 });
    }
}

export async function waitForXtreamImportToFinish(page: Page): Promise<void> {
    const overlay = page.locator('.workspace-loading-overlay');

    try {
        await overlay.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
        // The overlay may already be gone by the time the test reaches this point.
    }

    await expect(overlay).toHaveCount(0, { timeout: 30000 });
}

export async function waitForStalkerCatalog(page: Page): Promise<void> {
    await page.waitForURL(/\/workspace\/stalker\/.+/);

    const categories = page.locator('.category-item');
    await expect(categories.first()).toBeVisible({ timeout: 20000 });
    await categories.first().click();

    const contentItems = page.locator(
        '.content-card, [data-test-id="channel-item"], mat-card'
    );
    await expect(contentItems.first()).toBeVisible({ timeout: 20000 });
}

export async function fillWorkspaceSearch(
    page: Page,
    term: string,
    options: {
        submit?: boolean;
    } = {}
): Promise<void> {
    const input = page.locator(
        'app-workspace-shell-header .search-field input[type="search"]'
    );

    await expect(input).toBeEnabled();
    await input.fill(term);

    if (options.submit) {
        await input.press('Enter');
    }
}

export async function expectWorkspaceSearchScope(
    page: Page,
    expected: RegExp | string
): Promise<void> {
    await expect(
        page.locator('app-workspace-shell-header .search-chip--scope')
    ).toHaveText(expected);
}

export async function expectWorkspaceSearchStatus(
    page: Page,
    expected: RegExp | string
): Promise<void> {
    await expect(
        page.locator('app-workspace-shell-header .search-chip--status')
    ).toHaveText(expected);
}

async function startPortalDebugCapture(page: Page): Promise<void> {
    await page.evaluate(() => {
        const electronApi = window.electron as typeof window.electron & {
            onPortalDebugEvent?: (
                callback: (event: PortalDebugEvent) => void
            ) => (() => void) | undefined;
        };

        window.__portalDebugUnsubscribe?.();
        window.__portalDebugEvents = [];

        if (!electronApi.onPortalDebugEvent) {
            return;
        }

        window.__portalDebugUnsubscribe = electronApi.onPortalDebugEvent(
            (event: PortalDebugEvent) => {
                window.__portalDebugEvents?.push(event as PortalDebugEvent);
            }
        );
    });
}

async function startDbOperationCapture(page: Page): Promise<void> {
    await page.evaluate(() => {
        const electronApi = window.electron as typeof window.electron & {
            onDbOperationEvent?: (
                callback: (event: DbOperationEvent) => void
            ) => (() => void) | undefined;
        };

        window.__dbOperationUnsubscribe?.();
        window.__dbOperationEvents = [];

        if (!electronApi.onDbOperationEvent) {
            return;
        }

        window.__dbOperationUnsubscribe = electronApi.onDbOperationEvent(
            (event: DbOperationEvent) => {
                window.__dbOperationEvents?.push(event);
            }
        );
    });
}

async function startRendererFrameCapture(page: Page): Promise<void> {
    await page.evaluate(() => {
        if (window.__rendererFrameRequestId) {
            window.cancelAnimationFrame(window.__rendererFrameRequestId);
        }

        window.__rendererFrameCount = 0;

        const tick = () => {
            window.__rendererFrameCount =
                (window.__rendererFrameCount ?? 0) + 1;
            window.__rendererFrameRequestId = window.requestAnimationFrame(
                tick
            );
        };

        window.__rendererFrameRequestId = window.requestAnimationFrame(tick);
    });
}

export async function expectPortalDebugSuccess(
    page: Page,
    provider: PortalProvider
): Promise<void> {
    await expect
        .poll(
            async () => {
                return page.evaluate((targetProvider) => {
                    return (
                        window.__portalDebugEvents?.filter(
                            (event) =>
                                event.provider === targetProvider &&
                                event.status === 'success' &&
                                event.transport === 'electron-main'
                        ).length ?? 0
                    );
                }, provider);
            },
            { timeout: 20000 }
        )
        .toBeGreaterThan(0);
}

export async function waitForPortalDebugEvent(
    page: Page,
    options: {
        operation: string;
        predicate?: (event: PortalDebugEvent) => boolean;
        provider: PortalProvider;
        timeoutMs?: number;
    }
): Promise<PortalDebugEvent> {
    const {
        operation,
        predicate,
        provider,
        timeoutMs = 20000,
    } = options;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
        const events = await page.evaluate(() => window.__portalDebugEvents ?? []);
        const match = events.find((event) => {
            if (
                event.provider !== provider ||
                event.operation !== operation ||
                event.status !== 'success' ||
                event.transport !== 'electron-main'
            ) {
                return false;
            }

            return predicate ? predicate(event) : true;
        });

        if (match) {
            return match;
        }

        await page.waitForTimeout(200);
    }

    const recentEvents = await page.evaluate(() =>
        (window.__portalDebugEvents ?? []).slice(-10)
    );

    throw new Error(
        `Timed out waiting for ${provider}:${operation}. Recent events: ${JSON.stringify(
            recentEvents,
            null,
            2
        )}`
    );
}

export async function waitForDbOperationEvent(
    page: Page,
    options: {
        operation: string;
        operationId?: string;
        phase?: string;
        playlistId?: string;
        predicate?: (event: DbOperationEvent) => boolean;
        status?: DbOperationEvent['status'];
        timeoutMs?: number;
    }
): Promise<DbOperationEvent> {
    const {
        operation,
        operationId,
        phase,
        playlistId,
        predicate,
        status,
        timeoutMs = 20000,
    } = options;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
        const events = await page.evaluate(() => window.__dbOperationEvents ?? []);
        const match = events.find((event) => {
            if (event.operation !== operation) {
                return false;
            }

            if (operationId && event.operationId !== operationId) {
                return false;
            }

            if (status && event.status !== status) {
                return false;
            }

            if (phase && event.phase !== phase) {
                return false;
            }

            if (playlistId && event.playlistId !== playlistId) {
                return false;
            }

            return predicate ? predicate(event) : true;
        });

        if (match) {
            return match;
        }

        await page.waitForTimeout(200);
    }

    const recentEvents = await page.evaluate(() =>
        (window.__dbOperationEvents ?? []).slice(-20)
    );

    throw new Error(
        `Timed out waiting for DB event ${operation}. Recent events: ${JSON.stringify(
            recentEvents,
            null,
            2
        )}`
    );
}

export async function getRendererFrameCount(page: Page): Promise<number> {
    return page.evaluate(() => window.__rendererFrameCount ?? 0);
}

export async function expectRendererFramesAdvance(
    page: Page,
    options: {
        minimumDelta?: number;
        sampleMs?: number;
    } = {}
): Promise<void> {
    const {
        minimumDelta = 4,
        sampleMs = 300,
    } = options;
    const startCount = await getRendererFrameCount(page);

    await page.waitForTimeout(sampleMs);

    await expect
        .poll(async () => (await getRendererFrameCount(page)) - startCount, {
            timeout: sampleMs + 1500,
        })
        .toBeGreaterThanOrEqual(minimumDelta);
}

export async function resetMockServers(
    request: APIRequestContext,
    providers: PortalProvider[]
): Promise<void> {
    for (const provider of providers) {
        const server =
            provider === 'stalker' ? stalkerMockServer : xtreamMockServer;
        const response = await request.post(`${server}/reset`);
        expect(response.ok()).toBeTruthy();
    }
}
