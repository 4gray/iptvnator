import { expect, test, type Page } from '@playwright/test';
import { addSource, backend, nav, start } from './helpers';
import { playLive, prepareLiveMedia } from './live-media';

const recents = (page: Page) =>
    page.getByRole('region', { name: 'Recent channels', exact: true });
const previous = (page: Page) =>
    page.getByRole('button', { name: /^Previous channel/ });
const drawer = (page: Page) =>
    page.getByRole('dialog', { name: 'Channel browser' });
async function confirmed(page: Page, id: string) {
    await expect
        .poll(() =>
            page.evaluate(async (id) => {
                const db = await new Promise<IDBDatabase>((resolve) => {
                    const open = indexedDB.open('iptvnator-tv-user-data', 1);
                    open.onsuccess = () => resolve(open.result);
                });
                const result = await new Promise<boolean>((resolve) => {
                    const read = db
                        .transaction('state')
                        .objectStore('state')
                        .get('user');
                    read.onsuccess = () =>
                        resolve(read.result.data.history[0]?.item.id === id);
                });
                db.close();
                return result;
            }, id)
        )
        .toBe(true);
}
async function switchInDrawer(page: Page, index: number) {
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    const row = drawer(page).locator('.channel').nth(index);
    const id = (await row.getAttribute('data-focus'))!;
    const title = await row.locator('strong').innerText();
    await row.click();
    await confirmed(page, id);
    await page.keyboard.press('Escape');
    return { id, title };
}

test('TV Live comfort recent channels use confirmed activity, restore after reload and activate an exact source', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { name: 'Demo North' });
    const video = await playLive(page);
    const a = await switchInDrawer(page, 0);
    const b = await switchInDrawer(page, 1);
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    await expect(recents(page).locator('.channel-card')).toHaveCount(2);
    await expect(recents(page).locator('.channel-card').first()).toContainText(
        b.title
    );
    await recents(page).locator('.channel-card').last().focus();
    await page.keyboard.press('ArrowRight');
    await expect(video).not.toHaveAttribute('src');
    await addSource(page, 'stalker', { name: 'Demo South' });
    await prepareLiveMedia(page);
    await nav(page, 'Home');
    await recents(page)
        .getByRole('button', { name: `${a.title} Demo North`, exact: true })
        .click();
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    await expect(page.locator('.player-source-name')).toHaveText('Demo North');
    await confirmed(page, a.id);
    await page.keyboard.press('Escape');
    await expect(
        recents(page).getByRole('button', {
            name: `${a.title} Demo North`,
            exact: true,
        })
    ).toBeFocused();
    await nav(page, 'Home');
    await recents(page).screenshot({
        path: '../../dist/tv-verification/live-comfort-home.png',
    });
    await page.reload();
    await expect(recents(page).locator('.channel-card')).toHaveCount(2);
    await expect(recents(page).locator('.channel-card').first()).toContainText(
        a.title
    );
    await expect(page.locator('video[src],video source')).toHaveCount(0);
});

test('TV Live comfort previous toggles confirmed channels and preserves drawer, grid and modal focus', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { name: 'Demo North' });
    const video = await playLive(page);
    await expect(previous(page)).toHaveCount(0);
    const a = await switchInDrawer(page, 0);
    const b = await switchInDrawer(page, 1);
    await expect(previous(page)).toContainText(a.title);
    await previous(page).click();
    await confirmed(page, a.id);
    await expect(previous(page)).toContainText(b.title);
    await previous(page).click();
    await confirmed(page, b.id);
    await switchInDrawer(page, 1);
    await expect(previous(page)).toContainText(a.title);
    await page.getByRole('button', { name: 'TV Guide', exact: true }).click();
    await expect(
        page.getByRole('dialog', { name: 'Multi-channel programme guide' })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="player-grid"]')).toBeFocused();
    await previous(page).focus();
    await page.keyboard.press('Enter');
    await confirmed(page, a.id);
    await expect(previous(page)).toBeFocused();
    await expect(video).toHaveCount(1);
    await page.screenshot({
        path: '../../dist/tv-verification/live-comfort-previous.png',
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('.native-player.preview')).toBeVisible();
    const open = page.getByRole('button', { name: 'Open fullscreen' });
    await open.click();
    await previous(page).click();
    await confirmed(page, b.id);
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
});

test('TV Live comfort failed native previous can resolve a fresh link on repeated activation', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { name: 'Demo South' });
    const video = await playLive(page);
    const a = await switchInDrawer(page, 0);
    await switchInDrawer(page, 1);
    let resolutions = 0;
    await page.route(`${backend}/stalker?**`, (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') ===
            'create_link'
        )
            resolutions++;
        return route.fallback();
    });
    await video.evaluate((v: HTMLVideoElement) => {
        const play = v.play.bind(v);
        v.play = () => {
            v.play = play;
            return Promise.reject(
                new DOMException('Synthetic start failure', 'NotSupportedError')
            );
        };
    });
    await previous(page).click();
    await expect(page.getByRole('alert')).toContainText('did not start');
    await expect(previous(page)).toBeEnabled();
    await expect(previous(page)).toContainText(a.title);
    await previous(page).click();
    await expect.poll(() => resolutions).toBe(2);
    await confirmed(page, a.id);
});

