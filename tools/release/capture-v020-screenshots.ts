import { spawn, type ChildProcess } from 'node:child_process';
import {
    accessSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
    _electron as electron,
    type ElectronApplication,
    type Page,
} from '@playwright/test';

type ThemeName = 'dark' | 'light';
type ScreenshotSlug =
    | 'dashboard'
    | 'm3u-live-groups-two-column'
    | 'settings'
    | 'xtream-series-season-open'
    | 'xtream-vod-details';

type CaptureTarget = {
    slug: ScreenshotSlug;
    title: string;
    kicker: string;
};

const workspaceRoot = process.cwd();
const electronMainPath = path.join(
    workspaceRoot,
    'dist/apps/electron-backend/main.js'
);
const rendererIndexPath = path.join(workspaceRoot, 'dist/apps/web/index.html');
const xtreamMockOrigin = 'http://localhost:3211';
const outputRoot = path.join(
    workspaceRoot,
    'apps/website/public/blog/v0-20/screenshots'
);
const heroOutputPath = path.join(
    workspaceRoot,
    'apps/website/public/blog/v0-20/v0-20-hero.png'
);
const viewport = { width: 1280, height: 720 };
const captureTargets: CaptureTarget[] = [
    {
        slug: 'dashboard',
        title: 'Content-first dashboard',
        kicker: 'New in v0.20',
    },
    {
        slug: 'xtream-vod-details',
        title: 'Richer movie details',
        kicker: 'Xtream',
    },
    {
        slug: 'xtream-series-season-open',
        title: 'Series seasons and episodes',
        kicker: 'Xtream',
    },
    {
        slug: 'settings',
        title: 'Reworked settings',
        kicker: 'Customization',
    },
    {
        slug: 'm3u-live-groups-two-column',
        title: 'Two-column live TV',
        kicker: 'M3U',
    },
];
let capturedM3uPlaylistId: string | undefined;
let capturedXtreamPlaylistId: string | undefined;

async function main(): Promise<void> {
    assertBuiltRuntimeExists();

    mkdirSync(outputRoot, { recursive: true });
    const managedMockServer = await ensureXtreamMockServer();
    const dataDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-v020-shots-'));
    const m3uFixturePath = writeM3uPlaylistFixture(dataDir);
    let app: ElectronApplication | undefined;

    try {
        app = await launchApp(dataDir);
        const page = await findMainWindow(app);
        await sizeElectronWindow(app);
        await waitForAppReady(page);
        await seedDemoData(page, m3uFixturePath);

        for (const theme of ['dark', 'light'] as ThemeName[]) {
            await applyTheme(page, theme);
            await captureThemeSet(page, theme);
        }

        await createHeroImage(page);
        await verifyExpectedAssets();
    } finally {
        await app?.close().catch(() => undefined);
        managedMockServer?.kill('SIGTERM');
        rmSync(dataDir, { recursive: true, force: true });
    }
}

function assertBuiltRuntimeExists(): void {
    if (!fileExists(electronMainPath) || !fileExists(rendererIndexPath)) {
        throw new Error(
            [
                'Electron E2E runtime is missing.',
                `Expected ${electronMainPath}`,
                `Expected ${rendererIndexPath}`,
                'Build it first, for example: pnpm nx run electron-backend:build-e2e',
            ].join('\n')
        );
    }
}

