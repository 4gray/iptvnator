import {
    _electron as electron,
    APIRequestContext,
    ElectronApplication,
    expect,
    Locator,
    Page,
    test as base,
} from '@playwright/test';
import { createServer, Server } from 'http';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export const workspaceRoot = resolve(__dirname, '../../..');
export const electronMainPath = join(
    workspaceRoot,
    'dist/apps/electron-backend/main.js'
);
export const packagedRendererIndexPath = join(
    workspaceRoot,
    'dist/apps/web/index.html'
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

export type M3uTestChannel = {
    groupTitle?: string;
    logo?: string;
    name: string;
    tvgId?: string;
    tvgName?: string;
    url: string;
};

export type MutableTextServer = {
    close: () => Promise<void>;
    origin: string;
    resourceUrl: string;
    setBody: (body: string) => void;
};

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
    assertPackagedRendererBuildIsElectronSafe();

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

function assertPackagedRendererBuildIsElectronSafe(): void {
    if (!existsSync(packagedRendererIndexPath)) {
        throw new Error(
            `Renderer build not found at ${packagedRendererIndexPath}. Run pnpm nx run electron-backend:build-e2e before executing the Electron E2E suite.`
        );
    }

    const indexHtml = readFileSync(packagedRendererIndexPath, 'utf8');
    const baseHrefMatch = indexHtml.match(/<base\s+href="([^"]*)"/i);
    const baseHref = baseHrefMatch?.[1] ?? '<missing>';

    if (baseHref !== './') {
        throw new Error(
            `Renderer build at ${packagedRendererIndexPath} is not file-safe for packaged Electron. Found base href ${JSON.stringify(baseHref)}. Run pnpm nx run electron-backend:build-e2e or use an Electron E2E Nx target so dist/apps/web is rebuilt with the electron-e2e configuration.`
        );
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
    try {
        await page.waitForFunction(
            () => {
                const appRoot = document.querySelector('app-root');

                return Boolean(appRoot && appRoot.innerHTML.trim().length > 0);
            },
            { timeout: 30000 }
        );
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            appRootLength:
                document.querySelector('app-root')?.innerHTML.trim().length ?? 0,
            baseHref:
                document
                    .querySelector('base')
                    ?.getAttribute('href') ?? '<missing>',
            readyState: document.readyState,
            title: document.title,
            url: location.href,
        }));

        const reason =
            error instanceof Error ? error.message : 'unknown startup error';

        throw new Error(
            `Electron app did not render visible app-root within 30000ms. ${reason}. Diagnostics: ${JSON.stringify(
                diagnostics
            )}`
        );
    }
}

export async function openAddPlaylistDialog(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    await expect(page.locator('mat-dialog-container').last()).toBeVisible();
}

async function getActiveDialog(page: Page): Promise<Locator> {
    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog).toBeVisible();
    return dialog;
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
    await openAddPlaylistDialog(app.mainWindow);
    const dialog = await getActiveDialog(app.mainWindow);
    await clickDialogCategoryOption(dialog, /^m3u$/i);
    await clickDialogSubtypeOption(
        dialog,
        /add\s+via\s+file\s+upload/i,
        'mat-button-toggle[value="file"]'
    );
    await dialog
        .locator('input[type="file"][name="playlist"]')
        .setInputFiles(filePath);
    await expect(
        dialog.getByRole('button', { name: /add playlist/i })
    ).toBeEnabled({ timeout: 10000 });
    await dialog.getByRole('button', { name: /add playlist/i }).click();
    await dialog.waitFor({ state: 'detached' });
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

    await openAddPlaylistDialog(page);
    const dialog = await getActiveDialog(page);
    await clickDialogCategoryOption(
        dialog,
        /^xtream$/i,
        'mat-button-toggle[value="xtream"]'
    );

    await setInputValue(dialog.locator('#title'), name);
    await setInputValue(dialog.locator('#serverUrl'), serverUrl);
    await setInputValue(dialog.locator('#username'), username);
    await setInputValue(dialog.locator('#password'), password);
    const addButton = dialog
        .getByRole('button', { name: /^(add|add playlist)$/i })
        .last();

    await expect(addButton).toBeEnabled({ timeout: 10000 });
    await addButton.click();
    await dialog.waitFor({ state: 'detached' });
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

