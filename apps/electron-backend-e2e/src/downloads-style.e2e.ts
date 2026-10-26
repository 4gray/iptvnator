import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    saveSettings,
    test,
} from './electron-test-fixtures';
import { seedDownloadStyles } from './downloads-style.fixture';

test('@downloads @electron keeps download controls usable across themes and narrow panes', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const app = await launchElectronApp(dataDir);
    try {
        await seedDownloadStyles(app);
        const page = app.mainWindow;
        await expect(page.getByTestId('download-queue-item-1')).toBeVisible();
        const output = process.env['DOWNLOADS_STYLE_CAPTURE'];

        for (const dark of [true, false]) {
            await page.evaluate(
                (dark) => document.body.classList.toggle('dark-theme', dark),
                dark
            );
            for (const width of [1280, 620]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.emulateMedia({ reducedMotion: 'reduce' });
                await page.mouse.move(1, 1);
                await page
                    .locator('.downloads__content')
                    .evaluate((el) => (el.scrollTop = 0));
                await capture(
                    page,
                    output,
                    `${dark ? 'dark' : 'light'}-${width}.png`
                );
                await page
                    .locator('.downloads__content')
                    .evaluate((el) => (el.scrollTop = el.scrollHeight));
                await capture(
                    page,
                    output,
                    `${dark ? 'dark' : 'light'}-${width}-library.png`
                );
                const series = page.locator('.download-library__card').filter({
                    has: page.getByTestId('download-library-series-open'),
                });
                await series.locator('.download-library__more').click();
                await page
                    .getByRole('menuitem', {
                        name: /Open downloaded episodes/,
                    })
                    .click();
                await expect(page.getByRole('dialog')).toBeVisible();
                await page.mouse.move(1, 1);
                await capture(
                    page,
                    output,
                    `${dark ? 'dark' : 'light'}-${width}-dialog.png`
                );
                await page.keyboard.press('Escape');
                await page
                    .getByTestId('download-library-series-open')
                    .first()
                    .click();
                await expect(page.getByRole('tablist')).toBeVisible();
                await page.getByRole('tablist').scrollIntoViewIfNeeded();
                await page.mouse.move(1, 1);
                await capture(
                    page,
                    output,
                    `${dark ? 'dark' : 'light'}-${width}-offline.png`
                );
                await page
                    .getByRole('button', { name: 'Open downloads' })
                    .click();
                await page
                    .locator('.downloads__content')
                    .evaluate((el) => (el.scrollTop = 0));
                await expectQueueLayout(page);
            }
        }
        await page.setViewportSize({ width: 620, height: 1000 });
        const pause = page
            .getByTestId('download-queue-item-1')
            .locator('[data-test-action="pause"]');
        await pause.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(pause).toBeFocused();
        expect(
            await pause.evaluate((el) => getComputedStyle(el).outlineStyle)
        ).not.toBe('none');
        await capture(page, output, 'interaction-focus.png');
        await pause.hover();
        await capture(page, output, 'interaction-hover.png');
        await pause.click();
        await expect(pause).toBeDisabled();
        await capture(page, output, 'interaction-disabled.png');
        await expect(pause).toBeEnabled();

        // Change the locale at desktop width: Windows title-bar controls
        // overlap the global Settings shortcut in the narrow shell.
        await page.setViewportSize({ width: 1280, height: 1000 });
        await openSettings(page);
        await page.getByTestId('select-language').click();
        await page.getByTestId('de').click();
        await saveSettings(page);
        await page.goBack();
        await expect(page.locator('#downloads-title')).toHaveText('Downloads');
        for (const width of [620, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await expectQueueLayout(page);
            await capture(page, output, `german-${width}.png`);
        }
    } finally {
        await closeElectronApp(app);
    }
});

/** Controls must stay inside the pane and never cover the row's copy. */
async function expectQueueLayout(page: Page): Promise<void> {
    const collisions = await page.locator('.downloads').evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const problems: string[] = [];
        for (const button of root.querySelectorAll('button')) {
            const rect = button.getBoundingClientRect();
            if (
                rect.width &&
                (rect.right > bounds.right + 1 || rect.left < bounds.left - 1)
            ) {
                problems.push(`outside pane: ${button.textContent?.trim()}`);
            }
        }
        for (const text of root.querySelectorAll(
            '.recording-queue__channel, .recording-queue__error'
        )) {
            const actions = text
                .closest('article')
                ?.querySelector('.recording-queue__actions')
                ?.getBoundingClientRect();
            const rect = text.getBoundingClientRect();
            if (
                actions &&
                rect.right > actions.left + 1 &&
                rect.bottom > actions.top + 1 &&
                rect.top < actions.bottom - 1
            ) {
                problems.push(
                    `recording text under actions: ${text.className}`
                );
            }
        }
        for (const row of root.querySelectorAll(
            '.download-queue__item, .recording-queue__item'
        )) {
            const copy = row
                .querySelector('[class$="__content"]')
                ?.getBoundingClientRect();
            const actions = row
                .querySelector('[class$="__actions"]')
                ?.getBoundingClientRect();
            if (
                copy &&
                actions &&
                copy.right > actions.left + 1 &&
                copy.bottom > actions.top + 1 &&
                copy.top < actions.bottom - 1
            ) {
                problems.push(
                    `actions overlap copy: ${row.getAttribute('data-test-id')}`
                );
            }
        }
        return problems;
    });
    expect(collisions).toEqual([]);
}

async function capture(
    page: Page,
    output: string | undefined,
    name: string
): Promise<void> {
    if (!output) return;
    mkdirSync(output, { recursive: true });
    await page.screenshot({ animations: 'disabled', path: join(output, name) });
}
