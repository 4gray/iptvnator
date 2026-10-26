import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
    ElectronDownloadItem,
    ElectronRecordingItem,
} from '@iptvnator/shared/interfaces';
import type { LaunchedElectronApp } from './electron-test-fixtures';

const base: ElectronDownloadItem = {
    id: 1,
    playlistId: 'visual-source',
    xtreamId: 1,
    contentType: 'vod',
    title: 'The Last Observatory',
    url: 'https://media.example.test/movie.mp4',
    status: 'downloading',
    fileAvailability: 'available',
    bytesDownloaded: 384 * 1024 * 1024,
    totalBytes: 1024 * 1024 * 1024,
    filePath: '/fictional/downloads/observatory.mp4',
};
export const styleDownloads: ElectronDownloadItem[] = [
    base,
    {
        ...base,
        id: 2,
        xtreamId: 2,
        title: 'Across the Northern Sea — a very long expedition title',
        status: 'paused',
    },
    {
        ...base,
        id: 3,
        xtreamId: 3,
        title: 'Signal from Tomorrow',
        status: 'failed',
        errorMessage:
            'The connection was interrupted. Retry to continue the download.',
    },
    {
        ...base,
        id: 4,
        xtreamId: 4,
        title: 'A Map of Quiet Places',
        status: 'completed',
        fileAvailability: 'missing',
    },
    { ...base, id: 5, xtreamId: 5, title: 'City Lights', status: 'completed' },
    ...[1, 2].map((episodeNumber): ElectronDownloadItem => ({
        ...base,
        id: 5 + episodeNumber,
        xtreamId: 5 + episodeNumber,
        title: `The Glass Coast — Episode ${episodeNumber}`,
        contentType: 'episode',
        seriesXtreamId: 90,
        seasonNumber: 1,
        episodeNumber,
        status: 'completed',
    })),
];
export const styleRecordings: ElectronRecordingItem[] = [
    {
        id: 1,
        channelName: 'Northern Science',
        programTitle: 'The changing night sky',
        filePath: '/fictional/downloads/sky.ts',
        fileSizeBytes: 64 * 1024 * 1024,
        status: 'recording',
        startedAt: '2026-10-26T18:00:00Z',
        fileAvailability: 'available',
    },
    {
        id: 2,
        channelName: 'Discovery Coast with a long translated channel name',
        programTitle: 'Islands beyond the horizon',
        filePath: '/fictional/downloads/islands.ts',
        status: 'failed',
        startedAt: '2026-10-25T18:00:00Z',
        fileAvailability: 'missing',
        errorMessage:
            'The recording could not be completed. The destination is no longer available.',
    },
];
export async function seedDownloadStyles(app: LaunchedElectronApp) {
    await app.electronApp.evaluate(
        ({ ipcMain }, { downloads, recordings }) => {
            const handlers: Record<string, unknown> = {
                DOWNLOADS_GET_LIST: downloads,
                DOWNLOADS_GET_DEFAULT_FOLDER:
                    '/fictional/Library/Media/Downloaded programmes',
                RECORDINGS_GET_LIST: recordings,
            };
            for (const [channel, value] of Object.entries(handlers)) {
                ipcMain.removeHandler(channel);
                ipcMain.handle(channel, () => value);
            }
            ipcMain.removeHandler('DOWNLOADS_GET');
            ipcMain.handle('DOWNLOADS_GET', (_event, id: number) =>
                downloads.find((item) => item.id === id)
            );
            ipcMain.removeHandler('DOWNLOADS_PAUSE');
            ipcMain.handle(
                'DOWNLOADS_PAUSE',
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ success: true }), 1200)
                    )
            );
        },
        { downloads: styleDownloads, recordings: styleRecordings }
    );
    await app.mainWindow.goto(
        pathToFileURL(resolve(__dirname, '../../../dist/apps/web/index.html'))
            .href
    );
    await app.mainWindow
        .getByRole('button', { name: 'Open downloads' })
        .click();
}