async function clickDialogCategoryOption(
    dialog: Locator,
    label: RegExp,
    legacySelector?: string
): Promise<void> {
    await clickDialogSegmentedOption(
        dialog,
        'Playlist category',
        label,
        legacySelector
    );
}

async function clickDialogSubtypeOption(
    dialog: Locator,
    label: RegExp,
    legacySelector?: string
): Promise<void> {
    await clickDialogSegmentedOption(
        dialog,
        'M3U source',
        label,
        legacySelector
    );
}

async function clickDialogSegmentedOption(
    dialog: Locator,
    tablistLabel: string,
    label: RegExp,
    legacySelector?: string
): Promise<void> {
    const tablist = dialog
        .locator(`[role="tablist"][aria-label="${tablistLabel}"]`)
        .first();

    if ((await tablist.count()) > 0) {
        const optionByTabRole = tablist
            .getByRole('tab', { name: label })
            .first();

        if ((await optionByTabRole.count()) > 0) {
            await optionByTabRole.click();
            return;
        }
    }

    const optionByGlobalTabRole = dialog
        .getByRole('tab', { name: label })
        .first();

    if ((await optionByGlobalTabRole.count()) > 0) {
        await optionByGlobalTabRole.click();
        return;
    }

    const optionByButtonRole = dialog
        .getByRole('button', { name: label })
        .first();

    if ((await optionByButtonRole.count()) > 0) {
        await optionByButtonRole.click();
        return;
    }

    if (!legacySelector) {
        throw new Error(
            `Could not find dialog option matching ${label} in "${tablistLabel}".`
        );
    }

    await dialog.locator(legacySelector).click();
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

    await openAddPlaylistDialog(page);
    const dialog = await getActiveDialog(page);
    await clickDialogCategoryOption(
        dialog,
        /^stalker$/i,
        'mat-button-toggle[value="stalker"]'
    );

    await setInputValue(dialog.locator('input#title'), name);
    await setInputValue(dialog.locator('input#portalUrl'), portalUrl);
    await setInputValue(dialog.locator('input#macAddress'), macAddress);
    const addButton = dialog
        .getByRole('button', { name: /^(add|add playlist)$/i })
        .last();

    await expect(addButton).toBeEnabled({ timeout: 10000 });
    await addButton.click();
    await dialog.waitFor({ state: 'detached' });
}

export async function openSettings(page: Page): Promise<void> {
    await page.locator('a[href$="/workspace/settings"]').click();
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
    const saveButton = page.getByTestId('save-settings');

    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await page.waitForTimeout(300);
}

export async function goToDashboard(page: Page): Promise<void> {
    const dashboardLink = page
        .locator('a.brand[href$="/workspace/dashboard"]')
        .first();

    await expect(dashboardLink).toBeVisible();
    await dashboardLink.click();
    await page.waitForURL(/\/workspace\/dashboard$/);
}

export async function openSources(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page.waitForURL(/\/workspace\/sources(?:\?.*)?$/);
}

export async function restartElectronApp(
    app: LaunchedElectronApp,
    dataDir: string,
    options: LaunchElectronAppOptions = {}
): Promise<LaunchedElectronApp> {
    await closeElectronApp(app);
    return launchElectronApp(dataDir, options);
}

export async function importM3uPlaylistFromUrl(
    page: Page,
    playlistUrl: string
): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = await getActiveDialog(page);
    await clickDialogCategoryOption(dialog, /^m3u$/i);
    await clickDialogSubtypeOption(
        dialog,
        /add\s+via\s+url/i,
        'mat-button-toggle[value="url"]'
    );

    await setInputValue(
        dialog.locator('input[formcontrolname="playlistUrl"]'),
        playlistUrl
    );
    await dialog.getByRole('button', { name: /Add playlist/i }).click();
    await dialog.waitFor({ state: 'detached' });
}

