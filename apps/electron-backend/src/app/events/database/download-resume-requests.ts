import { recoverStoredCatchupCompletion } from './download-catchup-recover-completion';
import { and, eq, sql } from 'drizzle-orm';
import { basename, dirname } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { assertRemoteUrlAllowed } from '../url-safety';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';
import { catchupForDownload } from './download-catchup';
import { sanitizeFilename, createFileName } from './download-request-options';
import { resolveStoredDownloadHeaders } from './download-request-headers';
import { enqueueDownload, hasRuntimeDownload } from './download-runtime';

export async function retryDownloadRequest(
    downloadId: number,
    downloadFolder: string,
    authorizer: DownloadDirectoryAuthorizer
): Promise<{ success: boolean; error?: string }> {
    console.log('[Downloads] Retry download:', downloadId);
    const db = await getDatabase();
    const existing = await db
        .select()
        .from(schema.downloads)
        .where(eq(schema.downloads.id, downloadId))
        .limit(1);

    if (existing.length === 0) {
        return { error: 'Download not found', success: false };
    }

    const item = existing[0];
    if (!['failed', 'canceled'].includes(item.status)) {
        return {
            error: 'Can only retry failed or canceled downloads',
            success: false,
        };
    }

    if (
        await recoverStoredCatchupCompletion(db, item, () =>
            hasRuntimeDownload(item.id)
        )
    )
        return { success: true };
    const catchup = catchupForDownload(item);
    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });

    const retainedFilePath =
        (item.status === 'failed' || catchup) && item.filePath
            ? item.filePath
            : null;
    // A retained filePath was written by the main process after its folder
    // was authorized; requiring the folder to still be the CURRENT selection
    // would strand the retry after the user switches download folders.
    const directory = retainedFilePath
        ? dirname(retainedFilePath)
        : await authorizer.requireAuthorized(downloadFolder);
    const fileName = retainedFilePath
        ? basename(retainedFilePath)
        : catchup
          ? sanitizeFilename(item.title) + '.ts'
          : createFileName(item.title, item.url);
    const headers = await resolveStoredDownloadHeaders(db, item);
    const queuedUpdate = retainedFilePath
        ? {
              errorMessage: null,
              fileName,
              status: 'queued' as const,
              updatedAt: sql`CURRENT_TIMESTAMP`,
          }
        : {
              bytesDownloaded: 0,
              errorMessage: null,
              fileName,
              filePath: null,
              resumeValidator: null,
              status: 'queued' as const,
              totalBytes: null,
              updatedAt: sql`CURRENT_TIMESTAMP`,
          };
    await db
        .update(schema.downloads)
        .set(queuedUpdate)
        .where(eq(schema.downloads.id, downloadId));
    enqueueDownload({
        catchup,
        directory,
        fileName,
        filePath: retainedFilePath,
        headers,
        id: item.id,
        resumeValidator: retainedFilePath ? item.resumeValidator : null,
        totalBytes: retainedFilePath ? item.totalBytes : null,
        url: item.url,
    });
    return { success: true };
}

export async function resumeDownloadRequest(
    downloadId: number,
    downloadFolder: string,
    authorizer: DownloadDirectoryAuthorizer
): Promise<{ success: boolean; error?: string }> {
    console.log('[Downloads] Resume download:', downloadId);
    const db = await getDatabase();
    const existing = await db
        .select()
        .from(schema.downloads)
        .where(eq(schema.downloads.id, downloadId))
        .limit(1);

    if (existing.length === 0) {
        return { error: 'Download not found', success: false };
    }

    const item = existing[0];
    if (item.status !== 'paused') {
        return {
            error: 'Can only resume paused downloads',
            success: false,
        };
    }

    if (
        await recoverStoredCatchupCompletion(db, item, () =>
            hasRuntimeDownload(item.id)
        )
    )
        return { success: true };
    const catchup = catchupForDownload(item);
    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });

    // See retryDownloadRequest: DB-recorded retained paths stay usable after
    // the user switches download folders.
    const directory = item.filePath
        ? dirname(item.filePath)
        : await authorizer.requireAuthorized(downloadFolder);
    const fileName = item.filePath
        ? basename(item.filePath)
        : catchup
          ? sanitizeFilename(item.title) + '.ts'
          : createFileName(item.title, item.url);
    const headers = await resolveStoredDownloadHeaders(db, item);

    // Claim the row atomically: a concurrent resume for the same id loses
    // this conditional update and must not enqueue a second task.
    const claim = await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            fileName,
            status: 'queued',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
            and(
                eq(schema.downloads.id, downloadId),
                eq(schema.downloads.status, 'paused')
            )
        );
    if (hasNoChanges(claim)) {
        return {
            error: 'Can only resume paused downloads',
            success: false,
        };
    }

    enqueueDownload({
        catchup,
        directory,
        fileName,
        filePath: item.filePath,
        headers,
        id: item.id,
        resumeValidator: item.resumeValidator,
        totalBytes: item.totalBytes,
        url: item.url,
    });
    return { success: true };
}

function hasNoChanges(result: unknown): boolean {
    return (
        typeof result === 'object' &&
        result !== null &&
        'changes' in result &&
        (result as { changes: number }).changes === 0
    );
}
