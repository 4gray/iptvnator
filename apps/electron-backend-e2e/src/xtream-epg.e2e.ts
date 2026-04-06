import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchXtreamEpgFixture,
    XtreamEpgFixture,
    XtreamNormalizedEpgListing,
} from './portal-mock-fixtures';

const epgPortalName = 'Xtream EPG Fixture';
const epgCredentials = {
    username: 'epg',
    password: 'epg',
};

for (const timeZone of ['UTC', 'Europe/Berlin'] as const) {
    test(`renders Xtream EPG previews and selected-channel schedule in ${timeZone}`, async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
        const currentProgram = fixture.shortEpg[0];
        if (!currentProgram) {
            throw new Error('Expected the Xtream EPG fixture to include a current program.');
        }
        const app = await launchElectronApp(dataDir, {
            env: { TZ: timeZone },
        });

        try {
            await addXtreamPortal(app.mainWindow, {
                name: `${epgPortalName} ${timeZone}`,
                username: epgCredentials.username,
                password: epgCredentials.password,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);

            const channelRow = channelItemByTitle(
                app.mainWindow,
                fixture.stream.name ?? ''
            ).first();
            await expect(channelRow).toBeVisible({ timeout: 20000 });

            await expect
                .poll(async () =>
                    ((await channelRow.locator('.epg-title').textContent()) ?? '').trim()
                )
                .toBe(currentProgram.title);
            await expect
                .poll(async () => {
                    return (await channelRow.locator('.epg-time').allInnerTexts()).map(
                        (value) => value.trim()
                    );
                })
                .toEqual([
                    formatTimeInZone(currentProgram.startTimestamp, timeZone),
                    formatTimeInZone(currentProgram.stopTimestamp, timeZone),
                ]);
            await expect
                .poll(async () => getProgressWidthPercent(channelRow))
                .toBeGreaterThan(0);

            await channelRow.click();
            await expect(app.mainWindow.locator('app-epg-list')).toBeVisible({
                timeout: 20000,
            });

            const currentDateKey = formatDateKeyInZone(Date.now(), timeZone);
            const currentDayTitles = visibleTitlesForCurrentDate(
                fixture.fullEpg,
                currentDateKey,
                timeZone
            );

            await expect.poll(() => visibleProgramTitles(app.mainWindow)).toEqual(
                currentDayTitles
            );

            const currentProgramRow = app.mainWindow
                .locator('app-epg-list .program-item.current-program')
                .first();
            await expect(currentProgramRow).toBeVisible();
            await expect(currentProgramRow.locator('.program-title')).toHaveText(
                currentProgram.title
            );
            await expect(currentProgramRow.locator('.time')).toHaveText(
                `${formatTimeInZone(
                    currentProgram.startTimestamp,
                    timeZone
                )} - ${formatTimeInZone(currentProgram.stopTimestamp, timeZone)}`
            );

            const firstFutureDateKey = getFirstFutureDateKey(
                fixture.fullEpg,
                currentDateKey,
                timeZone
            );
            expect(firstFutureDateKey).not.toBeNull();

            const futureDayTitles = titlesForDate(
                fixture.fullEpg,
                firstFutureDateKey!,
                timeZone
            );
            const nextDayClicks = dayDifference(currentDateKey, firstFutureDateKey!);

            for (let index = 0; index < nextDayClicks; index += 1) {
                await app.mainWindow.locator('app-epg-list .next-day').click();
            }

            await expect.poll(() => visibleProgramTitles(app.mainWindow)).toEqual(
                futureDayTitles
            );
        } finally {
            await closeElectronApp(app);
        }
    });
}

function formatTimeInZone(
    timestampSeconds: number,
    timeZone: string
): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(timestampSeconds * 1000));
}

function formatDateKeyInZone(
    timestampMilliseconds: number,
    timeZone: string
): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(timestampMilliseconds));

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
        throw new Error(`Failed to format a date key for timezone ${timeZone}.`);
    }

    return `${year}-${month}-${day}`;
}

function titlesForDate(
    listings: XtreamNormalizedEpgListing[],
    dateKey: string,
    timeZone: string
): string[] {
    return listings
        .filter(
            (listing) =>
                formatDateKeyInZone(listing.startTimestamp * 1000, timeZone) ===
                dateKey
        )
        .map((listing) => listing.title);
}

function visibleTitlesForCurrentDate(
    listings: XtreamNormalizedEpgListing[],
    currentDateKey: string,
    timeZone: string
): string[] {
    const nowSeconds = Math.floor(Date.now() / 1000);

    return listings
        .filter(
            (listing) =>
                formatDateKeyInZone(listing.startTimestamp * 1000, timeZone) ===
                    currentDateKey && listing.stopTimestamp >= nowSeconds
        )
        .map((listing) => listing.title);
}

function getFirstFutureDateKey(
    listings: XtreamNormalizedEpgListing[],
    currentDateKey: string,
    timeZone: string
): string | null {
    const uniqueDateKeys = Array.from(
        new Set(
            listings.map((listing) =>
                formatDateKeyInZone(listing.startTimestamp * 1000, timeZone)
            )
        )
    ).sort();

    return uniqueDateKeys.find((dateKey) => dateKey > currentDateKey) ?? null;
}

function dayDifference(fromDateKey: string, toDateKey: string): number {
    const from = Date.parse(`${fromDateKey}T00:00:00.000Z`);
    const to = Date.parse(`${toDateKey}T00:00:00.000Z`);
    return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

async function visibleProgramTitles(page: Parameters<typeof channelItemByTitle>[0]) {
    return page
        .locator('app-epg-list .program-title')
        .allInnerTexts()
        .then((titles) => titles.map((title) => title.trim()).filter(Boolean));
}

async function getProgressWidthPercent(row: ReturnType<typeof channelItemByTitle>) {
    const style = await row.locator('.epg-progress-fill').getAttribute('style');
    const width = style?.match(/width:\s*([\d.]+)%/)?.[1] ?? '0';
    return Number.parseFloat(width);
}
