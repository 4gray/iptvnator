import type { Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    sourceRowByTitle,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// A source row opens from the keyboard. Each row has its own Tab stop: the
// title and meta block (`role="button"`, named after the source). The drag
// handle and the row actions are its siblings, so Tab reaches the row before
// its actions, Enter opens it like a click, and the row draws one ring
// while that element has keyboard focus.
// ---------------------------------------------------------------------------

type RowRing = {
    focusVisible: boolean;
    /** The focused element's own outline: the row draws its ring. */
    ownOutline: string;
    row: { style: string; width: string; offset: string; color: string };
    /** `--app-focus-ring` resolved where the row sits. */
    token: string;
};

/** Reads the ring of the row that holds keyboard focus. */
function readRowRing(page: Page): Promise<RowRing> {
    return page.evaluate(() => {
        const focused = document.activeElement as HTMLElement;
        const row = focused.closest('.playlist-item') as HTMLElement;
        const probe = document.createElement('span');
        probe.style.color = 'var(--app-focus-ring)';
        row.append(probe);
        const token = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(row);
        return {
            focusVisible: focused.matches(':focus-visible'),
            ownOutline: getComputedStyle(focused).outlineStyle,
            row: {
                style: style.outlineStyle,
                width: style.outlineWidth,
                offset: style.outlineOffset,
                color: style.outlineColor,
            },
            token,
        };
    });
}

/** Describes the focused element, for a failure message. */
function describeFocus(page: Page): Promise<string> {
    return page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return '(none)';
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 40);
        return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${label}"`;
    });
}

test.describe('Electron Sources keyboard', () => {
    test('@m3u @electron Tab reaches a source row before its actions, shows a ring, and Enter switches to it', async ({
        dataDir,
    }) => {
        const alpha = writeTemporaryM3uFile(dataDir, 'keyboard-alpha.m3u', [
            {
                groupTitle: 'News',
                name: 'Keyboard Alpha News',
                url: 'https://streams.example.test/keyboard-alpha.m3u8',
            },
        ]);
        const bravo = writeTemporaryM3uFile(dataDir, 'keyboard-bravo.m3u', [
            {
                groupTitle: 'Sports',
                name: 'Keyboard Bravo Sports',
                url: 'https://streams.example.test/keyboard-bravo.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir, {
            appArgs: [alpha, bravo],
        });
        const page = app.mainWindow;

        try {
            await page.waitForURL(/\/workspace\/playlists\/.+/, {
                timeout: 30_000,
            });
            await openSources(page);
            await expect(page.locator('app-playlist-item')).toHaveCount(2, {
                timeout: 30_000,
            });
            // Bravo opened last, so it is the active source; open the other.
            const row = sourceRowByTitle(page, 'keyboard-alpha').first();
            await expect(row.locator('.playlist-item')).not.toHaveClass(
                /\bselected\b/
            );
            const title = (
                await row.locator('.playlist-title').textContent()
            )?.trim();
            expect(title).toBeTruthy();

            // Enter the page from the keyboard ahead of the list, then Tab
            // until focus lands in the row.
            const start = page
                .locator('app-workspace-sources-filters-panel button')
                .first();
            await start.focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            await expect(start).toBeFocused();
            const visited: string[] = [];
            for (let presses = 0; presses < 40; presses++) {
                await page.keyboard.press('Tab');
                visited.push(await describeFocus(page));
                const inRow = await row.evaluate((el) =>
                    el.contains(document.activeElement)
                );
                if (inRow) break;
            }

            // The row's first Tab stop opens it; its actions come after.
            const open = row.getByRole('button', {
                name: title,
                exact: true,
            });
            await expect(
                open,
                `Tab stops up to the row: ${visited.join(' → ')}`
            ).toBeFocused();

            const focused = await readRowRing(page);
            expect(focused).toEqual({
                focusVisible: true,
                ownOutline: 'none',
                row: {
                    style: 'solid',
                    width: '2px',
                    offset: '-2px',
                    color: focused.token,
                },
                token: expect.stringMatching(/^rgb/),
            });

            // The ring follows focus: it leaves with it.
            await page.keyboard.press('Tab');
            await expect(open).not.toBeFocused();
            expect(
                await row
                    .locator('.playlist-item')
                    .evaluate((el) => getComputedStyle(el).outlineStyle)
            ).toBe('none');
            await page.keyboard.press('Shift+Tab');
            await expect(open).toBeFocused();

            await page.keyboard.press('Enter');
            await waitForM3uCatalog(page);
            const channels = page.getByTestId('channel-item');
            await expect(
                channels.filter({ hasText: 'Keyboard Alpha News' })
            ).toBeVisible();
            await expect(
                channels.filter({ hasText: 'Keyboard Bravo Sports' })
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });
});
