/**
 * Page helpers shared by the capture setup actions and the seeding driver:
 * the playlist-id registry the actions navigate with, dialog handling, and
 * the small navigation moves every action is built from. Leaf module — it
 * imports nothing from the action modules, so they can all depend on it.
 */

import type { Page } from '@playwright/test';

/** One manifest step: `page` plus the optional `param` the step carries. */
export type CaptureAction = (
    page: Page,
    param: string | null
) => Promise<void>;

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
    const id = playlistIds.get(provider);

    if (!id) {
        throw new Error(`No captured ${provider} playlist id — seeding failed?`);
    }

    return id;
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

export async function dismissDialogs(page: Page): Promise<void> {
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

/* ------------------------------------------------------------------ */
/* Navigation moves                                                    */
/* ------------------------------------------------------------------ */

/** Returns to the dashboard via the always-visible brand link. */
export async function goHome(page: Page): Promise<void> {
    if (/\/workspace\/dashboard/.test(page.url())) {
        return;
    }

    await page.locator('a.brand[href$="/workspace/dashboard"]').first().click();
    await page.waitForURL(/\/workspace\/dashboard/, { timeout: 20_000 });
    await settleUi(page);
}

export async function clickHrefSuffix(
    page: Page,
    suffix: string
): Promise<void> {
    await page.locator(`a[href$="${suffix}"]`).first().click();
    // Predicate rather than a RegExp built from the suffix: the value carries
    // playlist ids and path separators, and hand-escaping only some
    // metacharacters is how incomplete-sanitization bugs are born.
    await page.waitForURL((url) => url.href.includes(suffix), {
        timeout: 20_000,
    });
}

/**
 * Opens the primary Xtream portal's `vod` or `series` section, selects the
 * named category and clicks its first card. Manifest steps must be
 * order-independent, so every portal action starts from the dashboard,
 * whose sources rail links into the portal.
 */
export async function openXtreamSection(
    page: Page,
    section: 'vod' | 'series',
    category: string
): Promise<void> {
    await goHome(page);
    await clickHrefSuffix(
        page,
        `/workspace/xtreams/${requirePlaylistId('xtreams')}/vod`
    );

    if (section !== 'vod') {
        await clickHrefSuffix(
            page,
            `/workspace/xtreams/${requirePlaylistId('xtreams')}/${section}`
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
