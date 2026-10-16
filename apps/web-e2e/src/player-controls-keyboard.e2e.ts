import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pressTab } from './e2e-helpers';
import { expect, test } from './fixtures';
import {
    importPlaylist,
    selectPlayer,
    serveClip,
    startClip,
} from './player-settings-panel.fixture';

/**
 * Keyboard and assistive-technology access to the shared controls in both
 * app themes: every dock control and every settings choice shows a focus
 * ring in the overlay's own colour, each settings radio group is one Tab
 * stop with arrow-key navigation, the open panel passes axe, its headings
 * stay readable over bright frames, and long German and Russian headings
 * wrap inside the compact sheet. ArtPlayer is used because it offers the
 * fullest panel (subtitle file, size and colour, speed).
 */

test.use({ serviceWorkers: 'block' });

/** `--pc-text`, the overlay's text colour, as computed styles report it. */
const RING_COLOR = 'rgb(231, 236, 243)';
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface FocusStop {
    label: string;
    role: string | null;
    group: string | null;
    checked: string | null;
    iconButton: boolean;
    outline: string;
    outlineColor: string;
}

/** Describes the focused element and the ring it draws. */
function focusStop(page: Page): Promise<FocusStop | null> {
    return page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        const group = element.closest('[role="radiogroup"]');
        return {
            label:
                element.getAttribute('aria-label') ??
                element.textContent?.trim() ??
                '',
            role: element.getAttribute('role'),
            group: group?.getAttribute('aria-labelledby') ?? null,
            checked: element.getAttribute('aria-checked'),
            iconButton: element.matches('button[mat-icon-button]'),
            outline: `${style.outlineStyle} ${style.outlineWidth}`,
            outlineColor: style.outlineColor,
        };
    });
}

function focusIsInside(page: Page, selector: string): Promise<boolean> {
    return page.evaluate(
        (within) => !!document.activeElement?.closest(within),
        selector
    );
}

/**
 * Presses Tab (or Shift+Tab) until focus lies inside `target`, or leaves
 * `within` when that is given, and returns every stop on the way — the
 * last one included.
 */
async function tabUntil(
    page: Page,
    browserName: string,
    options: {
        target?: string;
        within?: string;
        direction?: 'forward' | 'backward';
        max?: number;
    }
): Promise<FocusStop[]> {
    const stops: FocusStop[] = [];
    for (let step = 0; step < (options.max ?? 20); step++) {
        await pressTab(page, browserName, options.direction);
        if (options.within && !(await focusIsInside(page, options.within))) {
            return stops;
        }
        const stop = await focusStop(page);
        if (stop) stops.push(stop);
        if (options.target && (await focusIsInside(page, options.target))) {
            return stops;
        }
    }
    return stops;
}

async function applyTheme(page: Page, theme: 'light' | 'dark') {
    await page.evaluate((dark) => {
        document.body.classList.toggle('dark-theme', dark);
    }, theme === 'dark');
}

async function expectNoAxeViolations(panel: Locator) {
    await panel.page().evaluate(AXE_SOURCE);
    const violations = await panel.evaluate(async (element) => {
        const axe = (window as unknown as { axe: typeof import('axe-core') })
            .axe;
        const results = await axe.run(element, { resultTypes: ['violations'] });
        return results.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.map((node) => node.target.join(' ')),
        }));
    });
    expect(violations).toEqual([]);
}

/**
 * Heading contrast on the panel glass composited over a mid-grey and a white
 * frame — the video behind the panel can be anything.
 */
