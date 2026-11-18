import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openSettings,
    openWorkspaceSection,
    saveSettings,
    test,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// The inline EPG panel under the live player is a compact strip: a 44px
// toolbar of ghost icon buttons over the ribbon. An M3U source with an XMLTV
// guide and no catch-up is the "schedule only" case, so its notice is an info
// button in the toolbar, not a row of its own. In Russian every label is
// translated, and the current block's ON NOW tag never covers its title.
// ---------------------------------------------------------------------------

const CHANNEL = 'Northwind Sports Extra';
const CHANNEL_ID = 'northwind-sports';
const CURRENT_TITLE = 'Synthetic Evening Highlights';

type Messages = {
    EPG: {
        TIMELINE: {
            ON_NOW: string;
            SCHEDULE_ONLY_NOTICE: string;
            JUMP_TODAY: string;
            JUMP_NEAREST: string;
        };
    };
    WORKSPACE: { SHELL: { RAIL_ALL_CHANNELS: string } };
};

function messages(locale: string): Messages {
    return JSON.parse(
        readFileSync(
            join(__dirname, `../../web/src/assets/i18n/${locale}.json`),
            'utf8'
        )
    ) as Messages;
}

function xmltvDate(ms: number): string {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
        date.getUTCDate()
    )}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00 +0000`;
}

/**
 * A past, a current and two future programmes. The current one started two
 * minutes ago, so the playhead sits right at the block's leading edge, where
 * the tag and the title are.
 */
function xmltv(): string {
    const now = Date.now();
    const minute = 60_000;
    const programmes: [number, number, string][] = [
        [now - 92 * minute, now - 2 * minute, 'Synthetic Morning Recap'],
        [now - 2 * minute, now + 58 * minute, CURRENT_TITLE],
        [now + 58 * minute, now + 118 * minute, 'Synthetic Studio Talk'],
        [now + 118 * minute, now + 178 * minute, 'Synthetic Late Show'],
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="${CHANNEL_ID}"><display-name>${CHANNEL}</display-name></channel>
${programmes
    .map(
        ([start, stop, title]) =>
            `  <programme start="${xmltvDate(start)}" stop="${xmltvDate(
                stop
            )}" channel="${CHANNEL_ID}"><title>${title}</title><desc>Synthetic guide entry.</desc></programme>`
    )
    .join('\n')}