async function ensureXtreamMockServer(): Promise<ChildProcess | undefined> {
    if (await isHealthy(`${xtreamMockOrigin}/health`)) {
        return undefined;
    }

    const child = spawn(
        path.join(workspaceRoot, 'node_modules/.bin/tsx'),
        [
            '--tsconfig',
            'tsconfig.base.json',
            'apps/xtream-mock-server/src/main.ts',
        ],
        {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                NODE_ENV: 'development',
                PORT: '3211',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    child.stdout?.on('data', (chunk) => {
        process.stdout.write(`[xtream-mock] ${chunk}`);
    });
    child.stderr?.on('data', (chunk) => {
        process.stderr.write(`[xtream-mock] ${chunk}`);
    });

    await waitForHealthy(`${xtreamMockOrigin}/health`, 20_000);
    return child;
}

function buildM3uPlaylist(): string {
    const channels = [
        ['Newsroom', 'Aurora Local', 'aurora-local'],
        ['Newsroom', 'Civic Pulse', 'civic-pulse'],
        ['Sports', 'Fieldside One', 'fieldside-one'],
        ['Sports', 'Motion Arena', 'motion-arena'],
        ['Kids', 'Horizon Kids', 'horizon-kids'],
        ['Kids', 'Story Lantern', 'story-lantern'],
        ['Culture', 'Atlas Culture', 'atlas-culture'],
        ['Culture', 'Night Music', 'night-music'],
    ];
    const stream = `${xtreamMockOrigin}/live/marketing/marketing/52000.m3u8`;
    const lines = ['#EXTM3U'];

    channels.forEach(([group, title, slug], index) => {
        lines.push(
            `#EXTINF:-1 tvg-id="demo-${index + 1}" tvg-name="${title}" tvg-logo="${xtreamMockOrigin}/assets/marketing/logo/${slug}.svg?size=256x256" group-title="${group}",${title}`
        );
        lines.push(stream);
    });

    return `${lines.join('\n')}\n`;
}

function writeM3uPlaylistFixture(dataDir: string): string {
    const filePath = path.join(dataDir, 'v020-demo.m3u');
    writeFileSync(filePath, buildM3uPlaylist(), 'utf8');
    return filePath;
}

function marketingAssetUrl(
    kind: 'backdrop' | 'episode' | 'logo' | 'poster' | 'season',
    title: string,
    size: string
): string {
    return `${xtreamMockOrigin}/assets/marketing/${kind}/${slugifyForFile(
        title
    )}.svg?size=${encodeURIComponent(size)}`;
}

async function launchApp(dataDir: string): Promise<ElectronApplication> {
    return electron.launch({
        args: [electronMainPath],
        env: {
            ...process.env,
            ELECTRON_IS_DEV: '0',
            IPTVNATOR_E2E_DATA_DIR: dataDir,
            NODE_ENV: 'test',
        },
    });
}

async function findMainWindow(app: ElectronApplication): Promise<Page> {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    for (const candidate of app.windows()) {
        const title = await candidate.title();
        if (!title.includes('DevTools')) {
            return candidate;
        }
    }

    return app.firstWindow();
}

async function sizeElectronWindow(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.webContents.getTitle().includes('DevTools')
        );
        win?.setSize(size.width, size.height);
        win?.center();
    }, viewport);
}

async function waitForAppReady(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('app-root', { timeout: 45_000 });
    await page.waitForFunction(
        () => (document.querySelector('app-root')?.innerHTML.trim().length ?? 0) > 0,
        { timeout: 45_000 }
    );
}

async function seedDemoData(page: Page, m3uPath: string): Promise<void> {
    await addXtreamPortal(page);
    await addM3uPlaylist(page, m3uPath);
    await seedDashboardActivity(page);
}

async function addXtreamPortal(page: Page): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /^xtream$/i);
    await dialog.locator('#title').fill('v0.20 Fictional Xtream');
    await dialog.locator('#serverUrl').fill(xtreamMockOrigin);
    await dialog.locator('#username').fill('marketing');
    await dialog.locator('#password').fill('marketing');
    await dialog.getByRole('button', { name: /^(add|add playlist)$/i }).last().click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod/, {
        timeout: 45_000,
    });
    capturedXtreamPlaylistId = playlistIdFromUrl(page.url(), 'xtreams');
    await page.locator('.category-content-layout, app-content-card').first().waitFor({
        state: 'visible',
        timeout: 45_000,
    });
}

