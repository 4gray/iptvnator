import { and, eq, sql } from 'drizzle-orm';
import { basename, dirname, extname } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { assertRemoteUrlAllowed } from '../url-safety';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';
import { enqueueDownload } from './download-runtime';

export interface StartDownloadRequest {
    playlistId: string;
    xtreamId: number;
    contentType: 'vod' | 'episode';
    title: string;
    url: string;
    posterUrl?: string;
    downloadFolder: string;
    headers?: { userAgent?: string; referer?: string; origin?: string };
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    playlistName?: string;
    playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
    serverUrl?: string;
    portalUrl?: string;
    macAddress?: string;
}

function getExtensionFromUrl(url: string): string {
    try {
        return extname(new URL(url).pathname) || '.mp4';
    } catch {
        return '.mp4';
    }
}

function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function createFileName(title: string, url: string): string {
    return sanitizeFilename(title) + getExtensionFromUrl(url);
}

function createHeaders(
    headers: StartDownloadRequest['headers']
): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }

    const result: Record<string, string> = {};
    if (headers.userAgent) {
        result['User-Agent'] = headers.userAgent;
    }
    if (headers.origin) {
        result.Origin = headers.origin;
    }
    if (headers.referer) {
        result.Referer = headers.referer;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

function serializeHeaders(
    headers: Record<string, string> | undefined
): string | null {
    return headers ? JSON.stringify(headers) : null;
}

function parseStoredHeaders(
    value: string | null
): Record<string, string> | undefined {
    if (!value) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }

        const headers = Object.entries(parsed).reduce<Record<string, string>>(
            (acc, [key, headerValue]) => {
                if (typeof headerValue === 'string') {
                    acc[key] = headerValue;
                }
                return acc;
            },
            {}
        );
        return Object.keys(headers).length > 0 ? headers : undefined;
    } catch {
        return undefined;
    }
}

export async function startDownloadRequest(
    data: StartDownloadRequest,
    authorizer: DownloadDirectoryAuthorizer
): Promise<{ success: boolean; error?: string; id?: number }> {
    console.log('[Downloads] Enqueue download:', data.title);
    const directory = await authorizer.requireAuthorized(data.downloadFolder);
    await assertRemoteUrlAllowed(data.url, { allowPrivateNetworks: true });
    const db = await getDatabase();

    if (!data.playlistId) {
        throw new Error('playlistId is required for downloads');
    }

    const existingPlaylist = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, data.playlistId))
        .limit(1);
    if (existingPlaylist.length === 0) {
        console.log(
            '[Downloads] Creating playlist entry for:',
            data.playlistId
        );
        await db.insert(schema.playlists).values({
            id: data.playlistId,
            macAddress: data.macAddress,
            name: data.playlistName || 'Unknown Playlist',
            serverUrl: data.serverUrl,
            type: data.playlistType || 'stalker',
            url: data.portalUrl,
        });
    }

    const existing = await db
        .select()
        .from(schema.downloads)
        .where(
            and(
                eq(schema.downloads.playlistId, data.playlistId),
                eq(schema.downloads.xtreamId, data.xtreamId),
                eq(schema.downloads.contentType, data.contentType)
            )
        )
        .limit(1);
    const fileName = createFileName(data.title, data.url);
    const headers = createHeaders(data.headers);

    if (existing.length > 0) {
        const item = existing[0];
        if (!['completed', 'failed', 'canceled'].includes(item.status)) {
            return {
                error: 'Download already in progress',
                id: item.id,
                success: false,
            };
        }

        await db
            .update(schema.downloads)
            .set({
                bytesDownloaded: 0,
                errorMessage: null,
                fileName,
                filePath: null,
                requestHeaders: serializeHeaders(headers),
                status: 'queued',
                totalBytes: null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
                url: data.url,
            })
            .where(eq(schema.downloads.id, item.id));
        enqueueDownload({
            directory,
            fileName,
            headers,
            id: item.id,
            url: data.url,
        });
        return { id: item.id, success: true };
    }

    const result = await db.insert(schema.downloads).values({
        contentType: data.contentType,
        episodeNumber: data.episodeNumber,
        fileName,
        playlistId: data.playlistId,
        posterUrl: data.posterUrl,
        requestHeaders: serializeHeaders(headers),
        seasonNumber: data.seasonNumber,
        seriesXtreamId: data.seriesXtreamId,
        status: 'queued',
        title: data.title,
        url: data.url,
        xtreamId: data.xtreamId,
    });
    const insertedId = Number(result.lastInsertRowid);
    enqueueDownload({
        directory,
        fileName,
        headers,
        id: insertedId,
        url: data.url,
    });
    return { id: insertedId, success: true };
}

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
    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });
    if (!['failed', 'canceled'].includes(item.status)) {
        return {
            error: 'Can only retry failed or canceled downloads',
            success: false,
        };
    }

    const retainedFilePath =
        item.status === 'failed' && item.filePath ? item.filePath : null;
    const directory = retainedFilePath
        ? await authorizer.requireAuthorized(dirname(retainedFilePath))
        : await authorizer.requireAuthorized(downloadFolder);
    const fileName = retainedFilePath
        ? basename(retainedFilePath)
        : createFileName(item.title, item.url);
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
              status: 'queued' as const,
              totalBytes: null,
              updatedAt: sql`CURRENT_TIMESTAMP`,
          };
    await db
        .update(schema.downloads)
        .set(queuedUpdate)
        .where(eq(schema.downloads.id, downloadId));
    enqueueDownload({
        directory,
        fileName,
        filePath: retainedFilePath,
        headers: parseStoredHeaders(item.requestHeaders),
        id: item.id,
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
    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });
    if (item.status !== 'paused') {
        return {
            error: 'Can only resume paused downloads',
            success: false,
        };
    }

    const directory = item.filePath
        ? await authorizer.requireAuthorized(dirname(item.filePath))
        : await authorizer.requireAuthorized(downloadFolder);
    const fileName = item.filePath
        ? basename(item.filePath)
        : createFileName(item.title, item.url);

    await db
        .update(schema.downloads)
        .set({
            errorMessage: null,
            fileName,
            status: 'queued',
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.downloads.id, downloadId));
    enqueueDownload({
        directory,
        fileName,
        filePath: item.filePath,
        headers: parseStoredHeaders(item.requestHeaders),
        id: item.id,
        totalBytes: item.totalBytes,
        url: item.url,
    });
    return { success: true };
}
