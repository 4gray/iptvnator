import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { setInputValue } from './e2e-helpers';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

const BACKEND_ORIGIN = 'http://localhost:3000';
const XTREAM_MOCK_PORT = process.env['XTREAM_MOCK_PORT'] ?? '3211';
const STALKER_MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';

export const XTREAM_MOCK_SERVER = `http://localhost:${XTREAM_MOCK_PORT}`;
export const STALKER_MOCK_SERVER = `http://localhost:${STALKER_MOCK_PORT}`;
export const STALKER_PORTAL_URL = `${STALKER_MOCK_SERVER}/portal.php`;
export const EDITED_MAC = '00:1A:79:00:00:03';

const DEFAULT_MAC = '00:1A:79:00:00:01';
const M3U_PLAYLIST_URL = `${XTREAM_MOCK_SERVER}/playlist.m3u`;

type RuntimeErrors = {
    consoleErrors: string[];
    pageErrors: string[];
};

type SourceDialogField =
    | 'macAddress'
    | 'password'
    | 'portalUrl'
    | 'serverUrl'
    | 'title'
    | 'username';

export async function resetPwaMockServers(
    request: APIRequestContext
): Promise<void> {
    await request.post(`${XTREAM_MOCK_SERVER}/reset`);
    await request.post(`${STALKER_MOCK_SERVER}/reset`);
}

export async function interceptPwaProviderRequests(
    page: Page
): Promise<void> {
    const providerTargets = await interceptProviderTargetRegistration(page);

    await page.route(`${BACKEND_ORIGIN}/parse**`, async (route) => {
        const originalUrl = new URL(route.request().url());
        const providerUrl = getRegisteredProviderUrl(
            originalUrl,
            providerTargets
        );

        await route.fulfill({
            body: JSON.stringify(createParsedM3uPlaylist(providerUrl)),
            contentType: 'application/json',
            status: 200,
        });
    });

    await page.route(`${BACKEND_ORIGIN}/xtream**`, async (route) => {
        const originalUrl = new URL(route.request().url());
        const mockUrl = new URL(`${XTREAM_MOCK_SERVER}/xtream`);
        const providerUrl = getRegisteredProviderUrl(
            originalUrl,
            providerTargets
        );

        if (providerUrl) {
            mockUrl.searchParams.set('url', providerUrl);
        }

        originalUrl.searchParams.forEach((value, key) => {
            if (key !== 'targetId') {
                mockUrl.searchParams.set(key, value);
            }
        });

        await route.continue({ url: mockUrl.toString() });
    });

    await page.route(`${BACKEND_ORIGIN}/stalker**`, async (route) => {
        const originalUrl = new URL(route.request().url());
        const mockUrl = new URL(`${STALKER_MOCK_SERVER}/stalker`);
        const providerUrl = getRegisteredProviderUrl(
            originalUrl,
            providerTargets
        );

        if (providerUrl) {
            mockUrl.searchParams.set('url', providerUrl);
        }

        originalUrl.searchParams.forEach((value, key) => {
            if (key !== 'targetId') {
                mockUrl.searchParams.set(key, value);
            }
        });

        await route.continue({ url: mockUrl.toString() });
    });
}

export async function addXtreamPortal(
    page: Page,
    title: string
): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByRole('radio', { name: /Xtream credentials/i }).click();
    await setInputValue(dialog.locator('#title'), title);
    await setInputValue(dialog.locator('#serverUrl'), XTREAM_MOCK_SERVER);
    await setInputValue(dialog.locator('#username'), 'user1');
    await setInputValue(dialog.locator('#password'), 'pass1');

    const addButton = dialog.getByRole('button', {
        name: 'Add',
        exact: true,
    });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/xtreams.*vod/);
}

export async function addM3uUrlPlaylist(
    page: Page,
    title: string
): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container');
    await setInputValue(
        dialog.getByRole('textbox', { name: /Playlist URL/ }),
        M3U_PLAYLIST_URL
    );
    await setInputValue(
        dialog.getByRole('textbox', { name: 'Playlist title' }),
        title
    );

    const addButton = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/playlists.*all/);
}

export async function addStalkerPortal(
    page: Page,
    title: string
): Promise<void> {
    await openAddPlaylistDialog(page);
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();
    await setInputValue(dialog.locator('input#title'), title);
    await setInputValue(dialog.locator('input#portalUrl'), STALKER_PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), DEFAULT_MAC);

    const addButton = dialog.getByRole('button', {
        name: 'Add',
        exact: true,
    });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/stalker.*vod/);
}

