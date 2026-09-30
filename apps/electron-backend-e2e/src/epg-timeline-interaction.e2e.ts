import {
    addXtreamPortal,
    addStalkerPortal,
    waitForStalkerCatalog,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    openSettings,
    openSettingsSection,
    saveSettings,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchXtreamEpgFixture,
    fetchStalkerCategoryFixture,
} from './portal-mock-fixtures';

import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    applyTheme,
    expectTextContrast,
    expectThemeSurface,
    expectSkeletonContrast,
} from './theme-contrast';

const epgCredentials = {
    username: 'epg',
    password: 'epg',
};

/**
 * Every opener shares one dialog config: the programme dialog is named by its
 * `mat-dialog-title` and opens in the same 540px pane wherever it starts.
 */
async function expectProgrammeDialog(
    page: Page,
    title?: string
): Promise<Locator> {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const heading = dialog.locator('.epg-dialog__title');
    if (title) {
        await expect(heading).toHaveText(title);
    }
    await expect(dialog).toHaveAccessibleName(
        (await heading.innerText()).trim()
    );
    await expect
        .poll(() =>
            dialog.evaluate(
                (element) =>
                    element.closest<HTMLElement>('.cdk-overlay-pane')
                        ?.offsetWidth
            )
        )
        .toBe(540);
    return dialog;
}

async function closeProgrammeDialog(page: Page, dialog: Locator) {
    // The footer Close is the dialog's only visible dismiss.
    await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(1);
    await dialog.locator('.epg-dialog__close').click();
    await page.waitForSelector('.epg-dialog', { state: 'detached' });
}

