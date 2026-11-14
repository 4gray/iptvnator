import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { reloadFromMainProcess } from './renderer-reload.support';

const PIN = '2468';
const PID_KEY = '__parentalLockPlayerPids';

function stopPlayer(pid: number): void {
    try {
        process.kill(pid);
    } catch {
        // Already gone.
    }
}

function playerIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function launchPlayer(
    app: Awaited<ReturnType<typeof launchElectronApp>>,
    playerPath: string,
    title: string
): Promise<number> {
    const before = await app.electronApp.evaluate(
        (_, key) => (Reflect.get(globalThis, key) as number[]).length,
        PID_KEY
    );
    await app.mainWindow.evaluate(
        async ({ playerPath, title }) => {
            await window.electron.setMpvPlayerPath(playerPath);
            await window.electron.openInMpv(
                'https://streams.example.test/synthetic.ts',
                title,
                '',
                ''
            );
        },
        { playerPath, title }
    );
    await expect
        .poll(() =>
            app.electronApp.evaluate(
                (_, key) => (Reflect.get(globalThis, key) as number[]).length,
                PID_KEY
            )
        )
        .toBe(before + 1);
    return app.electronApp.evaluate(
        (_, key) => (Reflect.get(globalThis, key) as number[]).at(-1) ?? 0,
        PID_KEY
    );
}

async function enterPin(page: Page): Promise<void> {
    await page.getByTestId('parental-lock-pin').fill(PIN);
    await page.getByTestId('parental-lock-pin-submit').click();
}

/**
 * A relock closes an MPV session opened while unlocked from a source with
 * a locked category, and leaves one opened while locked; a renderer reload
 * closes one the unlocked page left running. The native process boundary is
 * replaced by a quiet, long-lived child; CI installs no MPV.
 */
test('@electron @parental @playback relock and reload close an MPV session opened while unlocked', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-lock-player-'));
    const playerPath = join(directory, 'synthetic-mpv');
    const app = await launchElectronApp(dataDir);
    const pids: number[] = [];
    try {
        const page = app.mainWindow;
        await app.electronApp.evaluate(
            (_, { playerPath, nodePath, key }) => {
                const childProcess = process.getBuiltinModule('child_process');
                const spawn = childProcess.spawn;
                Reflect.set(globalThis, key, []);
                childProcess.spawn = ((command, ...args) => {
                    if (command !== playerPath)
                        return Reflect.apply(spawn, childProcess, [
                            command,
                            ...args,
                        ]);
                    const child = spawn(
                        nodePath,
                        ['-e', 'setInterval(() => {}, 1000)'],
                        { stdio: ['ignore', 'pipe', 'pipe'], detached: false }
                    );
                    (Reflect.get(globalThis, key) as number[]).push(
                        child.pid as number
                    );
                    return child;
                }) as typeof spawn;
            },
            { playerPath, nodePath: process.execPath, key: PID_KEY }
        );
        await page.evaluate(() =>
            window.electron.updateSettings({ mpvReuseInstance: true })
        );

        // Enabling the lock leaves this session unlocked.
        await openSettings(page);
        await openSettingsSection(page, 'parental');
        const toggle = page.locator(
            '[data-test-id="parental-lock-enabled"] button[role="switch"]'
        );
        await toggle.click();
        await page.getByTestId('parental-lock-pin').fill(PIN);
        await page.getByTestId('parental-lock-pin-confirm').fill(PIN);
        await page.getByTestId('parental-lock-pin-submit').click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');

        await addXtreamPortal(page, { name: 'Synthetic Lock Portal' });
        await waitForXtreamWorkspaceReady(page);
        await openWorkspaceSection(page, 'Live TV');
        await page.getByTestId('context-manage-categories').click();
        const dialog = page.locator('app-category-management-dialog');
        await dialog
            .locator('[data-test-id^="category-lock-"]')
            .first()
            .click();
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/\/workspace\/xtreams\/[^/]+\/live/);

        // Opened while unlocked, from a source with a locked category.
        const unlockedPid = await launchPlayer(
            app,
            playerPath,
            'Synthetic unlocked launch'
        );
        pids.push(unlockedPid);
        expect(playerIsAlive(unlockedPid)).toBe(true);

        const lockButton = page.getByTestId('header-parental-lock');
        await lockButton.click();
        await expect(lockButton).toHaveClass(/is-active/);
        await expect.poll(() => playerIsAlive(unlockedPid)).toBe(false);

        // Opened while locked: it came from the filtered catalog and must
        // survive an unlock and the next relock.
        const lockedPid = await launchPlayer(
            app,
            playerPath,
            'Synthetic locked launch'
        );
        pids.push(lockedPid);
        await lockButton.click();
        await enterPin(page);
        await expect(lockButton).not.toHaveClass(/is-active/);
        await lockButton.click();
        await expect(lockButton).toHaveClass(/is-active/);
        // Nothing to wait for when the session is rightly left alone: give
        // a wrong close (sent at once on relock) time to land.
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(3_000);
        expect(playerIsAlive(lockedPid)).toBe(true);
        stopPlayer(lockedPid);

        // A reload forgets what the page saw; the new page starts locked and
        // closes a player still running from the unlocked page.
        await lockButton.click();
        await enterPin(page);
        await expect(lockButton).not.toHaveClass(/is-active/);
        const reloadedPid = await launchPlayer(
            app,
            playerPath,
            'Synthetic launch before a reload'
        );
        pids.push(reloadedPid);
        await reloadFromMainProcess(app);
        await expect(page.getByTestId('header-parental-lock')).toHaveClass(
            /is-active/
        );
        await expect.poll(() => playerIsAlive(reloadedPid)).toBe(false);
    } finally {
        pids.forEach(stopPlayer);
        await closeElectronApp(app);
        rmSync(directory, { recursive: true, force: true });
    }
});
