import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// The detail shell's sticky Back control floats over its scroll owner. While
// it is shown, every content column reserves the control's lane, so no
// scroll position may put it over the "Episodes" heading or the inline
// player's top-left corner. Tested at a wide and a narrow window; the
// workspace rail and category panel leave the detail pane far narrower than
// either, and the heading used to wrap beside its actions (two lines at
// 1280px, three at 780px) with its first word under the arrow.
//
// A pane under 400px cannot spare the lane: a 700px window beside the
// category panel, or a phone. There the control sits in an opaque sticky bar,
// and whatever reaches the arrow's band must be hidden beneath the bar, never
// visible beside the arrow.
// ---------------------------------------------------------------------------

const widths = [1280, 780];
const compactWidths = [700, 375];
const playerCorner = 56;
/** The widest translation of the heading; it must fit wherever English does. */
const widestLocale = 'nl';
const widestHeading = (
    JSON.parse(
        readFileSync(
            join(__dirname, `../../web/src/assets/i18n/${widestLocale}.json`),
            'utf8'
        )
    ) as { PORTALS: { DETAIL: { EPISODES: string } } }
).PORTALS.DETAIL.EPISODES;

type Sweep = {
    overlaps: string[];
    /** Scroll positions where the target shared the arrow's vertical band. */
    beside: { player: number; title: number };
};

/**
 * Scrolls the shell from top to bottom in steps shorter than the arrow and
 * records every position where the arrow's box intersects the heading or the
 * player's top-left corner. Reads layout synchronously after each scroll
 * write, so a hidden or throttled window cannot skip frames.
 */
function sweepDetail(shell: Locator): Promise<Sweep> {
    return shell.evaluate((element, corner) => {
        const back = element.querySelector('.shell__back-button');
        if (!back) throw new Error('The detail shows no Back control.');
        const sweep = {
            overlaps: [] as string[],
            beside: { player: 0, title: 0 },
        };
        const max = element.scrollHeight - element.clientHeight;
        for (let top = 0; ; top = Math.min(max, top + 24)) {
            element.scrollTop = top;
            const arrow = back.getBoundingClientRect();
            const title = element
                .querySelector('[data-test-id="episodes-heading"]')
                ?.getBoundingClientRect();
            const player = element
                .querySelector('app-portal-inline-player')
                ?.getBoundingClientRect();
            const targets = {
                title,
                player: player && {
                    left: player.left,
                    top: player.top,
                    right: player.left + corner,
                    bottom: player.top + corner,
                },
            };
            for (const [name, box] of Object.entries(targets)) {
                if (!box) continue;
                const sameBand =
                    box.top < arrow.bottom && arrow.top < box.bottom;
                if (!sameBand) continue;
                sweep.beside[name as keyof Sweep['beside']] += 1;
                if (box.left < arrow.right && arrow.left < box.right) {
                    sweep.overlaps.push(`${name} at scrollTop ${top}`);
                }
            }
            if (top >= max) break;
        }
        element.scrollTop = 0;
        return sweep;
    }, playerCorner);
}

type BarSweep = {
    background: string;
    /** Scroll positions where a target reached the bar's band. */
    beneath: number;
    /** Points of a target in the bar's band that hit content, not the bar. */
    exposed: string[];
};

/**
 * Compact counterpart of {@link sweepDetail}: the bar sits in flow and
 * content scrolls beneath it, so boxes do intersect. Instead, every sampled
 * point of the heading or the player's corner that is inside the bar's band
 * must hit-test to the bar: hidden beneath it, and unreachable by a tap.
 */
function sweepBar(shell: Locator): Promise<BarSweep> {
    return shell.evaluate((element, corner) => {
        const bar = element.querySelector('.shell__navigation');
        if (!bar) throw new Error('The detail shows no Back control.');
        const sweep = {
            background: getComputedStyle(bar).backgroundColor,
            beneath: 0,
            exposed: [] as string[],
        };
        const max = element.scrollHeight - element.clientHeight;
        for (let top = 0; ; top = Math.min(max, top + 24)) {
            element.scrollTop = top;
            const band = bar.getBoundingClientRect();
            const title = element
                .querySelector('[data-test-id="episodes-heading"]')
                ?.getBoundingClientRect();
            const player = element
                .querySelector('app-portal-inline-player')
                ?.getBoundingClientRect();
            const targets = {
                title,
                player: player && {
                    left: player.left,
                    top: player.top,
                    right: player.left + corner,
                    bottom: player.top + corner,
                },
            };
            for (const [name, box] of Object.entries(targets)) {
                if (!box) continue;
                const from = Math.max(box.top, band.top);
                const to = Math.min(box.bottom, band.bottom);
                if (to <= from) continue;
                sweep.beneath += 1;
                const y = (from + to) / 2;
                for (const x of [box.left + 2, box.right - 2]) {
                    const hit = element.ownerDocument.elementFromPoint(x, y);
                    if (!hit || !bar.contains(hit)) {
                        sweep.exposed.push(
                            `${name} at scrollTop ${top} hits ${hit?.tagName}.${String(hit?.className)}`
                        );
                    }
                }
            }
            if (top >= max) break;
        }
        element.scrollTop = 0;
        return sweep;
    }, playerCorner);
}

