import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamImportToFinish,
} from './electron-test-fixtures';
import {
    fetchXtreamSeriesFixture,
    getXtreamTitle,
} from './portal-mock-fixtures';

const downloadQueueCredentials = {
    password: 'downloadqueue',
    username: 'downloadqueue',
};
const expectedEpisodeIds = [80_000, 80_001, 80_002, 80_003];

type EpisodeQueueRow = {
    episodeNumber: number | null;
    seriesXtreamId: number | null;
    status: string;
    xtreamId: number;
};

const expectedEpisodeQueue: EpisodeQueueRow[] = [
    {
        episodeNumber: 1,
        seriesXtreamId: 30_000,
        status: 'downloading',
        xtreamId: expectedEpisodeIds[0],
    },
    {
        episodeNumber: 2,
        seriesXtreamId: 30_000,
        status: 'queued',
        xtreamId: expectedEpisodeIds[1],
    },
    {
        episodeNumber: 3,
        seriesXtreamId: 30_000,
        status: 'queued',
        xtreamId: expectedEpisodeIds[2],
    },
    {
        episodeNumber: 4,
        seriesXtreamId: 30_000,
        status: 'queued',
        xtreamId: expectedEpisodeIds[3],
    },
];

type SeriesFixture = Awaited<ReturnType<typeof fetchXtreamSeriesFixture>>;

function waitForQueueStabilityInterval(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 1_500));
}

function readFirstSeriesTitle(fixture: SeriesFixture): string {
    const firstSeries = fixture.items[0];
    const title = firstSeries ? getXtreamTitle(firstSeries) : '';
    if (
        !title ||
        Number(firstSeries?.series_id) !== 30_000 ||
        fixture.items.length !== 4
    ) {
        throw new Error('Series download queue fixture is invalid.');
    }
    return title;
}

async function readEpisodeQueue(page: Page): Promise<EpisodeQueueRow[]> {
    return page.evaluate(async () => {
        const downloads = (await window.electron?.downloadsGetList?.()) ?? [];
        return downloads
            .filter((download) => download.contentType === 'episode')
            .map((download) => ({
                episodeNumber: download.episodeNumber ?? null,
                seriesXtreamId: download.seriesXtreamId ?? null,
                status: download.status,
                xtreamId: download.xtreamId,
            }));
    });
}

test.describe('Electron Series Download Queue', () => {
    test('@downloads @xtream @electron queues individual and season episode downloads without duplicates', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const seriesFixture = await fetchXtreamSeriesFixture(
            request,
            downloadQueueCredentials
        );
        const firstSeriesTitle = readFirstSeriesTitle(seriesFixture);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                ...downloadQueueCredentials,
                name: 'Series Download Queue',
            });
            await waitForXtreamImportToFinish(app.mainWindow);

            await app.mainWindow
                .getByRole('button', { name: 'Open downloads' })
                .click();
            await app.mainWindow.waitForURL(/\/workspace\/downloads(?:\?.*)?$/);

            const downloadsDir = join(dataDir, 'series-downloads');
            mkdirSync(downloadsDir, { recursive: true });
            await app.electronApp.evaluate(({ dialog }, folder) => {
                dialog.showOpenDialog = async () =>
                    ({
                        canceled: false,
                        filePaths: [folder],
                    }) as Awaited<ReturnType<typeof dialog.showOpenDialog>>;
            }, downloadsDir);
            await app.mainWindow
                .getByRole('button', { name: 'Change Folder' })
                .click();
            await expect(
                app.mainWindow.getByTestId('downloads-folder')
            ).toContainText('series-downloads');

            await openWorkspaceSection(app.mainWindow, 'Series');
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            await clickGridListCardByTitle(app.mainWindow, firstSeriesTitle);
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/
            );

            const firstEpisodeAction = app.mainWindow.getByTestId(
                `episode-download-${expectedEpisodeIds[0]}`
            );
            const secondEpisodeAction = app.mainWindow.getByTestId(
                `episode-download-${expectedEpisodeIds[1]}`
            );
            await expect(firstEpisodeAction).toBeEnabled({ timeout: 20_000 });
            await expect(secondEpisodeAction).toBeEnabled();
            await firstEpisodeAction.click();
            await secondEpisodeAction.click();

            await expect
                .poll(() => readEpisodeQueue(app.mainWindow), {
                    timeout: 20_000,
                })
                .toEqual(expectedEpisodeQueue.slice(0, 2));

            const seasonAction = app.mainWindow.getByTestId('download-season');
            await expect(seasonAction).toBeVisible();
            await expect(seasonAction).toContainText('Download season (2)');
            await expect(seasonAction).toBeEnabled();
            await seasonAction.click();
            await expect(
                app.mainWindow.getByText('Added 2 · Skipped 2', {
                    exact: true,
                })
            ).toBeVisible({ timeout: 20_000 });

            await expect
                .poll(() => readEpisodeQueue(app.mainWindow), {
                    timeout: 20_000,
                })
                .toEqual(expectedEpisodeQueue);

            await expect(seasonAction).toBeDisabled();
            await expect(seasonAction).toContainText('Download season (0)');

            await waitForQueueStabilityInterval();
            expect(await readEpisodeQueue(app.mainWindow)).toEqual(
                expectedEpisodeQueue
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});
