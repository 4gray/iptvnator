import { Locator, Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    test,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

const sourcesRailId = 'dashboard-recent-sources-rail';
const sourceCount = 4;

/**
 * Sizes the sources rail's cards so the last one is half visible: the rail
 * overflows by less than a card, and Chromium skips its own focus scroll for
 * an element that already shows 32px or more. Returns the card width.
 */
async function makeLastCardHalfVisible(rail: Locator): Promise<number> {
    const width = await rail.evaluate((section, count) => {
        const host = section.parentElement as HTMLElement;
        const viewport = section.querySelector(
            '.rail__viewport'
        ) as HTMLElement;
        const track = section.querySelector('.rail__track') as HTMLElement;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        // count cards + (count - 1) gaps = viewport + half a card.
        const cardWidth = Math.floor(
            (viewport.clientWidth - gap * (count - 1)) / (count - 0.5)
        );
        host.style.setProperty('--cover-rail-width', `${cardWidth}px`);
        track.scrollTo({ left: 0, behavior: 'auto' });
        return cardWidth;
    }, sourceCount);
    await expect
        .poll(() => lastCardVisibleWidth(rail))
        .toBeGreaterThan(Math.min(64, width / 4));
    return width;
}

/** Pixels of the last card inside the rail's visible viewport. */
function lastCardVisibleWidth(rail: Locator): Promise<number> {
    return rail.evaluate((section) => {
        const viewport = section
            .querySelector('.rail__viewport')
            ?.getBoundingClientRect();
        const cards = section.querySelectorAll('.rail__card');
        const card = cards[cards.length - 1]?.getBoundingClientRect();
        if (!viewport || !card) return 0;
        return (
            Math.min(card.right, viewport.right) -
            Math.max(card.left, viewport.left)
        );
    });
}

async function lastCardFullyVisible(rail: Locator): Promise<boolean> {
    return rail.evaluate((section) => {
        const viewport = section
            .querySelector('.rail__viewport')
            ?.getBoundingClientRect();
        const cards = section.querySelectorAll('.rail__card');
        const card = cards[cards.length - 1]?.getBoundingClientRect();
        if (!viewport || !card) return false;
        return (
            card.left >= viewport.left - 1 && card.right <= viewport.right + 1
        );
    });
}

function lastCardLinkFocused(page: Page): Promise<boolean> {
    return page.evaluate((railId) => {
        const links = document.querySelectorAll(
            `[data-test-id="${railId}"] .rail__card-link`
        );
        return document.activeElement === links[links.length - 1];
    }, sourcesRailId);
}

test.describe('Dashboard rail focus', () => {
    test('reveals a partly hidden card on keyboard and programmatic focus, and keeps mouse clicks on it', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            for (let index = 1; index <= sourceCount; index++) {
                const filePath = writeTemporaryM3uFile(
                    dataDir,
                    `rail-focus-source-${index}.m3u`,
                    [
                        {
                            groupTitle: 'News',
                            name: `Rail Focus Channel ${index}`,
                            url: `https://streams.example.test/rail-${index}.m3u8`,
                        },
                    ]
                );
                await importM3uPlaylistFromNativeDialog(app, filePath);
            }

            await goToDashboard(app.mainWindow);
            const rail = app.mainWindow.getByTestId(sourcesRailId);
            await expect(rail.getByTestId(`${sourcesRailId}-card`)).toHaveCount(
                sourceCount
            );

            // Tab from the first card to the last card's link.
            await makeLastCardHalfVisible(rail);
            await rail.locator('.rail__card-link').first().focus();
            for (
                let presses = 0;
                presses < sourceCount * 3 &&
                !(await lastCardLinkFocused(app.mainWindow));
                presses++
            ) {
                await app.mainWindow.keyboard.press('Tab');
            }
            expect(await lastCardLinkFocused(app.mainWindow)).toBe(true);
            await expect.poll(() => lastCardFullyVisible(rail)).toBe(true);

            // `focus()` from script after a mouse click elsewhere, starting
            // at the rail's start again.
            await rail.locator('.rail__label').click();
            await rail.evaluate((section) => {
                (document.activeElement as HTMLElement | null)?.blur();
                section
                    .querySelector('.rail__track')
                    ?.scrollTo({ left: 0, behavior: 'auto' });
            });
            await expect.poll(() => lastCardFullyVisible(rail)).toBe(false);
            await rail
                .locator('.rail__card-link')
                .last()
                .evaluate((link) => {
                    (link as HTMLElement).focus();
                });
            await expect.poll(() => lastCardFullyVisible(rail)).toBe(true);

            // A mouse press focuses the link too; the rail must not slide it
            // away from under the pointer before the click lands.
            await rail.evaluate((section) => {
                (document.activeElement as HTMLElement | null)?.blur();
                section
                    .querySelector('.rail__track')
                    ?.scrollTo({ left: 0, behavior: 'auto' });
            });
            await expect.poll(() => lastCardFullyVisible(rail)).toBe(false);
            const box = await rail
                .locator('.rail__card-link')
                .last()
                .boundingBox();
            expect(box).not.toBeNull();
            await app.mainWindow.mouse.move(
                (box?.x ?? 0) + 24,
                (box?.y ?? 0) + (box?.height ?? 0) / 2
            );
            await app.mainWindow.mouse.down();
            expect(await lastCardLinkFocused(app.mainWindow)).toBe(true);
            expect(
                await rail
                    .locator('.rail__track')
                    .evaluate((track) => track.scrollLeft)
            ).toBe(0);
            await app.mainWindow.mouse.up();
            await expect(app.mainWindow).not.toHaveURL(
                /\/workspace\/dashboard$/
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});
