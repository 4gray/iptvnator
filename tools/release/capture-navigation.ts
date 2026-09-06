/**
 * Named setup actions for capture-release-screenshots.ts — the vocabulary
 * that screenshots.manifest.json steps refer to — plus theme switching and
 * the playlist-id registry the actions navigate with.
 */

import type { Page } from '@playwright/test';

import {
    AUTO_DETECT_FIXTURE_MESSAGE,
    CAPTURE_DOWNLOAD_FOLDER_NAME,
    EPG_FIXTURE_URL,
    M3U_FIXTURE_PLAYLIST_TITLE,
    M3U_FIXTURE_PLAYLIST_URL,
    STALKER_FIXTURE_MAC,
    STALKER_FIXTURE_PORTAL_URL,
    STALKER_FIXTURE_TITLE,
    XTREAM_FIXTURE_CREDENTIALS,
    XTREAM_FIXTURE_TITLE,
    XTREAM_MOCK_ORIGIN,
} from './capture-fixtures';

/** Route segment of each seeded source, as it appears in `/workspace/<provider>/<id>`. */
export type PlaylistProvider =
    | 'playlists'
    | 'xtreams'
    | 'xtreams-secondary'
    | 'stalker';

const playlistIds = new Map<PlaylistProvider, string>();

export function registerPlaylistId(
    provider: PlaylistProvider,
    id: string
): void {
    playlistIds.set(provider, id);
}

export function requirePlaylistId(provider: PlaylistProvider): string {
    return requireId(provider);
}

