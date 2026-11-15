import { ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
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
} from './electron-test-fixtures';
import {
    getEmbeddedMpvSupport,
    getLatestSession,
    installEmbeddedMpvSessionCapture,
} from './embedded-mpv-frame-copy-packaged-fixtures';
import { createGridMedia } from './multiview-grid-mpv-media';

const title = (number: number) => `Synthetic grid channel ${number}`;
const canvasSelector = 'canvas[data-embedded-mpv-frame]';
const slotSelector = '[data-multiview-slot]';

function helperPids(electronPid: number | undefined): number[] {
    return execFileSync('ps', ['-axo', 'ppid=,pid=,args='], {
        encoding: 'utf8',
    })
        .split('\n')
        .flatMap((line) => {
            const match = line
                .trim()
                .match(/^(\d+)\s+(\d+)\s+.*\biptvnator_mpv_helper(?:\s|$)/);
            return match && Number(match[1]) === electronPid
                ? [Number(match[2])]
                : [];
        });
}

async function expectEqualGridCells(stage: Locator) {
    await expect
        .poll(() =>
            stage.locator(slotSelector).evaluateAll((nodes) => {
                if (nodes.length !== 4) return false;
                const [topLeft, topRight, bottomLeft, bottomRight] = nodes.map(
                    (node) => node.getBoundingClientRect()
                );
                return (
                    topLeft.width > 0 &&
                    topLeft.height > 0 &&
                    [topRight, bottomLeft, bottomRight].every(
                        (cell) =>
                            Math.abs(cell.width - topLeft.width) <= 1 &&
                            Math.abs(cell.height - topLeft.height) <= 1
                    ) &&
                    Math.abs(topLeft.x - bottomLeft.x) <= 1 &&
                    Math.abs(topRight.x - bottomRight.x) <= 1 &&
                    Math.abs(topLeft.y - topRight.y) <= 1 &&
                    Math.abs(bottomLeft.y - bottomRight.y) <= 1 &&
                    topLeft.right <= topRight.left &&
                    topLeft.bottom <= bottomLeft.top
                );
            })
        )
        .toBe(true);
}

async function sampleGridFrames(page: Page, stage: Locator): Promise<Buffer[]> {
    const regions = await stage.locator(canvasSelector).evaluateAll((nodes) =>
        nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            // Keep the sample inside the video, away from selection borders and both control docks.
            return {
                left: Math.round(rect.left + rect.width * 0.2),
                top: Math.round(rect.top + rect.height * 0.3),
                width: Math.floor(rect.width * 0.6),
                height: Math.floor(rect.height * 0.3),
            };
        })
    );
    const screenshot = await page.screenshot({ scale: 'css' });
    return Promise.all(
        regions.map((region) =>
            sharp(screenshot)
                .extract(region)
                .resize(48, 24)
                .removeAlpha()
                .raw()
                .toBuffer()
        )
    );
}

function frameChanged(previous: Buffer, current: Buffer): boolean {
    // Count changes in video pixels across samples, excluding black attachment flashes.
    if (
        !previous.some((value) => value > 32) ||
        !current.some((value) => value > 32)
    )
        return false;
    let changed = 0;
    for (let i = 0; i < current.length; i += 3) {
        if (
            Math.max(
                Math.abs(current[i] - previous[i]),
                Math.abs(current[i + 1] - previous[i + 1]),
                Math.abs(current[i + 2] - previous[i + 2])
            ) > 16
        )
            changed += 1;
    }
    return changed > current.length / 100;
}

