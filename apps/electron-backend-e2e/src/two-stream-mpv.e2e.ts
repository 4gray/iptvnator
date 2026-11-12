import { execFileSync } from 'node:child_process';
import sharp = require('sharp');
import {
    applyTheme,
    expectTextContrast,
    expectOverlayContrastOnWhite,
} from './theme-contrast';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
    workspaceRoot,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    createLocalMediaServer,
    installEmbeddedMpvSessionCapture,
} from './embedded-mpv-frame-copy-packaged-fixtures';

test('@playback @electron two frame-copy views keep sessions through swap, pause and close', async ({
    dataDir,
}, testInfo) => {
    test.setTimeout(120000);
    const media = await createLocalMediaServer({
        body: readFileSync(
            join(
                workspaceRoot,
                'apps/web-e2e/src/fixtures/playback/two-stream-vod.webm'
            )
        ),
        resourcePath: '/synthetic-movie.webm',
        contentType: 'video/webm',
    });
    const live = await createLocalMediaServer({
        body: readFileSync(
            join(
                workspaceRoot,
                'apps/web-e2e/src/fixtures/playback/two-stream-live.webm'
            )
        ),
        resourcePath: '/synthetic-live.webm',
        contentType: 'video/webm',
    });
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
                IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: '1',
                IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
            },
        });
        const mainPid = app.electronApp.process().pid;
        const helperCount = () =>
            execFileSync('ps', ['-axo', 'ppid=,comm='], { encoding: 'utf8' })
                .split('\n')
                .filter(
                    (line) =>
                        Number(line.trim().split(/\s+/)[0]) === mainPid &&
                        line.includes('iptvnator_mpv_helper')
                ).length;
        const page = app.mainWindow;

        const support = await page.evaluate(() =>
            window.electron.getEmbeddedMpvSupport()
        );
        test.skip(
            !support.supported || support.engine !== 'frame-copy',
            `Requires real frame-copy runtime: ${JSON.stringify(support)}`
        );
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('embedded-mpv').click();
        await saveSettings(page);
        await goToDashboard(page);
        const playlist = join(dataDir, 'synthetic-pair.m3u');
        writeFileSync(
            playlist,
            `#EXTM3U\n#EXTINF:-1 group-title="Movies",Synthetic movie\n${media.url}\n#EXTINF:-1 group-title="Live",Synthetic live\n${live.url}\n#EXTINF:-1 group-title="Live",Synthetic unavailable\n${new URL('/missing.webm', live.url).href}\n`
        );
        await installEmbeddedMpvSessionCapture(app);
        await importM3uPlaylistFromNativeDialog(app, playlist);
        await channelItemByTitle(page, 'Synthetic live')
            .locator('.favorite-button')
            .click();
        await channelItemByTitle(page, 'Synthetic movie').first().click();
        const canvases = page.locator('canvas[data-embedded-mpv-frame]');
        await expect(canvases).toHaveCount(1);
        await expect
            .poll(() => canvases.first().getAttribute('data-session-id'))
            .toBeTruthy();
        const firstId = await canvases.first().getAttribute('data-session-id');
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    firstId
                )
            )
            .toBe('playing');
        await page
            .locator('.embedded-mpv-pair > app-embedded-mpv-player')
            .hover();
        const addStream = page.getByTestId(
            'player-controls-second-stream-button'
        );
        const streamInfo = page.getByTestId(
            'player-controls-stream-info-button'
        );
        const addBounds = await addStream.boundingBox();
        const infoBounds = await streamInfo.boundingBox();
        expect(addBounds!.x + addBounds!.width).toBeLessThanOrEqual(
            infoBounds!.x
        );
        expect(addBounds!.y).toBe(infoBounds!.y);
        await addStream.hover();
        await expect(page.locator('.mat-mdc-tooltip-show')).toHaveText(
            'Add second stream'
        );
        await page.screenshot({
            path: testInfo.outputPath('second-stream-action.png'),
        });
        await page
            .getByRole('button', { name: 'Add second stream', exact: true })
            .click();
        const picker = page.getByRole('dialog', {
            name: 'Choose a second channel',
        });
        await expect(
            picker.getByRole('button', { name: 'Synthetic live', exact: true })
        ).toBeVisible();
        await picker
            .getByLabel('Playlist', { exact: true })
            .selectOption({ label: 'synthetic-pair' });
        await picker
            .getByRole('navigation', { name: 'Groups' })
            .getByRole('button', { name: 'Live', exact: true })
            .click();
        await picker
            .getByRole('searchbox', { name: 'Search channels' })
            .fill('Synthetic live');
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await expectTextContrast(picker.locator('h2'));
            await expectTextContrast(picker.locator('.channel-name'));
            await page.screenshot({
                path: testInfo.outputPath(`two-stream-picker-${theme}.png`),
            });
        }
        await applyTheme(page, 'light');
        await picker
            .getByRole('button', { name: 'Synthetic live', exact: true })
            .click();
        await expect(canvases).toHaveCount(2);
        await expect
            .poll(() => canvases.nth(1).getAttribute('data-session-id'))
            .toBeTruthy();
        let secondId = await canvases.nth(1).getAttribute('data-session-id');
        await expect(canvases.nth(1)).not.toHaveAttribute(
            'data-session-id',
            firstId!
        );
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    secondId
                )
            )
            .toBe('playing');
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.volume,
                    secondId
                )
            )
            .toBe(0);
        await expect
            .poll(() =>
                canvases.evaluateAll((nodes) =>
                    nodes.every(
                        (node) => (node as HTMLCanvasElement).width > 300
                    )
                )
            )
            .toBe(true);
        if (process.platform !== 'win32')
            await expect.poll(helperCount).toBe(2);
        for (const id of [firstId, secondId]) {
            await expect
                .poll(() =>
                    page.evaluate(
                        (sessionId) =>
                            window.__packagedEmbeddedMpvSessions
                                ?.filter((s) => s.id === sessionId)
                                .at(-1)?.audioTracks.length ?? 0,
                        id
                    )
                )
                .toBeGreaterThan(0);
        }
        // Distinct synthetic patterns must reach both real canvases.
        for (const canvas of await canvases.all()) {
            const stats = await sharp(await canvas.screenshot()).stats();
            expect(
                Math.max(
                    ...stats.channels
                        .slice(0, 3)
                        .map((channel) => channel.stdev)
                )
            ).toBeGreaterThan(20);
        }
        const firstPosition = await page.evaluate(
            (id) =>
                window.__packagedEmbeddedMpvSessions
                    ?.filter((s) => s.id === id)
                    .at(-1)?.positionSeconds ?? 0,
            firstId
        );
        const tile = page.getByRole('group', {
            name: 'Small video',
            exact: true,
        });
        await tile.hover();
        const initialBox = (await tile.boundingBox())!;
        const handle = page.getByRole('button', {
            name: 'Move small video. Arrow keys move it too.',
        });
        const moveTile = async (x: number, y: number) => {
            await tile.hover();
            const box = (await handle.boundingBox())!;
            await page.mouse.move(box.x + 20, box.y + 20);
            await page.mouse.down();
            await page.mouse.move(x + 20, y + 20, { steps: 10 });
            await page.mouse.up();
        };
        const stage = (await page.locator('.embedded-mpv-pair').boundingBox())!;
        await moveTile(100, 160);
        expect((await tile.boundingBox())!.x).toBeLessThan(stage.x);
        await expect
            .poll(() =>
                tile.evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    return el.contains(
                        document.elementFromPoint(rect.x + 30, rect.y + 30)
                    );
                })
            )
            .toBe(true);
        await page.screenshot({
            path: testInfo.outputPath('two-stream-over-channels.png'),
        });
        // Floating surfaces must yield to backdrop menus, retaining both sessions.
        await page
            .locator('button')
            .filter({ hasText: 'sort_by_alpha' })
            .click();
        await expect(page.locator('.cdk-overlay-backdrop')).toBeVisible();
        await expect(tile).toBeHidden();
        await expect(page.locator('.second-stream__video')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(tile).toBeVisible();
        await expect(canvases.nth(1)).toHaveAttribute(
            'data-session-id',
            secondId!
        );
        await moveTile(stage.x + 50, stage.y + stage.height + 20);
        expect((await tile.boundingBox())!.y).toBeGreaterThan(
            stage.y + stage.height
        );
        await expect
            .poll(() =>
                tile.evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    return el.contains(
                        document.elementFromPoint(rect.x + 30, rect.y + 30)
                    );
                })
            )
            .toBe(true);
        const outsideStats = await sharp(
            await canvases.nth(1).screenshot()
        ).stats();
        expect(
            Math.max(...outsideStats.channels.slice(0, 3).map((c) => c.stdev))
        ).toBeGreaterThan(20);
        await page.screenshot({
            path: testInfo.outputPath('two-stream-over-epg.png'),
        });
        // Real pointer resize keeps both native canvases mounted and 16:9.
        const resizeLeft = tile.locator('[data-corner="left"]');
        const resizeRight = tile.locator('[data-corner="right"]');
        const resizeBox = (await resizeLeft.boundingBox())!;
        const widthBeforeResize = (await tile.boundingBox())!.width;
        await page.mouse.move(resizeBox.x + 12, resizeBox.y + 12);
        await page.mouse.down();
        await page.mouse.move(resizeBox.x - 84, resizeBox.y + 66, {
            steps: 10,
        });
        await page.mouse.up();
        await expect
            .poll(async () => Math.round((await tile.boundingBox())!.width))
            .toBe(Math.round(widthBeforeResize + 96));
        const resizedBox = (await tile.boundingBox())!;
        expect(resizedBox.width / resizedBox.height).toBeCloseTo(16 / 9, 1);
        await expect(canvases.nth(1)).toHaveAttribute(
            'data-session-id',
            secondId!
        );
        await expect
            .poll(async () => (await canvases.nth(1).boundingBox())!.width)
            .toBeGreaterThan(widthBeforeResize);
        await resizeRight.focus();
        await page.keyboard.press('Home');
        await expect(resizeRight).toHaveAttribute('aria-valuenow', '240');
        for (let step = 0; step < 5; step++)
            await page.keyboard.press('ArrowRight');
        await expect(resizeRight).toHaveAttribute('aria-valuenow', '320');
        expect((await tile.boundingBox())!.x).toBeLessThan(initialBox.x - 50);
        await handle.focus();
        await page.keyboard.press('ArrowLeft');
        await page
            .getByRole('button', { name: 'Swap main and small views' })
            .click();
        await expect(page.locator('.embedded-mpv-pair')).toHaveClass(/swapped/);
        await expect(canvases.first()).toHaveAttribute(
            'data-session-id',
            firstId!
        );
        await expect(canvases.nth(1)).toHaveAttribute(
            'data-session-id',
            secondId!
        );
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.volume,
                    firstId
                )
            )
            .toBe(0);
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.positionSeconds ?? 0,
                    firstId
                )
            )
            .toBeGreaterThanOrEqual(firstPosition);
        await tile.hover();
        await page.getByRole('button', { name: 'Pause small view' }).click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    firstId
                )
            )
            .toBe('paused');
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    secondId
                )
            )
            .toBe('playing');
        const beforeFullscreen = (await tile.boundingBox())!;
        await page.locator('.second-stream__video--main').hover();
        await page
            .getByRole('button', { name: 'Enter fullscreen', exact: true })
            .click();
        await expect
            .poll(() =>
                page.evaluate(() => Boolean(document.fullscreenElement))
            )
            .toBe(true);
        await expect(canvases.first()).toHaveAttribute(
            'data-session-id',
            firstId!
        );
        await expect(canvases.nth(1)).toHaveAttribute(
            'data-session-id',
            secondId!
        );
        await page.locator('.second-stream__video--main').hover();
        await page
            .getByRole('button', { name: 'Exit fullscreen', exact: true })
            .click();
        await expect
            .poll(() =>
                page.evaluate(() => Boolean(document.fullscreenElement))
            )
            .toBe(false);
        await expect
            .poll(async () => Math.round((await tile.boundingBox())!.x))
            .toBe(Math.round(beforeFullscreen.x));
        await expect
            .poll(async () => Math.round((await tile.boundingBox())!.y))
            .toBe(Math.round(beforeFullscreen.y));
        await expect
            .poll(async () => Math.round((await tile.boundingBox())!.width))
            .toBe(Math.round(beforeFullscreen.width));
        for (const theme of ['dark', 'light']) {
            await applyTheme(page, theme as 'dark' | 'light');
            await tile.focus();
            await expect(page.locator('.second-stream__bottom')).toHaveCSS(
                'opacity',
                '1'
            );
            await expectTextContrast(
                page.locator('.second-stream__bottom > span')
            );
            await expectOverlayContrastOnWhite(
                tile,
                tile.getByRole('button', { name: 'Swap main and small views' })
            );
            await expect(page.locator('.second-stream__top')).toHaveCSS(
                'background-color',
                'rgba(0, 0, 0, 0)'
            );
            await page.screenshot({
                path: testInfo.outputPath(`two-stream-polished-${theme}.png`),
            });
            await page.locator('.embedded-mpv-pair').evaluate((el) => {
                (document.activeElement as HTMLElement)?.blur();
                el.focus();
            });
            await page.mouse.move(100, 100);
            await expect(page.locator('.second-stream__bottom')).toHaveCSS(
                'opacity',
                '0'
            );
            await page.screenshot({
                path: testInfo.outputPath(`two-stream-${theme}.png`),
            });
        }
        // Move the floating video clear of the main player's recovery controls.
        await tile.hover();
        const recoveryHandle = (await handle.boundingBox())!;
        const stageBox = (await page
            .locator('.embedded-mpv-pair')
            .boundingBox())!;
        await page.mouse.move(recoveryHandle.x + 16, recoveryHandle.y + 16);
        await page.mouse.down();
        await page.mouse.move(stageBox.x + stageBox.width, stageBox.y + 16, {
            steps: 4,
        });
        await page.mouse.up();
        // Retry of the promoted companion preserves its sound; the film stays paused.
        const previousSecondId = secondId;
        await page.evaluate(
            async ({ id, url }) => {
                if (id)
                    await window.electron.loadEmbeddedMpvPlayback(id, {
                        title: 'Synthetic unavailable stream',
                        streamUrl: url,
                        isLive: true,
                    });
            },
            { id: secondId, url: new URL('/missing.webm', live.url).href }
        );
        await page
            .locator('app-second-stream .embedded-mpv-player__stalled')
            .getByRole('button', { name: 'Retry', exact: true })
            .click();
        await expect
            .poll(() => canvases.nth(1).getAttribute('data-session-id'))
            .not.toBe(previousSecondId);
        secondId = await canvases.nth(1).getAttribute('data-session-id');
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.volume ?? 0,
                    secondId
                )
            )
            .toBeGreaterThan(0);
        await page
            .getByRole('button', { name: 'Swap main and small views' })
            .focus();
        // Merely moving focus never resumes the film or changes audio ownership.
        expect(
            await page.evaluate(
                (id) =>
                    window.__packagedEmbeddedMpvSessions
                        ?.filter((s) => s.id === id)
                        .at(-1)?.status,
                firstId
            )
        ).toBe('paused');
        await tile.hover();
        await page
            .getByRole('button', { name: 'Close second stream and return' })
            .click();
        await expect(canvases).toHaveCount(1);
        await expect(canvases.first()).toHaveAttribute(
            'data-session-id',
            firstId!
        );
        await expect(page.locator('.embedded-mpv-pair')).not.toHaveClass(
            /swapped/
        );
        expect(
            await page.evaluate(
                (id) =>
                    window.__packagedEmbeddedMpvSessions
                        ?.filter((s) => s.id === id)
                        .at(-1)?.status,
                firstId
            )
        ).toBe('paused');
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    secondId
                )
            )
            .toBe('closed');
        const play = page.getByTestId('player-controls-play');
        await play.focus();
        await play.press('Space');
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    firstId
                )
            )
            .toBe('playing');
        await page
            .locator('.embedded-mpv-pair > app-embedded-mpv-player')
            .hover();
        await page
            .getByRole('button', { name: 'Add second stream', exact: true })
            .click();
        await picker
            .getByLabel('Playlist', { exact: true })
            .selectOption({ label: 'synthetic-pair' });
        await picker
            .getByRole('button', { name: 'Synthetic unavailable', exact: true })
            .click();
        await expect(
            page.locator('app-second-stream .embedded-mpv-player__stalled')
        ).toBeVisible();
        await expect(canvases.first()).toHaveAttribute(
            'data-session-id',
            firstId!
        );
        // Recover the failed small view by choosing a different channel.
        const changeChannel = tile.getByRole('button', {
            name: 'Change second channel',
        });
        await tile.hover();
        const failedId = await canvases.nth(1).getAttribute('data-session-id');
        await changeChannel.click();
        await expect(picker).toBeVisible();
        await expect(tile).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect(canvases.nth(1)).toHaveAttribute(
            'data-session-id',
            failedId!
        );

        await tile.hover();
        await changeChannel.click();
        await picker
            .getByRole('button', { name: 'Synthetic live', exact: true })
            .click();
        await expect(picker).toBeHidden();
        await expect(canvases.first()).toHaveAttribute(
            'data-session-id',
            firstId!
        );
        await expect
            .poll(async () => {
                const id = await canvases
                    .nth(1)
                    .getAttribute('data-session-id');
                if (!id || id === failedId) return null;
                return page.evaluate((sessionId) => {
                    const session = window.__packagedEmbeddedMpvSessions
                        ?.filter((s) => s.id === sessionId)
                        .at(-1);
                    return (
                        session && {
                            status: session.status,
                            volume: session.volume,
                        }
                    );
                }, id);
            })
            .toEqual({ status: 'playing', volume: 0 });
        await expect(page.locator('.second-stream__video[popover]')).toHaveCSS(
            'border-radius',
            '8px'
        );

        await tile.hover();
        await page
            .getByRole('button', { name: 'Close second stream and return' })
            .click();
        await expect(canvases).toHaveCount(1);
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((s) => s.id === id)
                            .at(-1)?.status,
                    firstId
                )
            )
            .toBe('playing');
        if (process.platform !== 'win32')
            await expect.poll(helperCount).toBe(1);
        const remaining = await sharp(
            await canvases.first().screenshot()
        ).stats();
        expect(
            Math.max(
                ...remaining.channels
                    .slice(0, 3)
                    .map((channel) => channel.stdev)
            )
        ).toBeGreaterThan(20);
    } finally {
        if (app) await closeElectronApp(app);
        await Promise.all([media.close(), live.close()]);
    }
});