test('TV Live comfort failed resolution and retry leave confirmed pair and recents untouched', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { name: 'Demo South' });
    const video = await playLive(page);
    const a = await switchInDrawer(page, 0);
    const b = await switchInDrawer(page, 1);
    const loads = await video.getAttribute('data-loads');
    let fail = true,
        requests = 0;
    await page.route(`${backend}/stalker?**`, (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'create_link'
        )
            return route.fallback();
        requests++;
        return fail
            ? route.fulfill({ status: 503, body: 'Synthetic unavailable' })
            : route.fallback();
    });
    await previous(page).click();
    await expect(page.getByRole('alert')).toContainText(
        'could not be resolved'
    );
    await confirmed(page, b.id);
    await expect(previous(page)).toContainText(a.title);
    await page
        .getByRole('button', { name: 'Retry previous channel', exact: true })
        .click();
    await expect.poll(() => requests).toBe(2);
    await expect(previous(page)).toBeEnabled();
    await expect(video).toHaveAttribute('data-loads', loads!);
    fail = false;
    await page
        .getByRole('button', { name: 'Retry previous channel', exact: true })
        .click();
    await confirmed(page, a.id);
    await expect(previous(page)).toContainText(b.title);
    fail = true;
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await drawer(page).locator('.channel').nth(2).click();
    await expect(drawer(page).getByRole('alert')).toContainText(
        'could not be resolved'
    );
    await confirmed(page, a.id);
    await page.keyboard.press('Escape');
    await expect(previous(page)).toContainText(b.title);
    for (const control of ['button', 'remote'] as const) {
        if (control === 'remote')
            await page.getByRole('button', { name: 'Open fullscreen' }).click();
        const beforePrevious = requests;
        await previous(page).click();
        await expect.poll(() => requests).toBe(beforePrevious + 1);
        await expect(previous(page)).toBeEnabled();
        const retry = page.getByRole('button', {
            name: /^Retry (playback|previous channel)$/,
        });
        await expect(retry).toHaveText('Retry previous channel');
        if (control === 'button')
            await page.locator('[data-focus="player-back"]').click();
        else
            await page.evaluate(() =>
                document.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        keyCode: 461,
                        bubbles: true,
                    })
                )
            );
        await expect(page.locator('.native-player.preview')).toBeVisible();
        await expect(retry).toHaveCount(0);
    }
    await nav(page, 'Home');
    await expect(recents(page).locator('.channel-card')).toHaveCount(2);
    await expect(recents(page).locator('.channel-card').first()).toContainText(
        a.title
    );
});

test('TV Live comfort Back cancels delayed Previous after modal Back closes the drawer', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'stalker', { name: 'Demo South' });
    const video = await playLive(page);
    const a = await switchInDrawer(page, 0);
    const b = await switchInDrawer(page, 1);
    const loads = await video.getAttribute('data-loads');
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    let requests = 0;
    await page.route(`${backend}/stalker?**`, async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'create_link'
        )
            return route.fallback();
        requests++;
        const response = await route.fetch();
        await hold;
        try {
            await route.fulfill({ response });
        } catch {
            /* Canceled owner discards a late response. */
        }
    });
    try {
        await previous(page).click();
        await expect.poll(() => requests).toBe(1);
        await page
            .getByRole('button', { name: 'Channels', exact: true })
            .click();
        await expect(drawer(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer(page)).toBeHidden();
        await expect(
            page.locator('[data-focus="player-channels"]')
        ).toBeFocused();
        await expect(previous(page)).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(previous(page)).toBeEnabled();
        await expect(previous(page)).toBeFocused();
        release();
        await page.waitForTimeout(300);
        await confirmed(page, b.id);
        await expect(previous(page)).toContainText(a.title);
        await expect(video).toHaveAttribute('data-loads', loads!);
        await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    } finally {
        release();
    }
});