export function buildM3uContent(channels: M3uTestChannel[]): string {
    const lines = ['#EXTM3U'];

    for (const channel of channels) {
        const attributes = [
            channel.tvgId ? `tvg-id="${channel.tvgId}"` : '',
            channel.tvgName ? `tvg-name="${channel.tvgName}"` : '',
            channel.logo ? `tvg-logo="${channel.logo}"` : '',
            channel.groupTitle ? `group-title="${channel.groupTitle}"` : '',
        ]
            .filter(Boolean)
            .join(' ');

        lines.push(
            `#EXTINF:-1${attributes ? ` ${attributes}` : ''},${channel.name}`
        );
        lines.push(channel.url);
    }

    return `${lines.join('\n')}\n`;
}

export function writeTemporaryM3uFile(
    dataDir: string,
    fileName: string,
    channels: M3uTestChannel[]
): string {
    const filePath = join(dataDir, fileName);
    writeFileSync(filePath, buildM3uContent(channels), 'utf8');
    return filePath;
}

export function parseM3uFixture(filePath: string): M3uTestChannel[] {
    const content = readFileSync(filePath, 'utf8');
    const items: M3uTestChannel[] = [];
    const lines = content.split(/\r?\n/);
    let pending:
        | {
              groupTitle?: string;
              logo?: string;
              name: string;
              tvgId?: string;
              tvgName?: string;
          }
        | undefined;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            pending = {
                groupTitle:
                    line.match(/group-title="([^"]*)"/)?.[1]?.trim() ?? '',
                logo: line.match(/tvg-logo="([^"]*)"/)?.[1]?.trim() ?? '',
                name: line.split(',').at(-1)?.trim() ?? '',
                tvgId: line.match(/tvg-id="([^"]*)"/)?.[1]?.trim() ?? '',
                tvgName: line.match(/tvg-name="([^"]*)"/)?.[1]?.trim() ?? '',
            };
            continue;
        }

        if (!pending || line.startsWith('#')) {
            continue;
        }

        items.push({
            ...pending,
            url: line,
        });
        pending = undefined;
    }

    return items.filter((item) => item.name.length > 0);
}

export async function createMutableTextServer(
    initialBody: string,
    options: {
        contentType?: string;
        resourcePath?: string;
    } = {}
): Promise<MutableTextServer> {
    const {
        contentType = 'text/plain; charset=utf-8',
        resourcePath = '/resource.txt',
    } = options;
    let body = initialBody;

    const server = createServer((req, res) => {
        const pathname = (req.url ?? '').split('?')[0];

        if (pathname !== resourcePath) {
            res.writeHead(404, {
                'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(body);
    });

    await listenOnRandomPort(server);
    const address = server.address();

    if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve the temporary HTTP server address.');
    }

    const origin = `http://127.0.0.1:${address.port}`;

    return {
        close: () => closeServer(server),
        origin,
        resourceUrl: `${origin}${resourcePath}`,
        setBody(nextBody: string) {
            body = nextBody;
        },
    };
}

export async function openWorkspaceSection(
    page: Page,
    label: string
): Promise<void> {
    await page.getByRole('link', { name: label, exact: true }).click();
}

export async function openPlaylistFavorites(page: Page): Promise<void> {
    await openWorkspaceSection(page, 'Favorites');
    await expect
        .poll(() => new URL(page.url()).pathname)
        .toMatch(/\/favorites$/);
}

export async function openPlaylistRecent(page: Page): Promise<void> {
    await openWorkspaceSection(page, 'Recently viewed');
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/recent$/);
}

export async function openGlobalFavorites(page: Page): Promise<void> {
    await page
        .getByRole('button', {
            name: 'All favorites (all playlists)',
            exact: true,
        })
        .click();
    await page.waitForURL(/\/workspace\/global-favorites(?:\?.*)?$/);
}

export async function openGlobalRecent(page: Page): Promise<void> {
    const dialog = await openCommandPalette(page);

    await dialog.locator('input[type="search"]').fill('recent');
    await dialog.getByRole('button', { name: /Open recently viewed/i }).click();
    await page.waitForURL(/\/workspace\/global-recent(?:\?.*)?$/);
}

export async function switchUnifiedCollectionScope(
    page: Page,
    scopeLabel: 'This playlist' | 'All playlists'
): Promise<void> {
    const toggleGroup = page.locator('.scope-toggle');

    await expect(toggleGroup).toBeVisible();
    await clickButtonToggleOption(toggleGroup, scopeLabel);
}

export async function switchUnifiedCollectionContent(
    page: Page,
    contentLabel: 'Live TV' | 'Movies' | 'Series'
): Promise<void> {
    const toggleGroup = page.locator('.content-toggle');

    await expect(toggleGroup).toBeVisible();
    await clickButtonToggleOption(toggleGroup, contentLabel);
}

export async function clearCurrentUnifiedCollection(
    page: Page
): Promise<void> {
    await page
        .getByRole('button', {
            name: /Clear .* (favorites|recently viewed)/i,
        })
        .click();

    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^Yes$/i }).click();
    await expect(dialog).toBeHidden();
}

