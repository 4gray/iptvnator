import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';

const epgPortalName = 'Xtream EPG Fixture';
const epgCredentials = {
    username: 'epg',
    password: 'epg',
};

for (const timeZone of ['UTC', 'Europe/Berlin'] as const) {
    test(`@epg @xtream @electron renders Xtream EPG previews and the timeline schedule in ${timeZone}`, async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
        const currentProgram = fixture.shortEpg[0];
        if (!currentProgram) {
            throw new Error(
                'Expected the Xtream EPG fixture to include a current program.'
            );
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
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );

            const channelRow = channelItemByTitle(
                app.mainWindow,
                fixture.stream.name ?? ''
            ).first();
            await expect(channelRow).toBeVisible({ timeout: 20000 });

            // Sidebar channel list shows the per-channel "now" programme line.
            await expect
                .poll(async () =>
                    (
                        (await channelRow
                            .locator('.epg-title')
                            .textContent()) ?? ''
                    ).trim()
                )
                .toBe(currentProgram.title);
            await expect
                .poll(async () => {
                    return (
                        await channelRow.locator('.epg-time').allInnerTexts()
                    ).map((value) => value.trim());
                })
                .toEqual([
                    formatTimeInZone(currentProgram.startTimestamp, timeZone),
                    formatTimeInZone(currentProgram.stopTimestamp, timeZone),
                ]);
            await expect
                .poll(async () => getProgressWidthPercent(channelRow))
                .toBeGreaterThan(0);

            await channelRow.click();
            await expect(
                app.mainWindow.locator('app-epg-timeline')
            ).toBeVisible({ timeout: 20000 });

            // The timeline renders the full multi-day window as blocks,
            // sorted by start time (no per-day filtering — it scrolls).
            const allTitles = [...fixture.fullEpg]
                .sort((a, b) => a.startTimestamp - b.startTimestamp)
                .map((listing) => listing.title);
            await expect
                .poll(() => timelineBlockTitles(app.mainWindow))
                .toEqual(allTitles);

            // The current programme is highlighted as the "now" block.
            await expect(
                app.mainWindow
                    .locator(
                        'app-epg-timeline .epg-timeline__block.is-now .epg-timeline__block-title'
                    )
                    .first()
            ).toHaveText(currentProgram.title);

            // The date stepper advances the day label.
            const dayLabel = app.mainWindow
                .locator('app-epg-timeline .epg-timeline__day small')
                .first();
            const beforeLabel = (await dayLabel.textContent())?.trim();
            await app.mainWindow
                .locator(
                    'app-epg-timeline .epg-timeline__stepper .epg-timeline__nav'
                )
                .last()
                .click();
            await expect
                .poll(async () => (await dayLabel.textContent())?.trim())
                .not.toBe(beforeLabel);
        } finally {
            await closeElectronApp(app);
        }
    });
}

test('@epg @xtream @electron renders the vertical list view when the setting is "list"', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const currentProgram = fixture.shortEpg[0];
    if (!currentProgram) {
        throw new Error(
            'Expected the Xtream EPG fixture to include a current program.'
        );
    }
    const app = await launchElectronApp(dataDir);

    try {
        // Opt into the list view first (from the fresh workspace) so the portal
        // → Live TV → channel flow afterwards mirrors the timeline test exactly.
        await openSettings(app.mainWindow);
        await app.mainWindow
            .locator('[data-test-id="epg-view-mode-list"]')
            .click();
        await saveSettings(app.mainWindow);
        await goToDashboard(app.mainWindow);

        await addXtreamPortal(app.mainWindow, {
            name: `${epgPortalName} List`,
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
        await channelRow.click();

        // The list view renders instead of the timeline.
        await expect(app.mainWindow.locator('app-epg-list-view')).toBeVisible({
            timeout: 20000,
        });
        await expect(
            app.mainWindow.locator('app-epg-timeline')
        ).toHaveCount(0);

        // The on-air programme is the highlighted "now" row.
        await expect(
            app.mainWindow
                .locator('app-epg-list-view .g-row[data-when="now"] .title')
                .first()
        ).toHaveText(currentProgram.title);
    } finally {
        await closeElectronApp(app);
    }
});

function formatTimeInZone(timestampSeconds: number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(timestampSeconds * 1000));
}

async function timelineBlockTitles(
    page: Parameters<typeof channelItemByTitle>[0]
) {
    return page
        .locator('app-epg-timeline .epg-timeline__block-title')
        .allInnerTexts()
        .then((titles) => titles.map((title) => title.trim()).filter(Boolean));
}

async function getProgressWidthPercent(
    row: ReturnType<typeof channelItemByTitle>
) {
    const style = await row.locator('.epg-progress-fill').getAttribute('style');
    const width = style?.match(/width:\s*([\d.]+)%/)?.[1] ?? '0';
    return Number.parseFloat(width);
}
