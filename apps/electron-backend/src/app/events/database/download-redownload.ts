import { and, eq, sql } from 'drizzle-orm';
import { accessSync, constants } from 'node:fs';
import { basename, dirname } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { assertRemoteUrlAllowed } from '../url-safety';
import { isAvailableDownloadFile } from './download-file-availability';
import { removePartialDownloadFile } from './download-file-path';
import { parseStoredHeaders } from './download-requests';
import { enqueueDownload } from './download-runtime';

export interface RedownloadMissingResult {
    error?: string;
    recovered?: boolean;
    success: boolean;
}

function isWritableDirectory(directory: string): boolean {
    try {
        accessSync(directory, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function hasNoChanges(result: unknown): boolean {
    return (
        typeof result === 'object' &&
        result !== null &&
        'changes' in result &&
        (result as { changes: number }).changes === 0
    );
}

export async function redownloadMissingRequest(
    downloadId: number
): Promise<RedownloadMissingResult> {
    const db = await getDatabase();
    const rows = await db
        .select()
        .from(schema.downloads)
        .where(eq(schema.downloads.id, downloadId))
        .limit(1);
    const item = rows[0];

    if (!item) {
        return { error: 'Download not found', success: false };
    }
    if (item.status !== 'completed') {
        return {
            error: 'Can only re-download missing completed files',
            success: false,
        };
    }
    if (isAvailableDownloadFile(item.filePath)) {
        return { recovered: true, success: true };
    }
    if (!item.filePath || !isWritableDirectory(dirname(item.filePath))) {
        return { error: 'Download folder is unavailable', success: false };
    }

    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });

    try {
        removePartialDownloadFile(item.filePath);
    } catch (error) {
        console.error(
            '[Downloads] Failed to delete partial before missing-file recovery:',
            error
        );
        return {
            error: 'Could not delete the previous partial file',
            success: false,
        };
    }

    const claim = await db
        .update(schema.downloads)
        .set({
            bytesDownloaded: 0,
            errorMessage: null,
            resumeValidator: null,
            status: 'queued',
            totalBytes: null,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
            and(
                eq(schema.downloads.id, item.id),
                eq(schema.downloads.status, 'completed')
            )
        );
    if (hasNoChanges(claim)) {
        return {
            error: 'Download is no longer recoverable',
            success: false,
        };
    }

    enqueueDownload({
        directory: dirname(item.filePath),
        fileName: basename(item.filePath),
        filePath: item.filePath,
        headers: parseStoredHeaders(item.requestHeaders),
        id: item.id,
        resumeValidator: null,
        totalBytes: null,
        url: item.url,
    });
    return { success: true };
}
