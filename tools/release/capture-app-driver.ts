/**
 * App driving for capture-release-screenshots.ts: launch, readiness, demo
 * seeding, theme switching, and the named setup actions the manifest refers
 * to. Mechanics proven in the v0.20 capture run, generalized behind action
 * names.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    _electron as electron,
    type ElectronApplication,
    type Page,
} from '@playwright/test';

import { registerPlaylistId, requirePlaylistId } from './capture-navigation';

export const XTREAM_MOCK_ORIGIN = 'http://localhost:3211';
export const XTREAM_FIXTURE_TITLE = 'Fictional Xtream Demo';
export const M3U_FIXTURE_TITLE = 'release-demo';


/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Entirely synthetic channels; streams and logos point at the mock. */
export function writeM3uFixture(dataDir: string): string {
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
    const stream = `${XTREAM_MOCK_ORIGIN}/live/marketing/marketing/52000.m3u8`;
    const lines = ['#EXTM3U'];

    channels.forEach(([group, title, slug], index) => {
        lines.push(
            `#EXTINF:-1 tvg-id="demo-${index + 1}" tvg-name="${title}" tvg-logo="${XTREAM_MOCK_ORIGIN}/assets/marketing/logo/${slug}.svg?size=256x256" group-title="${group}",${title}`,
            stream
        );
    });

    const filePath = path.join(dataDir, `${M3U_FIXTURE_TITLE}.m3u`);
    writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

    return filePath;
}

export async function ensureXtreamMockServer(
    workspaceRoot: string
): Promise<ChildProcess | undefined> {
    const healthUrl = `${XTREAM_MOCK_ORIGIN}/health`;

    if (await isHealthy(healthUrl)) {
        return undefined;
    }

    const child = spawn(
        path.join(workspaceRoot, 'node_modules/.bin/tsx'),
        ['apps/xtream-mock-server/src/main.ts'],
        {
            cwd: workspaceRoot,
            env: { ...process.env, NODE_ENV: 'development', PORT: '3211' },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    child.stderr?.on('data', (chunk) =>
        process.stderr.write(`[xtream-mock] ${chunk}`)
    );

    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
        if (await isHealthy(healthUrl)) {
            return child;
        }
        await sleep(500);
    }

    child.kill('SIGTERM');
    throw new Error(`xtream-mock-server did not become healthy at ${healthUrl}`);
}

async function isHealthy(url: string): Promise<boolean> {
    try {
        return (await fetch(url)).ok;
    } catch {
        return false;
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Launch and readiness                                                */
/* ------------------------------------------------------------------ */

export async function launchApp(
    electronMainPath: string,
    env: Record<string, string>
): Promise<ElectronApplication> {
    return electron.launch({ args: [electronMainPath], env });
}

export async function findMainWindow(app: ElectronApplication): Promise<Page> {
    await sleep(1500);

    for (const candidate of app.windows()) {
        if (!(await candidate.title()).includes('DevTools')) {
            return candidate;
        }
    }

    return app.firstWindow();
}

export async function sizeWindow(
    app: ElectronApplication,
    viewport: { width: number; height: number }
): Promise<void> {
    await app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.webContents.getTitle().includes('DevTools')
        );
        win?.setSize(size.width, size.height);
        win?.center();
    }, viewport);
}

