import type { Locator } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    createMutableTextServer,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    test,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamEpgFixture,
} from './portal-mock-fixtures';

const epgPortalName = 'Xtream EPG Fixture';
const epgCredentials = {
    username: 'epg',
    password: 'epg',
};

test('@epg @xtream @electron removes uploaded guide data and restores provider EPG without restarting', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const id = fixture.stream.epg_channel_id;
    expect(id).toBeTruthy();
    const stamp = (date: Date) =>
        date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const xml = `<tv><channel id="${id}"><display-name>Uploaded Guide</display-name></channel>
        <programme channel="${id}" start="${stamp(new Date(Date.now() - 600000))} +0000" stop="${stamp(new Date(Date.now() + 3600000))} +0000"><title>Temporary XMLTV Bulletin</title></programme></tv>`;
    const source = await createMutableTextServer(xml, {
        contentType: 'application/xml',
        resourcePath: '/temporary.xml',
    });
    const app = await launchElectronApp(dataDir);
    try {
        await addXtreamPortal(app.mainWindow, {
            name: epgPortalName,
            ...epgCredentials,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        await app.mainWindow
            .getByRole('button', { name: 'Add EPG source' })
            .click();
        await app.mainWindow
            .locator('.epg-source-row input')
            .fill(source.resourceUrl);
        await app.mainWindow
            .getByTestId('toggle-prefer-uploaded-epg')
            .locator('input')
            .check();
        await saveSettings(app.mainWindow);
        await expect
            .poll(
                () =>
                    app.mainWindow.evaluate(
                        async (channelId) =>
                            (
                                await window.electron.getChannelPrograms(
                                    channelId!
                                )
                            ).map((p) => p.title),
                        id
                    ),
                { timeout: 30000 }
            )
            .toContain('Temporary XMLTV Bulletin');
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        const row = channelItemByTitle(
            app.mainWindow,
            fixture.stream.name ?? ''
        ).first();
        await expect(row.locator('.epg-title')).toHaveText(
            'Temporary XMLTV Bulletin'
        );
        await row.click();
        await expect
            .poll(() => timelineBlockTitles(app.mainWindow))
            .toContain('Temporary XMLTV Bulletin');
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        await app.mainWindow.locator('.epg-source-row button').nth(1).click();
        await saveSettings(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await expect(row.locator('.epg-title')).toHaveText(
            fixture.shortEpg[0].title
        );
        await row.click();
        await expect
            .poll(() => timelineBlockTitles(app.mainWindow))
            .not.toContain('Temporary XMLTV Bulletin');
        await expect
            .poll(() => timelineBlockTitles(app.mainWindow))
            .toContain(fixture.fullEpg[0].title);
    } finally {
        await closeElectronApp(app);
        await source.close();
    }
});

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

            // Provider-declared catch-up (tv_archive=1 in the fixture) is
            // surfaced as a badge on the sidebar row (#1128).
            await expect(channelRow.getByTestId('catchup-badge')).toBeVisible();

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

test('@epg @xtream @electron keeps EPG context and actions at narrow channel-row widths', async ({
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
        env: { TZ: 'UTC' },
    });

    try {
        await addXtreamPortal(app.mainWindow, {
            name: `${epgPortalName} Narrow`,
            username: epgCredentials.username,
            password: epgCredentials.password,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);

        const currentProgramRow = channelItemByTitle(
            app.mainWindow,
            fixture.stream.name ?? ''
        ).first();
        const noProgramRow = channelItemByTitle(
            app.mainWindow,
            'Night Sports'
        ).first();
        await expect(currentProgramRow).toBeVisible({ timeout: 20000 });
        await expect(noProgramRow).toBeVisible({ timeout: 20000 });

        const currentTitle = currentProgramRow.locator('.epg-title');
        const progressTrack = currentProgramRow.locator('.epg-progress-track');
        const favoriteAction = currentProgramRow.locator('.favorite-button');
        const placeholder = noProgramRow.locator('.epg-placeholder');
        const logo = currentProgramRow.locator('.channel-logo-shell');
        const timeLabels = currentProgramRow.locator('.epg-time');

        await setPortalChannelItemWidth(app.mainWindow, 300);

        await expect(currentTitle).toHaveText(currentProgram.title);
        await expect(currentTitle).toBeVisible();
        await expect(progressTrack).toBeVisible();
        await expect(favoriteAction).toBeVisible();
        await expect(placeholder).toBeVisible();
        await expect(logo).toBeVisible();
        await expect(timeLabels).toHaveCount(2);
        await expect(timeLabels.first()).toBeVisible();
        await expect(timeLabels.last()).toBeHidden();
        await expectPortalRowHeightAndStride(currentProgramRow, 'Night Sports');
        await expectPortalRowHeightAndStride(noProgramRow, 'Archive Cinema');
        await expectTimelineStartAndProgressAligned(currentProgramRow);
        await expectNarrowRowContentFits(currentProgramRow);
        await expectNarrowRowContentFits(noProgramRow);

        await setPortalChannelItemWidth(app.mainWindow, 232);

        await expect(currentTitle).toHaveText(currentProgram.title);
        await expect(currentTitle).toBeVisible();
        await expect(progressTrack).toBeVisible();
        await expect(favoriteAction).toBeVisible();
        await expect(placeholder).toBeVisible();
        await expect(logo).toBeHidden();
        await expect(timeLabels).toHaveCount(2);
        await expect(timeLabels.first()).toBeVisible();
        await expect(timeLabels.last()).toBeHidden();
        await expectPortalRowHeightAndStride(currentProgramRow, 'Night Sports');
        await expectPortalRowHeightAndStride(noProgramRow, 'Archive Cinema');
        await expectTimelineStartAndProgressAligned(currentProgramRow);
        await expectNarrowRowContentFits(currentProgramRow);
        await expectNarrowRowContentFits(noProgramRow);

        await setPortalChannelItemWidth(app.mainWindow, 200);

        await expect(currentTitle).toHaveText(currentProgram.title);
        await expect(currentTitle).toBeVisible();
        await expect(progressTrack).toBeVisible();
        await expect(favoriteAction).toBeVisible();
        await expect(placeholder).toBeVisible();
        await expect(logo).toBeHidden();
        await expect(timeLabels.first()).toBeHidden();
        await expect(timeLabels.last()).toBeHidden();
        await expectPortalRowHeightAndStride(currentProgramRow, 'Night Sports');
        await expectPortalRowHeightAndStride(noProgramRow, 'Archive Cinema');
        await expectNarrowRowContentFits(currentProgramRow);
        await expectNarrowRowContentFits(noProgramRow);
    } finally {
        await closeElectronApp(app);
    }
});

test('@radio @stalker @electron keeps radio rows compact at narrow widths', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['stalker']);
    const fixture = await fetchStalkerCategoryFixture(request, 'radio');
    const [firstItem, secondItem] = fixture.items;
    const firstTitle = firstItem?.o_name || firstItem?.name;
    const secondTitle = secondItem?.o_name || secondItem?.name;
    if (!firstTitle || !secondTitle) {
        throw new Error(
            'Expected the Stalker radio fixture to include two named stations.'
        );
    }
    const app = await launchElectronApp(dataDir);

    try {
        await addStalkerPortal(app.mainWindow, {
            name: 'Stalker Radio Row Fixture',
        });
        await waitForStalkerCatalog(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Radio');
        const categoryButton = app.mainWindow.getByRole('button', {
            name: fixture.categoryName,
            exact: true,
        });
        await expect(categoryButton).toBeVisible();
        await categoryButton.click();

        const radioRow = channelItemByTitle(app.mainWindow, firstTitle).first();
        await expect(radioRow).toBeVisible({ timeout: 20000 });
        await expect(radioRow).toHaveClass(/compact/);
        await expect(radioRow.locator('.epg-placeholder')).toHaveCount(0);
        await expect(radioRow.locator('.epg-title')).toHaveCount(0);
        await expect(radioRow.locator('.epg-timeline')).toHaveCount(0);
        await expectCompactRadioRowHeightAndStride(radioRow, secondTitle);

        await setStalkerChannelItemWidth(app.mainWindow, 232);

        await expect(radioRow.locator('.channel-logo-shell')).toBeVisible();
        await expect(radioRow.locator('.favorite-button')).toBeVisible();
        await expectCompactRadioRowHeightAndStride(radioRow, secondTitle);

        await setStalkerChannelItemWidth(app.mainWindow, 200);

        await expect(radioRow.locator('.channel-name')).toBeVisible();
        await expect(radioRow.locator('.channel-logo-shell')).toBeHidden();
        await expect(radioRow.locator('.favorite-button')).toBeHidden();
        await expectCompactRadioRowHeightAndStride(radioRow, secondTitle);
    } finally {
        await closeElectronApp(app);
    }
});

test('@epg @xtream @electron shifts the sidebar preview and the timeline "now" block by the EPG display offset', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const offsetMinutes = 60;
    // The guide runs an hour ahead of the real schedule, so the programme
    // actually on air is the one the provider files under "an hour ago" —
    // and every surface must agree on that same programme.
    const providerNowSeconds =
        Math.floor(Date.now() / 1000) - offsetMinutes * 60;
    const expectedProgram = fixture.fullEpg.find(
        (listing) =>
            listing.startTimestamp <= providerNowSeconds &&
            providerNowSeconds < listing.stopTimestamp
    );
    if (!expectedProgram) {
        throw new Error(
            'Expected the Xtream EPG fixture to cover the shifted current time.'
        );
    }
    const app = await launchElectronApp(dataDir, { env: { TZ: 'UTC' } });

    try {
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        await app.mainWindow
            .locator('[data-test-id="epg-offset-minutes"]')
            .fill(String(offsetMinutes));
        await saveSettings(app.mainWindow);
        await goToDashboard(app.mainWindow);

        await addXtreamPortal(app.mainWindow, {
            name: `${epgPortalName} Offset`,
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

        // Sidebar preview: the shifted programme, with shifted times.
        await expect
            .poll(async () =>
                (
                    (await channelRow.locator('.epg-title').textContent()) ?? ''
                ).trim()
            )
            .toBe(expectedProgram.title);
        await expect
            .poll(async () =>
                (await channelRow.locator('.epg-time').allInnerTexts()).map(
                    (value) => value.trim()
                )
            )
            .toEqual([
                formatTimeInZone(
                    expectedProgram.startTimestamp + offsetMinutes * 60,
                    'UTC'
                ),
                formatTimeInZone(
                    expectedProgram.stopTimestamp + offsetMinutes * 60,
                    'UTC'
                ),
            ]);

        // Timeline: the same programme is the highlighted "now" block.
        await channelRow.click();
        await expect(app.mainWindow.locator('app-epg-timeline')).toBeVisible({
            timeout: 20000,
        });
        await expect(
            app.mainWindow
                .locator(
                    'app-epg-timeline .epg-timeline__block.is-now .epg-timeline__block-title'
                )
                .first()
        ).toHaveText(expectedProgram.title);
    } finally {
        await closeElectronApp(app);
    }
});

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
        await openSettingsSection(app.mainWindow, 'epg');
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
        await expect(app.mainWindow.locator('app-epg-timeline')).toHaveCount(0);

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

async function setPortalChannelItemWidth(
    page: Parameters<typeof channelItemByTitle>[0],
    width: number
) {
    const channelItems = page.locator(
        'app-portal-channels-list app-channel-list-item'
    );
    await channelItems.evaluateAll((elements, itemWidth) => {
        for (const element of elements) {
            (element as HTMLElement).style.width = `${itemWidth}px`;
        }
    }, width);
    await expect
        .poll(() =>
            channelItems
                .first()
                .evaluate((element) =>
                    Math.round(element.getBoundingClientRect().width)
                )
        )
        .toBe(width);
}

async function setStalkerChannelItemWidth(
    page: Parameters<typeof channelItemByTitle>[0],
    width: number
) {
    const channelItems = page.locator(
        'app-stalker-live-stream-layout app-channel-list-item'
    );
    await channelItems.evaluateAll((elements, itemWidth) => {
        for (const element of elements) {
            (element as HTMLElement).style.width = `${itemWidth}px`;
        }
    }, width);
    await expect
        .poll(() =>
            channelItems
                .first()
                .evaluate((element) =>
                    Math.round(element.getBoundingClientRect().width)
                )
        )
        .toBe(width);
}

const portalChannelItemSize = 68;
const compactRadioItemSize = 52;
const stalkerChannelItemGap = 2;
const rowGeometryTolerance = 0.25;
const contentGeometryTolerance = 1;

type ElementBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

async function expectPortalRowHeightAndStride(
    row: ReturnType<typeof channelItemByTitle>,
    expectedFollowingTitle: string
) {
    const followingRow = row
        .locator('xpath=ancestor::app-channel-list-item')
        .locator('xpath=following-sibling::app-channel-list-item[1]')
        .getByTestId('channel-item');
    await expect(followingRow.locator('.channel-name')).toHaveText(
        expectedFollowingTitle
    );

    const [rowBox, followingRowBox] = await Promise.all([
        row.boundingBox(),
        followingRow.boundingBox(),
    ]);
    if (!rowBox || !followingRowBox) {
        throw new Error(
            `Expected visible channel-row geometry before "${expectedFollowingTitle}" for the virtual-stride assertion.`
        );
    }

    expect(Math.abs(rowBox.height - portalChannelItemSize)).toBeLessThanOrEqual(
        rowGeometryTolerance
    );
    expect(
        Math.abs(followingRowBox.y - rowBox.y - portalChannelItemSize)
    ).toBeLessThanOrEqual(rowGeometryTolerance);
}

async function expectCompactRadioRowHeightAndStride(
    row: ReturnType<typeof channelItemByTitle>,
    expectedFollowingTitle: string
) {
    const followingRow = row
        .locator('xpath=ancestor::app-channel-list-item')
        .locator('xpath=following-sibling::app-channel-list-item[1]')
        .getByTestId('channel-item');
    await expect(followingRow.locator('.channel-name')).toHaveText(
        expectedFollowingTitle
    );

    const [rowBox, followingRowBox] = await Promise.all([
        row.boundingBox(),
        followingRow.boundingBox(),
    ]);
    if (!rowBox || !followingRowBox) {
        throw new Error(
            `Expected compact radio-row geometry before "${expectedFollowingTitle}".`
        );
    }

    expect(Math.abs(rowBox.height - compactRadioItemSize)).toBeLessThanOrEqual(
        rowGeometryTolerance
    );
    expect(
        Math.abs(
            followingRowBox.y -
                rowBox.y -
                compactRadioItemSize -
                stalkerChannelItemGap
        )
    ).toBeLessThanOrEqual(rowGeometryTolerance);
}

async function expectTimelineStartAndProgressAligned(
    row: ReturnType<typeof channelItemByTitle>
) {
    const [startTimeBox, progressBox] = await Promise.all([
        row.locator('.epg-time').first().boundingBox(),
        row.locator('.epg-progress-track').first().boundingBox(),
    ]);
    if (!startTimeBox || !progressBox) {
        throw new Error(
            'Expected visible start-time and progress geometry in the narrow channel row.'
        );
    }

    expect(
        Math.abs(boxCenterY(startTimeBox) - boxCenterY(progressBox))
    ).toBeLessThanOrEqual(contentGeometryTolerance);
}

async function expectNarrowRowContentFits(
    row: ReturnType<typeof channelItemByTitle>
) {
    const [rowBox, detailsBox, actionsBox] = await Promise.all([
        row.boundingBox(),
        row.locator('.channel-details').boundingBox(),
        row.locator('.action-buttons').boundingBox(),
    ]);

    if (!rowBox || !detailsBox || !actionsBox) {
        throw new Error(
            'Expected visible narrow channel-row, details, and action geometry.'
        );
    }

    expectBoxContainedWithin(detailsBox, rowBox);
    expectBoxContainedWithin(actionsBox, rowBox);
    expect(boxRight(detailsBox)).toBeLessThanOrEqual(
        actionsBox.x + contentGeometryTolerance
    );
    await expectVisibleElementsContainedWithin(
        row.locator(
            '.channel-details > .channel-name:visible, .channel-details > .epg-title:visible, .channel-details > .epg-placeholder:visible, .channel-details > .epg-timeline:visible'
        ),
        detailsBox,
        'channel-details child'
    );
    await expectVisibleElementsContainedWithin(
        row.locator('.action-buttons > button:visible'),
        actionsBox,
        'channel action button'
    );

    const progressTrack = row.locator('.epg-progress-track');
    if ((await progressTrack.count()) > 0) {
        const progressBox = await progressTrack.first().boundingBox();
        if (!progressBox) {
            throw new Error(
                'Expected visible progress-track geometry in the narrow channel row.'
            );
        }
        expectBoxContainedWithin(progressBox, detailsBox);
        expect(progressBox.width).toBeGreaterThanOrEqual(24);
    }
}

async function expectVisibleElementsContainedWithin(
    elements: Locator,
    outer: ElementBox,
    description: string
) {
    const count = await elements.count();
    if (count === 0) {
        throw new Error(`Expected at least one visible ${description}.`);
    }

    for (let index = 0; index < count; index += 1) {
        const elementBox = await elements.nth(index).boundingBox();
        if (!elementBox) {
            throw new Error(
                `Expected visible ${description} geometry at index ${index}.`
            );
        }
        expectBoxContainedWithin(elementBox, outer);
    }
}

function expectBoxContainedWithin(inner: ElementBox, outer: ElementBox) {
    expect(inner.x).toBeGreaterThanOrEqual(outer.x - contentGeometryTolerance);
    expect(inner.y).toBeGreaterThanOrEqual(outer.y - contentGeometryTolerance);
    expect(boxRight(inner)).toBeLessThanOrEqual(
        boxRight(outer) + contentGeometryTolerance
    );
    expect(boxBottom(inner)).toBeLessThanOrEqual(
        boxBottom(outer) + contentGeometryTolerance
    );
}

function boxRight(box: ElementBox) {
    return box.x + box.width;
}

function boxBottom(box: ElementBox) {
    return box.y + box.height;
}

function boxCenterY(box: ElementBox) {
    return box.y + box.height / 2;
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
