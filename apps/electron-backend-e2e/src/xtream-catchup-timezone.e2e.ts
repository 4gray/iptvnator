import {
    getDownloadPlayPaths,
    installDownloadPlayCapture,
} from './downloads.e2e-support';
import {
    mkdirSync,
    linkSync,
    readFileSync,
    readdirSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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
    workspaceRoot,
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

test('@epg @xtream @electron copies the archive URL without starting archive playback', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const credentials = { username: 'epg', password: 'epg' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const app = await launchElectronApp(dataDir, {
        env: { TZ: VIEWER_TIMEZONE },
    });
    try {
        await addXtreamPortal(app.mainWindow, {
            name: 'Copy archive URL',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openTimezoneNewsInLiveTv(app.mainWindow, fixture.categoryName);
        const captured = captureTimeshiftRequests(app.mainWindow);
        const block = app.mainWindow
            .locator('app-epg-timeline .epg-timeline__block')
            .filter({ hasText: PAST_PROGRAM })
            .first();
        await expect(block).toBeVisible({ timeout: 20000 });
        await block.locator('.epg-timeline__info').click();
        const dialog = app.mainWindow.getByRole('dialog');
        await expect(
            dialog.getByText(/URL may contain account credentials/)
        ).toBeVisible();
        for (const dark of [false, true]) {
            await app.mainWindow.evaluate((enabled) => {
                document.body.classList.toggle('dark-theme', enabled);
            }, dark);
            await expect(
                dialog.getByRole('button', {
                    name: 'Copy archive URL',
                    exact: true,
                })
            ).toBeInViewport();
            await dialog.screenshot({
                path: test
                    .info()
                    .outputPath(`archive-copy-${dark ? 'dark' : 'light'}.png`),
            });
        }
        await dialog
            .getByRole('button', { name: 'Copy archive URL', exact: true })
            .click();
        await expect(
            app.mainWindow.getByText('Archive URL copied', { exact: true })
        ).toBeVisible();
        const url = await app.electronApp.evaluate(({ clipboard }) =>
            clipboard.readText()
        );
        expect(url).toContain('/timeshift/epg/epg/');
        const start = TIMESHIFT_SEGMENT.exec(url)?.[1];
        expect(start).toBeTruthy();
        await expectServerClock(
            start!,
            [await pastProgramWindows(request, credentials)],
            0
        );
        // Main-process archive probes do not appear as renderer playback requests.
        expect(captured).toEqual([]);
    } finally {
        await closeElectronApp(app);
    }
});

test('@downloads @epg @xtream @electron downloads a completed archive into the local library', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const credentials = { username: 'epg', password: 'epg' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    let app = await launchElectronApp(dataDir, {
        env: { TZ: VIEWER_TIMEZONE },
    });
    try {
        const folder = join(dataDir, 'archive-downloads');
        mkdirSync(folder, { recursive: true });
        await app.electronApp.evaluate(({ dialog }, target) => {
            dialog.showOpenDialog = async () =>
                ({ canceled: false, filePaths: [target] }) as Awaited<
                    ReturnType<typeof dialog.showOpenDialog>
                >;
        }, folder);
        await app.mainWindow.evaluate(async () => {
            await window.electron.downloadsSelectFolder();
        });
        await addXtreamPortal(app.mainWindow, {
            name: 'Archive downloads',
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openTimezoneNewsInLiveTv(app.mainWindow, fixture.categoryName);
        const captured = captureTimeshiftRequests(app.mainWindow);
        const block = app.mainWindow
            .locator('app-epg-timeline .epg-timeline__block')
            .filter({ hasText: PAST_PROGRAM })
            .first();
        await expect(block).toBeVisible({ timeout: 20000 });
        await block.locator('.epg-timeline__info').click();
        await app.mainWindow
            .getByRole('dialog')
            .getByRole('button', {
                name: 'Download programme (TS)',
                exact: true,
            })
            .click();
        await expect(
            app.mainWindow.getByText('Programme added to Downloads', {
                exact: true,
            })
        ).toBeVisible();
        await expect
            .poll(
                async () => {
                    const rows = await app.mainWindow.evaluate(() =>
                        window.electron.downloadsGetList()
                    );
                    return rows.find((row) => row.contentType === 'catchup')
                        ?.status;
                },
                { timeout: 30000 }
            )
            .toBe('completed');
        const rows = await app.mainWindow.evaluate(() =>
            window.electron.downloadsGetList()
        );
        const row = rows.find((entry) => entry.contentType === 'catchup');
        expect(row?.catchup?.channelName).toBe(CHANNEL);
        expect(row?.title).toBe(PAST_PROGRAM);
        expect(row?.filePath).toMatch(/archive-downloads.*\.ts$/);
        if (!row?.filePath) throw new Error('No archive file');
        expect(readFileSync(row.filePath)).toEqual(
            readFileSync(
                join(
                    workspaceRoot,
                    'apps/xtream-mock-server/src/fixtures/live.mpegts'
                )
            )
        );
        expect(captured).toEqual([]);
        const ownership = await app.electronApp.evaluate(
            (_electron, { dependency, file, id, mediaPath }) => {
                const Database = process
                    .getBuiltinModule('module')
                    .createRequire(dependency)(dependency);
                const db = new Database(file);
                try {
                    const proof = JSON.parse(
                        db
                            .prepare(
                                'SELECT proof FROM download_archive_finalizations WHERE download_id=?'
                            )
                            .get(id).proof
                    );
                    const stats = process
                        .getBuiltinModule('fs')
                        .lstatSync(mediaPath, { bigint: true });
                    return {
                        recorded: proof.finalIdentity,
                        actual: {
                            dev: String(stats.dev),
                            ino: String(stats.ino),
                        },
                    };
                } finally {
                    db.close();
                }
            },
            {
                dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
                file: join(dataDir, 'databases/iptvnator.db'),
                id: row.id,
                mediaPath: row.filePath,
            }
        );
        expect(ownership.recorded).toMatchObject(ownership.actual);
        // A failed completion status write must recover the proven file in place
        // on a repeated EPG submission, without a duplicate transfer.
        await app.electronApp.evaluate(
            (_electron, { dependency, file, id }) => {
                const Database = process
                    .getBuiltinModule('module')
                    .createRequire(dependency)(dependency);
                const db = new Database(file);
                try {
                    db.prepare(
                        "UPDATE downloads SET status='failed' WHERE id=?"
                    ).run(id);
                } finally {
                    db.close();
                }
            },
            {
                dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
                file: join(dataDir, 'databases/iptvnator.db'),
                id: row.id,
            }
        );
        await block.locator('.epg-timeline__info').click();
        await app.mainWindow
            .getByRole('dialog')
            .getByRole('button', {
                name: 'Download programme (TS)',
                exact: true,
            })
            .click();
        await expect(
            app.mainWindow.getByText(
                'This programme is already in Downloads.',
                { exact: true }
            )
        ).toBeVisible();
        expect(
            await app.mainWindow.evaluate(
                async () => (await window.electron.downloadsGetList()).length
            )
        ).toBe(1);
        // Submitting the programme again after its file disappears must use
        // journal ownership too, not delete a replacement at the old .part path.
        const firstPath = row.filePath;
        unlinkSync(firstPath);
        writeFileSync(firstPath + '.part', 'unrelated submission partial');
        await block.locator('.epg-timeline__info').click();
        await app.mainWindow
            .getByRole('dialog')
            .getByRole('button', {
                name: 'Download programme (TS)',
                exact: true,
            })
            .click();
        await expect
            .poll(async () => {
                const current = (
                    await app.mainWindow.evaluate(() =>
                        window.electron.downloadsGetList()
                    )
                ).find((entry) => entry.id === row.id);
                return (
                    current?.status === 'completed' &&
                    !!current.filePath &&
                    current.filePath !== firstPath
                );
            })
            .toBe(true);
        const resubmitted = (
            await app.mainWindow.evaluate(() =>
                window.electron.downloadsGetList()
            )
        ).find((entry) => entry.id === row.id);
        if (!resubmitted?.filePath)
            throw new Error('Missing resubmitted archive');
        expect(resubmitted.filePath).not.toBe(firstPath);
        expect(readFileSync(firstPath + '.part', 'utf8')).toBe(
            'unrelated submission partial'
        );
        row.filePath = resubmitted.filePath;
        expect(readFileSync(row.filePath)).toEqual(
            readFileSync(
                join(
                    workspaceRoot,
                    'apps/xtream-mock-server/src/fixtures/live.mpegts'
                )
            )
        );
        await app.mainWindow
            .getByRole('button', { name: 'Open downloads', exact: true })
            .click();
        const card = app.mainWindow.getByTestId(
            `download-library-catchup-${row.id}`
        );
        await expect(card).toBeVisible();
        await expect(card).toContainText('TV programme');
        await expect(card).toContainText(CHANNEL);
        await app.mainWindow.screenshot({
            path: test.info().outputPath('archive-download-library.png'),
        });
        await installDownloadPlayCapture(app);
        await card
            .getByRole('button', { name: `Play: ${PAST_PROGRAM}`, exact: true })
            .click();
        await expect
            .poll(() => getDownloadPlayPaths(app))
            .toEqual([row.filePath]);
        await expect(app.mainWindow).toHaveURL(
            /\/workspace\/downloads(?:\?.*)?$/
        );
        // Model termination after verified promotion but before the completion
        // DB write, including a response without Content-Length. Keep only the
        // real SQLite journal written by the transfer; the next process has no task.
        const durableProof = await app.electronApp.evaluate(
            (_electron, { dependency, file, id }) => {
                const Database = process
                    .getBuiltinModule('module')
                    .createRequire(dependency)(dependency);
                const db = new Database(file);
                try {
                    const journal = db
                        .prepare(
                            'SELECT proof FROM download_archive_finalizations WHERE download_id=?'
                        )
                        .get(id) as { proof: string } | undefined;
                    if (!journal)
                        throw new Error(
                            'Archive promotion journal was not persisted'
                        );
                    db.prepare(
                        "UPDATE downloads SET status='downloading', total_bytes=NULL WHERE id=?"
                    ).run(id);
                    return JSON.parse(journal.proof) as {
                        version: number;
                        filePath: string;
                        size: number;
                    };
                } finally {
                    db.close();
                }
            },
            {
                dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
                file: join(dataDir, 'databases/iptvnator.db'),
                id: row.id,
            }
        );
        expect(durableProof).toEqual(
            expect.objectContaining({
                version: 1,
                filePath: row.filePath,
                size: readFileSync(row.filePath).length,
            })
        );
        // Library remains usable after recovery, including archive metadata.
        app = await restartElectronApp(app, dataDir, {
            env: { TZ: VIEWER_TIMEZONE },
        });
        await app.mainWindow
            .getByRole('button', { name: 'Open downloads', exact: true })
            .click();
        await expect(
            app.mainWindow.getByTestId(`download-library-catchup-${row.id}`)
        ).toBeVisible();
        const recovered = await app.mainWindow.evaluate(async () =>
            (await window.electron.downloadsGetList()).find(
                (entry) => entry.contentType === 'catchup'
            )
        );
        expect(recovered).toEqual(
            expect.objectContaining({
                id: row.id,
                status: 'completed',
                filePath: row.filePath,
                totalBytes: durableProof.size,
            })
        );
        expect(
            readdirSync(folder).filter((name) => name.endsWith('.ts'))
        ).toHaveLength(1);
        // Missing-file recovery must reserve fresh output and preserve a foreign
        // entry at the old partial name, even with a completed journal present.
        unlinkSync(row.filePath);
        writeFileSync(row.filePath + '.part', 'unrelated retained file');
        expect(
            await app.mainWindow.evaluate(
                (id) => window.electron.downloadsRedownloadMissing(id),
                row.id
            )
        ).toEqual({ success: true });
        await expect
            .poll(
                async () =>
                    (
                        await app.mainWindow.evaluate(() =>
                            window.electron.downloadsGetList()
                        )
                    ).find((entry) => entry.id === row.id)?.status
            )
            .toBe('completed');
        const redownloaded = (
            await app.mainWindow.evaluate(() =>
                window.electron.downloadsGetList()
            )
        ).find((entry) => entry.id === row.id);
        if (!redownloaded?.filePath)
            throw new Error('Missing re-downloaded archive');
        expect(redownloaded.filePath).not.toBe(row.filePath);
        expect(readFileSync(row.filePath + '.part', 'utf8')).toBe(
            'unrelated retained file'
        );
        expect(readFileSync(redownloaded.filePath)).toEqual(
            readFileSync(
                join(
                    workspaceRoot,
                    'apps/xtream-mock-server/src/fixtures/live.mpegts'
                )
            )
        );
        // Fail owned cleanup after private capture. Its recovery pointer must
        // survive a process restart without relying on hardlink restoration.
        linkSync(redownloaded.filePath, redownloaded.filePath + '.part');
        await app.electronApp.evaluate(() => {
            const fs = process.getBuiltinModule('fs');
            const unlink = fs.unlinkSync;
            fs.unlinkSync = (path) => {
                if (String(path).includes('.iptvnator-cleanup-'))
                    throw Object.assign(new Error('simulated locked capture'), {
                        code: 'EACCES',
                    });
                return unlink(path);
            };
        });
        expect(
            await app.mainWindow.evaluate(
                (id) => window.electron.downloadsRemove(id),
                row.id
            )
        ).toEqual({
            success: false,
            error: 'Could not delete the partial file',
        });
        const capturedPath = await app.electronApp.evaluate(
            (_electron, { dependency, file, id }) => {
                const Database = process
                    .getBuiltinModule('module')
                    .createRequire(dependency)(dependency);
                const db = new Database(file);
                try {
                    const record = db
                        .prepare(
                            'SELECT proof FROM download_archive_finalizations WHERE download_id=?'
                        )
                        .get(id) as { proof: string };
                    return (
                        JSON.parse(record.proof) as {
                            partialCleanupPath: string;
                        }
                    ).partialCleanupPath;
                } finally {
                    db.close();
                }
            },
            {
                dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
                file: join(dataDir, 'databases/iptvnator.db'),
                id: row.id,
            }
        );
        expect(capturedPath).toContain('.iptvnator-cleanup-');
        expect(readFileSync(capturedPath)).toEqual(
            readFileSync(redownloaded.filePath)
        );
        // A foreign replacement in the retained capture must survive restart
        // and be discoverable without backend logs. Retain the original too.
        renameSync(capturedPath, capturedPath + '.owned');
        writeFileSync(capturedPath, 'foreign recovery content');
        app = await restartElectronApp(app, dataDir, {
            env: { TZ: VIEWER_TIMEZONE },
        });
        await app.mainWindow
            .getByRole('button', { name: 'Open downloads', exact: true })
            .click();
        await app.mainWindow
            .getByRole('button', { name: 'Clear finished', exact: true })
            .click();
        await app.mainWindow
            .getByRole('dialog')
            .getByRole('button', { name: 'Clear finished', exact: true })
            .click();
        const recoveryDialog = app.mainWindow.getByRole('dialog');
        await expect(recoveryDialog).toContainText('File recovery needed');
        await expect(recoveryDialog).toContainText(capturedPath);
        await expect(
            recoveryDialog.getByRole('button', {
                name: 'Copy recovery path',
                exact: true,
            })
        ).toBeVisible();
        await app.mainWindow.evaluate(() => {
            Object.defineProperty(navigator.clipboard, 'writeText', {
                configurable: true,
                value: () =>
                    Promise.reject(new Error('simulated clipboard failure')),
            });
        });
        await recoveryDialog
            .getByRole('button', { name: 'Copy recovery path', exact: true })
            .click();
        await expect(recoveryDialog).toBeVisible();
        await expect(recoveryDialog).toContainText(capturedPath);
        expect(readFileSync(capturedPath, 'utf8')).toBe(
            'foreign recovery content'
        );
        await recoveryDialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        // Simulate explicit user recovery; the app never deletes this copy.
        unlinkSync(capturedPath);
        renameSync(capturedPath + '.owned', capturedPath);
        app = await restartElectronApp(app, dataDir, {
            env: { TZ: VIEWER_TIMEZONE },
        });
        writeFileSync(
            redownloaded.filePath + '.part',
            'unrelated terminal file'
        );
        expect(
            await app.mainWindow.evaluate(
                (id) => window.electron.downloadsRemove(id),
                row.id
            )
        ).toEqual({ success: true });
        expect(readFileSync(redownloaded.filePath + '.part', 'utf8')).toBe(
            'unrelated terminal file'
        );
        expect(
            await app.mainWindow.evaluate(() =>
                window.electron.downloadsGetList()
            )
        ).toEqual([]);
    } finally {
        await closeElectronApp(app);
    }
});
