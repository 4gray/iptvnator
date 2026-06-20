import { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    fillWorkspaceSearch,
    expectPathname,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForStalkerCatalog,
    waitForPortalDebugEvent,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getXtreamDateValue,
    getXtreamTitle,
} from './portal-mock-fixtures';

test.describe('Electron Catalog Sorting', () => {
    test('sorts Xtream live channels by server order and name, with persistence after revisit', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const fixture = await fetchXtreamLiveFixture(
            request,
            xtreamCredentials
        );
        const expectedServerOrder = fixture.items
            .map((item) => getXtreamTitle(item))
            .filter((title, index, titles) => titles.indexOf(title) === index)
            .slice(0, 5);
        const expectedAscending = fixture.items
            .map((item) => getXtreamTitle(item))
            .filter((title, index, titles) => titles.indexOf(title) === index)
            .sort(collator.compare)
            .slice(0, 5);
        const expectedDescending = fixture.items
            .map((item) => getXtreamTitle(item))
            .filter((title, index, titles) => titles.indexOf(title) === index)
            .sort(collator.compare)
            .reverse()
            .slice(0, 5);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );

            await expectVisibleChannelTitles(
                app.mainWindow,
                expectedServerOrder
            );

            await setLiveSortMode(app.mainWindow, 'Name A-Z');
            await expectVisibleChannelTitles(app.mainWindow, expectedAscending);

            await setLiveSortMode(app.mainWindow, 'Name Z-A');
            await expectVisibleChannelTitles(
                app.mainWindow,
                expectedDescending
            );

            await setLiveSortMode(app.mainWindow, 'Name A-Z');
            await openWorkspaceSection(app.mainWindow, 'Movies');
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );
            await expectVisibleChannelTitles(app.mainWindow, expectedAscending);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('sorts Xtream VOD and series content, and keeps the chosen sort after revisiting the section', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(
            request,
            xtreamCredentials
        );
        const seriesFixture = await fetchXtreamSeriesFixture(
            request,
            xtreamCredentials
        );
        const expectedVodDateDesc = [...vodFixture.items]
            .sort(
                (left, right) =>
                    getXtreamDateValue(right) - getXtreamDateValue(left)
            )
            .map((item) => getXtreamTitle(item))
            .slice(0, visibleComparisonSize);
        const expectedVodDateAsc = [...vodFixture.items]
            .sort(
                (left, right) =>
                    getXtreamDateValue(left) - getXtreamDateValue(right)
            )
            .map((item) => getXtreamTitle(item))
            .slice(0, visibleComparisonSize);
        const expectedVodNameAsc = [...vodFixture.items]
            .map((item) => getXtreamTitle(item))
            .sort(collator.compare)
            .slice(0, visibleComparisonSize);
        const expectedVodNameDesc = [...vodFixture.items]
            .map((item) => getXtreamTitle(item))
            .sort(collator.compare)
            .reverse()
            .slice(0, visibleComparisonSize);
        const expectedSeriesNameAsc = [...seriesFixture.items]
            .map((item) => getXtreamTitle(item))
            .sort(collator.compare)
            .slice(0, visibleComparisonSize);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await expectVisibleGridTitles(app.mainWindow, expectedVodDateDesc);

            await setContentSortMode(
                app.mainWindow,
                'Date Added (Oldest First)'
            );
            await expectVisibleGridTitles(app.mainWindow, expectedVodDateAsc);

            await setContentSortMode(app.mainWindow, 'Name A-Z');
            await expectVisibleGridTitles(app.mainWindow, expectedVodNameAsc);

            await setContentSortMode(app.mainWindow, 'Name Z-A');
            await expectVisibleGridTitles(app.mainWindow, expectedVodNameDesc);

            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            await setContentSortMode(app.mainWindow, 'Name A-Z');
            await expectVisibleGridTitles(
                app.mainWindow,
                expectedSeriesNameAsc
            );

            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            await expectVisibleGridTitles(
                app.mainWindow,
                expectedSeriesNameAsc
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('does not expose local sorting controls on Stalker category routes', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);

            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Refine',
                    exact: true,
                })
            ).toHaveCount(0);
            await expect(
                app.mainWindow.getByRole('button', { name: 'Sort channels' })
            ).toHaveCount(0);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Refine',
                    exact: true,
                })
            ).toHaveCount(0);

            await openWorkspaceSection(app.mainWindow, 'Series');
            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Refine',
                    exact: true,
                })
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('keeps Xtream catalog page after opening VOD and series details, and resets grid scroll on page changes', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(
            request,
            xtreamCredentials
        );
        const seriesFixture = await fetchXtreamSeriesFixture(
            request,
            xtreamCredentials
        );
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await expectCatalogGridReady(app.mainWindow);
            const vodSearchTitle = await firstVisibleGridTitle(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow);
            await expectCatalogSearchResetsToFirstPage(
                app.mainWindow,
                vodSearchTitle
            );
            await clearCatalogSearch(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow);
            await clickFirstGridListCard(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );
            await goBackFromDetail(app.mainWindow);
            await expectCatalogPageQuery(app.mainWindow, '2');
            await expectCatalogGridReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            await expectCatalogGridReady(app.mainWindow);
            const seriesSearchTitle = await firstVisibleGridTitle(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow);
            await expectCatalogSearchResetsToFirstPage(
                app.mainWindow,
                seriesSearchTitle
            );
            await clearCatalogSearch(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow);
            await clickFirstGridListCard(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/
            );
            await goBackFromDetail(app.mainWindow);
            await expectCatalogPageQuery(app.mainWindow, '2');
            await expectCatalogGridReady(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('resets Stalker VOD and series grid scroll when changing pages', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const vodFixture = await fetchStalkerCategoryFixture(request, 'vod');
        const seriesFixture = await fetchStalkerCategoryFixture(
            request,
            'series'
        );
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await clickCategoryByVisibleName(
                app.mainWindow,
                vodFixture.categoryName
            );
            await expectCatalogGridReady(app.mainWindow);
            const vodSearchTitle = await firstVisibleGridTitle(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow, {
                expectContentChange: false,
            });
            await expectStalkerCatalogSearchResetsToFirstPage(app.mainWindow, {
                categoryId: vodFixture.categoryId,
                title: vodSearchTitle,
                type: 'vod',
            });
            await clearCatalogSearch(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow, {
                expectContentChange: false,
            });
            await expectStalkerDetailBackPreservesCatalogPage(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByVisibleName(
                app.mainWindow,
                seriesFixture.categoryName
            );
            await expectCatalogGridReady(app.mainWindow);
            const seriesSearchTitle = await firstVisibleGridTitle(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow, {
                expectContentChange: false,
            });
            await expectStalkerCatalogSearchResetsToFirstPage(app.mainWindow, {
                categoryId: seriesFixture.categoryId,
                title: seriesSearchTitle,
                type: 'series',
            });
            await clearCatalogSearch(app.mainWindow);
            await expectCatalogScrollResetAfterNextPage(app.mainWindow, {
                expectContentChange: false,
            });
            await expectStalkerDetailBackPreservesCatalogPage(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });
});

const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});
const visibleComparisonSize = 8;
const xtreamCredentials = {
    username: defaultXtreamUsername,
    password: defaultXtreamPassword,
};

