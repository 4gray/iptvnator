import { and, eq, inArray } from 'drizzle-orm';
import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';
import {
    retryDownloadRequest,
    startDownloadRequest,
    type StartDownloadRequest,
} from './download-requests';
import { resetStaleDownloads } from './download-recovery';
import {
    broadcastDownloadUpdate,
    cancelDownload,
    removeDownloadFromRuntime,
    setMainWindow,
} from './download-runtime';

function getDownloadAuthorizationPath(): string {
    return join(
        app.getPath('userData'),
        'download-directory-authorization.json'
    );
}

const downloadDirectoryAuthorizer = new DownloadDirectoryAuthorizer({
    getDefaultDirectory: () => app.getPath('downloads'),
    loadSelectedDirectory: async () => {
        try {
            const stored = JSON.parse(
                await readFile(getDownloadAuthorizationPath(), 'utf-8')
            ) as { directory?: unknown };
            return typeof stored.directory === 'string'
                ? stored.directory
                : null;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(
                    '[Downloads] Ignoring invalid folder authorization:',
                    error
                );
            }
            return null;
        }
    },
    saveSelectedDirectory: async (directory) => {
        const authorizationPath = getDownloadAuthorizationPath();
        const temporaryPath = `${authorizationPath}.${process.pid}.tmp`;
        await mkdir(app.getPath('userData'), { recursive: true });
        await writeFile(
            temporaryPath,
            JSON.stringify({ directory, version: 1 }),
            'utf-8'
        );
        await rename(temporaryPath, authorizationPath);
    },
});

async function isManagedDownloadFile(filePath: string): Promise<boolean> {
    if (!filePath) {
        return false;
    }
    try {
        const db = await getDatabase();
        const rows = await db
            .select({ id: schema.downloads.id })
            .from(schema.downloads)
            .where(eq(schema.downloads.filePath, filePath))
            .limit(1);
        return rows.length > 0;
    } catch (error) {
        console.error('Error verifying managed download path:', error);
        return false;
    }
}

ipcMain.handle(
    'DOWNLOADS_START',
    async (_event, data: StartDownloadRequest) => {
        try {
            return await startDownloadRequest(
                data,
                downloadDirectoryAuthorizer
            );
        } catch (error) {
            console.error('[Downloads] Error enqueuing download:', error);
            throw error;
        }
    }
);

ipcMain.handle('DOWNLOADS_CANCEL', async (_event, downloadId: number) => {
    try {
        console.log('[Downloads] Cancel download:', downloadId);
        return (await cancelDownload(downloadId))
            ? { success: true }
            : { error: 'Download not found in queue', success: false };
    } catch (error) {
        console.error('[Downloads] Error canceling download:', error);
        throw error;
    }
});

ipcMain.handle(
    'DOWNLOADS_RETRY',
    async (_event, downloadId: number, downloadFolder: string) => {
        try {
            return await retryDownloadRequest(
                downloadId,
                downloadFolder,
                downloadDirectoryAuthorizer
            );
        } catch (error) {
            console.error('[Downloads] Error retrying download:', error);
            throw error;
        }
    }
);

ipcMain.handle('DOWNLOADS_REMOVE', async (_event, downloadId: number) => {
    try {
        console.log('[Downloads] Remove download:', downloadId);
        removeDownloadFromRuntime(downloadId);
        const db = await getDatabase();
        await db
            .delete(schema.downloads)
            .where(eq(schema.downloads.id, downloadId));
        broadcastDownloadUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Downloads] Error removing download:', error);
        throw error;
    }
});

ipcMain.handle('DOWNLOADS_GET_LIST', async (_event, playlistId?: string) => {
    try {
        const db = await getDatabase();
        const query = db.select().from(schema.downloads);
        return playlistId
            ? query
                  .where(eq(schema.downloads.playlistId, playlistId))
                  .orderBy(schema.downloads.createdAt)
            : query.orderBy(schema.downloads.createdAt);
    } catch (error) {
        console.error('[Downloads] Error getting download list:', error);
        throw error;
    }
});

ipcMain.handle('DOWNLOADS_GET', async (_event, downloadId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.downloads)
            .where(eq(schema.downloads.id, downloadId))
            .limit(1);
        return result[0] || null;
    } catch (error) {
        console.error('[Downloads] Error getting download:', error);
        throw error;
    }
});

ipcMain.handle('DOWNLOADS_GET_DEFAULT_FOLDER', async () => {
    return downloadDirectoryAuthorizer.getPreferredDirectory();
});

ipcMain.handle('DOWNLOADS_SELECT_FOLDER', async () => {
    const result = await dialog.showOpenDialog({
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Download Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return downloadDirectoryAuthorizer.authorizeSelectedDirectory(
        result.filePaths[0]
    );
});

ipcMain.handle('DOWNLOADS_REVEAL_FILE', async (_event, filePath: string) => {
    if (!(await isManagedDownloadFile(filePath)) || !existsSync(filePath)) {
        return { error: 'File not found', success: false };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
});

ipcMain.handle('DOWNLOADS_PLAY_FILE', async (_event, filePath: string) => {
    if (!(await isManagedDownloadFile(filePath)) || !existsSync(filePath)) {
        return { error: 'File not found', success: false };
    }
    await shell.openPath(filePath);
    return { success: true };
});

ipcMain.handle(
    'DOWNLOADS_CLEAR_COMPLETED',
    async (_event, playlistId?: string) => {
        try {
            const db = await getDatabase();
            const terminalStatus = inArray(schema.downloads.status, [
                'completed',
                'failed',
                'canceled',
            ]);
            await db
                .delete(schema.downloads)
                .where(
                    playlistId
                        ? and(
                              eq(schema.downloads.playlistId, playlistId),
                              terminalStatus
                          )
                        : terminalStatus
                );
            broadcastDownloadUpdate();
            return { success: true };
        } catch (error) {
            console.error('[Downloads] Error clearing completed:', error);
            throw error;
        }
    }
);

export { resetStaleDownloads, setMainWindow };
