import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';
import { applyTheme } from './theme-contrast';

/**
 * Catch-up programme names on the shared controls' seek bar reach keyboard
 * and screen-reader users, and the label stays inside the player. The
 * `epglong` mock user is the EPG fixture with a 120-character title on the
 * past programme, whose timeshift URL plays a local clip.
 */

const CHANNEL = 'Timezone News';
const CREDENTIALS = { username: 'epglong', password: 'epglong' };
/** `--pc-glass-bg-dense`: the label is theme-independent. */
const LABEL_GLASS = 'rgba(12, 16, 23, 0.86)';

interface Messages {
    WORKSPACE: { SHELL: { RAIL_LIVE: string } };
    EMBEDDED_MPV: {
        PLAYER: {
            LIVE_STREAM: string;
            LIVE_BADGE: string;
            TIMELINE_SEGMENT_POSITION: string;
        };
    };
}

function messages(locale: string): Messages {
    return JSON.parse(
        readFileSync(
            join(__dirname, `../../web/src/assets/i18n/${locale}.json`),
            'utf8'
        )
    ) as Messages;
}

function valueText(template: string, title: string, time: string): string {
    return template.replace('{{title}}', title).replace('{{time}}', time);
}

/** Imports the source and opens the guide of the catch-up channel. */
async function openChannel(
    page: Page,
    request: Parameters<typeof fetchXtreamEpgFixture>[0],
    locale: string | null
) {
    const fixture = await fetchXtreamEpgFixture(request, CREDENTIALS);
    const longTitle = fixture.fullEpg
        .map((programme) => programme.title)
        .find((title) => title.length >= 120);
    expect(longTitle).toHaveLength(120);

    // Keep the live stub request pending: everything played here is local.
    await page.route('https://test-streams.mux.dev/**', () => undefined);
    await addXtreamPortal(page, { name: 'Long catch-up titles', ...CREDENTIALS });
    await waitForXtreamWorkspaceReady(page);
    if (locale) {
        await openSettings(page);
        await page.getByTestId('select-language').click();
        await page.locator(`mat-option[data-test-id="${locale}"]`).click();
        await saveSettings(page);
    }
    await openWorkspaceSection(
        page,
        messages(locale ?? 'en').WORKSPACE.SHELL.RAIL_LIVE
    );
    await clickCategoryByNameExact(page, fixture.categoryName);
    const row = channelItemByTitle(page, CHANNEL).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();
    const player = page.locator('app-web-player-view');
    await expect(player).toBeVisible({ timeout: 20000 });
    return { player, row, longTitle: longTitle ?? '' };
}

/** Plays the long-titled programme's archive from the guide. */
async function playCatchup(page: Page, player: Locator, longTitle: string) {
    const block = page
        .locator('app-epg-timeline .epg-timeline__block')
        .filter({ hasText: longTitle.slice(0, 40) })
        .first();
    await expect(block).toBeVisible({ timeout: 20000 });
    await block.click();
    await expect(
        player.locator('.player-controls__timeline-segment--titled')
    ).toHaveCount(1, { timeout: 30000 });
    const controls = player.locator('app-player-controls');
    const slider = controls.locator('.player-controls__slider--timeline');
    await expect(slider).toBeEnabled({ timeout: 30000 });
    // Paused, so the position the assertions read stands still.
    const video = player.locator('video').first();
    if (!(await video.evaluate((el: HTMLVideoElement) => el.paused))) {
        await controls.locator('[data-test-id="player-controls-play"]').click();
    }
    await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
        .toBe(true);
    // Park the pointer off the bar: a hovering pointer outranks the keyboard.
    await page.mouse.move(1, 1);
    return { controls, slider };
}

/**
 * Reaches the seek bar from the keyboard: it is the next Tab stop after the
 * stream-info button in the top corner.
 */
async function tabToSeekBar(controls: Locator, slider: Locator) {
    await controls
        .locator('[data-test-id="player-controls-stream-info-button"]')
        .focus();
    await controls.page().keyboard.press('Tab');
    await expect(slider).toBeFocused();
    expect(
        await slider.evaluate((element) => element.matches(':focus-visible'))
    ).toBe(true);
}

/** The label's box against the player's (the controls host fills it). */
function labelPlacement(controls: Locator) {
    return controls.evaluate((host) => {
        const part = (name: string) =>
            host.querySelector<HTMLElement>(
                `[data-test-id="player-controls-timeline-label${name}"]`
            );
        const label = part('');
        const title = part('-title');
        const time = part('-time');
        if (!label || !time) {
            return null;
        }
        const player = host.getBoundingClientRect();
        const box = label.getBoundingClientRect();
        const timeBox = time.getBoundingClientRect();
        return {
            fromLeft: Math.round(box.left - player.left),
            fromRight: Math.round(player.right - box.right),
            insideVertically:
                box.top >= player.top && box.bottom <= player.bottom,
            width: Math.round(box.width),
            playerWidth: Math.round(player.width),
            title: title?.textContent ?? null,
            titleEllipsized: title
                ? title.scrollWidth > title.clientWidth &&
                  getComputedStyle(title).textOverflow === 'ellipsis'
                : false,
            time: time.textContent,
            timeWhole:
                time.scrollWidth <= time.clientWidth &&
                timeBox.left >= box.left &&
                timeBox.right <= box.right,
            background: getComputedStyle(label).backgroundColor,
        };
    });
}

