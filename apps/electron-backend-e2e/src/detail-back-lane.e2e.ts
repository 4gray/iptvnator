import type { Locator, Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// The detail shell's sticky Back control floats over its scroll owner. While
// it is shown, every content column reserves the control's lane, so no
// scroll position may put it over the "Seasons and Episodes" heading or the
// inline player's top-left corner. Tested at a wide and a narrow window; the
// workspace rail and category panel leave the detail pane far narrower than
// either, and the heading used to wrap beside its actions (two lines at
// 1280px, three at 780px) with its first word under the arrow.
// ---------------------------------------------------------------------------

const widths = [1280, 780];
const playerCorner = 56;

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
                .querySelector('.section-title')
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

/** Line boxes of the heading's text; 1 means it did not wrap. */
function headingLineCount(page: Page): Promise<number> {
    return page.locator('.section-title').evaluate((heading) => {
        const range = document.createRange();
        range.selectNodeContents(heading);
        const lines = [...range.getClientRects()]
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top));
        return new Set(lines).size;
    });
}

/**
 * Lets the browse↔watch morph and the player's fade-in settle. Bounded, so a
 * paused animation elsewhere in the player cannot stall the test.
 */
async function settle(shell: Locator): Promise<void> {
    await shell.evaluate((element) =>
        Promise.race([
            Promise.all(
                element
                    .getAnimations({ subtree: true })
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

            const shell = page.locator('app-portal-detail-shell');
            const episodes = page.locator('.episode-card');
            await expect(page.locator('.section-title')).toBeVisible({
                timeout: 20_000,
            });
            await expect(episodes.first()).toBeVisible({ timeout: 20_000 });

            await expectBackClearOfContent(page, 'browse');

            await page.setViewportSize({ width: widths[0], height: 800 });
            await episodes.first().click();
            await expect(shell).toHaveClass(/shell-host--watch/);
            await expect(
                shell.locator('app-portal-inline-player app-web-player-view')
            ).toBeVisible({ timeout: 20_000 });

            await expectBackClearOfContent(page, 'watch');
        } finally {
            await closeElectronApp(app);
        }
    });
});