function requireId(provider: PlaylistProvider): string {
    const id = playlistIds.get(provider);

    if (!id) {
        throw new Error(`No captured ${provider} playlist id — seeding failed?`);
    }

    return id;
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export async function applyTheme(
    page: Page,
    theme: 'dark' | 'light'
): Promise<void> {
    await runAction(page, 'open-settings', null);
    const testId = theme === 'dark' ? 'DARK_THEME' : 'LIGHT_THEME';
    const themeButton = page.locator(`[data-test-id="${testId}"]`).first();

    await themeButton.scrollIntoViewIfNeeded();
    await themeButton.click();

    const saveButton = page.locator('[data-test-id="save-settings"]').first();

    if (await saveButton.isEnabled()) {
        await saveButton.click();
        await settleUi(page);
    }

    await page.waitForFunction(
        (expectedTheme) =>
            document.body.classList.contains('dark-theme') ===
            (expectedTheme === 'dark'),
        theme,
        { timeout: 10_000 }
    );
}

/* ------------------------------------------------------------------ */
/* Named setup actions                                                 */
/* ------------------------------------------------------------------ */

export async function runAction(
    page: Page,
    action: string,
    param: string | null
): Promise<void> {
    // Manifest steps are order-independent, and some of them end with a modal
    // dialog open or a dirty settings form. Clear whatever the previous step
    // left behind before this one starts navigating: a dialog backdrop
    // swallows every click, and unsaved settings raise a leave prompt.
    await dismissDialogs(page);
    await discardUnsavedSettings(page);

    switch (action) {
        case 'open-settings': {
            await page.locator('a[href$="/workspace/settings"]').first().click();
            await page.waitForURL(/\/workspace\/settings/, { timeout: 15_000 });
            await page
                .locator('[data-test-id="settings-container"]')
                .waitFor({ state: 'visible', timeout: 15_000 });
            return;
        }
        case 'open-dashboard': {
            await page
                .locator('a.brand[href$="/workspace/dashboard"]')
                .first()
                .click();
            await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
            await page
                .locator('[data-test-id="dashboard-hero"]')
                .waitFor({ state: 'visible', timeout: 30_000 });
            await settleUi(page);
            return;
        }
        case 'open-xtream-vod': {
            await openXtreamSection(page, 'vod', param ?? 'Action & Mystery');
            await page.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+/,
                { timeout: 30_000 }
            );
            await page
                .locator('app-content-hero')
                .waitFor({ state: 'visible', timeout: 30_000 });
            await page.waitForTimeout(700);
            return;
        }
        case 'open-xtream-series': {
            await openXtreamSection(page, 'series', param ?? 'Urban Drama');
            await page.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+/,
                { timeout: 30_000 }
            );
            await page
                .locator('app-season-container')
                .waitFor({ state: 'visible', timeout: 30_000 });

            // Season tabs auto-select a season; click the first pill only
            // when no episodes rendered on their own.
            const episode = page
                .locator('.episode-card, .episode-list-item')
                .first();

            if (!(await episode.isVisible().catch(() => false))) {
                await page
                    .locator('.season-tabs__pill, [data-testid="season-dropdown"]')
                    .first()
                    .click();
            }

            await episode.waitFor({ state: 'visible', timeout: 20_000 });
            await page.waitForTimeout(700);
            return;
        }
        case 'open-m3u-groups': {
            const playlistId = requireId('playlists');

            await goHome(page);
            await page
                .locator(`a[href*="/workspace/playlists/${playlistId}"]`)
                .first()
                .click();
            await page.waitForURL(
                (url) => url.href.includes(`/workspace/playlists/${playlistId}/`),
                { timeout: 20_000 }
            );
            await clickHrefSuffix(
                page,
                `/workspace/playlists/${playlistId}/groups`
            );
            await page
                .locator('.group-nav-item')
                .first()
                .waitFor({ state: 'visible', timeout: 20_000 });
            await page.locator('.group-nav-item').first().click();
            // Deliberately no channel click: starting playback would pull a
            // real HLS stream (the mock redirects to a public demo stream),
            // and third-party video frames must never enter a release shot.
            await page
                .locator('[data-test-id="channel-item"]')
                .first()
                .waitFor({ state: 'visible', timeout: 20_000 });
            await page.waitForTimeout(500);
            return;
        }
        case 'open-add-playlist-xtream': {
            await goHome(page);
            await openAddPlaylistDialog(page);
            const dialog = page.locator('mat-dialog-container').last();

            await clickDialogOption(dialog, /xtream credentials/i);
            await dialog.locator('#title').fill(XTREAM_FIXTURE_TITLE);
            await dialog.locator('#serverUrl').fill(XTREAM_MOCK_ORIGIN);
            await dialog
                .locator('#username')
                .fill(XTREAM_FIXTURE_CREDENTIALS.username);
            await dialog
                .locator('#password')
                .fill(XTREAM_FIXTURE_CREDENTIALS.password);
            // The status probe only talks to the local mock, so the frame can
            // show the successful "portal is active" verdict the guide explains.
            await dialog
                .getByRole('button', { name: /test connection/i })
                .first()
                .click();
            const status = dialog.locator('.connection-status');
            await status.waitFor({ state: 'visible', timeout: 30_000 });
            // The dialog body scrolls; bring the verdict the guide explains
            // into frame together with the credential fields above it.
            await status.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            return;
        }
        case 'open-add-playlist-auto': {
            await goHome(page);
            await openAddPlaylistDialog(page);
            const dialog = page.locator('mat-dialog-container').last();

            await clickDialogOption(dialog, /auto-detect/i);
            await dialog
                .locator('[data-test-id="auto-detect-textarea"]')
                .fill(AUTO_DETECT_FIXTURE_MESSAGE);
            const candidate = dialog
                .locator('[data-test-id="auto-detect-candidate"]')
                .first();
            await candidate.waitFor({ state: 'visible', timeout: 15_000 });
            await candidate.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            return;
        }
        case 'open-xtream-live': {
            await goHome(page);
            await clickHrefSuffix(
                page,
                `/workspace/xtreams/${requireId('xtreams')}/vod`
            );
            await clickHrefSuffix(
                page,
                `/workspace/xtreams/${requireId('xtreams')}/live`
            );

            const categories = page.locator(
                'app-workspace-context-panel .category-item'
            );
            const category = param
                ? categories.filter({ hasText: param }).first()
                : categories.first();

            await category.waitFor({ state: 'visible', timeout: 30_000 });
            await category.click();
            // Deliberately no channel click: playback would pull the mock's
            // redirect to a public demo stream, and third-party video frames
            // must never enter a published shot.
            await page
                .locator('app-channel-list-item')
                .first()
                .waitFor({ state: 'visible', timeout: 30_000 });
            await page.waitForTimeout(700);
            return;
        }
        case 'open-add-playlist-stalker': {
            await goHome(page);
            await openAddPlaylistDialog(page);
            const dialog = page.locator('mat-dialog-container').last();

            await clickDialogOption(dialog, /stalker portal/i);
            await dialog.locator('#title').fill(STALKER_FIXTURE_TITLE);
            await dialog.locator('#portalUrl').fill(STALKER_FIXTURE_PORTAL_URL);
            await dialog.locator('#macAddress').fill(STALKER_FIXTURE_MAC);
            // Blur runs the MAC normalization the guide describes.
            await dialog.locator('#serialNumber').focus();
            // The form is long; frame the identity fields and the derive
            // toggle rather than the signature fields at the bottom.
            await dialog.locator('.derive-device-ids').scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            return;
        }
        case 'open-stalker-live': {
            await goHome(page);
            await clickHrefSuffix(
                page,
                `/workspace/stalker/${requireId('stalker')}/vod`
            );
            await clickHrefSuffix(
                page,
                `/workspace/stalker/${requireId('stalker')}/itv`
            );

            const categories = page.locator(
                'app-workspace-context-panel .category-item'
            );
            const category = param
                ? categories.filter({ hasText: param }).first()
                : categories.first();

            await category.waitFor({ state: 'visible', timeout: 30_000 });
            await category.click();
            // No channel click: playback would resolve a create_link to a
            // public demo stream, and third-party video never enters a shot.
            await page
                .locator('app-channel-list-item')
                .first()
                .waitFor({ state: 'visible', timeout: 30_000 });
            await page.waitForTimeout(700);
            return;
        }
        case 'open-add-playlist-m3u-url': {
            await goHome(page);
            await openAddPlaylistDialog(page);
            const dialog = page.locator('mat-dialog-container').last();

            await clickDialogOption(dialog, /m3u url/i);
            // Typed only: the dialog fetches nothing until Add is clicked,
            // and the address points at the local mock anyway.
            await dialog
                .locator('input[formcontrolname="playlistUrl"]')
                .fill(M3U_FIXTURE_PLAYLIST_URL);
            await dialog
                .locator('input[formcontrolname="playlistName"]')
                .fill(M3U_FIXTURE_PLAYLIST_TITLE);
            await page.waitForTimeout(500);
            return;
        }
        case 'open-settings-epg': {
            await runAction(page, 'open-settings', null);
            const sectionLink = page
                .locator('[data-test-id="settings-section-epg"]')
                .first();

            await sectionLink.waitFor({ state: 'visible', timeout: 15_000 });
            await sectionLink.click({ timeout: 10_000 });
            await page.waitForURL(/\/workspace\/settings\/epg/, {
                timeout: 15_000,
            });

            const section = page.locator('#epg');
            await section.waitFor({ state: 'visible', timeout: 15_000 });
            // Show a filled source row instead of the empty state. The value
            // is staged in the form only; nothing is saved or fetched. The
            // dirty form is discarded by `discardUnsavedSettings` before the
            // next action or the app teardown — the settings close guard
            // would otherwise hold `app.close()` open forever.
            await section
                .getByRole('button', { name: /add epg source/i })
                .click({ timeout: 10_000 });
            const field = section.locator('input[type="url"]').last();
            await field.waitFor({ state: 'visible', timeout: 10_000 });
            await field.fill(EPG_FIXTURE_URL, { timeout: 10_000 });
            await page.waitForTimeout(500);
            return;
        }
        case 'open-xtream-vod-sources': {
            await openXtreamVodWithSources(page, param ?? 'Action & Mystery');
            return;
        }
        case 'open-xtream-vod-sources-menu': {
            await openXtreamVodWithSources(page, param ?? 'Action & Mystery');
            await page.locator('app-vod-sources-chip button').click();

            const menu = page.locator('app-vod-sources-menu');

            await menu.waitFor({ state: 'visible', timeout: 15_000 });
            // "check all" probes every unchecked copy (one get_vod_info plus a
            // HEAD against the mock) so the rows carry verdicts in the frame.
            const checkAll = menu.locator('.sources-menu__check-all');

            if (await checkAll.isVisible().catch(() => false)) {
                await checkAll.click();
                await checkAll
                    .waitFor({ state: 'hidden', timeout: 30_000 })
                    .catch(() => undefined);
            }

            await page.waitForTimeout(700);
            return;
        }
        case 'open-downloads-manager': {
            await prepareGuideDownloads(page);
            await openDownloadsPage(page);
            return;
        }
        case 'open-downloads-offline-movie': {
            await prepareGuideDownloads(page);
            await openDownloadsPage(page);

            const card = page
                .locator('[data-test-id^="download-library-movie-"]')
                .first();

            await card.waitFor({ state: 'visible', timeout: 30_000 });
            await card.locator('.download-library__artwork-button').click();
            await page
                .locator('[data-testid="offline-play"]')
                .waitFor({ state: 'visible', timeout: 30_000 });
            await page.waitForTimeout(700);
            return;
        }
        default:
            throw new Error(`Unknown setup action: ${action}`);
    }
}