async function addM3uPlaylist(page: Page, m3uPath: string): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /^m3u$/i);
    await clickDialogOption(dialog, /add\s+via\s+file\s+upload/i);

    const fileInput = dialog.locator('input[type="file"][name="playlist"]');
    await fileInput.evaluate((element, selectedFilePath) => {
        (element as HTMLInputElement).dataset.filePathOverride =
            selectedFilePath;
    }, m3uPath);
    await fileInput.setInputFiles(m3uPath);
    await dialog
        .getByRole('button', { name: /add playlist/i })
        .last()
        .click({ timeout: 15_000 });
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
    await page.waitForURL(/\/workspace\/playlists\/[^/]+\/all/, {
        timeout: 45_000,
    });
    capturedM3uPlaylistId = playlistIdFromUrl(page.url(), 'playlists');
    try {
        await page.locator('[data-test-id="channel-item"]').first().waitFor({
            state: 'visible',
            timeout: 60_000,
        });
    } catch (error) {
        await writeDebugScreenshot(page, 'm3u-import');
        const diagnostics = await page.evaluate(() => ({
            bodyText: document.body.innerText.slice(0, 2000),
            title: document.title,
            url: location.href,
        }));

        console.error(
            `[capture] M3U import did not show channels: ${JSON.stringify(
                diagnostics,
                null,
                2
            )}`
        );
        throw error;
    }
}

async function seedDashboardActivity(page: Page): Promise<void> {
    const playlistId = requireCapturedPlaylistId('xtreams');
    const items = [
        {
            xtreamId: 62000,
            type: 'movie' as const,
            backdropUrl: marketingAssetUrl('backdrop', 'Crimson Skylark', '1280x720'),
            favorite: true,
            recent: true,
        },
        {
            xtreamId: 62001,
            type: 'movie' as const,
            backdropUrl: marketingAssetUrl('backdrop', 'The Voltage Guard', '1280x720'),
            favorite: true,
            recent: true,
        },
        {
            xtreamId: 62002,
            type: 'movie' as const,
            backdropUrl: marketingAssetUrl('backdrop', 'Midnight Mantle', '1280x720'),
            favorite: true,
            recent: false,
        },
        {
            xtreamId: 72000,
            type: 'series' as const,
            backdropUrl: marketingAssetUrl('backdrop', 'Skyline Sentinels', '1280x720'),
            favorite: true,
            recent: true,
        },
        {
            xtreamId: 72001,
            type: 'series' as const,
            backdropUrl: marketingAssetUrl('backdrop', 'The Aegis Club', '1280x720'),
            favorite: true,
            recent: false,
        },
    ];

    await page.evaluate(
        async ({ items, playlistId }) => {
            const electronApi = (window as typeof window & {
                electron?: {
                    dbAddFavorite?: (
                        contentId: number,
                        playlistId: string,
                        backdropUrl?: string
                    ) => Promise<unknown>;
                    dbAddRecentItem?: (
                        contentId: number,
                        playlistId: string,
                        backdropUrl?: string
                    ) => Promise<unknown>;
                    dbGetContentByXtreamId?: (
                        xtreamId: number,
                        playlistId: string,
                        contentType?: 'live' | 'movie' | 'series'
                    ) => Promise<{ id: number } | null>;
                };
            }).electron;

            if (!electronApi?.dbGetContentByXtreamId) {
                throw new Error('Electron database bridge is unavailable.');
            }

            for (const item of items) {
                const content = await electronApi.dbGetContentByXtreamId(
                    item.xtreamId,
                    playlistId,
                    item.type
                );

                if (!content?.id) {
                    throw new Error(
                        `Could not find imported Xtream content ${item.xtreamId}.`
                    );
                }

                if (item.favorite) {
                    await electronApi.dbAddFavorite?.(
                        content.id,
                        playlistId,
                        item.backdropUrl
                    );
                }

                if (item.recent) {
                    await electronApi.dbAddRecentItem?.(
                        content.id,
                        playlistId,
                        item.backdropUrl
                    );
                }
            }
        },
        { items, playlistId }
    );
}

async function openAddPlaylistDialog(page: Page): Promise<void> {
    await page.getByRole('button', { name: /add playlist/i }).first().click();
    await page.locator('mat-dialog-container').last().waitFor({
        state: 'visible',
        timeout: 15_000,
    });
}

async function clickDialogOption(dialog: ReturnType<Page['locator']>, label: RegExp): Promise<void> {
    const tab = dialog.getByRole('tab', { name: label }).first();
    if ((await tab.count()) > 0) {
        await tab.click();
        return;
    }

    await dialog.getByRole('button', { name: label }).first().click();
}