test('@epg @xtream @electron opens the programme dialog from a timeline block and reacts to zoom', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const currentProgram = fixture.shortEpg[0];
    if (!currentProgram) {
        throw new Error(
            'Expected the Xtream EPG fixture to include a current program.'
        );
    }
    const app = await launchElectronApp(dataDir, { env: { TZ: 'UTC' } });

    try {
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setSize(1800, 1000);
        });
        // No external demo stream is needed for guide interaction/contrast.
        await app.mainWindow.route('https://test-streams.mux.dev/**', () => {
            // Keep the external demo request pending; guide data is local.
        });
        await addXtreamPortal(app.mainWindow, {
            name: 'Xtream Timeline Interaction',
            username: epgCredentials.username,
            password: epgCredentials.password,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);

        const channelRow = channelItemByTitle(
            app.mainWindow,
            fixture.stream.name ?? ''
        ).first();
        await expect(channelRow).toBeVisible({ timeout: 20000 });
        await channelRow.click();

        const timeline = app.mainWindow.locator('app-epg-timeline');
        await expect(timeline).toBeVisible({ timeout: 20000 });

        const nowBlock = timeline
            .locator('.epg-timeline__block.is-now')
            .first();
        await expect(nowBlock).toBeVisible();

        // The zoom button cycles hours → detail → day; block widths follow
        // px/minute, so "detail" must render the same block wider than "day".
        const zoomButton = timeline.locator('.epg-timeline__zoom');
        await expect(zoomButton).toBeVisible();
        await expect(zoomButton).toHaveAttribute('data-zoom-level', 'hours');

        const blockWidth = async () =>
            (await nowBlock.boundingBox())?.width ?? 0;

        await zoomButton.click();
        await expect(zoomButton).toHaveAttribute('data-zoom-level', 'detail');
        const detailZoomWidth = await blockWidth();

        await zoomButton.click();
        await expect(zoomButton).toHaveAttribute('data-zoom-level', 'day');
        const dayZoomWidth = await blockWidth();
        expect(detailZoomWidth).toBeGreaterThan(dayZoomWidth);

        // Ctrl + wheel over the ribbon fine-tunes the zoom (and must not
        // trigger Chromium's page zoom, which would scale the whole window).
        const ribbon = timeline.locator('.epg-timeline__ribbon');
        await ribbon.hover({ position: { x: 200, y: 40 } });
        const pageZoomBefore = await app.mainWindow.evaluate(
            () => window.devicePixelRatio
        );
        await app.mainWindow.keyboard.down('Control');
        await app.mainWindow.mouse.wheel(0, -300);
        await app.mainWindow.keyboard.up('Control');
        await expect
            .poll(blockWidth, { timeout: 5000 })
            .toBeGreaterThan(dayZoomWidth);
        // Chromium page zoom scales devicePixelRatio; the ribbon must have
        // swallowed the gesture instead.
        expect(
            await app.mainWindow.evaluate(() => window.devicePixelRatio)
        ).toBe(pageZoomBefore);

        // The contrast checks below read the block's time line, which the
        // narrower tiers hide, so settle on the "detail" preset. The
        // wheel-tuned scale may sit in any band (Chromium scales the delivered
        // delta), so cycle from wherever it landed rather than assuming a
        // fixed number of clicks.
        const clicksToDetail: Record<string, number> = {
            detail: 0,
            day: 2,
            hours: 1,
        };
        const landedLevel =
            (await zoomButton.getAttribute('data-zoom-level')) ?? '';
        expect(Object.keys(clicksToDetail)).toContain(landedLevel);
        for (let i = 0; i < clicksToDetail[landedLevel]; i += 1) {
            await zoomButton.click();
        }
        await expect(zoomButton).toHaveAttribute('data-zoom-level', 'detail');

        for (const theme of ['light', 'dark', 'light'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(timeline, theme);
            await expectTextContrast(
                timeline.locator('.epg-timeline__heading b')
            );
            await expectTextContrast(
                nowBlock.locator('.epg-timeline__block-title')
            );
            await expectTextContrast(
                nowBlock.locator('.epg-timeline__block-time')
            );
            // Exercise the worst-case overlapping current/playing tints,
            // including the sibling progress fill behind the small live label.
            for (const playing of [false, true]) {
                await nowBlock.evaluate((element, active) => {
                    element.classList.toggle('is-playing', active);
                }, playing);
                await expectTextContrast(
                    nowBlock.locator('.epg-timeline__tag.is-now'),
                    4.5,
                    '.epg-timeline__fill--live'
                );
            }
            await nowBlock.evaluate((element) =>
                element.classList.remove('is-playing')
            );
            await nowBlock.hover();
            await expectTextContrast(
                nowBlock.locator('.epg-timeline__info'),
                3
            );
        }

        // At max zoom the on-air block is wide enough to expose the info
        // affordance (hidden on narrow/micro tiers), which opens the shared
        // programme-details dialog with the programme metadata.
        await nowBlock.locator('.epg-timeline__info').click();

        const dialog = await expectProgrammeDialog(
            app.mainWindow,
            currentProgram.title
        );
        // An on-air programme offers "watch live" as the primary action, last
        // in the footer and to the right of the dismiss.
        const footer = dialog.locator('.epg-dialog__actions button');
        await expect(footer).toHaveCount(2);
        await expect(footer.first()).toHaveClass(/epg-dialog__close/);
        await expect(footer.last()).toHaveClass(/epg-dialog__btn--primary/);
        // Layout offsets, not bounding boxes: the dialog may still be scaling
        // in, which transforms client rects.
        const [closeBox, primaryBox] = await footer.evaluateAll((buttons) =>
            buttons.map((button) => ({
                left: (button as HTMLElement).offsetLeft,
                top: (button as HTMLElement).offsetTop,
            }))
        );
        expect(primaryBox.left).toBeGreaterThan(closeBox.left);
        expect(primaryBox.top).toBe(closeBox.top);

        for (const theme of ['light', 'dark', 'light'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(dialog.locator('.epg-dialog'), theme);
            await expectTextContrast(dialog.locator('.epg-dialog__title'));
            await expectTextContrast(dialog.locator('.epg-dialog__desc'));
            await expectTextContrast(dialog.locator('.epg-dialog__close'), 3);
        }
        await app.mainWindow.screenshot({
            path: test.info().outputPath('epg-light.png'),
        });
        await closeProgrammeDialog(app.mainWindow, dialog);

        // The channel row's info button opens the same dialog.
        await channelRow.locator('.program-info-button').click();
        await closeProgrammeDialog(
            app.mainWindow,
            await expectProgrammeDialog(app.mainWindow)
        );

        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        await app.mainWindow.getByTestId('epg-view-mode-list').click();
        await saveSettings(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await channelItemByTitle(app.mainWindow, fixture.stream.name ?? '')
            .first()
            .click();
        const guide = app.mainWindow.locator('app-epg-list-view');
        await expect(guide).toBeVisible();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(guide, theme);
            await expectTextContrast(
                guide.locator('[data-when="now"] .time').first()
            );
            await expectTextContrast(
                guide.locator('[data-when="now"] .title').first()
            );
            await expectTextContrast(
                guide.locator('[data-when="now"] .desc').first()
            );
        }
        // The list view's info button opens the same dialog.
        await guide
            .locator('[data-when="now"]')
            .first()
            .getByRole('button', { name: 'Show details about this program' })
            .click();
        await closeProgrammeDialog(
            app.mainWindow,
            await expectProgrammeDialog(app.mainWindow)
        );

        // Keep a fresh channel's EPG IPC pending so the real list loading
        // template stays mounted through both theme changes.
        await app.electronApp.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('XTREAM_REQUEST');
            ipcMain.handle(
                'XTREAM_REQUEST',
                () =>
                    new Promise(() => {
                        // Released when this isolated Electron test app closes.
                    })
            );
        });
        await app.mainWindow
            .locator('[data-test-id="channel-item"]')
            .nth(1)
            .click();
        const skeleton = guide.locator('.sk-time').first();
        await expect(skeleton).toBeVisible();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectSkeletonContrast(skeleton, guide);
            await expectSkeletonContrast(
                guide.locator('.sk-title').first(),
                guide
            );
        }
    } finally {
        await closeElectronApp(app);
    }
});