/* ------------------------------------------------------------------ */
/* Dialog helpers (shared with the seeding driver)                     */
/* ------------------------------------------------------------------ */

export async function openAddPlaylistDialog(page: Page): Promise<void> {
    await page.getByRole('button', { name: /add playlist/i }).first().click();
    await page
        .locator('mat-dialog-container')
        .last()
        .waitFor({ state: 'visible', timeout: 15_000 });
}

export async function clickDialogOption(
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

/**
 * Settings edits staged by a shot (the EPG source row) must never persist:
 * saving would start a fetch, and a dirty form arms the app's close guard,
 * which blocks `app.close()` until someone answers the save/discard prompt.
 */
export async function discardUnsavedSettings(page: Page): Promise<void> {
    const discard = page.locator('[data-test-id="discard-settings"]').first();

    if ((await discard.count()) === 0 || !(await discard.isVisible())) {
        return;
    }

    await discard.click({ timeout: 10_000 });
    await discard
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .catch(() => undefined);
}

async function dismissDialogs(page: Page): Promise<void> {
    const dialogs = page.locator('mat-dialog-container');

    if ((await dialogs.count()) === 0) {
        return;
    }

    await page.keyboard.press('Escape');
    await dialogs
        .first()
        .waitFor({ state: 'detached', timeout: 10_000 })
        .catch(async () => {
            await page.getByRole('button', { name: /^cancel$/i }).last().click();
            await dialogs.first().waitFor({ state: 'detached', timeout: 10_000 });
        });
}

/** Returns to the dashboard via the always-visible brand link. */
async function goHome(page: Page): Promise<void> {
    if (/\/workspace\/dashboard/.test(page.url())) {
        return;
    }

    await page.locator('a.brand[href$="/workspace/dashboard"]').first().click();
    await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
    await settleUi(page);
}

/* ------------------------------------------------------------------ */
/* Alternative sources (guide shots)                                   */
/* ------------------------------------------------------------------ */

/**
 * Opens a movie of the primary portal whose copy also exists in the secondary
 * one (seeded with `secondaryXtream`), and waits for lazy discovery to render
 * the Sources chip.
 */
async function openXtreamVodWithSources(
    page: Page,
    category: string
): Promise<void> {
    requireId('xtreams-secondary');
    await runAction(page, 'open-xtream-vod', category);
    await page
        .locator('app-vod-sources-chip button')
        .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);
}