async function applyTheme(page: Page, theme: ThemeName): Promise<void> {
    await openSettings(page);
    const testId = theme === 'dark' ? 'DARK_THEME' : 'LIGHT_THEME';
    const themeButton = page.locator(`[data-test-id="${testId}"]`).first();

    await themeButton.scrollIntoViewIfNeeded();
    await themeButton.click();

    const saveButton = page.locator('[data-test-id="save-settings"]').first();
    if (await saveButton.isEnabled()) {
        await saveButton.click();
        await waitForTransientUiToSettle(page);
    }

    await page.waitForFunction(
        (expectedTheme) =>
            document.body.classList.contains('dark-theme') ===
            (expectedTheme === 'dark'),
        theme,
        { timeout: 10_000 }
    );
}

async function openSettings(page: Page): Promise<void> {
    await page.locator('a[href$="/workspace/settings"]').first().click();
    await page.waitForURL(/\/workspace\/settings/, { timeout: 15_000 });
    await page.locator('[data-test-id="settings-container"]').waitFor({
        state: 'visible',
        timeout: 15_000,
    });
}

async function captureThemeSet(page: Page, theme: ThemeName): Promise<void> {
    await captureCurrentView(page, theme, 'settings');
    await openDashboard(page);
    await captureCurrentView(page, theme, 'dashboard');
    await openXtreamVodDetails(page);
    await captureCurrentView(page, theme, 'xtream-vod-details');
    await openXtreamSeriesSeason(page);
    await captureCurrentView(page, theme, 'xtream-series-season-open');
    await openM3uGroupsView(page);
    await captureCurrentView(page, theme, 'm3u-live-groups-two-column');
}

async function openDashboard(page: Page): Promise<void> {
    await page.locator('a.brand[href$="/workspace/dashboard"]').first().click();
    await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
    await page.locator('[data-test-id="dashboard-page"]').waitFor({
        state: 'visible',
        timeout: 20_000,
    });
    await waitForTransientUiToSettle(page);
    await page.locator('[data-test-id="dashboard-hero"]').waitFor({
        state: 'visible',
        timeout: 30_000,
    });

    for (const testId of [
        'dashboard-recently-watched-rail',
        'dashboard-global-favorites-rail',
        'dashboard-recent-sources-rail',
        'dashboard-xtream-recently-added-rail',
    ]) {
        await page.locator(`[data-test-id="${testId}"]`).waitFor({
            state: 'visible',
            timeout: 30_000,
        });
    }
}

async function waitForTransientUiToSettle(page: Page): Promise<void> {
    await page
        .locator('.mat-mdc-snack-bar-container')
        .first()
        .waitFor({ state: 'detached', timeout: 10_000 })
        .catch(() => undefined);
    await page.evaluate(() => {
        document
            .querySelectorAll('.mat-mdc-snack-bar-container, simple-snack-bar')
            .forEach((element) => {
                const overlayPane = element.closest('.cdk-overlay-pane');
                (overlayPane ?? element).remove();
            });
    });
    await page.waitForTimeout(250);
}

async function openXtreamVodDetails(page: Page): Promise<void> {
    const xtreamId = requireCapturedPlaylistId('xtreams');

    await clickHrefSuffix(page, `/workspace/xtreams/${xtreamId}/vod`);
    await clickCategoryByName(page, 'Action & Mystery');
    await clickFirstGridCard(page);
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+/, {
        timeout: 30_000,
    });
    await page.locator('app-content-hero').waitFor({
        state: 'visible',
        timeout: 30_000,
    });
    await page.waitForTimeout(700);
}

async function openXtreamSeriesSeason(page: Page): Promise<void> {
    const xtreamId = requireCapturedPlaylistId('xtreams');

    await clickHrefSuffix(page, `/workspace/xtreams/${xtreamId}/series`);
    await clickCategoryByName(page, 'Urban Drama');
    await clickFirstGridCard(page);
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+/, {
        timeout: 30_000,
    });
    await page.locator('app-season-container').waitFor({
        state: 'visible',
        timeout: 30_000,
    });
    await page.locator('.season-card').first().click();
    await page.locator('.episode-card, .episode-list-item').first().waitFor({
        state: 'visible',
        timeout: 20_000,
    });
    await page.waitForTimeout(700);
}

