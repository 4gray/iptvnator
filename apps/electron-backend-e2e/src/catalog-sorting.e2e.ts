import { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
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
        const fixture = await fetchXtreamLiveFixture(request);
        const expectedServerOrder = fixture.items
            .map((item) => getXtreamTitle(item))
            .slice(0, 5);
        const expectedAscending = [...expectedServerOrder]
            .sort(collator.compare)
            .slice(0, 5);
        const expectedDescending = [...expectedAscending].reverse();
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);

            await expectVisibleChannelTitles(app.mainWindow, expectedServerOrder);

            await setLiveSortMode(app.mainWindow, 'Name A-Z');
            await expectVisibleChannelTitles(app.mainWindow, expectedAscending);

            await setLiveSortMode(app.mainWindow, 'Name Z-A');
            await expectVisibleChannelTitles(app.mainWindow, expectedDescending);

            await setLiveSortMode(app.mainWindow, 'Name A-Z');
            await openWorkspaceSection(app.mainWindow, 'Movies');
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
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
        const vodFixture = await fetchXtreamVodFixture(request);
        const seriesFixture = await fetchXtreamSeriesFixture(request);
        const expectedVodDateDesc = [...vodFixture.items]
            .sort((left, right) => getXtreamDateValue(right) - getXtreamDateValue(left))
            .map((item) => getXtreamTitle(item));
        const expectedVodDateAsc = [...expectedVodDateDesc].reverse();
        const expectedVodNameAsc = [...vodFixture.items]
            .map((item) => getXtreamTitle(item))
            .sort(collator.compare);
        const expectedVodNameDesc = [...expectedVodNameAsc].reverse();
        const expectedSeriesNameAsc = [...seriesFixture.items]
            .map((item) => getXtreamTitle(item))
            .sort(collator.compare);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await clickCategoryByNameExact(app.mainWindow, vodFixture.categoryName);
            await expectVisibleGridTitles(app.mainWindow, expectedVodDateDesc);

            await setContentSortMode(app.mainWindow, 'Date Added (Oldest First)');
            await expectVisibleGridTitles(app.mainWindow, expectedVodDateAsc);

            await setContentSortMode(app.mainWindow, 'Name A-Z');
            await expectVisibleGridTitles(app.mainWindow, expectedVodNameAsc);

            await setContentSortMode(app.mainWindow, 'Name Z-A');
            await expectVisibleGridTitles(app.mainWindow, expectedVodNameDesc);

            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByNameExact(app.mainWindow, seriesFixture.categoryName);
            await setContentSortMode(app.mainWindow, 'Name A-Z');
            await expectVisibleGridTitles(app.mainWindow, expectedSeriesNameAsc);

            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByNameExact(app.mainWindow, seriesFixture.categoryName);
            await expectVisibleGridTitles(app.mainWindow, expectedSeriesNameAsc);
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
                app.mainWindow.getByRole('button', { name: 'Sort content' })
            ).toHaveCount(0);
            await expect(
                app.mainWindow.getByRole('button', { name: 'Sort channels' })
            ).toHaveCount(0);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await expect(
                app.mainWindow.getByRole('button', { name: 'Sort content' })
            ).toHaveCount(0);

            await openWorkspaceSection(app.mainWindow, 'Series');
            await expect(
                app.mainWindow.getByRole('button', { name: 'Sort content' })
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });
});

const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

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
    await page.getByRole('button', { name: 'Sort content' }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function expectVisibleChannelTitles(
    page: Page,
    expectedTitles: string[]
): Promise<void> {
    await expect
        .poll(() => visibleChannelTitles(page))
        .toEqual(expectedTitles);
}

async function expectVisibleGridTitles(
    page: Page,
    expectedTitles: string[]
): Promise<void> {
    await expect
        .poll(() => visibleGridTitles(page))
        .toEqual(expectedTitles);
}

async function visibleChannelTitles(page: Page): Promise<string[]> {
    return page
        .locator('[data-test-id="channel-item"] .channel-name')
        .allInnerTexts()
        .then((titles: string[]) => titles.map((title) => title.trim()));
}

async function visibleGridTitles(page: Page): Promise<string[]> {
    return page
        .locator('.category-content-layout mat-card .title')
        .allInnerTexts()
        .then((titles: string[]) => titles.map((title) => title.trim()));
}