async function hideCategories(page: Page, player: Locator) {
    await page.locator('[data-test-id="context-hide-categories"]').click();
    await page.mouse.move(1, 1);
    await expect
        .poll(() =>
            player.evaluate((element) => {
                const box = element.getBoundingClientRect();
                return box.right <= window.innerWidth && box.width > 300;
            })
        )
        .toBe(true);
}

async function expectLabelInsidePlayer(
    controls: Locator,
    expected: { title: string; time: string }
) {
    await expect
        .poll(async () => {
            const placement = await labelPlacement(controls);
            return (
                placement !== null &&
                placement.time === expected.time &&
                placement.fromLeft >= 0 &&
                placement.fromRight >= 0
            );
        })
        .toBe(true);
    const placement = await labelPlacement(controls);
    expect(placement).not.toBeNull();
    expect(placement?.title).toBe(expected.title);
    expect(placement?.insideVertically).toBe(true);
    // A 120-character title never fits whole: it ellipsizes, the time not.
    expect(placement?.titleEllipsized).toBe(true);
    expect(placement?.timeWhole).toBe(true);
    expect(placement?.width).toBeLessThan(placement?.playerWidth ?? 0);
    return placement;
}

test('@epg @xtream @electron keyboard reaches the catch-up programme name and its label stays inside the player', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(240000);
    await resetMockServers(request, ['xtream']);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const template = messages('en').EMBEDDED_MPV.PLAYER.TIMELINE_SEGMENT_POSITION;

    try {
        const { player, longTitle } = await openChannel(page, request, null);
        const { controls, slider } = await playCatchup(page, player, longTitle);

        for (const width of [1280, 800]) {
            await page.setViewportSize({ width, height: 800 });
            if (width < 900) {
                // Below the desktop window's minimum width the guide pushes
                // the player off-screen; hiding the categories is how such a
                // narrow layout gets a (narrow) player.
                await hideCategories(page, player);
            }
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                await tabToSeekBar(controls, slider);

                // Keyboard focus alone shows the label at the position.
                await expect(
                    controls.locator(
                        '[data-test-id="player-controls-timeline-label"]'
                    )
                ).toBeVisible();

                // The left end: the label is pinned inside the player.
                await page.keyboard.press('Home');
                await expect(slider).toHaveAttribute(
                    'aria-valuetext',
                    valueText(template, longTitle, '0:00')
                );
                const start = await expectLabelInsidePlayer(controls, {
                    title: longTitle,
                    time: '0:00',
                });
                expect(start?.background).toBe(LABEL_GLASS);

                // An arrow moves into the next second of the programme.
                await page.keyboard.press('ArrowRight');
                await expect(slider).toHaveAttribute(
                    'aria-valuetext',
                    valueText(template, longTitle, '0:01')
                );
                await expectLabelInsidePlayer(controls, {
                    title: longTitle,
                    time: '0:01',
                });

                // The right end.
                await page.keyboard.press('End');
                await expect(slider).toHaveAttribute(
                    'aria-valuetext',
                    valueText(template, longTitle, '0:06')
                );
                await expectLabelInsidePlayer(controls, {
                    title: longTitle,
                    time: '0:06',
                });
                await page.screenshot({
                    path: test.info().outputPath(`${theme}-${width}.png`),
                });
            }
        }
    } finally {
        await closeElectronApp(app);
    }
});

for (const locale of ['de', 'ru'] as const) {
    test(`@epg @xtream @electron names the catch-up programme and LIVE in the ${locale} locale`, async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(240000);
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        const player$ = messages(locale).EMBEDDED_MPV.PLAYER;

        try {
            const { player, longTitle } = await openChannel(
                page,
                request,
                locale
            );
            // Live playback: the translated badge, announced by its name.
            await expect(
                player.getByRole('img', {
                    name: player$.LIVE_STREAM,
                    exact: true,
                })
            ).toHaveText(player$.LIVE_BADGE, { timeout: 20000 });

            const { controls, slider } = await playCatchup(
                page,
                player,
                longTitle
            );
            await page.setViewportSize({ width: 800, height: 800 });
            await hideCategories(page, player);
            await tabToSeekBar(controls, slider);
            await page.keyboard.press('Home');
            await expect(slider).toHaveAttribute(
                'aria-valuetext',
                valueText(player$.TIMELINE_SEGMENT_POSITION, longTitle, '0:00')
            );
            await expectLabelInsidePlayer(controls, {
                title: longTitle,
                time: '0:00',
            });
            await page.screenshot({
                path: test.info().outputPath(`${locale}-800.png`),
            });
        } finally {
            await closeElectronApp(app);
        }
    });
}
