import { ok } from 'node:assert/strict';
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
    alsoClosing,
    createLocalMediaServer,
    installEmbeddedMpvSessionCapture,
    type LocalMediaServer,
} from './embedded-mpv-frame-copy-packaged-fixtures';

test('@playback @electron two frame-copy views keep sessions through swap, pause and close', async ({
    dataDir,
}, testInfo) => {
    test.setTimeout(120000);
    let app: LaunchedElectronApp | undefined;
    let mediaResources: LocalMediaServer | undefined;
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
        // Both sessions use a long playlist of the existing synthetic AAC/video
        // fixture so the full playback test exercises real audio tracks.
        const segment = await createLocalMediaServer({
            body: readFileSync(
                join(
                    workspaceRoot,
                    'apps/xtream-mock-server/src/fixtures/live.mpegts'
                )
            ),
            resourcePath: '/synthetic-segment.ts',
            contentType: 'video/mp2t',
        });
        mediaResources = segment;
        const playlistBody = Buffer.from(
            [
                '#EXTM3U',
                '#EXT-X-VERSION:3',
                '#EXT-X-TARGETDURATION:7',
                '#EXT-X-PLAYLIST-TYPE:VOD',
                ...Array.from({ length: 12 }, (_, index) => [
                    ...(index ? ['#EXT-X-DISCONTINUITY'] : []),
                    '#EXTINF:6.022,',
                    `${segment.url}?segment=${index}`,
                ]).flat(),
                '#EXT-X-ENDLIST',
                '',
            ].join('\n')
        );
        const media = await createLocalMediaServer({
            body: playlistBody,
            resourcePath: '/synthetic-movie.m3u8',
            contentType: 'application/vnd.apple.mpegurl',
        });
        mediaResources = alsoClosing(mediaResources, media);
        const live = await createLocalMediaServer({
            body: playlistBody,
            resourcePath: '/synthetic-live.m3u8',
            contentType: 'application/vnd.apple.mpegurl',
        });
        mediaResources = alsoClosing(mediaResources, live);
        const now = Date.now();
        const xmltvTime = (time: number) =>
            new Date(time).toISOString().slice(0, 19).replace(/\D/g, '') +
            ' +0000';
        const guide = await createLocalMediaServer({
            body: Buffer.from(`<tv>
                <channel id="synthetic-live"><display-name>Synthetic live</display-name></channel>
                <programme channel="synthetic-live" start="${xmltvTime(now - 900_000)}" stop="${xmltvTime(now + 2_700_000)}">
                    <title>Synthetic evening bulletin</title>
                </programme>
            </tv>`),
            resourcePath: '/synthetic-guide.xml',
            contentType: 'application/xml',
        });
        mediaResources = alsoClosing(mediaResources, guide);
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('embedded-mpv').click();
        await saveSettings(page);
        await goToDashboard(page);
        const playlist = join(dataDir, 'synthetic-pair.m3u');
        const channels = [
            ['Movies', 'Synthetic movie', media.url],
            ['Live', 'Synthetic live', live.url],
            [
                'Live',
                'Synthetic unavailable',
                new URL('/missing.webm', live.url).href,
            ],
            ...Array.from({ length: 12 }, (_, index) => [
                'Live',
                `Sample live channel ${index + 1}`,
                `${live.url}?channel=${index + 1}`,
            ]),
            ['News', 'Sample news channel', `${live.url}?channel=news`],
            ['Sports', 'Sample sports channel', `${live.url}?channel=sports`],
            ['Music', 'Sample music channel', `${live.url}?channel=music`],
        ];
        writeFileSync(
            playlist,
            [
                `#EXTM3U x-tvg-url="${guide.url}"`,
                ...channels.map(
                    ([group, title, url]) =>
                        `#EXTINF:-1 group-title="${group}"${title === 'Synthetic live' ? ' tvg-id="synthetic-live"' : ''},${title}\n${url}`
                ),
            ].join('\n')
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
        const multiview = page.getByRole('button', {
            name: 'Multiview',
            exact: true,
        });
        const addStream = page.getByRole('menuitem', {
            name: 'Add stream',
            exact: true,
        });
        const streamInfo = page.getByTestId(
            'player-controls-stream-info-button'
        );
        const settings = page.getByTestId('player-controls-settings-button');
        await expect(multiview.locator('mat-icon')).toHaveText('grid_view');
        await expect(settings).toBeVisible();
        await expect(streamInfo).toBeVisible();
        const addBounds = await multiview.boundingBox();
        const settingsBounds = await settings.boundingBox();
        const infoBounds = await streamInfo.boundingBox();
        ok(addBounds && settingsBounds && infoBounds);
        expect(addBounds.x + addBounds.width).toBeLessThanOrEqual(
            settingsBounds.x
        );
        expect(addBounds.y).toBe(settingsBounds.y);
        expect(addBounds.y).toBeGreaterThan(infoBounds.y);
        await expect(
            page.getByRole('button', {
                name: /^(Enter|Exit) picture-in-picture$/,
            })
        ).toHaveCount(0);
        await multiview.hover();
        await expect(page.locator('.mat-mdc-tooltip-show')).toHaveText(
            'Multiview'
        );
        await page.screenshot({
            path: testInfo.outputPath('second-stream-action.png'),
        });
        await multiview.click();
        await addStream.click();
        const picker = page.getByRole('dialog', {
            name: 'Choose a stream for window 2',
        });
        const pickerSearch = picker.getByRole('searchbox', {
            name: 'Search channels',
        });
        const liveRow = picker.getByTestId('channel-item').filter({
            has: page.locator('.channel-name', { hasText: /^Synthetic live$/ }),
        });
        await expect(liveRow.locator('.epg-title')).toHaveText(
            'Synthetic evening bulletin'
        );
        await expect(liveRow.locator('.epg-time')).toHaveText([
            /^\d\d:\d\d$/,
            /^\d\d:\d\d$/,
        ]);
        await expect(liveRow.locator('.epg-progress-fill')).toHaveAttribute(
            'style',
            /width: (2[4-9]|30)(\.\d+)?%;/
        );
        await expect(pickerSearch).toBeFocused();
        const playerBounds = await page
            .locator('.embedded-mpv-pair')
            .boundingBox();
        const pickerBounds = await picker.boundingBox();
        ok(playerBounds && pickerBounds);
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        expect(pickerBounds.y + pickerBounds.height).toBeGreaterThan(
            playerBounds.y + playerBounds.height
        );
        expect(pickerBounds.y + pickerBounds.height).toBeLessThan(
            viewportHeight
        );
        await page.mouse.click(24, Math.round(viewportHeight / 2));
        await expect(picker).toBeHidden();
        await app.electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
        );
        await multiview.press('Enter');
        await addStream.press('Enter');
        await expect(pickerSearch).toBeFocused();
        await expect(
            picker.getByRole('button', { name: 'Close dialog' })
        ).toBeInViewport();
        await expect(liveRow.getByRole('button')).toBeInViewport();
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect(multiview).toBeFocused();
        await app.electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
        );
        await multiview.click();
        await addStream.click();
        await expect(liveRow.getByRole('button')).toBeVisible();
        await picker
            .getByLabel('Playlist', { exact: true })
            .selectOption({ label: 'synthetic-pair' });
        await picker
            .getByRole('navigation', { name: 'Groups' })
            .getByRole('button', { name: 'Live', exact: true })
            .click();
        await expect(liveRow.locator('.epg-title')).toHaveText(
            'Synthetic evening bulletin'
        );
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await expectTextContrast(picker.locator('h2'));
            await expectTextContrast(picker.locator('.channel-name').first());
            await expectTextContrast(
                picker.getByRole('button', {
                    name: 'All channels',
                    exact: true,
                })
            );
            await page.screenshot({
                path: testInfo.outputPath(`two-stream-picker-${theme}.png`),
            });
        }
        await applyTheme(page, 'light');
        await picker
            .getByRole('button', {
                name: 'Sample live channel 12',
                exact: true,
            })
            .scrollIntoViewIfNeeded();
        await expect(pickerSearch).toBeInViewport();
        await pickerSearch.fill('Sample live channel 12');
        await expect(picker.locator('.channel-name')).toHaveText([
            'Sample live channel 12',
        ]);
        await picker
            .getByRole('button', { name: 'Clear search', exact: true })
            .click();
        await expect(pickerSearch).toBeFocused();
        await liveRow.getByRole('button').click();
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
        // Synthetic frames must reach both real canvases.
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
            name: 'Small view',
            exact: true,
        });
        await expect(tile).toHaveCSS('position', 'fixed');
        await expect(tile).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(page.locator('.second-stream__video[popover]')).toHaveCSS(
            'position',
            'fixed'
        );
        await tile.hover();
        const initialBox = (await tile.boundingBox())!;
        const moveTile = async (x: number, y: number, fromTitle = false) => {
            await tile.hover();
            const target = fromTitle
                ? tile.locator('.second-stream__top > span')
                : tile;
            const box = (await target.boundingBox())!;
            const tileBox = (await tile.boundingBox())!;
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;
            await page.mouse.move(startX, startY);
            await expect(target).toHaveCSS('cursor', 'grab');
            await page.mouse.down();
            await page.mouse.move(
                x + startX - tileBox.x,
                y + startY - tileBox.y,
                { steps: 10 }
            );
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
        await tile.focus();
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
        // The floating tile can move as native fullscreen settles. Focus
        // keeps its controls open while Playwright waits for a stable target.
        await tile.focus();
        await expect(tile.locator('.second-stream__top')).toHaveCSS(
            'opacity',
            '1'
        );
        await tile
            .getByRole('button', { name: 'Change second stream' })
            .click();
        await expect(pickerSearch).toBeFocused();
        await expect(picker).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect
            .poll(() =>
                page.evaluate(() => Boolean(document.fullscreenElement))
            )
            .toBe(true);
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
        // The left/right slots keep their original canvases even after a PiP swap.
        const pair = page.locator('.embedded-mpv-pair');
        const strip = pair.locator('.second-stream__strip');
        const beside = strip.getByRole('button', { name: 'Side by side' });
        const floating = strip.getByRole('button', { name: 'Floating window' });
        const originalControls = strip.getByRole('button', {
            name: 'Control Synthetic movie · Window 1',
        });
        const originalSound = strip.getByRole('button', {
            name: 'Sound from Synthetic movie · Window 1',
        });
        const companionSound = strip.getByRole('button', {
            name: 'Sound from Synthetic live · Window 2',
        });
        const floatingBeforeSideBySide = await tile.boundingBox();
        ok(firstId && secondId);
        await canvases.evaluateAll((nodes) => {
            for (const node of nodes)
                node.setAttribute('data-original-canvas', '');
        });
        const readSessions = () =>
            page.evaluate(
                (ids) =>
                    ids.map((id) =>
                        window.__packagedEmbeddedMpvSessions
                            ?.filter((session) => session.id === id)
                            .at(-1)
                    ),
                [firstId, secondId]
            );
        const pausedPosition = (await readSessions())[0]?.positionSeconds;
        const checkColumns = async () => {
            await expect
                .poll(() =>
                    canvases.evaluateAll((nodes) => {
                        const [left, right] = nodes.map((node) =>
                            node.getBoundingClientRect()
                        );
                        return (
                            left.width > 0 &&
                            Math.abs(left.width - right.width) <= 1 &&
                            left.right <= right.left &&
                            Math.abs(left.top - right.top) <= 1 &&
                            Math.abs(left.height - right.height) <= 1
                        );
                    })
                )
                .toBe(true);
        };
        await beside.focus();
        await beside.press('Enter');
        await expect(beside).toHaveAttribute('aria-pressed', 'true');
        await expect(tile).toHaveCount(0);
        await expect(pair.locator('[popover="manual"]')).toHaveCount(0);
        await checkColumns();
        await expect(companionSound).toHaveAttribute('aria-pressed', 'true');
        await expect(beside).toBeFocused();
        await strip
            .getByRole('button', { name: 'Control Synthetic live · Window 2' })
            .click();
        const companionStatus = async () => (await readSessions())[1]?.status;
        await page.keyboard.press('Space');
        await expect.poll(companionStatus).toBe('paused');
        await page.keyboard.press('Space');
        await expect.poll(companionStatus).toBe('playing');
        await canvases.first().click();
        const selectedHost = pair.locator(
            '.embedded-mpv-player-host--selected'
        );
        await expect(selectedHost.locator('canvas')).toHaveAttribute(
            'data-session-id',
            firstId
        );
        const selectedViewport = selectedHost.locator(
            '.embedded-mpv-player__viewport'
        );
        expect(
            await selectedViewport.evaluate(
                (node) => getComputedStyle(node, '::after').borderTopWidth
            )
        ).toBe('2px');
        await expect(originalControls).toHaveAttribute('aria-pressed', 'true');
        await expect(companionSound).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(readSessions).toMatchObject([
            {
                status: 'paused',
                positionSeconds: pausedPosition,
                volume: 0,
            },
            { status: 'playing' },
        ]);
        await originalSound.click();
        await expect(originalSound).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(readSessions).toMatchObject([
            { status: 'paused', volume: expect.any(Number) },
            { status: 'playing', volume: 0 },
        ]);
        await expect
            .poll(async () => (await readSessions())[0]?.volume ?? 0)
            .toBeGreaterThan(0);
        await companionSound.click();
        await expect(companionSound).toHaveAttribute('aria-pressed', 'true');
        await expect(originalControls).toHaveAttribute('aria-pressed', 'true');
        await canvases.first().hover();
        const readVolumes = async () =>
            (await readSessions()).map((session) => session?.volume);
        await pair.getByRole('button', { name: 'Mute', exact: true }).click();
        await expect.poll(readVolumes).toEqual([0, 0]);
        await pair.getByRole('button', { name: 'Unmute', exact: true }).click();
        await expect
            .poll(async () => (await readVolumes())[1] ?? 0)
            .toBeGreaterThan(0);
        await expect.poll(async () => (await readVolumes())[0]).toBe(0);
        await pair
            .getByRole('button', { name: 'Enter fullscreen', exact: true })
            .click();
        await expect(pair).toBeVisible();
        await expect
            .poll(() =>
                strip.evaluate(
                    (node) =>
                        document.fullscreenElement?.contains(node) ?? false
                )
            )
            .toBe(true);
        await checkColumns();
        await expect(beside).toBeVisible();
        await pair
            .getByRole('button', { name: 'Exit fullscreen', exact: true })
            .click();
        await expect
            .poll(() =>
                page.evaluate(() => document.fullscreenElement === null)
            )
            .toBe(true);
        await expect(pair.locator('[data-feedback-key]')).toHaveCount(0);
        for (const theme of ['dark', 'light'] as const) {
            await applyTheme(page, theme);
            await expectTextContrast(
                originalControls.locator('.second-stream__title')
            );
            await pair.screenshot({
                path: testInfo.outputPath(
                    `two-stream-side-by-side-${theme}.png`
                ),
            });
        }
        await floating.click();
        await expect(floating).toHaveAttribute('aria-pressed', 'true');
        await expect(tile).toBeVisible();
        await expect
            .poll(() => tile.boundingBox())
            .toEqual(floatingBeforeSideBySide);
        await expect(pair.locator('canvas[data-original-canvas]')).toHaveCount(
            2
        );
        await expect(canvases.first()).toHaveAttribute(
            'data-session-id',
            firstId
        );
        await expect(canvases.nth(1)).toHaveAttribute(
            'data-session-id',
            secondId
        );
        await expect.poll(readSessions).toMatchObject([
            {
                status: 'paused',
                positionSeconds: pausedPosition,
                volume: 0,
            },
            { status: 'playing' },
        ]);

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
            const streamStrip = page.locator('.second-stream__strip');
            await expect(streamStrip.locator('li')).toHaveCount(2);
            await expect(streamStrip.locator('li').first()).toContainText(
                'Synthetic live'
            );
            await expectTextContrast(
                streamStrip.locator('.second-stream__title').first()
            );
            await expectTextContrast(
                streamStrip.locator('.second-stream__title').last()
            );
            await expect(
                tile.getByRole('button', { name: 'Swap main and small views' })
            ).toHaveCSS('border-radius', '8px');
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
        const stageBox = (await page
            .locator('.embedded-mpv-pair')
            .boundingBox())!;
        await moveTile(stageBox.x + stageBox.width, stageBox.y + 16, true);
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
        await expect(canvases.nth(1)).not.toHaveAttribute(
            'data-session-id',
            previousSecondId
        );
        await expect(canvases.nth(1)).toHaveAttribute('data-session-id', /.+/);
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
        await multiview.click();
        await addStream.click();
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
            name: 'Change second stream',
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
        await liveRow.getByRole('button').click();
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
        await mediaResources?.close();
    }
});