async function openM3uGroupsView(page: Page): Promise<void> {
    const playlistId = requireCapturedPlaylistId('playlists');

    await switchPlaylistFromHeader(page, 'v020-demo');
    await page.waitForURL(new RegExp(`/workspace/playlists/${playlistId}/`), {
        timeout: 20_000,
    });
    await clickHrefSuffix(page, `/workspace/playlists/${playlistId}/groups`);
    await page.waitForURL(/\/workspace\/playlists\/[^/]+\/groups/, {
        timeout: 20_000,
    });
    await page.locator('.group-nav-item').first().waitFor({
        state: 'visible',
        timeout: 20_000,
    });
    await page.locator('.group-nav-item').first().click();
    await page.locator('[data-test-id="channel-item"]').first().click();
    await page.waitForTimeout(1_000);
}

async function switchPlaylistFromHeader(
    page: Page,
    title: string
): Promise<void> {
    await page.locator('app-playlist-switcher .playlist-switcher-trigger').click();

    const item = page
        .locator('.cdk-overlay-pane .playlist-item')
        .filter({ hasText: title })
        .first();

    await item.waitFor({ state: 'visible', timeout: 20_000 });
    await item.click();
    await page.locator('.cdk-overlay-pane .playlist-item').first().waitFor({
        state: 'detached',
        timeout: 10_000,
    });
}

async function clickCategoryByName(
    page: Page,
    categoryName: string
): Promise<void> {
    const category = page
        .locator('app-workspace-context-panel .category-item')
        .filter({ hasText: categoryName })
        .first();

    try {
        await category.waitFor({ state: 'visible', timeout: 30_000 });
    } catch (error) {
        await writeDebugScreenshot(page, `category-${slugifyForFile(categoryName)}`);
        const diagnostics = await page.evaluate(() => ({
            bodyText: document.body.innerText.slice(0, 2500),
            categories: Array.from(
                document.querySelectorAll(
                    'app-workspace-context-panel .category-item'
                )
            ).map((element) => ({
                id: element.getAttribute('data-category-id'),
                text: (element.textContent ?? '').trim(),
            })),
            title: document.title,
            url: location.href,
        }));

        console.error(
            `[capture] Category ${categoryName} was not visible: ${JSON.stringify(
                diagnostics,
                null,
                2
            )}`
        );
        throw error;
    }
    await category.click();
    await page.waitForTimeout(600);
}

async function clickFirstGridCard(page: Page): Promise<void> {
    const card = page.locator('.category-content-layout mat-card').first();

    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.click();
}

function requireCapturedPlaylistId(
    provider: 'playlists' | 'xtreams'
): string {
    const id =
        provider === 'playlists'
            ? capturedM3uPlaylistId
            : capturedXtreamPlaylistId;

    if (!id) {
        throw new Error(`Could not resolve captured ${provider} playlist id.`);
    }

    return id;
}

function playlistIdFromUrl(url: string, provider: 'playlists' | 'xtreams'): string {
    const match = url.match(new RegExp(`/workspace/${provider}/([^/]+)`));

    if (!match?.[1]) {
        throw new Error(`Could not resolve ${provider} playlist id from URL ${url}`);
    }

    return match[1];
}

async function clickHrefSuffix(page: Page, suffix: string): Promise<void> {
    const link = page.locator(`a[href$="${suffix}"]`).first();

    await link.waitFor({ state: 'attached', timeout: 20_000 });
    await link.click({ force: true });
    await page.waitForTimeout(500);
}

async function captureCurrentView(
    page: Page,
    theme: ThemeName,
    slug: ScreenshotSlug
): Promise<void> {
    const originalPath = screenshotPath('original', theme, slug);

    mkdirSync(path.dirname(originalPath), { recursive: true });
    await prepareForScreenshot(page);
    await page.screenshot({
        path: originalPath,
        type: 'png',
        fullPage: slug === 'dashboard',
        scale: 'css',
    });

    await createDesignedCopy(
        page,
        originalPath,
        screenshotPath('designed', theme, slug),
        {
            ...captureTargets.find((target) => target.slug === slug)!,
            theme,
        }
    );
}

