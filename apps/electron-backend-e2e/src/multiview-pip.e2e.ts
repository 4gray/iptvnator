import type { Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    type LaunchedElectronApp,
    launchElectronApp,
    openSourceEditor,
    openSources,
    saveSourceDialog,
    sourceRowByTitle,
    test,
    updateSourceDialog,
} from './electron-test-fixtures';
import {
    addLiveFormatPortal,
    configureLiveFormat,
    expectLiveFormatPlaying,
    liveChannels,
} from './xtream-live-format.fixture';

/*
 * Multiview phase 1 (PiP) on the Xtream mock's `live-fallback` account with
 * the TS stream format: streams 10000, 10001 and 10003 play a local MPEG-TS
 * clip, 10002 answers 403. No external media is involved.
 */

const tiles = (page: Page) => page.locator('app-multiview-tile');
const tile = (page: Page, role: 'main' | 'pip') =>
    page.locator(`app-multiview-tile[data-tile-role="${role}"]`);
const tileLabel = (page: Page, role: 'main' | 'pip') =>
    tile(page, role).getAttribute('aria-label');

async function channelName(page: Page, index: number): Promise<string> {
    return (
        (await liveChannels(page)
            .nth(index)
            .locator('.channel-name')
            .textContent()) ?? ''
    ).trim();
}

async function expectTilePlaying(page: Page, role: 'main' | 'pip') {
    await expect
        .poll(
            () =>
                tile(page, role)
                    .locator('video')
                    .first()
                    .evaluate((video: HTMLVideoElement) => video.currentTime)
                    .catch(() => 0),
            { timeout: 30_000 }
        )
        .toBeGreaterThan(0.3);
}

/** Leaves the keyboard to the page, as after clicking the video. */
async function blur(page: Page): Promise<void> {
    await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
    );
}

async function playFirstChannel(app: LaunchedElectronApp): Promise<Page> {
    const page = app.mainWindow;
    await configureLiveFormat(page, 'html5', 'ts');
    await addLiveFormatPortal(page);
    await liveChannels(page).first().click();
    await expectLiveFormatPlaying(page, 'html5');
    return page;
}