async function clickButtonToggleOption(
    toggleGroup: Locator,
    label: string
): Promise<void> {
    const toggle = toggleGroup
        .locator('mat-button-toggle')
        .filter({ hasText: flexibleTextPattern(label) })
        .first();

    await expect(toggle).toBeVisible();

    if (!(await isButtonToggleSelected(toggle))) {
        await toggle.click();
    }

    await expect
        .poll(() => isButtonToggleSelected(toggle), {
            timeout: 10000,
        })
        .toBe(true);
}

export function channelItemByTitle(page: Page, title: string): Locator {
    return page.getByTestId('channel-item').filter({
        has: page.locator('.channel-name', {
            hasText: flexibleTextPattern(title),
        }),
    });
}

export function contentCardByTitle(page: Page, title: string): Locator {
    return page.locator('app-content-card').filter({
        has: page.locator('h3', {
            hasText: flexibleTextPattern(title),
        }),
    });
}

export async function expectVisibleContentCardTitle(
    page: Page,
    title: string
): Promise<void> {
    await expect
        .poll(
            async () => {
                const titles = await visibleContentCardTitles(page);
                return titles.some(
                    (visibleTitle) =>
                        normalizeVisibleText(visibleTitle) ===
                        normalizeVisibleText(title)
                );
            },
            { timeout: 20000 }
        )
        .toBe(true);
}

export async function expectPathname(
    page: Page,
    pattern: RegExp
): Promise<void> {
    await expect.poll(() => new URL(page.url()).pathname).toMatch(pattern);
}

export function playlistSwitcherTitle(page: Page): Locator {
    return page
        .locator('.playlist-switcher-trigger .playlist-info .name')
        .first();
}

export function gridListCardByTitle(page: Page, title: string): Locator {
    return page.locator('.category-content-layout mat-card').filter({
        has: page.locator('.title', {
            hasText: flexibleTextPattern(title),
        }),
    });
}

/**
 * Waits for the first grid card to appear (skeleton loading done) and returns
 * its display title. Use this instead of picking from fixture order, since the
 * grid sorts by date-desc and may paginate items off the first page.
 */
export async function waitForFirstGridListCardTitle(
    page: Page
): Promise<string> {
    const card = page.locator('.category-content-layout mat-card').first();
    await expect(card).toBeVisible({ timeout: 20000 });
    return ((await card.locator('.title').textContent()) ?? '').trim();
}

/**
 * Waits for the first grid card to appear with a non-empty title, clicks it,
 * and returns the title. Use this instead of waitForFirstGridListCardTitle +
 * clickGridListCardByTitle to avoid a race condition where the grid re-renders
 * between the title read and the subsequent search-by-title click.
 */