/* ------------------------------------------------------------------ */
/* Download manager (guide shots)                                      */
/* ------------------------------------------------------------------ */

/** Header shortcut into `/workspace/downloads`, the same button the e2e suite uses. */
async function openDownloadsPage(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open downloads' }).click();
    await page.waitForURL(/\/workspace\/downloads(?:\?.*)?$/, {
        timeout: 20_000,
    });
    await page
        .locator('[data-test-id="downloads-content"]')
        .waitFor({ state: 'visible', timeout: 20_000 });
    await settleUi(page);
}

/**
 * Puts the download manager into the state the offline guide describes: the
 * authorized folder inside the isolated data dir, one finished movie in the
 * library and two episodes trickling through the queue. Every step
 * is idempotent, because the manifest runs each shot once per theme: a movie
 * already saved shows the done state instead of the download button, and a
 * queued or saved episode no longer offers a download label.
 */
async function prepareGuideDownloads(page: Page): Promise<void> {
    await openDownloadsPage(page);
    await ensureCaptureDownloadFolder(page);

    await openXtreamSection(page, 'vod', 'Action & Mystery');
    await page
        .locator('app-content-hero')
        .waitFor({ state: 'visible', timeout: 30_000 });
    const downloadMovie = page.locator('[data-testid="vod-download-start"]');

    if (await downloadMovie.isVisible().catch(() => false)) {
        await downloadMovie.click();
        await page
            .locator(
                '[data-testid="vod-download-progress"], [data-testid="vod-download-done"]'
            )
            .first()
            .waitFor({ state: 'visible', timeout: 30_000 });
    }

    await runAction(page, 'open-xtream-series', 'Urban Drama');
    // Two single episodes rather than "Download season": a six-episode queue
    // fills the whole frame and pushes the finished movie below the fold. An
    // episode button whose label no longer starts with "Download" is already
    // queued or saved (it would play the local file), so it is left alone.
    const episodeButtons = page.locator(
        '[data-test-id^="episode-download-"][aria-label^="Download "]:not([disabled])'
    );
    const toQueue = Math.min(await episodeButtons.count(), 2);

    for (let index = 0; index < toQueue; index += 1) {
        await episodeButtons.first().click();
        await page.waitForTimeout(800);
    }

    await settleUi(page);
}

