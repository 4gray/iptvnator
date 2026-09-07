/**
 * Setup actions for the offline-downloads guide shots: the download manager
 * with the isolated capture folder authorized, one finished movie and two
 * queued episodes, and the focused offline-movie detail.
 */

import type { Page } from '@playwright/test';

import { CAPTURE_DOWNLOAD_FOLDER_NAME } from './capture-fixtures';
import {
    type CaptureAction,
    openXtreamSection,
    settleUi,
} from './capture-navigation-helpers';
import { openXtreamSeries } from './capture-navigation-portal-actions';

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

    await openXtreamSeries(page, 'Urban Drama');
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

async function openDownloadsManager(page: Page): Promise<void> {
    await prepareGuideDownloads(page);
    await openDownloadsPage(page);
}

async function openDownloadsOfflineMovie(page: Page): Promise<void> {
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
}

export const DOWNLOAD_ACTIONS: Readonly<Record<string, CaptureAction>> = {
    'open-downloads-manager': openDownloadsManager,
    'open-downloads-offline-movie': openDownloadsOfflineMovie,
};