async function setLiveSortMode(
    page: Page,
    label: 'Server Order' | 'Name A-Z' | 'Name Z-A'
): Promise<void> {
    await page.getByRole('button', { name: 'Sort channels' }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function setContentSortMode(
    page: Page,
    label:
        | 'Date Added (Latest First)'
        | 'Date Added (Oldest First)'
        | 'Name A-Z'
        | 'Name Z-A'
): Promise<void> {
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function expectVisibleChannelTitles(
    page: Page,
    expectedTitles: string[]
): Promise<void> {
    await expect
        .poll(async () => {
            const titles = await visibleChannelTitles(page);
            return titles.slice(0, expectedTitles.length);
        })
        .toEqual(expectedTitles);
}

async function expectVisibleGridTitles(
    page: Page,
    expectedTitles: string[]
): Promise<void> {
    await expect
        .poll(async () => {
            const titles = await visibleGridTitles(page);
            return titles.slice(0, expectedTitles.length);
        })
        .toEqual(expectedTitles);
}

async function expectCatalogGridReady(page: Page): Promise<void> {
    await expect(
        page.locator('.category-content-layout mat-card').first()
    ).toBeVisible({
        timeout: 20000,
    });
}

async function expectCatalogScrollResetAfterNextPage(
    page: Page,
    options: { expectContentChange?: boolean } = {}
): Promise<string[]> {
    const grid = catalogGrid(page);

    await expect(grid).toBeVisible({ timeout: 20000 });
    await ensureCatalogCanGoNext(page);
    const rangeBefore = await catalogRangeText(page);
    const titlesBefore = await visibleGridTitles(page);
    await grid.evaluate((element: HTMLElement) => {
        element.scrollTo({ top: element.scrollHeight });
    });
    await expect.poll(() => getCatalogGridScrollTop(page)).toBeGreaterThan(0);

    await page
        .locator('.category-content-header')
        .getByRole('button', { name: 'Next page' })
        .click();
    await expectCatalogPageQuery(page, '2');
    await expect.poll(() => catalogRangeText(page)).not.toBe(rangeBefore);
    if (options.expectContentChange !== false) {
        await expect
            .poll(() => visibleGridTitles(page))
            .not.toEqual(titlesBefore);
    }
    await expect.poll(() => getCatalogGridScrollTop(page)).toBeLessThan(2);
    return visibleGridTitles(page);
}

async function expectCatalogSearchResetsToFirstPage(
    page: Page,
    title: string
): Promise<void> {
    await fillWorkspaceSearch(page, title);
    await expectCatalogSearchQuery(page, title);
    await expectCatalogPageQuery(page, null);
    await expect(catalogGridCardByTitle(page, title).first()).toBeVisible({
        timeout: 20000,
    });
}

async function expectStalkerCatalogSearchResetsToFirstPage(
    page: Page,
    options: { categoryId: string; title: string; type: 'series' | 'vod' }
): Promise<void> {
    await expectCatalogSearchResetsToFirstPage(page, options.title);
    await waitForPortalDebugEvent(page, {
        provider: 'stalker',
        operation: 'get_ordered_list',
        predicate: (event) => {
            const requestPayload = event.request as {
                params?: Record<string, string | number>;
            };

            return (
                requestPayload.params?.['type'] === options.type &&
                String(requestPayload.params?.['category']) ===
                    options.categoryId &&
                requestPayload.params?.['search'] === options.title &&
                String(requestPayload.params?.['p']) === '1'
            );
        },
    });
}

async function clearCatalogSearch(page: Page): Promise<void> {
    await fillWorkspaceSearch(page, '');
    await expectCatalogSearchQuery(page, null);
    await expectCatalogPageQuery(page, null);
}

async function expectStalkerDetailBackPreservesCatalogPage(
    page: Page
): Promise<void> {
    const titlesOnPage = await visibleGridTitles(page);

    await clickFirstGridListCard(page);
    await goBackFromDetail(page);

    await expectCatalogPageQuery(page, '2');
    await expectCatalogGridReady(page);
    await expect.poll(() => visibleGridTitles(page)).toEqual(titlesOnPage);
}

async function expectCatalogPageQuery(
    page: Page,
    expectedPage: string | null
): Promise<void> {
    await expect
        .poll(() => new URL(page.url()).searchParams.get('page'))
        .toBe(expectedPage);
}

async function expectCatalogSearchQuery(
    page: Page,
    expectedSearch: string | null
): Promise<void> {
    await expect
        .poll(() => new URL(page.url()).searchParams.get('q'))
        .toBe(expectedSearch);
}

async function firstVisibleGridTitle(page: Page): Promise<string> {
    const titles = await visibleGridTitles(page);
    const title = titles[0];

    if (!title) {
        throw new Error('Expected at least one visible catalog grid title.');
    }

    return title;
}

async function goBackFromDetail(page: Page): Promise<void> {
    const backButton = page
        .locator('app-content-hero .hero__back-button')
        .first();

    await expect(backButton).toBeVisible({ timeout: 20000 });
    try {
        await backButton.click({ timeout: 5000 });
    } catch {
        await backButton.evaluate((button: HTMLButtonElement) =>
            button.click()
        );
    }
}

async function clickCategoryByVisibleName(
    page: Page,
    categoryName: string
): Promise<void> {
    const category = page
        .locator('app-workspace-context-panel .category-item:visible')
        .filter({
            has: page.locator('.nav-item-label', {
                hasText: new RegExp(`^\\s*${escapeRegex(categoryName)}\\s*$`),
            }),
        })
        .first();

    await expect(category).toBeVisible({ timeout: 20000 });
    await category.click();
    await expect.poll(() => category.getAttribute('aria-current')).toBe('true');
}

function catalogGrid(page: Page) {
    return page.locator('app-category-content-view app-grid-list').first();
}

function catalogGridCardByTitle(page: Page, title: string) {
    return page.locator('.category-content-layout mat-card').filter({
        has: page.locator('.title', {
            hasText: new RegExp(`^\\s*${escapeRegex(title)}\\s*$`),
        }),
    });
}

async function ensureCatalogCanGoNext(page: Page): Promise<void> {
    const header = page.locator('.category-content-header');
    const nextButton = header.getByRole('button', { name: 'Next page' });

    await expect(nextButton).toBeVisible({ timeout: 20000 });

    if (await nextButton.isDisabled()) {
        await header.getByRole('button', { name: 'Previous page' }).click();
        await expect
            .poll(() => new URL(page.url()).searchParams.get('page'))
            .toBe(null);
    }

    await expect(nextButton).toBeEnabled({ timeout: 20000 });
}

async function catalogRangeText(page: Page): Promise<string> {
    return (
        (await page
            .locator('.category-content-header .mat-mdc-paginator-range-label')
            .first()
            .textContent()) ?? ''
    ).trim();
}

async function getCatalogGridScrollTop(page: Page): Promise<number> {
    return catalogGrid(page).evaluate((element: HTMLElement) =>
        Math.round(element.scrollTop)
    );
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function visibleChannelTitles(page: Page): Promise<string[]> {
    return page
        .locator('[data-test-id="channel-item"] .channel-name')
        .allInnerTexts()
        .then((titles: string[]) =>
            uniqueTitles(titles.map((title) => title.trim()))
        );
}

async function visibleGridTitles(page: Page): Promise<string[]> {
    return page
        .locator('.category-content-layout mat-card .title')
        .allInnerTexts()
        .then((titles: string[]) =>
            uniqueTitles(titles.map((title) => title.trim()))
        );
}

function uniqueTitles(titles: string[]): string[] {
    const seen = new Set<string>();

    return titles.filter((title) => {
        if (seen.has(title)) {
            return false;
        }

        seen.add(title);
        return true;
    });
}
