import { and, eq, inArray } from 'drizzle-orm';
import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';
import { removePartialDownloadFile } from './download-file-path';
import {
    resumeDownloadRequest,
    retryDownloadRequest,
    startDownloadRequest,
    type StartDownloadRequest,
} from './download-requests';
import { resetStaleDownloads } from './download-recovery';
import {
    broadcastDownloadUpdate,
    cancelDownload,
    pauseDownload,
    removeDownloadFromRuntime,
    setMainWindow,
} from './download-runtime';

const removablePartialStatuses = new Set([
    'queued',
    'paused',
    'completed',
    'failed',
    'canceled',
]);

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

ipcMain.handle('DOWNLOADS_PAUSE', async (_event, downloadId: number) => {
    try {
        console.log('[Downloads] Pause download:', downloadId);
        return (await pauseDownload(downloadId))
            ? { success: true }
            : { error: 'Download not found in queue', success: false };
    } catch (error) {
        console.error('[Downloads] Error pausing download:', error);
        throw error;
    }
});

ipcMain.handle(
    'DOWNLOADS_RESUME',
    async (_event, downloadId: number, downloadFolder: string) => {
        try {
            return await resumeDownloadRequest(
                downloadId,
                downloadFolder,
                downloadDirectoryAuthorizer
            );
        } catch (error) {
            console.error('[Downloads] Error resuming download:', error);
            throw error;
        }
    }
);

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
        const db = await getDatabase();
        const rows = await db
            .select({
                filePath: schema.downloads.filePath,
                status: schema.downloads.status,
        })
            .from(schema.downloads)
            .where(eq(schema.downloads.id, downloadId))
            .limit(1);
        const row = rows[0];
        if (row?.filePath && removablePartialStatuses.has(row.status)) {
            try {
                removePartialDownloadFile(row.filePath);
            } catch (cleanupError) {
                // Keep the row (and its runtime entry) so the .part is never
                // orphaned, but answer with a structured failure the UI can
                // surface instead of an opaque IPC rejection. Retrying the
                // remove re-attempts the deletion.
                console.error(
                    '[Downloads] Failed to delete partial file on remove:',
                    row.filePath,
                    cleanupError
                );
                return {
                    error: 'Could not delete the partial file',
                    success: false,
                };
            }
        }
        removeDownloadFromRuntime(downloadId);
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
            const terminalFilter = playlistId
                ? and(eq(schema.downloads.playlistId, playlistId), terminalStatus)
                : terminalStatus;
            const rows = await db
                .select({
                    id: schema.downloads.id,
                    filePath: schema.downloads.filePath,
                    status: schema.downloads.status,
                })
                .from(schema.downloads)
                .where(terminalFilter);
            const downloadIdsToDelete: number[] = [];
            for (const row of rows) {
                if (row.filePath && removablePartialStatuses.has(row.status)) {
                    try {
                        removePartialDownloadFile(row.filePath);
                    } catch (error) {
                        console.error(
                            '[Downloads] Retaining download after partial cleanup failed:',
                            error
                        );
                        continue;
                    }
                }
                downloadIdsToDelete.push(row.id);
            }
            if (downloadIdsToDelete.length > 0) {
                await db
                    .delete(schema.downloads)
                    .where(
                        and(
                            terminalFilter,
                            inArray(schema.downloads.id, downloadIdsToDelete)
                        )
                    );
                broadcastDownloadUpdate();
            }
            return { success: true };
        } catch (error) {
            console.error('[Downloads] Error clearing completed:', error);
            throw error;
        }
    }
);

export { resetStaleDownloads, setMainWindow };