export async function clickFirstGridListCard(page: Page): Promise<string> {
    const card = page.locator('.category-content-layout mat-card').first();
    await expect(card).toBeVisible({ timeout: 20000 });
    const titleEl = card.locator('.title');
    let title = '';
    await expect(async () => {
        title = ((await titleEl.textContent()) ?? '').trim();
        expect(title.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
    await card.click();
    return title;
}

export async function clickGridListCardByTitle(
    page: Page,
    title: string
): Promise<void> {
    const card = gridListCardByTitle(page, title).first();

    await expect(card).toBeVisible({ timeout: 20000 });
    await card.click();
}

export async function clickCategoryById(
    page: Page,
    categoryId: string
): Promise<void> {
    const category = page.locator(
        `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]:visible`
    );

    await expect(category.first()).toBeVisible({ timeout: 20000 });
    await category.first().scrollIntoViewIfNeeded();
    await category.first().click();
    await expect
        .poll(async () => {
            const pathname = new URL(page.url()).pathname;
            const isSelected =
                (await category.first().getAttribute('aria-current')) ===
                'true';

            return (
                isSelected ||
                pathname.endsWith(`/${categoryId}`) ||
                pathname.includes(`/${categoryId}/`)
            );
        })
        .toBe(true);
}

export async function clickCategoryByNameExact(
    page: Page,
    categoryName: string
): Promise<void> {
    const categories = page
        .locator('app-workspace-context-panel .category-item:visible')
        .filter({
            has: page.locator('.nav-item-label', {
                hasText: new RegExp(`^\\s*${escapeRegex(categoryName)}\\s*$`),
            }),
        });
    const category = await pickPreferredCategory(categories);

    await expect(category).toBeVisible();
    await category.scrollIntoViewIfNeeded();
    const categoryId =
        (await category.getAttribute('data-category-id'))?.trim() ?? '';
    await category.click();
    await expect
        .poll(async () => {
            const pathname = new URL(page.url()).pathname;
            const isSelected =
                (await category.getAttribute('aria-current')) === 'true';

            return (
                isSelected ||
                (categoryId.length > 0 &&
                    (pathname.endsWith(`/${categoryId}`) ||
                        pathname.includes(`/${categoryId}/`)))
            );
        })
        .toBe(true);
}

export function sourceRowByTitle(page: Page, title: string): Locator {
    return page.locator('app-playlist-item').filter({
        hasText: flexibleTextPattern(title),
    });
}

export async function getVisibleSourceTitles(page: Page): Promise<string[]> {
    return page.locator('app-playlist-item').evaluateAll((elements) =>
        elements
            .map((element) => {
                const titleElement = element.querySelector('.playlist-title');
                return titleElement?.textContent?.trim() ?? '';
            })
            .filter((title) => title.length > 0)
    );
}

export async function selectSourceTypeFilter(
    page: Page,
    typeLabel: 'All' | 'M3U' | 'Xtream' | 'Stalker'
): Promise<void> {
    await selectSourcesTypeFilterOption(page, typeLabel);
}

export async function selectSourceSort(
    page: Page,
    sortLabel:
        | 'Date added (Newest first)'
        | 'Date added (Oldest first)'
        | 'Name (A-Z)'
        | 'Name (Z-A)'
        | 'Custom order'
): Promise<void> {
    const sortTrigger = page.locator('app-workspace-sources .sort-trigger');

    await expect(sortTrigger).toBeVisible();
    await sortTrigger.click();

    const option = page
        .locator('.cdk-overlay-pane [role="menuitem"]')
        .filter({
            hasText: flexibleTextPattern(sortLabel),
        })
        .first();

    await expect(option).toBeVisible();
    await option.click();
    await expect(option).toBeHidden();
}

export async function dragSourceBefore(
    page: Page,
    sourceTitle: string,
    targetTitle: string
): Promise<void> {
    const source = sourceRowByTitle(page, sourceTitle).locator('.drag-icon');
    const target = sourceRowByTitle(page, targetTitle).locator(
        '.playlist-item'
    );

    await expect(source.first()).toBeVisible();
    await expect(target.first()).toBeVisible();

    const sourceBox = await source.first().boundingBox();
    const targetBox = await target.first().boundingBox();

    if (!sourceBox || !targetBox) {
        throw new Error('Could not resolve source or target bounds for drag.');
    }

    await page.mouse.move(
        sourceBox.x + sourceBox.width / 2,
        sourceBox.y + sourceBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 3,
        {
            steps: 15,
        }
    );
    await page.mouse.up();
}

export async function openSourceEditor(
    page: Page,
    title: string
): Promise<Locator> {
    const row = sourceRowByTitle(page, title).first();

    await expect(row).toBeVisible();
    await row.locator('.edit-btn').click();
    const dialog = page.locator('mat-dialog-container').last();

    await expect(dialog).toBeVisible();
    return dialog;
}

export async function updateSourceDialog(
    dialog: Locator,
    updates: Partial<
        Record<
            | 'macAddress'
            | 'password'
            | 'portalUrl'
            | 'serverUrl'
            | 'stalkerDeviceId1'
            | 'stalkerDeviceId2'
            | 'stalkerSerialNumber'
            | 'stalkerSignature1'
            | 'stalkerSignature2'
            | 'title'
            | 'url'
            | 'userAgent'
            | 'username',
            string
        > & {
            autoRefresh: boolean;
        }
    >
): Promise<void> {
    for (const [field, value] of Object.entries(updates)) {
        if (field === 'autoRefresh' || value == null) {
            continue;
        }

        await setInputValue(
            dialog.locator(`input[formcontrolname="${field}"]`),
            value as string
        );
    }

    if (typeof updates.autoRefresh === 'boolean') {
        const checkbox = dialog.locator(
            'mat-checkbox[formcontrolname="autoRefresh"] input[type="checkbox"]'
        );

        if (updates.autoRefresh) {
            await checkbox.check();
        } else {
            await checkbox.uncheck();
        }
    }
}

export async function saveSourceDialog(
    page: Page,
    dialog: Locator
): Promise<void> {
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
    await expectPlaylistUpdatedToast(page);
}

export async function expectSourceDialogValues(
    dialog: Locator,
    expected: Partial<
        Record<
            | 'macAddress'
            | 'password'
            | 'portalUrl'
            | 'serverUrl'
            | 'stalkerDeviceId1'
            | 'stalkerDeviceId2'
            | 'stalkerSerialNumber'
            | 'stalkerSignature1'
            | 'stalkerSignature2'
            | 'title'
            | 'url'
            | 'userAgent'
            | 'username',
            string
        > & {
            autoRefresh: boolean;
        }
    >
): Promise<void> {
    for (const [field, value] of Object.entries(expected)) {
        if (field === 'autoRefresh' || value == null) {
            continue;
        }

        await expect(
            dialog.locator(`input[formcontrolname="${field}"]`)
        ).toHaveValue(value as string);
    }

    if (typeof expected.autoRefresh === 'boolean') {
        const checkbox = dialog.locator(
            'mat-checkbox[formcontrolname="autoRefresh"] input[type="checkbox"]'
        );

        if (expected.autoRefresh) {
            await expect(checkbox).toBeChecked();
        } else {
            await expect(checkbox).not.toBeChecked();
        }
    }
}

export async function deleteSource(page: Page, title: string): Promise<void> {
    const row = sourceRowByTitle(page, title).first();

    await expect(row).toBeVisible();
    await row.locator('.delete-btn').click();
    await confirmDialog(page);
}

export async function refreshSource(
    page: Page,
    title: string,
    options: {
        confirm?: boolean;
    } = {}
): Promise<void> {
    const { confirm = false } = options;
    const row = sourceRowByTitle(page, title).first();

    await expect(row).toBeVisible();
    await row.locator('.refresh-btn').click();

    if (confirm) {
        await confirmDialog(page);
    }
}

export async function waitForSourceRowIdle(
    page: Page,
    title: string
): Promise<void> {
    const row = sourceRowByTitle(page, title).first();

    await expect(row).toBeVisible();
    await expect(row.locator('.busy-state__message')).toHaveCount(0, {
        timeout: 60000,
    });
    await expect(row.locator('.action-spinner')).toHaveCount(0, {
        timeout: 60000,
    });
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
        const category = await pickPreferredCategory(categories);
        await category.scrollIntoViewIfNeeded();
        await category.click();
        await expect(contentItems.first()).toBeVisible({ timeout: 20000 });
    }
}

export async function waitForXtreamWorkspaceReady(page: Page): Promise<void> {
    await waitForXtreamCatalog(page);
}

export async function expectPlaylistUpdatedToast(page: Page): Promise<void> {
    await expect(
        page
            .locator('.mat-mdc-snack-bar-label')
            .filter({
                hasText: 'Success! The playlist was successfully updated.',
            })
            .last()
    ).toBeVisible({
        timeout: 20000,
    });
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

async function pickPreferredCategory(categories: Locator): Promise<Locator> {
    const count = await categories.count();
    let fallback: Locator | null = null;

    for (let index = 0; index < count; index += 1) {
        const candidate = categories.nth(index);

        if (!(await candidate.isVisible())) {
            continue;
        }

        fallback ??= candidate;

        const countText =
            (await candidate.locator('.item-count').first().textContent()) ??
            '';
        const itemCount = Number.parseInt(countText.trim(), 10);

        if (Number.isFinite(itemCount) && itemCount > 0) {
            return candidate;
        }
    }

    return fallback ?? categories.first();
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
            window.__rendererFrameRequestId =
                window.requestAnimationFrame(tick);
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
    const { operation, predicate, provider, timeoutMs = 20000 } = options;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
        const events = await page.evaluate(
            () => window.__portalDebugEvents ?? []
        );
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
        const events = await page.evaluate(
            () => window.__dbOperationEvents ?? []
        );
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
    const { minimumDelta = 4, sampleMs = 300 } = options;
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

async function openCommandPalette(page: Page): Promise<Locator> {
    await page.locator('app-workspace-shell-header .command-trigger').click();
    const dialog = page.locator(
        'mat-dialog-container app-workspace-command-palette'
    );

    await expect(dialog).toBeVisible();
    return dialog;
}

async function confirmDialog(page: Page, buttonLabel = 'Yes'): Promise<void> {
    const dialog = page.locator('mat-dialog-container');

    await expect(dialog).toBeVisible();
    await dialog
        .getByRole('button', { name: buttonLabel, exact: true })
        .click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

async function selectSourcesTypeFilterOption(
    page: Page,
    label: string
): Promise<void> {
    const option = page
        .locator('app-workspace-sources-filters-panel .option-row')
        .filter({
            has: page.locator('.option-label', {
                hasText: flexibleTextPattern(label),
            }),
        })
        .first();

    await expect(option).toBeVisible();
    await option.click();
}

async function listenOnRandomPort(server: Server): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolvePromise();
        });
    });
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolvePromise();
        });
    });
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleTextPattern(value: string): RegExp {
    return new RegExp(
        value
            .trim()
            .split(/\s+/)
            .map((part) => escapeRegex(part))
            .join('\\s+'),
        'i'
    );
}

async function isButtonToggleSelected(toggle: Locator): Promise<boolean> {
    try {
        return await toggle.evaluate((element) => {
            const host = element as HTMLElement;
            const selectedDescendant = host.querySelector(
                '[aria-checked="true"], [aria-pressed="true"]'
            );

            return (
                host.classList.contains('mat-button-toggle-checked') ||
                host.getAttribute('aria-checked') === 'true' ||
                host.getAttribute('aria-pressed') === 'true' ||
                selectedDescendant !== null
            );
        });
    } catch {
        return false;
    }
}

async function visibleContentCardTitles(page: Page): Promise<string[]> {
    return page
        .locator('app-content-card h3')
        .allInnerTexts()
        .then((titles) => titles.map((title) => title.trim()).filter(Boolean));
}

function normalizeVisibleText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
