import type {
    DownloadMetadataSnapshot,
    ElectronBridgeEpisodeIdentityScope,
    ElectronBridgeDownloadStartResult,
} from '@iptvnator/shared/interfaces';
import { ELECTRON_BRIDGE_DOWNLOAD_START_REASONS } from '@iptvnator/shared/interfaces';
import { and, eq, sql } from 'drizzle-orm';
import { basename, dirname, extname } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { assertRemoteUrlAllowed } from '../url-safety';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';
import { getDownloadFileAvailabilityWithTimeoutAsync } from './download-file-availability';
import { removePartialDownloadFileAsync } from './download-partial-cleanup';
import { resolveExistingDownloadIdentity } from './download-request-identity';
import { resolveStoredDownloadHeaders } from './download-request-headers';
import {
    assertDownloadMetadataArtworkDiffersFromStream,
    assertDownloadMetadataMatchesContentType,
    decodeDownloadMetadataSnapshot,
    encodeDownloadMetadataSnapshot,
} from './download-metadata-snapshot';
import { enqueueDownload } from './download-runtime';

export interface StartDownloadRequest {
    playlistId: string;
    xtreamId: number;
    contentType: 'vod' | 'episode';
    title: string;
    url: string;
    posterUrl?: string;
    metadataSnapshot?: DownloadMetadataSnapshot;
    downloadFolder: string;
    headers?: { userAgent?: string; referer?: string; origin?: string };
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeIdentityScope?: ElectronBridgeEpisodeIdentityScope;
    playlistName?: string;
    playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
    serverUrl?: string;
    portalUrl?: string;
    macAddress?: string;
}

function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function getExtensionFromUrl(url: string): string {
    try {
        // Sanitize too: URL pathnames may legally contain characters like ':'
        // that would create NTFS alternate data streams on Windows.
        const extension = sanitizeFilename(extname(new URL(url).pathname));
        return extension.startsWith('.') ? extension : '.mp4';
    } catch {
        return '.mp4';
    }
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

export async function startDownloadRequest(
    data: StartDownloadRequest,
    authorizer: DownloadDirectoryAuthorizer
): Promise<ElectronBridgeDownloadStartResult> {
    const encodedMetadataSnapshot =
        data.metadataSnapshot === undefined
            ? undefined
            : encodeDownloadMetadataSnapshot(data.metadataSnapshot);
    const normalizedMetadataSnapshot =
        encodedMetadataSnapshot === undefined
            ? undefined
            : decodeDownloadMetadataSnapshot(encodedMetadataSnapshot);
    if (
        encodedMetadataSnapshot !== undefined &&
        normalizedMetadataSnapshot === undefined
    ) {
        throw new Error('Invalid download metadata snapshot');
    }
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
    const identity = await resolveExistingDownloadIdentity(db, data);
    if (identity.kind === 'conflict') {
        return {
            error: 'Download identity conflict',
            success: false,
        };
    }
    const fileName = createFileName(data.title, data.url);
    const headers = createHeaders(data.headers);

    if (identity.kind === 'match') {
        const item = identity.item;
        if (normalizedMetadataSnapshot) {
            assertDownloadMetadataMatchesContentType(
                normalizedMetadataSnapshot,
                item.contentType
            );
            assertDownloadMetadataArtworkDiffersFromStream(
                normalizedMetadataSnapshot,
                item.url
            );
            assertDownloadMetadataArtworkDiffersFromStream(
                normalizedMetadataSnapshot,
                data.url
            );
        }
        if (item.contentType === 'episode' && item.status === 'completed') {
            const completedFileAvailability =
                await getDownloadFileAvailabilityWithTimeoutAsync(item);
            if (completedFileAvailability === 'unknown') {
                return {
                    error: 'Could not verify the completed download file',
                    id: item.id,
                    success: false,
                };
            }
            if (completedFileAvailability === 'available') {
                return {
                    error: 'Download already completed',
                    id: item.id,
                    reason: ELECTRON_BRIDGE_DOWNLOAD_START_REASONS.AlreadyDownloaded,
                    success: false,
                };
            }
        }
        if (!['completed', 'failed', 'canceled'].includes(item.status)) {
            return {
                error: 'Download already in progress',
                id: item.id,
                reason: 'already-in-progress',
                success: false,
            };
        }

        if (
            ['completed', 'failed', 'canceled'].includes(item.status) &&
            item.filePath
        ) {
            // A terminal row can still reference a retained .part; delete it
            // before the restart clears filePath, or the file is orphaned.
            // An unavailable or slow .part must keep its database owner.
            const cleanup = await removePartialDownloadFileAsync(item.filePath);
            if (cleanup === 'unknown') {
                console.error(
                    '[Downloads] Could not verify retained partial cleanup'
                );
                return {
                    error: 'Could not delete the previous partial file',
                    id: item.id,
                    success: false,
                };
            }
        }

        await db
            .update(schema.downloads)
            .set({
                bytesDownloaded: 0,
                errorMessage: null,
                fileName,
                filePath: null,
                ...(encodedMetadataSnapshot === undefined
                    ? {}
                    : { metadataSnapshot: encodedMetadataSnapshot }),
                requestHeaders: serializeHeaders(headers),
                resumeValidator: null,
                status: 'queued',
                totalBytes: null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
                url: data.url,
                ...(identity.migrateCanonicalId
                    ? { xtreamId: data.xtreamId }
                    : {}),
                ...(data.episodeIdentityScope === undefined
                    ? {}
                    : { episodeIdentityScope: data.episodeIdentityScope }),
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

    if (normalizedMetadataSnapshot) {
        assertDownloadMetadataMatchesContentType(
            normalizedMetadataSnapshot,
            data.contentType
        );
        assertDownloadMetadataArtworkDiffersFromStream(
            normalizedMetadataSnapshot,
            data.url
        );
    }
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

    const result = await db.insert(schema.downloads).values({
        contentType: data.contentType,
        episodeNumber: data.episodeNumber,
        episodeIdentityScope: data.episodeIdentityScope,
        fileName,
        metadataSnapshot: encodedMetadataSnapshot,
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
    // A retained filePath was written by the main process after its folder
    // was authorized; requiring the folder to still be the CURRENT selection
    // would strand the retry after the user switches download folders.
    const directory = retainedFilePath
        ? dirname(retainedFilePath)
        : await authorizer.requireAuthorized(downloadFolder);
    const fileName = retainedFilePath
        ? basename(retainedFilePath)
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
    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });
    if (item.status !== 'paused') {
        return {
            error: 'Can only resume paused downloads',
            success: false,
        };
    }

    // See retryDownloadRequest: DB-recorded retained paths stay usable after
    // the user switches download folders.
    const directory = item.filePath
        ? dirname(item.filePath)
        : await authorizer.requireAuthorized(downloadFolder);
    const fileName = item.filePath
        ? basename(item.filePath)
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