export async function waitForAppReady(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('app-root', { timeout: 45_000 });
    await page.waitForFunction(
        () =>
            (document.querySelector('app-root')?.innerHTML.trim().length ?? 0) >
            0,
        { timeout: 45_000 }
    );
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

export async function seedDemoData(page: Page, m3uPath: string): Promise<void> {
    await addXtreamPortal(page);
    await addM3uPlaylist(page, m3uPath);
    await seedDashboardActivity(page);
}

/**
 * The dashboard hero and rails only render with favorites/recent activity.
 * Seed a handful of mock titles through the Electron DB bridge; backdrops
 * point at the mock server, keeping G3/G4 satisfied.
 */
async function seedDashboardActivity(page: Page): Promise<void> {
    const playlistId = requirePlaylistId('xtreams');
    const backdrop = (title: string) =>
        `${XTREAM_MOCK_ORIGIN}/assets/marketing/backdrop/${title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')}.svg?size=${encodeURIComponent('1280x720')}`;
    const items = [
        { xtreamId: 62000, type: 'movie', backdropUrl: backdrop('Crimson Skylark'), recent: true },
        { xtreamId: 62001, type: 'movie', backdropUrl: backdrop('The Voltage Guard'), recent: true },
        { xtreamId: 62002, type: 'movie', backdropUrl: backdrop('Midnight Mantle'), recent: false },
        { xtreamId: 72000, type: 'series', backdropUrl: backdrop('Skyline Sentinels'), recent: true },
        { xtreamId: 72001, type: 'series', backdropUrl: backdrop('The Aegis Club'), recent: false },
    ] as const;

    await page.evaluate(
        async ({ items, playlistId }) => {
            const bridge = (
                window as typeof window & {
                    electron?: {
                        dbAddFavorite?: (contentId: number, playlistId: string, backdropUrl?: string) => Promise<unknown>;
                        dbAddRecentItem?: (contentId: number, playlistId: string, backdropUrl?: string) => Promise<unknown>;
                        dbGetContentByXtreamId?: (
                            xtreamId: number,
                            playlistId: string,
                            contentType?: 'live' | 'movie' | 'series'
                        ) => Promise<{ id: number } | null>;
                    };
                }
            ).electron;

            if (!bridge?.dbGetContentByXtreamId) {
                throw new Error('Electron database bridge is unavailable.');
            }

            for (const item of items) {
                const content = await bridge.dbGetContentByXtreamId(
                    item.xtreamId,
                    playlistId,
                    item.type
                );

                if (!content?.id) {
                    throw new Error(
                        `Could not find imported Xtream content ${item.xtreamId}.`
                    );
                }

                await bridge.dbAddFavorite?.(content.id, playlistId, item.backdropUrl);

                if (item.recent) {
                    await bridge.dbAddRecentItem?.(content.id, playlistId, item.backdropUrl);
                }
            }
        },
        { items, playlistId }
    );
}

async function addXtreamPortal(page: Page): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    await clickDialogOption(dialog, /xtream credentials/i);
    await dialog.locator('#title').fill(XTREAM_FIXTURE_TITLE);
    await dialog.locator('#serverUrl').fill(XTREAM_MOCK_ORIGIN);
    await dialog.locator('#username').fill('marketing');
    await dialog.locator('#password').fill('marketing');
    await dialog
        .getByRole('button', { name: /^(add|add playlist)$/i })
        .last()
        .click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod/, {
        timeout: 45_000,
    });
    registerPlaylistId('xtreams', idFromUrl(page.url(), 'xtreams'));
    await page
        .locator('.category-content-layout, app-content-card')
        .first()
        .waitFor({ state: 'visible', timeout: 45_000 });
}

async function addM3uPlaylist(page: Page, m3uPath: string): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container').last();

    // Unanchored: the radio's accessible name concatenates title + subtitle.
    await clickDialogOption(dialog, /m3u file/i);

    const fileInput = dialog.locator('input[type="file"][name="playlist"]');
    await fileInput.setInputFiles(m3uPath);
    await dialog
        .getByRole('button', { name: /add playlist/i })
        .last()
        .click({ timeout: 15_000 });
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
    await page.waitForURL(/\/workspace\/playlists\/[^/]+\/all/, {
        timeout: 45_000,
    });
    registerPlaylistId('playlists', idFromUrl(page.url(), 'playlists'));
    await page
        .locator('[data-test-id="channel-item"]')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });
}

async function openAddPlaylistDialog(page: Page): Promise<void> {
    await page.getByRole('button', { name: /add playlist/i }).first().click();
    await page
        .locator('mat-dialog-container')
        .last()
        .waitFor({ state: 'visible', timeout: 15_000 });
}

async function clickDialogOption(
    dialog: ReturnType<Page['locator']>,
    label: RegExp
): Promise<void> {
    // The add-playlist dialog has changed shape across releases: source
    // methods were tabs, then plain buttons, now a radio group.
    for (const role of ['radio', 'tab', 'button'] as const) {
        const option = dialog.getByRole(role, { name: label }).first();

        if ((await option.count()) > 0) {
            await option.click();
            return;
        }
    }

    throw new Error(`Dialog option matching ${label} not found`);
}


function idFromUrl(url: string, provider: 'playlists' | 'xtreams'): string {
    const match = url.match(new RegExp(`/workspace/${provider}/([^/]+)/`));

    if (!match) {
        throw new Error(`Could not extract ${provider} id from ${url}`);
    }

    return match[1];
}