function headingContrast(panel: Locator) {
    return panel.evaluate((host) => {
        type Color = [number, number, number, number];
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const parse = (css: string): Color => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
            return [r, g, b, a / 255];
        };
        // `front` over an opaque `back`: the result is opaque too.
        const over = (front: Color, back: Color): Color => [
            front[0] * front[3] + back[0] * (1 - front[3]),
            front[1] * front[3] + back[1] * (1 - front[3]),
            front[2] * front[3] + back[2] * (1 - front[3]),
            1,
        ];
        const luminance = (color: Color) => {
            const [r, g, b] = color.slice(0, 3).map((value) => {
                const s = value / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const ratio = (a: Color, b: Color) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
        };
        const glass = parse(getComputedStyle(host).backgroundColor);
        return Array.from(host.querySelectorAll('h3, h4'), (heading) => {
            const text = parse(getComputedStyle(heading).color);
            const on = (frame: Color) => {
                const surface = over(glass, frame);
                return ratio(over(text, surface), surface);
            };
            return {
                heading: heading.textContent?.trim(),
                midGrey: on([128, 128, 128, 1]),
                white: on([255, 255, 255, 1]),
            };
        });
    });
}

test('@web @playback keyboard reaches the dock and the settings radios with a visible ring in both themes', async ({
    page,
    browserName,
}) => {
    test.setTimeout(120_000);
    // Chips and the side panel need a player of at least 960px.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await serveClip(page);
    await selectPlayer(page, 'ArtPlayer');
    await importPlaylist(page);
    const { view, video, controls } = await startClip(page);
    // Park the pointer on the video away from the dock and the panel: a
    // control that slides in under a resting pointer shows its hover
    // tooltip, and a visible tooltip spends the next Escape on itself.
    await view.hover({ position: { x: 24, y: 24 } });
    const tune = controls.locator(
        '[data-test-id="player-controls-settings-button"]'
    );
    const panel = controls.getByRole('dialog', { name: 'Settings' });

    for (const theme of ['light', 'dark'] as const) {
        await applyTheme(page, theme);

        // --- The dock, from the timeline to the last control. -------------
        await controls
            .getByRole('slider', { name: 'Playback position' })
            .focus();
        const dockButtons = (
            await tabUntil(page, browserName, { within: 'app-player-controls' })
        ).filter((stop) => stop.iconButton);
        // Every icon button wears the ring, whatever the app theme.
        expect(dockButtons.map((stop) => stop.outline)).toEqual(
            dockButtons.map(() => 'solid 2px')
        );
        expect(dockButtons.map((stop) => stop.outlineColor)).toEqual(
            dockButtons.map(() => RING_COLOR)
        );
        expect(dockButtons.map((stop) => stop.label)).toEqual(
            expect.arrayContaining([
                'Mute',
                'Back 10 seconds',
                'Forward 10 seconds',
                'Settings',
                'Enter fullscreen',
            ])
        );

        // --- Open the panel from the keyboard: focus moves into it. -------
        await tabUntil(page, browserName, {
            target: '[data-test-id="player-controls-settings-button"]',
            direction: 'backward',
            max: 10,
        });
        await expect(tune).toBeFocused();
        await expect(tune).toHaveAttribute('aria-haspopup', 'dialog');
        await page.screenshot({
            path: test.info().outputPath(`${theme}-dock-focus.png`),
        });
        await page.keyboard.press('Enter');
        await expect(panel).toBeVisible();
        await expect(panel).toBeFocused();

        // Tab enters every radio group once, on its checked option, and
        // every stop wears the ring.
        const panelStops = await tabUntil(page, browserName, {
            target: '[data-test-id="player-settings-speed"]',
        });
        expect(panelStops.map((stop) => stop.outline)).toEqual(
            panelStops.map(() => 'solid 2px')
        );
        expect(panelStops.map((stop) => stop.outlineColor)).toEqual(
            panelStops.map(() => RING_COLOR)
        );
        const radioStops = panelStops.filter((stop) => stop.role === 'radio');
        // Subtitle size, subtitle colour and speed: one stop each, checked.
        expect(radioStops.map((stop) => stop.checked)).toEqual([
            'true',
            'true',
            'true',
        ]);
        expect(new Set(radioStops.map((stop) => stop.group)).size).toBe(3);

        // --- Arrows move focus and apply the option they reach. ----------
        const speedGroup = panel.locator(
            '[data-test-id="player-settings-speed"] [role="radiogroup"]'
        );
        const rate = () =>
            video.evaluate((el: HTMLVideoElement) => el.playbackRate);
        await page.keyboard.press('ArrowRight');
        const moved = await focusStop(page);
        expect(moved?.role).toBe('radio');
        await expect.poll(rate).toBe(Number.parseFloat(moved?.label ?? ''));
        await expect(
            speedGroup.locator('[role="radio"][aria-checked="true"]')
        ).toHaveText(moved?.label ?? '');
        await page.keyboard.press('Home');
        expect((await focusStop(page))?.label).toBe('0.5×');
        await expect.poll(rate).toBe(0.5);
        await expect(
            speedGroup.locator('[role="radio"][aria-checked="true"]')
        ).toHaveText('0.5×');
        // The ends wrap, as in a native radio group.
        await page.keyboard.press('ArrowLeft');
        expect((await focusStop(page))?.label).toBe('2×');
        await expect.poll(rate).toBe(2);
        await expect(speedGroup.locator('[tabindex="0"]')).toHaveText('2×');
        // Leaving and re-entering lands on the checked option — the one the
        // engine reports, so wait for it to confirm the switch first.
        await expect(
            speedGroup.locator('[role="radio"][aria-checked="true"]')
        ).toHaveText('2×');
        await pressTab(page, browserName, 'backward');
        await pressTab(page, browserName);
        expect((await focusStop(page))?.label).toBe('2×');

        // --- A focused selected swatch differs from a selected one. -------
        await tabUntil(page, browserName, {
            target: '.player-settings__swatches',
            direction: 'backward',
            max: 5,
        });
        const focusedSwatch = panel.locator('.player-settings__swatch:focus');
        await expect(focusedSwatch).toHaveAttribute('aria-checked', 'true');
        await expect(focusedSwatch).toHaveCSS('outline-style', 'solid');
        // The arrow checks the next swatch, which takes focus and the ring.
        await page.keyboard.press('ArrowRight');
        await expect(focusedSwatch).toHaveAttribute('aria-checked', 'true');
        await expect(focusedSwatch).toHaveCSS('outline-style', 'solid');
        // Tab moves on to the speed group: the checked swatch keeps its
        // selected border but loses the ring.
        await pressTab(page, browserName);
        expect(
            await focusIsInside(page, '[data-test-id="player-settings-speed"]')
        ).toBe(true);
        const selectedOnly = panel.locator(
            '.player-settings__swatch[aria-checked="true"]'
        );
        await expect(selectedOnly).toHaveCount(1);
        await expect(selectedOnly).not.toBeFocused();
        await expect(selectedOnly).toHaveCSS('outline-style', 'none');
        await expect(selectedOnly).toHaveCSS(
            'border-top-color',
            'rgb(255, 255, 255)'
        );

        // --- Headings, axe and closing. ----------------------------------
        const contrast = await headingContrast(panel);
        expect(contrast.length).toBeGreaterThan(0);
        expect(
            contrast.filter(
                (heading) => heading.midGrey < 4.5 || heading.white < 4.5
            )
        ).toEqual([]);
        await expectNoAxeViolations(panel);
        await page.screenshot({
            path: test.info().outputPath(`${theme}-panel-focus.png`),
        });

        // Focus is on a speed radio, which has no tooltip. Material spends
        // an Escape on any tooltip still showing (the swatch's fades out),
        // so wait for it to go before closing.
        await expect(page.locator('.mat-mdc-tooltip')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(tune).toBeFocused();
    }
});

for (const [locale, speedHeading] of [
    ['de', 'Wiedergabegeschwindigkeit'],
    ['ru', 'Скорость воспроизведения'],
] as const) {
    test(`@web @playback settings sheet headings wrap in the ${locale} locale`, async ({
        page,
    }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 900, height: 700 });
        await serveClip(page);
        await selectPlayer(page, 'ArtPlayer');
        const playlistUrl = await importPlaylist(page);

        await page.goto('/workspace/settings/general');
        await page.locator('[data-test-id="select-language"]').click();
        await page.locator(`mat-option[data-test-id="${locale}"]`).click();
        const save = page.locator('[data-test-id="save-settings"]');
        await save.click();
        await expect(save).toBeHidden();

        await page.goto(playlistUrl);
        const { controls } = await startClip(page);
        await controls
            .locator('[data-test-id="player-controls-settings-button"]')
            .click();
        const sheet = controls.locator(
            '[data-test-id="player-controls-settings-panel"]'
        );
        await expect(sheet).toHaveClass(/player-controls__settings--sheet/);
        await expect(
            sheet.locator('[data-test-id="player-settings-speed"] h3')
        ).toHaveText(speedHeading);

        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            const headings = await sheet.evaluate((host) =>
                Array.from(host.querySelectorAll('h3, h4'), (heading) => {
                    const box = heading.getBoundingClientRect();
                    const control = heading.nextElementSibling;
                    const style = getComputedStyle(heading);
                    return {
                        text: heading.textContent?.trim(),
                        overflow: heading.scrollWidth - heading.clientWidth,
                        // A group heading sits in the sheet's left column,
                        // beside its control.
                        intoControl:
                            heading.tagName === 'H3' && control
                                ? box.right -
                                  control.getBoundingClientRect().left
                                : 0,
                        lines: Math.round(
                            (box.height -
                                Number.parseFloat(style.paddingTop) -
                                Number.parseFloat(style.paddingBottom)) /
                                Number.parseFloat(style.lineHeight)
                        ),
                    };
                })
            );
            for (const heading of headings) {
                expect(heading.overflow, heading.text).toBeLessThanOrEqual(0);
                expect(heading.intoControl, heading.text).toBeLessThanOrEqual(
                    0
                );
            }
            expect(
                headings.find((heading) => heading.text === speedHeading)?.lines
            ).toBeGreaterThan(1);
            await expectNoAxeViolations(sheet);
        }
        await page.screenshot({
            path: test.info().outputPath(`${locale}-sheet.png`),
        });
    });
}