export async function openSources(page: Page): Promise<void> {
    await page.goto('/workspace/sources');
    await page.waitForURL(/\/workspace\/sources(?:\?.*)?$/);
    await expect(page.locator('app-workspace-sources')).toBeVisible({
        timeout: 15_000,
    });
}

export function sourceRowByTitle(page: Page, title: string): Locator {
    return page.locator('app-playlist-item').filter({ hasText: title }).first();
}

export async function openSourceEditor(
    page: Page,
    title: string
): Promise<Locator> {
    const row = sourceRowByTitle(page, title);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.hover();
    await row.locator('.edit-btn').click();
    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog).toBeVisible();
    return dialog;
}

export async function updateSourceDialog(
    dialog: Locator,
    updates: Partial<Record<SourceDialogField, string>>
): Promise<void> {
    for (const [field, value] of Object.entries(updates)) {
        if (value == null) {
            continue;
        }

        await setInputValue(
            dialog.locator(`input[formcontrolname="${field}"]`),
            value
        );
    }
}

export async function saveSourceDialog(dialog: Locator): Promise<void> {
    await expect(
        dialog.getByRole('button', { name: 'Save', exact: true })
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
}

export async function closeSourceDialog(dialog: Locator): Promise<void> {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
}

export async function expectSourceDialogValues(
    dialog: Locator,
    expected: Partial<Record<SourceDialogField, string>>
): Promise<void> {
    for (const [field, value] of Object.entries(expected)) {
        if (value == null) {
            continue;
        }

        await expect(
            dialog.locator(`input[formcontrolname="${field}"]`)
        ).toHaveValue(value);
    }
}

export async function expectElectronBridgeUnavailable(
    page: Page
): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.electron)).toBeUndefined();
}

export function collectRuntimeErrors(page: Page): RuntimeErrors {
    const errors: RuntimeErrors = {
        consoleErrors: [],
        pageErrors: [],
    };

    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        errors.pageErrors.push(error.message);
    });

    return errors;
}

export function expectNoElectronDbRuntimeErrors(
    errors: RuntimeErrors
): void {
    const electronDbErrorPattern =
        /window\.electron|Cannot read properties of undefined.*db|db(UpdatePlaylist|SetAppState|GetContentByXtreamId|GetAllCategories|UpdateCategoryVisibility|GlobalSearch)|DB_(UPDATE_PLAYLIST|SET_APP_STATE|GET_CONTENT_BY_XTREAM_ID|GET_ALL_CATEGORIES|UPDATE_CATEGORY_VISIBILITY|GLOBAL_SEARCH)|updateXtreamPlaylistDetails|globalSearchContent/i;
    const matchingErrors = [...errors.consoleErrors, ...errors.pageErrors].filter(
        (message) => electronDbErrorPattern.test(message)
    );

    expect(matchingErrors).toEqual([]);
}

async function openAddPlaylistDialog(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    await expect(page.locator('mat-dialog-container')).toBeVisible();
}

function createParsedM3uPlaylist(providerUrl: string | null) {
    return {
        _id: 'pwa-url-source-id',
        autoRefresh: false,
        count: 2,
        filename: 'pwa-url-source.m3u',
        importDate: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        items: [
            {
                group: { title: 'News' },
                http: {
                    origin: '',
                    referrer: '',
                    'user-agent': '',
                },
                id: 'pwa-url-channel-1',
                name: 'PWA URL Channel One',
                radio: 'false',
                tvg: {
                    id: 'pwa-url-1',
                    logo: '',
                    name: 'PWA URL Channel One',
                    rec: '',
                    url: '',
                },
                url: 'https://streams.example.test/pwa-url-one.m3u8',
            },
            {
                group: { title: 'News' },
                http: {
                    origin: '',
                    referrer: '',
                    'user-agent': '',
                },
                id: 'pwa-url-channel-2',
                name: 'PWA URL Channel Two',
                radio: 'false',
                tvg: {
                    id: 'pwa-url-2',
                    logo: '',
                    name: 'PWA URL Channel Two',
                    rec: '',
                    url: '',
                },
                url: 'https://streams.example.test/pwa-url-two.m3u8',
            },
        ],
        lastUsage: '',
        title: 'pwa-url-source.m3u',
        url: providerUrl ?? M3U_PLAYLIST_URL,
    };
}
