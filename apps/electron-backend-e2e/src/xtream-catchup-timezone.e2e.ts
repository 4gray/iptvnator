import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    LaunchedElectronApp,
    openGlobalFavorites,
    openPlaylistFavorites,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    switchUnifiedCollectionScope,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';

/**
 * Issue #1562: the `{Y-m-d:H-M}` segment of an Xtream timeshift URL is read
 * by the panel in ITS timezone (`server_info.timezone`), never the viewer's.
 * The viewer here sits at UTC-3 while the mock panel runs at UTC (or, in the
 * clock-pair scenario, at an unusable `UTC+3` name with a +03:00 clock), so
 * a URL rendered in the viewer's clock is unambiguously wrong.
 */
const VIEWER_TIMEZONE = 'America/Sao_Paulo';
const CHANNEL = 'Timezone News';
const PAST_PROGRAM = 'Earlier Bulletin';
const TIMESHIFT_SEGMENT =
    /\/timeshift\/[^/]+\/[^/]+\/\d+\/(\d{4}-\d{2}-\d{2}:\d{2}-\d{2})\//;

function formatWallClock(epochSeconds: number, offsetMinutes: number): string {
    const date = new Date((epochSeconds + offsetMinutes * 60) * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}:${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}`;
}

function formatInZone(epochSeconds: number, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(epochSeconds * 1000));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? '??';
    return `${read('year')}-${read('month')}-${read('day')}:${read('hour')}-${read('minute')}`;
}

function captureTimeshiftRequests(page: Page): string[] {
    const captured: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/timeshift/')) {
            captured.push(request.url());
        }
    });
    return captured;
}

async function activatePastProgram(
    page: Page,
    captured: string[]
): Promise<string> {
    captured.length = 0;
    await expect(page.locator('app-epg-timeline')).toBeVisible({
        timeout: 20000,
    });
    const block = page
        .locator('app-epg-timeline .epg-timeline__block')
        .filter({ hasText: PAST_PROGRAM })
        .first();
    await expect(block).toBeVisible({ timeout: 20000 });
    await block.click();
    await expect
        .poll(() => captured.length, { timeout: 30000 })
        .toBeGreaterThan(0);
    const segment = TIMESHIFT_SEGMENT.exec(captured[0] ?? '')?.[1];
    if (!segment) {
        throw new Error(`Unexpected timeshift URL shape: ${captured[0]}`);
    }
    return segment;
}

type PastProgramWindow = { startTimestamp: number };

/**
 * The fixture rounds "now" to 15 minutes per request, so the app's own
 * schedule may straddle a boundary the test's snapshot did not. Both
 * snapshots are accepted as the server rendering; the viewer rendering of
 * either is the regression.
 */
async function expectServerClock(
    segment: string,
    windows: PastProgramWindow[],
    serverOffsetMinutes: number
): Promise<void> {
    const serverRenderings = windows.map((window) =>
        formatWallClock(window.startTimestamp, serverOffsetMinutes)
    );
    const viewerRenderings = windows.map((window) =>
        formatInZone(window.startTimestamp, VIEWER_TIMEZONE)
    );
    expect(viewerRenderings).not.toContain(segment);
    expect(serverRenderings).toContain(segment);
}

async function pastProgramWindows(
    request: Parameters<typeof fetchXtreamEpgFixture>[0],
    credentials: { username: string; password: string }
): Promise<PastProgramWindow> {
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const past = fixture.fullEpg.find(
        (listing) => listing.title === PAST_PROGRAM
    );
    if (!past) {
        throw new Error(
            'The EPG fixture has no past programme to catch up on.'
        );
    }
    return { startTimestamp: past.startTimestamp };
}

async function openTimezoneNewsInLiveTv(
    page: Page,
    categoryName: string
): Promise<void> {
    await openWorkspaceSection(page, 'Live TV');
    await clickCategoryByNameExact(page, categoryName);
    const row = channelItemByTitle(page, CHANNEL).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();
}

test('@epg @xtream @electron renders catch-up start times in the panel timezone from Live TV, Favorites, and after a restart', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(240000);
    const credentials = { username: 'epg', password: 'epg' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const before = await pastProgramWindows(request, credentials);

    let app: LaunchedElectronApp = await launchElectronApp(dataDir, {
        env: { TZ: VIEWER_TIMEZONE },
    });
    let captured = captureTimeshiftRequests(app.mainWindow);

    try {
        await addXtreamPortal(app.mainWindow, {
            name: 'Catch-up timezone',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);

        // Live TV layout: the store learned the timezone from account info.
        await openTimezoneNewsInLiveTv(app.mainWindow, fixture.categoryName);
        const liveSegment = await activatePastProgram(app.mainWindow, captured);
        await expectServerClock(liveSegment, [before], 0);

        // Favorites: the resolver reads the persisted row instead.
        const row = channelItemByTitle(app.mainWindow, CHANNEL).first();
        await row.hover();
        await row.locator('.favorite-button').first().click();
        await expect(
            row.locator('.favorite-button mat-icon').first()
        ).toHaveText(/star/);
        await openPlaylistFavorites(app.mainWindow);
        const favoriteRow = channelItemByTitle(app.mainWindow, CHANNEL).first();
        await expect(favoriteRow).toBeVisible({ timeout: 20000 });
        await favoriteRow.click();
        const favoritesSegment = await activatePastProgram(
            app.mainWindow,
            captured
        );
        const afterFavorites = await pastProgramWindows(request, credentials);
        await expectServerClock(favoritesSegment, [before, afterFavorites], 0);

        // Restart and go straight to the global collection: no portal route
        // bootstraps, so only the persisted timezone can be right.
        app = await restartElectronApp(app, dataDir, {
            env: { TZ: VIEWER_TIMEZONE },
        });
        captured = captureTimeshiftRequests(app.mainWindow);
        await openGlobalFavorites(app.mainWindow);
        await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
        const restoredRow = channelItemByTitle(app.mainWindow, CHANNEL).first();
        await expect(restoredRow).toBeVisible({ timeout: 20000 });
        await restoredRow.click();
        const restartSegment = await activatePastProgram(
            app.mainWindow,
            captured
        );
        const afterRestart = await pastProgramWindows(request, credentials);
        await expectServerClock(
            restartSegment,
            [before, afterFavorites, afterRestart],
            0
        );
    } finally {
        await closeElectronApp(app);
    }
});

test('@epg @xtream @electron derives the panel offset from its clock pair when the timezone name is unusable', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const credentials = { username: 'tzoffset', password: 'tzoffset' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const before = await pastProgramWindows(request, credentials);

    const app = await launchElectronApp(dataDir, {
        env: { TZ: VIEWER_TIMEZONE },
    });
    const captured = captureTimeshiftRequests(app.mainWindow);

    try {
        await addXtreamPortal(app.mainWindow, {
            name: 'Catch-up offset clock',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openTimezoneNewsInLiveTv(app.mainWindow, fixture.categoryName);
        const segment = await activatePastProgram(app.mainWindow, captured);
        const after = await pastProgramWindows(request, credentials);

        // `server_info.timezone` is `UTC+3` (no ICU knows it); the clock pair
        // says +03:00, so the URL must be three hours ahead of UTC.
        await expectServerClock(segment, [before, after], 180);
    } finally {
        await closeElectronApp(app);
    }
});
