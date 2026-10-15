import type { Locator, Page } from '@playwright/test';
import {
    addCurrentDetailToFavorites,
    goBackFromDetail,
} from './dashboard-e2e-flows';
import {
    addXtreamPortal,
    buildM3uContent,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openGlobalFavorites,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

// ---------------------------------------------------------------------------
// Every single choice shown side by side is the kit's segmented control: the
// favorites content and scope toggles, the season tabs, the episode list/grid
// switch and the playlist switcher's type filter. In a header row it is 32px
// tall (26px segments in a 2px-padded, 1px-bordered track); the switcher
// panel keeps 30px segments. Unchosen labels must stay legible in both
// themes: the muted colour read about 2.9:1 on the track. A control never
// grows past its container: squeezed, its segments wrap inside the track
// rather than being clipped (four translated season names in the fullscreen
// episode panel).
// ---------------------------------------------------------------------------

async function frame(locator: Locator) {
    return locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            height: Math.round(element.getBoundingClientRect().height),
            radius: style.borderRadius,
        };
    });
}

/** Labels of the segments that stick out of the control's own frame. */
async function segmentsOutside(control: Locator): Promise<string[]> {
    return control.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        return Array.from(element.children)
            .filter((segment) => {
                const rect = segment.getBoundingClientRect();
                return (
                    rect.left < frame.left - 0.5 ||
                    rect.right > frame.right + 0.5 ||
                    rect.bottom > frame.bottom + 0.5
                );
            })
            .map((segment) => segment.textContent?.trim() ?? '');
    });
}

async function expectUnchosenLegible(page: Page, unchosen: Locator[]) {
    for (const theme of ['light', 'dark'] as const) {
        await applyTheme(page, theme);
        for (const segment of unchosen) {
            await expectTextContrast(segment);
        }
    }
    await applyTheme(page, 'light');
}

test.describe('Electron segmented controls', () => {
    test('draws the season tabs, list/grid switch, favorites toggles and switcher type filter as one legible segmented control', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        // A second source kind is what shows the switcher's type filter.
        const m3u = await createMutableTextServer(
            buildM3uContent([
                {
                    name: 'Segment Channel',
                    url: 'https://example.com/live/segment.m3u8',
                },
            ]),
            {
                contentType: 'application/x-mpegurl; charset=utf-8',
                resourcePath: '/segmented.m3u',
            }
        );
        let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;

        try {
            app = await launchElectronApp(dataDir);
            const page = app.mainWindow;
            await page.route('https://example.com/**', (route) =>
                route.abort()
            );
            await importM3uPlaylistFromUrl(page, m3u.resourceUrl);
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page.setViewportSize({ width: 1280, height: 760 });

            // A three-season series: the tabs, not the season picker.
            await openWorkspaceSection(page, 'Series');
            const seriesCard = page
                .locator('app-category-content-view mat-card')
                .first();
            await expect(seriesCard).toBeVisible({ timeout: 30_000 });
            await seriesCard.click();
            const tablist = page.locator(
                'app-season-tabs .season-tabs__track[role="tablist"]'
            );
            await expect(tablist).toBeVisible({ timeout: 30_000 });
            const tabs = tablist.getByRole('tab');
            await expect(tabs).toHaveCount(3);
            await expect(tablist.locator(':scope > *')).toHaveCount(3);
            expect(await frame(tablist)).toEqual({
                height: 32,
                radius: '10px',
            });
            const viewSwitch = page.locator(
                '.view-toggle mat-button-toggle-group'
            );
            expect(await frame(viewSwitch)).toEqual({
                height: 32,
                radius: '10px',
            });
            await expectUnchosenLegible(page, [
                tabs.nth(1),
                viewSwitch.locator(
                    '.mat-button-toggle:not(.mat-button-toggle-checked)'
                ),
            ]);

            // Squeezed below its segments' width, the track wraps them and
            // stays inside the tabs' host.
            await tablist.evaluate((element) => {
                (
                    element.closest('app-season-tabs') as HTMLElement
                ).style.width = '140px';
            });
            expect(await segmentsOutside(tablist)).toEqual([]);
            expect(
                await tablist.evaluate(
                    (element) =>
                        element.getBoundingClientRect().right <=
                        (
                            element.closest('app-season-tabs') as HTMLElement
                        ).getBoundingClientRect().right +
                            0.5
                )
            ).toBe(true);
            await tablist.evaluate((element) => {
                (
                    element.closest('app-season-tabs') as HTMLElement
                ).style.width = '';
            });
            await addCurrentDetailToFavorites(page);
            await goBackFromDetail(page);

            await openWorkspaceSection(page, 'Movies');
            const movieCard = page
                .locator('app-category-content-view mat-card')
                .first();
            await expect(movieCard).toBeVisible({ timeout: 30_000 });
            await movieCard.click();
            await addCurrentDetailToFavorites(page);
            await goBackFromDetail(page);

            await openGlobalFavorites(page);
            const header = page
                .locator('app-unified-collection-page .collection-header')
                .first();
            const contentToggle = header.locator('.content-toggle');
            const scopeToggle = header.locator('.scope-toggle');
            await expect(contentToggle).toBeVisible({ timeout: 20_000 });
            for (const toggle of [contentToggle, scopeToggle]) {
                expect(await frame(toggle)).toEqual({
                    height: 32,
                    radius: '10px',
                });
            }
            const unchosen =
                '.mat-button-toggle:not(.mat-button-toggle-checked)';
            await expectUnchosenLegible(page, [
                contentToggle.locator(unchosen),
                scopeToggle.locator(unchosen),
            ]);
            // A Material group wraps its toggles the same way.
            await scopeToggle.evaluate((element) => {
                (element as HTMLElement).style.width = '120px';
            });
            expect(await segmentsOutside(scopeToggle)).toEqual([]);
            await scopeToggle.evaluate((element) => {
                (element as HTMLElement).style.width = '';
            });

            await page.getByTestId('playlist-switcher-trigger').click();
            const types = page.locator(
                'app-playlist-switcher-panel .switcher__types'
            );
            await expect(types).toBeVisible({ timeout: 10_000 });
            expect(await frame(types)).toEqual({
                height: 36,
                radius: '10px',
            });
            await expectUnchosenLegible(page, [
                types.locator(unchosen).first(),
            ]);
            await page.keyboard.press('Escape');
        } finally {
            if (app) await closeElectronApp(app);
            await m3u.close();
        }
    });
});