</tv>
`;
}

async function box(locator: Locator) {
    const rect = await locator.boundingBox();
    if (!rect) throw new Error('Expected a rendered element');
    return rect;
}

function overlaps(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
): boolean {
    return (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
    );
}

/** Rendered text of the panel's visible elements that are not programme data. */
function chromeTexts(timeline: Locator): Promise<string[]> {
    return timeline.evaluate((root) => {
        const texts: string[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            const text = node.textContent?.trim();
            if (!parent || !text) continue;
            if (parent.closest('.epg-timeline__block, .epg-timeline__tick'))
                continue;
            if (parent.closest('.epg-timeline__heading b')) continue;
            if (parent.closest('mat-icon')) continue;
            if (!parent.checkVisibility()) continue;
            texts.push(text);
        }
        return texts;
    });
}

async function switchToRussian(page: Page): Promise<void> {
    await openSettings(page);
    await page.getByTestId('select-language').click();
    await page.getByTestId('ru').click();
    await saveSettings(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
}

test('@epg @m3u @electron keeps the inline EPG panel compact and translated', async ({
    dataDir,
}) => {
    test.setTimeout(180_000);
    const ru = messages('ru');
    const guide = await createMutableTextServer(xmltv(), {
        contentType: 'application/xml; charset=utf-8',
        resourcePath: '/compact-guide.xml',
    });
    const playlist = await createMutableTextServer(
        buildM3uContent([
            {
                name: CHANNEL,
                tvgId: CHANNEL_ID,
                url: 'https://example.com/live/northwind.m3u8',
            },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${guide.resourceUrl}"`),
        {
            contentType: 'application/x-mpegurl; charset=utf-8',
            resourcePath: '/compact-playlist.m3u',
        }
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;

    try {
        await page.route('https://example.com/**', (route) => route.abort());
        await importM3uPlaylistFromUrl(page, playlist.resourceUrl);
        await expect(
            page.locator('.epg-progress-panel .import-item.status-complete')
        ).toHaveCount(1, { timeout: 30_000 });
        await switchToRussian(page);
        await openWorkspaceSection(page, ru.WORKSPACE.SHELL.RAIL_ALL_CHANNELS);
        await channelItemByTitle(page, CHANNEL).click();

        const timeline = page.locator('app-epg-timeline');
        const toolbar = timeline.locator('.epg-timeline__toolbar');
        const panel = page.locator('.epg.epg--inline');
        const nowBlock = timeline.locator('.epg-timeline__block.is-now');
        await expect(nowBlock).toContainText(CURRENT_TITLE, {
            timeout: 30_000,
        });

        for (const [width, height] of [
            [1280, 800],
            [900, 700],
        ] as const) {
            await page.setViewportSize({ width, height });
            const label = `${width}×${height}`;

            // A 44px toolbar inside a panel of at most 216px.
            await expect
                .poll(async () => Math.round((await box(toolbar)).height))
                .toBe(44);
            // clamp(150px, 28vh, 216px), plus the host's 1px separator; the
            // height animates, so wait for it to settle.
            const expected = Math.min(216, Math.max(150, 0.28 * height));
            await expect
                .poll(async () =>
                    Math.abs((await box(panel)).height - 1 - expected)
                )
                .toBeLessThan(1);
            for (const button of await toolbar
                .locator('button.mat-mdc-icon-button')
                .all()) {
                expect((await box(button)).height, label).toBe(32);
            }

            // The notice is a toolbar button, not a row of its own.
            await expect(timeline.locator('.epg-timeline__notice')).toHaveCount(
                0
            );
            const notice = toolbar.getByRole('button', {
                name: ru.EPG.TIMELINE.SCHEDULE_ONLY_NOTICE,
            });
            await expect(notice).toBeVisible();
            await notice.click();
            const popover = page.locator('.epg-schedule-notice__popover');
            await expect(popover).toHaveText(
                ru.EPG.TIMELINE.SCHEDULE_ONLY_NOTICE
            );
            await expect(notice).toHaveAttribute('aria-expanded', 'true');
            await page.keyboard.press('Escape');
            await expect(popover).toHaveCount(0);
            await expect(notice).toBeFocused();

            // The ON NOW tag and the title are laid out apart, and the title
            // keeps its time line and at least one line at this height.
            const tag = nowBlock.locator('.epg-timeline__tag.is-now');
            const title = nowBlock.locator('.epg-timeline__block-title');
            const time = nowBlock.locator('.epg-timeline__block-time');
            await expect(tag).toHaveText(ru.EPG.TIMELINE.ON_NOW);
            const [tagBox, titleBox, timeBox, blockBox] = await Promise.all([
                box(tag),
                box(title),
                box(time),
                box(nowBlock),
            ]);
            expect(overlaps(tagBox, titleBox), label).toBe(false);
            expect(overlaps(tagBox, timeBox), label).toBe(false);
            expect(titleBox.height, label).toBeGreaterThanOrEqual(16);
            expect(tagBox.y + tagBox.height, label).toBeLessThanOrEqual(
                blockBox.y + blockBox.height
            );
            const tagSize = await tag.evaluate((element) =>
                parseFloat(getComputedStyle(element).fontSize)
            );
            expect(tagSize, label).toBeGreaterThanOrEqual(11);

            await page.screenshot({
                path: test.info().outputPath(`expanded-${width}.png`),
            });

            // A few days ahead has no programmes (the schedule ends shortly
            // after midnight): the empty state's message and both actions fit
            // inside the compact panel.
            const next = toolbar.locator('.epg-timeline__nav').last();
            const empty = timeline.locator('app-epg-timeline-empty-state');
            await expect(async () => {
                if (!(await empty.isVisible())) await next.click();
                await expect(empty).toBeVisible({ timeout: 1_000 });
            }).toPass({ timeout: 15_000 });
            const actions = [
                empty.getByRole('button', { name: ru.EPG.TIMELINE.JUMP_TODAY }),
                empty.getByRole('button', {
                    name: ru.EPG.TIMELINE.JUMP_NEAREST,
                }),
            ];
            await expect(actions[0]).toBeVisible();
            const emptyBox = await box(empty);
            for (const action of actions) {
                const actionBox = await box(action);
                expect(actionBox.y, label).toBeGreaterThanOrEqual(emptyBox.y);
                expect(
                    actionBox.y + actionBox.height,
                    `${label}: empty-state action inside the panel`
                ).toBeLessThanOrEqual(emptyBox.y + emptyBox.height);
            }
            await page.screenshot({
                path: test.info().outputPath(`empty-day-${width}.png`),
            });
            await actions[0].click();
            await expect(nowBlock).toBeVisible();

            // Collapsed: the bar is the toolbar's height, the source label is
            // translated and the channel name is not cut while room is left.
            await timeline.locator('.epg-timeline__collapse').click();
            await expect(
                timeline.locator('.epg-timeline--collapsed')
            ).toHaveCount(1);
            // (the M3U host draws a 1px separator above the panel)
            await expect
                .poll(async () => Math.round((await box(timeline)).height))
                .toBe(44);
            expect((await box(panel)).height, label).toBeLessThanOrEqual(45);
            const name = timeline.locator('.epg-timeline__heading b');
            await expect(name).toHaveText(CHANNEL);
            expect(
                await name.evaluate(
                    (element) => element.scrollWidth <= element.clientWidth
                ),
                `${label}: channel name fits`
            ).toBe(true);
            // ...nor the programme title while the bar has room for it.
            const summaryTitle = timeline.locator(
                '.epg-timeline__summary-title'
            );
            await expect(summaryTitle).toHaveText(CURRENT_TITLE);
            if (width >= 1280) {
                expect(
                    await summaryTitle.evaluate(
                        (element) => element.scrollWidth <= element.clientWidth
                    ),
                    `${label}: programme title fits`
                ).toBe(true);
            }
            for (const text of await chromeTexts(timeline)) {
                expect(text, `${label}: translated chrome`).not.toMatch(
                    /^(Timeline|Xtream|TIMELINE)$/i
                );
            }
            await page.screenshot({
                path: test.info().outputPath(`collapsed-${width}.png`),
            });
            await timeline.locator('.epg-timeline__collapse').click();
            await expect(
                timeline.locator('.epg-timeline--collapsed')
            ).toHaveCount(0);
        }
    } finally {
        await closeElectronApp(app);
        await playlist.close();
        await guide.close();
    }
});