/**
 * The download manager authorizes the OS Downloads folder by default, which
 * would put fixture bytes into the maintainer's real Downloads directory and
 * show a personal home path in the frame. The capture stubs the folder dialog
 * (`installDownloadFolderDialogStub`), so "Change Folder" lands on the
 * isolated folder without any native UI.
 */
async function ensureCaptureDownloadFolder(page: Page): Promise<void> {
    const folder = page.locator('[data-test-id="downloads-folder"]');

    await folder.waitFor({ state: 'visible', timeout: 20_000 });

    if ((await folder.innerText()).includes(CAPTURE_DOWNLOAD_FOLDER_NAME)) {
        return;
    }

    await page.getByRole('button', { name: 'Change Folder' }).click();
    await page
        .locator('[data-test-id="downloads-folder"]')
        .filter({ hasText: CAPTURE_DOWNLOAD_FOLDER_NAME })
        .waitFor({ state: 'visible', timeout: 20_000 });
}

async function openXtreamSection(
    page: Page,
    section: 'vod' | 'series',
    category: string
): Promise<void> {
    // Manifest steps must be order-independent, so every portal action
    // starts from the dashboard, whose sources rail links into the portal.
    await goHome(page);
    await clickHrefSuffix(
        page,
        `/workspace/xtreams/${requireId('xtreams')}/vod`
    );

    if (section !== 'vod') {
        await clickHrefSuffix(
            page,
            `/workspace/xtreams/${requireId('xtreams')}/${section}`
        );
    }

    const item = page
        .locator('app-workspace-context-panel .category-item')
        .filter({ hasText: category })
        .first();

    await item.waitFor({ state: 'visible', timeout: 30_000 });
    await item.click();
    await page.waitForTimeout(600);

    const card = page.locator('.category-content-layout mat-card').first();
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.click();
}

async function clickHrefSuffix(page: Page, suffix: string): Promise<void> {
    await page.locator(`a[href$="${suffix}"]`).first().click();
    // Predicate rather than a RegExp built from the suffix: the value carries
    // playlist ids and path separators, and hand-escaping only some
    // metacharacters is how incomplete-sanitization bugs are born.
    await page.waitForURL((url) => url.href.includes(suffix), {
        timeout: 20_000,
    });
}

export async function settleUi(page: Page): Promise<void> {
    await page
        .locator('.mat-mdc-snack-bar-container')
        .first()
        .waitFor({ state: 'detached', timeout: 10_000 })
        .catch(() => undefined);
    // Park the cursor so no nav item keeps its hover tooltip in frame.
    await page.mouse.move(640, 700);
    await page.evaluate(() => {
        document
            .querySelectorAll(
                '.mat-mdc-snack-bar-container, simple-snack-bar, .mat-mdc-tooltip, .cdk-describedby-message-container'
            )
            .forEach((element) => {
                (element.closest('.cdk-overlay-pane') ?? element).remove();
            });
    });
    await page.waitForTimeout(250);
}


