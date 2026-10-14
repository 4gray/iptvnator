import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    test,
} from './electron-test-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromRenderer,
} from './renderer-reload.support';

// ---------------------------------------------------------------------------
// app.config.ts does not provide the Angular animations module: nothing
// declares an animation trigger, and Material 22 animates its overlays with
// CSS, reading prefers-reduced-motion itself. These checks keep the overlays'
// enter and exit motion, and the close paths that wait for it, working
// without the module, and off under reduced motion.
// ---------------------------------------------------------------------------

interface MotionEvent {
    type: string;
    name: string;
    /** The class attribute of the element the event fired on. */
    target: string;
}

type MotionWindow = Window & { __motionEvents?: MotionEvent[] };

/** Records every CSS animation and transition event of the document. */
async function recordMotion(page: Page): Promise<void> {
    await page.evaluate(() => {
        const events: MotionEvent[] = [];
        (window as MotionWindow).__motionEvents = events;
        for (const type of [
            'animationstart',
            'animationend',
            'transitionrun',
            'transitionend',
        ]) {
            document.addEventListener(
                type,
                (event) => {
                    const target = event.target;
                    events.push({
                        type,
                        name:
                            (event as AnimationEvent).animationName ??
                            (event as TransitionEvent).propertyName,
                        target:
                            target instanceof Element
                                ? (target.getAttribute('class') ?? '')
                                : '',
                    });
                },
                true
            );
        }
    });
}

async function motionEvents(page: Page): Promise<MotionEvent[]> {
    return page.evaluate(() => (window as MotionWindow).__motionEvents ?? []);
}

/**
 * Waits for an event of that type and name, on an element wearing
 * `targetClass` when given, among the events recorded from `since` on.
 */
async function expectMotion(
    page: Page,
    type: string,
    name: string,
    { targetClass, since = 0 }: { targetClass?: string; since?: number } = {}
): Promise<void> {
    await expect
        .poll(
            async () =>
                (await motionEvents(page))
                    .slice(since)
                    .some(
                        (event) =>
                            event.type === type &&
                            event.name === name &&
                            (targetClass === undefined ||
                                event.target.split(/\s+/).includes(targetClass))
                    ),
            `${type} ${name}${targetClass ? ` on .${targetClass}` : ''}`
        )
        .toBe(true);
}

async function recordedCount(page: Page): Promise<number> {
    return (await motionEvents(page)).length;
}

/** Opens the Clear EPG data confirmation from the EPG settings section. */
async function openClearEpgDialog(page: Page) {
    await openSettingsSection(page, 'epg');
    await page
        .getByRole('button', { name: 'Clear EPG data', exact: true })
        .click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    return dialog;
}

