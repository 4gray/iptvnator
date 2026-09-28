import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './electron-test-fixtures';
import {
    launchUnautomatedElectronApp,
    type UnautomatedElectronApp,
} from './electron-unautomated-launch';

// Linux CI runs Electron under xvfb without a window manager, so a minimize
// request never takes effect there (see window-controls.e2e.ts).
const isWindowManagerlessCi =
    process.platform === 'linux' && !!process.env['CI'];

const videoFixtureUrl = pathToFileURL(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
).href;

const visibility = (app: UnautomatedElectronApp) =>
    app.evaluateInPage<string>('document.visibilityState');

const setWindowState = (
    app: UnautomatedElectronApp,
    action: 'hide' | 'show' | 'minimize' | 'restore'
) =>
    app.evaluateInMain(
        `electron.BrowserWindow.getAllWindows()[0].${action}();`
    );

/**
 * The app creates its window with `show: false` and shows it on
 * `ready-to-show`; a `hide()` sent earlier would be undone by that `show()`.
 */
async function waitUntilShown(app: UnautomatedElectronApp): Promise<void> {
    await expect
        .poll(
            () =>
                app.evaluateInMain<boolean>(
                    'return electron.BrowserWindow.getAllWindows()[0]?.isVisible() ?? false;'
                ),
            { timeout: 30_000 }
        )
        .toBe(true);
    await expect.poll(() => visibility(app)).toBe('visible');
}

/**
 * The renderer must see a hidden or minimized window as hidden: idle timers
 * pause on `visibilitychange`, and the playback keep-awake gate releases the
 * display for a minimized window. A main window created with
 * `backgroundThrottling: false` keeps reporting `visible` in both cases.
 *
 * Launched without Playwright: its focus emulation pins every page it
 * attaches to as visible (see `electron-unautomated-launch.ts`).
 */
test.describe('Main window visibility', () => {
    test('@electron reports a hidden window as hidden and a shown one as visible', async ({
        dataDir,
    }) => {
        const app = await launchUnautomatedElectronApp(dataDir);
        try {
            await waitUntilShown(app);

            await setWindowState(app, 'hide');
            await expect
                .poll(() => visibility(app), { timeout: 10_000 })
                .toBe('hidden');

            await setWindowState(app, 'show');
            await expect
                .poll(() => visibility(app), { timeout: 10_000 })
                .toBe('visible');
        } finally {
            await app.close();
        }
    });

    test('@electron reports a minimized window as hidden until it is restored', async ({
        dataDir,
    }) => {
        test.skip(
            isWindowManagerlessCi,
            'xvfb on Linux CI has no window manager'
        );
        const app = await launchUnautomatedElectronApp(dataDir);
        try {
            await waitUntilShown(app);

            await setWindowState(app, 'minimize');
            await expect
                .poll(() => visibility(app), { timeout: 10_000 })
                .toBe('hidden');

            await setWindowState(app, 'restore');
            await expect
                .poll(() => visibility(app), { timeout: 10_000 })
                .toBe('visible');
        } finally {
            await app.close();
        }
    });

    test('@electron releases the playback display lock while the window is hidden', async ({
        dataDir,
    }) => {
        const app = await launchUnautomatedElectronApp(dataDir);
        try {
            await waitUntilShown(app);
            // Record the display-sleep blockers the keep-awake service holds.
            await app.evaluateInMain(`
                const blocker = electron.powerSaveBlocker;
                const active = (globalThis.__e2eDisplayBlockers = new Set());
                const start = blocker.start.bind(blocker);
                const stop = blocker.stop.bind(blocker);
                blocker.start = (type) => {
                    const id = start(type);
                    if (type === 'prevent-display-sleep') active.add(id);
                    return id;
                };
                blocker.stop = (id) => {
                    active.delete(id);
                    return stop(id);
                };
            `);
            const heldBlockers = () =>
                app.evaluateInMain<number>(
                    'return globalThis.__e2eDisplayBlockers.size;'
                );
            await app.evaluateInPage(`(() => {
                const video = document.createElement('video');
                video.muted = true;
                video.loop = true;
                video.src = ${JSON.stringify(videoFixtureUrl)};
                document.body.append(video);
                return video.play().then(() => true);
            })()`);
            await expect.poll(heldBlockers, { timeout: 10_000 }).toBe(1);

            await setWindowState(app, 'hide');
            await expect.poll(heldBlockers, { timeout: 10_000 }).toBe(0);

            await setWindowState(app, 'show');
            await expect.poll(heldBlockers, { timeout: 10_000 }).toBe(1);
        } finally {
            await app.close();
        }
    });
});