async function prepareForScreenshot(page: Page): Promise<void> {
    await page.mouse.move(viewport.width - 32, viewport.height - 32);
    await page.keyboard.press('Escape').catch(() => undefined);
    await waitForTransientUiToSettle(page);
    await page
        .locator('.mat-mdc-tooltip, .mdc-tooltip, .mat-tooltip-panel')
        .first()
        .waitFor({ state: 'detached', timeout: 1_500 })
        .catch(() => undefined);
    await page.waitForTimeout(200);
}

async function writeDebugScreenshot(page: Page, name: string): Promise<void> {
    const debugPath = path.join(outputRoot, 'debug', `${name}.png`);
    mkdirSync(path.dirname(debugPath), { recursive: true });
    await page.screenshot({ path: debugPath, fullPage: true, type: 'png' });
}

function screenshotPath(
    variant: 'designed' | 'original',
    theme: ThemeName,
    slug: ScreenshotSlug
): string {
    return path.join(outputRoot, variant, theme, `${slug}.png`);
}

async function createDesignedCopy(
    page: Page,
    inputPath: string,
    outputPath: string,
    options: CaptureTarget & { theme: ThemeName }
): Promise<void> {
    mkdirSync(path.dirname(outputPath), { recursive: true });

    const canvasWidth = 1920;
    const canvasHeight = 1080;
    const screenshotWidth = 1460;
    const screenshotHeight = 822;
    const left = 360;
    const top = 170;
    const palette =
        options.theme === 'dark'
            ? {
                  bg1: '#090b12',
                  bg2: '#172235',
                  accent: '#49c6e5',
                  text: '#f8fafc',
                  muted: '#a7b4c8',
              }
            : {
                  bg1: '#eef2f7',
                  bg2: '#dce7ef',
                  accent: '#2563eb',
                  text: '#111827',
                  muted: '#475569',
              };
    const dataUrl = await page.evaluate(
        async ({
            inputDataUrl,
            options,
            palette,
            canvasWidth,
            canvasHeight,
            screenshotWidth,
            screenshotHeight,
            left,
            top,
        }) => {
            const image = await loadCanvasImage(inputDataUrl);
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            if (!context) {
                throw new Error('Canvas 2D context is unavailable.');
            }

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;

            const background = context.createLinearGradient(
                0,
                0,
                canvasWidth,
                canvasHeight
            );
            background.addColorStop(0, palette.bg1);
            background.addColorStop(1, palette.bg2);
            context.fillStyle = background;
            context.fillRect(0, 0, canvasWidth, canvasHeight);

            context.globalAlpha = 0.16;
            context.fillStyle = palette.accent;
            context.beginPath();
            context.arc(1710, 140, 260, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 0.12;
            context.beginPath();
            context.arc(160, 930, 340, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 0.28;
            context.strokeStyle = palette.accent;
            context.lineWidth = 4;
            context.beginPath();
            context.moveTo(0, 810);
            context.bezierCurveTo(420, 650, 720, 1040, 1220, 840);
            context.bezierCurveTo(1460, 744, 1720, 610, 1920, 720);
            context.stroke();
            context.globalAlpha = 1;

            context.fillStyle = palette.accent;
            context.font = '800 28px Arial, Helvetica, sans-serif';
            context.fillText(options.kicker.toUpperCase(), 110, 150);
            context.fillStyle = palette.text;
            context.font = '900 72px Arial, Helvetica, sans-serif';
            context.fillText(options.title, 110, 220);
            context.fillStyle = palette.muted;
            context.font = '600 28px Arial, Helvetica, sans-serif';
            context.fillText(
                'IPTVnator v0.20 release preview using fictional demo content',
                110,
                278
            );

            context.save();
            context.shadowColor =
                options.theme === 'dark'
                    ? 'rgba(0, 0, 0, 0.42)'
                    : 'rgba(0, 0, 0, 0.18)';
            context.shadowBlur = 76;
            context.shadowOffsetY = 34;
            context.globalAlpha = options.theme === 'dark' ? 0.78 : 0.9;
            context.fillStyle = options.theme === 'dark' ? '#020617' : '#ffffff';
            drawRoundRect(
                context,
                left - 18,
                top - 18,
                screenshotWidth + 36,
                screenshotHeight + 36,
                34
            );
            context.fill();
            context.restore();

            context.save();
            drawRoundRect(context, left, top, screenshotWidth, screenshotHeight, 18);
            context.clip();
            context.drawImage(
                image,
                0,
                0,
                image.naturalWidth,
                image.naturalHeight,
                left,
                top,
                screenshotWidth,
                screenshotHeight
            );
            context.restore();

            context.strokeStyle = hexToRgba(palette.accent, 0.35);
            context.lineWidth = 2;
            drawRoundRect(
                context,
                left - 18,
                top - 18,
                screenshotWidth + 36,
                screenshotHeight + 36,
                34
            );
            context.stroke();

            return canvas.toDataURL('image/png');

            function loadCanvasImage(src: string): Promise<HTMLImageElement> {
                return new Promise((resolve, reject) => {
                    const candidate = new Image();
                    candidate.onload = () => resolve(candidate);
                    candidate.onerror = () =>
                        reject(new Error('Could not load screenshot image.'));
                    candidate.src = src;
                });
            }

            function drawRoundRect(
                context: CanvasRenderingContext2D,
                x: number,
                y: number,
                width: number,
                height: number,
                radius: number
            ): void {
                context.beginPath();
                context.moveTo(x + radius, y);
                context.lineTo(x + width - radius, y);
                context.quadraticCurveTo(x + width, y, x + width, y + radius);
                context.lineTo(x + width, y + height - radius);
                context.quadraticCurveTo(
                    x + width,
                    y + height,
                    x + width - radius,
                    y + height
                );
                context.lineTo(x + radius, y + height);
                context.quadraticCurveTo(x, y + height, x, y + height - radius);
                context.lineTo(x, y + radius);
                context.quadraticCurveTo(x, y, x + radius, y);
                context.closePath();
            }

            function hexToRgba(hex: string, alpha: number): string {
                const normalized = hex.replace('#', '');
                const red = Number.parseInt(normalized.slice(0, 2), 16);
                const green = Number.parseInt(normalized.slice(2, 4), 16);
                const blue = Number.parseInt(normalized.slice(4, 6), 16);
                return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
            }
        },
        {
            inputDataUrl: fileToDataUrl(inputPath),
            options,
            palette,
            canvasWidth,
            canvasHeight,
            screenshotWidth,
            screenshotHeight,
            left,
            top,
        }
    );

    writeDataUrlPng(outputPath, dataUrl);
}

async function createHeroImage(page: Page): Promise<void> {
    const dashboard = screenshotPath('original', 'dark', 'dashboard');
    const vod = screenshotPath('original', 'dark', 'xtream-vod-details');
    const series = screenshotPath('original', 'light', 'xtream-series-season-open');
    mkdirSync(path.dirname(heroOutputPath), { recursive: true });

    const dataUrl = await page.evaluate(
        async ({ dashboard, vod, series }) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            if (!context) {
                throw new Error('Canvas 2D context is unavailable.');
            }

            canvas.width = 1600;
            canvas.height = 900;

            const background = context.createLinearGradient(0, 0, 1600, 900);
            background.addColorStop(0, '#06111f');
            background.addColorStop(0.52, '#111827');
            background.addColorStop(1, '#233b54');
            context.fillStyle = background;
            context.fillRect(0, 0, 1600, 900);

            context.globalAlpha = 0.18;
            context.fillStyle = '#49c6e5';
            context.beginPath();
            context.arc(1380, 120, 240, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 0.15;
            context.fillStyle = '#f2a65a';
            context.beginPath();
            context.arc(170, 790, 290, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 1;

            context.fillStyle = '#49c6e5';
            context.font = '800 30px Arial, Helvetica, sans-serif';
            context.fillText('IPTVNATOR V0.20', 86, 138);
            context.fillStyle = '#f8fafc';
            context.font = '900 78px Arial, Helvetica, sans-serif';
            context.fillText('Unified UI.', 86, 224);
            context.fillText('Content-first.', 86, 306);
            context.fillStyle = '#b9c4d6';
            context.font = '600 28px Arial, Helvetica, sans-serif';
            context.fillText(
                'Dashboard, search, favorites, history, and settings reworked across M3U, Xtream, and Stalker.',
                88,
                366
            );

            await drawFramedImage(context, dashboard, 650, 130, 780, 438, 26, '#020617');
            await drawFramedImage(context, vod, 500, 505, 520, 292, 22, '#020617');
            await drawFramedImage(context, series, 990, 565, 430, 242, 20, '#f8fafc');

            return canvas.toDataURL('image/png');

            async function drawFramedImage(
                context: CanvasRenderingContext2D,
                src: string,
                x: number,
                y: number,
                width: number,
                height: number,
                radius: number,
                frameColor: string
            ): Promise<void> {
                const image = await loadCanvasImage(src);

                context.save();
                context.shadowColor = 'rgba(0, 0, 0, 0.45)';
                context.shadowBlur = 60;
                context.shadowOffsetY = 28;
                context.globalAlpha = frameColor === '#f8fafc' ? 0.94 : 0.82;
                context.fillStyle = frameColor;
                drawRoundRect(context, x, y, width, height, radius);
                context.fill();
                context.restore();

                context.save();
                drawRoundRect(context, x, y, width, height, radius);
                context.clip();
                context.drawImage(
                    image,
                    0,
                    0,
                    image.naturalWidth,
                    image.naturalHeight,
                    x,
                    y,
                    width,
                    height
                );
                context.restore();
            }

            function loadCanvasImage(src: string): Promise<HTMLImageElement> {
                return new Promise((resolve, reject) => {
                    const candidate = new Image();
                    candidate.onload = () => resolve(candidate);
                    candidate.onerror = () =>
                        reject(new Error('Could not load screenshot image.'));
                    candidate.src = src;
                });
            }

            function drawRoundRect(
                context: CanvasRenderingContext2D,
                x: number,
                y: number,
                width: number,
                height: number,
                radius: number
            ): void {
                context.beginPath();
                context.moveTo(x + radius, y);
                context.lineTo(x + width - radius, y);
                context.quadraticCurveTo(x + width, y, x + width, y + radius);
                context.lineTo(x + width, y + height - radius);
                context.quadraticCurveTo(
                    x + width,
                    y + height,
                    x + width - radius,
                    y + height
                );
                context.lineTo(x + radius, y + height);
                context.quadraticCurveTo(x, y + height, x, y + height - radius);
                context.lineTo(x, y + radius);
                context.quadraticCurveTo(x, y, x + radius, y);
                context.closePath();
            }
        },
        {
            dashboard: fileToDataUrl(dashboard),
            vod: fileToDataUrl(vod),
            series: fileToDataUrl(series),
        }
    );

    writeDataUrlPng(heroOutputPath, dataUrl);
}

async function verifyExpectedAssets(): Promise<void> {
    const expected = [
        heroOutputPath,
        ...(['dark', 'light'] as ThemeName[]).flatMap((theme) =>
            captureTargets.flatMap((target) => [
                screenshotPath('original', theme, target.slug),
                screenshotPath('designed', theme, target.slug),
            ])
        ),
    ];

    for (const filePath of expected) {
        if (!fileExists(filePath)) {
            throw new Error(`Expected screenshot asset was not created: ${filePath}`);
        }

        const dimensions = readPngDimensions(filePath);
        if (!dimensions.width || !dimensions.height) {
            throw new Error(`Screenshot asset has invalid dimensions: ${filePath}`);
        }
    }
}

async function isHealthy(url: string): Promise<boolean> {
    try {
        const response = await fetch(url);
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForHealthy(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await isHealthy(url)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for ${url}`);
}

function fileExists(filePath: string): boolean {
    try {
        accessSync(filePath);
        return true;
    } catch {
        return false;
    }
}

function fileToDataUrl(filePath: string): string {
    return `data:image/png;base64,${readFileSync(filePath).toString('base64')}`;
}

function writeDataUrlPng(filePath: string, dataUrl: string): void {
    const marker = 'data:image/png;base64,';

    if (!dataUrl.startsWith(marker)) {
        throw new Error(`Expected PNG data URL for ${filePath}`);
    }

    writeFileSync(filePath, Buffer.from(dataUrl.slice(marker.length), 'base64'));
}

function readPngDimensions(filePath: string): { height: number; width: number } {
    const buffer = readFileSync(filePath);
    const pngSignature = '89504e470d0a1a0a';

    if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
        throw new Error(`Expected PNG signature in ${filePath}`);
    }

    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function slugifyForFile(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