test.describe('Material motion without the animations module', () => {
    test('@theme @electron overlays animate in and out and close after their exit motion', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page);
            await openSources(page);
            await recordMotion(page);

            // Tooltip: keyframes on show and on hide.
            const settingsLink = page.locator('a[href$="/workspace/settings"]');
            await settingsLink.hover();
            // Scoped to the one tooltip: the rail link hovered on the way
            // to Sources may still be fading out.
            const tooltip = page.locator('.mat-mdc-tooltip', {
                hasText: 'Settings',
            });
            await expect(tooltip).toBeVisible();
            await expect(tooltip).not.toHaveClass(/_mat-animation-noopable/);
            await expectMotion(page, 'animationstart', 'mat-mdc-tooltip-show');
            await expectMotion(page, 'animationend', 'mat-mdc-tooltip-show');
            await page.mouse.move(640, 360);
            await expectMotion(page, 'animationstart', 'mat-mdc-tooltip-hide');
            await expect(tooltip).toHaveCount(0);

            // Menu: the sources sort menu.
            await page.locator('.sort-trigger').click();
            const menu = page.locator('.mat-mdc-menu-panel');
            await expect(menu).toBeVisible();
            await expect(menu).not.toHaveClass(
                /mat-menu-panel-animations-disabled/
            );
            await expectMotion(page, 'animationstart', '_mat-menu-enter');
            // Dismissed only once the enter animation is over: a swap while
            // it still runs cancels it, and Material treats the cancelled
            // enter as the exit's end and detaches the panel at once.
            await expectMotion(page, 'animationend', '_mat-menu-enter');
            await page.keyboard.press('Escape');
            await expectMotion(page, 'animationstart', '_mat-menu-exit');
            await expect(menu).toHaveCount(0);

            // Select: the language list, opened and dismissed unchanged.
            await openSettings(page);
            await openSettingsSection(page, 'general');
            await page.getByTestId('select-language').click();
            const panel = page.locator('.mat-mdc-select-panel');
            await expect(panel).toBeVisible();
            await expect(panel).toHaveClass(
                /mat-select-panel-animations-enabled/
            );
            await expectMotion(page, 'animationstart', '_mat-select-enter');
            await expectMotion(page, 'animationend', '_mat-select-enter');
            await page.keyboard.press('Escape');
            await expectMotion(page, 'animationstart', '_mat-select-exit');
            await expect(panel).toHaveCount(0);

            // Dialog: Material drives it with transitions whose duration it
            // writes on the container; the surface scales in. Confirming
            // closes it after the exit transition and shows a snack-bar.
            const beforeDialog = await recordedCount(page);
            const dialog = await openClearEpgDialog(page);
            await expect(dialog).not.toHaveClass(/_mat-animation-noopable/);
            await expect(dialog).toHaveClass(/mdc-dialog--open/);
            expect(
                await dialog.evaluate((el) =>
                    el.style.getPropertyValue(
                        '--mat-dialog-transition-duration'
                    )
                )
            ).toMatch(/^[1-9]\d*ms$/);
            // The surface scales in while opening.
            await expectMotion(page, 'transitionend', 'transform', {
                targetClass: 'mat-mdc-dialog-surface',
                since: beforeDialog,
            });
            const beforeClose = await recordedCount(page);
            await dialog.getByTestId('confirm-dialog-confirm').click();
            // Closing fades the inner container out. Material detaches the
            // container on a timer of the same length, so the fade's end
            // may never be observed; its start is, in the first frame.
            await expectMotion(page, 'transitionrun', 'opacity', {
                targetClass: 'mat-mdc-dialog-inner-container',
                since: beforeClose,
            });
            await expect(dialog).toHaveCount(0);

            const snackBar = page.locator('.mat-mdc-snack-bar-container');
            await expect(snackBar).toBeVisible();
            await expect(snackBar).toHaveClass(
                /mat-snack-bar-container-animations-enabled/
            );
            await expectMotion(page, 'animationstart', '_mat-snack-bar-enter');
            // The confirmation toast lasts 2s, then leaves through its exit
            // animation; the container is removed when that one ends.
            await expectMotion(page, 'animationstart', '_mat-snack-bar-exit');
            await expect(snackBar).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@theme @electron reduced motion turns the overlay motion off', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            // Material reads the preference once per document, so a fresh
            // document must start under the emulated media.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await reloadFromRenderer(app);
            await expectRendererReloadedOnRoute(page, /\/workspace/);
            await openSettings(page);
            await openSettingsSection(page, 'general');
            await recordMotion(page);

            await page.getByTestId('select-language').click();
            const panel = page.locator('.mat-mdc-select-panel');
            await expect(panel).toBeVisible();
            await expect(panel).not.toHaveClass(
                /mat-select-panel-animations-enabled/
            );
            await page.keyboard.press('Escape');
            await expect(panel).toHaveCount(0);

            const dialog = await openClearEpgDialog(page);
            await expect(dialog).toHaveClass(/_mat-animation-noopable/);
            // Material writes the transition duration only when it animates.
            expect(
                await dialog.evaluate((el) =>
                    el.style.getPropertyValue(
                        '--mat-dialog-transition-duration'
                    )
                )
            ).toBe('');
            await dialog.getByTestId('confirm-dialog-confirm').click();
            await expect(dialog).toHaveCount(0);

            const snackBar = page.locator('.mat-mdc-snack-bar-container');
            await expect(snackBar).toBeVisible();
            await expect(snackBar).not.toHaveClass(
                /mat-snack-bar-container-animations-enabled/
            );
            await expect(snackBar).toHaveCount(0, { timeout: 10_000 });

            const names = (await motionEvents(page))
                .filter((event) => event.type === 'animationstart')
                .map((event) => event.name);
            expect(names.filter((name) => /^_mat-/.test(name))).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