test('@epg @xtream @electron stacks the programme dialog actions on a phone', async ({
    dataDir,
    request,
}) => {
    // French carries the longest primary label ("watch from start").
    const fr = JSON.parse(
        readFileSync(
            join(__dirname, '../../web/src/assets/i18n/fr.json'),
            'utf8'
        )
    ) as {
        WORKSPACE: { SHELL: { RAIL_LIVE: string } };
        EPG: {
            PROGRAM_DIALOG: { SHOW_PROGRAM_DETAILS: string };
            TIMELINE: { WATCH_FROM_START: string };
        };
    };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const app = await launchElectronApp(dataDir, { env: { TZ: 'UTC' } });

    try {
        await app.mainWindow.route('https://test-streams.mux.dev/**', () => {
            // Keep the external demo request pending; guide data is local.
        });
        await addXtreamPortal(app.mainWindow, {
            name: 'Xtream Phone Dialog',
            username: epgCredentials.username,
            password: epgCredentials.password,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openSettings(app.mainWindow);
        await app.mainWindow.getByTestId('select-language').click();
        await app.mainWindow.locator('mat-option[data-test-id="fr"]').click();
        await openSettingsSection(app.mainWindow, 'epg');
        await app.mainWindow.getByTestId('epg-view-mode-list').click();
        await saveSettings(app.mainWindow);

        await openWorkspaceSection(
            app.mainWindow,
            fr.WORKSPACE.SHELL.RAIL_LIVE
        );
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await channelItemByTitle(app.mainWindow, fixture.stream.name ?? '')
            .first()
            .click();
        const guide = app.mainWindow.locator('app-epg-list-view');
        await expect(guide.locator('[data-when="past"]').first()).toBeVisible();

        // The window cannot shrink below its desktop minimum, so emulate a
        // phone viewport below the 640px breakpoint.
        await app.mainWindow.setViewportSize({ width: 360, height: 800 });
        await guide
            .locator('[data-when="past"]')
            .first()
            .getByRole('button', {
                name: fr.EPG.PROGRAM_DIALOG.SHOW_PROGRAM_DETAILS,
            })
            .click();
        const dialog = app.mainWindow.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.epg-dialog__btn--primary')).toContainText(
            fr.EPG.TIMELINE.WATCH_FROM_START
        );

        // Every action row stacks one full-width button per row in DOM
        // order, and no label spills out of its button.
        const rows = await dialog
            .locator('.epg-dialog__tools, .epg-dialog__actions')
            .evaluateAll((containers) =>
                containers.map((container) => {
                    const buttons = Array.from(
                        container.querySelectorAll<HTMLElement>('button')
                    );
                    return {
                        width: (container as HTMLElement).clientWidth,
                        buttons: buttons.map((button) => ({
                            top: button.offsetTop,
                            bottom: button.offsetTop + button.offsetHeight,
                            width: button.offsetWidth,
                            overflows:
                                button.scrollWidth > button.clientWidth + 1,
                        })),
                    };
                })
            );
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.buttons.length).toBeGreaterThan(1);
            row.buttons.forEach((button, index) => {
                expect(Math.abs(button.width - row.width)).toBeLessThanOrEqual(
                    1
                );
                expect(button.overflows).toBe(false);
                if (index > 0) {
                    expect(button.top).toBeGreaterThanOrEqual(
                        row.buttons[index - 1].bottom
                    );
                }
            });
        }
    } finally {
        await closeElectronApp(app);
    }
});

test('@epg @stalker @theme @electron applies live themes to the shared Stalker guide', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['stalker']);
    const fixture = await fetchStalkerCategoryFixture(request, 'itv');
    const item = fixture.items[0];
    const app = await launchElectronApp(dataDir);
    try {
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setSize(1800, 1000);
        });
        await app.mainWindow.route('https://test-streams.mux.dev/**', () => {
            // Keep the external demo request pending; guide data is local.
        });
        await addStalkerPortal(app.mainWindow, {
            name: 'Stalker Theme Fixture',
        });
        await waitForStalkerCatalog(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await channelItemByTitle(app.mainWindow, item.o_name || item.name || '')
            .first()
            .click();
        const timeline = app.mainWindow.locator('app-epg-timeline');
        await expect(timeline).toBeVisible();
        for (const theme of ['light', 'dark', 'light'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(timeline, theme);
            await expectTextContrast(
                timeline.locator('.epg-timeline__heading b')
            );
            await app.mainWindow.screenshot({
                path: test.info().outputPath(`stalker-${theme}.png`),
            });
        }
    } finally {
        await closeElectronApp(app);
    }
});
