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

import {
    M3U_FIXTURE_TITLE,
    XTREAM_FIXTURE_CREDENTIALS,
    XTREAM_FIXTURE_TITLE,
    XTREAM_MOCK_ORIGIN,
} from './capture-fixtures';
import {
    clickDialogOption,
    openAddPlaylistDialog,
    registerPlaylistId,
    requirePlaylistId,
} from './capture-navigation';

export {
    M3U_FIXTURE_TITLE,
    XTREAM_FIXTURE_TITLE,
    XTREAM_MOCK_ORIGIN,
} from './capture-fixtures';

/** Synthetic categories that only the marketing fixture generator produces. */
const MOCK_FIXTURE_CATEGORIES = ['Action & Mystery', 'Urban Drama'];


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

    // Reusing whatever answers on the port is not enough: every guard treats
    // localhost as trusted, so an unrelated local server or proxy could feed
    // real catalog data and artwork straight into published screenshots.
    // Require the marketing fixtures this capture is built around.
    if (await isHealthy(healthUrl)) {
        await assertMockServerIdentity();
        return undefined;
    }

    const child = spawn(
        path.join(workspaceRoot, 'node_modules/.bin/tsx'),
        // The mock server imports `@iptvnator/shared/marketing-fixtures`, and
        // tsx only resolves that path alias when pointed at the base config —
        // matching how the project's own serve target invokes it.
        [
            '--tsconfig',
            'tsconfig.base.json',
            'apps/xtream-mock-server/src/main.ts',
        ],
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

/**
 * Confirms the service on the mock port is our fixture server: it must serve
 * the marketing catalog with the exact synthetic titles the shots rely on.
 */
async function assertMockServerIdentity(): Promise<void> {
    const response = await fetch(
        `${XTREAM_MOCK_ORIGIN}/player_api.php?username=marketing&password=marketing&action=get_vod_categories`
    ).catch(() => null);

    if (!response?.ok) {
        throw new Error(
            `Something is listening on ${XTREAM_MOCK_ORIGIN} but does not answer the Xtream marketing API — stop it and let this script start the mock server itself.`
        );
    }

    const categories = (await response.json().catch(() => null)) as
        | { category_name?: string }[]
        | null;
    const names = new Set(
        (categories ?? []).map((entry) => entry.category_name)
    );

    for (const expected of MOCK_FIXTURE_CATEGORIES) {
        if (!names.has(expected)) {
            throw new Error(
                `The server on ${XTREAM_MOCK_ORIGIN} is not the IPTVnator marketing mock (missing category "${expected}"). Refusing to capture screenshots from unknown data.`
            );
        }
    }
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
    env: Record<string, string>,
    hostResolverRules: string
): Promise<ElectronApplication> {
    // The resolver switch is the only part of the network gate with no
    // install-timing window: it takes effect before Electron runs a single
    // line of app code, so startup traffic cannot slip through ahead of the
    // session hook.
    return electron.launch({
        args: [
            electronMainPath,
            `--host-resolver-rules=${hostResolverRules}`,
        ],
        env,
    });
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
    // Xtream VOD stream ids are assigned by array position
    // (`MARKETING_VOD_STREAM_ID_BASE + index` in marketing.generator.ts), and
    // the generator lists POSTER_SHOWCASE_MOVIES first. Keep these three titles
    // in step with the first three entries of that fixture list, otherwise the
    // seeded backdrops belong to different movies than the ids resolve to.
    const items = [
        { xtreamId: 62000, type: 'movie', backdropUrl: backdrop('Black Harbor'), recent: true },
        { xtreamId: 62001, type: 'movie', backdropUrl: backdrop('The Paper Astronaut'), recent: true },
        { xtreamId: 62002, type: 'movie', backdropUrl: backdrop('Summer Static'), recent: false },
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
    await dialog.locator('#username').fill(XTREAM_FIXTURE_CREDENTIALS.username);
    await dialog.locator('#password').fill(XTREAM_FIXTURE_CREDENTIALS.password);
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

function idFromUrl(url: string, provider: 'playlists' | 'xtreams'): string {
    // `provider` is a closed union, but build the pattern from a literal
    // anyway so no future caller can inject regex syntax through it.
    const pattern =
        provider === 'playlists'
            ? /\/workspace\/playlists\/([^/]+)\//
            : /\/workspace\/xtreams\/([^/]+)\//;
    const match = url.match(pattern);

    if (!match) {
        throw new Error(`Could not extract ${provider} id from ${url}`);
    }

    return match[1];
}