test('TV Live comfort Previous crosses sources and removed sources disappear from recents and controls', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { name: 'Demo North' });
    await playLive(page);
    const a = await switchInDrawer(page, 0);
    await page.keyboard.press('Escape');
    await addSource(page, 'stalker', { name: 'Demo South' });
    await prepareLiveMedia(page);
    await nav(page, 'Home');
    await recents(page).locator('.channel-card').first().click();
    await confirmed(page, a.id);
    await page.keyboard.press('Escape');
    await addSource(page, 'stalker', { name: 'Demo East' });
    // This is an intentional second source: equal provider channel IDs stay distinct.
    await nav(page, 'TV');
    const bRow = page.locator('.channel').first();
    const bId = (await bRow.getAttribute('data-focus'))!;
    await bRow.click();
    await confirmed(page, bId);
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await expect(previous(page)).toContainText(a.title);
    await previous(page).click();
    await confirmed(page, a.id);
    await expect(page.locator('.player-source-name')).toHaveText('Demo North');
    await previous(page).click();
    await confirmed(page, bId);
    await expect(page.locator('.player-source-name')).toHaveText('Demo East');
    await page.keyboard.press('Escape');
    await nav(page, 'Sources');
    page.once('dialog', (dialog) => dialog.accept());
    await page
        .locator('.source-row')
        .filter({ hasText: 'Demo North' })
        .getByRole('button', { name: 'Remove', exact: true })
        .click();
    await expect(
        page.locator('.source-row').filter({ hasText: 'Demo North' })
    ).toHaveCount(0);
    await nav(page, 'Home');
    await expect(recents(page).locator('.channel-card')).toHaveCount(1);
    await expect(recents(page)).not.toContainText('Demo North');
    await recents(page).locator('.channel-card').click();
    await confirmed(page, bId);
    await expect(previous(page)).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(1);
});

test('TV Live comfort account edits invalidate Previous without autoplay or deleting recents', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream', { name: 'Demo North' });
    await playLive(page);
    await switchInDrawer(page, 0);
    await switchInDrawer(page, 1);
    await expect(previous(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await nav(page, 'Sources');
    await page
        .locator('.source-row')
        .filter({ hasText: 'Demo North' })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
    await page.getByLabel(/^Username/).fill('marketing');
    await page.getByLabel('Password', { exact: true }).fill('marketing');
    await page
        .getByRole('button', { name: 'Save and connect', exact: true })
        .click();
    await expect(page.locator('.source-form')).toHaveCount(0);
    await expect(page.locator('.loading')).toBeHidden();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await expect(recents(page).locator('.channel-card')).toHaveCount(2);
    await recents(page).locator('.channel-card').first().click();
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    await expect(previous(page)).toHaveCount(0);
});

async function openForeignPrevious(page: Page) {
    await start(page);
    await addSource(page, 'xtream', { name: 'Demo North' });
    await playLive(page);
    const a = await switchInDrawer(page, 0);
    await page.keyboard.press('Escape');
    await addSource(page, 'stalker', { name: 'Demo South' });
    await nav(page, 'TV');
    const row = page.locator('.channel').first();
    const b = (await row.getAttribute('data-focus'))!;
    await row.click();
    await confirmed(page, b);
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    return a;
}

test('TV Live comfort remote Stop cancels Previous during cross-source connection', async ({
    page,
}) => {
    await openForeignPrevious(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    await page.route(`${backend}/xtream?**`, async (route) => {
        const action =
            new URL(route.request().url()).searchParams.get('action') ?? '';
        if (['get_account_info', '', 'get_profile'].includes(action)) {
            held = true;
            await gate;
        }
        return route.fallback();
    });
    try {
        await previous(page).click();
        await expect.poll(() => held).toBe(true);
        const pending = page.getByRole('button', {
            name: 'Cancel opening title',
        });
        await expect(pending).toBeVisible();
        await page.evaluate(() =>
            document.dispatchEvent(
                new KeyboardEvent('keydown', { keyCode: 413, bubbles: true })
            )
        );
        release();
        await expect(pending).toHaveCount(0);
        await expect(page.locator('.loading')).toBeHidden();
        await expect(page.locator('.native-player.fullscreen')).toHaveCount(0);
        await expect(page.locator('video[src],video source')).toHaveCount(0);
    } finally {
        release();
    }
});

test('TV Live comfort failed cross-source connection retries keep the pair and Back clears obsolete recovery', async ({
    page,
}) => {
    const a = await openForeignPrevious(page);
    let fail = true,
        attempts = 0;
    await page.route(`${backend}/xtream?**`, (route) => {
        const action =
            new URL(route.request().url()).searchParams.get('action') ?? '';
        if (!['get_account_info', '', 'get_profile'].includes(action))
            return route.fallback();
        attempts++;
        return fail
            ? route.fulfill({
                  status: 503,
                  body: 'Synthetic connection failure',
              })
            : route.fallback();
    });
    await previous(page).click();
    const retry = page.getByRole('button', {
        name: 'Retry previous channel',
        exact: true,
    });
    await expect(retry).toBeVisible();
    const firstAttempts = attempts;
    await retry.click();
    await expect.poll(() => attempts).toBeGreaterThan(firstAttempts);
    await expect(retry).toBeVisible();
    await expect(page.locator('video[src],video source')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(recents(page)).toBeVisible();
    await expect(retry).toHaveCount(0);
    fail = false;
    await recents(page)
        .getByRole('button', { name: `${a.title} Demo North`, exact: true })
        .click();
    await confirmed(page, a.id);
    await expect(previous(page)).toBeVisible();
    await expect(page.locator('.player-source-name')).toHaveText('Demo North');
});