/** Line boxes of the heading's text; 1 means it did not wrap. */
function headingLineCount(page: Page): Promise<number> {
    return page
        .locator('[data-test-id="episodes-heading"]')
        .evaluate((heading) => {
            const range = document.createRange();
            range.selectNodeContents(heading);
            const lines = [...range.getClientRects()]
                .filter((rect) => rect.width > 0)
                .map((rect) => Math.round(rect.top));
            return new Set(lines).size;
        });
}

/**
 * Lets the browse↔watch morph, the player's fade-in and the workspace's own
 * transitions settle — crossing into the phone layout slides the category
 * drawer out over the page for 200ms. Bounded, so a paused animation
 * elsewhere cannot stall the test.
 */
async function settle(shell: Locator): Promise<void> {
    await shell.evaluate((element) =>
        Promise.race([
            Promise.all(
                element.ownerDocument
                    .getAnimations()
                    .filter(
                        (animation) =>
                            animation.effect?.getTiming().iterations !==
                            Infinity
                    )
                    .map((animation) =>
                        animation.finished.catch(() => undefined)
                    )
            ),
            new Promise((resolve) => setTimeout(resolve, 2_000)),
        ])
    );
}

async function expectBackClearOfContent(
    page: Page,
    state: 'browse' | 'watch'
): Promise<void> {
    const shell = page.locator('app-portal-detail-shell');
    for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        // Fail on the mode first: a lane assertion against the bar would
        // only report confusing intersections.
        await expect(shell, `${state} at ${width}px`).not.toHaveClass(
            /shell-host--compact/
        );
        await settle(shell);
        const sweep = await sweepDetail(shell);

        expect(sweep.overlaps, `${state} at ${width}px`).toEqual([]);
        // The sweep has to carry the heading (and the player) past the arrow,
        // or the empty overlap list proves nothing.
        expect(sweep.beside.title, `${state} at ${width}px`).toBeGreaterThan(0);
        if (state === 'watch') {
            expect(
                sweep.beside.player,
                `${state} at ${width}px`
            ).toBeGreaterThan(0);
        }
        expect(await headingLineCount(page), `${state} at ${width}px`).toBe(1);
    }

    for (const width of compactWidths) {
        await page.setViewportSize({ width, height: 800 });
        await expect(shell, `${state} at ${width}px`).toHaveClass(
            /shell-host--compact/
        );
        await settle(shell);
        const sweep = await sweepBar(shell);

        expect(sweep.exposed, `${state} at ${width}px`).toEqual([]);
        expect(sweep.beneath, `${state} at ${width}px`).toBeGreaterThan(0);
        // Opaque, or what scrolls beneath would show through.
        expect(sweep.background, `${state} at ${width}px`).toMatch(/^rgb\(/);
        expect(await headingLineCount(page), `${state} at ${width}px`).toBe(1);
    }
}

/**
 * Re-checks the heading in the widest translation at the lane and bar widths.
 * Below them (a ~220px header beside the category panel) a translation wider
 * than the pane itself wraps by design rather than losing words to an
 * ellipsis.
 */
async function expectWidestHeadingOnOneLine(
    page: Page,
    detailUrl: string
): Promise<void> {
    await page.setViewportSize({ width: widths[0], height: 800 });
    await openSettings(page);
    await page.getByTestId('select-language').click();
    await page.getByTestId(widestLocale).click();
    await saveSettings(page);
    await page.goBack();
    await page.waitForURL(detailUrl);
    await expect(page.locator('[data-test-id="episodes-heading"]')).toHaveText(
        widestHeading,
        {
            timeout: 20_000,
        }
    );
    for (const width of [...widths, ...compactWidths]) {
        await page.setViewportSize({ width, height: 800 });
        expect(
            await headingLineCount(page),
            `${widestLocale} at ${width}px`
        ).toBe(1);
    }
}

/**
 * The actions move onto their own row before the heading wraps, at every
 * pane width that can hold the heading at all — including the widths where
 * the lane gives way to the bar.
 */
async function expectHeadingOnOneLine(page: Page): Promise<void> {
    const wrapped: number[] = [];
    for (let width = 680; width <= 1600; width += 20) {
        await page.setViewportSize({ width, height: 800 });
        if ((await headingLineCount(page)) !== 1) wrapped.push(width);
    }
    expect(wrapped).toEqual([]);
}

test.describe('Portal detail Back lane', () => {
    test('@xtream @electron keeps the Back arrow off the heading and the player while scrolling', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickFirstGridListCard(page);
            await page.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/
            );

            const detailUrl = page.url();
            const shell = page.locator('app-portal-detail-shell');
            const episodes = page.locator('.episode-card');
            await expect(
                page.locator('[data-test-id="episodes-heading"]')
            ).toBeVisible({
                timeout: 20_000,
            });
            await expect(episodes.first()).toBeVisible({ timeout: 20_000 });

            await expectBackClearOfContent(page, 'browse');
            await expectHeadingOnOneLine(page);

            await page.setViewportSize({ width: widths[0], height: 800 });
            await episodes.first().click();
            await expect(shell).toHaveClass(/shell-host--watch/);
            await expect(
                shell.locator('app-portal-inline-player app-web-player-view')
            ).toBeVisible({ timeout: 20_000 });

            await expectBackClearOfContent(page, 'watch');
            await expectWidestHeadingOnOneLine(page, detailUrl);
        } finally {
            await closeElectronApp(app);
        }
    });
});