test.describe('@electron @xtream @playback multiview PiP', () => {
    test.setTimeout(180_000);

    let app: LaunchedElectronApp;

    test.beforeEach(async ({ dataDir }) => {
        app = await launchElectronApp(dataDir, {
            args: ['--autoplay-policy=no-user-gesture-required'],
        });
    });

    test.afterEach(async () => {
        await closeElectronApp(app);
    });

    test('starts from the dock picker, swaps, and ends when the view is left', async () => {
        const page = await playFirstChannel(app);
        const main = await channelName(page, 0);
        const added = await channelName(page, 1);

        const video = page.locator('app-web-player-view video').first();
        const box = await video.boundingBox();
        await page.mouse.move(
            (box?.x ?? 0) + (box?.width ?? 0) / 2,
            (box?.y ?? 0) + (box?.height ?? 0) / 2
        );
        await page.getByTestId('player-controls-multiview').click();
        const picker = page.locator('app-multiview-picker-dialog');
        await expect(picker).toBeVisible();
        await expect(page.getByTestId('multiview-picker-search')).toBeFocused();
        // The playing channel is tile 1 already.
        await expect(
            picker.locator('app-multiview-picker-row', { hasText: main })
        ).toHaveAttribute('aria-disabled', 'true');

        await page.getByTestId('multiview-picker-search').fill(added);
        await expect(
            picker.locator('app-multiview-picker-row', { hasText: added })
        ).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(picker).toBeHidden();

        await expect(tiles(page)).toHaveCount(2);
        expect(await tileLabel(page, 'main')).toContain(main);
        expect(await tileLabel(page, 'pip')).toContain(added);
        expect(await tileLabel(page, 'pip')).toContain('muted');
        await expectTilePlaying(page, 'pip');

        // S swaps size and sound (R3).
        await blur(page);
        await page.keyboard.press('s');
        await expect.poll(() => tileLabel(page, 'main')).toContain(added);
        expect(await tileLabel(page, 'main')).toContain('sound on');

        // The tile's own swap button swaps back.
        await tile(page, 'pip').hover();
        await page.getByTestId('multiview-tile-swap').click();
        await expect.poll(() => tileLabel(page, 'main')).toContain(main);

        // Leaving the view ends the session; the main channel is the
        // view's own selection again.
        await page.getByRole('link', { name: 'Movies', exact: true }).click();
        await expect(tiles(page)).toHaveCount(0);
        await page.getByRole('link', { name: 'Live TV', exact: true }).click();
        await expect(page.getByTestId('multiview-stage')).toHaveCount(0);
    });

    test('adds from the list with Alt+click and drag, with tile badges', async () => {
        const page = await playFirstChannel(app);
        const second = await channelName(page, 1);
        const fourth = await channelName(page, 3);

        await liveChannels(page)
            .nth(1)
            .click({ modifiers: ['Alt'] });
        await expect(tiles(page)).toHaveCount(2);
        expect(await tileLabel(page, 'pip')).toContain(second);
        await expectTilePlaying(page, 'pip');

        const badge = (index: number) =>
            liveChannels(page)
                .nth(index)
                .locator('[data-test-id="multiview-tile-badge"]');
        await expect(badge(0)).toContainText('1');
        await expect(badge(0)).toContainText('volume_up');
        await expect(badge(1)).toHaveText('2');
        // Alt+click does not select the row.
        await expect(liveChannels(page).nth(1)).not.toHaveClass(/active/);

        // A row dropped on the PiP replaces it (R5).
        await page
            .locator('app-live-stream-layout app-channel-list-item')
            .nth(3)
            .dragTo(tile(page, 'pip'));
        await expect.poll(() => tileLabel(page, 'pip')).toContain(fourth);
        await expect(badge(3)).toHaveText('2');
        await expect(badge(1)).toHaveCount(0);

        // The bar's exit keeps the tile with sound; the list badges go.
        await page.getByTestId('multiview-bar-exit').click();
        await expect(tiles(page)).toHaveCount(0);
        await expect(badge(0)).toHaveCount(0);
    });

    test('a tile that cannot play explains why and closes without ending the main one', async () => {
        const page = await playFirstChannel(app);

        await liveChannels(page)
            .nth(2)
            .click({ modifiers: ['Alt'] });
        const card = page.getByTestId('multiview-error-card');
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card).toContainText("This channel won't play");

        await page.getByTestId('multiview-error-close').click();
        await expect(tiles(page)).toHaveCount(0);
        await expectLiveFormatPlaying(page, 'html5');
    });

    test('two tiles from two sources reach the provider with their own headers', async () => {
        const page = app.mainWindow;
        await configureLiveFormat(page, 'html5', 'ts');
        // Two sources of the same synthetic account, told apart by their
        // User-Agent, which the fixture echoes in x-fixture-user-agent.
        for (const name of ['A', 'B']) {
            await addLiveFormatPortal(page);
            await openSources(page);
            const dialog = await openSourceEditor(page, 'Synthetic live');
            await updateSourceDialog(dialog, {
                title: `Synthetic ${name}`,
                userAgent: `IPTVnator-tile-${name}`,
            });
            await saveSourceDialog(page, dialog);
        }
        const openLive = async (title: string) => {
            await openSources(page);
            await sourceRowByTitle(page, title).first().click();
            await page
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await page.locator('.context-panel .category-item').first().click();
        };
        const response = (file: string) =>
            page.waitForResponse((r) => r.url().endsWith(`/${file}`), {
                timeout: 60_000,
            });

        // Watch a channel of B so that it is recently viewed.
        await openLive('Synthetic B');
        await liveChannels(page).nth(1).click();
        await expectLiveFormatPlaying(page, 'html5');
        await page.waitForTimeout(3000);

        await openLive('Synthetic A');
        const mainResponse = response('10000.ts');
        await liveChannels(page).first().click();
        await expectLiveFormatPlaying(page, 'html5');
        expect(
            await (await mainResponse).headerValue('x-fixture-user-agent')
        ).toBe('IPTVnator-tile-A');

        const video = page.locator('app-web-player-view video').first();
        const box = await video.boundingBox();
        await page.mouse.move(
            (box?.x ?? 0) + (box?.width ?? 0) / 2,
            (box?.y ?? 0) + (box?.height ?? 0) / 2
        );
        await page.getByTestId('player-controls-multiview').click();
        await page.getByTestId('multiview-picker-section-recent').click();
        const fromB = page
            .locator('app-multiview-picker-row')
            .filter({ hasText: 'Synthetic B' })
            .first();
        await expect(fromB).toBeVisible();

        const tileResponse = response('10001.ts');
        await fromB.click();
        await expect(tiles(page)).toHaveCount(2);
        expect(
            await (await tileResponse).headerValue('x-fixture-user-agent')
        ).toBe('IPTVnator-tile-B');
        await expectTilePlaying(page, 'pip');
        await expectTilePlaying(page, 'main');
    });
});