test('@playback @electron four frame-copy views retain their sessions through grid layout and recovery', async ({
    dataDir,
}, testInfo) => {
    test.setTimeout(120_000);
    const app = await launchElectronApp(dataDir, {
        env: {
            IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
            IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: '1',
            IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
        },
    });
    let media: Awaited<ReturnType<typeof createGridMedia>> | undefined;
    try {
        const support = await getEmbeddedMpvSupport(app);
        test.skip(
            !support.supported || support.engine !== 'frame-copy',
            'Requires real frame-copy runtime'
        );
        media = await createGridMedia();
        const requests = media.requests;
        const page = app.mainWindow;
        const electronPid = app.electronApp.process().pid;
        const expectHelpers = async (count: number) => {
            if (process.platform !== 'win32') {
                await expect
                    .poll(() => helperPids(electronPid).length)
                    .toBe(count);
            }
        };
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('embedded-mpv').click();
        await saveSettings(page);
        await goToDashboard(page);
        const playlist = join(dataDir, 'synthetic-grid.m3u');
        writeFileSync(
            playlist,
            [
                '#EXTM3U',
                ...media.urls.map(
                    (url, index) => `#EXTINF:-1,${title(index + 1)}\n${url}`
                ),
                `#EXTINF:-1,Synthetic unavailable\n${media.unavailableUrl}`,
                '',
            ].join('\n')
        );
        await installEmbeddedMpvSessionCapture(app);
        await importM3uPlaylistFromNativeDialog(app, playlist);
        await channelItemByTitle(page, title(1)).click();

        const stage = page.locator('.embedded-mpv-pair');
        const strip = stage.locator('.second-stream__strip');
        const tile = (slot: number) =>
            stage.locator(`[data-multiview-slot="${slot}"]`);
        const canvas = (slot: number) => tile(slot).locator(canvasSelector);
        const control = (slot: number) =>
            strip.getByRole('button', {
                name: `Control ${title(slot)} · Window ${slot}`,
                exact: true,
            });
        const empty = (slot: number) =>
            stage.getByRole('button', {
                name: `Add stream to window ${slot}`,
                exact: true,
            });
        const picker = (slot: number) =>
            page.getByRole('dialog', {
                name: `Choose a stream for window ${slot}`,
                exact: true,
            });
        const multiview = page.getByRole('button', {
            name: 'Multiview',
            exact: true,
        });
        const openGrid = page.getByRole('menuitem', {
            name: 'Open 2×2 grid',
            exact: true,
        });
        const add = strip.getByRole('button', {
            name: 'Add stream',
            exact: true,
        });
        const addFromDock = page.getByRole('menuitem', {
            name: 'Add stream',
            exact: true,
        });
        const grid = strip.getByRole('button', {
            name: '2×2 grid',
            exact: true,
        });
        const beside = strip.getByRole('button', {
            name: 'Side by side',
            exact: true,
        });
        const floating = strip.getByRole('button', {
            name: 'Floating window',
            exact: true,
        });
        const latest = (id: string) => getLatestSession(app, id);
        const readId = async (slot: number) => {
            await expect(canvas(slot)).toHaveAttribute('data-session-id', /.+/);
            const id = await canvas(slot).getAttribute('data-session-id');
            if (!id) throw new Error(`Missing session in window ${slot}`);
            return id;
        };
        const rememberPlaying = async (slot: number) => {
            const id = await readId(slot);
            await expect
                .poll(async () => (await latest(id))?.status)
                .toBe('playing');
            await canvas(slot).evaluate(
                (node, id) =>
                    node.setAttribute('data-original-test-session', id),
                id
            );
            return id;
        };
        const sameCanvas = async (slot: number, id: string) => {
            await expect(canvas(slot)).toHaveAttribute('data-session-id', id);
            await expect(canvas(slot)).toHaveAttribute(
                'data-original-test-session',
                id
            );
        };
        const choose = async (slot: number, name = title(slot)) => {
            const dialog = picker(slot);
            await dialog
                .getByLabel('Playlist', { exact: true })
                .selectOption({ label: 'synthetic-grid' });
            await dialog
                .getByTestId('channel-item')
                .filter({
                    has: page
                        .locator('.channel-name')
                        .and(page.getByText(name, { exact: true })),
                })
                .getByRole('button')
                .click();
            await expect(dialog).toHaveCount(0);
        };
        const fullHeight = async () => {
            await expect(strip).toHaveCount(0);
            await expect
                .poll(async () => {
                    const player = await canvas(1).boundingBox();
                    const available = await stage.boundingBox();
                    return (
                        player &&
                        available &&
                        Math.abs(player.height - available.height) <= 1
                    );
                })
                .toBe(true);
        };

        const one = await rememberPlaying(1);
        await fullHeight();
        await expectHelpers(1);
        await multiview.press('Enter');
        await addFromDock.press('Enter');
        await expect(picker(2).getByRole('searchbox')).toBeFocused();
        await fullHeight();
        await page.keyboard.press('Escape');
        await expect(picker(2)).toHaveCount(0);
        await expect(multiview).toBeFocused();
        await fullHeight();
        await multiview.press('Enter');
        await openGrid.press('Enter');
        await expect(stage).toBeFocused();
        await expect(grid).toHaveAttribute('aria-pressed', 'true');
        await expectEqualGridCells(stage);
        for (const slot of [2, 3, 4]) await expect(empty(slot)).toBeVisible();
        await expect(stage.locator(canvasSelector)).toHaveCount(1);
        await expectHelpers(1);

        await stage
            .getByTestId('player-controls-settings-button')
            .press('Enter');
        const settingsPanel = stage.getByTestId(
            'player-controls-settings-panel'
        );
        await expect(settingsPanel).toBeVisible();
        await strip
            .getByRole('button', { name: 'Exit multiview, keeping window 1' })
            .press('Enter');
        await expect(multiview).toBeFocused();
        await expect(settingsPanel).toHaveCount(0);
        await multiview.press('Enter');
        await openGrid.press('Enter');
        await expect(stage).toBeFocused();

        await empty(4).press('Enter');
        await choose(4);
        const four = await rememberPlaying(4);
        await expect(control(4)).toBeFocused();
        await stage.press('4');
        await stage.press('k');
        await expect
            .poll(async () => (await latest(four))?.status)
            .toBe('paused');
        const pausedAt = (await latest(four))?.positionSeconds;
        const primaryAt = (await latest(one))?.positionSeconds;
        ok(primaryAt !== undefined);
        const twoViewRequests = [...requests];
        for (const layout of [beside, floating, grid]) {
            await layout.click();
            await expect(layout).toHaveAttribute('aria-pressed', 'true');
            await sameCanvas(1, one);
            await sameCanvas(4, four);
            expect(await latest(four)).toMatchObject({
                status: 'paused',
                positionSeconds: pausedAt,
            });
            expect((await latest(one))?.positionSeconds).toBeGreaterThanOrEqual(
                primaryAt
            );
            expect(requests).toEqual(twoViewRequests);
        }
        await expectEqualGridCells(stage);

        await add.click();
        await choose(2);
        const two = await rememberPlaying(2);
        await empty(3).click();
        await choose(3);
        const three = await rememberPlaying(3);
        await expect(stage.locator(canvasSelector)).toHaveCount(4);
        await expectEqualGridCells(stage);
        await expectHelpers(4);
        await expect(add).toBeDisabled();
        await expect(beside).toBeDisabled();
        await expect(floating).toBeDisabled();

        const all = [one, two, three, four];
        const snapshots = () => Promise.all(all.map(latest));
        await expect
            .poll(async () =>
                (await snapshots()).every(
                    (session) => (session?.audioTracks.length ?? 0) > 0
                )
            )
            .toBe(true);
        await control(1).click();
        await expect(control(1)).toHaveAttribute('aria-pressed', 'true');
        const soundFromTwo = strip.getByRole('button', {
            name: `Sound from ${title(2)} · Window 2`,
            exact: true,
        });
        await soundFromTwo.click();
        await expect(soundFromTwo).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('4');
        await expect(control(4)).toHaveAttribute('aria-pressed', 'true');
        await expect(control(2)).toHaveAttribute('aria-pressed', 'false');
        const volumes = async () =>
            (await snapshots()).map((session) => session?.volume);
        await expect.poll(volumes).toEqual([0, expect.any(Number), 0, 0]);
        await expect.poll(async () => (await volumes())[1]).toBeGreaterThan(0);
        const volume = (await volumes())[1];
        ok(volume !== undefined);
        await stage.press('ArrowDown');
        await expect
            .poll(async () => (await volumes())[1])
            .toBeLessThan(volume);
        await stage.press('m');
        await expect.poll(volumes).toEqual([0, 0, 0, 0]);
        await stage.press('m');
        await expect.poll(async () => (await volumes())[1]).toBeGreaterThan(0);
        expect((await latest(four))?.status).toBe('paused');
        await stage.press('k');
        await expect
            .poll(async () =>
                (await snapshots()).map((session) => session?.status)
            )
            .toEqual(['playing', 'playing', 'playing', 'playing']);

        await strip.hover();
        let previous = await sampleGridFrames(page, stage);
        await expect
            .poll(async () => {
                const current = await sampleGridFrames(page, stage);
                const moving = current.map((frame, index) =>
                    frameChanged(previous[index], frame)
                );
                previous = current;
                return moving;
            })
            .toEqual([true, true, true, true]);
        await testInfo.attach('Four synthetic streams in Multiview', {
            body: await stage.screenshot(),
            contentType: 'image/png',
        });

        const replace = (slot: number) =>
            strip.getByRole('button', {
                name: `Replace stream in window ${slot}`,
                exact: true,
            });
        const fullscreen = () =>
            page.evaluate(() => Boolean(document.fullscreenElement));
        await stage.press('f');
        await expect.poll(fullscreen).toBe(true);
        await expectEqualGridCells(stage);
        await replace(3).click();
        await expect(picker(3).getByRole('searchbox')).toBeFocused();
        expect(
            await picker(3).evaluate((dialog) =>
                document.fullscreenElement?.contains(dialog)
            )
        ).toBe(true);
        await page.keyboard.press('Escape');
        await expect(picker(3)).toHaveCount(0);
        await expect(replace(3)).toBeFocused();
        await expect.poll(fullscreen).toBe(true);

        const survivorRequests = () => [requests[0], requests[2], requests[3]];
        const beforeRecovery = survivorRequests();
        const beforeClose =
            process.platform === 'win32' ? [] : helperPids(electronPid);
        const unchangedSurvivors = async () => {
            for (const [slot, id] of [
                [1, one],
                [3, three],
                [4, four],
            ] as const)
                await sameCanvas(slot, id);
            expect(survivorRequests()).toEqual(beforeRecovery);
        };
        await control(2).click();
        await expect(control(2)).toHaveAttribute('aria-pressed', 'true');
        await strip
            .getByRole('button', { name: 'Close window 2', exact: true })
            .click();
        await expect(empty(2)).toBeFocused();
        await expect(control(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(beside).toBeDisabled();
        await expect
            .poll(async () => (await latest(two))?.status)
            .toBe('closed');
        await expectHelpers(3);
        if (process.platform !== 'win32') {
            expect(
                helperPids(electronPid).every((pid) =>
                    beforeClose.includes(pid)
                )
            ).toBe(true);
        }
        await unchangedSurvivors();

        await empty(2).click();
        await choose(2, 'Synthetic unavailable');
        const failed = await readId(2);
        expect(failed).not.toBe(two);
        const retry = tile(2)
            .getByRole('alert')
            .getByRole('button', { name: 'Retry', exact: true });
        await retry.click();
        await expect(canvas(2)).not.toHaveAttribute('data-session-id', failed);
        const retried = await readId(2);
        await expect
            .poll(async () => (await latest(failed))?.status)
            .toBe('closed');
        await unchangedSurvivors();
        await replace(2).click();
        await choose(2);
        await expect(canvas(2)).not.toHaveAttribute('data-session-id', retried);
        const recovered = await rememberPlaying(2);
        expect(new Set([two, failed, retried, recovered]).size).toBe(4);
        await expect
            .poll(async () => (await latest(retried))?.status)
            .toBe('closed');
        await expectHelpers(4);
        await unchangedSurvivors();

        await strip
            .getByRole('button', {
                name: 'Exit multiview, keeping window 1',
                exact: true,
            })
            .click();
        await expect(multiview).toBeFocused();
        await expect.poll(fullscreen).toBe(true);
        await fullHeight();
        await sameCanvas(1, one);
        await expect(stage.locator(canvasSelector)).toHaveCount(1);
        for (const id of [recovered, three, four])
            await expect
                .poll(async () => (await latest(id))?.status)
                .toBe('closed');
        await expectHelpers(1);
        await canvas(1).hover();
        await stage
            .getByRole('button', { name: 'Exit fullscreen', exact: true })
            .click();
        await expect.poll(fullscreen).toBe(false);
        await fullHeight();

        await multiview.click();
        await addFromDock.click();
        await choose(2);
        const reopened = await rememberPlaying(2);
        await expect(stage).toBeFocused();
        await goToDashboard(page);
        await expect(page.locator(canvasSelector)).toHaveCount(0);
        for (const id of [one, reopened])
            await expect
                .poll(async () => (await latest(id))?.status)
                .toBe('closed');
        await expectHelpers(0);
    } finally {
        try {
            await closeElectronApp(app);
        } finally {
            await media?.close();
        }
    }
});
